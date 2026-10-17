import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentDigest, evaluationDigest, type SourceFile } from '../digest';
import { loadGitCurriculum, parseCurriculum } from '../load';
import { parseEvaluationCatalog, resolveEvaluations } from '../evaluation';
import { testCurriculum } from '../../../tests/fixtures/curriculum';

const original = loadGitCurriculum(fileURLToPath(new URL('../../../', import.meta.url)));
const files = original.files;
const change = (suffix: string, from: string, to: string): SourceFile[] =>
  files.map((f) =>
    f.path.endsWith(suffix)
      ? { ...f, bytes: Buffer.from(Buffer.from(f.bytes).toString().replace(from, to)) }
      : f,
  );

describe('Git curriculum validation and exact-byte identity', () => {
  it('loads the valid two-node curriculum and its only root', () => {
    expect(original.curriculum.nodes.map((n) => n.key)).toEqual(['hello-go', 'even-or-odd']);
    expect(original.curriculum.roots).toEqual(['hello-go']);
    expect(original.gitCommitSha).toMatch(/^[a-f0-9]{40}$/);
  });
  it('uses identical digests across repeated loads and input file order', () => {
    expect(contentDigest(files)).toBe(contentDigest([...files].reverse()));
    expect(
      loadGitCurriculum(fileURLToPath(new URL('../../../', import.meta.url))).curriculum
        .contentDigest,
    ).toBe(original.curriculum.contentDigest);
  });
  it('changes the overall and subject digests for a single exact subject byte', () => {
    const next = parseCurriculum(change('hello-go/subject.md', '# Hello Go', '# Hello Go\r'));
    expect(next.contentDigest).not.toBe(original.curriculum.contentDigest);
    expect(next.nodes[0]!.subjectDigest).not.toBe(original.curriculum.nodes[0]!.subjectDigest);
  });
  it.each([
    ['manifest.yaml', 'to: even-or-odd', 'to: unknown-node'],
    ['manifest.yaml', 'id: even-or-odd', 'id: hello-go'],
    ['manifest.yaml', 'quest: foundations', 'quest: unknown-quest'],
    ['manifest.yaml', 'order: 2', 'order: 1'],
    ['manifest.yaml', 'type: challenge', 'type: invalid'],
    ['manifest.yaml', 'rule: requires_pass', 'rule: unsupported'],
    ['manifest.yaml', 'to: even-or-odd', 'to: hello-go'],
    ['hello-go/challenge.yaml', 'hello.go', '../hello.go'],
    ['hello-go/challenge.yaml', 'max_size_kb: 256', 'max_size_kb: 0'],
    ['hello-go/challenge.yaml', 'language: go', 'language: go\nlanguage: go'],
  ])('rejects invalid content in %s: %s', (path, from, to) =>
    expect(() => parseCurriculum(change(path, from, to))).toThrow(),
  );
  it('rejects a cycle and does not silently pick a root', () => {
    const cyclic = change(
      'manifest.yaml',
      'rule: requires_pass',
      'rule: requires_pass\n  - from: even-or-odd\n    to: hello-go\n    rule: requires_pass',
    );
    expect(() => parseCurriculum(cyclic)).toThrow(/cycle/);
  });
  it('rejects missing subjects and duplicate source paths', () => {
    expect(() =>
      parseCurriculum(files.filter((f) => !f.path.endsWith('hello-go/subject.md'))),
    ).toThrow(/Missing/);
    expect(() => contentDigest([...files, files[0]!])).toThrow(/duplicate/);
  });
  it('does not invent evaluation identities for valid source content', () =>
    expect(() => resolveEvaluations(original.curriculum)).toThrow(/PUBLICATION_BLOCKED/));
  it('canonically hashes evaluation JSON independent of object property order', () => {
    expect(evaluationDigest({ b: [2, 3], a: 1 })).toBe(evaluationDigest({ a: 1, b: [2, 3] }));
    expect(evaluationDigest({ a: 2 })).not.toBe(evaluationDigest({ a: 1 }));
  });
  it('rejects unknown metadata rather than silently ignoring it', () => {
    expect(() =>
      parseCurriculum(
        change('hello-go/challenge.yaml', 'judge:', 'hidden_tests: forbidden\njudge:'),
      ),
    ).toThrow(/unsupported metadata/);
  });
});

describe('evaluation catalog boundary (in-memory non-runnable test metadata only)', () => {
  it('rejects duplicate metadata JSON keys', () => {
    expect(() => parseEvaluationCatalog('{"format_version":1,"format_version":2}')).toThrow(
      /duplicate/,
    );
  });
  const fixture = testCurriculum();
  const names = [
    'test_pack_digest',
    'test_pack_artifact',
    'runner_image_digest',
    'sandbox_image_digest',
    'toolchain_version',
    'target_platform',
    'build_flags',
    'dependency_policy',
    'resource_profile',
    'resource_limits',
    'protocol_version',
    'snapshot_format_version',
    'case_generation',
  ];
  const catalog = (): {
    format_version: number;
    test_packs: Record<string, Record<string, unknown>>;
  } => ({
    format_version: 1,
    test_packs: Object.fromEntries(
      fixture.curriculum.nodes.map((node, index) => [
        node.testPackId,
        Object.fromEntries(
          Object.entries(fixture.evaluations[index]!.spec).filter(([key]) => names.includes(key)),
        ),
      ]),
    ),
  });
  it('resolves and deterministically hashes complete metadata without learner artifact placeholders', () => {
    const a = resolveEvaluations(fixture.curriculum, catalog());
    const b = resolveEvaluations(fixture.curriculum, JSON.parse(JSON.stringify(catalog())));
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(a[0]!.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(a[0]!.spec).not.toHaveProperty('learner_artifact_digest');
    expect(a[0]!.spec.content_digest).toBe(fixture.curriculum.contentDigest);
  });
  it.each([
    ['runner_image_digest', 'runner:latest'],
    ['test_pack_digest', 'mutable-pack-name'],
    ['resource_limits', { compilation: {}, execution: {} }],
    ['case_generation', { mode: 'generated' }],
    ['hidden_tests', 'FORBIDDEN'],
  ])('rejects unresolved/unsafe catalog field %s', (field, value) => {
    const input = catalog();
    input.test_packs[fixture.curriculum.nodes[0]!.testPackId]![field] = value;
    expect(() => resolveEvaluations(fixture.curriculum, input)).toThrow();
  });
});
