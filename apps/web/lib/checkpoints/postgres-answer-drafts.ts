import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import {
  CheckpointAnswerDraftStorageError,
  readCheckpointAnswerDraftContext,
  readCheckpointAnswerDraft,
  saveCheckpointAnswerDraft,
} from '@nextera/db/checkpoint-answer-drafts';
import { sameEditorScope, type EditorScope } from './editor-contract';
import type { EditorActor, EditorTaskIdentity } from './editor-http';
import {
  AnswerApiError,
  assertAnswerContext,
  assertAnswerDraft,
  prepareAnswer,
  type AnswerServerContext,
  type CheckpointAnswerDraftBackend,
} from './answer-server-contract';
export type PostgresAnswerDraftSettings = Readonly<{
  enabled: boolean;
  database: OperationalDatabase | null;
}>;
function mapped(error: unknown): never {
  if (error instanceof AnswerApiError) throw error;
  if (error instanceof CheckpointAnswerDraftStorageError) {
    const codes = {
      forbidden: 'FORBIDDEN',
      closed: 'CLOSED',
      definition_mismatch: 'DEFINITION_MISMATCH',
      idempotency_conflict: 'IDEMPOTENCY_CONFLICT',
      storage_limit: 'STORAGE_LIMIT',
    } as const;
    if (Object.hasOwn(codes, error.code))
      throw new AnswerApiError(codes[error.code as keyof typeof codes]);
  }
  throw new AnswerApiError('UNAVAILABLE');
}
/** Injected existing client only. Construction opens no connection and configures no schema/policy.
 * DRAFT0021 native parity/readiness is unverified; production assembly below stays disabled.
 */
export function createPostgresAnswerDraftBackend(
  settings: PostgresAnswerDraftSettings | null,
): CheckpointAnswerDraftBackend | null {
  if (!settings?.enabled || !settings.database) return null;
  const db = settings.database;
  async function context(
    actor: EditorActor,
    task: EditorTaskIdentity,
  ): Promise<AnswerServerContext> {
    try {
      const result = await readCheckpointAnswerDraftContext(
        db,
        actor.authUserId,
        task.attemptId,
        task.taskKey,
      );
      assertAnswerContext(result, actor, task);
      return Object.freeze({
        ...result,
        scope: Object.freeze({ ...result.scope }),
        answerContract: Object.freeze({ ...result.answerContract }),
      });
    } catch (error) {
      return mapped(error);
    }
  }
  function bound(current: AnswerServerContext, scope: EditorScope, digest: string) {
    if (!sameEditorScope(current.scope, scope)) throw new AnswerApiError('DEFINITION_MISMATCH');
    if (current.answerContract.digest !== digest) throw new AnswerApiError('CONTRACT_MISMATCH');
  }
  return {
    context,
    async read(actor, scope, contractDigest, requestId) {
      try {
        const who = Object.freeze({ ...actor }),
          binding = Object.freeze({ ...scope });
        const current = await context(who, {
          attemptId: binding.attemptId,
          taskKey: binding.taskKey,
        });
        bound(current, binding, contractDigest);
        const record = await readCheckpointAnswerDraft(
          db,
          who.authUserId,
          binding,
          contractDigest,
          requestId,
        );
        if (record) assertAnswerDraft(record, current);
        return record;
      } catch (error) {
        return mapped(error);
      }
    },
    async save(input) {
      try {
        // Capture all primitives before context I/O; no later caller edit can replace this intent.
        const who = Object.freeze({ ...input.actor }),
          scope = Object.freeze({ ...input.scope });
        const { answerContractDigest, requestId, baseVersion, payload, sha256, byteLength } = input;
        const current = await context(who, { attemptId: scope.attemptId, taskKey: scope.taskKey });
        bound(current, scope, answerContractDigest);
        const prepared = prepareAnswer(JSON.parse(payload), current);
        if (
          prepared.payload !== payload ||
          prepared.sha256 !== sha256 ||
          prepared.byteLength !== byteLength
        )
          throw new AnswerApiError('INVALID_ANSWER');
        const result = await saveCheckpointAnswerDraft(db, {
          authId: who.authUserId,
          scope,
          answerContractDigest,
          requestId,
          baseVersion,
          payload,
          sha256,
          byteLength,
        });
        if (result.kind === 'saved') {
          assertAnswerDraft(result.record, current);
          if (
            result.record.requestId !== requestId ||
            result.record.payload !== payload ||
            result.record.version !== baseVersion + 1
          )
            throw new AnswerApiError('UNAVAILABLE');
        } else assertAnswerDraft(result.current, current);
        return result;
      } catch (error) {
        return mapped(error);
      }
    },
  };
}
