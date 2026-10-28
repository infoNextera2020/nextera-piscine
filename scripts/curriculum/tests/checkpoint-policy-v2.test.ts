import { describe, it, expect } from 'vitest';
import { checkpointFixture } from '../../../tests/fixtures/checkpoints';
import { parseCurriculum } from '../load';
import { resolveEvaluations } from '../evaluation';
import { evaluationDigest, type SourceFile } from '../digest';
import candidate from '../../../infra/runner/catalog/candidate.json';

// In-memory source fixtures and deliberately non-runnable metadata. No catalog publication.
function policyFiles(count: number, threshold?: unknown, version = 2): SourceFile[] {
  const f = checkpointFixture();
  const keys = ['normalize-label', 'count-vowels', 'digit-sum', 'sign-label'].slice(0, count);
  const files = f.files.filter(
    (file) =>
      !file.path.includes('/tasks/') ||
      keys.some((key) => file.path.includes('/tasks/' + key + '/')),
  );
  for (let i = 4; i < count; i++) {
    const key = 'extra-' + i;
    keys.push(key);
    for (const file of f.files.filter((file) => file.path.includes('/tasks/normalize-label/')))
      files.push({
        path: file.path.replace('/normalize-label/', '/' + key + '/'),
        bytes: Buffer.from(
          Buffer.from(file.bytes)
            .toString()
            .replace('id: normalize-label', 'id: ' + key)
            .replace('checkpoint-normalize-label-v1', 'checkpoint-' + key + '-v1'),
        ),
      });
  }
  return files.map((file) =>
    file.path.endsWith('/checkpoint.yaml')
      ? {
          ...file,
          bytes: Buffer.from(
            Buffer.from(file.bytes)
              .toString()
              .replace('policy_version: 1', 'policy_version: ' + version)
              .replace(/tasks: \[[^\]]*\]/, 'tasks: [' + keys.join(', ') + ']') +
              (threshold === undefined ? '' : 'pass_points: ' + String(threshold) + '\n'),
          ),
        }
      : file,
  );
}
const catalog = () => ({
  format_version: 1,
  test_packs: Object.fromEntries(
    Object.entries(candidate.catalog.test_packs).map(([key, value]) => [
      key,
      {
        ...value,
        test_pack_artifact:
          'oci://test.invalid/non-runnable/' + key + '@sha256:' + value.test_pack_digest,
      },
    ]),
  ),
});
describe('versioned checkpoint source and frozen evaluation projection', () => {
  it.each([1, 3, 4, 10])(
    'loads %i separately identified tasks with an explicit synthetic threshold',
    (count) => {
      const node = parseCurriculum(policyFiles(count, count)).nodes.find(
        (n) => n.kind === 'checkpoint',
      )!;
      expect(node.checkpoint).toMatchObject({
        policyVersion: 2,
        durationSeconds: 5400,
        passPoints: count,
      });
      expect(node.checkpoint!.tasks).toHaveLength(count);
    },
  );
  it.each([undefined, 0, -1, 1.5, 5, 'not-a-number'])(
    'rejects missing or invalid explicit threshold %s',
    (threshold) => {
      expect(() => parseCurriculum(policyFiles(4, threshold))).toThrow();
    },
  );
  it('keeps legacy policy source strict and does not reinterpret old task lists', () => {
    const fixture = checkpointFixture();
    const legacy = fixture.curriculum.nodes.find((n) => n.kind === 'checkpoint')!.checkpoint!;
    expect(Object.keys(legacy)).toEqual(['policyVersion', 'durationSeconds', 'tasks']);
    expect(legacy).not.toHaveProperty('passPoints');
    expect(() => parseCurriculum(policyFiles(3, undefined, 1))).toThrow();
    expect(() => parseCurriculum(policyFiles(4, 3, 1))).toThrow(/unsupported metadata/);
  });
  it('retains the exact legacy serialized definition shape and digest', () => {
    const f = checkpointFixture();
    const resolved = resolveEvaluations(f.curriculum, catalog()).find(
      (item) => item.nodeKey === 'transfer-checkpoint',
    )!;
    if (!('checkpoint' in resolved)) throw new Error('Expected checkpoint evaluation');
    const definition = resolved.checkpoint!;
    const oldDefinition = { policyVersion: 1, durationSeconds: 5400, tasks: definition.tasks };
    expect(JSON.stringify(definition)).toBe(JSON.stringify(oldDefinition));
    expect(resolved.digest).toBe(
      evaluationDigest({ ...resolved.spec, checkpoint_definition: oldDefinition }),
    );
    expect(definition).not.toHaveProperty('passPoints');
  });
  it('commits v2 threshold and task count to immutable evaluation identity', () => {
    const files = policyFiles(3, 2);
    const a = parseCurriculum(files),
      b = parseCurriculum(
        files.map((file) =>
          file.path.endsWith('/checkpoint.yaml')
            ? {
                ...file,
                bytes: Buffer.from(
                  Buffer.from(file.bytes).toString().replace('pass_points: 2', 'pass_points: 3'),
                ),
              }
            : file,
        ),
      );
    const first = resolveEvaluations(a, catalog()).find(
      (item) => item.nodeKey === 'transfer-checkpoint',
    )!;
    const second = resolveEvaluations(b, catalog()).find(
      (item) => item.nodeKey === 'transfer-checkpoint',
    )!;
    if (!('checkpoint' in first)) throw new Error('Expected checkpoint evaluation');
    expect(first.checkpoint).toMatchObject({
      policyVersion: 2,
      durationSeconds: 5400,
      passPoints: 2,
    });
    expect(first.checkpoint!.tasks).toHaveLength(3);
    expect(first.digest).not.toBe(second.digest);
    expect(a.contentDigest).not.toBe(b.contentDigest);
  });
  it('does not weaken candidate or unresolved-artifact publication guards for v2', () => {
    const curriculum = parseCurriculum(policyFiles(3, 2));
    expect(() => resolveEvaluations(curriculum, candidate)).toThrow();
    expect(() => resolveEvaluations(curriculum, candidate.catalog)).toThrow();
    expect(candidate.status).toBe('CANDIDATE');
  });
});
