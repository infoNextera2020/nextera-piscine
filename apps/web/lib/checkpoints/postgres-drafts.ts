import 'server-only';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import {
  CheckpointDraftStorageError,
  encodeCheckpointDraft,
  readCheckpointDraftContext,
  readCheckpointDraft,
  saveCheckpointDraft,
} from '@nextera/db/checkpoint-drafts';
import { EditorApiError, type CheckpointDraftBackend, type EditorActor } from './editor-http';

/** Prepared adapter only. editor-backends.ts deliberately does not instantiate it. */
export function createPostgresCheckpointDraftBackend(
  db: OperationalDatabase,
): CheckpointDraftBackend {
  async function call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof CheckpointDraftStorageError) {
        const code =
          error.code === 'forbidden'
            ? 'FORBIDDEN'
            : error.code === 'closed'
              ? 'CLOSED'
              : error.code === 'definition_mismatch'
                ? 'DEFINITION_MISMATCH'
                : error.code === 'idempotency_conflict'
                  ? 'IDEMPOTENCY_CONFLICT'
                  : 'UNAVAILABLE';
        throw new EditorApiError(code);
      }
      throw error;
    }
  }
  function own(actor: EditorActor, learnerId: string) {
    if (actor.id.toLowerCase() !== learnerId.toLowerCase()) throw new EditorApiError('FORBIDDEN');
  }
  return {
    async context(actor, task) {
      return call(async () => {
        const context = await readCheckpointDraftContext(
          db,
          actor.authUserId,
          task.attemptId,
          task.taskKey,
        );
        own(actor, context.scope.learnerId);
        return context;
      });
    },
    async read(actor, scope, requestId) {
      own(actor, scope.learnerId);
      return call(() => readCheckpointDraft(db, actor.authUserId, scope, requestId));
    },
    async save(input) {
      own(input.actor, input.scope.learnerId);
      return call(async () => {
        const encoded = encodeCheckpointDraft(input.source);
        if (encoded.sha256 !== input.sha256 || encoded.byteLength !== input.byteLength)
          throw new EditorApiError('UNAVAILABLE');
        return saveCheckpointDraft(db, {
          authId: input.actor.authUserId,
          scope: input.scope,
          requestId: input.requestId,
          baseVersion: input.baseVersion,
          source: input.source,
        });
      });
    },
  };
}
