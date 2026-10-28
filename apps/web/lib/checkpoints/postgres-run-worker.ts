import 'server-only';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import {
  claimVisibleRun,
  pulseVisibleRun,
  completeVisibleRun,
  listQueuedVisibleRuns,
} from '@nextera/db/visible-runs';
import {
  executeQueuedVisibleRun,
  type VisibleRunWorkerStore,
  type FencedPublicExecutor,
} from './visible-run-worker';

/** Real SQL calls only when explicitly invoked with a restricted worker DB; no connection/env/loop on import. */
export function createPostgresVisibleRunWorkerStore(
  db: OperationalDatabase,
): VisibleRunWorkerStore {
  return {
    claim(hint) {
      return claimVisibleRun(db, hint.runId, hint.scope);
    },
    pulse(lease, start) {
      return pulseVisibleRun(db, lease, start);
    },
    async complete({ lease, scope, outcome, stoppedProof }) {
      await completeVisibleRun(db, lease, scope, outcome.state, outcome.output, stoppedProof);
    },
  };
}
/** One explicitly bounded queue batch, not an enabled daemon. Never applies graded results. */
export async function executeVisibleRunBatch(input: {
  db: OperationalDatabase;
  batch: number;
  executor: FencedPublicExecutor;
  delay(ms: number, signal: AbortSignal): Promise<void>;
  shutdown?: AbortSignal;
}) {
  const hints = await listQueuedVisibleRuns(input.db, input.batch);
  const store = createPostgresVisibleRunWorkerStore(input.db),
    results = [];
  for (const hint of hints) {
    if (input.shutdown?.aborted) break;
    results.push(
      await executeQueuedVisibleRun(
        hint,
        {
          store,
          executor: input.executor,
          delay: input.delay,
        },
        input.shutdown,
      ),
    );
  }
  return results;
}
