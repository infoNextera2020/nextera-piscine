import 'server-only';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import {
  CheckpointEditorContextError,
  readCheckpointEditorContext,
} from '@nextera/db/checkpoint-editor-context';
import { EditorApiError, type CheckpointOfficialSubmitAuthority } from './editor-http';

/** Lazy read-only authority. Import/configuration opens no database connection. Missing0014 fails closed. */
export function createPostgresCheckpointOfficialSubmitAuthority(
  database: () => OperationalDatabase,
): CheckpointOfficialSubmitAuthority {
  return {
    async context(actor, task) {
      try {
        const value = await readCheckpointEditorContext(
          database(),
          actor.authUserId,
          task.attemptId,
          task.taskKey,
        );
        if (value.scope.learnerId !== actor.id) throw new EditorApiError('FORBIDDEN');
        return value;
      } catch (error) {
        if (error instanceof EditorApiError) throw error;
        throw new EditorApiError(
          error instanceof CheckpointEditorContextError && error.code === 'forbidden'
            ? 'FORBIDDEN'
            : 'UNAVAILABLE',
        );
      }
    },
  };
}
