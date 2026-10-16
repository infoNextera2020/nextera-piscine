import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['packages/db/tests/integration/**/*.test.ts'],
    fileParallelism: false,
    hookTimeout: 30000,
  },
});
