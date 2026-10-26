import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AccessDenied, type DomainUser } from '@nextera/domain';
import {
  createCheckpointDraftHandlers,
  createCheckpointRunHandlers,
  EditorApiError,
  type CheckpointDraftBackend,
  type CheckpointRunBackend,
  type EditorServerContext,
  type RunServerContext,
} from './editor-http';

const ids = {
  user: '00000000-0000-4000-8000-000000000001',
  auth: '00000000-0000-4000-8000-000000000002',
  cohort: '00000000-0000-4000-8000-000000000003',
  attempt: '00000000-0000-4000-8000-000000000004',
  request: '00000000-0000-4000-8000-000000000005',
  run: '00000000-0000-4000-8000-000000000006',
};
const digest = 'a'.repeat(64),
  examples = 'b'.repeat(64),
  base = 'http://localhost:3118';
const user: DomainUser = {
  id: ids.user,
  authUserId: ids.auth,
  displayName: 'Fixture',
  role: 'learner',
  active: true,
};
const context: EditorServerContext = {
  scope: {
    learnerId: ids.user,
    cohortId: ids.cohort,
    attemptId: ids.attempt,
    taskKey: 'question-a',
    definitionDigest: digest,
  },
  readAllowed: true,
  status: 'active',
  serverNow: '2026-10-27T10:00:00Z',
  deadline: '2026-10-27T11:00:00Z',
  sourceBytes: 128,
  filename: 'answer.go',
};
const runContext: RunServerContext = {
  ...context,
  visibleExamplesDigest: examples,
  policy: {
    visibility: 'visible_examples',
    graded: false,
    consumesGradedAttempts: false,
    limits: {
      timeoutMs: 1000,
      memoryMb: 64,
      outputBytes: 64,
      sourceBytes: 128,
      requestsPerWindow: 2,
      windowMs: 10000,
      concurrency: 1,
    },
  },
};
const hash = (source: string) => createHash('sha256').update(Buffer.from(source)).digest('hex');
function fixture() {
  const authenticate = vi.fn(async () => user);
  const drafts: CheckpointDraftBackend = {
    context: vi.fn(async () => context),
    read: vi.fn(async () => ({ source: 'saved', version: 1, requestId: ids.request })),
    save: vi.fn<CheckpointDraftBackend['save']>(async (input) => ({
      kind: 'saved',
      record: { source: input.source, version: input.baseVersion + 1, requestId: input.requestId },
    })),
  };
  const runs: CheckpointRunBackend = {
    context: vi.fn(async () => runContext),
    read: vi.fn<CheckpointRunBackend['read']>(async () => ({
      id: ids.run,
      requestId: ids.request,
      sourceDigest: hash('source'),
      state: 'completed',
      output: 'visible output',
    })),
    accept: vi.fn<CheckpointRunBackend['accept']>(async (input) => ({
      id: ids.run,
      requestId: input.requestId,
      sourceDigest: input.sha256,
      state: 'queued',
      output: null,
    })),
  };
  return {
    authenticate,
    drafts,
    runs,
    draftHandlers: createCheckpointDraftHandlers({ authenticate, backend: drafts }),
    runHandlers: createCheckpointRunHandlers({ authenticate, backend: runs }),
  };
}
function post(body: string | Uint8Array = 'package main\r\n', patch: Record<string, string> = {}) {
  return new Request(base + '/api/checkpoints/drafts', {
    method: 'POST',
    headers: {
      origin: base,
      host: 'localhost:3118',
      'content-type': 'application/octet-stream',
      'x-attempt-id': ids.attempt,
      'x-task-key': 'question-a',
      'x-definition-digest': digest,
      'idempotency-key': ids.request,
      'x-base-version': '0',
      ...patch,
    },
    body: Uint8Array.from(typeof body === 'string' ? Buffer.from(body) : body).buffer,
  });
}
function get(extra = '') {
  return new Request(
    base + `/api/checkpoints/drafts?attempt=${ids.attempt}&task=question-a${extra}`,
  );
}

describe('Authenticated Checkpoint editor HTTP boundary', () => {
  it.each(['draft', 'run'] as const)(
    'fails closed for a missing %s adapter after authentication',
    async (kind) => {
      const authenticate = vi.fn(async () => user);
      const handlers =
        kind === 'draft'
          ? createCheckpointDraftHandlers({ authenticate, backend: null })
          : createCheckpointRunHandlers({ authenticate, backend: null });
      const response = await handlers.POST(post());
      expect(response.status).toBe(503);
      expect(authenticate).toHaveBeenCalledOnce();
      expect(await response.json()).toEqual({ error: 'EDITOR_CAPABILITY_UNAVAILABLE' });
    },
  );
  it.each([
    ['origin', 'https://attacker.example'],
    ['origin', ''],
    ['host', 'another.example'],
  ] as const)(
    'rejects foreign/missing %s before authentication and body intake',
    async (key, value) => {
      const f = fixture();
      const response = await f.draftHandlers.POST(post('source', { [key]: value }));
      expect(response.status).toBe(403);
      expect(f.authenticate).not.toHaveBeenCalled();
      expect(f.drafts.save).not.toHaveBeenCalled();
    },
  );
  it.each(['UNAUTHENTICATED', 'INACTIVE', 'FORBIDDEN'] as const)(
    'maps %s without exposing a backend error or source',
    async (code) => {
      const f = fixture();
      f.authenticate.mockRejectedValue(new AccessDenied(code));
      const response = await f.draftHandlers.POST(post());
      expect(response.status).toBe(code === 'UNAUTHENTICATED' ? 401 : 403);
      expect(f.drafts.context).not.toHaveBeenCalled();
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    },
  );
  it.each(['operator', 'admin'] as const)(
    'does not grant %s learner mutation privileges',
    async (role) => {
      const f = fixture();
      f.authenticate.mockResolvedValue({ ...user, role });
      expect((await f.runHandlers.POST(post())).status).toBe(403);
      expect(f.runs.accept).not.toHaveBeenCalled();
    },
  );
  it.each([
    { 'x-attempt-id': 'invalid' },
    { 'x-task-key': '../private' },
    { 'idempotency-key': 'invalid' },
    { 'x-definition-digest': 'bad' },
    { 'x-base-version': '-1' },
    { 'x-base-version': '1.5' },
    { 'x-base-version': '9007199254740992' },
  ])('rejects malformed metadata %o before backend access', async (patch) => {
    const f = fixture();
    expect((await f.draftHandlers.POST(post('source', patch))).status).toBe(400);
    expect(f.drafts.context).not.toHaveBeenCalled();
  });
  it.each([
    { scope: { ...context.scope, learnerId: ids.auth } },
    { scope: { ...context.scope, attemptId: ids.run } },
    { scope: { ...context.scope, taskKey: 'other' } },
    { readAllowed: false },
  ])('rejects mismatched/unreadable server context %o', async (patch) => {
    const f = fixture();
    vi.mocked(f.drafts.context).mockResolvedValue({ ...context, ...patch });
    expect((await f.draftHandlers.POST(post())).status).toBe(403);
    expect(f.drafts.save).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'closed' as const },
    { serverNow: context.deadline },
    { serverNow: '2026-10-27T11:01:00Z' },
  ])('rejects closed intake %o without extending time', async (patch) => {
    const f = fixture();
    vi.mocked(f.drafts.context).mockResolvedValue({ ...context, ...patch });
    expect((await f.draftHandlers.POST(post())).status).toBe(409);
    expect(f.drafts.save).not.toHaveBeenCalled();
  });
  it('fails closed on an unavailable server clock or unbounded source limit', async () => {
    for (const patch of [{ serverNow: 'bad' }, { sourceBytes: 0 }, { sourceBytes: 262145 }]) {
      const f = fixture();
      vi.mocked(f.drafts.context).mockResolvedValue({ ...context, ...patch });
      expect((await f.draftHandlers.POST(post())).status).toBe(503);
      expect(f.drafts.save).not.toHaveBeenCalled();
    }
  });
  it('rejects stale definitions and does not trust client-selected learner/cohort/limits', async () => {
    const f = fixture();
    expect(
      (await f.draftHandlers.POST(post('source', { 'x-definition-digest': 'c'.repeat(64) })))
        .status,
    ).toBe(412);
    await f.draftHandlers.POST(
      post('source', {
        'x-user-id': ids.auth,
        'x-cohort-id': ids.run,
        'x-source-limit': '999999',
        'x-grade': 'passed',
      }),
    );
    const input = vi.mocked(f.drafts.save).mock.calls[0]![0];
    expect(input.actor).toEqual({ id: ids.user, authUserId: ids.auth });
    expect(input.scope).toEqual(context.scope);
    expect(input).not.toHaveProperty('grade');
  });
});

describe('Bounded exact source intake and versioned draft responses', () => {
  it('preserves BOM, UTF-8 and CRLF bytes and hashes the exact accepted content', async () => {
    const f = fixture(),
      source = '\uFEFFpackage main\r\n// café\n';
    const response = await f.draftHandlers.POST(post(source));
    expect(response.status).toBe(200);
    expect(vi.mocked(f.drafts.save).mock.calls[0]![0]).toMatchObject({
      source,
      sha256: hash(source),
      byteLength: Buffer.byteLength(source),
      baseVersion: 0,
      requestId: ids.request,
    });
    expect(await response.json()).toEqual({
      source,
      version: 1,
      requestId: ids.request,
      definitionDigest: digest,
    });
  });
  it('allows an intentional empty draft but never an empty Run', async () => {
    const f = fixture();
    expect((await f.draftHandlers.POST(post(''))).status).toBe(200);
    expect((await f.runHandlers.POST(post(''))).status).toBe(400);
    expect(f.runs.accept).not.toHaveBeenCalled();
  });
  it.each([
    ['content-type', 'application/json', 415],
    ['content-length', '999', 413],
    ['content-length', 'bad', 400],
    ['content-length', '1', 400],
  ] as const)('handles %s=%s as %s', async (key, value, status) => {
    const f = fixture();
    expect((await f.draftHandlers.POST(post('source', { [key]: value }))).status).toBe(status);
    expect(f.drafts.save).not.toHaveBeenCalled();
  });
  it('bounds streamed bytes without Content-Length and cancels oversized intake', async () => {
    const f = fixture();
    expect((await f.draftHandlers.POST(post('x'.repeat(129)))).status).toBe(413);
    expect(f.drafts.save).not.toHaveBeenCalled();
  });
  it('rejects malformed UTF-8 instead of replacing code bytes', async () => {
    const f = fixture();
    expect((await f.draftHandlers.POST(post(new Uint8Array([0xc3, 0x28])))).status).toBe(400);
    expect(f.drafts.save).not.toHaveBeenCalled();
  });
  it('returns an authorized conflict without overwriting or leaking extra backend fields', async () => {
    const f = fixture();
    vi.mocked(f.drafts.save).mockResolvedValue({
      kind: 'conflict',
      current: { source: 'remote', version: 2, requestId: ids.run, privatePack: 'secret' } as never,
    });
    const response = await f.draftHandlers.POST(post());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'DRAFT_CONFLICT',
      current: { source: 'remote', version: 2, requestId: ids.run, definitionDigest: digest },
    });
  });
  it('does not report saved for a mismatched acknowledgement', async () => {
    for (const record of [
      { source: 'other', version: 1, requestId: ids.request },
      { source: 'source', version: 0, requestId: ids.request },
      { source: 'source', version: 1, requestId: ids.run },
    ]) {
      const f = fixture();
      vi.mocked(f.drafts.save).mockResolvedValue({ kind: 'saved', record });
      expect((await f.draftHandlers.POST(post('source'))).status).toBe(503);
    }
  });
  it('reconciles a specific original request and rejects a different returned receipt', async () => {
    const f = fixture();
    expect((await f.draftHandlers.GET(get('&request=' + ids.request))).status).toBe(200);
    expect(f.drafts.read).toHaveBeenCalledWith(
      { id: ids.user, authUserId: ids.auth },
      context.scope,
      ids.request,
    );
    vi.mocked(f.drafts.read).mockResolvedValue({
      source: 'another',
      version: 2,
      requestId: ids.run,
    });
    expect((await f.draftHandlers.GET(get('&request=' + ids.request))).status).toBe(503);
  });
  it('handles missing records and hides backend exceptions', async () => {
    const f = fixture();
    vi.mocked(f.drafts.read).mockResolvedValue(null);
    expect((await f.draftHandlers.GET(get())).status).toBe(404);
    vi.mocked(f.drafts.save).mockRejectedValue(
      new Error('connection password=secret SQL private source'),
    );
    const response = await f.draftHandlers.POST(post());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });
  it('respects a commit-time access/deadline race reported by the atomic backend', async () => {
    for (const code of ['FORBIDDEN', 'CLOSED', 'IDEMPOTENCY_CONFLICT'] as const) {
      const f = fixture();
      vi.mocked(f.drafts.save).mockRejectedValue(new EditorApiError(code));
      expect((await f.draftHandlers.POST(post())).status).toBe(code === 'FORBIDDEN' ? 403 : 409);
    }
  });
});

describe('Dedicated visible-example Run boundary', () => {
  it('accepts only server-selected filename/examples/limits and returns no grading fields', async () => {
    const f = fixture();
    const response = await f.runHandlers.POST(
      post('source', { 'x-test-pack': 'private', 'x-filename': 'steal.go', 'x-limit': '999999' }),
    );
    expect(response.status).toBe(202);
    const input = vi.mocked(f.runs.accept).mock.calls[0]![0];
    expect(input).toMatchObject({
      filename: 'answer.go',
      visibleExamplesDigest: examples,
      limits: runContext.policy.limits,
      source: 'source',
    });
    expect(input).not.toHaveProperty('testPack');
    expect(input).not.toHaveProperty('grade');
    expect(await response.json()).toEqual({
      id: ids.run,
      requestId: ids.request,
      sourceDigest: hash('source'),
      state: 'queued',
      output: null,
    });
  });
  it('does not enable Run without explicit visible/ungraded policy and separate positive limits', async () => {
    const cases = [
      { policy: null },
      { policy: { ...runContext.policy, visibility: 'hidden' } },
      { policy: { ...runContext.policy, graded: true } },
      { policy: { ...runContext.policy, consumesGradedAttempts: true } },
      {
        policy: {
          ...runContext.policy,
          limits: { ...runContext.policy.limits, requestsPerWindow: 0 },
        },
      },
      { visibleExamplesDigest: 'unresolved' },
    ];
    for (const patch of cases) {
      const f = fixture();
      vi.mocked(f.runs.context).mockResolvedValue({ ...runContext, ...patch } as RunServerContext);
      expect((await f.runHandlers.POST(post())).status).toBe(503);
      expect(f.runs.accept).not.toHaveBeenCalled();
    }
  });
  it('uses a separate rate-limit error and does not consume a graded attempt', async () => {
    const f = fixture();
    vi.mocked(f.runs.accept).mockRejectedValue(new EditorApiError('RATE_LIMITED', 7));
    const response = await f.runHandlers.POST(post());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('7');
    expect(await response.json()).toEqual({ error: 'RATE_LIMITED' });
    expect(f.drafts.save).not.toHaveBeenCalled();
  });
  it('reads an already accepted result after intake closes while still requiring access', async () => {
    const f = fixture();
    vi.mocked(f.runs.context).mockResolvedValue({
      ...runContext,
      status: 'closed',
      serverNow: context.deadline,
    });
    expect((await f.runHandlers.GET(get('&run=' + ids.run))).status).toBe(200);
    expect((await f.runHandlers.POST(post())).status).toBe(409);
  });
  it('does not publish private fields, unbounded output, premature output or an official verdict', async () => {
    for (const patch of [
      { output: 'x'.repeat(65) },
      { state: 'queued', output: 'premature' },
      { state: 'passed' },
    ]) {
      const f = fixture();
      vi.mocked(f.runs.read).mockResolvedValue({
        id: ids.run,
        requestId: ids.request,
        sourceDigest: hash('source'),
        state: 'completed',
        output: 'ok',
        ...patch,
      } as never);
      expect((await f.runHandlers.GET(get('&run=' + ids.run))).status).toBe(503);
    }
    const f = fixture();
    vi.mocked(f.runs.read).mockResolvedValue({
      id: ids.run,
      requestId: ids.request,
      sourceDigest: hash('source'),
      state: 'completed',
      output: 'ok',
      hiddenTests: ['secret'],
      grade: 'passed',
    } as never);
    expect(await (await f.runHandlers.GET(get('&run=' + ids.run))).json()).toEqual({
      id: ids.run,
      requestId: ids.request,
      sourceDigest: hash('source'),
      state: 'completed',
      output: 'ok',
    });
  });
  it('rejects an acceptance that does not match the submitted source hash/intent', async () => {
    const f = fixture();
    vi.mocked(f.runs.accept).mockResolvedValue({
      id: ids.run,
      requestId: ids.request,
      sourceDigest: 'c'.repeat(64),
      state: 'queued',
      output: null,
    });
    expect((await f.runHandlers.POST(post())).status).toBe(503);
  });
});

describe('Source stream resource cleanup', () => {
  it('cancels oversized chunked input without saving partial code', async () => {
    const f = fixture(),
      cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(129));
      },
      cancel,
    });
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: post().headers,
      body: stream,
      duplex: 'half',
    };
    const response = await f.draftHandlers.POST(
      new Request(base + '/api/checkpoints/drafts', init),
    );
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(f.drafts.save).not.toHaveBeenCalled();
  });
  it('does not convert an aborted stream into an empty draft clear', async () => {
    const f = fixture(),
      cancel = vi.fn(),
      controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(source) {
        source.enqueue(new Uint8Array([65]));
      },
      cancel,
    });
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: post().headers,
      body: stream,
      duplex: 'half',
      signal: controller.signal,
    };
    const pending = f.draftHandlers.POST(new Request(base + '/api/checkpoints/drafts', init));
    await vi.waitFor(() => expect(f.drafts.context).toHaveBeenCalled());
    controller.abort();
    expect((await pending).status).toBe(503);
    expect(cancel).toHaveBeenCalledOnce();
    expect(f.drafts.save).not.toHaveBeenCalled();
  });
});

it('canonicalizes UUID casing at the PostgreSQL boundary and reports a commit-time definition mismatch', async () => {
  const attempt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    request = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const f = fixture();
  vi.mocked(f.drafts.context).mockResolvedValue({
    ...context,
    scope: { ...context.scope, attemptId: attempt },
  });
  const response = await f.draftHandlers.POST(
    post('source', {
      'x-attempt-id': attempt.toUpperCase(),
      'idempotency-key': request.toUpperCase(),
    }),
  );
  expect(response.status).toBe(200);
  expect(vi.mocked(f.drafts.save).mock.calls[0]![0].requestId).toBe(request);
  vi.mocked(f.drafts.save).mockRejectedValue(new EditorApiError('DEFINITION_MISMATCH'));
  expect((await f.draftHandlers.POST(post('source', { 'x-attempt-id': attempt }))).status).toBe(
    412,
  );
});
