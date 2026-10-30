import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import {
  CheckpointAnswerSubmissionStorageError,
  readCheckpointAnswerSubmissionContext,
  acceptCheckpointAnswer,
} from '@nextera/db/checkpoint-answer-submissions';
import { AnswerApiError, assertAnswerContext } from './answer-server-contract';
import type { AnswerSubmissionRepository } from './answer-submission';

export type PostgresAnswerSubmissionSettings = Readonly<{
  enabled: boolean;
  database: OperationalDatabase | null;
}>;
function contextFailure(error: unknown): never {
  if (error instanceof AnswerApiError) throw error;
  if (error instanceof CheckpointAnswerSubmissionStorageError) {
    const codes = {
      invalid_input: 'INVALID_ANSWER',
      forbidden: 'FORBIDDEN',
      closed: 'CLOSED',
      definition_mismatch: 'DEFINITION_MISMATCH',
      contract_mismatch: 'CONTRACT_MISMATCH',
      conflict: 'IDEMPOTENCY_CONFLICT',
      rate_limited: 'RATE_LIMITED',
      budget_exhausted: 'BUDGET_EXHAUSTED',
      unavailable: 'UNAVAILABLE',
    } as const;
    if (Object.hasOwn(codes, error.code)) throw new AnswerApiError(codes[error.code]);
  }
  throw new AnswerApiError('UNAVAILABLE');
}
/** Existing injected client only; construction opens nothing and enables no production route.
 * DRAFT0022 requires native verification plus a reviewed evaluator/result reconciliation path.
 */
export function createPostgresAnswerSubmissionRepository(
  settings: PostgresAnswerSubmissionSettings | null,
): AnswerSubmissionRepository | null {
  if (!settings?.enabled || !settings.database) return null;
  const db = settings.database;
  return {
    async context(actor, task) {
      const who = Object.freeze({ id: actor.id, authUserId: actor.authUserId });
      const target = Object.freeze({ attemptId: task.attemptId, taskKey: task.taskKey });
      try {
        const current = await readCheckpointAnswerSubmissionContext(db, who, target);
        assertAnswerContext(current, who, target);
        if (typeof current.submitAllowed !== 'boolean') throw new AnswerApiError('UNAVAILABLE');
        return Object.freeze({
          ...current,
          scope: Object.freeze({ ...current.scope }),
          answerContract: Object.freeze({ ...current.answerContract }),
        });
      } catch (error) {
        return contextFailure(error);
      }
    },
    // Query captures the complete data-only immutable intent before its first await.
    // Never turn an ambiguous database failure into a proved denial: service returns uncertain.
    accept(input) {
      return acceptCheckpointAnswer(db, input);
    },
  };
}
