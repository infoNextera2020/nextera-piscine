import type { Sql } from 'postgres';
import type { InvitationIssuerRepository, IssueScope, IssuanceReceipt } from './issuance';

export class InvitationIssuanceUnavailable extends Error {
  constructor() {
    super('Invitation issuance unavailable.');
    this.name = 'InvitationIssuanceUnavailable';
  }
}
const hasControl = (value: string) =>
  [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
/** Receives a separately authorized restricted client; never creates or connects one. */
export function createPostgresInvitationIssuer(
  settings: Readonly<{
    enabled: boolean;
    client: Pick<Sql, 'unsafe'> | null;
  }> | null,
): InvitationIssuerRepository | null {
  if (!settings?.enabled || !settings.client || typeof settings.client.unsafe !== 'function')
    return null;
  const client = settings.client;
  return {
    async issue(scope: IssueScope): Promise<IssuanceReceipt> {
      if (
        ![scope.invitationId, scope.requestId, scope.issuerId, scope.cohortId].every((id) =>
          UUID.test(id),
        ) ||
        !/^[a-f0-9]{64}$/.test(scope.tokenDigest) ||
        !Number.isSafeInteger(scope.expiresAt) ||
        scope.expiresAt <= 0 ||
        typeof scope.email !== 'string' ||
        !scope.email ||
        scope.email.length > 320 ||
        /\s/.test(scope.email) ||
        hasControl(scope.email) ||
        typeof scope.displayName !== 'string' ||
        !scope.displayName.trim() ||
        scope.displayName.length > 120 ||
        hasControl(scope.displayName)
      )
        throw new InvitationIssuanceUnavailable();
      const canonical: IssueScope = {
        ...scope,
        invitationId: scope.invitationId.toLowerCase(),
        requestId: scope.requestId.toLowerCase(),
        issuerId: scope.issuerId.toLowerCase(),
        cohortId: scope.cohortId.toLowerCase(),
      };
      try {
        const rows = await client.unsafe(
          'SELECT app.invitation_issue($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::uuid,$8::bigint) AS result',
          [
            canonical.invitationId,
            canonical.requestId,
            canonical.issuerId,
            scope.tokenDigest,
            scope.email,
            scope.displayName,
            canonical.cohortId,
            String(scope.expiresAt),
          ],
        );
        if (
          !Array.isArray(rows) ||
          rows.length !== 1 ||
          !rows[0]?.result ||
          typeof rows[0].result !== 'object'
        )
          throw new InvitationIssuanceUnavailable();
        const row = rows[0].result as Record<string, unknown>;
        if (['already_issued', 'conflict', 'forbidden'].includes(String(row.kind)))
          return { kind: row.kind as 'already_issued' | 'conflict' | 'forbidden' };
        if (
          row.kind !== 'issued' ||
          typeof row.curriculum_version_id !== 'string' ||
          !UUID.test(row.curriculum_version_id)
        )
          throw new InvitationIssuanceUnavailable();
        const actual = {
          invitationId: row.invitation_id,
          requestId: row.request_id,
          issuerId: row.issuer_id,
          tokenDigest: row.token_digest,
          email: row.email,
          displayName: row.display_name,
          cohortId: row.cohort_id,
          expiresAt: Number(row.expires_at_ms),
        };
        if (
          Object.entries(canonical).some(
            ([key, value]) => actual[key as keyof IssueScope] !== value,
          )
        )
          throw new InvitationIssuanceUnavailable();
        return { kind: 'issued', ...canonical, curriculumVersionId: row.curriculum_version_id };
      } catch {
        throw new InvitationIssuanceUnavailable();
      }
    },
  };
}
