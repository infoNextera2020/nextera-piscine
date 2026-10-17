import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createDatabase } from '@nextera/db/connection';
import { findDomainUser } from '@nextera/db/users';
import { findAuthorizedCohort } from '@nextera/db/cohorts';
import {
  AccessDenied,
  assertAuthenticated,
  assertDomainUser,
  assertRole,
  type UserRole,
} from '@nextera/domain';
import { createClient } from '../supabase/server';

let database: ReturnType<typeof createDatabase> | undefined;
export const getDatabase = () => (database ??= createDatabase()).db;

export const requireAuthenticatedUser = cache(async () => {
  const supabase = await createClient();
  // Auth server verification also checks the current user record; never trust getSession().user.
  const { data, error } = await supabase.auth.getUser();
  return assertAuthenticated(!error && data.user ? { id: data.user.id } : null);
});

export const requireDomainUser = cache(async () => {
  const identity = await requireAuthenticatedUser();
  return assertDomainUser(identity, await findDomainUser(getDatabase(), identity.id));
});

export async function requireRole(allowedRoles: readonly UserRole[]) {
  return assertRole(await requireDomainUser(), allowedRoles);
}

export async function requireCohortAccess(cohortId: string) {
  const user = await requireDomainUser();
  const cohort = await findAuthorizedCohort(getDatabase(), user, cohortId);
  if (!cohort) throw new AccessDenied('FORBIDDEN');
  return { user, cohort };
}

/** Page adapter only. Future API/actions call the same guards and map AccessDenied themselves. */
export async function authorizePage(allowedRoles?: readonly UserRole[]) {
  try {
    return allowedRoles ? await requireRole(allowedRoles) : await requireDomainUser();
  } catch (error) {
    if (!(error instanceof AccessDenied)) throw error;
    if (error.code === 'UNAUTHENTICATED') redirect('/login');
    redirect(`/access-denied?reason=${error.code}`);
  }
}
