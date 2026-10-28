import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertActiveLearningText, assertAllowedReferenceSources } from '../source-selection';
import { parseCurriculum } from '../load';
import { testCurriculum } from '../../../tests/fixtures/curriculum';
const source = 'https://github.com/Anasmoner2022/piscine-go';
const base = new URL('../../../content/source-baselines/', import.meta.url);
const policy = JSON.parse(readFileSync(new URL('UPSTREAM_EXCLUSIONS.json', base), 'utf8')) as {
  excluded_questions: { path: string }[];
  requires_index_cleanup: { path: string }[];
};
describe('Reviewed raw source exclusions and active learning content', () => {
  it.each([...policy.excluded_questions, ...policy.requires_index_cleanup])(
    'blocks excluded question/index $path before a future raw import',
    ({ path }) => {
      expect(() => assertAllowedReferenceSources(source, [path])).toThrow();
      expect(() =>
        assertAllowedReferenceSources(source.toLowerCase(), [path.toLowerCase()]),
      ).toThrow();
    },
  );
  it('retains the complete 14-question exclusion set and separately flags the index', () => {
    expect(policy.excluded_questions).toHaveLength(14);
    expect(policy.requires_index_cleanup).toEqual([
      { path: 'Quest8/README.md', removed_entry: 'boolean / bool.md' },
    ]);
  });
  it.each([
    '../Quest2/printcomb.md',
    '/Quest2/printcomb.md',
    'Quest2\\printcomb.md',
    'Quest2/%70rintcomb.md',
    'Quest2/../Quest3/test.md',
  ])('does not accept ambiguous source path %s', (path) =>
    expect(() => assertAllowedReferenceSources(source, [path])).toThrow(),
  );
  it('does not silently grant an unrelated source or reject an otherwise eligible referenced path', () => {
    expect(() =>
      assertAllowedReferenceSources('https://github.com/another/repository', [
        'Quest3/pointone.md',
      ]),
    ).toThrow();
    expect(() => assertAllowedReferenceSources(source, ['Quest3/pointone.md'])).not.toThrow();
  });
  it.each(['z01.PrintRune(r)', 'github.com/01-edu/z01', 'Z01 reference'])(
    'rejects a removed-library reference in active learner text: %s',
    (text) => {
      expect(() => assertActiveLearningText(text, 'active/subject.md')).toThrow();
    },
  );
  it('enforces removal through the actual active curriculum parser', () => {
    const f = testCurriculum();
    const files = f.files.map((file) =>
      file.path.endsWith('/hello-go/subject.md')
        ? { ...file, bytes: Buffer.from('Use z01.PrintRune for output.') }
        : file,
    );
    expect(() => parseCurriculum(files)).toThrow('removed dependency');
    expect(() => parseCurriculum(f.files)).not.toThrow();
  });
  it('keeps original reference files byte-preserved and the latest seven-task baseline unpublished', () => {
    const root = new URL('quest2-standard-go-v3/', base);
    const provenance = JSON.parse(readFileSync(new URL('PROVENANCE.json', root), 'utf8'));
    expect(provenance.library_version).toBe(2);
    expect(provenance.approved_activities).toHaveLength(7);
    expect(provenance.published).toBe(false);
    expect(provenance.machine_contracts_enabled).toBe(false);
    for (const name of ['q2-learner-en.md', 'review-question-bank.md'])
      expect(() =>
        assertActiveLearningText(readFileSync(new URL(name, root), 'utf8'), name),
      ).not.toThrow();
    expect(readFileSync(new URL('source-map.md', root), 'utf8')).toContain('HISTORICAL AUDIT ONLY');
  });
});
