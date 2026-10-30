import { createInvitationIssuanceAssembly } from '../../../../lib/invitations/issuance-assembly';
import { getInvitationIssuanceSettings } from '../../../../lib/invitations/runtime-configuration';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const acquired = await getInvitationIssuanceSettings(request);
  try {
    return await createInvitationIssuanceAssembly(acquired?.settings ?? null).POST(request);
  } finally {
    await acquired?.close();
  }
}
