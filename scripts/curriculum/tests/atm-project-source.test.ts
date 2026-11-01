import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCurriculum, loadGitCurriculum } from '../load';
import {
  parseAtmProjectSourcePackage,
  readLocalAtmProjectFiles,
  validateAtmProjectSource,
  APPROVED_ATM_SOURCE_DIRECTORY as directory,
  APPROVED_ATM_SEMANTIC_PROFILE_DIGEST,
} from '../atm-project-source';
import { sha256, type SourceFile } from '../digest';
import { atmFixture, repo, folder } from './atm-project-fixture';
const actual = () => readLocalAtmProjectFiles(repo);
function manifest(files: SourceFile[], change: (value: Record<string, unknown>) => void) {
  return files.map((file) => {
    if (!file.path.endsWith('/source-package.json')) return file;
    const data = JSON.parse(Buffer.from(file.bytes).toString()) as Record<string, unknown>;
    change(data);
    return { ...file, bytes: Buffer.from(JSON.stringify(data)) };
  });
}
describe('approved ATM source v2 actual package and configured project loader', () => {
  it('executes standalone validation of all8 actual public resources with no readiness/publication defaults', () => {
    const checked = validateAtmProjectSource(actual());
    expect(checked.sourceValidated).toBe(true);
    expect(checked.runtimeReadiness).toBe('not_proven');
    expect(checked.source.semanticProfileDigest).toBe(APPROVED_ATM_SEMANTIC_PROFILE_DIGEST);
    expect(checked.source.resources).toHaveLength(8);
    expect(
      checked.source.resources.some((r) =>
        r.text.includes('func Report(event string, balance *int)'),
      ),
    ).toBe(true);
    expect(JSON.stringify(checked)).not.toContain('test_pack_artifact');
  });
  it('actual parseCurriculum consumes the complete subject/starter/profile/resources in a configured project', () => {
    const f = atmFixture(),
      source = f.node.projectSource!;
    expect(source.teamSize).toBe(3);
    expect(source.releasePolicy).toBe('scheduled_independent_of_exam1_result');
    expect(f.node.subjectMarkdown).toContain('Terminal balance is required');
    expect(source.resources.find((r) => r.role === 'starter')?.text).toContain(
      'README - required submission information',
    );
    expect(f.curriculum.prerequisites).toEqual([]);
    expect(f.curriculum.contentDigest).toMatch(/^[a-f0-9]{64}$/);
  });
  it('keeps all original baseline files/input-demo byte pins and exactly mirrors the committed approved public handoff', () => {
    const source = validateAtmProjectSource(actual()).source;
    const baseline = new URL('../../../content/source-baselines/project1-atm-v1/', import.meta.url);
    const provenance = JSON.parse(readFileSync(new URL('PROVENANCE.json', baseline), 'utf8'));
    for (const item of provenance.files)
      expect(sha256(readFileSync(new URL(item.path, baseline)))).toBe(item.sha256);
    for (const path of ['main.go', 'input.go'])
      expect(source.resources.find((r) => r.path === 'input-demo/' + path)?.sha256).toBe(
        sha256(readFileSync(new URL('input-demo/' + path, baseline))),
      );
    const starter = source.resources.find((r) => r.path === 'main.go')!.text;
    const original = readFileSync(new URL('scaffold/input.go', baseline), 'utf8');
    expect(starter).toContain(original.slice(original.indexOf('// Provided input adapter.')));
    expect(Buffer.byteLength(original)).toBe(474);
  });
  it.each([
    '../private.json',
    '/private.json',
    'input-demo/../private.json',
    'input-demo\\main.go',
    '%2e%2e/private.json',
    'README.md\0',
    './README.md',
    'input-demo//main.go',
  ])('rejects hostile resource path %j', (path) => {
    const files = manifest(actual(), (value) => {
      (value.resources as Record<string, unknown>[])[0]!.path = path;
    });
    expect(() => validateAtmProjectSource(files)).toThrow();
  });
  it.each(['expected', 'cases', 'private_oracle', 'hidden_tests', 'runner_command'])(
    'rejects unrecognized package metadata %s even null',
    (name) =>
      expect(() =>
        validateAtmProjectSource(
          manifest(actual(), (value) => {
            value[name] = null;
          }),
        ),
      ).toThrow(),
  );
  it('rejects mismatched port text even when raw public bytes and hashes stay approved', () => {
    const files = actual(),
      map = new Map(files.map((file) => [file.path, file.bytes]));
    for (const target of ['learner-en.md', 'source-package.json'])
      expect(() =>
        parseAtmProjectSourcePackage(directory, {
          bytes: (path) => map.get(path)!,
          read: (path) =>
            Buffer.from(map.get(path)!).toString() + (path.endsWith('/' + target) ? ' drift' : ''),
        }),
      ).toThrow(/text\/byte drift/);
  });
  it('rejects extra private resources and unreferenced files rather than silently ignoring them', () => {
    expect(() =>
      validateAtmProjectSource([
        ...actual(),
        { path: directory + '/oracle.py', bytes: Buffer.from('private expected solution') },
      ]),
    ).toThrow(/unreferenced/);
    expect(() =>
      validateAtmProjectSource(
        manifest(actual(), (value) => {
          (value.resources as unknown[]).push({
            path: 'private.json',
            role: 'guide',
            media_type: 'application/json',
            bytes: 2,
            sha256: 'a'.repeat(64),
          });
        }),
      ),
    ).toThrow();
  });
  it('rejects duplicate keys/paths, byte tampering and self-repinned unapproved business/helper content', () => {
    const files = actual();
    const bad = files.map((file) =>
      file.path.endsWith('/source-package.json')
        ? {
            ...file,
            bytes: Buffer.from(
              Buffer.from(file.bytes)
                .toString()
                .replace('"format_version": 1', '"format_version": 1,"format_version": 1'),
            ),
          }
        : file,
    );
    expect(() => validateAtmProjectSource(bad)).toThrow(/JSON/);
    expect(() =>
      validateAtmProjectSource(
        manifest(files, (value) => {
          const rows = value.resources as Record<string, unknown>[];
          rows[1]!.path = rows[0]!.path;
        }),
      ),
    ).toThrow();
    const changed = files.map((file) =>
      file.path.endsWith('/main.go')
        ? { ...file, bytes: Buffer.from(Buffer.from(file.bytes).toString() + '\n// injected') }
        : file,
    );
    expect(() => validateAtmProjectSource(changed)).toThrow();
    const repinned = manifest(changed, (value) => {
      for (const row of value.resources as Record<string, unknown>[]) {
        const file = changed.find((f) => f.path === directory + '/' + row.path)!;
        row.sha256 = sha256(file.bytes);
        row.bytes = file.bytes.byteLength;
      }
    });
    expect(() => validateAtmProjectSource(repinned)).toThrow(/approved public artifact/);
  });
  it.each(['', '../source-package.json', 'reporting-contract.json', null])(
    'actual loader rejects unsafe/ambiguous source_package %j',
    (path) => {
      const f = atmFixture();
      const files = f.files.map((file) =>
        file.path === folder + '/project.yaml'
          ? {
              ...file,
              bytes: Buffer.from(
                Buffer.from(file.bytes)
                  .toString()
                  .replace(
                    'source_package: source-package.json',
                    'source_package: ' + JSON.stringify(path),
                  ),
              ),
            }
          : file,
      );
      expect(() => parseCurriculum(files)).toThrow();
    },
  );
  it('does not invent resource limits and does not infer a pass prerequisite for scheduled access', () => {
    const f = atmFixture();
    const missing = f.files.map((file) =>
      file.path === folder + '/project.yaml'
        ? {
            ...file,
            bytes: Buffer.from(
              Buffer.from(file.bytes)
                .toString()
                .replace(/limits:\n[\s\S]*?judge:/, 'judge:'),
            ),
          }
        : file,
    );
    expect(() => parseCurriculum(missing)).toThrow();
    const legacy = loadGitCurriculum(repo);
    const hello = legacy.files.filter((file) => file.path.includes('/hello-go/'));
    const gated = f.files.map((file) =>
      file.path.endsWith('/manifest.yaml')
        ? {
            ...file,
            bytes: Buffer.from(
              Buffer.from(file.bytes)
                .toString()
                .replace(
                  'nodes:\n',
                  'nodes:\n  - id: hello-go\n    quest: fixture\n    type: challenge\n    title: Hello Go\n    order: 2\n    difficulty: 1\n',
                )
                .replace(
                  'edges: []',
                  'edges:\n  - from: hello-go\n    to: fixture-atm-project\n    rule: requires_pass',
                ),
            ),
          }
        : file,
    );
    expect(() => parseCurriculum([...gated, ...hello])).toThrow(/scheduled project/);
  });
  it('standalone filesystem reader refuses symlinks before following them', () => {
    const temp = mkdtempSync(join(tmpdir(), 'atm-source-only-'));
    try {
      const base = join(temp, directory);
      mkdirSync(base, { recursive: true });
      writeFileSync(join(base, 'README.md'), 'fixture');
      try {
        symlinkSync('README.md', join(base, 'unexpected-link.md'));
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM' && process.platform === 'win32') {
          return;
        }
        throw err;
      }
      expect(() => readLocalAtmProjectFiles(temp)).toThrow(/symlink/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it('leaves actual primary manifest at two nodes; source package is not an active or published project', () => {
    const old = loadGitCurriculum(repo);
    expect(old.curriculum.nodes.map((n) => n.key)).toEqual(['hello-go', 'even-or-odd']);
    expect(old.curriculum.nodes.every((n) => !n.projectSource)).toBe(true);
  });
});
