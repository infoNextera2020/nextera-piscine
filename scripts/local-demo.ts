/** Persistent, isolated local UI fixtures; never publishes the real curriculum. */
import { config } from 'dotenv';
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { enrollLearner } from '../packages/db/operations/cohorts';
import * as schema from '../packages/db/schema/index';
import { prepareLearningFixture, type LearningFixture } from '../tests/fixtures/learning';

config({ path: '.env', quiet: true });
config({ path: 'apps/web/.env.local', quiet: true });
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { 'auth-user-id': { type: 'string' } },
});
const state = '.tools/local-demo.json';
if (positionals[0] === 'prepare') {
  const authId = values['auth-user-id'];
  if (!authId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(authId))
    throw new Error('Supply your existing local Auth UUID with --auth-user-id.');
  try {
    await readFile(state);
    throw new Error(
      'A demo already exists. Use pnpm local:demo; settings are in .tools/local-demo.json.',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const authUrl = process.env.SUPABASE_LOCAL_URL!;
  if (new URL(authUrl).hostname !== '127.0.0.1') throw new Error('Local Auth required.');
  const auth = createClient(authUrl, process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await auth.auth.admin.getUserById(authId);
  if (error || !data.user) throw new Error('Existing local Auth account not found.');
  const { fixture } = await prepareLearningFixture({ assessments: true });
  const db = postgres(fixture.database, { max: 1, prepare: false });
  try {
    await db.unsafe('INSERT INTO auth.users(id) VALUES($1)', [authId]);
    const [user] = await db.unsafe(
      'INSERT INTO app.users(auth_user_id,display_name) VALUES($1,$2) RETURNING id',
      [authId, String(data.user.user_metadata?.display_name ?? 'Demo learner')],
    );
    await enrollLearner(drizzle(db, { schema }), fixture.cohort, String(user!.id));
    await db.unsafe('UPDATE app.cohorts SET name=$1 WHERE id=$2', [
      'Local demo · sample curriculum',
      fixture.cohort,
    ]);
    await mkdir('.tools', { recursive: true });
    await writeFile(state, JSON.stringify(fixture), { mode: 0o600, flag: 'wx' });
    console.info('Demo ready. Run pnpm local:demo and sign in with your existing local account.');
    console.info('Separate sample database; real curriculum and catalog unchanged.');
  } finally {
    await db.end();
  }
} else if (positionals[0] === 'start') {
  const fixture = JSON.parse(await readFile(state, 'utf8')) as LearningFixture;
  const target = new URL(fixture.webDatabase);
  if (target.hostname !== '127.0.0.1' || !target.pathname.startsWith('/foundation_test_ui001_'))
    throw new Error('Isolated local demo database required.');
  console.info('Local sample portal: http://127.0.0.1:3103 — use your existing local account.');
  console.info(
    'Sample result accounts and password are stored privately in .tools/local-demo.json.',
  );
  console.info(
    'Fixture outcomes are seeded examples. Live Judge execution is not configured for this demo.',
  );
  const child = spawn(
    'pnpm',
    ['--filter', '@nextera/web', 'dev', '--hostname', '127.0.0.1', '--port', '3103'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
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
  );
  child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  throw new Error('Use prepare --auth-user-id UUID or start.');
}
