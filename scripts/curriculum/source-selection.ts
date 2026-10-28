import { readFileSync } from 'node:fs';

export class SourceSelectionError extends Error {}
const policy = JSON.parse(
  readFileSync(
    new URL('../../content/source-baselines/UPSTREAM_EXCLUSIONS.json', import.meta.url),
    'utf8',
  ),
) as {
  repository: string;
  excluded_questions: { path: string }[];
  requires_index_cleanup: { path: string }[];
};
function canonicalPath(path: string) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)+$/.test(path) ||
    path.split('/').some((part) => part === '.' || part === '..')
  )
    throw new SourceSelectionError('Unsafe upstream source path.');
  return path.toLowerCase();
}
const blocked = new Set(
  [...policy.excluded_questions, ...policy.requires_index_cleanup].map((item) =>
    canonicalPath(item.path),
  ),
);
/** Future raw reference imports must fail, not silently strip or reintroduce excluded questions.
 * A newly authored replacement requires its own reviewed local provenance, not a renamed raw import.
 */
export function assertAllowedReferenceSources(repository: string, paths: readonly string[]) {
  const origin = repository
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
  if (origin !== policy.repository.toLowerCase())
    throw new SourceSelectionError('Unreviewed source repository.');
  for (const path of paths)
    if (blocked.has(canonicalPath(path)))
      throw new SourceSelectionError('Excluded or unreviewed upstream source: ' + path);
}
/** Called only for files actually read as active curriculum, never historical baseline audits. */
export function assertActiveLearningText(text: string, path: string) {
  if (/\bz01\b/i.test(text))
    throw new SourceSelectionError(path + ': removed dependency is not allowed in active content.');
}
