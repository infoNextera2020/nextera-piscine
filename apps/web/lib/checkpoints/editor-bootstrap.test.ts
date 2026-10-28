import { describe, expect, it, vi } from 'vitest';
import { AccessDenied, type DomainUser } from '@nextera/domain';
import {
  createCheckpointEditorHandler,
  EditorApiError,
  type CheckpointDraftBackend,
  type EditorServerContext,
} from './editor-http';
import {
  loadCheckpointEditor,
  parseEditorBootstrap,
  readEditorJson,
  type EditorBootstrap,
  type EditorIdentity,
} from './editor-bootstrap';
import { CheckpointDraftSync, sendDraftIntent, type DraftWriteOutcome } from './editor-sync';
import type { SaveIntent } from './editor-drafts';

const learnerId = '00000000-0000-4000-8000-000000000001',
  cohortId = '00000000-0000-4000-8000-000000000002',
  attemptId = '00000000-0000-4000-8000-000000000003';
const id = '00000000-0000-4000-8000-000000000004',
  id2 = '00000000-0000-4000-8000-000000000005';
const digest = 'a'.repeat(64),
  source = '\uFEFFpackage main\r\n// café\n';
const expected: EditorIdentity = { learnerId, cohortId, attemptId, taskKey: 'question-a' };
const context: EditorServerContext = {
  scope: { ...expected, definitionDigest: digest },
  readAllowed: true,
  status: 'active',
  serverNow: '2026-10-27T10:00:00Z',
  deadline: '2026-10-27T11:00:00Z',
  sourceBytes: 1024,
  filename: 'answer.go',
};
const user: DomainUser = {
  id: learnerId,
  authUserId: id2,
  displayName: 'Test learner',
  role: 'learner',
  active: true,
};
const url = `http://localhost/api/checkpoints/editor?attempt=${attemptId}&task=question-a`;
function fixture() {
  const authenticate = vi.fn(async () => user);
  const backend: CheckpointDraftBackend = {
    context: vi.fn(async () => context),
    read: vi.fn(async () => null),
    save: vi.fn(),
  };
  return { authenticate, backend, GET: createCheckpointEditorHandler({ authenticate, backend }) };
}
function payload(): EditorBootstrap {
  return {
    schema: 1,
    window: {
      scope: context.scope,
      access: 'confirmed',
      attempt: 'active',
      serverNow: context.serverNow,
      deadline: context.deadline,
      capabilities: { draftsV1: true, officialSubmit: false, visibleRun: null },
    },
    filename: 'answer.go',
    sourceBytes: 1024,
    draft: null,
    offlineRecovery: null,
  };
}
async function bootstrap() {
  const f = fixture();
  return (await (await f.GET(new Request(url))).json()) as EditorBootstrap;
}
function setup(initial?: string) {
  let now = 0;
  const write = vi.fn<(intent: SaveIntent) => Promise<DraftWriteOutcome>>(async () => ({
    kind: 'saved',
    version: 1,
  }));
  const requestId = vi.fn(() => id);
  const controller = new CheckpointDraftSync(
    payload(),
    { now: () => now, requestId, write },
    initial,
  );
  return {
    controller,
    write,
    requestId,
    clock: (value: number) => {
      now = value;
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Attested Checkpoint editor bootstrap', () => {
  it('returns authoritative scope with an empty first draft and no implied Run, Submit or recovery permission', async () => {
    const f = fixture(),
      response = await f.GET(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(await response.json()).toEqual(payload());
    expect(f.backend.save).not.toHaveBeenCalled();
    expect(f.backend.read).toHaveBeenCalledWith({ id: learnerId, authUserId: id2 }, context.scope);
  });
  it('includes exact existing draft bytes without changing them or revealing Auth IDs', async () => {
    const f = fixture();
    vi.mocked(f.backend.read).mockResolvedValue({ source, version: 2, requestId: id });
    const data = await (await f.GET(new Request(url))).json();
    expect(data.draft).toEqual({ source, version: 2, requestId: id, definitionDigest: digest });
    expect(JSON.stringify(data)).not.toContain(id2);
  });
  it.each(['UNAUTHENTICATED', 'INACTIVE', 'FORBIDDEN'] as const)(
    'rejects %s before reading protected data',
    async (code) => {
      const f = fixture();
      f.authenticate.mockRejectedValue(new AccessDenied(code));
      expect((await f.GET(new Request(url))).status).toBe(code === 'UNAUTHENTICATED' ? 401 : 403);
      expect(f.backend.context).not.toHaveBeenCalled();
    },
  );
  it.each(['admin', 'operator'] as const)(
    'does not bootstrap learner drafts for %s',
    async (role) => {
      const f = fixture();
      f.authenticate.mockResolvedValue({ ...user, role });
      expect((await f.GET(new Request(url))).status).toBe(403);
      expect(f.backend.read).not.toHaveBeenCalled();
    },
  );
  it('fails closed when production backend is absent', async () => {
    const GET = createCheckpointEditorHandler({ authenticate: async () => user, backend: null });
    expect((await GET(new Request(url))).status).toBe(503);
  });
  it.each(['?attempt=bad&task=question-a', `?attempt=${attemptId}&task=../secret`])(
    'rejects invalid task query %s',
    async (query) => {
      const f = fixture();
      expect(
        (await f.GET(new Request('http://localhost/api/checkpoints/editor' + query))).status,
      ).toBe(400);
      expect(f.backend.context).not.toHaveBeenCalled();
    },
  );
  it.each([
    { readAllowed: false },
    { scope: { ...context.scope, learnerId: id2 } },
    { scope: { ...context.scope, attemptId: id2 } },
    { scope: { ...context.scope, taskKey: 'other' } },
  ])('rejects a scope/access mismatch %o', async (patch) => {
    const f = fixture();
    vi.mocked(f.backend.context).mockResolvedValue({ ...context, ...patch });
    expect((await f.GET(new Request(url))).status).toBe(403);
    expect(f.backend.read).not.toHaveBeenCalled();
  });
  it.each([
    { serverNow: 'invalid' },
    { deadline: 'invalid' },
    { filename: '../answer.go' },
    { sourceBytes: 262145 },
  ])('fails closed on malformed capability metadata %o', async (patch) => {
    const f = fixture();
    vi.mocked(f.backend.context).mockResolvedValue({ ...context, ...patch });
    expect((await f.GET(new Request(url))).status).toBe(503);
    expect(f.backend.read).not.toHaveBeenCalled();
  });
  it('can read a closed authorized attempt without authorizing further saves', async () => {
    const f = fixture();
    vi.mocked(f.backend.context).mockResolvedValue({ ...context, status: 'closed' });
    const value = await (await f.GET(new Request(url))).json();
    const sync = new CheckpointDraftSync(
      value,
      { now: () => 0, requestId: () => id, write: vi.fn() },
      'source',
    );
    expect(await sync.save()).toEqual({ blocked: 'closed' });
  });
  it('does not leak storage exceptions or malformed persisted records', async () => {
    const f = fixture();
    vi.mocked(f.backend.read).mockRejectedValue(new Error('private storage detail'));
    let response = await f.GET(new Request(url));
    expect(await response.json()).toEqual({ error: 'EDITOR_CAPABILITY_UNAVAILABLE' });
    vi.mocked(f.backend.read).mockResolvedValue({
      source: 'x'.repeat(1025),
      version: 1,
      requestId: id,
    });
    response = await f.GET(new Request(url));
    expect(response.status).toBe(503);
  });
  it('rechecks storage read authorization after obtaining context', async () => {
    const f = fixture();
    vi.mocked(f.backend.read).mockRejectedValue(new EditorApiError('FORBIDDEN'));
    expect((await f.GET(new Request(url))).status).toBe(403);
  });
});

describe('Browser bootstrap and exact draft transport', () => {
  it('accepts only a fully attested expected identity', async () => {
    const value = await bootstrap();
    expect(parseEditorBootstrap(value, expected).window.scope).toEqual(context.scope);
    for (const key of ['learnerId', 'cohortId', 'attemptId', 'taskKey'] as const)
      expect(() => parseEditorBootstrap(value, { ...expected, [key]: id2 })).toThrow();
    for (const patch of [
      { offlineRecovery: { retentionMs: 0 } },
      { sourceBytes: 0 },
      { filename: 'x/y.go' },
      { draft: { source: 'x', version: -1, requestId: null } },
    ])
      expect(() => parseEditorBootstrap({ ...value, ...patch }, expected)).toThrow();
    expect(() =>
      parseEditorBootstrap(
        {
          ...value,
          window: {
            ...value.window,
            capabilities: { ...value.window.capabilities, visibleRun: {} },
          },
        },
        expected,
      ),
    ).toThrow();
  });
  it.each([
    [401, 'session_expired'],
    [403, 'removed'],
    [503, 'unavailable'],
  ] as const)('maps HTTP %i without fabricating bootstrap', async (status, reason) => {
    const send = vi.fn<typeof fetch>(async () => new Response('', { status }));
    expect(await loadCheckpointEditor(expected, send)).toEqual({ kind: 'blocked', reason });
  });
  it('uses only the task identity in the request and validates the returned scope', async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json(payload()));
    expect((await loadCheckpointEditor(expected, send)).kind).toBe('available');
    expect(send.mock.calls[0]![0]).toBe(
      `/api/checkpoints/editor?attempt=${attemptId}&task=question-a`,
    );
    expect(send.mock.calls[0]![1]).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    send.mockResolvedValue(
      Response.json({
        ...payload(),
        window: { ...payload().window, scope: { ...context.scope, learnerId: id2 } },
      }),
    );
    expect((await loadCheckpointEditor(expected, send)).kind).toBe('blocked');
  });
  it('bounds untrusted JSON and rejects invalid UTF8', async () => {
    await expect(readEditorJson(new Response('x'.repeat(8200)), 1)).rejects.toThrow();
    await expect(readEditorJson(new Response(new Uint8Array([255])), 1)).rejects.toThrow();
  });
  it('sends exact immutable source and CAS metadata with no graded-submission operation', async () => {
    const intent: SaveIntent = {
      scope: context.scope,
      requestId: id,
      source,
      revision: 0,
      baseVersion: 0,
    };
    const send = vi.fn<typeof fetch>(async () =>
      Response.json({ source, version: 1, requestId: id, definitionDigest: digest }),
    );
    expect(await sendDraftIntent(intent, 1024, send)).toEqual({ kind: 'saved', version: 1 });
    const [path, init] = send.mock.calls[0]!;
    expect(path).toBe('/api/checkpoints/drafts');
    expect(new Uint8Array(await (init!.body as Blob).arrayBuffer())).toEqual(
      new TextEncoder().encode(source),
    );
    expect(init!.headers).toMatchObject({
      'x-definition-digest': digest,
      'x-base-version': '0',
      'idempotency-key': id,
    });
  });
  it('maps explicit conflicts and refuses mismatched save acknowledgements', async () => {
    const intent: SaveIntent = {
      scope: context.scope,
      requestId: id,
      source,
      revision: 0,
      baseVersion: 0,
    };
    const remote = { source: 'server', version: 2, requestId: id2, definitionDigest: digest };
    expect(
      await sendDraftIntent(intent, 1024, async () =>
        Response.json({ error: 'DRAFT_CONFLICT', current: remote }, { status: 409 }),
      ),
    ).toEqual({ kind: 'conflict', source: 'server', version: 2 });
    for (const patch of [
      { source: 'other' },
      { requestId: id2 },
      { version: 0 },
      { definitionDigest: 'b'.repeat(64) },
    ])
      expect(
        (
          await sendDraftIntent(intent, 1024, async () =>
            Response.json({
              source,
              requestId: id,
              version: 1,
              definitionDigest: digest,
              ...patch,
            }),
          )
        ).kind,
      ).toBe('uncertain');
  });
});

describe('Per-question save and recovery orchestration', () => {
  it('starts from a server record, preserving text typed before bootstrap completes', () => {
    const boot = { ...payload(), draft: { source: 'server', version: 5, requestId: id2 } };
    const sync = new CheckpointDraftSync(
      boot,
      { now: () => 0, requestId: () => id, write: vi.fn() },
      'typed while loading',
    );
    expect(sync.state.draft).toMatchObject({ source: 'typed while loading', serverVersion: 5 });
    expect(sync.state.status).toBe('unsaved');
  });
  it('preserves later edits while acknowledging only the saved revision', async () => {
    const f = setup(source),
      waiting = deferred<DraftWriteOutcome>();
    f.write.mockReturnValue(waiting.promise);
    const first = f.controller.save();
    expect(f.controller.state.status).toBe('saving');
    f.controller.edit('later edits');
    expect(await f.controller.save()).toEqual({ blocked: 'save_pending' });
    waiting.resolve({ kind: 'saved', version: 1 });
    await first;
    expect(f.controller.state.draft.source).toBe('later edits');
    expect(f.controller.state.status).toBe('unsaved');
    f.write.mockResolvedValue({ kind: 'saved', version: 2 });
    await f.controller.save();
    expect(f.write.mock.calls[1]![0]).toMatchObject({ source: 'later edits', baseVersion: 1 });
    expect(f.controller.state.status).toBe('saved');
  });
  it('retries an uncertain save with the original source/id/base, not later edits', async () => {
    const f = setup(source);
    f.write.mockRejectedValueOnce(new Error('lost acknowledgement'));
    await f.controller.save();
    const original = f.write.mock.calls[0]![0];
    f.controller.edit('later');
    f.requestId.mockReturnValue(id2);
    await f.controller.save();
    expect(f.write.mock.calls[1]![0]).toBe(original);
    expect(f.controller.state.draft.source).toBe('later');
    expect(f.controller.state.status).toBe('unsaved');
  });
  it('can reconcile a valid uncertain write even after later edits exceed the size ceiling', async () => {
    const f = setup(source);
    f.write.mockResolvedValueOnce({ kind: 'uncertain', reason: 'network' });
    await f.controller.save();
    f.controller.edit('x'.repeat(1025));
    await f.controller.save();
    expect(f.write.mock.calls[1]![0].source).toBe(source);
    expect(f.controller.state.status).toBe('unsaved');
  });
  it('does not remain stuck saving after a malformed injected acknowledgement', async () => {
    const f = setup(source);
    f.write.mockResolvedValue({ kind: 'saved', version: 0 });
    await f.controller.save();
    expect(f.controller.state.status).toBe('failed');
  });
  it('requires an explicit choice for cross-device conflict', async () => {
    const f = setup(source);
    f.write.mockResolvedValue({ kind: 'conflict', source: 'remote', version: 2 });
    await f.controller.save();
    expect(f.controller.state.status).toBe('conflict');
    expect(f.controller.state.draft.source).toBe(source);
    expect(await f.controller.save()).toEqual({ blocked: 'conflict' });
    f.controller.resolveConflict('keep_local');
    expect(f.controller.state.draft).toMatchObject({ source, serverVersion: 2 });
  });
  it('uses the server version only after explicit use-server resolution', async () => {
    const f = setup(source);
    f.write.mockResolvedValue({ kind: 'conflict', source: 'remote', version: 2 });
    await f.controller.save();
    f.controller.resolveConflict('use_server');
    expect(f.controller.state.draft.source).toBe('remote');
    expect(f.controller.state.status).toBe('saved');
  });
  it('blocks writes after elapsed server deadline and an unavailable/reversed clock', async () => {
    for (const elapsed of [3600000, 3600001, NaN, -1, 1e20]) {
      const f = setup(source);
      f.clock(elapsed);
      expect((await f.controller.save()).blocked).toBe(
        elapsed >= 3600000 && elapsed < 1e20 ? 'expired' : 'unknown',
      );
      expect(f.write).not.toHaveBeenCalled();
    }
  });
  it('clears protected state and ignores a late acknowledgement after access removal', async () => {
    const f = setup(source),
      waiting = deferred<DraftWriteOutcome>();
    f.write.mockReturnValue(waiting.promise);
    const pending = f.controller.save();
    f.controller.refresh({ ...payload().window, access: 'removed' });
    waiting.resolve({ kind: 'saved', version: 1 });
    await pending;
    expect(f.controller.state).toMatchObject({ blocked: 'removed', draft: { source: '' } });
    expect(await f.controller.save()).toEqual({ blocked: 'removed' });
  });
  it('does not cross a different question/learner/definition scope', () => {
    const f = setup(source);
    f.controller.refresh({
      ...payload().window,
      scope: { ...context.scope, definitionDigest: 'b'.repeat(64) },
    });
    expect(f.controller.state).toMatchObject({ blocked: 'scope_mismatch', draft: { source: '' } });
  });
  it.each(['removed', 'session_expired', 'definition_mismatch'] as const)(
    'invalidates a draft on server %s',
    async (reason) => {
      const f = setup(source);
      f.write.mockResolvedValue({ kind: 'blocked', reason });
      await f.controller.save();
      expect(f.controller.state).toMatchObject({ blocked: reason, draft: { source: '' } });
    },
  );
  it('has no default local retention and caps an explicitly proposed recovery envelope at the deadline', () => {
    const f = setup(source);
    expect(f.controller.recoveryEnvelope(null)).toBeNull();
    expect(f.controller.recoveryEnvelope({ retentionMs: 0 })).toBeNull();
    expect(f.controller.recoveryEnvelope({ retentionMs: 7200000 })).toMatchObject({
      source,
      expiresAt: context.deadline.replace('Z', '.000Z'),
    });
    f.clock(3600000);
    expect(f.controller.recoveryEnvelope({ retentionMs: 1000 })).toBeNull();
  });
  it('retains an empty draft for autosave without submitting/evaluating it', async () => {
    const f = setup('');
    await f.controller.save();
    expect(f.write.mock.calls[0]![0].source).toBe('');
    expect(f.controller.state.status).toBe('saved');
  });
  it('rejects oversized or non-roundtrippable source before transport', async () => {
    for (const value of ['x'.repeat(1025), '\uD800']) {
      const f = setup(value);
      expect(await f.controller.save()).toEqual({ blocked: 'source_invalid' });
      expect(f.write).not.toHaveBeenCalled();
    }
  });
});

describe('Independent server-attested official Submit bootstrap', () => {
  function official(submitAllowed = true) {
    return { context: vi.fn(async () => ({ ...context, submitAllowed })) };
  }
  it('attests official intake without claiming draft, Run or recovery readiness', async () => {
    const authority = official();
    const GET = createCheckpointEditorHandler({
      authenticate: async () => user,
      backend: null,
      officialSubmission: authority,
    });
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value.window.capabilities).toEqual({
      draftsV1: false,
      officialSubmit: true,
      visibleRun: null,
    });
    expect(value.draft).toBeNull();
    expect(value.offlineRecovery).toBeNull();
    expect(parseEditorBootstrap(value, expected).window.capabilities).toEqual(
      value.window.capabilities,
    );
    expect(authority.context).toHaveBeenCalledWith(
      { id: learnerId, authUserId: id2 },
      { attemptId, taskKey: 'question-a' },
    );
    expect(JSON.stringify(value)).not.toContain(id2);
  });
  it.each([
    { submitAllowed: false },
    { submitAllowed: true, status: 'closed' },
    { submitAllowed: true, serverNow: context.deadline },
  ])('does not authorize Submit for closed or denied context %o', async (patch) => {
    const authority = official();
    authority.context.mockResolvedValue({ ...context, ...patch } as Awaited<
      ReturnType<typeof authority.context>
    >);
    const GET = createCheckpointEditorHandler({
      authenticate: async () => user,
      backend: null,
      officialSubmission: authority,
    });
    const value = await (await GET(new Request(url))).json();
    expect(value.window.capabilities.officialSubmit).toBe(false);
    expect(value.window.capabilities.draftsV1).toBe(false);
  });
  it('does not accept an authority boolean from query strings', async () => {
    const GET = createCheckpointEditorHandler({
      authenticate: async () => user,
      backend: null,
      officialSubmission: official(false),
    });
    const value = await (await GET(new Request(url + '&officialSubmit=true&draftsV1=true'))).json();
    expect(value.window.capabilities).toEqual({
      draftsV1: false,
      officialSubmit: false,
      visibleRun: null,
    });
  });
  it.each([
    { filename: 'different.go' },
    { sourceBytes: 512 },
    { deadline: '2026-10-27T12:00:00Z' },
    { scope: { ...context.scope, definitionDigest: 'b'.repeat(64) } },
  ])('rejects disagreement with the separate draft authority %o', async (patch) => {
    const f = fixture(),
      authority = official();
    authority.context.mockResolvedValue({ ...context, submitAllowed: true, ...patch });
    const GET = createCheckpointEditorHandler({
      authenticate: f.authenticate,
      backend: f.backend,
      officialSubmission: authority,
    });
    expect((await GET(new Request(url))).status).toBe(503);
    expect(f.backend.read).not.toHaveBeenCalled();
  });
  it('rejects malformed or mismatched official authority without reading protected drafts', async () => {
    const f = fixture(),
      authority = official();
    const GET = createCheckpointEditorHandler({
      authenticate: f.authenticate,
      backend: f.backend,
      officialSubmission: authority,
    });
    authority.context.mockResolvedValue({ ...context, submitAllowed: 'true' } as never);
    expect((await GET(new Request(url))).status).toBe(503);
    authority.context.mockResolvedValue({
      ...context,
      submitAllowed: true,
      scope: { ...context.scope, learnerId: id2 },
    });
    expect((await GET(new Request(url))).status).toBe(403);
    expect(f.backend.read).not.toHaveBeenCalled();
  });
  it('retains a protected draft when both independent capabilities are configured', async () => {
    const f = fixture();
    vi.mocked(f.backend.read).mockResolvedValue({ source, version: 2, requestId: id });
    const GET = createCheckpointEditorHandler({
      authenticate: f.authenticate,
      backend: f.backend,
      officialSubmission: official(),
    });
    const value = await (await GET(new Request(url))).json();
    expect(value.window.capabilities).toEqual({
      draftsV1: true,
      officialSubmit: true,
      visibleRun: null,
    });
    expect(parseEditorBootstrap(value, expected).draft?.source).toBe(source);
  });
  it('rejects draft payload or recovery when draft capability is absent', () => {
    const original = payload();
    const value = {
      ...original,
      window: {
        ...original.window,
        capabilities: { draftsV1: false, officialSubmit: true, visibleRun: null },
      },
    };
    expect(() =>
      parseEditorBootstrap(
        { ...value, draft: { source: 'private', version: 1, requestId: id } },
        expected,
      ),
    ).toThrow();
    expect(() =>
      parseEditorBootstrap({ ...value, offlineRecovery: { retentionMs: 1000 } }, expected),
    ).toThrow();
    for (const caps of [
      { draftsV1: 'false', officialSubmit: true, visibleRun: null },
      { draftsV1: false, officialSubmit: 'true', visibleRun: null },
    ])
      expect(() =>
        parseEditorBootstrap(
          { ...value, window: { ...value.window, capabilities: caps } },
          expected,
        ),
      ).toThrow();
  });
});
