import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  assertAuthenticated,
  assertDomainUser,
  assertRole,
  type DomainUser,
} from '../index';

const identity = { id: 'verified-auth-id' };
const learner: DomainUser = {
  id: 'domain-id',
  authUserId: identity.id,
  displayName: 'Learner',
  role: 'learner',
  active: true,
};

describe('server authorization policy', () => {
  it('requires an authenticated identity', () => {
    expect(() => assertAuthenticated(null)).toThrow(new AccessDenied('UNAUTHENTICATED'));
    expect(assertAuthenticated(identity)).toBe(identity);
  });
  it('denies absent or mismatched domain identities', () => {
    expect(() => assertDomainUser(identity, null)).toThrow(new AccessDenied('NOT_PROVISIONED'));
    expect(() => assertDomainUser({ id: 'another' }, learner)).toThrow(
      new AccessDenied('NOT_PROVISIONED'),
    );
  });
  it('denies inactive domain users', () => {
    expect(() => assertDomainUser(identity, { ...learner, active: false })).toThrow(
      new AccessDenied('INACTIVE'),
    );
  });
  it('allows an active provisioned learner', () => {
    expect(assertDomainUser(identity, learner)).toBe(learner);
  });
  it('denies learners the operator surface', () => {
    expect(() => assertRole(learner, ['operator', 'admin'])).toThrow(new AccessDenied('FORBIDDEN'));
  });
  it.each(['operator', 'admin'] as const)('allows %s on the operator surface', (role) => {
    expect(assertRole({ ...learner, role }, ['operator', 'admin']).role).toBe(role);
  });
});
