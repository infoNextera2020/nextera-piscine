import { readFile } from 'node:fs/promises';
import { loadGitCurriculum } from './curriculum/load';
import { assessConnectedLearnerPlan } from './raid/learner-plan';

// No dotenv, DB/socket/service calls, credential reads, publication or seeded learner data.
const source = loadGitCurriculum(process.cwd());
const candidate = JSON.parse(
  await readFile(new URL('../infra/runner/catalog/candidate.json', import.meta.url), 'utf8'),
) as {
  status?: unknown;
  catalog?: { test_packs?: Record<string, { test_pack_artifact?: unknown }> };
};
const packs = Object.entries(candidate.catalog?.test_packs ?? {});
const plan = assessConnectedLearnerPlan(source.curriculum, [
  { nodeKey: 'hello-go', kind: 'challenge' },
  { nodeKey: 'even-or-odd', kind: 'challenge' },
  { nodeKey: 'transfer-checkpoint', kind: 'checkpoint' },
]);
// A Raid must be owner-selected content; no fabricated project key is inserted.
const missingArtifacts = packs
  .filter(([, value]) => typeof value.test_pack_artifact !== 'string' || !value.test_pack_artifact)
  .map(([key]) => key);
console.log(
  JSON.stringify(
    {
      mode: 'source-only',
      commit: source.gitCommitSha,
      curriculum: {
        key: source.curriculum.key,
        version: source.curriculum.version,
        contentDigest: source.curriculum.contentDigest,
        files: source.files.map((f) => f.path),
      },
      ...plan,
      catalog: {
        status: candidate.status,
        entries: packs.length,
        missingArtifactReferences: missingArtifacts,
      },
      fullJourneyReady: false,
      remainingGates: [
        'REVIEWED_PROJECT_DEFINITION_AND_PACK',
        'INVITATION_BACKEND_AND_POLICY',
        'ISOLATED_STACK_APPROVAL',
        'AUTH_STORAGE_DB_CORESIDENCE',
        'DRAFT_PERSISTENCE_INSTALLATION',
        'PUBLIC_RUN_EXECUTOR_AND_POLICY',
        'REAL_AUTHENTICATED_END_TO_END_EVIDENCE',
      ],
    },
    null,
    2,
  ),
);
