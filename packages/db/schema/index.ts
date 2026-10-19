import {
  JUDGE_ATTEMPT_STATES,
  JUDGE_JOB_STATES,
  PROGRESS_STATES,
  RESULT_APPLICATION_STATUSES,
  SUBMISSION_STATES,
  USER_ROLES,
} from '@nextera/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import {
  boundedObject,
  digest,
  isObject,
  isOneOf,
  positiveResourceLimits,
  type JsonObject,
} from './checks';

export const app = pgSchema('app');
export const judge = pgSchema('judge');
export const progressState = app.enum('progress_state', PROGRESS_STATES);
export const submissionState = app.enum('submission_state', SUBMISSION_STATES);
export const userRole = app.enum('user_role', USER_ROLES);
export const judgeJobState = judge.enum('job_state', JUDGE_JOB_STATES);
export const judgeAttemptState = judge.enum('attempt_state', JUDGE_ATTEMPT_STATES);
export const resultApplicationStatus = judge.enum(
  'result_application_status',
  RESULT_APPLICATION_STATUSES,
);

const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
// Reference only. Supabase owns this table; it is deliberately not exported or migrated.
const authUsers = pgSchema('auth').table('users', { id: uuid('id').primaryKey() });

export const users = app.table(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    authUserId: uuid('auth_user_id')
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    role: userRole('role').notNull().default('learner'),
    active: boolean('active').notNull().default(true),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (t) => [check('users_timestamps_check', sql`${t.updatedAt} >= ${t.createdAt}`)],
);

export const curriculumVersions = app.table(
  'curriculum_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    curriculumKey: text('curriculum_key').notNull(),
    version: text('version').notNull(),
    gitCommitSha: text('git_commit_sha').notNull(),
    contentDigest: text('content_digest').notNull(),
    digestFormatVersion: integer('digest_format_version').notNull(),
    status: text('status').notNull().default('draft'),
    publishedAt: time('published_at'),
  },
  (t) => [
    unique('curriculum_key_version_unique').on(t.curriculumKey, t.version),
    check('curriculum_git_commit_check', sql`${t.gitCommitSha} ~ '^[0-9a-f]{40}$|^[0-9a-f]{64}$'`),
    check('curriculum_content_digest_check', digest(t.contentDigest)),
    check('curriculum_digest_format_check', sql`${t.digestFormatVersion} > 0`),
    check(
      'curriculum_publication_check',
      sql`(
    (${t.status} = 'draft' AND ${t.publishedAt} IS NULL) OR
    (${t.status} = 'published' AND ${t.publishedAt} IS NOT NULL)
  )`,
    ),
  ],
);

export const quests = app.table(
  'quests',
  {
    curriculumVersionId: uuid('curriculum_version_id')
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: 'restrict' }),
    questKey: text('quest_key').notNull(),
    title: text('title').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.curriculumVersionId, t.questKey] }),
    unique('quests_position_unique').on(t.curriculumVersionId, t.position),
    check('quests_position_check', sql`${t.position} > 0`),
  ],
);

export const curriculumNodes = app.table(
  'curriculum_nodes',
  {
    curriculumVersionId: uuid('curriculum_version_id').notNull(),
    nodeKey: text('node_key').notNull(),
    questKey: text('quest_key').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    difficulty: integer('difficulty').notNull(),
    subjectMarkdown: text('subject_markdown').notNull(),
    subjectDigest: text('subject_digest').notNull(),
    skills: text('skills').array().notNull(),
    submissionRules: jsonb('submission_rules').$type<JsonObject>().notNull(),
    resolvedEvaluationSpec: jsonb('resolved_evaluation_spec').$type<JsonObject>().notNull(),
    evaluationSpecDigest: text('evaluation_spec_digest').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.curriculumVersionId, t.nodeKey] }),
    foreignKey({
      name: 'nodes_quest_fk',
      columns: [t.curriculumVersionId, t.questKey],
      foreignColumns: [quests.curriculumVersionId, quests.questKey],
    }).onDelete('restrict'),
    unique('nodes_position_unique').on(t.curriculumVersionId, t.questKey, t.position),
    check('nodes_kind_check', sql`${t.kind} IN ('challenge', 'project', 'checkpoint')`),
    check('nodes_position_check', sql`${t.position} > 0`),
    check('nodes_difficulty_check', sql`${t.difficulty} > 0`),
    check('nodes_subject_digest_check', digest(t.subjectDigest)),
    check('nodes_evaluation_digest_check', digest(t.evaluationSpecDigest)),
    check('nodes_submission_rules_check', isObject(t.submissionRules)),
    check('nodes_resource_limits_check', positiveResourceLimits(t.resolvedEvaluationSpec)),
  ],
);

export const nodePrerequisites = app.table(
  'node_prerequisites',
  {
    curriculumVersionId: uuid('curriculum_version_id').notNull(),
    prerequisiteNodeKey: text('prerequisite_node_key').notNull(),
    dependentNodeKey: text('dependent_node_key').notNull(),
    rule: text('rule').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'node_prerequisites_pk',
      columns: [t.curriculumVersionId, t.prerequisiteNodeKey, t.dependentNodeKey],
    }),
    foreignKey({
      name: 'prerequisites_source_fk',
      columns: [t.curriculumVersionId, t.prerequisiteNodeKey],
      foreignColumns: [curriculumNodes.curriculumVersionId, curriculumNodes.nodeKey],
    }).onDelete('restrict'),
    foreignKey({
      name: 'prerequisites_target_fk',
      columns: [t.curriculumVersionId, t.dependentNodeKey],
      foreignColumns: [curriculumNodes.curriculumVersionId, curriculumNodes.nodeKey],
    }).onDelete('restrict'),
    check('prerequisites_rule_check', sql`${t.rule} = 'requires_pass'`),
    check(
      'prerequisites_no_self_edge_check',
      sql`${t.prerequisiteNodeKey} <> ${t.dependentNodeKey}`,
    ),
    index('prerequisites_dependent_idx').on(t.curriculumVersionId, t.dependentNodeKey),
  ],
);

export const cohorts = app.table(
  'cohorts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    curriculumVersionId: uuid('curriculum_version_id')
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at'),
  },
  (t) => [
    unique('cohorts_id_version_unique').on(t.id, t.curriculumVersionId),
    check('cohorts_status_check', sql`length(trim(${t.status})) > 0`),
    check('cohorts_dates_check', sql`${t.endsAt} IS NULL OR ${t.endsAt} >= ${t.startsAt}`),
    index('cohorts_curriculum_idx').on(t.curriculumVersionId),
  ],
);

export const cohortMemberships = app.table(
  'cohort_memberships',
  {
    cohortId: uuid('cohort_id')
      .notNull()
      .references(() => cohorts.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('active'),
    joinedAt: time('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.cohortId, t.userId] }),
    check('memberships_status_check', sql`${t.status} IN ('active', 'inactive')`),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const submissionArtifacts = app.table(
  'submission_artifacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    storageBucket: text('storage_bucket').notNull(),
    storageKey: text('storage_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('artifacts_storage_unique').on(t.storageBucket, t.storageKey),
    unique('artifacts_id_owner_unique').on(t.id, t.ownerUserId),
    check('artifacts_size_check', sql`${t.sizeBytes} > 0`),
    check('artifacts_digest_check', digest(t.sha256)),
    index('artifacts_owner_idx').on(t.ownerUserId),
  ],
);

export const submissions = app.table(
  'submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cohortId: uuid('cohort_id').notNull(),
    userId: uuid('user_id').notNull(),
    curriculumVersionId: uuid('curriculum_version_id').notNull(),
    nodeKey: text('node_key').notNull(),
    artifactId: uuid('artifact_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    state: submissionState('state').notNull().default('queued'),
    evaluationSpecDigest: text('evaluation_spec_digest').notNull(),
    activeJudgeJobId: uuid('active_judge_job_id').notNull(),
    checkpointAttemptId: uuid('checkpoint_attempt_id'),
    checkpointTaskKey: text('checkpoint_task_key'),
    createdAt: time('created_at').notNull().defaultNow(),
    startedAt: time('started_at'),
    finishedAt: time('finished_at'),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'submissions_membership_fk',
      columns: [t.cohortId, t.userId],
      foreignColumns: [cohortMemberships.cohortId, cohortMemberships.userId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'submissions_cohort_version_fk',
      columns: [t.cohortId, t.curriculumVersionId],
      foreignColumns: [cohorts.id, cohorts.curriculumVersionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'submissions_node_fk',
      columns: [t.curriculumVersionId, t.nodeKey],
      foreignColumns: [curriculumNodes.curriculumVersionId, curriculumNodes.nodeKey],
    }).onDelete('restrict'),
    foreignKey({
      name: 'submissions_artifact_owner_fk',
      columns: [t.artifactId, t.userId],
      foreignColumns: [submissionArtifacts.id, submissionArtifacts.ownerUserId],
    }).onDelete('restrict'),
    // Deferred in reviewed SQL so a submission and its job can be inserted atomically.
    foreignKey({
      name: 'submissions_active_job_fk',
      columns: [t.activeJudgeJobId, t.id],
      foreignColumns: [judgeJobs.id, judgeJobs.submissionId],
    }).onDelete('restrict'),
    unique('submissions_idempotency_unique').on(t.cohortId, t.userId, t.idempotencyKey),
    unique('submissions_progress_evidence_unique').on(
      t.id,
      t.cohortId,
      t.userId,
      t.curriculumVersionId,
      t.nodeKey,
    ),
    check('submissions_evaluation_digest_check', digest(t.evaluationSpecDigest)),
    check(
      'submissions_timestamps_check',
      sql`(${t.startedAt} IS NULL OR ${t.startedAt} >= ${t.createdAt}) AND (${t.finishedAt} IS NULL OR (${t.finishedAt} >= ${t.createdAt} AND (${t.startedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt})))`,
    ),
    check(
      'submissions_lifecycle_check',
      sql`(${t.state} = 'queued' AND ${t.finishedAt} IS NULL) OR (${t.state} = 'running' AND ${t.startedAt} IS NOT NULL AND ${t.finishedAt} IS NULL) OR (${t.state} NOT IN ('queued', 'running') AND ${t.finishedAt} IS NOT NULL)`,
    ),
    check(
      'submission_checkpoint_pair_check',
      sql`(${t.checkpointAttemptId} IS NULL) = (${t.checkpointTaskKey} IS NULL)`,
    ),
    foreignKey({
      name: 'submission_checkpoint_identity_fk',
      columns: [t.checkpointAttemptId, t.cohortId, t.userId, t.curriculumVersionId, t.nodeKey],
      foreignColumns: [
        checkpointAttempts.id,
        checkpointAttempts.cohortId,
        checkpointAttempts.userId,
        checkpointAttempts.curriculumVersionId,
        checkpointAttempts.nodeKey,
      ],
    }).onDelete('restrict'),
    index('submissions_history_idx').on(t.cohortId, t.userId, t.nodeKey, t.createdAt, t.id),
    index('submissions_cohort_state_idx').on(t.cohortId, t.state, t.createdAt, t.id),
    index('submissions_node_idx').on(t.curriculumVersionId, t.nodeKey),
    index('submissions_artifact_owner_idx').on(t.artifactId, t.userId),
    index('submissions_active_job_idx').on(t.activeJudgeJobId),
  ],
);

export const judgeWorkers = judge.table(
  'workers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    dbPrincipal: text('db_principal').notNull().unique(),
    runnerImageDigest: text('runner_image_digest').notNull(),
    protocolVersions: integer('protocol_versions').array().notNull(),
    platform: text('platform').notNull(),
    capabilities: jsonb('capabilities').$type<JsonObject>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lastHeartbeatAt: time('last_heartbeat_at'),
  },
  (t) => [
    check('workers_image_digest_check', sql`${t.runnerImageDigest} ~ '^sha256:[0-9a-f]{64}$'`),
    check(
      'workers_protocols_check',
      sql`cardinality(${t.protocolVersions}) > 0 AND 0 < ALL(${t.protocolVersions}) AND array_position(${t.protocolVersions}, NULL) IS NULL`,
    ),
    check('workers_capabilities_check', isObject(t.capabilities)),
    index('workers_heartbeat_idx')
      .on(t.lastHeartbeatAt)
      .where(sql`${t.enabled} = true`),
  ],
);

export const judgeJobs = judge.table(
  'jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'restrict' }),
    evaluationNumber: integer('evaluation_number').notNull().default(1),
    state: judgeJobState('state').notNull().default('queued'),
    availableAt: time('available_at').notNull().defaultNow(),
    protocolVersion: integer('protocol_version').notNull(),
    evaluationSnapshot: jsonb('evaluation_snapshot').$type<JsonObject>().notNull(),
    evaluationDigest: text('evaluation_digest').notNull(),
    retryCount: integer('retry_count').notNull().default(0),
    leaseGeneration: bigint('lease_generation', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: time('lease_expires_at'),
    currentWorkerId: uuid('current_worker_id').references(() => judgeWorkers.id, {
      onDelete: 'restrict',
    }),
    currentAttemptId: uuid('current_attempt_id'),
    terminalResultId: uuid('terminal_result_id'),
    createdAt: time('created_at').notNull().defaultNow(),
    finishedAt: time('finished_at'),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('jobs_submission_evaluation_unique').on(t.submissionId, t.evaluationNumber),
    unique('jobs_id_submission_unique').on(t.id, t.submissionId),
    foreignKey({
      name: 'jobs_current_attempt_fk',
      columns: [t.currentAttemptId, t.id, t.currentWorkerId, t.leaseGeneration],
      foreignColumns: [
        judgeAttempts.id,
        judgeAttempts.jobId,
        judgeAttempts.workerId,
        judgeAttempts.leaseGeneration,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'jobs_terminal_result_fk',
      columns: [t.terminalResultId, t.id, t.currentAttemptId],
      foreignColumns: [judgeResults.id, judgeResults.jobId, judgeResults.attemptId],
    }).onDelete('restrict'),
    check('jobs_evaluation_number_check', sql`${t.evaluationNumber} > 0`),
    check('jobs_protocol_check', sql`${t.protocolVersion} > 0`),
    check('jobs_retry_count_check', sql`${t.retryCount} BETWEEN 0 AND 2`),
    check('jobs_lease_generation_check', sql`${t.leaseGeneration} > 0`),
    check('jobs_evaluation_digest_check', digest(t.evaluationDigest)),
    check('jobs_resource_limits_check', positiveResourceLimits(t.evaluationSnapshot)),
    check(
      'jobs_lifecycle_check',
      sql`(
    (${t.state} = 'queued' AND ${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL AND ${t.currentWorkerId} IS NULL AND ${t.currentAttemptId} IS NULL AND ${t.terminalResultId} IS NULL AND ${t.finishedAt} IS NULL) OR
    (${t.state} IN ('claimed', 'running') AND ${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL AND ${t.currentWorkerId} IS NOT NULL AND ${t.currentAttemptId} IS NOT NULL AND ${t.terminalResultId} IS NULL AND ${t.finishedAt} IS NULL) OR
    (${t.state} IN ('completed', 'system_error') AND ${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL AND ${t.currentWorkerId} IS NOT NULL AND ${t.currentAttemptId} IS NOT NULL AND ${t.terminalResultId} IS NOT NULL AND ${t.finishedAt} IS NOT NULL)
  )`,
    ),
    check(
      'jobs_timestamps_check',
      sql`(${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.createdAt}) AND (${t.leaseExpiresAt} IS NULL OR ${t.leaseExpiresAt} > ${t.createdAt})`,
    ),
    uniqueIndex('jobs_one_active_submission_idx')
      .on(t.submissionId)
      .where(sql`${t.state} IN ('queued', 'claimed', 'running')`),
    index('jobs_ready_idx')
      .on(t.availableAt, t.id)
      .where(sql`${t.state} = 'queued'`),
    index('jobs_expired_lease_idx')
      .on(t.leaseExpiresAt, t.id)
      .where(sql`${t.state} IN ('claimed', 'running')`),
    index('jobs_current_worker_idx').on(t.currentWorkerId),
    index('jobs_current_attempt_idx').on(t.currentAttemptId),
    index('jobs_terminal_result_idx').on(t.terminalResultId),
  ],
);

export const judgeAttempts = judge.table(
  'attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => judgeJobs.id, { onDelete: 'restrict' }),
    attemptNumber: integer('attempt_number').notNull(),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => judgeWorkers.id, { onDelete: 'restrict' }),
    leaseGeneration: bigint('lease_generation', { mode: 'bigint' }).notNull(),
    claimToken: uuid('claim_token').notNull(),
    state: judgeAttemptState('state').notNull().default('claimed'),
    claimedAt: time('claimed_at').notNull().defaultNow(),
    startedAt: time('started_at'),
    finishedAt: time('finished_at'),
    infrastructureErrorCode: text('infrastructure_error_code'),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('attempts_job_number_unique').on(t.jobId, t.attemptNumber),
    unique('attempts_id_job_unique').on(t.id, t.jobId),
    unique('attempts_claim_identity_unique').on(t.id, t.jobId, t.workerId, t.leaseGeneration),
    check('attempts_number_check', sql`${t.attemptNumber} BETWEEN 1 AND 3`),
    check('attempts_generation_check', sql`${t.leaseGeneration} > 0`),
    check(
      'attempts_lifecycle_check',
      sql`(
    (${t.state} = 'claimed' AND ${t.startedAt} IS NULL AND ${t.finishedAt} IS NULL AND ${t.infrastructureErrorCode} IS NULL) OR
    (${t.state} = 'running' AND ${t.startedAt} IS NOT NULL AND ${t.finishedAt} IS NULL AND ${t.infrastructureErrorCode} IS NULL) OR
    (${t.state} = 'completed' AND ${t.startedAt} IS NOT NULL AND ${t.finishedAt} IS NOT NULL AND ${t.infrastructureErrorCode} IS NULL) OR
    (${t.state} = 'system_error' AND ${t.finishedAt} IS NOT NULL AND ${t.infrastructureErrorCode} IS NOT NULL)
  )`,
    ),
    check(
      'attempts_timestamps_check',
      sql`(${t.startedAt} IS NULL OR ${t.startedAt} >= ${t.claimedAt}) AND (${t.finishedAt} IS NULL OR (${t.finishedAt} >= ${t.claimedAt} AND (${t.startedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt})))`,
    ),
    index('attempts_worker_idx').on(t.workerId),
  ],
);

export const judgeResults = judge.table(
  'results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id').notNull(),
    attemptId: uuid('attempt_id').notNull().unique(),
    evaluationDigest: text('evaluation_digest').notNull(),
    verdict: submissionState('verdict').notNull(),
    measurements: jsonb('measurements').$type<Record<string, number>>().notNull(),
    learnerFeedback: jsonb('learner_feedback').$type<JsonObject>().notNull(),
    safeOperatorDiagnostics: jsonb('safe_operator_diagnostics').$type<JsonObject>().notNull(),
    recordedAt: time('recorded_at').notNull().defaultNow(),
    applicationStatus: resultApplicationStatus('application_status').notNull().default('pending'),
    processedAt: time('processed_at'),
    applicationReason: text('application_reason'),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'results_attempt_job_fk',
      columns: [t.attemptId, t.jobId],
      foreignColumns: [judgeAttempts.id, judgeAttempts.jobId],
    }).onDelete('restrict'),
    unique('results_id_job_attempt_unique').on(t.id, t.jobId, t.attemptId),
    check('results_evaluation_digest_check', digest(t.evaluationDigest)),
    check('results_terminal_verdict_check', sql`${t.verdict} NOT IN ('queued', 'running')`),
    check(
      'results_measurements_check',
      sql`${isObject(t.measurements)} AND NOT jsonb_path_exists(${t.measurements}, '$.* ? (@.type() != "number" || @ < 0)')`,
    ),
    check('results_feedback_check', boundedObject(t.learnerFeedback)),
    check('results_diagnostics_check', boundedObject(t.safeOperatorDiagnostics)),
    check(
      'results_application_check',
      sql`(
    (${t.applicationStatus} = 'pending' AND ${t.processedAt} IS NULL AND ${t.applicationReason} IS NULL) OR
    (${t.applicationStatus} = 'applied' AND ${t.processedAt} IS NOT NULL) OR
    (${t.applicationStatus} = 'superseded' AND ${t.processedAt} IS NOT NULL AND ${t.applicationReason} IS NOT NULL AND length(trim(${t.applicationReason})) > 0)
  )`,
    ),
    check(
      'results_timestamps_check',
      sql`${t.processedAt} IS NULL OR ${t.processedAt} >= ${t.recordedAt}`,
    ),
    index('results_job_idx').on(t.jobId),
    index('results_pending_idx')
      .on(t.recordedAt, t.id)
      .where(sql`${t.applicationStatus} = 'pending'`),
  ],
);

export const learnerNodeProgress = app.table(
  'learner_node_progress',
  {
    cohortId: uuid('cohort_id').notNull(),
    userId: uuid('user_id').notNull(),
    curriculumVersionId: uuid('curriculum_version_id').notNull(),
    nodeKey: text('node_key').notNull(),
    state: progressState('state').notNull(),
    unlockedAt: time('unlocked_at'),
    startedAt: time('started_at'),
    masteredAt: time('mastered_at'),
    firstPassingSubmissionId: uuid('first_passing_submission_id'),
    firstPassingCheckpointOutcomeId: uuid('first_passing_checkpoint_outcome_id'),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({
      name: 'learner_node_progress_pk',
      columns: [t.cohortId, t.userId, t.curriculumVersionId, t.nodeKey],
    }),
    foreignKey({
      name: 'progress_membership_fk',
      columns: [t.cohortId, t.userId],
      foreignColumns: [cohortMemberships.cohortId, cohortMemberships.userId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'progress_cohort_version_fk',
      columns: [t.cohortId, t.curriculumVersionId],
      foreignColumns: [cohorts.id, cohorts.curriculumVersionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'progress_node_fk',
      columns: [t.curriculumVersionId, t.nodeKey],
      foreignColumns: [curriculumNodes.curriculumVersionId, curriculumNodes.nodeKey],
    }).onDelete('restrict'),
    foreignKey({
      name: 'progress_first_passing_submission_fk',
      columns: [t.firstPassingSubmissionId, t.cohortId, t.userId, t.curriculumVersionId, t.nodeKey],
      foreignColumns: [
        submissions.id,
        submissions.cohortId,
        submissions.userId,
        submissions.curriculumVersionId,
        submissions.nodeKey,
      ],
    }).onDelete('restrict'),
    check(
      'progress_state_timestamps_check',
      sql`(
    (${t.state} = 'locked' AND ${t.unlockedAt} IS NULL AND ${t.startedAt} IS NULL AND ${t.masteredAt} IS NULL AND ${t.firstPassingSubmissionId} IS NULL AND ${t.firstPassingCheckpointOutcomeId} IS NULL) OR
    (${t.state} = 'available' AND ${t.unlockedAt} IS NOT NULL AND ${t.startedAt} IS NULL AND ${t.masteredAt} IS NULL AND ${t.firstPassingSubmissionId} IS NULL AND ${t.firstPassingCheckpointOutcomeId} IS NULL) OR
    (${t.state} = 'in_progress' AND ${t.unlockedAt} IS NOT NULL AND ${t.startedAt} IS NOT NULL AND ${t.masteredAt} IS NULL AND ${t.firstPassingSubmissionId} IS NULL AND ${t.firstPassingCheckpointOutcomeId} IS NULL) OR
    (${t.state} = 'mastered' AND ${t.unlockedAt} IS NOT NULL AND ${t.startedAt} IS NOT NULL AND ${t.masteredAt} IS NOT NULL AND num_nonnulls(${t.firstPassingSubmissionId},${t.firstPassingCheckpointOutcomeId}) = 1)
  )`,
    ),
    check(
      'progress_timestamp_order_check',
      sql`(${t.startedAt} IS NULL OR ${t.startedAt} >= ${t.unlockedAt}) AND (${t.masteredAt} IS NULL OR ${t.masteredAt} >= ${t.startedAt})`,
    ),
    foreignKey({
      name: 'progress_checkpoint_outcome_fk',
      columns: [
        t.firstPassingCheckpointOutcomeId,
        t.cohortId,
        t.userId,
        t.curriculumVersionId,
        t.nodeKey,
      ],
      foreignColumns: [
        checkpointOutcomes.id,
        checkpointOutcomes.cohortId,
        checkpointOutcomes.userId,
        checkpointOutcomes.curriculumVersionId,
        checkpointOutcomes.nodeKey,
      ],
    }).onDelete('restrict'),
    index('progress_dashboard_idx').on(t.cohortId, t.userId, t.state),
    index('progress_node_idx').on(t.curriculumVersionId, t.nodeKey),
    index('progress_passing_submission_idx').on(t.firstPassingSubmissionId),
  ],
);

export const stateEvents = app.table(
  'state_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id').references(() => submissions.id, { onDelete: 'restrict' }),
    checkpointAttemptId: uuid('checkpoint_attempt_id').references(() => checkpointAttempts.id, {
      onDelete: 'restrict',
    }),
    checkpointOutcomeId: uuid('checkpoint_outcome_id').references(() => checkpointOutcomes.id, {
      onDelete: 'restrict',
    }),
    jobId: uuid('job_id'),
    attemptId: uuid('attempt_id'),
    resultId: uuid('result_id'),
    entityType: text('entity_type').notNull(),
    previousState: text('previous_state'),
    nextState: text('next_state').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    reason: text('reason').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: time('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'state_events_job_submission_fk',
      columns: [t.jobId, t.submissionId],
      foreignColumns: [judgeJobs.id, judgeJobs.submissionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'state_events_attempt_job_fk',
      columns: [t.attemptId, t.jobId],
      foreignColumns: [judgeAttempts.id, judgeAttempts.jobId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'state_events_result_fk',
      columns: [t.resultId, t.jobId, t.attemptId],
      foreignColumns: [judgeResults.id, judgeResults.jobId, judgeResults.attemptId],
    }).onDelete('restrict'),
    check(
      'state_events_entity_check',
      sql`${t.entityType} IN ('submission', 'job', 'attempt', 'progress')`,
    ),
    check(
      'state_events_actor_check',
      sql`(${t.actorType} IN ('user', 'worker') AND ${t.actorId} IS NOT NULL) OR (${t.actorType} = 'system' AND ${t.actorId} IS NULL)`,
    ),
    check(
      'state_events_context_check',
      sql`(${t.attemptId} IS NULL OR ${t.jobId} IS NOT NULL) AND (${t.resultId} IS NULL OR (${t.jobId} IS NOT NULL AND ${t.attemptId} IS NOT NULL))`,
    ),
    check(
      'state_events_state_check',
      sql`(
    (${t.entityType} = 'submission' AND ${isOneOf(t.nextState, SUBMISSION_STATES)} AND (${t.previousState} IS NULL OR ${isOneOf(t.previousState, SUBMISSION_STATES)})) OR
    (${t.entityType} = 'job' AND ${isOneOf(t.nextState, JUDGE_JOB_STATES)} AND (${t.previousState} IS NULL OR ${isOneOf(t.previousState, JUDGE_JOB_STATES)})) OR
    (${t.entityType} = 'attempt' AND ${isOneOf(t.nextState, JUDGE_ATTEMPT_STATES)} AND (${t.previousState} IS NULL OR ${isOneOf(t.previousState, JUDGE_ATTEMPT_STATES)})) OR
    (${t.entityType} = 'progress' AND ${isOneOf(t.nextState, PROGRESS_STATES)} AND (${t.previousState} IS NULL OR ${isOneOf(t.previousState, PROGRESS_STATES)}))
  )`,
    ),
    index('state_events_submission_idx').on(t.submissionId, t.occurredAt, t.id),
    index('state_events_job_idx').on(t.jobId, t.occurredAt, t.id),
    index('state_events_attempt_idx').on(t.attemptId),
    index('state_events_result_idx').on(t.resultId),
  ],
);

export const activityEvents = app.table(
  'activity_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    cohortId: uuid('cohort_id').references(() => cohorts.id, { onDelete: 'restrict' }),
    curriculumVersionId: uuid('curriculum_version_id').references(() => curriculumVersions.id, {
      onDelete: 'restrict',
    }),
    nodeKey: text('node_key'),
    submissionId: uuid('submission_id').references(() => submissions.id, { onDelete: 'restrict' }),
    resultId: uuid('result_id').references(() => judgeResults.id, { onDelete: 'restrict' }),
    checkpointAttemptId: uuid('checkpoint_attempt_id').references(() => checkpointAttempts.id, {
      onDelete: 'restrict',
    }),
    checkpointOutcomeId: uuid('checkpoint_outcome_id').references(() => checkpointOutcomes.id, {
      onDelete: 'restrict',
    }),
    correlationId: uuid('correlation_id').notNull(),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    occurredAt: time('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'activity_events_node_fk',
      columns: [t.curriculumVersionId, t.nodeKey],
      foreignColumns: [curriculumNodes.curriculumVersionId, curriculumNodes.nodeKey],
    }).onDelete('restrict'),
    foreignKey({
      name: 'activity_events_cohort_version_fk',
      columns: [t.cohortId, t.curriculumVersionId],
      foreignColumns: [cohorts.id, cohorts.curriculumVersionId],
    }).onDelete('restrict'),
    check('activity_events_version_check', sql`${t.eventVersion} > 0`),
    check(
      'activity_events_node_context_check',
      sql`${t.nodeKey} IS NULL OR ${t.curriculumVersionId} IS NOT NULL`,
    ),
    check('activity_events_payload_check', boundedObject(t.payload)),
    index('activity_events_cohort_type_idx').on(t.cohortId, t.eventType, t.occurredAt, t.id),
    index('activity_events_user_idx').on(t.userId),
    index('activity_events_curriculum_node_idx').on(t.curriculumVersionId, t.nodeKey),
    index('activity_events_submission_idx').on(t.submissionId),
    index('activity_events_result_idx').on(t.resultId),
  ],
);

export const checkpointDefinitions = app.table(
  'checkpoint_definitions',
  {
    curriculumVersionId: uuid('curriculum_version_id').notNull(),
    nodeKey: text('node_key').notNull(),
    definitionDigest: text('definition_digest').notNull(),
    definition: jsonb('definition').$type<JsonObject>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.curriculumVersionId, t.nodeKey] }),
    foreignKey({
      columns: [t.curriculumVersionId, t.nodeKey],
      foreignColumns: [curriculumNodes.curriculumVersionId, curriculumNodes.nodeKey],
    }).onDelete('restrict'),
    check('checkpoint_definition_digest', digest(t.definitionDigest)),
    check(
      'checkpoint_definition_policy',
      sql`${t.definition}->>'policyVersion'='1' AND ${t.definition}->>'durationSeconds'='5400' AND jsonb_array_length(${t.definition}->'tasks')=4`,
    ),
  ],
);
export const checkpointAttempts = app.table(
  'checkpoint_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cohortId: uuid('cohort_id').notNull(),
    userId: uuid('user_id').notNull(),
    curriculumVersionId: uuid('curriculum_version_id').notNull(),
    nodeKey: text('node_key').notNull(),
    requestId: uuid('request_id').notNull(),
    definitionDigest: text('definition_digest').notNull(),
    snapshot: jsonb('snapshot').$type<JsonObject>().notNull(),
    snapshotDigest: text('snapshot_digest').notNull(),
    normalSlot: integer('normal_slot').notNull(),
    kind: text('kind').notNull(),
    replacementFor: uuid('replacement_for'),
    startedAt: time('started_at').notNull(),
    deadlineAt: time('deadline_at').notNull(),
    closedAt: time('closed_at'),
    closureReason: text('closure_reason'),
    status: text('status').notNull().default('active'),
    completedAt: time('completed_at'),
    retakeAnnouncedAt: time('retake_announced_at'),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('checkpoint_attempt_identity').on(
      t.id,
      t.cohortId,
      t.userId,
      t.curriculumVersionId,
      t.nodeKey,
    ),
    unique('checkpoint_start_request').on(t.cohortId, t.userId, t.requestId),
    foreignKey({
      columns: [t.cohortId, t.userId],
      foreignColumns: [cohortMemberships.cohortId, cohortMemberships.userId],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.cohortId, t.curriculumVersionId],
      foreignColumns: [cohorts.id, cohorts.curriculumVersionId],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.curriculumVersionId, t.nodeKey],
      foreignColumns: [checkpointDefinitions.curriculumVersionId, checkpointDefinitions.nodeKey],
    }).onDelete('restrict'),
    foreignKey({ columns: [t.replacementFor], foreignColumns: [t.id] }).onDelete('restrict'),
    uniqueIndex('checkpoint_one_open')
      .on(t.cohortId, t.userId, t.nodeKey)
      .where(sql`${t.status} IN ('active','evaluating')`),
    check(
      'checkpoint_attempt_digest',
      sql`${digest(t.definitionDigest)} AND ${digest(t.snapshotDigest)}`,
    ),
    check(
      'checkpoint_attempt_policy',
      sql`${t.normalSlot} IN (1,2) AND ((${t.kind}='normal' AND ${t.replacementFor} IS NULL) OR (${t.kind}='replacement' AND ${t.replacementFor} IS NOT NULL)) AND ${t.deadlineAt}=${t.startedAt}+interval '90 minutes'`,
    ),
    check(
      'checkpoint_attempt_lifecycle',
      sql`(${t.status}='active' AND ${t.closedAt} IS NULL AND ${t.closureReason} IS NULL AND ${t.completedAt} IS NULL) OR (${t.status}='evaluating' AND ${t.closedAt} IS NOT NULL AND ${t.closureReason} IN ('finished','expired') AND ${t.completedAt} IS NULL) OR (${t.status} IN ('passed','failed','infrastructure_blocked') AND ${t.closedAt} IS NOT NULL AND ${t.closureReason} IN ('finished','expired') AND ${t.completedAt} IS NOT NULL)`,
    ),
    check(
      'checkpoint_attempt_time_order',
      sql`(${t.closedAt} IS NULL OR ${t.closedAt}>=${t.startedAt}) AND (${t.completedAt} IS NULL OR ${t.completedAt}>=${t.closedAt})`,
    ),
  ],
);
export const checkpointOutcomes = app.table(
  'checkpoint_outcomes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    attemptId: uuid('attempt_id').notNull().unique(),
    cohortId: uuid('cohort_id').notNull(),
    userId: uuid('user_id').notNull(),
    curriculumVersionId: uuid('curriculum_version_id').notNull(),
    nodeKey: text('node_key').notNull(),
    status: text('status').notNull(),
    points: integer('points').notNull(),
    evidence: jsonb('evidence').$type<JsonObject>().notNull(),
    evidenceDigest: text('evidence_digest').notNull(),
    appliedAt: time('applied_at').notNull(),
  },
  (t) => [
    unique('checkpoint_outcome_identity').on(
      t.id,
      t.cohortId,
      t.userId,
      t.curriculumVersionId,
      t.nodeKey,
    ),
    foreignKey({
      columns: [t.attemptId, t.cohortId, t.userId, t.curriculumVersionId, t.nodeKey],
      foreignColumns: [
        checkpointAttempts.id,
        checkpointAttempts.cohortId,
        checkpointAttempts.userId,
        checkpointAttempts.curriculumVersionId,
        checkpointAttempts.nodeKey,
      ],
    }).onDelete('restrict'),
    check(
      'checkpoint_outcome_score',
      sql`${t.points} BETWEEN 0 AND 4 AND ((${t.status}='passed' AND ${t.points}>=3) OR (${t.status} IN ('failed','infrastructure_blocked') AND ${t.points}<3))`,
    ),
    check('checkpoint_evidence_digest', digest(t.evidenceDigest)),
  ],
);
export const checkpointReplacementGrants = app.table(
  'checkpoint_replacement_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    attemptId: uuid('attempt_id')
      .notNull()
      .unique()
      .references(() => checkpointAttempts.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    grantedAt: time('granted_at').notNull().defaultNow(),
    replacementAttemptId: uuid('replacement_attempt_id')
      .unique()
      .references(() => checkpointAttempts.id, { onDelete: 'restrict' }),
  },
  (t) => [
    check('checkpoint_replacement_reason', sql`${t.reason}='trusted_infrastructure_failure'`),
  ],
);
