import { AsyncResource } from 'node:async_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNativeInvitationClientFactory,
  type NativeClientFactories,
  type NativeInvitationRpc,
} from './runtime-native-clients';
import type { InvitationRuntimeConfiguration } from './runtime-configuration-core';
import type { createNativeInvitationLoader } from './runtime-protected-loader';
vi.mock('server-only', () => ({}));
const id = '10000000-0000-4000-8000-000000000001';
const origin = 'http://127.0.0.1:3151',
  authOrigin = 'http://127.0.0.1:56531';
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
// Public fake transport bytes with a zero non-signature. Never signed, issued,
// usable at a provider, written to private storage or passed to real factories.
const fakeKey = (role: string) =>
  encode({ alg: 'HS256', typ: 'JWT' }) +
  '.' +
  encode({ role, iss: 'supabase', iat: 0, exp: 3600 }) +
  '.' +
  Buffer.alloc(32).toString('base64url');
function fixture() {
  let wall = 1000,
    mono = 1000,
    nonce = 0;
  const roles = {
    issuer: 'week1_auth_issuer_20261030_invitation1',
    activation: 'week1_auth_activate_20261030_invitation1',
    web: 'week1_auth_web_20261030_invitation1',
  };
  const c = {
    version: 1,
    profile: 'week1-auth-20261030-invitation1',
    scopeSha256: 'a'.repeat(64),
    sourceLockSha256: 'b'.repeat(64),
    reviewedHead: 'c'.repeat(40),
    issuerId: id,
    cohortId: id,
    curriculumVersionId: id,
    target: {
      root: '/home/anas/.local/share/nextera-judge/week1-auth-20261030-invitation1/run-001',
      project: '01coding-week1-auth-20261030-invitation1',
      database: 'foundation_test_week1_auth_20261030_invitation1',
      origin,
      authOrigin,
      dbHost: '127.0.0.1',
      dbPort: 56532,
      roles,
    },
    policy: { rates: {} },
  } as InvitationRuntimeConfiguration;
  const reviewed = {
    scopeSha256: c.scopeSha256,
    sourceLockSha256: c.sourceLockSha256,
    configurationSha256: 'd'.repeat(64),
    reviewedHead: c.reviewedHead,
    lease: {
      started: 0,
      deadline: 3600000,
      cleanupAt: 3420000,
      monotonicStarted: 0,
      monotonicDeadline: 3600000,
      ownerMessageId: 'Sentinel_' + 'e'.repeat(32),
      ownerApprovedAt: '1970-01-01T00:00:00Z',
      parentPid: 10,
      parentTicks: '1',
      guardPid: 11,
      guardTicks: '2',
    },
  };
  const credentials = {
    version: 1,
    profile: c.profile,
    scopeSha256: c.scopeSha256,
    configurationSha256: reviewed.configurationSha256,
    sourceLockSha256: c.sourceLockSha256,
    started: 0,
    deadline: 3600000,
    authOrigin,
    connections: Object.fromEntries(
      Object.entries(roles).map(([key, role]) => [
        key,
        'postgres://' + role + ':public-fake-placeholder@127.0.0.1:56532/' + c.target.database,
      ]),
    ),
    anonKey: fakeKey('anon'),
    serviceRoleKey: fakeKey('service_role'),
    cookieName: 'sb-127-auth-token',
    maxCookieBytes: 16384,
  };
  const loader = {
    reviewed,
    load: vi.fn(async () => ({ configuration: { bytes: Buffer.from(JSON.stringify(c)) } })),
    readCredentials: vi.fn(async () => credentials),
  } as unknown as ReturnType<typeof createNativeInvitationLoader>;
  const cancels = vi.fn(),
    ends = [vi.fn(async () => {}), vi.fn(async () => {}), vi.fn(async () => {})];
  const queries = vi.fn(() =>
    Object.assign(Promise.resolve([{ synthetic: true }]), { cancel: cancels }),
  );
  let pool = 0;
  const providerGet = vi.fn(async (token: string) => ({
    data: { user: { id } },
    error: null,
    token,
  }));
  const admin = {
    createUser: vi.fn(async () => ({ data: { user: { id } }, error: null })),
    getUserById: vi.fn(async () => ({ data: { user: { id } }, error: null })),
  } as never;
  let capturedFetch: typeof fetch | undefined;
  const f: NativeClientFactories = {
    postgres: vi.fn(() => ({ unsafe: queries, end: ends[pool++]! })),
    supabase: vi.fn((_url, _key, fetcher) => {
      capturedFetch = fetcher;
      return { getUser: providerGet, admin };
    }),
    fetch: vi.fn(async () => new Response('{}', { status: 200 })),
    uuid: () => '20000000-0000-4000-8000-' + (++nonce).toString().padStart(12, '0'),
    token: () => 'f'.repeat(43),
  };
  const rpc: NativeInvitationRpc = {
    readInvitationRuntimePolicyRows: vi.fn(async () => []),
    readInvitationRuntimeAuthorityRows: vi.fn(async () => []),
    consumeInvitationRuntimeIssuer: vi.fn(async () => true),
    consumeInvitationRuntimeIssueIngress: vi.fn(async () => true),
  };
  const request = (cookie?: string) =>
    new Request(origin + '/api/invitations/issue', {
      method: 'POST',
      headers: cookie ? { cookie } : {},
    });
  const factory = () =>
    createNativeInvitationClientFactory({
      loader,
      now: () => wall,
      monotonic: () => mono,
      factories: f,
      rpc,
    });
  const budget = (remainingMs = 3420000 - wall) =>
    Object.freeze({ wallCutoffMs: 3420000, monotonicCutoffMs: 3420000, remainingMs });
  return {
    c,
    credentials,
    loader,
    f,
    rpc,
    request,
    factory,
    budget,
    providerGet,
    cancels,
    ends,
    queries,
    fetcher: () => capturedFetch!,
    time: (n: number) => {
      wall = n;
      mono = n;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe('native invitation client adapters using injected factories only', () => {
  it('uses explicit limited DSNs and request cookie JWT without session refresh or ambient fallback', async () => {
    const f = fixture(),
      session =
        'base64-' +
        encode({
          access_token: 'public-fake-user-credential',
          refresh_token: 'ignored',
          user: { role: 'admin' },
        });
    const clients = await f.factory()(f.c, f.request('sb-127-auth-token=' + session), 3000000);
    expect(f.f.postgres).toHaveBeenCalledTimes(3);
    const first = vi.mocked(f.f.postgres).mock.calls[0]![0];
    expect(first).toMatchObject({
      host: '127.0.0.1',
      port: 56532,
      username: f.c.target.roles.issuer,
      database: f.c.target.database,
      prepare: false,
      max: 1,
      ssl: false,
    });
    expect(f.queries).not.toHaveBeenCalled();
    await clients.runBounded(f.budget(), () => clients.auth.getUser());
    expect(f.providerGet).toHaveBeenCalledWith('public-fake-user-credential');
    await clients.close();
    await clients.close();
    expect(f.ends.map((e) => e.mock.calls.length)).toEqual([1, 1, 1]);
  });
  it('accepts contiguous SSR cookie chunks and rejects conflicting or incomplete chunks before pools', async () => {
    const f = fixture(),
      session = 'base64-' + encode({ access_token: 'public-fake-user-credential' });
    const req = f.request(
      'sb-127-auth-token.0=' + session.slice(0, 12) + '; sb-127-auth-token.1=' + session.slice(12),
    );
    const clients = await f.factory()(f.c, req, 3000000);
    await clients.runBounded(f.budget(), () => clients.auth.getUser());
    expect(f.providerGet).toHaveBeenCalledWith('public-fake-user-credential');
    await clients.close();
    const g = fixture();
    await expect(g.factory()(g.c, g.request('sb-127-auth-token.1=bad'), 3000000)).rejects.toThrow();
    expect(g.f.postgres).not.toHaveBeenCalled();
  });
  it('rejects wrong target, extra secret fields, token lease claims and unpinned config before factories', async () => {
    const f = fixture();
    f.credentials.connections.web = 'postgres://other:fake@retained.invalid:5432/old';
    await expect(f.factory()(f.c, f.request(), 3000000)).rejects.toThrow(
      'INVITATION_NATIVE_OUTCOME_UNKNOWN',
    );
    expect(f.f.postgres).not.toHaveBeenCalled();
    const g = fixture();
    g.credentials.serviceRoleKey = fakeKey('anon');
    await expect(g.factory()(g.c, g.request(), 3000000)).rejects.toThrow();
    expect(g.f.postgres).not.toHaveBeenCalled();
    const h = fixture();
    Object.assign(h.credentials, { jwtSecret: 'must-never-be-web' });
    await expect(h.factory()(h.c, h.request(), 3000000)).rejects.toThrow();
    expect(h.f.postgres).not.toHaveBeenCalled();
  });
  it('closes every partial pool exactly once when a later factory throws, without raw diagnostics', async () => {
    const f = fixture();
    vi.mocked(f.f.postgres)
      .mockImplementationOnce(() => ({ unsafe: f.queries, end: f.ends[0]! }))
      .mockImplementationOnce(() => {
        throw new Error('public-fake-private-diagnostic');
      });
    await expect(f.factory()(f.c, f.request(), 3000000)).rejects.toThrow(
      'INVITATION_NATIVE_OUTCOME_UNKNOWN',
    );
    expect(f.ends[0]).toHaveBeenCalledTimes(1);
    expect(f.ends[1]).not.toHaveBeenCalled();
  });
  it('requires an operation boundary and sends raw native RPC bindings with fresh single-use nonces', async () => {
    const f = fixture(),
      request = f.request(),
      clients = await f.factory()(f.c, request, 3000000);
    await expect(clients.web.client.unsafe('SELECT synthetic')).rejects.toThrow();
    const rate = { profile: 'synthetic', windowMs: 1000, maxRequests: 2, retentionMs: 2000 };
    await clients.runBounded(f.budget(), () => clients.consumeIssueIngress(request, rate));
    await clients.runBounded(f.budget(), () => clients.consumeIssuer(id, rate));
    await expect(
      clients.runBounded(f.budget(), () => clients.consumeIssueIngress(request, rate)),
    ).rejects.toThrow();
    const call = vi.mocked(f.rpc.consumeInvitationRuntimeIssueIngress).mock.calls[0]!;
    expect(call[1]).toEqual({
      profile: f.c.profile,
      publicPolicySha256: 'd'.repeat(64),
      issuerId: id,
      cohortId: id,
      curriculumVersionId: id,
    });
    expect(call[2]).not.toBe(vi.mocked(f.rpc.consumeInvitationRuntimeIssuer).mock.calls[0]![2]);
    await clients.close();
  });
  it('aborts owned fetch and rejects a late provider response', async () => {
    const f = fixture(),
      clients = await f.factory()(f.c, f.request(), 3000000);
    vi.mocked(f.f.fetch).mockImplementationOnce(async (_input, init) => {
      f.time(3420000);
      expect(init?.redirect).toBe('error');
      return new Response('{}');
    });
    await expect(
      clients.runBounded(f.budget(), () => f.fetcher()(authOrigin + '/auth/v1/user')),
    ).rejects.toThrow('INVITATION_NATIVE_OUTCOME_UNKNOWN');
    expect(vi.mocked(f.f.fetch).mock.calls[0]![1]!.signal!.aborted).toBe(true);
    await clients.close();
  });
  it('cancels pending owned SQL at timeout and never returns a known success after ambiguity', async () => {
    vi.useFakeTimers();
    const f = fixture(),
      clients = await f.factory()(f.c, f.request(), 3000000);
    f.queries.mockImplementationOnce(() =>
      Object.assign(new Promise<never>(() => {}), { cancel: f.cancels }),
    );
    const running = clients.runBounded(f.budget(20), async () =>
      clients.web.client.unsafe('SELECT synthetic'),
    );
    const assertion = expect(running).rejects.toThrow('INVITATION_NATIVE_OUTCOME_UNKNOWN');
    f.time(1021);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(f.cancels).toHaveBeenCalledTimes(1);
    await clients.close();
  });
  it('rejects a never-settling long-budget operation promptly when its owned clients close', async () => {
    vi.useFakeTimers();
    const f = fixture(),
      clients = await f.factory()(f.c, f.request(), 3000000);
    f.queries.mockImplementationOnce(() =>
      Object.assign(new Promise<never>(() => {}), { cancel: f.cancels }),
    );
    let settled = false;
    const running = clients.runBounded(f.budget(), async () =>
      clients.web.client.unsafe('SELECT never_settles'),
    );
    const assertion = expect(running).rejects.toThrow('INVITATION_NATIVE_OUTCOME_UNKNOWN');
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    expect(f.queries).toHaveBeenCalledTimes(1);
    await clients.close();
    await clients.close();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await assertion;
    expect(f.cancels).toHaveBeenCalledTimes(1);
    expect(f.ends.map((end) => end.mock.calls.length)).toEqual([1, 1, 1]);
    await expect(
      clients.runBounded(f.budget(), async () =>
        clients.web.client.unsafe('SELECT forbidden_later'),
      ),
    ).rejects.toThrow('INVITATION_NATIVE_OUTCOME_UNKNOWN');
    expect(f.queries).toHaveBeenCalledTimes(1);
  });
  it('seals successful ALS descendants so queued callbacks cannot dispatch later', async () => {
    const f = fixture(),
      clients = await f.factory()(f.c, f.request(), 3000000);
    let laterSql: () => Promise<unknown> = async () => undefined;
    let laterFetch: () => Promise<unknown> = async () => undefined;
    expect(
      await clients.runBounded(f.budget(), async () => {
        // Node AsyncResource.bind preserves the same native ALS context even when
        // the callback is invoked after the parent operation has returned.
        laterSql = AsyncResource.bind(async () => clients.web.client.unsafe('SELECT stale'));
        laterFetch = AsyncResource.bind(async () => f.fetcher()(authOrigin + '/auth/v1/user'));
        return 'completed';
      }),
    ).toBe('completed');
    await expect(laterSql()).rejects.toThrow('INVITATION_NATIVE_OUTCOME_UNKNOWN');
    await expect(laterFetch()).rejects.toThrow('INVITATION_NATIVE_OUTCOME_UNKNOWN');
    expect(f.queries).not.toHaveBeenCalled();
    expect(f.f.fetch).not.toHaveBeenCalled();
    expect(
      await clients.runBounded(f.budget(), async () => clients.web.client.unsafe('SELECT fresh')),
    ).toEqual([{ synthetic: true }]);
    expect(f.queries).toHaveBeenCalledTimes(1);
    expect(f.cancels).not.toHaveBeenCalled(); // completed native query is already settled
    await clients.close();
  });
  it('blocks outbound provider redirects/origins and stale absolute cutoffs', async () => {
    const f = fixture(),
      clients = await f.factory()(f.c, f.request(), 3000000);
    await expect(
      clients.runBounded(f.budget(), () => f.fetcher()('https://outside.invalid/auth/v1/user')),
    ).rejects.toThrow();
    expect(f.f.fetch).not.toHaveBeenCalled();
    await expect(
      clients.runBounded(Object.freeze({ ...f.budget(), wallCutoffMs: 3420001 }), async () => true),
    ).rejects.toThrow();
    await clients.close();
  });
});
