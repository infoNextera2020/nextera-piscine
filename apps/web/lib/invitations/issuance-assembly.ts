import type { Sql } from 'postgres';
import { createManualInvitationIssuer, type ManualInvitationSettings } from './issuance';
import { createPostgresInvitationIssuer } from './issuance-postgres';
import { createInvitationIssuanceHandler, type IssuanceHttpSettings } from './issuance-http';

export type InvitationIssuanceAssemblySettings = Omit<ManualInvitationSettings, 'repository'> &
  Readonly<{
    client: Pick<Sql, 'unsafe'> | null;
    http: Omit<IssuanceHttpSettings, 'issuer'> | null;
  }>;
/** Prepared source assembly only. Separately approved setup must provide all private capabilities. */
export function createInvitationIssuanceAssembly(
  settings: InvitationIssuanceAssemblySettings | null,
) {
  if (!settings?.enabled || !settings.http || !settings.client)
    return { POST: createInvitationIssuanceHandler(null) };
  const repository = createPostgresInvitationIssuer({
    enabled: settings.enabled,
    client: settings.client,
  });
  if (!repository) return { POST: createInvitationIssuanceHandler(null) };
  const issuer = createManualInvitationIssuer({ ...settings, repository });
  return { POST: createInvitationIssuanceHandler({ ...settings.http, issuer }) };
}
