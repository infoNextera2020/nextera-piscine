import 'server-only';
import type { CheckpointDraftBackend, CheckpointRunBackend } from './editor-http';

/** No memory/mock/environment-flag fallback in production. Storage/executor are not installed. */
export const checkpointDraftBackend: CheckpointDraftBackend | null = null;
export const checkpointRunBackend: CheckpointRunBackend | null = null;
