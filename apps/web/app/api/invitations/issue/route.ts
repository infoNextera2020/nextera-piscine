import { createInvitationIssuanceAssembly } from '../../../../lib/invitations/issuance-assembly';

export const runtime = 'nodejs';
// Prepared only: no private issuer credentials, policy or owner resolver is configured here.
export const POST = createInvitationIssuanceAssembly(null).POST;
