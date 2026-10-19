/** Disposable database probe: each invocation is a fresh trusted server read process. */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readCheckpoint } from '../../packages/db/queries/checkpoints';
const target = new URL(process.env.CHECKPOINT_PROBE_DATABASE_URL!);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.startsWith('/foundation_test')
)
  throw new Error('Disposable fixture required');
const client = postgres(target.toString(), { max: 1, prepare: false, onnotice: () => {} });
try {
  const view = await readCheckpoint(
    drizzle(client),
    process.env.CHECKPOINT_PROBE_AUTH!,
    process.env.CHECKPOINT_PROBE_COHORT!,
    'transfer-checkpoint',
  );
  const a = view.attempt;
  console.info(
    JSON.stringify(a ? { id: a.id, started_at: a.started_at, deadline_at: a.deadline_at } : null),
  );
} finally {
  await client.end();
}
