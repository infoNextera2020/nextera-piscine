import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({
  root,
  resolve: {
    alias: {
      react: fileURLToPath(new URL('../apps/web/node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('../apps/web/node_modules/react-dom', import.meta.url)),
      next: fileURLToPath(new URL('../apps/web/node_modules/next', import.meta.url)),
    },
  },
  test: { include: ['tests/operator-*.test.ts'] },
});
