import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createManagedAuthAdapter } from './managed-auth';
import { createInvitationActivation, type Phase } from './activation';
import { createInvitationActivationHandler } from './http';
import {
  createInvitationRequestConfiguration,
  type InvitationRuntimeConfiguration,
  type ImmutableInvitationLease,
  type InvitationRuntimeDependencies,
  type InvitationRuntimeClients,
  type ProtectedInput,
} from './runtime-configuration-core';

const root = '/home/anas/.local/share/nextera-judge/week1-auth-20261030-invitation1/run-001';
const id = '10000000-0000-4000-8000-000000000001';
const origin = 'http://127.0.0.1:3151';
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function fixture(
  change?: (c: InvitationRuntimeConfiguration, l: ImmutableInvitationLease) => void,
) {
  const approved = Date.parse('2026-10-30T00:00:00Z'),
    start = approved + 1000;
  let wall = start + 700000,
    mono = 1700000;
  const roles = {
    issuer: 'week1_auth_issuer_20261030_invitation1',
    activation: 'week1_auth_activate_20261030_invitation1',
    web: 'week1_auth_web_20261030_invitation1',
  };
  const rate = (profile: string, maxRequests: number) => ({
    profile,
    windowMs: 60000,
    maxRequests,
    retentionMs: 3600000,
  });
  const sourceLock = encode({ syntheticSourceOnly: true });
  const c: InvitationRuntimeConfiguration = {
    version: 1,
    profile: 'week1-auth-20261030-invitation1',
    scopeSha256: 'a'.repeat(64),
    sourceLockSha256: hash(sourceLock),
    reviewedHead: 'b'.repeat(40),
    target: {
      root,
      project: '01coding-week1-auth-20261030-invitation1',
      database: 'foundation_test_week1_auth_20261030_invitation1',
      origin,
      authOrigin: 'http://127.0.0.1:56531',
      dbHost: '127.0.0.1',
      dbPort: 56532,
      roles,
    },
    issuerId: id,
    cohortId: id,
    curriculumVersionId: id,
    learners: [
      {
        email: 'week1-a-20261030-invitation1@example.invalid',
        displayName: 'Week 1 Synthetic Learner A',
      },
      {
        email: 'week1-b-20261030-invitation1@example.invalid',
        displayName: 'Week 1 Synthetic Learner B',
      },
    ],
    policy: {
      emailConfirmed: true,
      passwordContract: 'ascii-synthetic-v1',
      minPasswordBytes: 20,
      maxPasswordBytes: 96,
      maxTokenBytes: 43,
      claimLeaseMs: 30000,
      maxLifetimeMs: 900000,
      maxBodyBytes: 4096,
      bodyTimeoutMs: 5000,
      publicTimeoutMs: 10000,
      maxResponseBytes: 4096,
      publicMaxPasswordBytes: 96,
      rates: {
        ingress: rate('in', 120),
        inspect: rate('inspect', 30),
        activate: rate('activate', 10),
        issueIngress: rate('issue_ingress', 20),
        issuer: rate('issuer', 4),
      },
    },
  };
  const lease: ImmutableInvitationLease = {
    ownerMessageId: 'Sentinel_' + 'e'.repeat(32),
    ownerApprovedAt: '2026-10-30T00:00:00Z',
    started: start,
    deadline: start + 3600000,
    cleanupAt: start + 3420000,
    monotonicStarted: 1000000,
    monotonicDeadline: 4600000,
    parentPid: 10,
    parentTicks: '100',
    guardPid: 11,
    guardTicks: '101',
  };
  change?.(c, lease);
  const reviewed = {
    scopeSha256: c.scopeSha256,
    sourceLockSha256: c.sourceLockSha256,
    reviewedHead: c.reviewedHead,
    configurationSha256: hash(encode(c)),
    lease: structuredClone(lease),
  };
  const stat = { uid: 1000, mode: 0o600, kind: 'file' as const };
  const input: ProtectedInput = {
    root: { path: root, stat: { uid: 1000, mode: 0o700, kind: 'directory' } },
    ancestors: [
      ...root
        .split('/')
        .slice(1, -1)
        .map((_, i, a) => ({
          path: '/' + a.slice(0, i + 1).join('/'),
          stat: { uid: 1000, mode: 0o700, kind: 'directory' as const },
        })),
      { path: root + '/adapter-code', stat: { uid: 1000, mode: 0o700, kind: 'directory' } },
    ],
    configuration: { path: root + '/server-configuration.json', stat, bytes: encode(c) },
    sourceLock: {
      path: root + '/adapter-code/week1-auth-source-lock.json',
      stat,
      bytes: sourceLock,
    },
    lease: {
      path: root + '/control.json',
      stat,
      bytes: encode({
        profile: c.profile,
        scopeSha256: c.scopeSha256,
        sourceLockSha256: c.sourceLockSha256,
        reviewedHead: c.reviewedHead,
        configurationSha256: reviewed.configurationSha256,
        state: 'active',
        phase: 'invitations_active',
        ...lease,
      }),
    },
  };
  const unsafe = (key: 'issuer' | 'activation' | 'web') =>
    vi.fn(async (sql: string) => {
      if (sql.includes('current_database()'))
        return [
          {
            database: c.target.database,
            login: roles[key],
            session_login: roles[key],
            rolsuper: false,
            rolbypassrls: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            invitation_owner: false,
            checkpoint_owner: false,
            memberships: [
              {
                issuer: 'nextera_invitation_issuer',
                activation: 'nextera_invitation_runtime',
                web: 'nextera_web',
              }[key],
            ],
          },
        ];
      if (sql.includes('invitation_operations_ready'))
        return [{ operations: true, admission: true }];
      if (sql.includes('FROM app.users'))
        return [{ id, auth_user_id: id, role: 'admin', active: true }];
      return [];
    });
  const issuer = unsafe('issuer'),
    activation = unsafe('activation'),
    web = unsafe('web');
  const bound = (key: 'issuer' | 'activation' | 'web', fn: unknown) => ({
    client: { unsafe: fn } as never,
    host: c.target.dbHost,
    port: c.target.dbPort,
    database: c.target.database,
    username: roles[key],
  });
  const close = vi.fn(async () => {});
  const getUser = vi.fn(async () => ({ data: { user: { id } }, error: null }));
  const admin = { createUser: vi.fn(), getUserById: vi.fn() } as never;
  const clients: InvitationRuntimeClients = {
    issuer: bound('issuer', issuer),
    activation: bound('activation', activation),
    web: bound('web', web),
    authOrigin: c.target.authOrigin,
    auth: { getUser },
    admin,
    close,
    consumeIssuer: vi.fn(async () => true),
    consumeIssueIngress: vi.fn(async () => true),
    capability: vi.fn(async () => ({ invitationId: id, token: 'f'.repeat(43) })),
    runBounded: async (_budget, operation) => operation(),
    readAuthorityRows: vi.fn(async () => [
      {
        issuer_id: c.issuerId,
        cohort_id: c.cohortId,
        curriculum_version_id: c.curriculumVersionId,
        issuer_login: c.target.roles.issuer,
        max_lifetime_ms: String(c.policy.maxLifetimeMs),
        enabled: true,
      },
    ]),
    readPolicyRows: vi.fn(async () =>
      (['ingress', 'inspect', 'activate'] as const).map((action) => ({
        id: c.policy.rates[action].profile,
        action,
        window_ms: c.policy.rates[action].windowMs,
        max_requests: c.policy.rates[action].maxRequests,
        retention_ms: String(c.policy.rates[action].retentionMs),
      })),
    ),
  };
  const deps: InvitationRuntimeDependencies = {
    uid: 1000,
    reviewed,
    load: vi.fn(async () => input),
    now: () => wall,
    monotonic: () => mono,
    process: vi.fn(async (pid) => ({ uid: 1000, ticks: pid === 10 ? '100' : '101' })),
    acquireClients: vi.fn(async () => clients),
  };
  return {
    c,
    lease,
    input,
    deps,
    clients,
    close,
    issuer,
    activation,
    web,
    getUser,
    app: () => createInvitationRequestConfiguration(deps),
    time: (w: number, m: number) => {
      wall = w;
      mono = m;
    },
    editLease: (values: Record<string, unknown>) => {
      const row = JSON.parse(new TextDecoder().decode(input.lease.bytes));
      Object.assign(row, values);
      (input.lease as { bytes: Uint8Array }).bytes = encode(row);
    },
  };
}
const req = () => new Request(origin + '/api/invitations/issue', { method: 'POST' });

describe('injected request-time invitation configuration (no native I/O)', () => {
  it('is unavailable without all privileged ports and never uses environment JSON', async () => {
    const app = createInvitationRequestConfiguration(null);
    expect(await app.activation(req())).toBeNull();
    expect(await app.issuance(req())).toBeNull();
    expect(await app.publicPolicy()).toBeNull();
  });
  it('checks fresh authority on each request; original start admission permits later requests', async () => {
    const f = fixture(),
      app = f.app();
    const acquired = await app.activation(req());
    expect(acquired).not.toBeNull();
    expect(f.deps.load).toHaveBeenCalled();
    expect(f.activation).toHaveBeenCalledWith(
      expect.stringContaining('invitation_operations_ready'),
      [true],
    );
    expect(await acquired!.settings.policy!.acceptsPassword('A'.repeat(20))).toBe(true);
    expect(await acquired!.settings.policy!.acceptsPassword('A'.repeat(97))).toBe(false);
    expect(await acquired!.settings.policy!.acceptsPassword('A'.repeat(19) + '\\')).toBe(false);
    await acquired!.close();
    await acquired!.close();
    expect(f.close).toHaveBeenCalledTimes(1);
    f.editLease({ state: 'revoking' });
    expect(await app.activation(req())).toBeNull();
  });
  it('projects only the public whitelist from the same protected configuration', async () => {
    const f = fixture();
    expect(await f.app().publicPolicy()).toEqual({
      enabled: true,
      timeoutMs: 10000,
      maxResponseBytes: 4096,
      maxPasswordBytes: 96,
    });
    (f.input.configuration as { bytes: Uint8Array }).bytes = encode({
      ...f.c,
      issuerId: 'changed',
    });
    expect(await f.app().publicPolicy()).toBeNull();
  });
  it.each([
    (c: InvitationRuntimeConfiguration) => {
      (c.target as { database: string }).database = 'retained';
    },
    (c: InvitationRuntimeConfiguration) => {
      (c.target as { origin: string }).origin = 'http://localhost:3151';
    },
    (c: InvitationRuntimeConfiguration) => {
      (c.policy as { emailConfirmed: unknown }).emailConfirmed = undefined;
    },
    (c: InvitationRuntimeConfiguration) => {
      (c.policy as { maxBodyBytes: number }).maxBodyBytes = 1289;
    },
    (c: InvitationRuntimeConfiguration) => {
      (c.policy as { publicMaxPasswordBytes: number }).publicMaxPasswordBytes = 95;
    },
    (c: InvitationRuntimeConfiguration) => {
      (c.policy as { claimLeaseMs: number }).claimLeaseMs = 900000;
    },
  ])('rejects target or explicit policy incoherence before clients', async (change) => {
    const f = fixture(change);
    expect(await f.app().activation(req())).toBeNull();
    expect(f.deps.acquireClients).not.toHaveBeenCalled();
  });
  it.each(['configuration', 'sourceLock', 'lease'] as const)(
    'rejects unsafe protected %s metadata',
    async (key) => {
      const f = fixture();
      (f.input[key].stat as { mode: number }).mode = 0o644;
      expect(await f.app().activation(req())).toBeNull();
      expect(f.deps.acquireClients).not.toHaveBeenCalled();
    },
  );
  it('rejects symlink ancestors, changed immutable lease, dead guard and wall/monotonic cutoff', async () => {
    const a = fixture();
    (a.input.ancestors.at(-1)!.stat as { kind: string }).kind = 'symlink';
    expect(await a.app().publicPolicy()).toBeNull();
    const b = fixture();
    b.editLease({ started: b.lease.started + 1 });
    expect(await b.app().publicPolicy()).toBeNull();
    const c = fixture();
    Object.assign(c.deps, { process: vi.fn(async () => null) });
    expect(await c.app().publicPolicy()).toBeNull();
    const d = fixture();
    d.time(d.lease.cleanupAt, 1700000);
    expect(await d.app().publicPolicy()).toBeNull();
    const e = fixture();
    e.time(e.lease.started + 700000, e.lease.monotonicDeadline - 180000);
    expect(await e.app().publicPolicy()).toBeNull();
  });
  it('rechecks cutoff after awaited process identity reads', async () => {
    const f = fixture();
    Object.assign(f.deps, {
      process: vi.fn(async (pid: number) => {
        f.time(f.lease.cleanupAt, 1700000);
        return { uid: 1000, ticks: pid === 10 ? '100' : '101' };
      }),
    });
    expect(await f.app().publicPolicy()).toBeNull();
    expect(f.deps.acquireClients).not.toHaveBeenCalled();
  });
  it('rejects closed owner evidence and start outside admission', async () => {
    const f = fixture((_, l) => {
      (l as { ownerMessageId: string }).ownerMessageId =
        'Sentinel_86aebfe913e48191b51fc427a33efe78';
    });
    expect(await f.app().publicPolicy()).toBeNull();
    const late = fixture((_, l) => {
      (l as { ownerApprovedAt: string }).ownerApprovedAt = '2026-10-29T23:00:00Z';
    });
    expect(await late.app().publicPolicy()).toBeNull();
  });
  it('preserves owner microseconds at the before-start and admission boundaries', async () => {
    const before = fixture((_, l) => {
      (l as { ownerApprovedAt: string }).ownerApprovedAt = '2026-10-30T00:00:01.000001Z';
    });
    expect(await before.app().publicPolicy()).toBeNull();
    const expired = fixture((_, l) => {
      (l as { ownerApprovedAt: string }).ownerApprovedAt = '2026-10-29T23:50:00.999999Z';
    });
    expect(await expired.app().publicPolicy()).toBeNull();
    const exact = fixture((_, l) => {
      (l as { ownerApprovedAt: string }).ownerApprovedAt = '2026-10-29T23:50:01.000000Z';
    });
    expect(await exact.app().publicPolicy()).not.toBeNull();
    expect(exact.lease.ownerApprovedAt).toBe('2026-10-29T23:50:01.000000Z');
  });
  it('preserves authentic +00:00 approval spelling and microsecond admission boundaries', async () => {
    const exact = fixture((_, l) => {
      (l as { ownerApprovedAt: string }).ownerApprovedAt = '2026-10-29T23:50:01.000000+00:00';
    });
    expect(await exact.app().publicPolicy()).not.toBeNull();
    expect(exact.lease.ownerApprovedAt).toBe('2026-10-29T23:50:01.000000+00:00');
    const expired = fixture((_, l) => {
      (l as { ownerApprovedAt: string }).ownerApprovedAt = '2026-10-29T23:50:00.999999+00:00';
    });
    expect(await expired.app().publicPolicy()).toBeNull();
    const future = fixture((_, l) => {
      (l as { ownerApprovedAt: string }).ownerApprovedAt = '2026-10-30T00:00:01.000001+00:00';
    });
    expect(await future.app().publicPolicy()).toBeNull();
  });
  it('rejects a native issuer/cohort/version authority mismatch without private table grants', async () => {
    const f = fixture();
    Object.assign(f.clients, { readAuthorityRows: vi.fn(async () => []) });
    expect(await f.app().activation(req())).toBeNull();
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('passes immutable absolute cutoffs and fresh remaining budget on every native operation', async () => {
    const f = fixture(),
      budgets: { wallCutoffMs: number; monotonicCutoffMs: number; remainingMs: number }[] = [];
    Object.assign(f.clients, {
      runBounded: async <T>(budget: (typeof budgets)[number], op: () => Promise<T>) => {
        budgets.push(budget);
        return op();
      },
    });
    const acquired = await f.app().activation(req());
    const original = budgets.at(-1)!.remainingMs;
    f.time(f.lease.started + 701000, 1701000);
    await acquired!.settings.admin!.getUserById(id);
    expect(budgets.at(-1)).toEqual({
      wallCutoffMs: f.lease.cleanupAt,
      monotonicCutoffMs: f.lease.monotonicDeadline - 180000,
      remainingMs: original - 1000,
    });
    await acquired!.close();
  });
  it('freezes budgets and rechecks authority at native queued dispatch', async () => {
    const f = fixture();
    let queued = false;
    Object.assign(f.clients, {
      runBounded: async <T>(
        budget: { wallCutoffMs: number; monotonicCutoffMs: number; remainingMs: number },
        operation: () => Promise<T>,
      ) => {
        expect(Object.isFrozen(budget)).toBe(true);
        if (queued) f.editLease({ state: 'revoking' });
        return operation();
      },
    });
    const acquired = await f.app().activation(req());
    queued = true;
    await expect(acquired!.settings.admin!.getUserById(id)).rejects.toThrow(
      'INVITATION_RUNTIME_UNAVAILABLE',
    );
    expect(f.clients.admin.getUserById).not.toHaveBeenCalled();
    await acquired!.close();
  });
  it('rejects nonfinite clocks after awaited native process reads', async () => {
    const f = fixture();
    Object.assign(f.deps, {
      process: vi.fn(async (pid: number) => {
        f.time(Number.NaN, 1700000);
        return { uid: 1000, ticks: pid === 10 ? '100' : '101' };
      }),
    });
    expect(await f.app().publicPolicy()).toBeNull();
    expect(f.deps.acquireClients).not.toHaveBeenCalled();
  });
  it('refuses a SQL reply that crosses into revocation and foreign ledger scope', async () => {
    const f = fixture(),
      acquired = await f.app().activation(req());
    f.activation.mockImplementationOnce(async () => {
      f.editLease({ state: 'revoking' });
      return [{ outcome: 'complete' }] as never;
    });
    await expect(
      acquired!.settings.admission!.client!.unsafe('SELECT synthetic_mutation()'),
    ).rejects.toThrow('INVITATION_RUNTIME_UNAVAILABLE');
    await acquired!.close();
    const g = fixture(),
      other = await g.app().activation(req());
    g.activation.mockResolvedValueOnce([
      {
        id,
        accepted_admission_id: id,
        cohort_id: '20000000-0000-4000-8000-000000000002',
        email: g.c.learners[0]!.email,
        display_name: g.c.learners[0]!.displayName,
      },
    ] as never);
    await expect(
      other!.settings.admission!.client!.unsafe('SELECT app.invitation_find($1)'),
    ).rejects.toThrow('INVITATION_RUNTIME_UNAVAILABLE');
    await other!.close();
  });
  it('returns recovery_required, never late activation success, after an ambiguous provider create', async () => {
    const f = fixture(),
      acquired = await f.app().activation(req());
    const admin = acquired!.settings.admin!;
    vi.mocked(f.clients.admin.getUserById).mockResolvedValue({
      data: { user: null },
      error: { code: 'user_not_found', status: 404 },
    } as never);
    vi.mocked(f.clients.admin.createUser).mockImplementationOnce(async () => {
      f.time(f.lease.cleanupAt, 1700000);
      return { data: { user: { id } }, error: null } as never;
    });
    const auth = createManagedAuthAdapter({
      enabled: true,
      admin,
      emailConfirmed: true,
      passwordAccepted: async () => true,
      authorize: async () => true,
    })!;
    const requestId = '20000000-0000-4000-8000-000000000002',
      tokenDigest = 'a'.repeat(64);
    let phase: Phase = 'issued';
    const invite = () => ({
      id,
      tokenDigest,
      admissionId: id,
      email: f.c.learners[0]!.email,
      displayName: f.c.learners[0]!.displayName,
      cohortId: id,
      expiresAt: f.lease.cleanupAt - 1000,
      revoked: false,
      phase,
      requestId,
      authUserId: null,
    });
    const ensure = vi.fn(async () => 'complete' as const),
      complete = vi.fn(async () => true);
    const activation = createInvitationActivation({
      policy: acquired!.settings.policy!,
      auth,
      eligibility: { current: async () => true },
      rate: { consume: async () => true },
      enrollment: { ensure },
      digestToken: async () => tokenDigest,
      now: f.deps.now,
      ledger: {
        find: async () => invite(),
        claim: async () => ({
          kind: 'acquired',
          invitation: invite(),
          lease: { invitationId: id, fence: '1' },
        }),
        advance: async (_lease, _expected, next) => {
          phase = next.phase;
          return invite();
        },
        complete,
        release: async () => {},
      },
    });
    const post = createInvitationActivationHandler({
      ...acquired!.settings.http!,
      ingress: { consume: async () => true },
      activation,
    });
    const response = await post(
      new Request(origin + '/api/invitations/activate', {
        method: 'POST',
        headers: { host: '127.0.0.1:3151', origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          token: 'f'.repeat(43),
          requestId,
          password: 'A'.repeat(20),
          confirmation: 'A'.repeat(20),
        }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'recovery_required' });
    expect(f.clients.admin.createUser).toHaveBeenCalledTimes(1);
    expect(ensure).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    await acquired!.close();
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('copies independent anchors and rejects a loader attempt to renew owner/start/deadline', async () => {
    const f = fixture(),
      app = f.app();
    (f.deps.reviewed.lease as { deadline: number }).deadline += 1000;
    expect(await app.publicPolicy()).not.toBeNull();
    f.editLease({ deadline: f.lease.deadline + 1000 });
    expect(await app.publicPolicy()).toBeNull();
  });
  it('uses verified provider identity and the same fresh restricted web client', async () => {
    const f = fixture(),
      acquired = await f.app().issuance(req());
    expect(await acquired!.settings.identity!()).toEqual({ id, role: 'admin', active: true });
    expect(f.getUser).toHaveBeenCalledTimes(1);
    expect(f.web).toHaveBeenCalledWith(expect.stringContaining('WHERE auth_user_id'), [id]);
    f.getUser.mockResolvedValueOnce({ data: { user: { id: 'invalid' } }, error: null });
    expect(await acquired!.settings.identity!()).toBeNull();
    await acquired!.close();
  });
  it('closes all acquired clients on failed native role/readiness/policy proof', async () => {
    const f = fixture();
    f.activation.mockResolvedValueOnce([{ database: 'wrong' }] as never);
    expect(await f.app().activation(req())).toBeNull();
    expect(f.close).toHaveBeenCalledTimes(1);
    const g = fixture();
    Object.assign(g.clients, { readPolicyRows: vi.fn(async () => []) });
    expect(await g.app().activation(req())).toBeNull();
    expect(g.close).toHaveBeenCalledTimes(1);
  });
  it('refuses aliased clients and rechecks revocation before any later provider operation', async () => {
    const f = fixture();
    (f.clients as { web: unknown }).web = f.clients.issuer;
    expect(await f.app().activation(req())).toBeNull();
    const g = fixture(),
      acquired = await g.app().activation(req());
    g.editLease({ state: 'closed' });
    await expect(acquired!.settings.admin!.getUserById(id)).rejects.toThrow(
      'INVITATION_RUNTIME_UNAVAILABLE',
    );
    expect(g.clients.admin.getUserById).not.toHaveBeenCalled();
    await acquired!.close();
  });
  it('keeps errors redacted and disposes once after an acquisition failure', async () => {
    const f = fixture();
    f.activation.mockRejectedValueOnce(new Error('synthetic-private-do-not-return'));
    expect(await f.app().activation(req())).toBeNull();
    expect(f.close).toHaveBeenCalledTimes(1);
  });
});
