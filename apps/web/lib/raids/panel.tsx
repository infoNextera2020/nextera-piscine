'use client';
import raidStyles from './raid.module.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RaidAttemptView, RaidView, SubmissionRules } from '@nextera/domain';
import { SubmissionForm } from '../submissions/form';
import { SubmissionIntents } from '../submissions/retry-intent';
import { EditorHairline } from '../../components/learning/editor-hairline';
import { formatMoment, displayState } from '../learning/display';
import s from '../../components/learning/challenge.module.css';

export const raidLabels: Record<RaidAttemptView['status'], string> = {
  awaiting_checks: 'Automated checks pending',
  attention_required: 'Evaluation needs attention',
  changes_required: 'Changes required',
  awaiting_review: 'Awaiting mentor review',
  owner_decision_required: 'Owner decision required',
  completed: 'Team completed',
  superseded: 'Previous revision',
};
export function RaidPanel({
  cohort,
  node,
  team,
  initial,
  rules,
}: {
  cohort: string;
  node: string;
  team?: string | undefined;
  initial: RaidView;
  rules: SubmissionRules;
}) {
  const [view, setView] = useState<RaidView | null>(initial),
    [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(
        `/api/raids?cohort=${cohort}&node=${node}${team ? '&team=' + team : ''}`,
        { cache: 'no-store', signal: controller.signal },
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setView(null);
        throw new Error();
      }
      const next = (await response.json()) as RaidView;
      if (!Array.isArray(next.attempts)) throw new Error();
      if (!controller.signal.aborted) {
        setView(next);
        setError('');
      }
    } catch {
      if (!controller.signal.aborted)
        setError(
          'Raid access or results could not be confirmed. Refresh before taking another action.',
        );
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [cohort, node, team]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 5000);
    return () => {
      clearInterval(timer);
      request.current?.abort();
      request.current = null;
    };
  }, [refresh]);
  return (
    <aside className={s.tools + ' ' + raidStyles.controls} aria-label="Team Raid">
      <section className={s.editorCard}>
        <div>
          <h2>Work with your team</h2>
          <p>Use your own editor. One file is evaluated for the frozen team of three.</p>
        </div>
        <EditorHairline />
      </section>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <section className={s.uploadCard}>
        {!view ? (
          <>
            <h2>Access must be confirmed</h2>
            <p>Team records and submission controls are hidden.</p>
          </>
        ) : (
          <>
            <h2>{view.team?.name ?? 'Team assignment pending'}</h2>
            {view.team ? (
              <>
                <ul>
                  {view.team.members.map((member) => (
                    <li key={member.id}>{member.displayName}</li>
                  ))}
                </ul>
                <p className={s.muted}>Assigned mentor: {view.team.mentor}</p>
              </>
            ) : (
              <p>Your owner must assign a team of exactly three before a shared upload.</p>
            )}
            {view.can_submit && !error ? (
              <SubmissionForm
                cohort={cohort}
                node={node}
                filename={rules.required_files[0]!}
                maxSizeKb={rules.max_size_kb}
                onAccepted={() => void refresh()}
              />
            ) : (
              <p className={s.muted}>
                Upload is unavailable under the current team, access or evaluation configuration.
              </p>
            )}
          </>
        )}
      </section>
      <section className={s.historyCard} aria-labelledby="raid-history-heading">
        <div className={s.historyHeading}>
          <h2 id="raid-history-heading">Shared team history</h2>
          <button type="button" className={s.textButton} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {view && (
          <RaidHistory
            attempts={view.attempts}
            canReview={view.can_review && !error}
            onReviewed={() => void refresh()}
          />
        )}
      </section>
    </aside>
  );
}
export function RaidHistory({
  attempts,
  canReview = false,
  onReviewed,
}: {
  attempts: RaidAttemptView[];
  canReview?: boolean;
  onReviewed?: (() => void) | undefined;
}) {
  if (!attempts.length)
    return (
      <p className={s.muted}>
        No shared upload yet. Automated checks and mentor feedback will appear here.
      </p>
    );
  return (
    <ol className={s.history}>
      {attempts.map((a) => (
        <li key={a.id}>
          <div className={s.recordHeading}>
            <strong>Revision {a.ordinal}</strong>
            <span className={s.verdict}>{raidLabels[a.status]}</span>
          </div>
          <p>Automated checks: {displayState(a.automated_state)}</p>
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
            <p className={s.muted}>
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
          <details>
            <summary>Accepted file and team</summary>
            <p>
              {a.filename} · uploaded by {a.uploader}
            </p>
            <p className={s.muted}>
              Frozen members: {a.members.map((m) => m.displayName).join(', ')}
            </p>
            <p className={s.muted}>SHA-256</p>
            <code style={{ display: 'block', overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
              {a.artifact_digest}
            </code>
            <time dateTime={a.created_at}>{formatMoment(a.created_at)}</time>
          </details>
          {canReview && a.automated_state === 'passed' && (
            <a href={'/api/raids/artifact?attempt=' + a.id}>Download the accepted source file</a>
          )}
          {canReview && a.status === 'awaiting_review' && !a.review && (
            <RaidReview attempt={a} onReviewed={onReviewed} />
          )}
        </li>
      ))}
    </ol>
  );
}
function RaidReview({
  attempt,
  onReviewed,
}: {
  attempt: RaidAttemptView;
  onReviewed?: (() => void) | undefined;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const pending = useRef(false);
  const intents = useRef<SubmissionIntents | null>(null);
  if (!intents.current) intents.current = new SubmissionIntents(() => sessionStorage);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        const fields = new FormData(event.currentTarget);
        const decision = String(fields.get('decision'));
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
            setMessage(
              response.status === 409
                ? 'Review conflicts with current access or revision. Refresh the team result before retrying.'
                : 'Review could not be confirmed. Retry the same decision to check its receipt.',
            );
            onReviewed?.();
            return;
          }
          const result = (await response.json()) as { review_id?: string; outcome_id?: string };
          if (!result.review_id) throw new Error();
          intents.current!.confirm(key);
          setMessage(
            result.outcome_id
              ? 'Shared completion recorded.'
              : 'Changes requested for this revision.',
          );
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
      <fieldset disabled={busy}>
        <legend>Review this exact revision</legend>
        <p className={s.muted}>
          Confirm the accepted file digest and published brief before deciding. A new upload
          requires new checks and a fresh review.
        </p>
        <label>
          <span className={s.fieldLabel}>Decision</span>
          <select name="decision" required defaultValue="changes_requested">
            <option value="changes_requested">Request changes</option>
            <option value="approved">Approve exact revision</option>
          </select>
        </label>
        <label>
          <span className={s.fieldLabel}>Feedback shared with all three members</span>
          <textarea
            name="feedback"
            required
            maxLength={2000}
            rows={4}
            aria-describedby={'review-message-' + attempt.id}
          />
        </label>
        <button className={s.submitButton} type="submit">
          {busy ? 'Recording…' : 'Record review'}
        </button>
      </fieldset>
      <p id={'review-message-' + attempt.id} role="status" className={s.feedback}>
        {message}
      </p>
    </form>
  );
}
