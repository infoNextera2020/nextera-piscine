import { config } from 'dotenv';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { prepareLearningFixture, cleanupLearningFixture } from '../tests/fixtures/learning';
config({ path: '.env', quiet: true });
config({ path: 'apps/web/.env.local', quiet: true });
const assessment = process.argv.includes('--assessment');
const { path, fixture } = await prepareLearningFixture({ assessments: assessment });
await mkdir('.tools', { recursive: true });
await writeFile('.tools/ui001-current-fixture-path', path + '\n', { mode: 0o600 });
try {
  const run = execFile(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config',
      assessment ? 'playwright.assessment.config.ts' : 'playwright.learning.config.ts',
    ],
    { env: { ...process.env, LEARNING_UI_FIXTURE: path }, maxBuffer: 4 << 20 },
  );
  run.stdout?.pipe(process.stdout);
  run.stderr?.pipe(process.stderr);
  await new Promise<void>((resolve, reject) => {
    run.once('error', reject);
    run.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error('UI verification failed.')),
    );
  });
} finally {
  await cleanupLearningFixture(fixture);
}
