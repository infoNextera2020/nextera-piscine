import { readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';
import type { LearningFixture } from './tests/fixtures/learning';
config({ path: '.env', quiet: true });
if (!process.env.LEARNING_UI_FIXTURE)
  throw new Error('Use pnpm test:learning to prepare isolated local fixtures.');
const fixture = JSON.parse(
  readFileSync(process.env.LEARNING_UI_FIXTURE, 'utf8'),
) as LearningFixture;
const target = new URL(fixture.database);
if (target.hostname !== '127.0.0.1' || !target.pathname.startsWith('/foundation_test_ui001_'))
  throw new Error('Isolated local UI fixture required.');
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'learning-surfaces.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:3102', browserName: 'chromium', trace: 'off' },
  webServer: {
    command: 'pnpm --filter @nextera/web start --hostname 127.0.0.1 --port 3102',
    url: 'http://127.0.0.1:3102/api/health',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      DATABASE_URL: fixture.webDatabase,
      NEXT_PUBLIC_SUPABASE_URL: fixture.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fixture.publishableKey,
      MIGRATION_DATABASE_URL: '',
      OPERATIONS_DATABASE_URL: '',
      MAINTENANCE_DATABASE_URL: '',
      RESULT_APPLICATION_DATABASE_URL: '',
      RESULT_APPLICATION_SERVICE_TOKEN: '',
      SUPABASE_LOCAL_SERVICE_ROLE_KEY: '',
      SUPABASE_LOCAL_URL: '',
    },
  },
});
