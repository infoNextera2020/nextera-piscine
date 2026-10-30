'use client';
import raidStyles from './raid.module.css';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  isRequestId,
  type RaidAttemptView,
  type RaidView,
  type SubmissionRules,
} from '@nextera/domain';
import { SubmissionForm } from '../submissions/form';
import { SubmissionIntents } from '../submissions/retry-intent';
import { HairlineIcon } from '../../components/learning/hairline-icon';
import { formatMoment, displayState } from '../learning/display';
import { LearningSurface } from '../../components/learning/design-exploration';

export const raidLabels: Record<RaidAttemptView['status'], string> = {
  awaiting_checks: 'Automated checks pending',
  attention_required: 'Evaluation needs attention',
  changes_required: 'Changes required',
  awaiting_review: 'Awaiting mentor review',
  owner_decision_required: 'Owner decision required',
  completed: 'Team completed',
  superseded: 'Previous revision',
};
/** A review receipt is not necessarily a shared outcome. */
export function raidReviewReceiptMessage(
  record: { review_id?: unknown; outcome_id?: unknown },
  decision: string,
) {
  if (
    typeof record.review_id !== 'string' ||
    !isRequestId(record.review_id) ||
    (record.outcome_id !== undefined &&
      record.outcome_id !== null &&
      (typeof record.outcome_id !== 'string' || !isRequestId(record.outcome_id)))
  )
    return null;
  if (record.outcome_id) return 'Shared completion recorded.';
  if (decision === 'changes_requested') return 'Changes requested for this revision.';
  if (decision === 'approved')
    return 'Review receipt confirmed. Refresh the shared result before treating this Raid as complete.';
  return null;
}

export function RaidPanel({
  cohort,
  node,
  team,
  initial,
  rules,
  brief,
}: {
  cohort: string;
  node: string;
  team?: string | undefined;
  initial: RaidView | null;
  rules: SubmissionRules;
  brief?: ReactNode;
}) {
  const [view, setView] = useState<RaidView | null>(initial),
    [error, setError] = useState(''),
    [accessRemoved, setAccessRemoved] = useState(false);
  const request = useRef<AbortController | null>(null);
  const hideProtected = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setView(null);
    setAccessRemoved(true);
    setError(
      'Raid access could not be confirmed. Protected brief, team records and controls are hidden.',
    );
  }, []);
  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    try {
      const query = new URLSearchParams({ cohort, node, ...(team ? { team } : {}) });
      const response = await fetch('/api/raids?' + query.toString(), {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted || request.current !== controller) return;
      if (response.status === 401 || response.status === 403) {
        hideProtected();
        return;
      }
      if (!response.ok) throw new Error();
      const next = (await response.json()) as RaidView;
      if (!Array.isArray(next.attempts)) throw new Error();
      if (!controller.signal.aborted && request.current === controller) {
        setView(next);
        setAccessRemoved(false);
        setError('');
      }
    } catch {
      if (!controller.signal.aborted && request.current === controller)
        setError(
          'Raid access or results could not be confirmed. Refresh before taking another action.',
        );
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [cohort, node, team, hideProtected]);
  useEffect(() => {
    const visible = () => {
      if (!accessRemoved && document.visibilityState === 'visible') void refresh();
    };
    const timer = !accessRemoved ? setInterval(visible, 5000) : undefined;
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      request.current?.abort();
      request.current = null;
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, accessRemoved]);
  if (accessRemoved)
    return (
      <LearningSurface page="project">
        <section className={raidStyles.access} aria-label="Raid access unavailable">
          <h2>Access must be confirmed</h2>
          <p role="alert">{error}</p>
          <button className={raidStyles.outlineButton} onClick={() => void refresh()}>
            Retry authorized read
          </button>
          <Link className={raidStyles.outlineButton} href={'/app/cohorts/' + cohort}>
            Return to Journey <HairlineIcon name="arrow" />
          </Link>
        </section>
      </LearningSurface>
    );
  const latest =
    view?.attempts.reduce<RaidAttemptView | null>(
      (a, b) => (!a || b.ordinal > a.ordinal ? b : a),
      null,
    ) ?? null;
  const previous = view?.attempts.filter((a) => a.id !== latest?.id) ?? [];
  return (
    <LearningSurface page="project">
      <div className={raidStyles.workspace + ' ' + raidStyles.controls} aria-label="Team Raid">
        {error && (
          <div className={raidStyles.alert} role="alert">
            <p>{error}</p>
            <button className={raidStyles.outlineButton} onClick={() => void refresh()}>
              Retry authorized read
            </button>
          </div>
        )}
        <section className={raidStyles.brief}>
          <span className={raidStyles.eyebrow}>Project brief</span>
          <h2>Work with your team</h2>
          <p>
            Build your solution in your own editor and terminal. Upload one shared source file for
            the team.
          </p>
          <p>A revised upload needs new checks and a fresh mentor review.</p>
          <div className={raidStyles.editorNote}>
            <HairlineIcon name="code" size={56} />
            <strong>One accepted file. One exact revision.</strong>
          </div>
          {brief && <div className={raidStyles.authoredBrief}>{brief}</div>}
        </section>
        <section className={raidStyles.team} aria-label="Current team assignment">
          <span className={raidStyles.eyebrow}>Current team</span>
          <h2>
            {view ? (view.team?.name ?? 'Team assignment pending') : 'Team workflow unavailable'}
          </h2>
          {view?.team ? (
            <>
              <ul>
                {view.team.members.map((member) => (
                  <li key={member.id}>{member.displayName}</li>
                ))}
              </ul>
              <p>Assigned mentor: {view.team.mentor}</p>
            </>
          ) : (
            <p>
              {view
                ? 'Your owner must assign a team of exactly three before a shared upload.'
                : 'Shared team workflow is unavailable in this environment. The published brief remains read-only.'}
            </p>
          )}
          <p className={raidStyles.small}>
            Each accepted revision records its own frozen members. Later assignments do not change
            that history.
          </p>
        </section>
        <section className={raidStyles.history} aria-labelledby="raid-history-heading">
          <div className={raidStyles.historyHeading}>
            <h2 id="raid-history-heading">Shared team history</h2>
            <button className={raidStyles.outlineButton} onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
          {view ? (
            <>
              <RaidHistory
                attempts={latest ? [latest] : []}
                canReview={view.can_review}
                paused={!!error}
                onReviewed={() => void refresh()}
                onAccessRemoved={hideProtected}
              />
              {previous.length > 0 && (
                <details className={raidStyles.earlier}>
                  <summary>Earlier revisions ({previous.length})</summary>
                  <RaidHistory
                    attempts={previous}
                    canReview={view.can_review}
                    paused={!!error}
                    onReviewed={() => void refresh()}
                    onAccessRemoved={hideProtected}
                  />
                </details>
              )}
            </>
          ) : (
            <p>No shared history can be confirmed until the team workflow is available.</p>
          )}
        </section>
        <section className={raidStyles.upload}>
          {view?.can_submit && !error ? (
            <SubmissionForm
              cohort={cohort}
              node={node}
              filename={rules.required_files[0]!}
              maxSizeKb={rules.max_size_kb}
              copy={{
                heading: latest ? 'New revision' : 'Shared source file',
                description:
                  'Build locally and upload one shared file. Earlier accepted files and frozen team records stay unchanged.',
                submitLabel: latest ? 'Upload new revision' : 'Upload team source',
              }}
              onAccepted={() => void refresh()}
              onAccessUnavailable={hideProtected}
            />
          ) : (
            <>
              <h2>Shared upload unavailable</h2>
              <p>
                Upload is unavailable under the current team, access or evaluation configuration.
              </p>
              <button className={raidStyles.outlineButton} onClick={() => void refresh()}>
                Recheck team access
              </button>
            </>
          )}
        </section>
      </div>
    </LearningSurface>
  );
}
export function RaidHistory({
  attempts,
  canReview = false,
  onReviewed,
  paused = false,
  onAccessRemoved,
}: {
  attempts: RaidAttemptView[];
  canReview?: boolean;
  onReviewed?: (() => void) | undefined;
  paused?: boolean;
  onAccessRemoved?: (() => void) | undefined;
}) {
  if (!attempts.length)
    return (
      <p className={raidStyles.muted}>
        No shared upload yet. Automated checks and mentor feedback will appear here.
      </p>
    );
  return (
    <ol className={raidStyles.revisions}>
      {attempts.map((a) => (
        <li key={a.id}>
          <div className={raidStyles.recordHeading}>
            <strong>Revision {a.ordinal}</strong>
            <span className={raidStyles.verdict} data-state={a.status}>
              {raidLabels[a.status]}
            </span>
          </div>
          <p className={raidStyles.checks} data-state={a.automated_state}>
            {a.automated_state === 'passed'
              ? 'Checks passed'
              : `Automated checks: ${displayState(a.automated_state)}`}
          </p>
          {a.feedback?.message && <p>{a.feedback.message}</p>}
          <p>
            Mentor:{' '}
            {a.review
              ? a.review.decision === 'approved'
                ? 'Approved'
                : 'Changes requested'
              : 'Review pending'}
          </p>
          {a.review && <p>{a.review.feedback}</p>}
          {a.status === 'owner_decision_required' && (
            <p>
              Access changed for a frozen team member. Completion is blocked for the owner to
              decide; nobody is automatically awarded or excluded.
            </p>
          )}
          {a.automated_state === 'passed' && !a.outcome_id && (
            <p className={raidStyles.muted}>
              Automated PASS does not complete this Raid. The assigned mentor must approve this
              exact revision.
            </p>
          )}
          {a.status === 'attention_required' && (
            <p>Infrastructure or cancellation is separate from learner failure.</p>
          )}
          {a.outcome_id && (
            <p>
              The same shared completion is recorded for all three frozen members. Each member’s
              next steps follow their own prerequisites.
            </p>
          )}
          <details className={raidStyles.acceptedFile}>
            <summary>Accepted file and team</summary>
            <p>
              {a.filename} · uploaded by {a.uploader}
            </p>
            <p className={raidStyles.muted}>
              Frozen members: {a.members.map((m) => m.displayName).join(', ')}
            </p>
            <p className={raidStyles.muted}>SHA-256</p>
            <code className={raidStyles.digest}>{a.artifact_digest}</code>
            <time dateTime={a.created_at}>{formatMoment(a.created_at)}</time>
          </details>
          {canReview && !paused && a.automated_state === 'passed' && (
            <a
              className={raidStyles.outlineButton}
              href={'/api/raids/artifact?attempt=' + encodeURIComponent(a.id)}
            >
              Download the accepted source file <HairlineIcon name="arrow" />
            </a>
          )}
          {canReview &&
            a.automated_state === 'passed' &&
            a.status === 'awaiting_review' &&
            !a.review && (
              <RaidReview
                attempt={a}
                onReviewed={onReviewed}
                paused={paused}
                onAccessRemoved={onAccessRemoved}
              />
            )}
        </li>
      ))}
    </ol>
  );
}
function RaidReview({
  attempt,
  onReviewed,
  paused = false,
  onAccessRemoved,
}: {
  attempt: RaidAttemptView;
  onReviewed?: (() => void) | undefined;
  paused?: boolean;
  onAccessRemoved?: (() => void) | undefined;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const pending = useRef(false);
  const intents = useRef<SubmissionIntents | null>(null);
  if (!intents.current) intents.current = new SubmissionIntents(() => sessionStorage);
  return (
    <form
      className={raidStyles.reviewForm}
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current || paused) return;
        const fields = new FormData(event.currentTarget);
        const decision =
          (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ??
          'changes_requested';
        if (decision !== 'approved' && decision !== 'changes_requested') return;
        const feedback = String(fields.get('feedback'));
        pending.current = true;
        setBusy(true);
        setMessage('Recording review…');
        try {
          const bytes = new TextEncoder().encode(decision + '\n' + feedback);
          const digest = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
            (b) => b.toString(16).padStart(2, '0'),
          ).join('');
          const key = `raid-review:${attempt.id}:${digest}`;
          const response = await fetch('/api/raids', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'review',
              attempt: attempt.id,
              requestId: intents.current!.requestId(key),
              decision,
              feedback,
            }),
          });
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              onAccessRemoved?.();
              return;
            }
            setMessage(
              response.status === 409
                ? 'Review conflicts with current access or revision. Refresh the team result before retrying.'
                : 'Review could not be confirmed. Retry the same decision to check its receipt.',
            );
            onReviewed?.();
            return;
          }
          const result = (await response.json()) as { review_id?: string; outcome_id?: string };
          const receiptMessage = raidReviewReceiptMessage(result, decision);
          if (!receiptMessage) throw new Error();
          intents.current!.confirm(key);
          setMessage(receiptMessage);
          onReviewed?.();
        } catch {
          setMessage(
            'Review could not be confirmed. Keep your feedback and retry the same decision.',
          );
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || paused}>
        <legend>Review this exact revision</legend>
        {paused && (
          <p role="alert">
            A fresh authorized read is required before recording a review. Your feedback stays in
            this form.
          </p>
        )}
        <p className={raidStyles.muted}>
          Confirm the accepted file digest and published brief before deciding. A new upload
          requires new checks and a fresh review.
        </p>
        <label>
          <span className={raidStyles.fieldLabel}>Feedback shared with all three members</span>
          <textarea
            name="feedback"
            required
            maxLength={2000}
            rows={4}
            aria-describedby={'review-message-' + attempt.id}
          />
        </label>
        <p className={raidStyles.muted}>
          This decision applies to this exact revision and its three frozen members.
        </p>
        <div className={raidStyles.reviewActions}>
          <button
            className={raidStyles.outlineButton}
            name="decision"
            value="changes_requested"
            type="submit"
          >
            {busy ? 'Recording…' : 'Request changes'} <HairlineIcon name="arrow" />
          </button>
          <button
            className={raidStyles.primaryButton}
            name="decision"
            value="approved"
            type="submit"
          >
            {busy ? 'Recording…' : 'Approve shared result'} <HairlineIcon name="arrow" />
          </button>
        </div>
      </fieldset>
      <p id={'review-message-' + attempt.id} role="status" className={raidStyles.feedback}>
        {message}
      </p>
    </form>
  );
}
