'use client';
import { useFormStatus } from 'react-dom';
import { HairlineIcon } from './hairline-icon';
import s from './access.module.css';

function LoginFields() {
  const { pending } = useFormStatus();
  return (
    <fieldset disabled={pending} aria-busy={pending}>
      <label htmlFor="login-email">Email</label>
      <input
        id="login-email"
        name="email"
        type="email"
        autoComplete="username"
        maxLength={320}
        required
        placeholder="you@example.com"
      />
      <label htmlFor="login-password">Password</label>
      <input
        id="login-password"
        name="password"
        type="password"
        autoComplete="current-password"
        maxLength={1024}
        required
        placeholder="Enter your password"
      />
      <button className={s.primary} type="submit">
        {pending ? 'Signing in…' : 'Sign in'} <HairlineIcon name="arrow" />
      </button>
      <p className={s.status} role="status">
        {pending ? 'Confirming your account…' : ''}
      </p>
    </fieldset>
  );
}
export function LoginForm({ action }: { action(form: FormData): Promise<void> }) {
  return (
    <form action={action} className={s.form}>
      <LoginFields />
    </form>
  );
}
