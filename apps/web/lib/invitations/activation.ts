/**
 * Source-only invitation activation. No adapters, credentials or defaults are created here.
 * Route input is not authorization; all eligibility and identity facts come from the ledger.
 */
export type Phase =
  'issued' | 'auth_pending' | 'auth_ready' | 'enrollment_pending' | 'complete' | 'existing';
export type Invitation = Readonly<{
  id: string;
  tokenDigest: string;
  admissionId: string;
  email: string;
  displayName: string;
  cohortId: string;
  expiresAt: number;
  revoked: boolean;
  phase: Phase;
  requestId: string | null;
  authUserId: string | null;
}>;
export type Lease = Readonly<{ invitationId: string; fence: string }>;
export type Claim =
  | { kind: 'acquired'; invitation: Invitation; lease: Lease }
  | { kind: 'busy' | 'conflict' | 'missing' };
export interface InvitationLedger {
  find(tokenDigest: string): Promise<Invitation | null>;
  /** Atomic expiry/revocation check + exclusive expiring/fenced claim. Never overwrite a request ID. */
  claim(input: {
    tokenDigest: string;
    requestId: string;
    now: number;
    leaseMs: number;
  }): Promise<Claim>;
  /** Atomic CAS on the lease fence and expected phase; stale workers cannot advance. */
  advance(
    lease: Lease,
    expected: Phase,
    next: { phase: Phase; authUserId?: string },
  ): Promise<Invitation | null>;
  /** Must recheck revocation/expiry and admission eligibility atomically with completion. */
  complete(lease: Lease, scope: ActivationScope): Promise<boolean>;
  release(lease: Lease): Promise<void>;
}
export type ActivationScope = Readonly<{
  operationReference: string;
  admissionId: string;
  email: string;
  displayName: string;
  cohortId: string;
  role: 'learner';
}>;
export type AuthResult =
  | { kind: 'owned'; operationReference: string; authUserId: string; email: string }
  | { kind: 'existing' | 'unknown' };
export interface ManagedAuthPort {
  /** Called at most once by this service, after durable auth_pending CAS. No metadata role grants. */
  begin(scope: ActivationScope, password: string): Promise<AuthResult>;
  /** Read/reconcile only. Never creates, upgrades, reactivates or deletes an account. */
  recover(scope: ActivationScope): Promise<AuthResult>;
}
export interface EnrollmentPort {
  /**
   * Idempotent by operationReference and exact scope/auth ID.
   * Must check current acceptance/cohort/access inside its own SQL transaction.
   * Must refuse existing inactive users/memberships, conflicting identity/role, or incomplete progress.
   * Existing active membership can only be returned after exact ownership/scope verification.
   */
  ensure(
    scope: ActivationScope & { authUserId: string },
    lease: Lease,
  ): Promise<'complete' | 'blocked' | 'unknown'>;
}
export type ActivationPolicy = Readonly<{
  enabled: boolean;
  maxTokenBytes: number;
  maxPasswordBytes: number;
  claimLeaseMs: number;
  acceptsPassword(password: string): Promise<boolean>;
}>;
export type ActivationDependencies = Readonly<{
  policy: ActivationPolicy | null;
  ledger: InvitationLedger | null;
  auth: ManagedAuthPort | null;
  enrollment: EnrollmentPort | null;
  eligibility: { current(scope: ActivationScope): Promise<boolean> } | null;
  rate: {
    consume(input: {
      action: 'inspect' | 'activate';
      tokenDigest: string;
      callerKey: string;
    }): Promise<boolean>;
  } | null;
  digestToken: ((token: string) => Promise<string | null>) | null;
  now: (() => number) | null;
}>;
export type Outcome = Readonly<{
  status:
    | 'valid'
    | 'expired'
    | 'invalid'
    | 'used'
    | 'existing'
    | 'unavailable'
    | 'rate_limited'
    | 'forbidden'
    | 'invalid_input'
    | 'password_rejected'
    | 'in_progress'
    | 'recovery_required'
    | 'activated';
  email?: string;
}>;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const scopeFor = (invite: Invitation): ActivationScope => ({
  operationReference: invite.id,
  admissionId: invite.admissionId,
  email: invite.email,
  displayName: invite.displayName,
  cohortId: invite.cohortId,
  role: 'learner',
});
function recordState(invite: Invitation, now: number): Outcome['status'] | null {
  if (invite.revoked) return 'invalid';
  if (invite.phase === 'complete') return 'used';
  if (invite.phase === 'existing') return 'existing';
  if (!Number.isFinite(invite.expiresAt) || invite.expiresAt <= now) return 'expired';
  return null;
}
function configured(d: ActivationDependencies) {
  const p = d.policy;
  return !!(
    p?.enabled &&
    [p.maxTokenBytes, p.maxPasswordBytes, p.claimLeaseMs].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) &&
    typeof p.acceptsPassword === 'function' &&
    d.ledger &&
    d.auth &&
    d.enrollment &&
    d.eligibility &&
    d.rate &&
    d.digestToken &&
    d.now
  );
}
function owned(
  result: AuthResult,
  scope: ActivationScope,
): result is Extract<AuthResult, { kind: 'owned' }> {
  return (
    result.kind === 'owned' &&
    result.operationReference === scope.operationReference &&
    result.email === scope.email &&
    UUID.test(result.authUserId)
  );
}
export function createInvitationActivation(dependencies: ActivationDependencies) {
  const d = dependencies;
  async function lookup(token: unknown, callerKey: string, action: 'inspect' | 'activate') {
    if (!configured(d)) return { outcome: { status: 'unavailable' } as Outcome };
    if (typeof token !== 'string' || !token || bytes(token) > d.policy!.maxTokenBytes || !callerKey)
      return { outcome: { status: 'invalid_input' } as Outcome };
    const digest = await d.digestToken!(token);
    if (!digest || !/^[0-9a-f]{64}$/.test(digest))
      return { outcome: { status: 'invalid' } as Outcome };
    if (!(await d.rate!.consume({ action, tokenDigest: digest, callerKey })))
      return { outcome: { status: 'rate_limited' } as Outcome };
    const invitation = await d.ledger!.find(digest);
    if (!invitation) return { outcome: { status: 'invalid' } as Outcome };
    return { invitation, digest };
  }
  async function inspect(token: unknown, callerKey: string): Promise<Outcome> {
    try {
      const found = await lookup(token, callerKey, 'inspect');
      if (found.outcome) return found.outcome;
      const state = recordState(found.invitation, d.now!());
      if (state) return { status: state };
      if (!(await d.eligibility!.current(scopeFor(found.invitation))))
        return { status: 'forbidden' };
      return { status: 'valid', email: found.invitation.email };
    } catch {
      return { status: 'unavailable' };
    }
  }
  async function activate(input: unknown, callerKey: string): Promise<Outcome> {
    let lease: Lease | undefined;
    try {
      if (!configured(d)) return { status: 'unavailable' };
      if (!input || typeof input !== 'object' || Array.isArray(input))
        return { status: 'invalid_input' };
      const form = input as Record<string, unknown>;
      const keys = Object.keys(form).sort().join(',');
      if (
        keys !== 'confirmation,password,requestId,token' ||
        typeof form.requestId !== 'string' ||
        !UUID.test(form.requestId) ||
        typeof form.password !== 'string' ||
        !form.password ||
        bytes(form.password) > d.policy!.maxPasswordBytes ||
        form.password !== form.confirmation
      )
        return { status: 'invalid_input' };
      if (!(await d.policy!.acceptsPassword(form.password))) return { status: 'password_rejected' };
      const found = await lookup(form.token, callerKey, 'activate');
      if (found.outcome) return found.outcome;
      const before = found.invitation;
      const state = recordState(before, d.now!());
      if (state) {
        if (state === 'used' && before.requestId === form.requestId && !before.revoked)
          return { status: 'activated' };
        return { status: state };
      }
      if (!(await d.eligibility!.current(scopeFor(before)))) return { status: 'forbidden' };
      const claim = await d.ledger!.claim({
        tokenDigest: found.digest,
        requestId: form.requestId,
        now: d.now!(),
        leaseMs: d.policy!.claimLeaseMs,
      });
      if (claim.kind !== 'acquired')
        return { status: claim.kind === 'missing' ? 'invalid' : 'in_progress' };
      lease = claim.lease;
      let invite = claim.invitation;
      if (invite.requestId !== form.requestId || invite.tokenDigest !== found.digest)
        return { status: 'recovery_required' };
      const scope = scopeFor(invite);
      const stillEligible = async () => {
        const current = await d.ledger!.find(found.digest);
        return (
          !!current &&
          !current.revoked &&
          current.expiresAt > d.now!() &&
          current.id === scope.operationReference &&
          current.admissionId === scope.admissionId &&
          current.email === scope.email &&
          current.displayName === scope.displayName &&
          current.cohortId === scope.cohortId &&
          current.requestId === form.requestId &&
          (await d.eligibility!.current(scope))
        );
      };
      if (!(await stillEligible())) return { status: 'forbidden' };
      let authResult: AuthResult | undefined;
      if (invite.phase === 'issued') {
        const advanced = await d.ledger!.advance(lease, 'issued', { phase: 'auth_pending' });
        if (!advanced) return { status: 'in_progress' };
        invite = advanced;
        // The intent is durable before the irreversible remote operation; throws are uncertain.
        authResult = await d.auth!.begin(scope, form.password);
      } else if (invite.phase === 'auth_pending') {
        authResult = await d.auth!.recover(scope);
      }
      if (authResult) {
        if (authResult.kind === 'existing') {
          if (!(await d.ledger!.advance(lease, 'auth_pending', { phase: 'existing' })))
            return { status: 'in_progress' };
          return { status: 'existing' };
        }
        if (!owned(authResult, scope)) return { status: 'recovery_required' };
        const advanced = await d.ledger!.advance(lease, 'auth_pending', {
          phase: 'auth_ready',
          authUserId: authResult.authUserId,
        });
        if (!advanced) return { status: 'in_progress' };
        invite = advanced;
      }
      if (!invite.authUserId || !UUID.test(invite.authUserId))
        return { status: 'recovery_required' };
      if (!(await stillEligible())) return { status: 'forbidden' };
      if (invite.phase === 'auth_ready') {
        const advanced = await d.ledger!.advance(lease, 'auth_ready', {
          phase: 'enrollment_pending',
        });
        if (!advanced) return { status: 'in_progress' };
        invite = advanced;
      }
      if (invite.phase !== 'enrollment_pending') return { status: 'recovery_required' };
      const enrolled = await d.enrollment!.ensure(
        { ...scope, authUserId: invite.authUserId! },
        lease,
      );
      if (enrolled === 'blocked') return { status: 'forbidden' };
      if (enrolled !== 'complete') return { status: 'recovery_required' };
      if (!(await stillEligible())) return { status: 'forbidden' };
      return (await d.ledger!.complete(lease, scope))
        ? { status: 'activated' }
        : { status: 'in_progress' };
    } catch {
      return { status: lease ? 'recovery_required' : 'unavailable' };
    } finally {
      if (lease) {
        try {
          await d.ledger!.release(lease);
        } catch {
          /* Expiry/fencing must remain authoritative. */
        }
      }
    }
  }
  return { inspect, activate };
}
/** Production remains unavailable: no real adapter or policy is supplied by this module. */
export const unavailableInvitationActivation = createInvitationActivation({
  policy: null,
  ledger: null,
  auth: null,
  enrollment: null,
  eligibility: null,
  rate: null,
  digestToken: null,
  now: null,
});
