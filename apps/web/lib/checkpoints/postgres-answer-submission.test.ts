import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
const queries = vi.hoisted(() => ({ context: vi.fn(), accept: vi.fn() }));
vi.mock('@nextera/db/checkpoint-answer-submissions', async (original) => ({
  ...(await original<typeof import('@nextera/db/checkpoint-answer-submissions')>()),
  readCheckpointAnswerSubmissionContext: queries.context,
  acceptCheckpointAnswer: queries.accept,
}));
import { CheckpointAnswerSubmissionStorageError } from '@nextera/db/checkpoint-answer-submissions';
import { createPostgresAnswerSubmissionRepository } from './postgres-answer-submission';
import { answerContractDigest, prepareAnswer } from './answer-server-contract';
import {
  createOfficialAnswerSubmission,
  type OfficialAnswerContext,
  type AnswerEvaluatorRoute,
  type OfficialAnswerWrite,
} from './answer-submission';
const actor = {
  id: '00000000-0000-4000-8000-000000000001',
  authUserId: '00000000-0000-4000-8000-000000000002',
};
const scope = {
  learnerId: actor.id,
  cohortId: '00000000-0000-4000-8000-000000000003',
  attemptId: '00000000-0000-4000-8000-000000000004',
  taskKey: 'trace-task',
  definitionDigest: 'a'.repeat(64),
};
const format = { version: 1 as const, kind: 'trace_with_reason' as const, maxBytes: 2048 };
const context: OfficialAnswerContext = {
  scope,
  readAllowed: true,
  status: 'active',
  serverNow: '2026-10-30T12:00:00Z',
  deadline: '2026-10-30T13:00:00Z',
  answerContract: { ...format, digest: answerContractDigest(scope, format) },
  submitAllowed: true,
};
const evaluator: AnswerEvaluatorRoute = {
  family: 'checkpoint_structured_answer',
  version: 1,
  kind: format.kind,
  definitionDigest: scope.definitionDigest,
  taskKey: scope.taskKey,
  evaluatorKey: 'reviewed-fixture',
  evaluatorDigest: 'b'.repeat(64),
};
const answer = {
  version: 1 as const,
  kind: format.kind,
  output: 'exact\r\n\u0000',
  reason: 'A reason',
};
const requestId = '00000000-0000-4000-8000-000000000005';
const db = { execute: vi.fn() } as unknown as OperationalDatabase;
beforeEach(() => {
  vi.resetAllMocks();
  queries.context.mockResolvedValue(context);
  queries.accept.mockResolvedValue({ kind: 'budget_exhausted' });
});
describe('typed official app repository — fake query port only', () => {
  it('opens nothing during construction and stays absent without explicit client/enablement', () => {
    expect(createPostgresAnswerSubmissionRepository(null)).toBeNull();
    expect(createPostgresAnswerSubmissionRepository({ enabled: false, database: db })).toBeNull();
    expect(createPostgresAnswerSubmissionRepository({ enabled: true, database: null })).toBeNull();
    expect(
      createPostgresAnswerSubmissionRepository({ enabled: true, database: db }),
    ).not.toBeNull();
    expect(queries.context).not.toHaveBeenCalled();
    expect(queries.accept).not.toHaveBeenCalled();
  });
  it('binds both application and provider identity, freezes server context', async () => {
    const target = { attemptId: scope.attemptId, taskKey: scope.taskKey };
    const value = await createPostgresAnswerSubmissionRepository({
      enabled: true,
      database: db,
    })!.context(actor, target);
    expect(queries.context).toHaveBeenCalledWith(db, actor, target);
    expect(Object.isFrozen(value.scope)).toBe(true);
    expect(Object.isFrozen(value.answerContract)).toBe(true);
  });
  it.each(['identity', 'allowance'] as const)('rejects malformed %s authority', async (change) => {
    queries.context.mockResolvedValueOnce(
      change === 'identity'
        ? { ...context, scope: { ...scope, learnerId: actor.authUserId } }
        : { ...context, submitAllowed: undefined },
    );
    await expect(
      createPostgresAnswerSubmissionRepository({ enabled: true, database: db })!.context(actor, {
        attemptId: scope.attemptId,
        taskKey: scope.taskKey,
      }),
    ).rejects.toMatchObject({ code: change === 'identity' ? 'FORBIDDEN' : 'UNAVAILABLE' });
    expect(queries.accept).not.toHaveBeenCalled();
  });
  it('maps only known context denials and masks private context failures', async () => {
    const repository = createPostgresAnswerSubmissionRepository({ enabled: true, database: db })!;
    queries.context.mockRejectedValueOnce(new CheckpointAnswerSubmissionStorageError('closed'));
    await expect(
      repository.context(actor, { attemptId: scope.attemptId, taskKey: scope.taskKey }),
    ).rejects.toMatchObject({ code: 'CLOSED' });
    queries.context.mockRejectedValueOnce(new Error('private DSN/password'));
    await expect(
      repository.context(actor, { attemptId: scope.attemptId, taskKey: scope.taskKey }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
  });
  it('passes exact immutable Submit intent to the atomic query, never a draft method', async () => {
    const write: OfficialAnswerWrite = Object.freeze({
      ...prepareAnswer(answer, context, true),
      schema: 1,
      actor,
      scope,
      requestId,
      answerContractDigest: context.answerContract.digest,
      evaluator,
      allowNew: true,
    });
    const result = await createPostgresAnswerSubmissionRepository({
      enabled: true,
      database: db,
    })!.accept(write);
    expect(result).toEqual({ kind: 'budget_exhausted' });
    expect(queries.accept).toHaveBeenCalledWith(db, write);
    expect(queries.context).not.toHaveBeenCalled();
  });
  it('preserves ambiguous commit as uncertain through the official service', async () => {
    const repository = createPostgresAnswerSubmissionRepository({ enabled: true, database: db })!;
    queries.accept.mockRejectedValueOnce(new Error('private connection lost after COMMIT'));
    const service = createOfficialAnswerSubmission({
      enabled: true,
      repository,
      evaluators: [evaluator],
    });
    const result = await service.submit(actor, {
      attemptId: scope.attemptId,
      taskKey: scope.taskKey,
      requestId,
      definitionDigest: scope.definitionDigest,
      answerContractDigest: context.answerContract.digest,
      answer,
    });
    expect(result).toEqual({ kind: 'uncertain', requestId });
    expect(queries.accept).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
