import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import {
  evaluateRaidReadiness,
  type RaidReadinessFacts,
} from '../packages/db/queries/raid-readiness-state';
import { RAID_READINESS_SQL } from '../packages/db/queries/raid-readiness';
import {
  assertRehearsalTemplates,
  assertRehearsalDatabaseTarget,
  parseExampleEnvironment,
  type RaidRehearsalPlan,
} from './raid/rehearsal';

// No dotenv, service commands, credentials generation, role creation or migrations.
const { values } = parseArgs({
  options: { 'check-config': { type: 'boolean' }, database: { type: 'boolean' } },
});
if (values.database && values['check-config']) throw new Error('Choose one preflight mode.');
const folder = new URL('../infra/raid-rehearsal/', import.meta.url);
const [planText, compose, example] = await Promise.all(
  ['plan.json', 'compose.rehearsal.override.yml', 'environment.example'].map((name) =>
    readFile(new URL(name, folder), 'utf8'),
  ),
);
const plan = JSON.parse(planText!) as RaidRehearsalPlan;
const prepared = assertRehearsalTemplates(plan, compose!, example!);
if (!values.database) {
  console.log(
    JSON.stringify(
      {
        mode: 'code-only-configuration',
        ...prepared,
        database: plan.database,
        api: plan.api_url,
        requiredFutureApprovals: plan.required_future_approvals,
      },
      null,
      2,
    ),
  );
} else {
  const value = process.env.RAID_PREFLIGHT_DATABASE_URL;
  if (!value)
    throw new Error(
      'Explicit RAID_PREFLIGHT_DATABASE_URL required; retained .env is never loaded.',
    );
  assertRehearsalDatabaseTarget(value, plan);
  const client = postgres(value, {
    max: 1,
    prepare: false,
    connect_timeout: 3,
    onnotice: () => {},
    connection: {
      default_transaction_read_only: true,
      statement_timeout: 3000,
      lock_timeout: 500,
    },
  });
  try {
    const [row] = await client.begin('read only', (tx) => tx.unsafe(RAID_READINESS_SQL));
    const env = parseExampleEnvironment(example!);
    const readiness = evaluateRaidReadiness(row ? (row as unknown as RaidReadinessFacts) : null, {
      databaseName: env.RAID_STORAGE_DATABASE_NAME,
      storageApiUrl: env.RAID_STORAGE_API_URL,
      applicationApiUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    });
    console.log(
      JSON.stringify(
        { mode: 'read-only-database', database: plan.database, ...readiness },
        null,
        2,
      ),
    );
    if (!readiness.ready) process.exitCode = 1;
  } catch {
    console.error(
      JSON.stringify({
        ready: false,
        reason: 'read_only_probe_unavailable',
        liveStorageVerified: false,
      }),
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
