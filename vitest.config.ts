import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: [
      'packages/domain/tests/**/*.test.ts',
      'scripts/curriculum/tests/**/*.test.ts',
      'packages/db/tests/schema.test.ts',
      'packages/db/tests/raid-readiness.test.ts',
      'packages/db/tests/checkpoint-drafts.test.ts',
      'packages/db/tests/checkpoint-answer-drafts.test.ts',
      'packages/db/tests/checkpoint-answer-draft-proposal.test.ts',
      'packages/db/tests/checkpoint-answer-submissions.test.ts',
      'packages/db/tests/checkpoint-answer-submission-proposal.test.ts',
      'packages/db/tests/quest-reviews.test.ts',
      'packages/db/tests/checkpoint-editor-context.test.ts',
      'packages/db/tests/checkpoint-policy-v2.test.ts',
      'packages/db/tests/visible-runs.test.ts',
      'packages/db/tests/checkpoint-draft-proposal.test.ts',
      'packages/db/tests/raid-readiness-state.test.ts',
      'scripts/raid/*.test.ts',
      'apps/web/app/api/health/route.test.ts',
      'apps/web/lib/submissions/*.test.ts',
      'apps/web/lib/checkpoints/*.test.ts',
      'apps/web/lib/learning/*.test.ts',
      'apps/web/lib/raids/*.test.ts',
      'apps/web/lib/invitations/*.test.ts',
    ],
  },
});
