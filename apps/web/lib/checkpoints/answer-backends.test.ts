import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
vi.mock('server-only', () => ({}));
vi.mock('../auth/server', () => ({
  requireDomainUser: vi.fn(),
  getDatabase: vi.fn(() => {
    throw Error('no production DB');
  }),
}));
vi.mock('@nextera/db/checkpoints', () => ({ checkpointTaskContext: vi.fn() }));
vi.mock('./postgres-answer-drafts', () => ({ createPostgresAnswerDraftBackend: vi.fn() }));
vi.mock('./postgres-answer-submission', () => ({
  createPostgresAnswerSubmissionRepository: vi.fn(),
}));
import { checkpointTaskContext } from '@nextera/db/checkpoints';
import { createPostgresAnswerDraftBackend } from './postgres-answer-drafts';
import { createPostgresAnswerSubmissionRepository } from './postgres-answer-submission';
import { answerContractDigest } from './answer-server-contract';
import { configureCheckpointAnswerApi, checkpointAnswerHttpPolicy } from './answer-backends';
const id = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const user = {
  id: id(1),
  authUserId: id(2),
  displayName: 'Synthetic',
  active: true,
  role: 'learner' as const,
};
const scope = {
  learnerId: user.id,
  cohortId: id(3),
  attemptId: id(4),
  taskKey: 'q6',
  definitionDigest: 'a'.repeat(64),
};
const answerContract = {
  version: 1 as const,
  kind: 'trace_with_reason' as const,
  maxBytes: 2048,
  digest: answerContractDigest(scope, { version: 1, kind: 'trace_with_reason', maxBytes: 2048 }),
};
const context = {
  scope,
  readAllowed: true,
  status: 'active' as const,
  serverNow: '2026-10-31T10:00:00Z',
  deadline: '2026-10-31T13:00:00Z',
  answerContract,
  submitAllowed: true,
};
const route = {
  family: 'checkpoint_structured_answer' as const,
  version: 1 as const,
  kind: 'trace_with_reason' as const,
  definitionDigest: scope.definitionDigest,
  taskKey: 'q6',
  evaluatorKey: 'synthetic-trace',
  evaluatorDigest: 'c'.repeat(64),
};
function native() {
  return {
    user_id: user.id,
    cohort_id: scope.cohortId,
    rules: { required_files: [], max_size_kb: 2 },
    scoredExam: { version: 1, form: 'A', rubricDigest: 'b'.repeat(64) },
    answerFormat: { version: 1, kind: 'trace_with_reason' },
    submission: { version: 1, allowed: true, status: 'open', authority: 'checkpoint_answers_v1' },
    answerContract,
    officialAnswerPolicy: { version: 1 },
    answerEvaluator: route,
  };
}
const policy = JSON.stringify({ version: 1, maxBodyBytes: 2048, bodyTimeoutMs: 1000 });
const database = vi.fn(() => ({}) as OperationalDatabase);
const draft = { context: vi.fn(async () => context), read: vi.fn(async () => null), save: vi.fn() };
const repository = { context: vi.fn(async () => context), accept: vi.fn() };
function configured(storage: unknown = 'postgres-v1', httpPolicy: unknown = policy) {
  return configureCheckpointAnswerApi({
    authenticate: async () => user,
    database,
    storage,
    httpPolicy,
  });
}
function get(bootstrap = true) {
  return new Request(
    'http://localhost:3150/api/checkpoints/answers/drafts?attempt=' +
      scope.attemptId +
      '&task=q6' +
      (bootstrap ? '&bootstrap=1' : ''),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  database.mockReturnValue({} as OperationalDatabase);
  draft.context.mockResolvedValue(context);
  draft.read.mockResolvedValue(null);
  repository.context.mockResolvedValue(context);
  vi.mocked(checkpointTaskContext).mockResolvedValue(native() as never);
  vi.mocked(createPostgresAnswerDraftBackend).mockReturnValue(draft);
  vi.mocked(createPostgresAnswerSubmissionRepository).mockReturnValue(repository);
});
describe('explicit lazy native structured-answer assembly', () => {
  it('requires exact versioned settings, rejects extra/invalid values and opens no DB while constructing/importing', async () => {
    for (const value of [
      undefined,
      null,
      '',
      '{}',
      JSON.stringify({ version: 2, maxBodyBytes: 2048, bodyTimeoutMs: 1 }),
      JSON.stringify({ version: 1, maxBodyBytes: 0, bodyTimeoutMs: 1 }),
      JSON.stringify({ version: 1, maxBodyBytes: 262145, bodyTimeoutMs: 1 }),
      JSON.stringify({ version: 1, maxBodyBytes: 20, bodyTimeoutMs: 0 }),
      JSON.stringify({ version: 1, maxBodyBytes: 20, bodyTimeoutMs: 1, extra: true }),
    ])
      expect(checkpointAnswerHttpPolicy(value)).toBeNull();
    expect(checkpointAnswerHttpPolicy(policy)).toEqual({ maxBodyBytes: 2048, bodyTimeoutMs: 1000 });
    const api = configured();
    expect(database).not.toHaveBeenCalled();
    expect(api).toBeDefined();
    expect((await configured(null, null).drafts.GET(get())).status).toBe(503);
    expect(database).not.toHaveBeenCalled();
  });
  it('bootstraps native identity/contract and null first draft without inventing a Go filename; old GET stays404', async () => {
    const api = configured();
    const response = await api.drafts.GET(get());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      schema: 1,
      context: {
        scope,
        readAllowed: true,
        status: 'active',
        serverNow: context.serverNow,
        deadline: context.deadline,
        answerContract,
        capabilities: { draftsV1: true, officialSubmit: true },
      },
      draft: null,
    });
    expect(JSON.stringify(body)).not.toContain('filename');
    expect((await api.drafts.GET(get(false))).status).toBe(404);
  });
  it('rejects client bootstrap policy flags, missing native marker/registry and wrong learner before drafting', async () => {
    expect((await configured().drafts.GET(new Request(get().url + '&policy=enable'))).status).toBe(
      400,
    );
    for (const replacement of [
      { ...native(), scoredExam: undefined },
      { ...native(), answerEvaluator: undefined },
      { ...native(), user_id: id(99) },
    ]) {
      vi.mocked(checkpointTaskContext).mockResolvedValueOnce(replacement as never);
      expect((await configured().drafts.GET(get())).status).toBe(
        replacement.user_id === id(99) ? 403 : 503,
      );
    }
    expect(draft.read).not.toHaveBeenCalled();
  });
  it('does not consume submitted bytes when native identity or time authority fails', async () => {
    let pulls = 0;
    const body = new ReadableStream(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(new TextEncoder().encode('not-read'));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const input = new Request('http://localhost:3150/api/checkpoints/answers/submissions', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3150',
        host: 'localhost:3150',
        'content-type': 'application/json',
        'x-attempt-id': scope.attemptId,
        'x-task-key': scope.taskKey,
        'x-definition-digest': scope.definitionDigest,
        'x-answer-contract-digest': answerContract.digest,
        'idempotency-key': id(5),
      },
      body,
      duplex: 'half',
    } as RequestInit);
    vi.mocked(checkpointTaskContext).mockResolvedValueOnce({
      ...native(),
      user_id: id(99),
    } as never);
    expect((await configured().submit(input)).status).toBe(403);
    expect(pulls).toBe(0);
    expect(repository.accept).not.toHaveBeenCalled();
  });
  it('routes an actual canonical answer through the native frozen evaluator without legacy or client registry', async () => {
    repository.accept.mockImplementation(async (write) => ({
      kind: 'accepted',
      replayed: false,
      receipt: {
        id: id(90),
        actor: write.actor,
        scope: write.scope,
        requestId: write.requestId,
        answerContractDigest: write.answerContractDigest,
        answerVersion: 1,
        answerKind: write.answer.kind,
        sha256: write.sha256,
        byteLength: write.byteLength,
        evaluator: write.evaluator,
        evaluation: 'pending',
      },
    }));
    const input = new Request('http://localhost:3150/api/checkpoints/answers/submissions', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3150',
        host: 'localhost:3150',
        'content-type': 'application/json',
        'x-attempt-id': scope.attemptId,
        'x-task-key': scope.taskKey,
        'idempotency-key': id(5),
        'x-definition-digest': scope.definitionDigest,
        'x-answer-contract-digest': answerContract.digest,
      },
      body: JSON.stringify({
        version: 1,
        kind: 'trace_with_reason',
        output: 'hello\n',
        reason: 'because',
      }),
    });
    const response = await configured().submit(input);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      schema: 1,
      requestId: id(5),
      evaluation: 'pending',
    });
    expect(repository.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluator: route,
        actor: { id: user.id, authUserId: user.authUserId },
        scope,
        requestId: id(5),
      }),
    );
  });
  it('never silently mixes mismatched frozen draft/official contracts', async () => {
    repository.context.mockResolvedValueOnce({
      ...context,
      answerContract: { ...answerContract, digest: 'f'.repeat(64) },
    });
    expect((await configured().drafts.GET(get())).status).toBe(503);
    expect(draft.read).not.toHaveBeenCalled();
  });
});
