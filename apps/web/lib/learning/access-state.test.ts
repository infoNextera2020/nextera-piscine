import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loginFailureMessage, accessDeniedState } from './access-state';
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn(),
  form: { pending: false },
}));
vi.mock('../supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('react-dom', async (load) => ({
  ...(await load<typeof import('react-dom')>()),
  useFormStatus: () => mocks.form,
}));
import { login, logout } from '../../app/login/actions';
import LoginPage from '../../app/login/page';
import AccessDeniedPage from '../../app/access-denied/page';
import { AccessRecovery } from '../../components/learning/access-surface';
import { LoginForm } from '../../components/learning/login-form';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.form.pending = false;
  mocks.createClient.mockResolvedValue({
    auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
  });
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error('REDIRECT:' + url);
  });
});
describe('approved login/access presentation keeps existing boundaries', () => {
  it('keeps credential failures generic and never reflects arbitrary query content', async () => {
    expect(loginFailureMessage()).toBeNull();
    expect(loginFailureMessage('logout_failed')).toBe('Sign out failed. Please try again.');
    const markup = renderToStaticMarkup(
      await LoginPage({
        searchParams: Promise.resolve({ error: '<script>secret account</script>' }),
      }),
    );
    expect(markup).toContain('Unable to sign in. Check your email and password.');
    expect(markup).not.toContain('secret account');
    expect(markup).toContain('role="alert"');
  });
  it('retains native email/password autocomplete, labels, validation and only provisioned sign-in', () => {
    const markup = renderToStaticMarkup(createElement(LoginForm, { action: async () => {} }));
    expect(markup).toContain('autoComplete="username"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('for="login-email"');
    expect(markup).toContain('for="login-password"');
    expect(markup).not.toContain('Sign up');
    expect(markup).not.toContain('Reset password');
  });
  it('disables repeated sign-in while pending without announcing success', () => {
    mocks.form.pending = true;
    const markup = renderToStaticMarkup(createElement(LoginForm, { action: async () => {} }));
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Signing in…');
    expect(markup).toContain('Confirming your account…');
    expect(markup).not.toContain('Signed in');
  });
  it.each(['NOT_PROVISIONED', 'INACTIVE', 'FORBIDDEN'])(
    'shows only the existing %s denial state',
    async (reason) => {
      const markup = renderToStaticMarkup(
        await AccessDeniedPage({ searchParams: Promise.resolve({ reason }) }),
      );
      expect(markup).toContain(reason);
      expect(markup).toContain('This workspace is unavailable');
      expect(markup).toContain('Sign out');
      expect(markup).not.toContain('Team reviews');
      expect(markup).not.toContain('Authored brief');
    },
  );
  it.each(['constructor', '__proto__', '<script>', 'unknown'])(
    'does not reflect or trust unknown reason %s',
    (reason) => {
      expect(accessDeniedState(reason).code).toBe('FORBIDDEN');
    },
  );
  it.each(['login', 'workspace'] as const)(
    'keeps %s service failure separate from access denial',
    (kind) => {
      const markup = renderToStaticMarkup(
        createElement(AccessRecovery, { kind, onRetry: () => {} }),
      );
      expect(markup).toContain('Service unavailable');
      expect(markup).toContain('Try again');
      expect(markup).not.toContain('Access denied');
      expect(markup).not.toContain('password=');
      expect(markup).not.toContain('type="password"');
    },
  );
  it('keeps exact existing login action and redirect semantics with injected Auth only', async () => {
    const form = new FormData();
    form.set('email', ' learner@example.test ');
    form.set('password', ' unchanged password ');
    await expect(login(form)).rejects.toThrow('REDIRECT:/app');
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: 'learner@example.test',
      password: ' unchanged password ',
    });
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
  it('does not call Auth for invalid form fields and preserves generic failures', async () => {
    await expect(login(new FormData())).rejects.toThrow(
      'REDIRECT:/login?error=invalid_credentials',
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
    mocks.signIn.mockResolvedValue({ error: { message: 'private backend detail' } });
    const form = new FormData();
    form.set('email', 'a@example.test');
    form.set('password', 'password');
    await expect(login(form)).rejects.toThrow('REDIRECT:/login?error=invalid_credentials');
  });
  it('preserves local sign-out scope and its failure redirect', async () => {
    await expect(logout()).rejects.toThrow('REDIRECT:/login');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    mocks.signOut.mockResolvedValue({ error: { message: 'private' } });
    await expect(logout()).rejects.toThrow('REDIRECT:/login?error=logout_failed');
  });
});
