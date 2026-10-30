import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
const queries = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock('@nextera/db/checkpoint-answer-drafts', async (original) => ({
  ...(await original<typeof import('@nextera/db/checkpoint-answer-drafts')>()),
  readCheckpointAnswerDraftContext: queries.context,
  readCheckpointAnswerDraft: queries.read,
  saveCheckpointAnswerDraft: queries.save,
}));
import { CheckpointAnswerDraftStorageError } from '@nextera/db/checkpoint-answer-drafts';
import { createPostgresAnswerDraftBackend } from './postgres-answer-drafts';
import {
  answerContractDigest,
  prepareAnswer,
  type AnswerServerContext,
} from './answer-server-contract';
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
const format = { version: 1 as const, kind: 'trace_with_reason' as const, maxBytes: 1024 };
const context: AnswerServerContext = {
  scope,
  readAllowed: true,
  status: 'active',
  serverNow: '2026-10-30T12:00:00Z',
  deadline: '2026-10-30T13:00:00Z',
  answerContract: { ...format, digest: answerContractDigest(scope, format) },
};
const answer = {
  version: 1 as const,
  kind: 'trace_with_reason' as const,
  output: 'exact\r\n',
  reason: 'Fixture reasoning',
};
const db = { execute: vi.fn() } as unknown as OperationalDatabase;
const requestId = '00000000-0000-4000-8000-000000000005';
const record = () => ({
  ...prepareAnswer(answer, context),
  scope,
  answerContractDigest: context.answerContract.digest,
  requestId,
  version: 1,
});
beforeEach(() => {
  vi.resetAllMocks();
  queries.context.mockResolvedValue(context);
  queries.read.mockResolvedValue(record());
  queries.save.mockImplementation(async (_db, p) => ({
    kind: 'saved',
    record: { ...p, scope: p.scope, version: p.baseVersion + 1 },
  }));
});
describe('typed draft app adapter — mocked query port, not PostgreSQL', () => {
  it('constructs without queries and remains disabled without explicit client/enablement', () => {
    expect(createPostgresAnswerDraftBackend(null)).toBeNull();
    expect(createPostgresAnswerDraftBackend({ enabled: false, database: db })).toBeNull();
    expect(createPostgresAnswerDraftBackend({ enabled: true, database: null })).toBeNull();
    expect(createPostgresAnswerDraftBackend({ enabled: true, database: db })).not.toBeNull();
    expect(queries.context).not.toHaveBeenCalled();
    expect(queries.save).not.toHaveBeenCalled();
  });
  it('binds the authenticated provider ID to the scoped application learner and exact receipt', async () => {
    const backend = createPostgresAnswerDraftBackend({ enabled: true, database: db })!;
    const value = await backend.read(actor, scope, context.answerContract.digest, requestId);
    expect(value?.payload).toBe(record().payload);
    expect(queries.context).toHaveBeenCalledWith(
      db,
      actor.authUserId,
      scope.attemptId,
      scope.taskKey,
    );
    expect(queries.read).toHaveBeenCalledWith(
      db,
      actor.authUserId,
      scope,
      context.answerContract.digest,
      requestId,
    );
  });
  it('never exposes a record from another application identity', async () => {
    queries.read.mockResolvedValueOnce({
      ...record(),
      scope: { ...scope, learnerId: actor.authUserId },
    });
    await expect(
      createPostgresAnswerDraftBackend({ enabled: true, database: db })!.read(
        actor,
        scope,
        context.answerContract.digest,
      ),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('captures exact Save intent before delayed context I/O and ignores caller mutation', async () => {
    let release!: (v: AnswerServerContext) => void;
    queries.context.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const input = {
      ...prepareAnswer(answer, context),
      actor: { ...actor },
      scope: { ...scope },
      answerContractDigest: context.answerContract.digest,
      requestId,
      baseVersion: 0,
    };
    const original = input.payload;
    const pending = createPostgresAnswerDraftBackend({ enabled: true, database: db })!.save(input);
    input.payload = 'changed';
    input.actor.authUserId = actor.id;
    input.scope.taskKey = 'other-task';
    release(context);
    await pending;
    expect(queries.save).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        authId: actor.authUserId,
        scope,
        payload: original,
        baseVersion: 0,
        requestId,
      }),
    );
  });
  it.each(['version', 'request', 'payload'] as const)(
    'rejects a query acknowledgement with different %s intent',
    async (change) => {
      queries.save.mockImplementationOnce(async (_db, input) => ({
        kind: 'saved',
        record: {
          ...input,
          version: change === 'version' ? 99 : 1,
          requestId: change === 'request' ? actor.id : requestId,
          ...(change === 'payload' ? prepareAnswer({ ...answer, output: 'other' }, context) : {}),
        },
      }));
      await expect(
        createPostgresAnswerDraftBackend({ enabled: true, database: db })!.save({
          ...prepareAnswer(answer, context),
          actor,
          scope,
          answerContractDigest: context.answerContract.digest,
          requestId,
          baseVersion: 0,
        }),
      ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    },
  );
  it('rejects mismatched byte/hash input before writing', async () => {
    const input = {
      ...prepareAnswer(answer, context),
      actor,
      scope,
      answerContractDigest: context.answerContract.digest,
      requestId,
      baseVersion: 0,
      sha256: 'b'.repeat(64),
    };
    await expect(
      createPostgresAnswerDraftBackend({ enabled: true, database: db })!.save(input),
    ).rejects.toMatchObject({ code: 'INVALID_ANSWER' });
    expect(queries.save).not.toHaveBeenCalled();
  });
  it('keeps storage limits distinct and masks unknown storage errors', async () => {
    const backend = createPostgresAnswerDraftBackend({ enabled: true, database: db })!;
    queries.context.mockRejectedValueOnce(new CheckpointAnswerDraftStorageError('storage_limit'));
    await expect(
      backend.context(actor, { attemptId: scope.attemptId, taskKey: scope.taskKey }),
    ).rejects.toMatchObject({ code: 'STORAGE_LIMIT' });
    queries.context.mockRejectedValueOnce(new Error('private DSN and credential'));
    await expect(
      backend.context(actor, { attemptId: scope.attemptId, taskKey: scope.taskKey }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
  });
});
