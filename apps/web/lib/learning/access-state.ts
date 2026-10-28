/** Allowlisted copy only: query strings never become account or service evidence. */
export function loginFailureMessage(error?: string) {
  if (!error) return null;
  return error === 'logout_failed'
    ? 'Sign out failed. Please try again.'
    : 'Unable to sign in. Check your email and password.';
}
const reasons = {
  NOT_PROVISIONED:
    'Your identity is authenticated, but a 01 coding account has not been provisioned. Contact your operator.',
  INACTIVE: 'Your 01 coding account is inactive. Contact your operator.',
  FORBIDDEN: 'Your 01 coding role does not allow access to this page.',
} as const;
export function accessDeniedState(reason?: string) {
  const code =
    reason && Object.hasOwn(reasons, reason) ? (reason as keyof typeof reasons) : 'FORBIDDEN';
  return { code, message: reasons[code] };
}
