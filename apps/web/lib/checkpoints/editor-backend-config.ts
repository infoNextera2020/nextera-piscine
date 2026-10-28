import 'server-only';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import type { CheckpointDraftBackend } from './editor-http';
import { createPostgresCheckpointDraftBackend } from './postgres-drafts';

/** Opt-in selects a prepared adapter, never authorizes data or bypasses SQL readiness/policy.
 * No database getter is invoked until an authenticated handler calls a method.
 */
export function configureCheckpointDraftBackend(
  setting: unknown,
  database: () => OperationalDatabase,
): CheckpointDraftBackend | null {
  if (setting !== 'postgres-v1') return null;
  return {
    context(actor, task) {
      return createPostgresCheckpointDraftBackend(database()).context(actor, task);
    },
    read(actor, scope, requestId) {
      return createPostgresCheckpointDraftBackend(database()).read(actor, scope, requestId);
    },
    save(input) {
      return createPostgresCheckpointDraftBackend(database()).save(input);
    },
  };
}
