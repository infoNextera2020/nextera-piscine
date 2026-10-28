import { createInvitationAssembly } from '../../../../lib/invitations/assembly';

export const runtime = 'nodejs';
// Reviewed source boundary only. No environment/client/credentials/default policy is instantiated.
// Explicit admission, provider, storage, transport and policy setup remain separate gates.
export const POST = createInvitationAssembly(null).POST;
