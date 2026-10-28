import 'server-only';
import type { CheckpointRunBackend } from './editor-http';
import { getDatabase } from '../auth/server';
import { configureCheckpointDraftBackend } from './editor-backend-config';
import { createPostgresCheckpointOfficialSubmitAuthority } from './postgres-editor-context';

/** No connection on import. Explicit storage opt-in still requires SQL0011 readiness/policy. */
export const checkpointDraftBackend = configureCheckpointDraftBackend(
  process.env.CHECKPOINT_DRAFT_STORAGE,
  getDatabase,
);
/** Read-only metadata fails closed unless the separately reviewed0014 function is installed. */
export const checkpointOfficialSubmitAuthority =
  createPostgresCheckpointOfficialSubmitAuthority(getDatabase);
/** Persistence alone cannot authorize execution. No visible-example worker/policy is enabled. */
export const checkpointRunBackend: CheckpointRunBackend | null = null;
