import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: [
      'packages/domain/tests/**/*.test.ts',
      'scripts/curriculum/tests/**/*.test.ts',
      'packages/db/tests/schema.test.ts',
      'apps/web/app/api/health/route.test.ts',
      'apps/web/lib/submissions/*.test.ts',
    ],
  },
});
