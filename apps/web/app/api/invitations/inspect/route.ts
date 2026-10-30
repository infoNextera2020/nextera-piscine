import { createInvitationAssembly } from '../../../../lib/invitations/assembly';
export const runtime = 'nodejs';
/** Disabled until reviewed real clients and explicit admission/transport policies exist. */
export const POST = createInvitationAssembly(null).INSPECT;
