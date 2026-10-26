import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Separate opt-in suite: never loads other integration tests or .env/URL fallbacks. */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['packages/db/tests/integration/checkpoint-draft-storage.test.ts'],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 10000,
  },
});
