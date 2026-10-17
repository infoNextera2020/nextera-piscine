import 'server-only';
import { eq } from 'drizzle-orm';
import type { createDatabase } from '../connection';
import { users } from '../schema/index';

export async function findDomainUser(
  db: ReturnType<typeof createDatabase>['db'],
  authUserId: string,
) {
  const [user] = await db
    .select({
      id: users.id,
      authUserId: users.authUserId,
      displayName: users.displayName,
      role: users.role,
      active: users.active,
    })
    .from(users)
    .where(eq(users.authUserId, authUserId))
    .limit(1);
  return user ?? null;
}
