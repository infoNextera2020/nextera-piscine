import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
// Unit-host server component rendering only; production retains its server-only boundary.
vi.mock('server-only', () => ({}));
import { invitationCopy, validateInvitationFields } from './invitation-ui';
import { InvitationSignup } from '../../components/learning/invitation-signup';
import SignupPage from '../../app/signup/page';
import { AuthSplitSurface } from '../../components/learning/auth-split-surface';
describe('invitation-only presentation', () => {
  it.each(['expired', 'invalid', 'used', 'existing', 'unavailable'] as const)(
    'keeps %s non-activating without identity disclosure',
    (status) => {
      const html = renderToStaticMarkup(
        createElement(InvitationSignup, { invitation: { status } }),
      );
      expect(html).toContain(invitationCopy(status).title);
      expect(html).not.toContain('<form');
      expect(html).not.toContain('type="password"');
      expect(html).not.toContain('@');
      expect(html).toContain('href="/login"');
    },
  );
  it('does not derive a valid invitation from production URL state', async () => {
    const html = renderToStaticMarkup(await SignupPage());
    expect(html).toContain('Open your invitation');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('learner@example.com');
  });
  it('binds the rendered email and keeps review activation explicit', () => {
    const html = renderToStaticMarkup(
      createElement(InvitationSignup, {
        invitation: { status: 'valid', email: 'accepted@example.test' },
        reviewOnly: true,
      }),
    );
    expect(html).toContain('accepted@example.test');
    expect(html).toContain('readOnly=""');
    expect(html).toContain('no account is created');
    expect(html).toContain('disabled=""');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).not.toContain('minLength');
    expect(html).not.toContain('8 characters');
    expect(html).not.toContain('name="role"');
  });
  it('associates labels and notes with every credential field', () => {
    const html = renderToStaticMarkup(
      createElement(InvitationSignup, { invitation: { status: 'valid', email: 'a@example.test' } }),
    );
    for (const id of ['signup-name', 'signup-email', 'signup-password', 'signup-confirm']) {
      expect(html).toContain('for="' + id + '"');
      expect(html).toContain('id="' + id + '"');
      expect(html).toContain(id + '-note');
    }
    expect(html).toContain('Show confirmation password');
    expect(html).toContain('Show password');
  });
  it('validates required and matching fields without a new strength rule', () => {
    expect(validateInvitationFields({ name: ' ', password: '', confirmation: '' })).toEqual({
      name: 'Enter your full name.',
      password: 'Enter a password.',
      confirmation: 'Confirm your password.',
    });
    expect(validateInvitationFields({ name: 'Learner', password: 'x', confirmation: 'x' })).toEqual(
      {},
    );
    expect(
      validateInvitationFields({
        name: 'Learner',
        password: ' exact bytes ',
        confirmation: 'exact bytes',
      }),
    ).toHaveProperty('confirmation');
    expect(
      validateInvitationFields({
        name: 'Learner',
        password: 'x'.repeat(1025),
        confirmation: 'x'.repeat(1025),
      }),
    ).toHaveProperty('password');
  });
  it('uses separate responsive decorative artwork, never a baked form', () => {
    const html = renderToStaticMarkup(
      createElement(AuthSplitSurface, null, createElement('h1', null, 'Real form content')),
    );
    expect(html).toContain('Real form content');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('600w');
    expect(html).toContain('900w');
    expect(html).toContain('1200w');
    expect(html).toContain('1280w');
    expect(html).toContain('min-aspect-ratio: 161/100');
    expect(html).toContain('max-aspect-ratio: 851/320');
    expect(html).toContain('nextera-auth-panel-square-fallback.png');
    expect(html).toContain('width="1200"');
    expect(html).toContain('height="1680"');
  });
});
