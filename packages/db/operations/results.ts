import { sql } from 'drizzle-orm';
import {
  resultProgression,
  type Prerequisite,
  type ProgressState,
  type SubmissionState,
} from '@nextera/domain';
import type { OperationalDatabase } from './curriculum';

type Identity = {
  id: string;
  job_id: string;
  attempt_id: string;
  evaluation_digest: string;
  verdict: SubmissionState;
  application_status: string;
  processed_at: Date | null;
  application_reason: string | null;
};

/** Trusted product operation. Its sole caller-supplied identity is the durable result ID.
 * This database connection must be dedicated to result application, never the web runtime.
 */
export async function applyResult(db: OperationalDatabase, resultId: string) {
  return db.transaction(async (tx) => {
    const [auth] = await tx.execute(
      sql`SELECT pg_has_role(session_user,'nextera_result_application','USAGE') AS allowed`,
    );
    if (!auth?.allowed) throw new Error('RESULT_APPLICATION_UNAUTHORIZED');
    const [lookup] = await tx.execute(
      sql`SELECT job_id FROM judge.results WHERE id=${resultId}::uuid`,
    );
    if (!lookup) throw new Error('RESULT_NOT_FOUND');
    const [job] = await tx.execute(
      sql`SELECT * FROM judge.jobs WHERE id=${lookup.job_id}::uuid FOR UPDATE`,
    );
    if (!job) throw new Error('RESULT_IDENTITY_CONFLICT');
    const [submission] = await tx.execute(
      sql`SELECT * FROM app.submissions WHERE id=${job.submission_id}::uuid FOR UPDATE`,
    );
    const [rawResult] = await tx.execute(
      sql`SELECT * FROM judge.results WHERE id=${resultId}::uuid FOR UPDATE`,
    );
    const result = rawResult as unknown as Identity;
    if (
      !submission ||
      !result ||
      result.job_id !== job.id ||
      result.evaluation_digest !== job.evaluation_digest
    )
      throw new Error('RESULT_IDENTITY_CONFLICT');
    // Same serialization key as intake; independent learners remain independent.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${String(submission.cohort_id)}||${String(submission.user_id)},4))`,
    );
    const [membership] = await tx.execute(
      sql`SELECT * FROM app.cohort_memberships WHERE cohort_id=${submission.cohort_id}::uuid AND user_id=${submission.user_id}::uuid FOR UPDATE`,
    );
    const progress = await tx.execute(
      sql`SELECT * FROM app.learner_node_progress WHERE cohort_id=${submission.cohort_id}::uuid AND user_id=${submission.user_id}::uuid ORDER BY node_key FOR UPDATE`,
    );
    const [projection] = await tx.execute(
      sql`SELECT n.kind,n.evaluation_spec_digest,c.curriculum_version_id,v.status FROM app.curriculum_nodes n JOIN app.cohorts c ON c.id=${submission.cohort_id}::uuid JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id WHERE n.curriculum_version_id=${submission.curriculum_version_id}::uuid AND n.node_key=${submission.node_key}`,
    );
    const snapshot = job.evaluation_snapshot as Record<string, unknown>;
    if (
      !membership ||
      !projection ||
      projection.status !== 'published' ||
      projection.curriculum_version_id !== submission.curriculum_version_id ||
      projection.evaluation_spec_digest !== submission.evaluation_spec_digest ||
      snapshot.submission_id !== submission.id ||
      snapshot.learner_id !== submission.user_id ||
      snapshot.cohort_id !== submission.cohort_id ||
      snapshot.curriculum_version_id !== submission.curriculum_version_id ||
      snapshot.node_key !== submission.node_key ||
      snapshot.evaluation_spec_digest !== submission.evaluation_spec_digest ||
      progress.some((p) => p.curriculum_version_id !== submission.curriculum_version_id)
    )
      throw new Error('PROGRESS_IDENTITY_CONFLICT');

    const [attempt] = await tx.execute(
      sql`SELECT * FROM judge.attempts WHERE id=${result.attempt_id}::uuid AND job_id=${job.id}::uuid`,
    );
    if (!attempt || !['completed', 'system_error'].includes(String(attempt.state)))
      throw new Error('RESULT_NOT_TERMINAL');
    const authoritative =
      submission.active_judge_job_id === job.id && job.terminal_result_id === result.id;
    if (result.application_status !== 'pending') {
      if (
        !result.processed_at ||
        (result.application_status === 'applied' &&
          (!authoritative ||
            submission.state !== result.verdict ||
            result.application_reason !== 'terminal_result_applied')) ||
        (result.application_status === 'superseded' &&
          (authoritative ||
            result.application_reason !==
              (submission.active_judge_job_id === job.id
                ? 'intermediate_infrastructure_result'
                : 'superseded_evaluation') ||
            (submission.active_judge_job_id === job.id && result.verdict !== 'system_error')))
      )
        throw new Error('APPLICATION_RECEIPT_CONFLICT');
      return result;
    }
    const [clock] = await tx.execute(sql`SELECT clock_timestamp() AS at`);
    const at = clock!.at as Date;
    if (!authoritative) {
      if (
        submission.active_judge_job_id === job.id &&
        (result.verdict !== 'system_error' ||
          Number(attempt.attempt_number) > Number(job.retry_count))
      )
        throw new Error('RESULT_NOT_TERMINAL');
      const reason =
        submission.active_judge_job_id === job.id
          ? 'intermediate_infrastructure_result'
          : 'superseded_evaluation';
      const [receipt] = await tx.execute(
        sql`UPDATE judge.results SET application_status='superseded',processed_at=${at},application_reason=${reason} WHERE id=${result.id}::uuid RETURNING *`,
      );
      return receipt as unknown as Identity;
    }
    if (
      !['completed', 'system_error'].includes(String(job.state)) ||
      (result.verdict === 'system_error'
        ? job.state !== 'system_error' || attempt.state !== 'system_error'
        : job.state !== 'completed' || attempt.state !== 'completed') ||
      !['passed', 'failed', 'compile_error', 'runtime_error', 'timeout', 'system_error'].includes(
        result.verdict,
      )
    )
      throw new Error('RESULT_NOT_TERMINAL');
    if (!['queued', 'running'].includes(String(submission.state)))
      throw new Error('SUBMISSION_LIFECYCLE_CONFLICT');
    const nodes = await tx.execute(
      sql`SELECT node_key FROM app.curriculum_nodes WHERE curriculum_version_id=${submission.curriculum_version_id}::uuid ORDER BY node_key`,
    );
    if (
      nodes.length !== progress.length ||
      nodes.some((n, i) => n.node_key !== progress[i]?.node_key)
    )
      throw new Error('PROGRESS_IDENTITY_CONFLICT');
    const edges = await tx.execute(
      sql`SELECT prerequisite_node_key AS "from",dependent_node_key AS "to",rule FROM app.node_prerequisites WHERE curriculum_version_id=${submission.curriculum_version_id}::uuid`,
    );
    if (edges.some((e) => e.rule !== 'requires_pass')) throw new Error('UNSUPPORTED_PREREQUISITE');
    if (projection.kind !== 'challenge' && result.verdict === 'passed')
      throw new Error('UNSUPPORTED_MASTERY_KIND');
    const changes = resultProgression(
      String(submission.node_key),
      result.verdict,
      new Map(progress.map((p) => [String(p.node_key), p.state as ProgressState])),
      edges as unknown as Prerequisite[],
    );
    await tx.execute(
      sql`UPDATE app.submissions SET state=${result.verdict}::app.submission_state,finished_at=${at} WHERE id=${submission.id}::uuid`,
    );
    const event = async (node: string, type: string) =>
      tx.execute(
        sql`INSERT INTO app.activity_events(event_type,event_version,user_id,cohort_id,curriculum_version_id,node_key,submission_id,result_id,correlation_id,payload) VALUES(${type},1,${submission.user_id}::uuid,${submission.cohort_id}::uuid,${submission.curriculum_version_id}::uuid,${node},${submission.id}::uuid,${result.id}::uuid,${job.id}::uuid,'{}'::jsonb)`,
      );
    const audit = async (entity: string, previous: string, next: string, reason: string) =>
      tx.execute(
        sql`INSERT INTO app.state_events(submission_id,job_id,attempt_id,result_id,entity_type,previous_state,next_state,actor_type,reason,correlation_id) VALUES(${submission.id}::uuid,${job.id}::uuid,${result.attempt_id}::uuid,${result.id}::uuid,${entity},${previous},${next},'system',${reason},${job.id}::uuid)`,
      );
    await audit('submission', String(submission.state), result.verdict, 'terminal_result_applied');
    for (const change of changes) {
      if (change.next === 'mastered') {
        await tx.execute(
          sql`UPDATE app.learner_node_progress SET state='mastered',started_at=coalesce(started_at,${submission.created_at}),mastered_at=${at},first_passing_submission_id=${submission.id}::uuid WHERE cohort_id=${submission.cohort_id}::uuid AND user_id=${submission.user_id}::uuid AND curriculum_version_id=${submission.curriculum_version_id}::uuid AND node_key=${change.node}`,
        );
      } else {
        await tx.execute(
          sql`UPDATE app.learner_node_progress SET state='available',unlocked_at=${at} WHERE cohort_id=${submission.cohort_id}::uuid AND user_id=${submission.user_id}::uuid AND curriculum_version_id=${submission.curriculum_version_id}::uuid AND node_key=${change.node}`,
        );
      }
      await audit(
        'progress',
        change.previous,
        change.next,
        `${change.next === 'mastered' ? 'challenge_mastered' : 'node_unlocked'}:${change.node}`,
      );
      await event(change.node, change.next === 'mastered' ? 'challenge_mastered' : 'node_unlocked');
    }
    if (result.verdict !== 'passed')
      await event(
        String(submission.node_key),
        result.verdict === 'system_error'
          ? 'submission_infrastructure_failure'
          : 'submission_terminal_learner_failure',
      );
    const [receipt] = await tx.execute(
      sql`UPDATE judge.results SET application_status='applied',processed_at=${at},application_reason='terminal_result_applied' WHERE id=${result.id}::uuid RETURNING *`,
    );
    return receipt as unknown as Identity;
  });
}

/** Scan without holding result locks before job locks. Each item has its own atomic
 * transaction. Duplicated scans converge under the same job/receipt locks.
 */
export async function reconcileResults(db: OperationalDatabase, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_BATCH');
  const rows = await db.execute(
    sql`SELECT id,greatest(0,extract(epoch FROM (clock_timestamp()-recorded_at))*1000) AS pending_age_ms FROM judge.results WHERE application_status='pending' ORDER BY recorded_at,id LIMIT ${limit}`,
  );
  const outcomes: { id: string; status: string; pending_age_ms: number }[] = [];
  for (const row of rows) {
    try {
      const receipt = await applyResult(db, String(row.id));
      outcomes.push({
        id: receipt.id,
        status: receipt.application_status,
        pending_age_ms: Number(row.pending_age_ms),
      });
    } catch {
      outcomes.push({
        id: String(row.id),
        status: 'attention_required',
        pending_age_ms: Number(row.pending_age_ms),
      });
    }
  }
  return outcomes;
}
