import 'server-only';
import { checkpointExamMarker, type DomainUser } from '@nextera/domain';
import { checkpointTaskContext } from '@nextera/db/checkpoints';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import { getDatabase, requireDomainUser } from '../auth/server';
import { createCheckpointAnswerApi } from './answer-api';
import { createPostgresAnswerDraftBackend } from './postgres-answer-drafts';
import { createPostgresAnswerSubmissionRepository } from './postgres-answer-submission';
import { createOfficialAnswerSubmission } from './answer-submission';
import {
  AnswerApiError,
  assertAnswerContext,
  assertAnswerWriteWindow,
  type AnswerServerContext,
} from './answer-server-contract';
import type { EditorActor, EditorTaskIdentity } from './editor-http';
import { sameEditorScope } from './editor-contract';

import { checkpointAnswerHttpPolicy } from './answer-http-policy';
export { checkpointAnswerHttpPolicy } from './answer-http-policy';

/** Lazy assembly only. Native frozen metadata supplies policy/evaluator identity per request.
 * Unknown/missing configuration or SQL readiness leaves the actual routes unavailable.
 */
export function configureCheckpointAnswerApi(deps: {
  authenticate(): Promise<DomainUser>;
  database(): OperationalDatabase;
  storage: unknown;
  httpPolicy: unknown;
}) {
  const bodyPolicy = checkpointAnswerHttpPolicy(deps.httpPolicy);
  const enabled = deps.storage === 'postgres-v1' && bodyPolicy !== null;
  async function gate(actor: EditorActor, task: EditorTaskIdentity, db: OperationalDatabase) {
    const native = await checkpointTaskContext(db, actor.authUserId, task.attemptId, task.taskKey);
    if (native.user_id !== actor.id) throw new AnswerApiError('FORBIDDEN');
    if (
      !checkpointExamMarker(native.scoredExam) ||
      native.submission?.authority !== 'checkpoint_answers_v1' ||
      !['trace_with_reason', 'debug_with_reason'].includes(native.answerFormat?.kind ?? '') ||
      !native.answerEvaluator ||
      !native.answerContract ||
      !native.officialAnswerPolicy
    )
      throw new AnswerApiError('UNAVAILABLE');
    return native;
  }
  async function draft(actor: EditorActor, task: EditorTaskIdentity) {
    const db = deps.database();
    await gate(actor, task, db);
    return createPostgresAnswerDraftBackend({ enabled: true, database: db })!;
  }
  async function bootstrap(actor: EditorActor, task: EditorTaskIdentity) {
    const db = deps.database();
    const native = await gate(actor, task, db);
    const backend = createPostgresAnswerDraftBackend({ enabled: true, database: db })!;
    const repository = createPostgresAnswerSubmissionRepository({ enabled: true, database: db })!;
    const current = await backend.context(actor, task);
    const official = await repository.context(actor, task);
    if (
      !sameEditorScope(current.scope, official.scope) ||
      current.answerContract.digest !== official.answerContract.digest ||
      current.answerContract.digest !== native.answerContract!.digest ||
      current.answerContract.kind !== native.answerFormat!.kind ||
      current.answerContract.maxBytes > bodyPolicy!.maxBodyBytes
    )
      throw new AnswerApiError('UNAVAILABLE');
    return Object.freeze({
      ...current,
      serverNow: official.serverNow,
      deadline: official.deadline,
      status: official.status,
      submitAllowed: official.submitAllowed && native.submission!.allowed,
    });
  }
  async function authorizeSubmission(actor: EditorActor, task: EditorTaskIdentity) {
    const db = deps.database();
    const native = await gate(actor, task, db);
    const repository = createPostgresAnswerSubmissionRepository({ enabled: true, database: db })!;
    const context = await repository.context(actor, task);
    assertAnswerContext(context, actor, task);
    assertAnswerWriteWindow(context);
    if (
      context.answerContract.digest !== native.answerContract!.digest ||
      context.answerContract.kind !== native.answerFormat!.kind ||
      context.answerContract.maxBytes > bodyPolicy!.maxBodyBytes
    )
      throw new AnswerApiError('UNAVAILABLE');
  }
  const drafts = !enabled
    ? null
    : {
        async context(actor: EditorActor, task: EditorTaskIdentity): Promise<AnswerServerContext> {
          return (await draft(actor, task)).context(actor, task);
        },
        async read(
          ...args: Parameters<
            NonNullable<ReturnType<typeof createPostgresAnswerDraftBackend>>['read']
          >
        ) {
          const [actor, scope] = args;
          return (await draft(actor, { attemptId: scope.attemptId, taskKey: scope.taskKey })).read(
            ...args,
          );
        },
        async save(
          input: Parameters<
            NonNullable<ReturnType<typeof createPostgresAnswerDraftBackend>>['save']
          >[0],
        ) {
          return (
            await draft(input.actor, {
              attemptId: input.scope.attemptId,
              taskKey: input.scope.taskKey,
            })
          ).save(input);
        },
      };
  const officialSubmission = !enabled
    ? null
    : {
        async submit(actor: EditorActor, command: unknown) {
          if (!command || typeof command !== 'object' || Array.isArray(command))
            throw new AnswerApiError('INVALID_ANSWER');
          const keys = [
            'attemptId',
            'taskKey',
            'requestId',
            'definitionDigest',
            'answerContractDigest',
            'answer',
          ];
          const descriptors = Object.getOwnPropertyDescriptors(command);
          if (
            Reflect.ownKeys(descriptors).length !== keys.length ||
            !keys.every(
              (key) => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key]!, 'value'),
            )
          )
            throw new AnswerApiError('INVALID_ANSWER');
          const input = Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
          if (!input.answer || typeof input.answer !== 'object' || Array.isArray(input.answer))
            throw new AnswerApiError('INVALID_ANSWER');
          const answerFields = Object.getOwnPropertyDescriptors(input.answer);
          if (
            Reflect.ownKeys(answerFields).some(
              (key) => typeof key !== 'string' || !Object.hasOwn(answerFields[key]!, 'value'),
            )
          )
            throw new AnswerApiError('INVALID_ANSWER');
          input.answer = Object.freeze(
            Object.fromEntries(
              Object.entries(answerFields).map(([key, field]) => [key, field.value]),
            ),
          );
          const captured = Object.freeze(input);
          if (typeof input.attemptId !== 'string' || typeof input.taskKey !== 'string')
            throw new AnswerApiError('INVALID_ANSWER');
          const task = { attemptId: input.attemptId, taskKey: input.taskKey };
          const db = deps.database();
          const native = await gate(actor, task, db);
          const repository = createPostgresAnswerSubmissionRepository({
            enabled: true,
            database: db,
          });
          // Native route is immutable and rechecked by0022 in its acceptance transaction.
          const service = createOfficialAnswerSubmission({
            enabled: true,
            repository,
            evaluators: [native.answerEvaluator!],
          });
          return service.submit(actor, captured);
        },
      };
  return createCheckpointAnswerApi({
    authenticate: deps.authenticate,
    drafts,
    officialSubmission,
    bodyPolicy,
    ...(enabled ? { bootstrap, authorizeSubmission } : {}),
  });
}

export const checkpointAnswerApi = configureCheckpointAnswerApi({
  authenticate: requireDomainUser,
  database: getDatabase,
  storage: process.env.CHECKPOINT_ANSWER_STORAGE,
  httpPolicy: process.env.CHECKPOINT_ANSWER_HTTP_POLICY_V1,
});
