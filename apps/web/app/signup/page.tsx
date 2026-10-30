import { AuthSplitSurface } from '../../components/learning/auth-split-surface';
import { SignupInvitation } from '../../components/learning/signup-invitation';
import { getInvitationSignupPolicy } from '../../lib/invitations/signup-settings';

// Read the reviewed public policy at request time, not once during static generation.
export const dynamic = 'force-dynamic';

/** A fragment is consumed only after mount; server props contain reviewed public bounds only. */
export default async function SignupPage() {
  return (
    <AuthSplitSurface>
      <SignupInvitation policy={await getInvitationSignupPolicy()} />
    </AuthSplitSurface>
  );
}
