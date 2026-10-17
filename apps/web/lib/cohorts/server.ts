import 'server-only';
import { notFound } from 'next/navigation';
import { AccessDenied } from '@nextera/domain';
import { authorizePage, requireCohortAccess } from '../auth/server';

export async function authorizeCohortPage(cohortId: string) {
  await authorizePage();
  try {
    return await requireCohortAccess(cohortId);
  } catch (error) {
    if (error instanceof AccessDenied && error.code === 'FORBIDDEN') notFound();
    throw error;
  }
}
