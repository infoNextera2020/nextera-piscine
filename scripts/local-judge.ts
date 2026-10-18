/** Controlled local tooling only. Never run in the web deployment or print captured CLI secrets. */
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { assertLocalUrl } from './local-environment';

config({ quiet: true });
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    artifacts: { type: 'string' },
    output: { type: 'string' },
    database: { type: 'string' },
  },
});
let status: Record<string, string>;
try {
  status = JSON.parse(
    execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ) as Record<string, string>;
} catch {
  throw new Error('Local Supabase status unavailable.');
}
assertLocalUrl(status.API_URL!, '54321');
const command = positionals[0];
if (command === 'storage') {
  const admin = createClient(status.API_URL!, status.SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const existing = await admin.storage.getBucket('nextera-submissions');
  if (existing.data) {
    if (existing.data.public || existing.data.file_size_limit !== 262144)
      throw new Error('Existing bucket policy differs; review required.');
  } else {
    const { error } = await admin.storage.createBucket('nextera-submissions', {
      public: false,
      fileSizeLimit: 262144,
      allowedMimeTypes: ['application/octet-stream'],
    });
    if (error) throw new Error('Unable to create private local source bucket.');
  }
  console.info('Private immutable-upload source bucket ready.');
} else if (command === 'worker') {
  if (!values.artifacts || !values.output || !values.database)
    throw new Error('--artifacts, --output, --database required.');
  const database = new URL(values.database);
  if (
    !['localhost', '127.0.0.1'].includes(database.hostname) ||
    !database.pathname.startsWith('/foundation_test')
  )
    throw new Error('Disposable local foundation_test database required.');
  const artifacts = realpathSync(values.artifacts);
  mkdirSync(resolve(values.output), { recursive: true, mode: 0o700 });
  const output = realpathSync(resolve(values.output));
  const rel = relative(realpathSync(process.cwd()), output);
  if (
    !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) ||
    statSync(output).mode & 0o077
  )
    throw new Error('Private worker credential directory outside checkout required.');
  for (const name of ['storage-reader.jwt', 'runner.env', 'worker.json'])
    if (existsSync(join(output, name)))
      throw new Error('Use a fresh credential directory; existing files are never replaced.');
  if (!status.JWT_SECRET)
    throw new Error('Local legacy JWT signing secret unavailable; no hosted credential fallback.');
  const candidate = JSON.parse(readFileSync(join(artifacts, 'candidate.json'), 'utf8')) as {
    status: string;
    catalog: {
      test_packs: Record<
        string,
        {
          runner_image_digest: string;
          sandbox_image_digest: string;
          toolchain_version: string;
          resource_profile: string;
        }
      >;
    };
  };
  const entry = candidate.catalog.test_packs['hello-go-v1']!;
  if (candidate.status !== 'CANDIDATE' || !/^sha256:[0-9a-f]{64}$/.test(entry.runner_image_digest))
    throw new Error('Expected verified local candidate.');
  const name = `nextera_worker_${randomBytes(8).toString('hex')}`;
  const password = randomBytes(32).toString('hex');
  const workerId = randomUUID();
  const client = postgres(database.toString(), { max: 1, prepare: false, onnotice: () => {} });
  try {
    await client.begin(async (tx) => {
      await tx.unsafe(
        `CREATE ROLE ${name} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
      );
      await tx.unsafe(`GRANT nextera_runner TO ${name}`);
      await tx`INSERT INTO judge.workers(id,db_principal,runner_image_digest,protocol_versions,platform,capabilities)
        VALUES(${workerId},${name},${entry.runner_image_digest},ARRAY[1],'linux/amd64',${tx.json({ toolchain_version: entry.toolchain_version, resource_profile: entry.resource_profile, snapshot_format_version: 1, sandbox_image_digest: entry.sandbox_image_digest, fixture_cohort_ids: [] })})`;
    });
  } finally {
    await client.end();
  }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: workerId,
      role: 'authenticated',
      aud: 'authenticated',
      nextera_artifact_reader: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', status.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  const tokenFile = join(output, 'storage-reader.jwt');
  writeFileSync(tokenFile, `${header}.${payload}.${signature}`, { mode: 0o600, flag: 'wx' });
  database.username = name;
  database.password = password;
  const env = `JUDGE_DATABASE_URL=${database}\nJUDGE_STORAGE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY || status.ANON_KEY}\n`;
  writeFileSync(join(output, 'runner.env'), env, { mode: 0o600, flag: 'wx' });
  writeFileSync(
    join(output, 'worker.json'),
    JSON.stringify({
      worker_id: workerId,
      principal: name,
      runner_image_digest: entry.runner_image_digest,
      artifacts,
      token_file: tokenFile,
    }) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  console.info(
    'Scoped local worker credentials written outside the checkout (one-hour source-read token).',
  );
} else throw new Error('Use storage or worker.');
