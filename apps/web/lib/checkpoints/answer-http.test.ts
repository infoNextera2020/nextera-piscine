import { describe, expect, it, vi } from 'vitest';
import { AccessDenied, type DomainUser } from '@nextera/domain';
import { serializeMixedAnswer } from './checkpoint-answer';
import {
  createCheckpointAnswerDraftHandlers,
  createCheckpointAnswerSubmissionHandler,
} from './answer-http';
import {
  AnswerApiError,
  answerContractDigest,
  prepareAnswer,
  type AnswerServerContext,
  type AnswerDraftRecord,
  type CheckpointAnswerDraftBackend,
} from './answer-server-contract';
import type { OfficialAnswerSubmissionOutcome } from './answer-submission';
const ids = {
  user: '00000000-0000-4000-8000-000000000001',
  auth: '00000000-0000-4000-8000-000000000002',
  cohort: '00000000-0000-4000-8000-000000000003',
  attempt: '00000000-0000-4000-8000-000000000004',
  request: '00000000-0000-4000-8000-000000000005',
  receipt: '00000000-0000-4000-8000-000000000006',
};
const origin = 'http://localhost:3118';
const user: DomainUser = {
  id: ids.user,
  authUserId: ids.auth,
  displayName: 'Synthetic learner',
  role: 'learner',
  active: true,
};
const scope = Object.freeze({
  learnerId: ids.user,
  cohortId: ids.cohort,
  attemptId: ids.attempt,
  taskKey: 'trace-task',
  definitionDigest: 'a'.repeat(64),
});
const format = { version: 1 as const, kind: 'trace_with_reason' as const, maxBytes: 2048 };
const context: AnswerServerContext = {
  scope,
  readAllowed: true,
  status: 'active',
  serverNow: '2026-10-30T12:00:00Z',
  deadline: '2026-10-30T13:00:00Z',
  answerContract: { ...format, digest: answerContractDigest(scope, format) },
};
const answer = () => ({
  version: 1 as const,
  kind: 'trace_with_reason' as const,
  output: '\ufeffline\r\n\u0000ب',
  reason: 'A brief explanation.',
});
function fixture() {
  const authenticate = vi.fn(async () => user);
  const record = (): AnswerDraftRecord => ({
    ...prepareAnswer(answer(), context),
    scope,
    answerContractDigest: context.answerContract.digest,
    version: 1,
    requestId: ids.request,
  });
  const backend: CheckpointAnswerDraftBackend = {
    context: vi.fn(async () => context),
    read: vi.fn(async () => record()),
    save: vi.fn(async (input) => ({
      kind: 'saved' as const,
      record: { ...input, version: input.baseVersion + 1 },
    })),
  };
  const submit = vi.fn(async (): Promise<OfficialAnswerSubmissionOutcome> => ({
    kind: 'accepted',
    id: ids.receipt,
    requestId: ids.request,
    replayed: false,
    evaluation: 'pending',
  }));
  const bodyPolicy = { maxBodyBytes: 4096, bodyTimeoutMs: 100 };
  return {
    authenticate,
    backend,
    submit,
    bodyPolicy,
    record,
    drafts: createCheckpointAnswerDraftHandlers({ authenticate, backend, bodyPolicy }),
    POST: createCheckpointAnswerSubmissionHandler({
      authenticate,
      service: { submit },
      bodyPolicy,
    }),
  };
}
function post(
  body: BodyInit = serializeMixedAnswer(answer(), 2048).payload,
  headers: Record<string, string> = {},
  url = origin + '/api/checkpoints/answers/drafts',
) {
  return new Request(url, {
    method: 'POST',
    headers: {
      origin,
      host: 'localhost:3118',
      'content-type': 'application/json',
      'x-attempt-id': ids.attempt,
      'x-task-key': scope.taskKey,
      'x-definition-digest': scope.definitionDigest,
      'x-answer-contract-digest': context.answerContract.digest,
      'idempotency-key': ids.request,
      'x-base-version': '0',
      ...headers,
    },
    body,
    duplex: 'half',
  } as RequestInit);
}
function get(query = 'attempt=' + ids.attempt + '&task=' + scope.taskKey) {
  return new Request(origin + '/api/checkpoints/answers/drafts?' + query);
}
describe('typed-answer HTTP — injected transport only, no native PostgreSQL', () => {
  it('Save reaches only the draft port, preserving answer bytes and consuming no official acceptance', async () => {
    const f = fixture(),
      r = await f.drafts.POST(post());
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.answer).toEqual(answer());
    expect(data.version).toBe(1);
    expect(f.backend.save).toHaveBeenCalledTimes(1);
    expect(f.submit).not.toHaveBeenCalled();
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(data).not.toHaveProperty('evaluator');
    expect(data).not.toHaveProperty('grade');
  });
  it('reads a scoped canonical draft without invoking Save or official acceptance', async () => {
    const f = fixture(),
      r = await f.drafts.GET(get());
    expect(r.status).toBe(200);
    expect((await r.json()).answer).toEqual(answer());
    expect(f.backend.save).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('keeps missing backends and unconfigured body policies unavailable', async () => {
    const f = fixture();
    for (const deps of [
      { backend: null, bodyPolicy: f.bodyPolicy },
      { backend: f.backend, bodyPolicy: null },
      { backend: f.backend, bodyPolicy: { ...f.bodyPolicy, maxBodyBytes: 0 } },
    ])
      expect(
        (
          await createCheckpointAnswerDraftHandlers({ authenticate: f.authenticate, ...deps }).POST(
            post(),
          )
        ).status,
      ).toBe(503);
    expect(f.backend.save).not.toHaveBeenCalled();
  });
  it('rejects cross-origin requests before authentication or storage', async () => {
    const f = fixture();
    expect((await f.drafts.POST(post(undefined, { origin: 'https://other.invalid' }))).status).toBe(
      403,
    );
    expect(f.authenticate).not.toHaveBeenCalled();
    expect(f.backend.context).not.toHaveBeenCalled();
  });
  it('requires an authenticated active learner, not a supplied role', async () => {
    const f = fixture();
    f.authenticate.mockRejectedValueOnce(new AccessDenied('UNAUTHENTICATED'));
    expect((await f.drafts.GET(get())).status).toBe(401);
    f.authenticate.mockResolvedValueOnce({ ...user, role: 'admin' });
    expect((await f.drafts.POST(post())).status).toBe(403);
    expect(f.backend.save).not.toHaveBeenCalled();
  });
  it.each([
    { 'x-attempt-id': 'not-an-id' },
    { 'x-task-key': '../other' },
    { 'idempotency-key': 'bad' },
    { 'x-definition-digest': 'bad' },
    { 'x-answer-contract-digest': 'bad' },
    { 'x-base-version': '-1' },
    { 'x-base-version': String(Number.MAX_SAFE_INTEGER) },
  ])('rejects invalid authority/version headers: %j', async (patch) => {
    const f = fixture();
    expect((await f.drafts.POST(post(undefined, patch))).status).toBe(400);
    expect(f.backend.save).not.toHaveBeenCalled();
  });
  it('forbids mutation query strings and duplicate or authority-bearing read parameters', async () => {
    const f = fixture();
    expect(
      (
        await f.drafts.POST(
          post(undefined, {}, origin + '/api/checkpoints/answers/drafts?role=admin'),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await f.drafts.GET(
          get('attempt=' + ids.attempt + '&attempt=' + ids.attempt + '&task=' + scope.taskKey),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await f.drafts.GET(
          get('attempt=' + ids.attempt + '&task=' + scope.taskKey + '&learner=other'),
        )
      ).status,
    ).toBe(400);
  });
  it('checks frozen definition and answer contract independently', async () => {
    const f = fixture();
    expect(
      (await f.drafts.POST(post(undefined, { 'x-definition-digest': 'b'.repeat(64) }))).status,
    ).toBe(412);
    expect(
      (await f.drafts.POST(post(undefined, { 'x-answer-contract-digest': 'b'.repeat(64) }))).status,
    ).toBe(412);
    expect(f.backend.save).not.toHaveBeenCalled();
  });
  it.each(['identity', 'access', 'deadline', 'contract'] as const)(
    'fails closed for server %s mismatch',
    async (change) => {
      const f = fixture();
      const c =
        change === 'identity'
          ? { ...context, scope: { ...scope, learnerId: ids.auth } }
          : change === 'access'
            ? { ...context, readAllowed: false }
            : change === 'deadline'
              ? { ...context, serverNow: context.deadline }
              : {
                  ...context,
                  answerContract: { ...context.answerContract, digest: 'b'.repeat(64) },
                };
      vi.mocked(f.backend.context).mockResolvedValue(c);
      expect((await f.drafts.POST(post())).status).toBe(
        change === 'deadline' ? 409 : change === 'contract' ? 503 : 403,
      );
      expect(f.backend.save).not.toHaveBeenCalled();
    },
  );
  it.each([
    '{"version":1,"kind":"trace_with_reason","output":"x","reason":"y","role":"admin"}',
    JSON.stringify(answer(), null, 2),
    '{"version":1,"kind":["trace_with_reason"],"output":"x","reason":"y"}',
    '{"version":1,"kind":"trace_with_reason","output":"\\ud800","reason":"y"}',
  ])('rejects noncanonical, malformed or authority-bearing answer envelopes', async (body) => {
    const f = fixture();
    expect((await f.drafts.POST(post(body))).status).toBe(400);
    expect(f.backend.save).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('rejects a valid different answer kind against the frozen question', async () => {
    const f = fixture();
    const payload = serializeMixedAnswer(
      { version: 1, kind: 'debug_with_reason', source: 'x', explanation: 'y', counterexample: 'z' },
      2048,
    ).payload;
    expect((await f.drafts.POST(post(payload))).status).toBe(412);
    expect(f.backend.save).not.toHaveBeenCalled();
  });
  it('rejects malformed UTF8 and actual oversized streams despite a lying length', async () => {
    const f = fixture();
    expect((await f.drafts.POST(post(new Uint8Array([0xff, 0xfe])))).status).toBe(400);
    expect((await f.drafts.POST(post('x'.repeat(2049), { 'content-length': '1' }))).status).toBe(
      413,
    );
    expect(f.backend.save).not.toHaveBeenCalled();
  });
  it('requires exact base+1 acknowledgement, not any later revision', async () => {
    const f = fixture();
    vi.mocked(f.backend.save).mockImplementationOnce(async (input) => ({
      kind: 'saved',
      record: { ...input, version: 99 },
    }));
    expect((await f.drafts.POST(post())).status).toBe(503);
  });
  it('rejects mismatched payload acknowledgements without falsely reporting saved', async () => {
    const f = fixture();
    vi.mocked(f.backend.save).mockResolvedValueOnce({
      kind: 'saved',
      record: { ...f.record(), payload: '{}' },
    });
    expect((await f.drafts.POST(post())).status).toBe(503);
  });
  it('exposes a valid conflicting current draft without overwriting it', async () => {
    const f = fixture();
    vi.mocked(f.backend.save).mockResolvedValueOnce({
      kind: 'conflict',
      current: { ...f.record(), version: 2 },
    });
    const r = await f.drafts.POST(post());
    expect(r.status).toBe(409);
    expect((await r.json()).current.version).toBe(2);
    expect(f.backend.save).toHaveBeenCalledTimes(1);
  });
  it('does not mistake a commit-time access loss or storage ceiling for saved/official budget', async () => {
    const f = fixture();
    vi.mocked(f.backend.save).mockRejectedValueOnce(new AnswerApiError('FORBIDDEN'));
    expect((await f.drafts.POST(post())).status).toBe(403);
    vi.mocked(f.backend.save).mockRejectedValueOnce(new AnswerApiError('STORAGE_LIMIT'));
    const r = await f.drafts.POST(post());
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'STORAGE_LIMIT' });
    expect(f.submit).not.toHaveBeenCalled();
  });
  it.each(['type', 'length', 'chunk', 'timeout'] as const)(
    'cancels rejected %s bodies without awaiting a nonsettling cancel',
    async (why) => {
      const f = fixture(),
        cancel = vi.fn(() => new Promise<void>(() => {}));
      const body = new ReadableStream({
        start(c) {
          if (why === 'chunk') c.enqueue('not bytes' as never);
        },
        cancel,
      });
      const patch =
        why === 'type'
          ? { 'content-type': 'text/plain' }
          : why === 'length'
            ? { 'content-length': '9999' }
            : {};
      const handler = createCheckpointAnswerDraftHandlers({
        authenticate: f.authenticate,
        backend: f.backend,
        bodyPolicy: { ...f.bodyPolicy, bodyTimeoutMs: 5 },
      }).POST;
      const r = await handler(post(body, patch));
      expect(r.status).toBe(
        why === 'type' ? 415 : why === 'length' ? 413 : why === 'timeout' ? 408 : 400,
      );
      expect(cancel).toHaveBeenCalled();
      expect(f.backend.save).not.toHaveBeenCalled();
    },
    1000,
  );
  it.each(['save', 'submit'] as const)(
    'cancels an invalid %s identity body before any context or acceptance call',
    async (operation) => {
      const f = fixture(),
        cancel = vi.fn(() => new Promise<void>(() => {}));
      const body = new ReadableStream({ cancel });
      const r = await (operation === 'save' ? f.drafts.POST : f.POST)(
        post(body, { 'idempotency-key': 'invalid' }),
      );
      expect(r.status).toBe(400);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(f.backend.context).not.toHaveBeenCalled();
      expect(f.backend.save).not.toHaveBeenCalled();
      expect(f.submit).not.toHaveBeenCalled();
    },
    1000,
  );
  it('accepts official submission only as pending evaluation, with explicit replay state', async () => {
    const f = fixture();
    let r = await f.POST(post());
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({
      schema: 1,
      id: ids.receipt,
      requestId: ids.request,
      replayed: false,
      evaluation: 'pending',
    });
    f.submit.mockResolvedValueOnce({
      kind: 'accepted',
      id: ids.receipt,
      requestId: ids.request,
      replayed: true,
      evaluation: 'pending',
    });
    r = await f.POST(post());
    expect(r.status).toBe(200);
    expect(f.backend.save).not.toHaveBeenCalled();
  });
  it('keeps official submission unavailable without a separately supplied service', async () => {
    const f = fixture();
    expect(
      (
        await createCheckpointAnswerSubmissionHandler({
          authenticate: f.authenticate,
          service: null,
          bodyPolicy: f.bodyPolicy,
        })(post())
      ).status,
    ).toBe(503);
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('surfaces uncertain official acceptance without a verdict or second automatic submit', async () => {
    const f = fixture();
    f.submit.mockResolvedValueOnce({ kind: 'uncertain', requestId: ids.request });
    const r = await f.POST(post());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'SUBMISSION_UNCERTAIN', requestId: ids.request });
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
  it('never echoes private backend exceptions', async () => {
    const f = fixture();
    vi.mocked(f.backend.context).mockRejectedValueOnce(new Error('private credential DSN'));
    const r = await f.drafts.POST(post());
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('private');
  });
});
