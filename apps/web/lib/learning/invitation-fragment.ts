export type InvitationFragment =
  | Readonly<{ status: 'ready'; token: string }>
  | Readonly<{ status: 'missing' | 'invalid' | 'unavailable' }>;
export type InvitationLocation = Readonly<{
  pathname: string;
  search: string;
  hash: string;
}>;
const PREFIX = '#invitation=';
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;

/**
 * Memory-only handoff for the dedicated signup route, not invitation verification.
 * The caller supplies history replacement and must run this before any transport.
 * Do not serialize/render the ready result or persist its capability in browser storage.
 */
export function consumeInvitationFragment(
  location: InvitationLocation,
  replaceUrl: (safeRelativeUrl: '/signup') => void,
): InvitationFragment {
  if (location.pathname !== '/signup') return { status: 'invalid' };
  const { search, hash } = location;
  if (!search && !hash) return { status: 'missing' };
  try {
    // Invalid/query-bound links are removed too; no raw token is passed to this callback.
    replaceUrl('/signup');
  } catch {
    // Never inspect or activate while the capability is still in browser-visible URL state.
    return { status: 'unavailable' };
  }
  if (search || hash.length !== PREFIX.length + 43 || !hash.startsWith(PREFIX))
    return { status: 'invalid' };
  const token = hash.slice(PREFIX.length);
  return CAPABILITY.test(token) ? { status: 'ready', token } : { status: 'invalid' };
}
