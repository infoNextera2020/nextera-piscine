import { login } from './actions';
import { AuthSplitSurface } from '../../components/learning/auth-split-surface';
import { LoginForm } from '../../components/learning/login-form';
import { loginFailureMessage } from '../../lib/learning/access-state';
import s from '../../components/learning/auth-split.module.css';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = loginFailureMessage(error);
  return (
    <AuthSplitSurface>
      <div data-login>
        <h1>Welcome back</h1>
        <p className={s.intro}>Continue your journey. Build real skills. Ship what you learn.</p>
        {message && (
          <p role="alert" className={s.error}>
            {message}
          </p>
        )}
        <LoginForm action={login} />
        <p className={s.footer}>
          Access is invitation-only for accepted learners. To activate your account, open the
          original invitation email.
        </p>
      </div>
    </AuthSplitSurface>
  );
}
