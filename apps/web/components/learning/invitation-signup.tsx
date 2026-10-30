'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { InvitationClientState } from '../../lib/learning/invitation-client';
import { HairlineIcon } from './hairline-icon';
import { PasswordControl } from './password-control';
import {
  invitationCopy,
  validateInvitationFields,
  type InvitationView,
} from '../../lib/learning/invitation-ui';
import s from './auth-split.module.css';

type ActivationBinding = Readonly<{
  acceptedName: string;
  state: InvitationClientState;
  submit(
    input: Readonly<{ password: string; confirmation: string }>,
  ): Promise<InvitationClientState>;
}>;
function activationMessage(status: InvitationClientState['status']) {
  if (status === 'activating') return 'Activating your invited account…';
  if (status === 'in_progress')
    return 'Activation is still in progress. Retry here to continue the same request.';
  if (status === 'recovery_required')
    return 'We could not confirm activation. Retry here using the password from your first attempt. Recovery does not replace that password.';
  if (status === 'password_rejected')
    return 'The password was not accepted. Check your program’s password requirements.';
  if (status === 'invalid_input')
    return 'The activation request was not accepted. Review your details and try again.';
  if (status === 'rate_limited') return 'Activation is temporarily limited. Try again later.';
  if (status === 'unavailable')
    return 'Activation is unavailable. No completion has been confirmed. Retry here or contact the program team.';
  return '';
}

export function InvitationSignup({
  invitation,
  reviewOnly = false,
  activation,
  detail,
}: {
  invitation: InvitationView;
  reviewOnly?: boolean;
  detail?: string | undefined;
  /** Only a token-authorized server inspection may supply the fixed accepted name. */
  activation?: ActivationBinding;
}) {
  const [hydrated, setHydrated] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    setHydrated(true);
    return () => {
      mounted.current = false;
    };
  }, []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<'idle' | 'pending' | 'complete' | 'unavailable'>('idle');
  const inFlight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const copy = invitationCopy(invitation.status);
  const actual = reviewOnly ? undefined : activation;
  const pending =
    phase === 'pending' ||
    actual?.state.status === 'activating' ||
    actual?.state.status === 'checking';
  async function submit(form: FormData) {
    if (inFlight.current) return;
    const password = form.get('password');
    const confirmation = form.get('confirmation');
    const invalid = validateInvitationFields({
      name: actual?.acceptedName ?? form.get('name'),
      password,
      confirmation,
    });
    setErrors(invalid);
    setPhase('idle');
    const first = Object.keys(invalid)[0];
    if (first) {
      formRef.current?.querySelector<HTMLInputElement>('[name="' + first + '"]')?.focus();
      return;
    }
    if (!reviewOnly && !actual) {
      setPhase('unavailable');
      return;
    }
    inFlight.current = true;
    setPhase('pending');
    try {
      if (actual) {
        // Name/email/cohort/role never enter this payload; the ledger remains authoritative.
        const result = await actual.submit({
          password: password as string,
          confirmation: confirmation as string,
        });
        if (!mounted.current) return;
        if (result.status === 'activated') {
          formRef.current?.reset();
          setPhase('complete');
        } else {
          setPhase('idle');
          if (result.status === 'password_rejected') {
            setErrors({
              password:
                'The password was not accepted. Check your program’s password requirements.',
            });
            formRef.current?.querySelector<HTMLInputElement>('[name="password"]')?.focus();
          }
        }
      } else {
        // Explicit synthetic review transport. No values are sent or persisted.
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!mounted.current) return;
        formRef.current?.reset();
        setPhase('complete');
      }
    } catch {
      if (mounted.current) setPhase('unavailable');
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <div data-invitation-state={invitation.status}>
      <p className={s.eyebrow}>Student portal</p>
      <h1>{copy.title}</h1>
      <p className={s.intro}>{copy.description}</p>
      {invitation.status === 'valid' ? (
        <>
          <aside className={s.notice}>
            <HairlineIcon name="gate" size={24} />
            <div>
              <strong>Invitation for an accepted learner</strong>
              <p>This account is linked to the email below.</p>
            </div>
          </aside>
          <form
            ref={formRef}
            onSubmit={(event) => {
              event.preventDefault();
              void submit(new FormData(event.currentTarget));
            }}
            noValidate
          >
            <fieldset disabled={!hydrated || pending} aria-busy={pending}>
              <label htmlFor="signup-name">{actual ? 'Accepted name' : 'Full name'}</label>
              <div className={s.control}>
                <input
                  id="signup-name"
                  name="name"
                  autoComplete="name"
                  required={!actual}
                  placeholder={actual ? undefined : 'Your full name'}
                  value={actual?.acceptedName}
                  readOnly={!!actual}
                  aria-invalid={!!errors.name || undefined}
                  aria-describedby="signup-name-note"
                />
                {actual && <span className={s.locked}>LOCKED</span>}
              </div>
              <p className={actual ? s.hint : s.error} id="signup-name-note">
                {actual
                  ? 'From your accepted invitation. Contact the program team to correct it.'
                  : (errors.name ?? '')}
              </p>
              <label htmlFor="signup-email">Invited email address</label>
              <div className={s.control}>
                <input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={invitation.email}
                  readOnly
                  aria-describedby="signup-email-note"
                />
                <span className={s.locked}>LOCKED</span>
              </div>
              <p className={s.hint} id="signup-email-note">
                Use the email attached to your invitation.
              </p>
              <label htmlFor="signup-password">Password</label>
              <PasswordControl
                id="signup-password"
                name="password"
                autoComplete="new-password"
                placeholder="Create a password"
                describedBy="signup-password-note"
                invalid={!!errors.password}
              />
              <p className={s.error} id="signup-password-note">
                {errors.password ?? ''}
              </p>
              <label htmlFor="signup-confirm">Confirm password</label>
              <PasswordControl
                id="signup-confirm"
                name="confirmation"
                autoComplete="new-password"
                placeholder="Re-enter your password"
                describedBy="signup-confirm-note"
                invalid={!!errors.confirmation}
              />
              <p className={s.error} id="signup-confirm-note">
                {errors.confirmation ?? ''}
              </p>
              <button type="submit">
                {pending
                  ? actual
                    ? 'Activating…'
                    : 'Checking preview…'
                  : actual &&
                      ['in_progress', 'recovery_required', 'unavailable'].includes(
                        actual.state.status,
                      )
                    ? 'Retry activation'
                    : 'Activate account'}
                <HairlineIcon name="arrow" />
              </button>
            </fieldset>
            <noscript>
              {actual
                ? 'JavaScript is required for private invitation verification and activation.'
                : 'JavaScript is needed to review this local-only form. No activation is available.'}
            </noscript>
            <p className={s.hint}>
              {actual
                ? 'Your accepted identity is fixed. Activation does not sign you in automatically.'
                : reviewOnly
                  ? 'Review only. Use fictional details; no account is created.'
                  : 'Invitation activation is not connected yet.'}
            </p>
            <p className={s.status} role="status">
              {actual
                ? phase === 'unavailable'
                  ? 'Activation could not be confirmed. Retry the same request here.'
                  : activationMessage(actual.state.status)
                : phase === 'pending'
                  ? 'Reviewing the form locally…'
                  : phase === 'complete'
                    ? 'Preview complete. No account was created and no information was sent.'
                    : phase === 'unavailable'
                      ? 'Activation is unavailable. No information was sent.'
                      : ''}
            </p>
            <div role="alert">
              {Object.keys(errors).length > 0 && (
                <p className={s.error}>Check the highlighted fields.</p>
              )}
            </div>
          </form>
        </>
      ) : (
        <div className={s.detail}>{detail ?? copy.detail}</div>
      )}
      <p className={s.footer}>
        Already have an account?{' '}
        <Link href="/login">
          Sign in <HairlineIcon name="arrow" />
        </Link>
      </p>
    </div>
  );
}
