import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { reconcileCheckpoints } from '../packages/db/operations/checkpoints';
import { reconcileResults } from '../packages/db/operations/results';

if (!process.env.RESULT_APPLICATION_DATABASE_URL)
  throw new Error('RESULT_APPLICATION_DATABASE_URL required');
const client = postgres(process.env.RESULT_APPLICATION_DATABASE_URL, { max: 1, prepare: false });
const maintenance = process.env.MAINTENANCE_DATABASE_URL
  ? postgres(process.env.MAINTENANCE_DATABASE_URL, { max: 1, prepare: false })
  : null;
const repeat = !process.argv.includes('--once');
try {
  do {
    if (maintenance) await maintenance`SELECT judge.recover_expired(100)`;
    const outcomes = await reconcileResults(drizzle(client));
    const checkpoints = await reconcileCheckpoints(drizzle(client));
    for (const outcome of checkpoints)
      console.info(
        JSON.stringify({
          event: 'checkpoint_reconciliation',
          attempt_id: outcome.id,
          status: outcome.status,
        }),
      );
    for (const outcome of outcomes)
      console.info(
        JSON.stringify({
          event: 'result_reconciliation',
          result_id: outcome.id,
          status: outcome.status,
          pending_age_ms: outcome.pending_age_ms,
        }),
      );
    if (process.argv.includes('--once')) {
      if ([...outcomes, ...checkpoints].some((outcome) => outcome.status === 'attention_required'))
        process.exitCode = 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 60000));
  } while (repeat);
} finally {
  await client.end();
  await maintenance?.end();
}
