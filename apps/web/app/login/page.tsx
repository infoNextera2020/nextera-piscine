import { login } from './actions';
import { AccessSurface } from '../../components/learning/access-surface';
import { LoginForm } from '../../components/learning/login-form';
import { loginFailureMessage } from '../../lib/learning/access-state';
import s from '../../components/learning/access.module.css';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = loginFailureMessage(error);
  return (
    <AccessSurface>
      <h1>Sign in</h1>
      <p className={s.description}>Use your provisioned Piscine account.</p>
      {message && (
        <p role="alert" className={s.error}>
          {message}
        </p>
      )}
      <LoginForm action={login} />
      <p className={s.footer}>Access is provided by your program owner.</p>
    </AccessSurface>
  );
}
