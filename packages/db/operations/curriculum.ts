import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Curriculum, ExamScoringRubric, CheckpointDefinition } from '@nextera/domain';
import {
  prepareScoredExamPublication,
  checkpointCanonicalJson,
  type ScoredExamSourceBinding,
} from './scored-exam-publication';
import * as schema from '../schema/index';

export type OperationalDatabase = PostgresJsDatabase<typeof schema>;
export type EvaluationProjection = {
  nodeKey: string;
  spec: Record<string, unknown>;
  digest: string;
  checkpoint?: Record<string, unknown>;
  definitionDigest?: string;
  scoringRubric?: ExamScoringRubric;
  scoringSourceBinding?: ScoredExamSourceBinding;
  scoringSourceBindingDigest?: string;
};

function freezeMarkedSource<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeMarkedSource);
    Object.freeze(value);
  }
  return value;
}

/** ATM resources cannot be dropped into the legacy publisher or activated by caller flags. */
export const ATM_PUBLICATION_MISSING_CAPABILITIES = Object.freeze([
  'content_addressed_public_resource_persistence_and_authorized_readback',
  'explicit_cohort_schedule_activation_independent_of_exam1_result',
  'abi4_trusted_capture_registration_and_result_activation',
] as const);

export class AtmPublicationPreparationError extends Error {
  readonly code = 'ATM_PUBLICATION_PREPARATION_REQUIRED';
  readonly missingCapabilities = ATM_PUBLICATION_MISSING_CAPABILITIES;
  constructor() {
    super(
      'ATM/ABI4 publication blocked before database access: ' +
        ATM_PUBLICATION_MISSING_CAPABILITIES.join(', ') +
        '. Source validation remains available.',
    );
  }
}
function publicationRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function atmEvaluationMarker(value: unknown): boolean {
  const spec = publicationRecord(value);
  if (!spec) return false;
  if ('semantic_profile_digest' in spec) return true;
  const contract = publicationRecord(spec.execution_contract);
  return contract?.version === 4 || contract?.version === '4';
}
function atmCheckpointMarker(value: unknown): boolean {
  const definition = publicationRecord(value);
  return (
    !!definition &&
    (atmEvaluationMarker(definition) ||
      (Array.isArray(definition.tasks) &&
        definition.tasks.some((task) => {
          const item = publicationRecord(task);
          return !!item && atmEvaluationMarker(item.evaluationSpec);
        })))
  );
}
/** Keep the ATM exclusion invariant stable across awaits without invoking input getters.
 * Plain legacy finite numbers (including CPU fractions) and absent/undefined fields retain their values. */
function capturePublicationData<T>(value: T, active = new Set<object>()): T {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  )
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object')
    throw new Error('Curriculum publication requires plain finite data without accessors.');
  const object = value as object,
    prototype = Object.getPrototypeOf(object);
  if (
    (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) ||
    active.has(object)
  )
    throw new Error('Curriculum publication requires plain finite data without cycles.');
  const descriptors = Object.getOwnPropertyDescriptors(object),
    names = Object.keys(descriptors);
  if (
    Reflect.ownKeys(descriptors).length !== names.length ||
    names.some((name) => !Object.hasOwn(descriptors[name]!, 'value'))
  )
    throw new Error('Curriculum publication requires plain finite data without accessors.');
  active.add(object);
  try {
    if (Array.isArray(value)) {
      const length = descriptors.length?.value as unknown;
      if (
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        names.length !== length + 1 ||
        Array.from({ length }, (_, index) => String(index)).some(
          (name) => !Object.hasOwn(descriptors, name),
        )
      )
        throw new Error('Curriculum publication requires complete plain arrays.');
      return Object.freeze(
        Array.from({ length }, (_, index) =>
          capturePublicationData(descriptors[String(index)]!.value, active),
        ),
      ) as T;
    }
    if (names.some((name) => descriptors[name]!.enumerable !== true))
      throw new Error('Curriculum publication requires enumerable plain data.');
    const copy = Object.create(prototype) as Record<string, unknown>;
    for (const name of names)
      Object.defineProperty(copy, name, {
        value: capturePublicationData(descriptors[name]!.value, active),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return Object.freeze(copy) as T;
  } finally {
    active.delete(object);
  }
}

function assertAtmPublicationPrepared(
  curriculum: Curriculum<CheckpointDefinition>,
  evaluations: readonly EvaluationProjection[] | undefined,
): void {
  if (
    curriculum.nodes.some((node) => 'projectSource' in node) ||
    evaluations?.some(
      (evaluation) =>
        atmEvaluationMarker(evaluation.spec) ||
        atmCheckpointMarker(evaluation.checkpoint) ||
        atmCheckpointMarker(evaluation.spec.checkpoint_definition),
    )
  ) {
    throw new AtmPublicationPreparationError();
  }
}

/** A draft is a validated source receipt, with no incomplete node projections. */
export async function importCurriculum(
  db: OperationalDatabase,
  curriculum: Curriculum<CheckpointDefinition>,
  gitCommitSha: string,
  evaluations?: EvaluationProjection[],
) {
  // Exact source/preparation boundary: never create even a draft receipt that loses ATM resources.
  const input = capturePublicationData({ curriculum, evaluations });
  assertAtmPublicationPrepared(input.curriculum, input.evaluations);
  // Capture marked projections before the first await. There is no publication/default authority here.
  // Only marked source takes this new snapshot path. Do not freeze/mutate caller objects.
  const markedSource = input.curriculum.nodes.some(
    (node) =>
      node.checkpoint?.policyVersion === 3 ||
      (node.checkpoint && Object.hasOwn(node.checkpoint, 'examScoring')),
  );
  const source: Curriculum<CheckpointDefinition> = markedSource
    ? freezeMarkedSource(
        JSON.parse(checkpointCanonicalJson(input.curriculum)) as Curriculum<CheckpointDefinition>,
      )
    : input.curriculum;
  const projections = input.evaluations?.map((evaluation) => {
    const definition = evaluation.checkpoint;
    const nested = evaluation.spec.checkpoint_definition as Record<string, unknown> | undefined;
    const marked =
      definition?.policyVersion === 3 ||
      (definition && Object.hasOwn(definition, 'examScoring')) ||
      nested?.policyVersion === 3 ||
      (nested && Object.hasOwn(nested, 'examScoring'));
    if (marked) {
      const publication = prepareScoredExamPublication(evaluation);
      const node = source.nodes.find((n) => n.key === publication.nodeKey);
      if (
        !node ||
        node.kind !== 'checkpoint' ||
        node.checkpoint?.policyVersion !== 3 ||
        publication.spec.curriculum_key !== source.key ||
        publication.spec.curriculum_version !== source.version ||
        publication.spec.content_digest !== source.contentDigest ||
        publication.spec.subject_digest !== node.subjectDigest ||
        publication.spec.configuration_digest !== node.configurationDigest ||
        node.checkpoint.examScoring.form !==
          (publication.checkpoint.examScoring as Record<string, unknown>).form
      )
        throw new Error('Scored projection differs from the immutable source identity.');
      return publication;
    }
    if (
      evaluation.definitionDigest !== undefined ||
      evaluation.scoringRubric !== undefined ||
      evaluation.scoringSourceBinding !== undefined ||
      evaluation.scoringSourceBindingDigest !== undefined
    )
      throw new Error('Scored publication metadata is forbidden on a legacy node.');
    return markedSource
      ? freezeMarkedSource(JSON.parse(checkpointCanonicalJson(evaluation)) as EvaluationProjection)
      : evaluation;
  });
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${source.key}/${source.version}`}, 0))`,
    );
    await tx
      .insert(schema.curriculumVersions)
      .values({
        curriculumKey: source.key,
        version: source.version,
        gitCommitSha,
        contentDigest: source.contentDigest,
        digestFormatVersion: source.digestFormatVersion,
        status: 'draft',
      })
      .onConflictDoNothing();
    const [version] = await tx
      .select()
      .from(schema.curriculumVersions)
      .where(
        and(
          eq(schema.curriculumVersions.curriculumKey, source.key),
          eq(schema.curriculumVersions.version, source.version),
        ),
      )
      .for('update');
    if (
      !version ||
      version.contentDigest !== source.contentDigest ||
      version.digestFormatVersion !== source.digestFormatVersion
    )
      throw new Error(
        'Version already identifies different content. Use a new curriculum version.',
      );
    if (!projections) return version;
    if (
      projections.length !== source.nodes.length ||
      new Set(projections.map((e) => e.nodeKey)).size !== source.nodes.length ||
      source.nodes.some((n) => !projections.some((e) => e.nodeKey === n.key))
    )
      throw new Error('Every node requires one resolved evaluation specification.');
    const verifyRubric = async (evaluation: EvaluationProjection, insert: boolean) => {
      if (
        !evaluation.scoringRubric ||
        !evaluation.scoringSourceBinding ||
        !evaluation.scoringSourceBindingDigest ||
        !evaluation.definitionDigest
      )
        throw new Error('Source-bound scored rubric unavailable.');
      const rubric = evaluation.scoringRubric;
      if (insert)
        await tx.execute(sql`INSERT INTO app.exam_scoring_rubrics
        (rubric_digest,definition_digest,form,rubric,source_binding,source_binding_digest)
        VALUES(${rubric.digest},${evaluation.definitionDigest},${rubric.form},${JSON.stringify(rubric)}::jsonb,
          ${JSON.stringify(evaluation.scoringSourceBinding)}::jsonb,${evaluation.scoringSourceBindingDigest})
        ON CONFLICT DO NOTHING`);
      const [stored] =
        await tx.execute(sql`SELECT rubric_digest,definition_digest,form,rubric,source_binding,source_binding_digest
        FROM app.exam_scoring_rubrics WHERE rubric_digest=${rubric.digest}`);
      if (
        !stored ||
        stored.rubric_digest !== rubric.digest ||
        stored.definition_digest !== evaluation.definitionDigest ||
        stored.form !== rubric.form ||
        stored.source_binding_digest !== evaluation.scoringSourceBindingDigest ||
        checkpointCanonicalJson(stored.rubric) !== checkpointCanonicalJson(rubric) ||
        checkpointCanonicalJson(stored.source_binding) !==
          checkpointCanonicalJson(evaluation.scoringSourceBinding)
      )
        throw new Error('Existing scored rubric differs; no adoption or partial publication.');
    };
    const existing = await tx
      .select()
      .from(schema.curriculumNodes)
      .where(eq(schema.curriculumNodes.curriculumVersionId, version.id));
    if (version.status === 'published') {
      if (
        existing.length !== projections.length ||
        existing.some(
          (n) =>
            !projections.some(
              (e) => e.nodeKey === n.nodeKey && e.digest === n.evaluationSpecDigest,
            ),
        )
      )
        throw new Error('Published evaluation identity differs. Use a new curriculum version.');
      for (const evaluation of projections)
        if (evaluation.scoringRubric) await verifyRubric(evaluation, false);
      return version;
    }
    if (existing.length)
      throw new Error('Draft contains unexpected partial projections; manual review required.');
    await tx.insert(schema.quests).values(
      source.quests.map((q) => ({
        curriculumVersionId: version.id,
        questKey: q.key,
        title: q.title,
        position: q.position,
      })),
    );
    for (const evaluation of projections)
      if (evaluation.scoringRubric) await verifyRubric(evaluation, true);
    await tx.insert(schema.curriculumNodes).values(
      source.nodes.map((n) => {
        const evaluation = projections.find((e) => e.nodeKey === n.key)!;
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
    for (const evaluation of projections) {
      if (evaluation.checkpoint) {
        await tx.execute(sql`INSERT INTO app.checkpoint_definitions(curriculum_version_id,node_key,definition_digest,definition)
          VALUES(${version.id}::uuid,${evaluation.nodeKey},${evaluation.definitionDigest ?? evaluation.digest},${JSON.stringify(evaluation.checkpoint)}::jsonb)`);
      }
    }
    if (source.prerequisites.length)
      await tx.insert(schema.nodePrerequisites).values(
        source.prerequisites.map((e) => ({
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
