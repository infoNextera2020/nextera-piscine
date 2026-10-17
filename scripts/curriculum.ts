import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { importCurriculum } from '@nextera/db/operations/curriculum';
import { root } from './local-environment';
import { loadGitCurriculum } from './curriculum/load';
import { parseEvaluationCatalog, resolveEvaluations } from './curriculum/evaluation';
import { withOperations } from './operations';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { ref: { type: 'string', default: 'HEAD' }, catalog: { type: 'string' } },
});
const mode = positionals[0];
if (positionals.length !== 1 || !['validate', 'draft', 'publish'].includes(mode!))
  throw new Error(
    'Use curriculum:validate, curriculum:import, or curriculum:publish [--ref <commit>] [--catalog <protected-json>].',
  );
const { curriculum, gitCommitSha } = loadGitCurriculum(root, values.ref);
console.info(
  `Validated ${curriculum.key}@${curriculum.version}: ${curriculum.nodes.length} nodes; roots: ${curriculum.roots.join(', ')}; SHA-256 ${curriculum.contentDigest}; commit ${gitCommitSha}.`,
);
if (mode === 'validate') {
  console.info('Content is valid. Publication separately requires approved evaluation metadata.');
} else {
  const evaluations =
    mode === 'publish'
      ? resolveEvaluations(
          curriculum,
          values.catalog ? parseEvaluationCatalog(readFileSync(values.catalog, 'utf8')) : undefined,
        )
      : undefined;
  const version = await withOperations((db) =>
    importCurriculum(db, curriculum, gitCommitSha, evaluations),
  );
  console.info(
    `${version.status.toUpperCase()} ${version.id}. ${version.status === 'draft' ? 'Validated source receipt only; no node projection, cohort pinning, or enrollment is permitted.' : 'Immutable curriculum projection available for controlled cohort creation.'}`,
  );
}
