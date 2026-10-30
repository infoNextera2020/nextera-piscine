import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInvitationSignupPolicy, parseInvitationSignupPolicy } from './signup-settings';
const policy = { enabled: true, timeoutMs: 500, maxResponseBytes: 4096, maxPasswordBytes: 512 };
afterEach(() => vi.unstubAllEnvs());
describe('explicit invitation signup public policy', () => {
  it('projects only frozen public bounds without inventing defaults', () => {
    const result = parseInvitationSignupPolicy(JSON.stringify(policy));
    expect(result).toEqual(policy);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result!)).toEqual([
      'enabled',
      'timeoutMs',
      'maxResponseBytes',
      'maxPasswordBytes',
    ]);
  });
  it.each([undefined, null, {}, '', 'null', '[]', '{}', 'invalid', ' '.repeat(1025)])(
    'fails closed for absent or malformed source: %j',
    (value) => {
      expect(parseInvitationSignupPolicy(value)).toBeNull();
    },
  );
  it.each([
    { enabled: false },
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 2147483648 },
    { timeoutMs: 1.5 },
    { maxResponseBytes: 0 },
    { maxResponseBytes: 1_048_577 },
    { maxPasswordBytes: 0 },
    { maxPasswordBytes: 1_048_577 },
    { maxPasswordBytes: '512' },
    { origin: 'https://external.invalid' },
    { token: 'synthetic-not-issued' },
    { secret: 'synthetic-not-a-key' },
  ])('rejects incomplete, excessive or authority-bearing policy %j', (extra) => {
    expect(parseInvitationSignupPolicy(JSON.stringify({ ...policy, ...extra }))).toBeNull();
  });
  it('does not borrow unrelated public or provider configuration', () => {
    vi.stubEnv('NEXTERA_INVITATION_BROWSER_POLICY', undefined);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
    expect(getInvitationSignupPolicy()).toBeNull();
    vi.stubEnv('NEXTERA_INVITATION_BROWSER_POLICY', JSON.stringify(policy));
    expect(getInvitationSignupPolicy()).toEqual(policy);
  });
});
