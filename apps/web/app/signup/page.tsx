import { AuthSplitSurface } from '../../components/learning/auth-split-surface';
import { InvitationSignup } from '../../components/learning/invitation-signup';
/** No query-supplied email/state/token is trusted. Real activation awaits its server contract. */
export default function SignupPage() {
  return (
    <AuthSplitSurface>
      <InvitationSignup invitation={{ status: 'unavailable' }} />
    </AuthSplitSurface>
  );
}
