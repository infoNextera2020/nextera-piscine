import { describe, expect, it, vi } from 'vitest';
import { createInvitationAssembly, type InvitationAssemblySettings } from './assembly';
import { invitationOwnershipProof } from './managed-auth';
import type { ActivationScope } from './activation';
import { POST as productionPOST } from '../../app/api/invitations/activate/route';
import { POST as productionInspect } from '../../app/api/invitations/inspect/route';
vi.mock('server-only', () => ({}));
const id = '10000000-0000-4000-8000-000000000001',
  requestId = '20000000-0000-4000-8000-000000000001';
const caller = 'a'.repeat(64);
const scope: ActivationScope = {
  operationReference: id,
  admissionId: id,
  cohortId: id,
  email: 'accepted@example.test',
  displayName: 'Accepted learner',
  role: 'learner',
};
function request(extra: Record<string, unknown> = {}) {
  return new Request('http://localhost:3118/api/invitations/activate', {
    method: 'POST',
    headers: {
      host: 'localhost:3118',
      origin: 'http://localhost:3118',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      token: 'opaque-test-token',
      requestId,
      password: ' exact bytes ',
      confirmation: ' exact bytes ',
      ...extra,
    }),
  });
}
/** Injected protocol double only, NOT PostgreSQL/GoTrue integration. */
function fixture() {
  let phase = 'issued',
    authUserId: string | null = null,
    claimed = false,
    generation = 0;
  let user: unknown = null;
  let failEnrollment = false;
  const row = () => ({
    id,
    token_digest: 'b'.repeat(64),
    accepted_admission_id: id,
    email: scope.email,
    display_name: scope.displayName,
    cohort_id: id,
    expires_at: '2099-01-01T00:00:00Z',
    revoked_at: null,
    phase,
    request_id: claimed ? requestId : null,
    auth_user_id: authUserId,
  });
  const unsafe = vi.fn(async (sql: string, args: unknown[]) => {
    if (sql.includes('_ready(') || sql.includes('operations_ready()')) return [{ ready: true }];
    if (sql.includes('rate_consume(') || sql.includes('scope_current(')) return [{ allowed: true }];
    if (sql.includes('invitation_find(')) return [{ ...row(), token_digest: args[0] }];
    if (sql.includes('invitation_claim(')) {
      claimed = true;
      generation++;
      return [
        {
          result: {
            claim_state: 'acquired',
            record: { ...row(), token_digest: args[0] },
            fence: String(generation),
          },
        },
      ];
    }
    if (sql.includes('invitation_advance(')) {
      if (args[1] !== String(generation) || args[2] !== phase) return [];
      phase = String(args[3]);
      if (args[4]) authUserId = String(args[4]);
      return [row()];
    }
    if (sql.includes('invitation_enroll(')) {
      if (failEnrollment) {
        failEnrollment = false;
        throw new Error('lost enrollment acknowledgement');
      }
      return [{ outcome: 'complete' }];
    }
    if (sql.includes('invitation_complete(')) {
      phase = 'complete';
      return [{ completed: true }];
    }
    if (sql.includes('invitation_release(')) return [{ released: true }];
    throw new Error('Unexpected injected query');
  });
  const getUserById = vi.fn(async () =>
    user
      ? { data: { user }, error: null }
      : { data: { user: null }, error: { code: 'user_not_found', status: 404 } },
  );
  const createUser = vi.fn(async (attributes: Record<string, unknown>) => {
    user = { id, email: scope.email, app_metadata: attributes.app_metadata };
    return { data: { user }, error: null };
  });
  const config: InvitationAssemblySettings = {
    enabled: true,
    admission: {
      enabled: true,
      client: { unsafe } as never,
      policy: {
        authorityContract: 'nextera-invitation-admission-v1',
        emailConfirmed: false,
        rateProfiles: { ingress: 'ingress', inspect: 'inspect', activate: 'activate' },
      },
    },
    policy: {
      enabled: true,
      maxTokenBytes: 128,
      maxPasswordBytes: 512,
      claimLeaseMs: 1000,
      acceptsPassword: async () => true,
    },
    admin: { getUserById, createUser } as never,
    now: () => 1000,
    http: {
      enabled: true,
      allowedOrigins: ['http://localhost:3118'],
      maxBodyBytes: 4096,
      bodyTimeoutMs: 100,
      callerKey: async () => caller,
    },
  };
  return {
    config,
    unsafe,
    createUser,
    getUserById,
    failEnrollment: () => {
      failEnrollment = true;
    },
  };
}
function inspectRequest() {
  return new Request('http://localhost:3118/api/invitations/inspect', {
    method: 'POST',
    headers: {
      host: 'localhost:3118',
      origin: 'http://localhost:3118',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ token: 'A'.repeat(43) }),
  });
}
describe('explicit source-only invitation HTTP assembly', () => {
  it('keeps production inspection disabled and construction side-effect free', async () => {
    const f = fixture();
    createInvitationAssembly(f.config);
    expect(f.unsafe).not.toHaveBeenCalled();
    expect(f.createUser).not.toHaveBeenCalled();
    const response = await productionInspect(inspectRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
  it('inspects stored invitation without claiming, creating Auth, enrolling or consuming it', async () => {
    const f = fixture(),
      app = createInvitationAssembly(f.config);
    for (let i = 0; i < 2; i++) {
      const response = await app.INSPECT(inspectRequest());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: 'valid',
        email: scope.email,
        displayName: scope.displayName,
      });
    }
    expect(f.createUser).not.toHaveBeenCalled();
    expect(f.getUserById).not.toHaveBeenCalled();
    expect(
      f.unsafe.mock.calls.some(([sql]) => /invitation_(claim|enroll|complete)\(/.test(sql)),
    ).toBe(false);
    expect((await app.POST(request())).status).toBe(200);
    expect(f.createUser).toHaveBeenCalledTimes(1);
  });
  it('fails inspection closed for missing shared activation policy without queries', async () => {
    const f = fixture();
    expect(
      (await createInvitationAssembly({ ...f.config, policy: null }).INSPECT(inspectRequest()))
        .status,
    ).toBe(503);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('leaves production route503, without constructing an environment client', async () => {
    const response = await productionPOST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
  it.each(['policy', 'admission', 'admin', 'http', 'now'] as const)(
    'requires configured %s, with no query',
    async (key) => {
      const f = fixture(),
        config = { ...f.config, [key]: null };
      expect((await createInvitationAssembly(config).POST(request())).status).toBe(503);
      expect(f.unsafe).not.toHaveBeenCalled();
      expect(f.createUser).not.toHaveBeenCalled();
    },
  );
  it('does no SQL work for a disabled or incomplete password/activation policy', async () => {
    const f = fixture();
    for (const policy of [
      { ...f.config.policy!, enabled: false },
      { ...f.config.policy!, claimLeaseMs: 0 },
      { ...f.config.policy!, acceptsPassword: undefined },
    ]) {
      expect(
        (await createInvitationAssembly({ ...f.config, policy } as never).POST(request())).status,
      ).toBe(503);
    }
    expect(f.unsafe).not.toHaveBeenCalled();
    expect(f.createUser).not.toHaveBeenCalled();
  });
  it('assembles HTTP→ledger→owned Auth→fenced enrollment→completion, and replays without creating twice', async () => {
    const f = fixture(),
      { POST } = createInvitationAssembly(f.config);
    expect(f.unsafe).not.toHaveBeenCalled();
    expect(f.createUser).not.toHaveBeenCalled();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'activated' });
    expect(f.createUser).toHaveBeenCalledTimes(1);
    expect(f.createUser.mock.calls[0]![0]).toMatchObject({
      id,
      email: scope.email,
      email_confirm: false,
      password: ' exact bytes ',
      app_metadata: {
        nextera_invitation_activation: { scope_digest: invitationOwnershipProof(scope) },
      },
    });
    expect(f.unsafe.mock.calls.find(([sql]) => sql.includes('invitation_enroll('))![1]).toEqual([
      id,
      '1',
      id,
      scope.email,
      scope.displayName,
      id,
      id,
    ]);
    expect((await POST(request())).status).toBe(200);
    expect(f.createUser).toHaveBeenCalledTimes(1);
  });
  it('recovers uncertain enrollment using new fenced receipt lookup, without Auth creation or password mutation', async () => {
    const f = fixture(),
      { POST } = createInvitationAssembly(f.config);
    f.failEnrollment();
    expect((await POST(request())).status).toBe(503);
    expect(
      (await POST(request({ password: 'different retry', confirmation: 'different retry' })))
        .status,
    ).toBe(200);
    expect(f.createUser).toHaveBeenCalledTimes(1);
    const calls = f.unsafe.mock.calls.filter(([sql]) => sql.includes('invitation_enroll('));
    expect(calls.map(([, args]) => args[1])).toEqual(['1', '2']);
  });
  it.each([
    { email: 'other@example.test' },
    { role: 'admin' },
    { cohortId: id },
    { displayName: 'client selected' },
  ])('rejects self-selected authority %j without Auth or enrollment', async (extra) => {
    const f = fixture();
    expect((await createInvitationAssembly(f.config).POST(request(extra))).status).toBe(422);
    expect(f.createUser).not.toHaveBeenCalled();
    expect(f.unsafe.mock.calls.some(([sql]) => sql.includes('invitation_enroll('))).toBe(false);
  });
});
