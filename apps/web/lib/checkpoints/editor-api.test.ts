import { createHash } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { AccessDenied, type DomainUser } from '@nextera/domain';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
vi.mock('server-only', () => ({}));
import { createCheckpointEditorApi } from './editor-api';
import { loadCheckpointEditor } from './editor-bootstrap';
import { CheckpointDraftSync, sendDraftIntent } from './editor-sync';

const learner = '00000000-0000-4000-8000-000000000001',
  auth = '00000000-0000-4000-8000-000000000002',
  cohort = '00000000-0000-4000-8000-000000000003',
  attempt = '00000000-0000-4000-8000-000000000004',
  requestId = '00000000-0000-4000-8000-000000000005',
  otherRequest = '00000000-0000-4000-8000-000000000006';
const expected = {
    learnerId: learner,
    cohortId: cohort,
    attemptId: attempt,
    taskKey: 'question-a',
  },
  scope = { ...expected, definitionDigest: 'a'.repeat(64) },
  origin = 'http://localhost:3150';
const user: DomainUser = {
  id: learner,
  authUserId: auth,
  role: 'learner',
  active: true,
  displayName: 'Synthetic learner',
};
const official = {
  scope,
  readAllowed: true,
  status: 'active',
  serverNow: '2026-10-28T14:00:00Z',
  deadline: '2026-10-28T15:00:00Z',
  sourceBytes: 1024,
  filename: 'answer.go',
  submitAllowed: true,
};
function record(source: string, version = 1, request = requestId) {
  const bytes = Buffer.from(source);
  return {
    scope,
    sourceBase64: bytes.toString('base64'),
    sourceDigest: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    version,
    requestId: request,
    expiresAt: '2026-10-28T15:01:00Z',
  };
}
/** Injected SQL replies only: no database, network listener, browser or Auth service. */
function fixture(draftStorage: unknown = 'postgres-v1') {
  const state = {
    draftReady: true,
    officialReady: true,
    draftContext: { ...official, sourceBytes: 128 },
    officialContext: { ...official },
    read: null as unknown,
    save: null as unknown,
    saveError: null as unknown,
  };
  const dialect = new PgDialect();
  const calls: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement);
    calls.push(query);
    if (query.sql.startsWith('SELECT app.checkpoint_draft_context('))
      return [{ data: state.draftContext }];
    if (query.sql.startsWith('SELECT app.checkpoint_editor_context('))
      return [{ data: state.officialContext }];
    if (query.sql.startsWith('SELECT app.read_checkpoint_draft(')) return [{ data: state.read }];
    if (query.sql.startsWith('SELECT app.save_checkpoint_draft(')) {
      if (state.saveError) throw state.saveError;
      return [{ data: state.save }];
    }
    if (query.sql.includes('AS caller_isolation'))
      return [{ contract: state.officialReady, caller_isolation: true }];
    if (query.sql.includes('AS isolated_tables'))
      return [
        { contract: state.draftReady, isolated_tables: true, web_caller: true, guards: true },
      ];
    throw new Error('Unexpected fake SQL statement');
  });
  const database = vi.fn(() => ({ execute }) as unknown as OperationalDatabase);
  const authenticate = vi.fn(async () => user);
  const api = createCheckpointEditorApi({ authenticate, database, draftStorage });
  const send = vi.fn<typeof fetch>(async (input, init) => {
    // Browser-equivalent automatic Origin/Host are supplied by this in-process transport.
    // This deliberately does not contact localhost or retry the denied browser route.
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      origin,
    );
    const headers = new Headers(init?.headers);
    headers.set('host', url.host);
    if (init?.method === 'POST') headers.set('origin', origin);
    const request = new Request(url, { ...init, headers });
    if (url.pathname === '/api/checkpoints/editor') return api.bootstrap(request);
    if (url.pathname === '/api/checkpoints/drafts')
      return request.method === 'POST' ? api.drafts.POST(request) : api.drafts.GET(request);
    throw new Error('No official Submit or Run transport in this fixture');
  });
  return { state, calls, execute, database, authenticate, api, send };
}
async function bootstrap(f: ReturnType<typeof fixture>) {
  const loaded = await loadCheckpointEditor(expected, f.send);
  expect(loaded.kind).toBe('available');
  if (loaded.kind !== 'available') throw new Error('Bootstrap unavailable');
  return loaded.bootstrap;
}
function sync(f: ReturnType<typeof fixture>, boot: Awaited<ReturnType<typeof bootstrap>>) {
  return new CheckpointDraftSync(boot, {
    now: () => 0,
    requestId: () => requestId,
    write: (intent) => sendDraftIntent(intent, boot.sourceBytes, f.send),
  });
}

describe('Checkpoint HTTP assembly with injected auth, SQL and fetch', () => {
  it('constructs without authentication, database acquisition or queries', () => {
    const f = fixture();
    expect(f.authenticate).not.toHaveBeenCalled();
    expect(f.database).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('bootstraps, saves exact source and reloads through the real adapters and client decoder', async () => {
    const f = fixture(),
      boot = await bootstrap(f),
      source = '\uFEFFpackage main\r\n// café\u0000\n',
      controller = sync(f, boot);
    expect(boot.sourceBytes).toBe(128); // Draft policy is stricter than official 1024-byte intake.
    expect(boot.window.capabilities).toEqual({
      draftsV1: true,
      officialSubmit: true,
      visibleRun: null,
    });
    expect(boot.offlineRecovery).toBeNull();
    f.state.save = { kind: 'saved', record: record(source) };
    controller.edit(source);
    expect(await controller.save()).toEqual({ status: 'saved', blocked: null });
    const accepted = f.calls.find((q) => q.sql.startsWith('SELECT app.save_checkpoint_draft('))!;
    expect(accepted.params).toEqual([
      auth,
      attempt,
      'question-a',
      scope.definitionDigest,
      requestId,
      0,
      Buffer.from(source).toString('base64'),
      createHash('sha256').update(Buffer.from(source)).digest('hex'),
    ]);
    f.state.read = record(source);
    expect((await bootstrap(f)).draft).toEqual({ source, version: 1, requestId });
    expect(f.authenticate).toHaveBeenCalledTimes(3);
    for (const [, init] of f.send.mock.calls) {
      expect(init).toMatchObject({
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
    }
    expect(
      f.calls.every((q) => !q.sql.includes('app.submissions') && !q.sql.includes('judge.jobs')),
    ).toBe(true);
  });
  it('returns explicit concurrent conflict without replacing local source', async () => {
    const f = fixture(),
      controller = sync(f, await bootstrap(f));
    f.state.save = { kind: 'conflict', current: record('other device', 2, otherRequest) };
    controller.edit('local source');
    expect((await controller.save()).status).toBe('conflict');
    expect(controller.state.draft.source).toBe('local source');
    controller.resolveConflict('use_server');
    expect(controller.state.draft.source).toBe('other device');
    expect(controller.state.draft.serverVersion).toBe(2);
  });
  it('preserves the exact intent across an uncertain acknowledgement and explicit retry', async () => {
    const f = fixture(),
      controller = sync(f, await bootstrap(f));
    f.state.saveError = new Error('Private connection detail');
    controller.edit('unsure');
    expect((await controller.save()).status).toBe('failed');
    expect(controller.state.draft.source).toBe('unsure');
    f.state.saveError = null;
    f.state.save = { kind: 'saved', record: record('unsure') };
    expect((await controller.save()).status).toBe('saved');
    const requests = f.calls.filter((q) => q.sql.startsWith('SELECT app.save_checkpoint_draft('));
    expect(requests).toHaveLength(2);
    expect(requests[0]!.params).toEqual(requests[1]!.params);
  });
  it.each(['UNAUTHENTICATED', 'INACTIVE', 'FORBIDDEN'] as const)(
    'rejects %s before any database acquisition',
    async (code) => {
      const f = fixture();
      f.authenticate.mockRejectedValue(new AccessDenied(code));
      expect(await loadCheckpointEditor(expected, f.send)).toEqual({
        kind: 'blocked',
        reason: code === 'UNAUTHENTICATED' ? 'session_expired' : 'removed',
      });
      expect(f.database).not.toHaveBeenCalled();
    },
  );
  it('rejects an operator before any protected query', async () => {
    const f = fixture();
    f.authenticate.mockResolvedValue({ ...user, role: 'operator' });
    expect((await loadCheckpointEditor(expected, f.send)).kind).toBe('blocked');
    expect(f.database).not.toHaveBeenCalled();
  });
  it.each(['draftReady', 'officialReady'] as const)(
    'keeps missing %s unavailable without protected-source fallback',
    async (key) => {
      const f = fixture();
      f.state[key] = false;
      expect(await loadCheckpointEditor(expected, f.send)).toEqual({
        kind: 'blocked',
        reason: 'unavailable',
      });
      expect(f.calls.some((q) => q.sql.startsWith('SELECT app.read_checkpoint_draft('))).toBe(
        false,
      );
    },
  );
  it('retains official-only metadata when drafts have no explicit opt-in', async () => {
    const f = fixture(null),
      boot = await bootstrap(f);
    expect(boot.sourceBytes).toBe(1024);
    expect(boot.window.capabilities.draftsV1).toBe(false);
    expect(boot.draft).toBeNull();
    expect(boot.offlineRecovery).toBeNull();
    expect(f.calls.some((q) => q.sql.startsWith('SELECT app.checkpoint_draft_context('))).toBe(
      false,
    );
  });
  it('fails closed on mismatched official and draft definitions before reading source', async () => {
    const f = fixture();
    f.state.officialContext = {
      ...official,
      scope: { ...scope, definitionDigest: 'b'.repeat(64) },
    };
    expect(await loadCheckpointEditor(expected, f.send)).toEqual({
      kind: 'blocked',
      reason: 'unavailable',
    });
    expect(f.calls.some((q) => q.sql.startsWith('SELECT app.read_checkpoint_draft('))).toBe(false);
  });
  it.each([
    ['42501', 'removed'],
    ['PD001', 'closed'],
    ['PD002', 'definition_mismatch'],
  ])('propagates commit-time %s as %s without a false saved state', async (code, reason) => {
    const f = fixture(),
      controller = sync(f, await bootstrap(f));
    f.state.saveError = { code, message: 'Private SQL text' };
    controller.edit('not accepted');
    await controller.save();
    expect(controller.state.status).not.toBe('saved');
    expect(controller.saveBlock()).toBe(reason);
  });
  it('blocks a deadline-crossed write before save RPC without inventing deadline submission', async () => {
    const f = fixture(),
      controller = sync(f, await bootstrap(f));
    f.state.draftContext = { ...f.state.draftContext, serverNow: official.deadline };
    controller.edit('late edit');
    await controller.save();
    expect(controller.saveBlock()).toBe('closed');
    expect(f.calls.some((q) => q.sql.startsWith('SELECT app.save_checkpoint_draft('))).toBe(false);
  });
});
