import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Prepared combined0011+0014 suite. Requires its exact private-socket environment guard. */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['packages/db/tests/integration/checkpoint-draft-storage.test.ts'],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 10000,
  },
});
