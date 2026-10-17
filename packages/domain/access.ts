import type { UserRole } from './states.ts';

export interface AuthenticatedIdentity {
  id: string;
}

export interface DomainUser {
  id: string;
  authUserId: string;
  displayName: string;
  role: UserRole;
  active: boolean;
}

export type AccessDenial = 'UNAUTHENTICATED' | 'NOT_PROVISIONED' | 'INACTIVE' | 'FORBIDDEN';

export class AccessDenied extends Error {
  constructor(readonly code: AccessDenial) {
    super(code);
    this.name = 'AccessDenied';
  }
}

/** Operators need an assigned active cohort; admins have explicit read-only preview access. */
export function canAccessCohort(user: DomainUser, membershipStatus: string | null): boolean {
  return user.active && (user.role === 'admin' || membershipStatus === 'active');
}

export function assertAuthenticated(identity: AuthenticatedIdentity | null): AuthenticatedIdentity {
  if (!identity) throw new AccessDenied('UNAUTHENTICATED');
  return identity;
}

export function assertDomainUser(
  identity: AuthenticatedIdentity,
  user: DomainUser | null,
): DomainUser {
  if (!user || user.authUserId !== identity.id) throw new AccessDenied('NOT_PROVISIONED');
  if (!user.active) throw new AccessDenied('INACTIVE');
  return user;
}

export function assertRole(user: DomainUser, allowedRoles: readonly UserRole[]): DomainUser {
  if (!user.active) throw new AccessDenied('INACTIVE');
  if (!allowedRoles.includes(user.role)) throw new AccessDenied('FORBIDDEN');
  return user;
}
