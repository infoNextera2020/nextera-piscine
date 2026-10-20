import Link from 'next/link';
import type { CheckpointPresentation } from '../../lib/learning/checkpoint-presentation';
import type { LearningOverview } from '../../lib/learning/types';
import { StatusBadge } from './primitives';
import { HairlineFigure } from './hairline-figure';
import { RefreshLearning } from './refresh-learning';
import { RecordDetails, SafeHistory, WorkspaceEmpty } from './workspace-parts';
import { formatMoment } from '../../lib/learning/display';
import s from './workspace.module.css';
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
      'The authoritative evaluation did not meet the 3 of 4 task threshold. This attempt grants no gated unlock.',
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
      <section className={s.card}>
        <h1>Checkpoint result</h1>
        <WorkspaceEmpty
          title={view.attempt ? 'The result is still being evaluated' : 'No checkpoint result yet'}
        >
          {view.attempt
            ? 'Accepted work remains valid after the deadline. Only the server can finalize this attempt.'
            : 'An authorized checkpoint attempt creates a durable result after finalization.'}
        </WorkspaceEmpty>
        <div className={s.actions}>
          <Link className={s.button} href={base}>
            Return to checkpoint
          </Link>
          <RefreshLearning />
        </div>
      </section>
    );
  const current = attempt.id === view.attempt?.id;
  const mastered = overview.nodes.find((n) => n.key === node)?.state === 'mastered';
  return (
    <div className={s.stack}>
      <section
        className={s.card + ' ' + s.result}
        data-state={attempt.status}
        aria-label="Authoritative checkpoint result"
      >
        {attempt.status === 'infrastructure_blocked' ? (
          <HairlineFigure kind="gate" state="infrastructure_blocked" />
        ) : (
          <div className={s.score}>
            <strong>{attempt.points ?? '—'} / 4</strong>
            <span>Authoritative task passes</span>
          </div>
        )}
        <div>
          <StatusBadge state={attempt.status} label={outcome.label} />
          <h1>{outcome.title}</h1>
          <p>{outcome.detail}</p>
          {attempt.status === 'infrastructure_blocked' && (
            <p style={{ marginTop: 12 }}>
              {attempt.points ?? '—'} / 4 task passes recorded. No learner FAIL has been declared.
            </p>
          )}
          <div className={s.actions}>
            <Link
              className={s.button + ' ' + (attempt.status === 'passed' ? s.primary : s.navigation)}
              href={'/app/cohorts/' + cohort}
            >
              See updated Roadmap
            </Link>
            <Link className={s.button} href={'/app/cohorts/' + cohort + '/evidence'}>
              View Evidence
            </Link>
          </div>
        </div>
      </section>
      <div className={s.equalColumns}>
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
              This historical outcome is retained. Individual task history is available only for the
              current attempt through the existing safe projection.
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
                    <Link className={s.button} href={base}>
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
                  Infrastructure recovery is separate from normal retakes. This screen cannot grant
                  replacement eligibility.
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
  );
}
