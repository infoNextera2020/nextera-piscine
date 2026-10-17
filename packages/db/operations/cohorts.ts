import { and, eq } from 'drizzle-orm';
import { initialNodeProgress } from '@nextera/domain';
import * as schema from '../schema/index';
import type { OperationalDatabase } from './curriculum';

export async function createCohort(
  db: OperationalDatabase,
  input: { slug: string; name: string; curriculumVersionId: string; startsAt: Date },
) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) ||
    !input.name.trim() ||
    !Number.isFinite(input.startsAt.getTime())
  )
    throw new Error('Invalid cohort slug, name, or start time.');
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(schema.curriculumVersions)
      .where(eq(schema.curriculumVersions.id, input.curriculumVersionId))
      .for('share');
    if (version?.status !== 'published')
      throw new Error(
        'Cohorts require a published curriculum. Evaluation metadata is unresolved for drafts.',
      );
    await tx
      .insert(schema.cohorts)
      .values({ ...input, status: 'active' })
      .onConflictDoNothing({ target: schema.cohorts.slug });
    const [cohort] = await tx
      .select()
      .from(schema.cohorts)
      .where(eq(schema.cohorts.slug, input.slug))
      .for('update');
    if (
      !cohort ||
      cohort.curriculumVersionId !== input.curriculumVersionId ||
      cohort.name !== input.name ||
      cohort.startsAt.getTime() !== input.startsAt.getTime()
    )
      throw new Error('Cohort slug already exists with different configuration.');
    return cohort;
  });
}

export async function pinCohort(db: OperationalDatabase, cohortId: string, versionId: string) {
  return db.transaction(async (tx) => {
    const [cohort] = await tx
      .select()
      .from(schema.cohorts)
      .where(eq(schema.cohorts.id, cohortId))
      .for('update');
    if (!cohort) throw new Error('Unknown cohort.');
    if (cohort.curriculumVersionId === versionId) return cohort;
    const members = await tx
      .select({ id: schema.cohortMemberships.userId })
      .from(schema.cohortMemberships)
      .where(eq(schema.cohortMemberships.cohortId, cohortId))
      .limit(1);
    if (members.length) throw new Error('An enrolled cohort cannot change curriculum version.');
    const [version] = await tx
      .select()
      .from(schema.curriculumVersions)
      .where(eq(schema.curriculumVersions.id, versionId));
    if (version?.status !== 'published') throw new Error('Cohorts require a published curriculum.');
    return (
      await tx
        .update(schema.cohorts)
        .set({ curriculumVersionId: versionId })
        .where(eq(schema.cohorts.id, cohortId))
        .returning()
    )[0]!;
  });
}

export async function enrollLearner(db: OperationalDatabase, cohortId: string, userId: string) {
  return db.transaction(async (tx) => {
    // Cohort lock is shared with pinning/membership triggers; per-user progress starts atomically.
    const [cohort] = await tx
      .select()
      .from(schema.cohorts)
      .where(eq(schema.cohorts.id, cohortId))
      .for('update');
    if (!cohort || cohort.status !== 'active') throw new Error('Target cohort is unavailable.');
    const [version] = await tx
      .select()
      .from(schema.curriculumVersions)
      .where(eq(schema.curriculumVersions.id, cohort.curriculumVersionId));
    if (version?.status !== 'published')
      throw new Error('Cannot enroll against a draft curriculum.');
    const [user] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for('share');
    if (!user?.active || user.role !== 'learner')
      throw new Error('Enrollment requires a provisioned active domain learner.');
    const scope = and(
      eq(schema.cohortMemberships.cohortId, cohortId),
      eq(schema.cohortMemberships.userId, userId),
    );
    const [member] = await tx.select().from(schema.cohortMemberships).where(scope);
    const nodes = await tx
      .select({ key: schema.curriculumNodes.nodeKey })
      .from(schema.curriculumNodes)
      .where(eq(schema.curriculumNodes.curriculumVersionId, version.id));
    const edges = await tx
      .select({
        from: schema.nodePrerequisites.prerequisiteNodeKey,
        to: schema.nodePrerequisites.dependentNodeKey,
        rule: schema.nodePrerequisites.rule,
      })
      .from(schema.nodePrerequisites)
      .where(eq(schema.nodePrerequisites.curriculumVersionId, version.id));
    const at = new Date();
    const progress = initialNodeProgress(
      nodes.map((n) => n.key),
      edges.map((e) => {
        if (e.rule !== 'requires_pass') throw new Error('Unsupported prerequisite rule.');
        return { ...e, rule: 'requires_pass' as const };
      }),
      at,
    );
    if (member) {
      if (member.status !== 'active')
        throw new Error(
          'Inactive membership requires explicit administrative review; enrollment does not reactivate it.',
        );
      const existing = await tx
        .select({ key: schema.learnerNodeProgress.nodeKey })
        .from(schema.learnerNodeProgress)
        .where(
          and(
            eq(schema.learnerNodeProgress.cohortId, cohortId),
            eq(schema.learnerNodeProgress.userId, userId),
          ),
        );
      if (
        existing.length !== nodes.length ||
        existing.some((n) => !nodes.some((node) => node.key === n.key))
      )
        throw new Error('Existing membership has incomplete progress; manual review required.');
      return member;
    }
    const [membership] = await tx
      .insert(schema.cohortMemberships)
      .values({ cohortId, userId, status: 'active', joinedAt: at })
      .returning();
    await tx.insert(schema.learnerNodeProgress).values(
      progress.map((p) => ({
        ...p,
        cohortId,
        userId,
        curriculumVersionId: version.id,
      })),
    );
    return membership!;
  });
}
