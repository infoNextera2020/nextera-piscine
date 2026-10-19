import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Curriculum } from '@nextera/domain';
import * as schema from '../schema/index';

export type OperationalDatabase = PostgresJsDatabase<typeof schema>;
export type EvaluationProjection = {
  nodeKey: string;
  spec: Record<string, unknown>;
  digest: string;
  checkpoint?: Record<string, unknown>;
};

/** A draft is a validated source receipt, with no incomplete node projections. */
export async function importCurriculum(
  db: OperationalDatabase,
  curriculum: Curriculum,
  gitCommitSha: string,
  evaluations?: EvaluationProjection[],
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${curriculum.key}/${curriculum.version}`}, 0))`,
    );
    await tx
      .insert(schema.curriculumVersions)
      .values({
        curriculumKey: curriculum.key,
        version: curriculum.version,
        gitCommitSha,
        contentDigest: curriculum.contentDigest,
        digestFormatVersion: curriculum.digestFormatVersion,
        status: 'draft',
      })
      .onConflictDoNothing();
    const [version] = await tx
      .select()
      .from(schema.curriculumVersions)
      .where(
        and(
          eq(schema.curriculumVersions.curriculumKey, curriculum.key),
          eq(schema.curriculumVersions.version, curriculum.version),
        ),
      )
      .for('update');
    if (
      !version ||
      version.contentDigest !== curriculum.contentDigest ||
      version.digestFormatVersion !== curriculum.digestFormatVersion
    )
      throw new Error(
        'Version already identifies different content. Use a new curriculum version.',
      );
    if (!evaluations) return version;
    if (
      evaluations.length !== curriculum.nodes.length ||
      new Set(evaluations.map((e) => e.nodeKey)).size !== curriculum.nodes.length ||
      curriculum.nodes.some((n) => !evaluations.some((e) => e.nodeKey === n.key))
    )
      throw new Error('Every node requires one resolved evaluation specification.');
    const existing = await tx
      .select()
      .from(schema.curriculumNodes)
      .where(eq(schema.curriculumNodes.curriculumVersionId, version.id));
    if (version.status === 'published') {
      if (
        existing.length !== evaluations.length ||
        existing.some(
          (n) =>
            !evaluations.some(
              (e) => e.nodeKey === n.nodeKey && e.digest === n.evaluationSpecDigest,
            ),
        )
      )
        throw new Error('Published evaluation identity differs. Use a new curriculum version.');
      return version;
    }
    if (existing.length)
      throw new Error('Draft contains unexpected partial projections; manual review required.');
    await tx.insert(schema.quests).values(
      curriculum.quests.map((q) => ({
        curriculumVersionId: version.id,
        questKey: q.key,
        title: q.title,
        position: q.position,
      })),
    );
    await tx.insert(schema.curriculumNodes).values(
      curriculum.nodes.map((n) => {
        const evaluation = evaluations.find((e) => e.nodeKey === n.key)!;
        return {
          curriculumVersionId: version.id,
          nodeKey: n.key,
          questKey: n.questKey,
          kind: n.kind,
          title: n.title,
          position: n.position,
          difficulty: n.difficulty,
          subjectMarkdown: n.subjectMarkdown,
          subjectDigest: n.subjectDigest,
          skills: n.skills,
          submissionRules: { ...n.submissionRules },
          resolvedEvaluationSpec: evaluation.spec,
          evaluationSpecDigest: evaluation.digest,
        };
      }),
    );
    for (const evaluation of evaluations) {
      if (evaluation.checkpoint) {
        await tx.execute(sql`INSERT INTO app.checkpoint_definitions(curriculum_version_id,node_key,definition_digest,definition)
          VALUES(${version.id}::uuid,${evaluation.nodeKey},${evaluation.digest},${JSON.stringify(evaluation.checkpoint)}::jsonb)`);
      }
    }
    if (curriculum.prerequisites.length)
      await tx.insert(schema.nodePrerequisites).values(
        curriculum.prerequisites.map((e) => ({
          curriculumVersionId: version.id,
          prerequisiteNodeKey: e.from,
          dependentNodeKey: e.to,
          rule: e.rule,
        })),
      );
    const [published] = await tx
      .update(schema.curriculumVersions)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(schema.curriculumVersions.id, version.id))
      .returning();
    return published!;
  });
}
