import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';
import { assertLocalUrl } from './scripts/local-environment';

config({ path: '.env', quiet: true });
config({ path: 'apps/web/.env.local', quiet: true });
if (
  !process.env.SUPABASE_LOCAL_URL ||
  !process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ||
  !process.env.MIGRATION_DATABASE_URL
) {
  throw new Error('Auth E2E requires the local Supabase environment. Run local setup first.');
}
assertLocalUrl(process.env.SUPABASE_LOCAL_URL, '54321');
assertLocalUrl(process.env.MIGRATION_DATABASE_URL, '54322');

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3100', browserName: 'chromium', trace: 'off' },
  // Do not reuse a developer server that might point at a different database.
  webServer: {
    env: {
      MIGRATION_DATABASE_URL: '',
      OPERATIONS_DATABASE_URL: '',
      MAINTENANCE_DATABASE_URL: '',
      SUPABASE_LOCAL_SERVICE_ROLE_KEY: '',
      SUPABASE_LOCAL_URL: '',
    },
    command: 'pnpm --filter @nextera/web start --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
