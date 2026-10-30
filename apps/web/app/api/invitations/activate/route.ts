import { createInvitationAssembly } from '../../../../lib/invitations/assembly';
import { getInvitationActivationSettings } from '../../../../lib/invitations/runtime-configuration';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const acquired = await getInvitationActivationSettings(request);
  try {
    return await createInvitationAssembly(acquired?.settings ?? null).POST(request);
  } finally {
    await acquired?.close();
  }
}
