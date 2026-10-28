import type { Sql } from 'postgres';
import type { ActivationScope, Invitation, InvitationLedger, Lease, Phase } from './activation';

export class InvitationLedgerUnavailable extends Error {
  constructor() {
    super('Invitation storage unavailable.');
    this.name = 'InvitationLedgerUnavailable';
  }
}
export type InvitationPostgresSettings = Readonly<{
  enabled: boolean;
  client: Pick<Sql, 'unsafe'> | null;
}>;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const phases: readonly Phase[] = [
  'issued',
  'auth_pending',
  'auth_ready',
  'enrollment_pending',
  'complete',
  'existing',
];
function bad(): never {
  throw new InvitationLedgerUnavailable();
}
function leaseArgs(lease: Lease) {
  if (
    !UUID.test(lease.invitationId) ||
    !/^[1-9][0-9]*$/.test(lease.fence) ||
    BigInt(lease.fence) > 9223372036854775807n
  )
    bad();
  return [lease.invitationId, lease.fence];
}
function invitation(row: Record<string, unknown>): Invitation {
  const expiresAt =
    row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(String(row.expires_at));
  if (
    ![row.id, row.accepted_admission_id, row.cohort_id].every(
      (id) => typeof id === 'string' && UUID.test(id),
    ) ||
    typeof row.token_digest !== 'string' ||
    !DIGEST.test(row.token_digest) ||
    typeof row.email !== 'string' ||
    !row.email ||
    typeof row.display_name !== 'string' ||
    !row.display_name.trim() ||
    !phases.includes(row.phase as Phase) ||
    !Number.isFinite(expiresAt) ||
    (row.request_id !== null &&
      (typeof row.request_id !== 'string' || !UUID.test(row.request_id))) ||
    (row.auth_user_id !== null &&
      (typeof row.auth_user_id !== 'string' || !UUID.test(row.auth_user_id)))
  )
    bad();
  return {
    id: row.id as string,
    tokenDigest: row.token_digest,
    admissionId: row.accepted_admission_id as string,
    email: row.email,
    displayName: row.display_name,
    cohortId: row.cohort_id as string,
    expiresAt,
    revoked: row.revoked_at !== null,
    phase: row.phase as Phase,
    requestId: row.request_id as string | null,
    authUserId: row.auth_user_id as string | null,
  };
}
/** No connection/client/environment is created; SQL0013/0016 and the private authority hook must be reviewed first. */
export function createPostgresInvitationLedger(
  settings: InvitationPostgresSettings | null,
): InvitationLedger | null {
  if (!settings?.enabled || !settings.client || typeof settings.client.unsafe !== 'function')
    return null;
  const client = settings.client;
  async function query(text: string, values: readonly (string | number | null)[] = []) {
    try {
      const rows = await client.unsafe(text, [...values] as never[]);
      if (!Array.isArray(rows)) bad();
      return rows as unknown as Record<string, unknown>[];
    } catch {
      return bad();
    }
  }
  async function ready() {
    const rows = await query('SELECT app.invitation_operations_ready() AS ready');
    if (rows.length !== 1 || rows[0]?.ready !== true) bad();
  }
  return {
    async find(tokenDigest) {
      if (!DIGEST.test(tokenDigest)) bad();
      await ready();
      const rows = await query('SELECT * FROM app.invitation_find($1::text)', [tokenDigest]);
      if (rows.length > 1) bad();
      if (!rows[0]) return null;
      const record = invitation(rows[0]);
      if (record.tokenDigest !== tokenDigest) bad();
      return record;
    },
    async claim(input) {
      if (
        !DIGEST.test(input.tokenDigest) ||
        !UUID.test(input.requestId) ||
        !Number.isFinite(input.now) ||
        !Number.isSafeInteger(input.leaseMs) ||
        input.leaseMs <= 0 ||
        input.leaseMs > 2147483647
      )
        bad();
      await ready();
      // SQL uses its own server clock. Caller-provided now never extends expiry or the lease.
      const rows = await query(
        'SELECT * FROM app.invitation_claim($1::text,$2::uuid,$3::integer)',
        [input.tokenDigest, input.requestId, input.leaseMs],
      );
      if (rows.length !== 1) bad();
      const value = rows[0]!.result;
      if (!value || typeof value !== 'object' || Array.isArray(value)) bad();
      const row = value as Record<string, unknown>;
      if (row.claim_state === 'acquired') {
        if (!row.record || typeof row.record !== 'object' || Array.isArray(row.record)) bad();
        if (typeof row.fence !== 'string') bad();
        const record = invitation(row.record as Record<string, unknown>),
          lease = { invitationId: record.id, fence: String(row.fence) };
        leaseArgs(lease);
        if (record.tokenDigest !== input.tokenDigest || record.requestId !== input.requestId) bad();
        return { kind: 'acquired', invitation: record, lease };
      }
      if (
        row.claim_state === 'busy' ||
        row.claim_state === 'conflict' ||
        row.claim_state === 'missing'
      )
        return { kind: row.claim_state };
      return bad();
    },
    async advance(lease, expected, next) {
      const args = leaseArgs(lease);
      const allowed =
        (expected === 'issued' && next.phase === 'auth_pending') ||
        (expected === 'auth_pending' &&
          (next.phase === 'auth_ready' || next.phase === 'existing')) ||
        (expected === 'auth_ready' && next.phase === 'enrollment_pending');
      if (
        !allowed ||
        (next.phase === 'auth_ready'
          ? !next.authUserId || !UUID.test(next.authUserId)
          : next.authUserId !== undefined)
      )
        bad();
      await ready();
      const rows = await query(
        'SELECT * FROM app.invitation_advance($1::uuid,$2::bigint,$3::text,$4::text,$5::uuid)',
        [...args, expected, next.phase, next.authUserId ?? null],
      );
      if (rows.length > 1) bad();
      return rows[0] ? invitation(rows[0]) : null;
    },
    async complete(lease, scope: ActivationScope) {
      const args = leaseArgs(lease);
      if (
        scope.role !== 'learner' ||
        scope.operationReference !== lease.invitationId ||
        !UUID.test(scope.admissionId) ||
        !UUID.test(scope.cohortId) ||
        !scope.email ||
        !scope.displayName.trim()
      )
        bad();
      await ready();
      const rows = await query(
        'SELECT app.invitation_complete($1::uuid,$2::bigint,$3::uuid,$4::text,$5::text,$6::uuid) AS completed',
        [...args, scope.admissionId, scope.email, scope.displayName, scope.cohortId],
      );
      if (rows.length !== 1 || typeof rows[0]?.completed !== 'boolean') bad();
      return rows[0].completed;
    },
    async release(lease) {
      const args = leaseArgs(lease);
      await ready();
      await query('SELECT app.invitation_release($1::uuid,$2::bigint)', args);
    },
  };
}
