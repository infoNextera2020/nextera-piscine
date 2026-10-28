import 'server-only';
import type { CheckpointRunBackend } from './editor-http';
import { getDatabase, requireDomainUser } from '../auth/server';
import { createCheckpointEditorApi } from './editor-api';

/** Shared lazy HTTP assembly. Existing explicit storage opt-in still requires SQL/policy. */
export const checkpointEditorApi = createCheckpointEditorApi({
  authenticate: requireDomainUser,
  database: getDatabase,
  draftStorage: process.env.CHECKPOINT_DRAFT_STORAGE,
});
export const checkpointDraftBackend = checkpointEditorApi.draftBackend;
export const checkpointOfficialSubmitAuthority = checkpointEditorApi.officialSubmission;
/** Persistence alone cannot authorize execution. No visible-example worker/policy is enabled. */
export const checkpointRunBackend: CheckpointRunBackend | null = null;
