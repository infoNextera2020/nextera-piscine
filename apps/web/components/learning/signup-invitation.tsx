'use client';
import Link from 'next/link';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { InvitationSignupPublicPolicy } from '../../lib/invitations/signup-settings';
import type { InvitationView } from '../../lib/learning/invitation-ui';
import { InvitationSignup } from './invitation-signup';
import { createSignupInvitationOwner } from './signup-invitation-owner';
import s from './auth-split.module.css';

/** Real signup mounting seam. Only explicit reviewed public bounds can enable browser transport. */
export function SignupInvitation({ policy }: { policy: InvitationSignupPublicPolicy | null }) {
  const enabled = policy?.enabled;
  const timeoutMs = policy?.timeoutMs;
  const maxResponseBytes = policy?.maxResponseBytes;
  const maxPasswordBytes = policy?.maxPasswordBytes;
  const owner = useMemo(
    () =>
      createSignupInvitationOwner({
        readLocation: () => ({
          pathname: window.location.pathname,
          search: window.location.search,
          hash: window.location.hash,
        }),
        replaceUrl: (safeUrl) => window.history.replaceState(window.history.state, '', safeUrl),
        settings:
          enabled &&
          timeoutMs !== undefined &&
          maxResponseBytes !== undefined &&
          maxPasswordBytes !== undefined
            ? {
                enabled,
                timeoutMs,
                maxResponseBytes,
                maxPasswordBytes,
                transport: (path, init) => window.fetch(path, init),
                requestId: () => window.crypto.randomUUID(),
              }
            : null,
      }),
    [enabled, timeoutMs, maxResponseBytes, maxPasswordBytes],
  );
  useEffect(() => owner.mount(), [owner]);
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.serverSnapshot);
  const status = state.client.status;
  if (status === 'activated')
    return (
      <div data-invitation-state="activated">
        <p className={s.eyebrow}>Student portal</p>
        <h1>Your account is ready</h1>
        <p className={s.intro}>
          Your invitation has been activated. Sign in to continue to your cohort.
        </p>
        <Link className={s.primary} href="/login">
          Continue to sign in
        </Link>
        <p className={s.hint}>Activation does not sign you in automatically.</p>
      </div>
    );
  if (state.identity)
    return (
      <InvitationSignup
        invitation={{ status: 'valid', email: state.identity.email }}
        activation={{
          acceptedName: state.identity.displayName,
          state: state.client,
          submit: owner.activate,
        }}
      />
    );
  const view: InvitationView = ['invalid', 'expired', 'used', 'existing'].includes(status)
    ? { status: status as 'invalid' | 'expired' | 'used' | 'existing' }
    : { status: 'unavailable' };
  const detail = !policy
    ? undefined
    : status === 'checking' || status === 'unverified'
      ? 'Verifying the private invitation before showing your accepted account details.'
      : status === 'missing'
        ? 'Open the complete original invitation link from your program team. Its private fragment is required.'
        : status === 'unavailable' || status === 'rate_limited'
          ? 'We could not complete invitation verification. Retry the check or contact the program team.'
          : undefined;
  return (
    <>
      <InvitationSignup invitation={view} detail={detail} />
      <p className={s.status} role="status">
        {status === 'checking' || status === 'unverified'
          ? 'Checking your invitation…'
          : status === 'forbidden'
            ? 'Invitation access is not available. Contact the program team.'
            : status === 'rate_limited'
              ? 'Invitation checks are temporarily limited. Try again later.'
              : ''}
      </p>
      {policy && (status === 'unavailable' || status === 'rate_limited') && (
        <button
          type="button"
          className={s.primary}
          onClick={() => {
            void owner.inspect();
          }}
        >
          Retry invitation check
        </button>
      )}
      <noscript>
        JavaScript is required to verify the private invitation fragment. No account can be
        activated without verification.
      </noscript>
    </>
  );
}
