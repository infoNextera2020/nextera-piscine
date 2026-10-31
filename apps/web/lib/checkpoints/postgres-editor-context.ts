import 'server-only';
import { checkpointExamMarker } from '@nextera/domain';
import { checkpointAnswerHttpPolicy } from './answer-http-policy';
import { scoredExamCodeStoragePolicy } from './scored-exam-code-upload';
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
        if (checkpointExamMarker(value.scoredExam)) {
          const policy = checkpointAnswerHttpPolicy(process.env.CHECKPOINT_ANSWER_HTTP_POLICY_V1);
          if (!policy || policy.maxBodyBytes < value.sourceBytes)
            throw new EditorApiError('UNAVAILABLE');
          // Read/draft authority remains independent from NEW-upload readiness.
          // A retained exact official retry does not use this new-submit hint.
          return Object.freeze({
            ...value,
            submitAllowed:
              value.submitAllowed &&
              scoredExamCodeStoragePolicy(process.env.CHECKPOINT_SCORED_CODE_STORAGE_POLICY_V1) !==
                null,
          });
        }
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
