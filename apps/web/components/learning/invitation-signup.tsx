'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { HairlineIcon } from './hairline-icon';
import { PasswordControl } from './password-control';
import {
  invitationCopy,
  validateInvitationFields,
  type InvitationView,
} from '../../lib/learning/invitation-ui';
import s from './auth-split.module.css';

export function InvitationSignup({
  invitation,
  reviewOnly = false,
}: {
  invitation: InvitationView;
  reviewOnly?: boolean;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<'idle' | 'pending' | 'complete' | 'unavailable'>('idle');
  const inFlight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const copy = invitationCopy(invitation.status);
  async function submit(form: FormData) {
    if (inFlight.current) return;
    const invalid = validateInvitationFields({
      name: form.get('name'),
      password: form.get('password'),
      confirmation: form.get('confirmation'),
    });
    setErrors(invalid);
    setPhase('idle');
    const first = Object.keys(invalid)[0];
    if (first) {
      formRef.current?.querySelector<HTMLInputElement>('[name="' + first + '"]')?.focus();
      return;
    }
    if (!reviewOnly) {
      setPhase('unavailable');
      return;
    }
    inFlight.current = true;
    setPhase('pending');
    // Review transport only. Values never leave this component and are never persisted.
    await new Promise((resolve) => setTimeout(resolve, 500));
    formRef.current?.reset();
    setPhase('complete');
    inFlight.current = false;
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
            <fieldset disabled={!hydrated || phase === 'pending'} aria-busy={phase === 'pending'}>
              <label htmlFor="signup-name">Full name</label>
              <input
                id="signup-name"
                name="name"
                autoComplete="name"
                required
                placeholder="Your full name"
                aria-invalid={!!errors.name || undefined}
                aria-describedby="signup-name-note"
              />
              <p className={s.error} id="signup-name-note">
                {errors.name ?? ''}
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
                {phase === 'pending' ? 'Checking preview…' : 'Activate account'}
                <HairlineIcon name="arrow" />
              </button>
            </fieldset>
            <noscript>
              JavaScript is needed to review this local-only form. No activation is available.
            </noscript>
            <p className={s.hint}>
              {reviewOnly
                ? 'Review only. Use fictional details; no account is created.'
                : 'Invitation activation is not connected yet.'}
            </p>
            <p className={s.status} role="status">
              {phase === 'pending'
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
        <div className={s.detail}>{copy.detail}</div>
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
