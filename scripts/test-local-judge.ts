import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';
const { values } = parseArgs({
  options: {
    credentials: { type: 'string' },
    artifacts: { type: 'string' },
    binary: { type: 'string' },
    grep: { type: 'string' },
  },
});
if (!values.credentials || !values.artifacts || !values.binary)
  throw new Error('--credentials, --artifacts, --binary required.');
const credentials = realpathSync(values.credentials);
const options = ['exec', 'playwright', 'test', '--config', 'playwright.judge.config.ts'];
if (values.grep) options.push('--grep', values.grep);
const result = spawnSync('pnpm', options, {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...parse(readFileSync(join(credentials, 'web.env'))),
    ...parse(readFileSync(join(credentials, 'application.env'))),
    NEXTERA_JUDGE_E2E: '1',
    JUDGE_CREDENTIALS: credentials,
    JUDGE_ARTIFACTS: realpathSync(values.artifacts),
    JUDGE_RUNNER_BINARY: realpathSync(values.binary),
  },
});
process.exitCode = result.status ?? 1;
