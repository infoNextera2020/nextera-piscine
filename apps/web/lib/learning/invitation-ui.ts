/** Presentation data only. A URL/query string never establishes invitation validity. */
export type InvitationView =
  | { status: 'valid'; email: string }
  | { status: 'expired' | 'invalid' | 'used' | 'existing' | 'unavailable' };
export function invitationCopy(status: InvitationView['status']) {
  const copies = {
    valid: {
      title: 'Activate your account',
      description:
        'Your invitation to NextEra Piscine is ready. Set up your account to begin your journey.',
      detail: '',
    },
    expired: {
      title: 'Invitation expired',
      description: 'This invitation can no longer be used to activate an account.',
      detail:
        'Contact the team that sent your invitation through the original email to ask for a new link.',
    },
    invalid: {
      title: 'Invitation not available',
      description: 'We could not verify this invitation link.',
      detail:
        'Open the complete link from your invitation email. If it still does not work, contact the sending team.',
    },
    used: {
      title: 'Invitation already used',
      description: 'This invitation has already been used to activate an account.',
      detail:
        'If this is your account, sign in with the invited email. If you did not activate it, contact the sending team.',
    },
    existing: {
      title: 'You already have an account',
      description: 'Continue with your existing account.',
      detail: 'Sign in using your invited email. No second account needs to be created.',
    },
    unavailable: {
      title: 'Open your invitation',
      description: 'NextEra Piscine is invitation-only for accepted learners.',
      detail:
        'Use the original invitation email from your program team. Invitation verification and activation are not connected in this build.',
    },
  };
  return copies[status];
}
/** Required/matching UX checks only; no new signup password strength policy. */
export function validateInvitationFields(values: {
  name: unknown;
  password: unknown;
  confirmation: unknown;
}) {
  const errors: Record<string, string> = {};
  if (typeof values.name !== 'string' || !values.name.trim()) errors.name = 'Enter your full name.';
  if (typeof values.password !== 'string' || !values.password)
    errors.password = 'Enter a password.';
  else if (values.password.length > 1024)
    errors.password = 'Password exceeds the supported input length.';
  if (typeof values.confirmation !== 'string' || !values.confirmation)
    errors.confirmation = 'Confirm your password.';
  else if (values.confirmation !== values.password)
    errors.confirmation = 'Passwords do not match. Try again.';
  return errors;
}
