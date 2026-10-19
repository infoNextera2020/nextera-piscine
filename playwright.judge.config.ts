import base from './playwright.config';
import { defineConfig } from '@playwright/test';

const database = process.env.JUDGE_WEB_DATABASE_URL;
if (process.env.NEXTERA_JUDGE_E2E !== '1' || !database)
  throw new Error(
    'Protected local Judge E2E requires explicit opt-in and a separate fixture runtime.',
  );
const target = new URL(database);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.startsWith('/foundation_test')
)
  throw new Error('Judge E2E must use a disposable fixture database.');
export default defineConfig({
  ...base,
  testMatch:
    process.env.JUDGE_CHECKPOINT_E2E === '1'
      ? 'checkpoint-execution.spec.ts'
      : 'judge-execution.spec.ts',
  timeout: 180000,
  maxFailures: 1,
  globalTimeout: 1800000,
  webServer: {
    command: 'pnpm --filter @nextera/web start --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      DATABASE_URL: database,
      MIGRATION_DATABASE_URL: '',
      OPERATIONS_DATABASE_URL: '',
      MAINTENANCE_DATABASE_URL: '',
      SUPABASE_LOCAL_SERVICE_ROLE_KEY: '',
      SUPABASE_LOCAL_URL: '',
      JUDGE_DATABASE_URL: '',
      JUDGE_STORAGE_PUBLISHABLE_KEY: '',
      JUDGE_TEST_DATABASE_URL: '',
      JUDGE_WEB_DATABASE_URL: '',
      JUDGE_ARTIFACTS: '',
      JUDGE_CREDENTIALS: '',
      JUDGE_RUNNER_BINARY: '',
      NEXTERA_JUDGE_E2E: '',
      JUDGE_CHECKPOINT_E2E: '',
      DOCKER_HOST: '',
      DOCKER_CONFIG: '',
    },
  },
});
