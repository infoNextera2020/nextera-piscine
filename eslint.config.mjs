import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [nextPlugin.configs['core-web-vitals']],
    settings: { next: { rootDir: 'apps/web/' } },
  },
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'next',
            'next/*',
            'react',
            'react/*',
            'react-dom',
            'react-dom/*',
            'drizzle-orm',
            'drizzle-orm/*',
            '@supabase/*',
            'fs',
            'fs/*',
            'node:fs',
            'node:fs/*',
            'child_process',
            'node:child_process',
            'dockerode',
            '@docker/*',
            '@nextera/db',
            '@nextera/db/*',
          ],
        },
      ],
    },
  },
  globalIgnores(['**/.next/**', '**/dist/**', '.tools/**', '.pnpm-store/**', '**/next-env.d.ts']),
]);
