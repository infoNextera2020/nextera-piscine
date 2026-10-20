import 'server-only';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { canAccessCohort, type DomainUser } from '@nextera/domain';
import {
  cohorts,
  cohortMemberships,
  curriculumVersions,
  curriculumNodes,
  quests,
  nodePrerequisites,
  learnerNodeProgress,
} from '../schema/index';
import type { OperationalDatabase } from '../operations/curriculum';

const membershipJoin = (user: DomainUser) =>
  and(eq(cohortMemberships.cohortId, cohorts.id), eq(cohortMemberships.userId, user.id));
const permission = (user: DomainUser) =>
  !user.active
    ? sql`false`
    : canAccessCohort(user, null)
      ? sql`true`
      : and(eq(cohortMemberships.status, 'active'), eq(cohorts.status, 'active'));
const cohortColumns = {
  id: cohorts.id,
  name: cohorts.name,
  slug: cohorts.slug,
  curriculumVersionId: cohorts.curriculumVersionId,
  version: curriculumVersions.version,
  curriculumKey: curriculumVersions.curriculumKey,
  startsAt: cohorts.startsAt,
  endsAt: cohorts.endsAt,
};

export function listCohorts(db: OperationalDatabase, user: DomainUser) {
  return db
    .select(cohortColumns)
    .from(cohorts)
    .innerJoin(
      curriculumVersions,
      and(
        eq(curriculumVersions.id, cohorts.curriculumVersionId),
        eq(curriculumVersions.status, 'published'),
      ),
    )
    .leftJoin(cohortMemberships, membershipJoin(user))
    .where(permission(user))
    .orderBy(cohorts.startsAt, cohorts.slug);
}

export async function findAuthorizedCohort(
  db: OperationalDatabase,
  user: DomainUser,
  cohortId: string,
) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(cohortId)) return null;
  return (
    (
      await db
        .select(cohortColumns)
        .from(cohorts)
        .innerJoin(
          curriculumVersions,
          and(
            eq(curriculumVersions.id, cohorts.curriculumVersionId),
            eq(curriculumVersions.status, 'published'),
          ),
        )
        .leftJoin(cohortMemberships, membershipJoin(user))
        .where(and(eq(cohorts.id, cohortId), permission(user)))
        .limit(1)
    )[0] ?? null
  );
}
export type AuthorizedCohort = NonNullable<Awaited<ReturnType<typeof findAuthorizedCohort>>>;

const progressJoin = (user: DomainUser) =>
  and(
    eq(learnerNodeProgress.cohortId, cohorts.id),
    eq(learnerNodeProgress.userId, user.id),
    eq(learnerNodeProgress.curriculumVersionId, curriculumNodes.curriculumVersionId),
    eq(learnerNodeProgress.nodeKey, curriculumNodes.nodeKey),
  );

export function readCohortNodes(db: OperationalDatabase, user: DomainUser, cohortId: string) {
  // Subjects/evaluation specifications are deliberately absent from the map query.
  return db
    .select({
      nodeKey: curriculumNodes.nodeKey,
      title: curriculumNodes.title,
      kind: curriculumNodes.kind,
      questKey: quests.questKey,
      questTitle: quests.title,
      skills: curriculumNodes.skills,
      state: learnerNodeProgress.state,
      startedAt: learnerNodeProgress.startedAt,
      unlockedAt: learnerNodeProgress.unlockedAt,
      masteredAt: learnerNodeProgress.masteredAt,
    })
    .from(cohorts)
    .innerJoin(
      curriculumVersions,
      and(
        eq(curriculumVersions.id, cohorts.curriculumVersionId),
        eq(curriculumVersions.status, 'published'),
      ),
    )
    .leftJoin(cohortMemberships, membershipJoin(user))
    .innerJoin(
      curriculumNodes,
      eq(curriculumNodes.curriculumVersionId, cohorts.curriculumVersionId),
    )
    .innerJoin(
      quests,
      and(
        eq(quests.curriculumVersionId, curriculumNodes.curriculumVersionId),
        eq(quests.questKey, curriculumNodes.questKey),
      ),
    )
    .leftJoin(learnerNodeProgress, progressJoin(user))
    .where(and(eq(cohorts.id, cohortId), permission(user)))
    .orderBy(quests.position, curriculumNodes.position, curriculumNodes.nodeKey);
}

export function readPrerequisites(db: OperationalDatabase, user: DomainUser, cohortId: string) {
  return db
    .select({
      from: nodePrerequisites.prerequisiteNodeKey,
      to: nodePrerequisites.dependentNodeKey,
      rule: nodePrerequisites.rule,
    })
    .from(cohorts)
    .innerJoin(
      curriculumVersions,
      and(
        eq(curriculumVersions.id, cohorts.curriculumVersionId),
        eq(curriculumVersions.status, 'published'),
      ),
    )
    .leftJoin(cohortMemberships, membershipJoin(user))
    .innerJoin(
      nodePrerequisites,
      eq(nodePrerequisites.curriculumVersionId, cohorts.curriculumVersionId),
    )
    .where(and(eq(cohorts.id, cohortId), permission(user)))
    .orderBy(nodePrerequisites.dependentNodeKey, nodePrerequisites.prerequisiteNodeKey);
}

export async function readAccessibleSubject(
  db: OperationalDatabase,
  user: DomainUser,
  cohortId: string,
  nodeKey: string,
) {
  return (
    (
      await db
        .select({
          nodeKey: curriculumNodes.nodeKey,
          title: curriculumNodes.title,
          kind: curriculumNodes.kind,
          subjectMarkdown: curriculumNodes.subjectMarkdown,
          submissionRules: curriculumNodes.submissionRules,
        })
        .from(cohorts)
        .innerJoin(
          curriculumVersions,
          and(
            eq(curriculumVersions.id, cohorts.curriculumVersionId),
            eq(curriculumVersions.status, 'published'),
          ),
        )
        .leftJoin(cohortMemberships, membershipJoin(user))
        .innerJoin(
          curriculumNodes,
          eq(curriculumNodes.curriculumVersionId, cohorts.curriculumVersionId),
        )
        .leftJoin(learnerNodeProgress, progressJoin(user))
        .where(
          and(
            eq(cohorts.id, cohortId),
            eq(curriculumNodes.nodeKey, nodeKey),
            permission(user),
            or(
              user.role !== 'learner' ? sql`true` : sql`false`,
              inArray(learnerNodeProgress.state, ['available', 'in_progress', 'mastered']),
            ),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}
