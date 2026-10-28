import { describe, expect, it, vi } from 'vitest';
import {
  createInvitationActivation,
  unavailableInvitationActivation,
  type ActivationDependencies,
  type ActivationScope,
  type Invitation,
  type InvitationLedger,
} from './activation';

const requestId = '10000000-0000-4000-8000-000000000001';
const anotherRequest = '10000000-0000-4000-8000-000000000002';
const authId = '20000000-0000-4000-8000-000000000001';
const digest = 'a'.repeat(64);
const input = () => ({
  token: 'opaque-test-capability',
  requestId,
  password: ' exact test bytes ',
  confirmation: ' exact test bytes ',
});
function fixture() {
  let now = 1000,
    eligible = true,
    locked = false,
    generation = 0;
  let row: Invitation = {
    id: '30000000-0000-4000-8000-000000000001',
    tokenDigest: digest,
    admissionId: '40000000-0000-4000-8000-000000000001',
    email: 'accepted@example.test',
    displayName: 'Accepted learner',
    cohortId: '50000000-0000-4000-8000-000000000001',
    expiresAt: 10000,
    revoked: false,
    phase: 'issued',
    requestId: null,
    authUserId: null,
  };
  const scopeResult = (scope: ActivationScope) => ({
    kind: 'owned' as const,
    operationReference: scope.operationReference,
    email: scope.email,
    authUserId: authId,
  });
  const ledger: InvitationLedger = {
    find: vi.fn(async () => ({ ...row })),
    claim: vi.fn(async (args) => {
      if (row.revoked || row.expiresAt <= args.now) return { kind: 'missing' as const };
      if (locked) return { kind: 'busy' as const };
      if (row.requestId && row.requestId !== args.requestId) return { kind: 'conflict' as const };
      locked = true;
      generation++;
      row = { ...row, requestId: args.requestId };
      return {
        kind: 'acquired' as const,
        invitation: { ...row },
        lease: { invitationId: row.id, fence: String(generation) },
      };
    }),
    advance: vi.fn(async (lease, expected, next) => {
      if (!locked || lease.fence !== String(generation) || row.phase !== expected) return null;
      row = { ...row, ...next };
      return { ...row };
    }),
    complete: vi.fn(async (lease) => {
      if (
        !eligible ||
        row.revoked ||
        row.expiresAt <= now ||
        lease.fence !== String(generation) ||
        row.phase !== 'enrollment_pending'
      )
        return false;
      row = { ...row, phase: 'complete' };
      return true;
    }),
    release: vi.fn(async (lease) => {
      if (lease.fence === String(generation)) locked = false;
    }),
  };
  const auth = {
    begin: vi.fn(async (scope: ActivationScope, password: string) => {
      void password;
      return scopeResult(scope);
    }),
    recover: vi.fn(async (scope: ActivationScope) => scopeResult(scope)),
  };
  const enrollment = {
    ensure: vi.fn(async (scope: ActivationScope & { authUserId: string }) => {
      void scope;
      return 'complete' as const;
    }),
  };
  const deps: ActivationDependencies = {
    policy: {
      enabled: true,
      maxTokenBytes: 200,
      maxPasswordBytes: 1024,
      claimLeaseMs: 1000,
      acceptsPassword: vi.fn(async () => true),
    },
    ledger,
    auth,
    enrollment,
    eligibility: { current: vi.fn(async () => eligible) },
    rate: { consume: vi.fn(async () => true) },
    digestToken: vi.fn(async () => digest),
    now: () => now,
  };
  return {
    deps,
    auth,
    enrollment,
    ledger,
    service: createInvitationActivation(deps),
    get row() {
      return row;
    },
    setRow: (next: Partial<Invitation>) => (row = { ...row, ...next }),
    setEligible: (value: boolean) => (eligible = value),
    setNow: (value: number) => (now = value),
    scopeResult,
  };
}
describe('source-only invitation activation', () => {
  it('defaults to unavailable without production adapters or policy', async () => {
    expect(await unavailableInvitationActivation.inspect('anything', 'caller')).toEqual({
      status: 'unavailable',
    });
    expect(await unavailableInvitationActivation.activate(input(), 'caller')).toEqual({
      status: 'unavailable',
    });
  });
  it.each([
    'policy',
    'ledger',
    'auth',
    'enrollment',
    'eligibility',
    'rate',
    'digestToken',
    'now',
  ] as const)('requires configured %s', async (key) => {
    const f = fixture(),
      service = createInvitationActivation({ ...f.deps, [key]: null });
    expect(await service.activate(input(), 'caller')).toEqual({ status: 'unavailable' });
    expect(f.auth.begin).not.toHaveBeenCalled();
  });
  it('requires enabled explicit limits and password policy, without invented fallback', async () => {
    const f = fixture();
    for (const p of [
      { ...f.deps.policy!, enabled: false },
      { ...f.deps.policy!, claimLeaseMs: 0 },
      { ...f.deps.policy!, maxPasswordBytes: NaN },
    ]) {
      expect(
        await createInvitationActivation({ ...f.deps, policy: p }).inspect('token', 'caller'),
      ).toEqual({ status: 'unavailable' });
    }
  });
  it('only reveals invite-bound email after a valid server-held admission check', async () => {
    const f = fixture();
    expect(await f.service.inspect('opaque-test-capability', 'caller')).toEqual({
      status: 'valid',
      email: 'accepted@example.test',
    });
    f.setEligible(false);
    expect(await f.service.inspect('opaque-test-capability', 'caller')).toEqual({
      status: 'forbidden',
    });
  });
  it.each([
    { revoked: true, status: 'invalid' },
    { expiresAt: 1000, status: 'expired' },
    { phase: 'complete' as const, status: 'used' },
    { phase: 'existing' as const, status: 'existing' },
  ])('handles private non-form state $status', async ({ status, ...patch }) => {
    const f = fixture();
    f.setRow(patch);
    expect(await f.service.inspect('token', 'caller')).toEqual({ status });
    expect(f.auth.begin).not.toHaveBeenCalled();
  });
  it('rejects absent/unknown capability without identity disclosure', async () => {
    const f = fixture();
    vi.mocked(f.ledger.find).mockResolvedValueOnce(null);
    expect(await f.service.inspect('not-a-real-invitation', 'caller')).toEqual({
      status: 'invalid',
    });
  });
  it.each([
    { role: 'admin' },
    { email: 'attacker@example.test' },
    { cohortId: 'attacker' },
    { name: 'Override accepted name' },
  ])('rejects client identity or role injection %j', async (extra) => {
    const f = fixture();
    expect(await f.service.activate({ ...input(), ...extra }, 'caller')).toEqual({
      status: 'invalid_input',
    });
    expect(f.auth.begin).not.toHaveBeenCalled();
  });
  it('preserves exact password bytes and uses fixed learner identity scope only', async () => {
    const f = fixture();
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'activated' });
    expect(f.auth.begin).toHaveBeenCalledTimes(1);
    expect(f.auth.begin.mock.calls[0]?.[1]).toBe(' exact test bytes ');
    const scope = f.auth.begin.mock.calls[0]![0];
    expect(scope).toMatchObject({
      role: 'learner',
      email: 'accepted@example.test',
      displayName: 'Accepted learner',
      cohortId: f.row.cohortId,
      admissionId: f.row.admissionId,
      operationReference: f.row.id,
    });
    expect(f.row.phase).toBe('complete');
    expect(JSON.stringify(f.row)).not.toContain(' exact test bytes ');
    expect(JSON.stringify(f.row)).not.toContain('opaque-test-capability');
  });
  it('rejects invalid confirmations and provider password policy before side effects', async () => {
    const f = fixture();
    expect(await f.service.activate({ ...input(), confirmation: 'wrong' }, 'caller')).toEqual({
      status: 'invalid_input',
    });
    vi.mocked(f.deps.policy!.acceptsPassword).mockResolvedValue(false);
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'password_rejected' });
    expect(f.ledger.claim).not.toHaveBeenCalled();
    expect(f.auth.begin).not.toHaveBeenCalled();
  });
  it('requires rate permission for inspection and activation', async () => {
    const f = fixture();
    vi.mocked(f.deps.rate!.consume).mockResolvedValue(false);
    expect(await f.service.inspect('token', 'caller')).toEqual({ status: 'rate_limited' });
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'rate_limited' });
    expect(f.auth.begin).not.toHaveBeenCalled();
  });
  it('completes exactly once across concurrent and replayed requests', async () => {
    const f = fixture();
    let release!: () => void;
    f.auth.begin.mockImplementationOnce(async (scope) => {
      await new Promise<void>((resolve) => (release = resolve));
      return f.scopeResult(scope);
    });
    const first = f.service.activate(input(), 'caller');
    await vi.waitFor(() => expect(f.auth.begin).toHaveBeenCalledTimes(1));
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'in_progress' });
    expect(await f.service.activate({ ...input(), requestId: anotherRequest }, 'caller')).toEqual({
      status: 'in_progress',
    });
    release();
    expect(await first).toEqual({ status: 'activated' });
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'activated' });
    expect(await f.service.activate({ ...input(), requestId: anotherRequest }, 'caller')).toEqual({
      status: 'used',
    });
    expect(f.auth.begin).toHaveBeenCalledTimes(1);
    expect(f.enrollment.ensure).toHaveBeenCalledTimes(1);
    expect(f.ledger.complete).toHaveBeenCalledTimes(1);
  });
  it('recovers uncertain Auth creation by operation reference without a second create', async () => {
    const f = fixture();
    f.auth.begin.mockRejectedValueOnce(new Error('private provider details'));
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'recovery_required' });
    expect(f.row.phase).toBe('auth_pending');
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'activated' });
    expect(f.auth.begin).toHaveBeenCalledTimes(1);
    expect(f.auth.recover).toHaveBeenCalledTimes(1);
  });
  it('does not retry creation when recovery finds no provably owned result', async () => {
    const f = fixture();
    f.auth.begin.mockRejectedValueOnce(new Error('uncertain'));
    await f.service.activate(input(), 'caller');
    f.auth.recover.mockResolvedValue({ kind: 'unknown' } as never);
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'recovery_required' });
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'recovery_required' });
    expect(f.auth.begin).toHaveBeenCalledTimes(1);
    expect(f.enrollment.ensure).not.toHaveBeenCalled();
  });
  it('does not bind mismatched ownership/reference/email returned by an Auth adapter', async () => {
    const f = fixture();
    f.auth.begin.mockImplementationOnce(async (scope) => ({
      ...f.scopeResult(scope),
      email: 'other@example.test',
    }));
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'recovery_required' });
    expect(f.enrollment.ensure).not.toHaveBeenCalled();
    expect(f.row.authUserId).toBeNull();
  });
  it('routes unrelated existing accounts to sign-in without enrollment or upgrade', async () => {
    const f = fixture();
    f.auth.begin.mockResolvedValue({ kind: 'existing' } as never);
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'existing' });
    expect(await f.service.inspect('token', 'caller')).toEqual({ status: 'existing' });
    expect(f.enrollment.ensure).not.toHaveBeenCalled();
    expect(f.row.authUserId).toBeNull();
  });
  it('retries interrupted enrollment only through the same idempotent exact scope', async () => {
    const f = fixture();
    f.enrollment.ensure.mockRejectedValueOnce(new Error('commit acknowledgement lost'));
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'recovery_required' });
    expect(f.row.phase).toBe('enrollment_pending');
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'activated' });
    expect(f.auth.begin).toHaveBeenCalledTimes(1);
    expect(f.auth.recover).not.toHaveBeenCalled();
    expect(f.enrollment.ensure.mock.calls[0]).toEqual(f.enrollment.ensure.mock.calls[1]);
  });
  it('rechecks access removal after Auth before enrollment', async () => {
    const f = fixture();
    f.auth.begin.mockImplementationOnce(async (scope) => {
      f.setEligible(false);
      return f.scopeResult(scope);
    });
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'forbidden' });
    expect(f.enrollment.ensure).not.toHaveBeenCalled();
    expect(f.ledger.complete).not.toHaveBeenCalled();
  });
  it('rechecks revocation/expiry before enrollment and never deletes created identities', async () => {
    const f = fixture();
    f.auth.begin.mockImplementationOnce(async (scope) => {
      f.setNow(10001);
      return f.scopeResult(scope);
    });
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'forbidden' });
    expect(f.enrollment.ensure).not.toHaveBeenCalled();
    expect(f.ledger.complete).not.toHaveBeenCalled();
  });
  it('does not award activation when access is removed during enrollment', async () => {
    const f = fixture();
    f.enrollment.ensure.mockImplementationOnce(async () => {
      f.setEligible(false);
      return 'complete';
    });
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'forbidden' });
    expect(f.ledger.complete).not.toHaveBeenCalled();
  });
  it('respects a lost/stale CAS before the first Auth call', async () => {
    const f = fixture();
    vi.mocked(f.ledger.advance).mockResolvedValueOnce(null);
    expect(await f.service.activate(input(), 'caller')).toEqual({ status: 'in_progress' });
    expect(f.auth.begin).not.toHaveBeenCalled();
    expect(f.ledger.release).toHaveBeenCalled();
  });
  it('does not expose provider or database errors in an outcome', async () => {
    const f = fixture();
    vi.mocked(f.ledger.find).mockRejectedValueOnce(new Error('secret credential token=private'));
    expect(await f.service.inspect('token', 'caller')).toEqual({ status: 'unavailable' });
  });
});
