import { checkpointScoredExamMetadata, checkpointScoredExamResult } from '@nextera/domain';
import { scoredCheckpointExecutionLabel } from '../../lib/learning/checkpoint-presentation';
import Link from 'next/link';
import type { CheckpointPresentation } from '../../lib/learning/checkpoint-presentation';
import type { LearningOverview } from '../../lib/learning/types';
import { StatusBadge } from './primitives';
import { HairlineFigure } from './hairline-figure';
import { RefreshLearning } from './refresh-learning';
import { RecordDetails, SafeHistory, WorkspaceEmpty } from './workspace-parts';
import { formatMoment } from '../../lib/learning/display';
import s from './workspace.module.css';
import c from './checkpoint-result.module.css';
import { LearningSurface } from './design-exploration';
const copy = {
  passed: {
    label: 'PASS',
    title: 'You proved the foundation.',
    detail: 'The authoritative checkpoint outcome is PASS. This result is permanent.',
  },
  failed: {
    label: 'LEARNER FAIL',
    title: 'The checkpoint was not passed.',
    detail:
      "The authoritative evaluation did not meet this exam's passing threshold. This attempt grants no gated unlock.",
  },
  infrastructure_blocked: {
    label: 'INFRASTRUCTURE BLOCKED',
    title: 'A fair result needs recovery.',
    detail:
      'Infrastructure prevented a fair final outcome. This is not learner failure. Recovery requires an authorized replacement grant.',
  },
} as const;
export function CheckpointResult({
  view,
  overview,
  cohort,
  node,
  attemptId,
}: {
  view: CheckpointPresentation;
  overview: LearningOverview;
  cohort: string;
  node: string;
  attemptId?: string | undefined;
}) {
  const attempt = view.history.find((h) => h.id === (attemptId ?? view.attempt?.id));
  const selectedCurrent = !!attempt && attempt.id === view.attempt?.id;
  const selectedMarker = checkpointScoredExamMetadata(
    attempt?.scored_exam ?? (selectedCurrent ? view.scored_exam : undefined),
  );
  const markedNode = checkpointScoredExamMetadata(view.scored_exam);
  if (selectedMarker || (markedNode && !selectedCurrent)) {
    const result = selectedMarker
      ? checkpointScoredExamResult(selectedCurrent ? view.scored_result : attempt?.scored_result)
      : null;
    return (
      <ScoredCheckpointResult
        view={view}
        overview={overview}
        cohort={cohort}
        node={node}
        attempt={attempt}
        result={result}
        current={selectedCurrent}
      />
    );
  }
  const outcome =
    attempt &&
    attempt.outcome_id &&
    (attempt.status === 'passed' ||
      attempt.status === 'failed' ||
      attempt.status === 'infrastructure_blocked')
      ? copy[attempt.status]
      : null;
  const base = `/app/cohorts/${cohort}/checkpoints/${node}`;
  if (!outcome || !attempt)
    return (
      <LearningSurface page="checkpoint">
        <section className={s.card + ' ' + c.pending}>
          <h1>Checkpoint result</h1>
          <WorkspaceEmpty
            title={
              view.attempt ? 'The result is still being evaluated' : 'No checkpoint result yet'
            }
          >
            {view.attempt
              ? 'Accepted work remains valid after the deadline. Only the server can finalize this attempt.'
              : 'An authorized checkpoint attempt creates a durable result after finalization.'}
          </WorkspaceEmpty>
          <div className={s.actions}>
            <Link className={s.button + ' ' + c.button} href={base}>
              Return to checkpoint
            </Link>
            <RefreshLearning />
          </div>
        </section>
      </LearningSurface>
    );
  const current = attempt.id === view.attempt?.id;
  // Historical policy is frozen per attempt; legacy projections may omit it.
  const policy = attempt.policy ?? (current ? view.policy : null);
  const taskCount = policy?.task_count ?? (current && view.tasks.length ? view.tasks.length : null);
  const recordedScore = `${attempt.points ?? '—'}${taskCount === null ? '' : ` / ${taskCount}`}`;
  const mastered = overview.nodes.find((n) => n.key === node)?.state === 'mastered';
  return (
    <LearningSurface page="checkpoint">
      <div className={s.stack + ' ' + c.results}>
        <section
          className={s.card + ' ' + s.result + ' ' + c.outcome}
          data-state={attempt.status}
          aria-label="Authoritative checkpoint result"
        >
          {attempt.status === 'infrastructure_blocked' ? (
            <HairlineFigure kind="gate" state="infrastructure_blocked" />
          ) : (
            <div className={s.score + ' ' + c.score}>
              <strong>{recordedScore}</strong>
              <span>Authoritative task passes</span>
              {policy && (
                <span>
                  Passing threshold: {policy.pass_points} / {policy.task_count}
                </span>
              )}
            </div>
          )}
          <div>
            <StatusBadge state={attempt.status} label={outcome.label} />
            <h1>{outcome.title}</h1>
            <p>{outcome.detail}</p>
            {attempt.status === 'infrastructure_blocked' && (
              <p style={{ marginTop: 12 }}>
                {recordedScore} task passes recorded. No learner FAIL has been declared.
              </p>
            )}
            <div className={s.actions}>
              <Link
                className={
                  s.button +
                  ' ' +
                  c.button +
                  ' ' +
                  (attempt.status === 'passed' ? c.primary : c.navigation)
                }
                href={'/app/cohorts/' + cohort}
              >
                See updated Roadmap
              </Link>
              <Link
                className={s.button + ' ' + c.button}
                href={'/app/cohorts/' + cohort + '/evidence'}
              >
                View Evidence
              </Link>
            </div>
          </div>
        </section>
        <div className={s.equalColumns + ' ' + c.columns}>
          <section className={s.card}>
            <h2>Authoritative task evidence</h2>
            {current ? (
              <ul className={s.history}>
                {view.tasks.map((t) => (
                  <li key={t.key} className={s.record}>
                    <div className={s.recordHead}>
                      <strong>{t.title}</strong>
                      <StatusBadge
                        state={
                          t.passed
                            ? 'passed'
                            : (view.display.tasks.find((d) => d.key === t.key)?.state ?? 'closed')
                        }
                      />
                    </div>
                    <SafeHistory items={view.submissions.filter((h) => h.task_key === t.key)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.muted}>
                This historical outcome is retained. Individual task history is available only for
                the current attempt through the existing safe projection.
              </p>
            )}
          </section>
          <div className={s.stack}>
            <section className={s.card}>
              <h2>Journey update</h2>
              {attempt.status === 'passed' ? (
                <>
                  <p>
                    {mastered
                      ? 'Checkpoint mastery is stored in your current progress.'
                      : 'Refresh to view the latest stored progression.'}
                  </p>
                  <h3 style={{ marginTop: 20 }}>Current available progression</h3>
                  <p className={s.muted}>
                    Stored access is shown below; no new unlock is inferred from this screen.
                  </p>
                  <ul className={s.context} style={{ marginTop: 16 }}>
                    {overview.nodes
                      .filter((n) => n.state === 'available')
                      .map((n) => (
                        <li key={n.key}>
                          {n.href ? <Link href={n.href}>{n.title}</Link> : n.title}
                          <StatusBadge state={n.state} />
                        </li>
                      ))}
                  </ul>
                  {!overview.nodes.some((n) => n.state === 'available') && (
                    <p className={s.muted}>No additional available nodes are recorded.</p>
                  )}
                </>
              ) : attempt.status === 'failed' ? (
                <>
                  <p>
                    This attempt did not master the checkpoint. Retake access is controlled by the
                    server.
                  </p>
                  {current && view.display.startAvailable ? (
                    <div className={s.actions}>
                      <Link className={s.button + ' ' + c.button} href={base}>
                        Review server-authorized next attempt
                      </Link>
                    </div>
                  ) : (
                    <p className={s.muted} style={{ marginTop: 12 }}>
                      No retake access is currently confirmed on this screen.
                    </p>
                  )}
                  {current && view.attempt?.retake_at && (
                    <p className={s.muted}>
                      Earliest policy retake time: {formatMoment(view.attempt.retake_at)}. This
                      timestamp alone does not grant access.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className={s.notice} data-tone="system">
                    Infrastructure recovery is separate from normal retakes. This screen cannot
                    grant replacement eligibility.
                  </p>
                  <p style={{ marginTop: 12 }}>
                    {current && view.replacement_available
                      ? 'An authorized replacement grant is recorded. Return to the checkpoint to review current access.'
                      : 'No replacement grant is shown for this attempt. An operator must authorize any replacement.'}
                  </p>
                </>
              )}
            </section>
            <section className={s.card}>
              <h2>Durable outcome record</h2>
              {attempt.completed_at && (
                <time dateTime={attempt.completed_at}>{formatMoment(attempt.completed_at)}</time>
              )}
              <RecordDetails>
                <p className={s.muted}>Checkpoint outcome</p>
                <code className={s.identity}>{attempt.outcome_id}</code>
                <p className={s.muted}>Attempt identity</p>
                <code className={s.identity}>{attempt.id}</code>
              </RecordDetails>
            </section>
          </div>
        </div>
      </div>
    </LearningSurface>
  );
}

/** The enclosing selected attempt binds this native projection. Never use current totals
 * for a historical selection, legacy task-pass counts, or job verdicts as rubric grades. */
function ScoredCheckpointResult({
  view,
  overview,
  cohort,
  node,
  attempt,
  result,
  current,
}: {
  view: CheckpointPresentation;
  overview: LearningOverview;
  cohort: string;
  node: string;
  attempt: CheckpointPresentation['history'][number] | undefined;
  result: ReturnType<typeof checkpointScoredExamResult>;
  current: boolean;
}) {
  const base = `/app/cohorts/${cohort}/checkpoints/${node}`;
  if (
    !attempt ||
    !result ||
    !['passed', 'failed'].includes(result.status) ||
    result.total_points === null ||
    result.coding_points === null ||
    result.outcome_id === null
  )
    return (
      <LearningSurface page="checkpoint">
        <section className={s.card + ' ' + c.pending}>
          <h1>Exam result</h1>
          <WorkspaceEmpty
            title={
              result?.status === 'in_progress'
                ? 'Exam in progress'
                : 'Result provisional — awaiting evaluation and review'
            }
          >
            {attempt
              ? 'Your weighted result is available after evaluation and the required review. Submitted answers remain separate from saved drafts. You do not need to wait for a mentor to finish the exam.'
              : 'No matching authoritative attempt result is available.'}
          </WorkspaceEmpty>
          <div className={s.actions}>
            <Link className={s.button + ' ' + c.button} href={base}>
              Return to checkpoint
            </Link>
            <RefreshLearning />
          </div>
        </section>
      </LearningSurface>
    );
  const passed = result.status === 'passed';
  const mastered = overview.nodes.find((n) => n.key === node)?.state === 'mastered';
  return (
    <LearningSurface page="checkpoint">
      <div className={s.stack + ' ' + c.results}>
        <section
          className={s.card + ' ' + s.result + ' ' + c.outcome}
          data-state={result.status}
          aria-label="Authoritative exam result"
        >
          <div className={s.score + ' ' + c.score}>
            <strong>{result.total_points} / 100</strong>
            <span>Final weighted result</span>
            <span>{result.coding_points} / 75 coding</span>
          </div>
          <div>
            <StatusBadge state={result.status} label={passed ? 'PASS' : 'NOT PASSED'} />
            <h1>{passed ? 'The exam was passed.' : 'The exam was not passed.'}</h1>
            <p>
              This result comes from the authoritative finalized scoring record for this exact
              attempt, including the required review evidence.
            </p>
            <div className={s.actions}>
              <Link
                className={s.button + ' ' + c.button + ' ' + (passed ? c.primary : c.navigation)}
                href={'/app/cohorts/' + cohort}
              >
                See updated Roadmap
              </Link>
              <Link
                className={s.button + ' ' + c.button}
                href={'/app/cohorts/' + cohort + '/evidence'}
              >
                View Evidence
              </Link>
            </div>
          </div>
        </section>
        <div className={s.equalColumns + ' ' + c.columns}>
          <section className={s.card}>
            <h2>Recorded answer evidence</h2>
            <p>Execution feedback alone does not determine the question grade.</p>
            {current ? (
              <ul className={s.history}>
                {view.tasks.map((task) => (
                  <li key={task.key} className={s.record}>
                    <strong>{task.title}</strong>
                    {view.submissions
                      .filter((submission) => submission.task_key === task.key)
                      .map((submission) => (
                        <p key={submission.id}>
                          {scoredCheckpointExecutionLabel(submission.state, true)}
                        </p>
                      ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.muted}>
                This historical attempt’s finalized outcome is retained. Current-attempt answer
                history is not substituted for historical evidence.
              </p>
            )}
          </section>
          <div className={s.stack}>
            <section className={s.card}>
              <h2>Journey update</h2>
              <p>
                {passed
                  ? mastered
                    ? 'Exam mastery is stored in your current progress.'
                    : 'Refresh to view the latest stored progression.'
                  : 'This finalized result did not meet the published mastery criteria. No automatic retake is granted.'}
              </p>
              <h3 style={{ marginTop: 20 }}>Current available progression</h3>
              <p className={s.muted}>
                The stored cohort schedule and access remain authoritative; no release is inferred
                from this screen.
              </p>
              <ul className={s.context} style={{ marginTop: 16 }}>
                {overview.nodes
                  .filter((n) => n.state === 'available')
                  .map((n) => (
                    <li key={n.key}>
                      {n.href ? <Link href={n.href}>{n.title}</Link> : n.title}
                      <StatusBadge state={n.state} />
                    </li>
                  ))}
              </ul>
            </section>
            <section className={s.card}>
              <h2>Durable outcome record</h2>
              {attempt.completed_at && (
                <time dateTime={attempt.completed_at}>{formatMoment(attempt.completed_at)}</time>
              )}
              <RecordDetails>
                <p className={s.muted}>Scored exam outcome</p>
                <code className={s.identity}>{result.outcome_id}</code>
                <p className={s.muted}>Attempt identity</p>
                <code className={s.identity}>{attempt.id}</code>
              </RecordDetails>
            </section>
          </div>
        </div>
      </div>
    </LearningSurface>
  );
}
