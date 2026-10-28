import type { Sql } from 'postgres';
import type { ActivationDependencies, ActivationScope, EnrollmentPort, Lease } from './activation';

export type AdmissionPolicy = Readonly<{
  /** Must describe the reviewed private, locking hook; never a browser admission assertion. */
  authorityContract: 'nextera-invitation-admission-v1';
  emailConfirmed: boolean;
  rateProfiles: Readonly<{ ingress: string; inspect: string; activate: string }>;
}>;
export type InvitationAdmissionSettings = Readonly<{
  enabled: boolean;
  client: Pick<Sql, 'unsafe'> | null;
  policy: AdmissionPolicy | null;
}>;
export class InvitationAdmissionUnavailable extends Error {
  constructor() {
    super('Invitation admission unavailable.');
    this.name = 'InvitationAdmissionUnavailable';
  }
}
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const PROFILE = /^[a-z][a-z0-9_-]{0,63}$/;
function scopeValues(scope: ActivationScope) {
  if (
    scope.role !== 'learner' ||
    ![scope.operationReference, scope.admissionId, scope.cohortId].every((id) => UUID.test(id)) ||
    typeof scope.email !== 'string' ||
    !scope.email ||
    scope.email.length > 320 ||
    typeof scope.displayName !== 'string' ||
    !scope.displayName.trim() ||
    scope.displayName.length > 120
  )
    throw new InvitationAdmissionUnavailable();
  return [
    scope.operationReference,
    scope.admissionId,
    scope.email,
    scope.displayName,
    scope.cohortId,
  ];
}
/** Prepared adapter only. Construction makes no query, connection, grant, account or accepted record. */
export function createPostgresInvitationAdmission(settings: InvitationAdmissionSettings | null): {
  eligibility: NonNullable<ActivationDependencies['eligibility']>;
  enrollment: EnrollmentPort;
  rate: NonNullable<ActivationDependencies['rate']>;
  ingress: { consume(callerKey: string): Promise<boolean> };
} | null {
  const p = settings?.policy;
  if (
    !settings?.enabled ||
    !settings.client ||
    typeof settings.client.unsafe !== 'function' ||
    p?.authorityContract !== 'nextera-invitation-admission-v1' ||
    typeof p.emailConfirmed !== 'boolean' ||
    !p.rateProfiles ||
    ![p.rateProfiles.ingress, p.rateProfiles.inspect, p.rateProfiles.activate].every(
      (x) => typeof x === 'string' && PROFILE.test(x),
    ) ||
    new Set(Object.values(p.rateProfiles)).size !== 3
  )
    return null;
  const client = settings.client;
  async function query(text: string, params: readonly (string | boolean | null)[]) {
    try {
      const rows = await client.unsafe(text, [...params] as never[]);
      if (!Array.isArray(rows)) throw new InvitationAdmissionUnavailable();
      return rows as unknown as Record<string, unknown>[];
    } catch {
      throw new InvitationAdmissionUnavailable();
    }
  }
  async function ready() {
    const rows = await query('SELECT app.invitation_admission_ready($1::boolean) AS ready', [
      p!.emailConfirmed,
    ]);
    if (rows.length !== 1 || rows[0]?.ready !== true) throw new InvitationAdmissionUnavailable();
  }
  async function flag(text: string, params: readonly (string | boolean | null)[]) {
    const rows = await query(text, params);
    if (rows.length !== 1 || typeof rows[0]?.allowed !== 'boolean')
      throw new InvitationAdmissionUnavailable();
    return rows[0].allowed;
  }
  async function rate(
    action: 'ingress' | 'inspect' | 'activate',
    caller: string,
    digest: string | null,
  ) {
    if (!HASH.test(caller) || (digest !== null && !HASH.test(digest)))
      throw new InvitationAdmissionUnavailable();
    await ready();
    return flag(
      'SELECT app.invitation_rate_consume($1::text,$2::text,$3::text,$4::text) AS allowed',
      [p!.rateProfiles[action], action, caller, digest],
    );
  }
  return {
    eligibility: {
      async current(scope) {
        const values = scopeValues(scope);
        await ready();
        return flag(
          'SELECT app.invitation_scope_current($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid) AS allowed',
          values,
        );
      },
    },
    enrollment: {
      async ensure(scope, lease: Lease) {
        const values = scopeValues(scope);
        if (
          !lease ||
          lease.invitationId !== scope.operationReference ||
          !/^[1-9][0-9]*$/.test(lease.fence) ||
          BigInt(lease.fence) > 9223372036854775807n ||
          scope.authUserId !== scope.operationReference
        )
          throw new InvitationAdmissionUnavailable();
        await ready();
        const rows = await query(
          'SELECT app.invitation_enroll($1::uuid,$2::bigint,$3::uuid,$4::text,$5::text,$6::uuid,$7::uuid) AS outcome',
          [values[0]!, lease.fence, ...values.slice(1), scope.authUserId],
        );
        if (
          rows.length !== 1 ||
          !['complete', 'blocked', 'unknown'].includes(String(rows[0]?.outcome))
        )
          throw new InvitationAdmissionUnavailable();
        return rows[0]!.outcome as 'complete' | 'blocked' | 'unknown';
      },
    },
    rate: { consume: ({ action, callerKey, tokenDigest }) => rate(action, callerKey, tokenDigest) },
    ingress: { consume: (caller) => rate('ingress', caller, null) },
  };
}
