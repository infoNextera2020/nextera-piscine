'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  parseCheckpointView,
  checkpointScoredExamMetadata,
  checkpointScoredExamResult,
} from '@nextera/domain';
import {
  checkpointPresentation,
  type CheckpointPresentation,
} from '../learning/checkpoint-presentation';
import { StatusBadge } from '../../components/learning/primitives';
import { RecordDetails, WorkspaceEmpty } from '../../components/learning/workspace-parts';
import { HairlineIcon } from '../../components/learning/hairline-icon';
import { LearningSurface } from '../../components/learning/design-exploration';
import { CheckpointEditor } from './checkpoint-editor';
import e from './checkpoint-editor.module.css';
import { displayState, formatMoment } from '../learning/display';
import { checkpointResultHref } from '../learning/checkpoint-result-link';
import s from '../../components/learning/workspace.module.css';
export function Checkpoint({
  learnerId,
  cohort,
  node,
  initial,
  title = 'Checkpoint workspace',
}: {
  learnerId?: string | undefined;
  cohort: string;
  node: string;
  initial: CheckpointPresentation;
  title?: string;
}) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [readError, setReadError] = useState('');
  const [accessUnavailable, setAccessUnavailable] = useState(false);
  const [draftWarning, setDraftWarning] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const clock = useRef({ at: 0, remaining: 0 });
  const finishDialog = useRef<HTMLDialogElement>(null);
  const finishButton = useRef<HTMLButtonElement>(null);
  const startId = useRef('');
  const inFlight = useRef(false);
  const readRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(
    async (mode: 'replace' | 'if-idle' = 'replace') => {
      if (mode === 'if-idle' && readRequest.current) return;
      readRequest.current?.abort();
      const controller = new AbortController();
      readRequest.current = controller;
      let status: number | undefined;
      try {
        const response = await fetch(`/api/checkpoints?cohort=${cohort}&node=${node}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        status = response.status;
        if (!response.ok) throw new Error();
        const data = checkpointPresentation(parseCheckpointView(await response.json()));
        if (!controller.signal.aborted && readRequest.current === controller) {
          setView(data);
          setAccessUnavailable(false);
          setReadError('');
        }
      } catch {
        if (!controller.signal.aborted && readRequest.current === controller) {
          if (status === 401 || status === 403) setAccessUnavailable(true);
          setReadError(
            status === 401 || status === 403
              ? 'Checkpoint access could not be confirmed. Task details and history are hidden. Check your session or enrollment, then retry.'
              : 'Checkpoint could not be refreshed. Check your connection and access, then retry. Actions are paused until a fresh server read succeeds.',
          );
        }
      } finally {
        if (readRequest.current === controller) readRequest.current = null;
      }
    },
    [cohort, node],
  );
  useEffect(() => {
    clock.current = {
      at: performance.now(),
      remaining: Math.max(
        0,
        (Date.parse(view.attempt?.deadline_at ?? view.server_now) - Date.parse(view.server_now)) /
          1000,
      ),
    };
    const tick = () =>
      setSeconds(
        Math.max(
          0,
          Math.ceil(clock.current.remaining - (performance.now() - clock.current.at) / 1000),
        ),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [view]);
  useEffect(() => {
    const timer = !accessUnavailable
      ? setInterval(() => {
          if (document.visibilityState === 'visible') void refresh('if-idle');
        }, 3000)
      : undefined;
    const visible = () => {
      if (!accessUnavailable && document.visibilityState === 'visible') void refresh('if-idle');
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      readRequest.current?.abort();
      readRequest.current = null;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, accessUnavailable]);
  const removeEditorAccess = useCallback(() => {
    setAccessUnavailable(true);
    setReadError(
      'Checkpoint access could not be confirmed. Drafts and protected task details have been removed from this page.',
    );
  }, []);
  function closeFinish() {
    finishDialog.current?.close();
    finishButton.current?.focus();
  }
  async function mutate(action: 'start' | 'finish') {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      startId.current ||= crypto.randomUUID();
      const response = await fetch('/api/checkpoints', {
        method: 'POST',
        headers: {
          'x-action': action,
          'x-cohort-id': cohort,
          'x-node-key': node,
          'x-attempt-id': view.attempt?.id ?? '',
          'idempotency-key': startId.current,
        },
      });
      if (!response.ok) throw new Error();
      await response.json();
      if (action === 'start') startId.current = '';
      if (action === 'finish') closeFinish();
      setMessage(
        action === 'finish'
          ? checkpointScoredExamMetadata(view.scored_exam)
            ? 'Exam finished. Accepted answers continue evaluation; the final result remains provisional until mentor review.'
            : 'Finish accepted. Already accepted work continues evaluation.'
          : 'Checkpoint started.',
      );
      await refresh();
    } catch {
      setMessage(
        'This action could not be confirmed. Refresh the server state before trying again.',
      );
      await refresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (accessUnavailable)
    return (
      <LearningSurface page="checkpoint">
        <section className={e.screen} aria-label="Checkpoint access unavailable">
          <div className={e.alert} role="alert">
            <h2>Recheck checkpoint access</h2>
            <p>{readError}</p>
          </div>
          <div className={e.dialogActions}>
            <button className={e.button} onClick={() => void refresh()}>
              Retry checkpoint read
            </button>
            <Link className={e.button} href={'/app/cohorts/' + cohort}>
              Return to Journey
            </Link>
          </div>
        </section>
      </LearningSurface>
    );
  const scoredExam = checkpointScoredExamMetadata(view.scored_exam);
  const resultHref = `/app/cohorts/${cohort}/checkpoints/${node}/result`;
  const scoredResult = scoredExam ? checkpointScoredExamResult(view.scored_result) : null;
  const state =
    scoredExam && view.attempt
      ? scoredResult?.status === 'passed' || scoredResult?.status === 'failed'
        ? scoredResult.status
        : view.attempt.status === 'active'
          ? 'active'
          : 'evaluating'
      : (view.attempt?.status ?? (view.eligible ? 'available' : 'locked'));
  const expired = seconds === 0 || !view.display.intakeOpen;
  return (
    <LearningSurface page="checkpoint">
      <div className={e.screen}>
        <header className={e.header}>
          <div>
            <h1>{title}</h1>
            <StatusBadge state={state} />
            <p>
              {view.tasks.length
                ? `${view.tasks.length} questions · choose any question${scoredExam ? ' · 3 hours · one exam attempt' : ''}`
                : 'Questions appear after an authorized attempt starts.'}
            </p>
            {scoredExam && (
              <p>
                {scoredResult && ['passed', 'failed'].includes(scoredResult.status)
                  ? `Final result: ${scoredResult.total_points} / 100 · ${scoredResult.coding_points} / 75 coding`
                  : 'The final weighted result remains provisional until evaluation and required reviews are complete.'}
              </p>
            )}
          </div>
          <div className={e.headerActions}>
            {view.attempt && (
              <div className={e.timer} data-expired={expired}>
                <small>Time remaining</small>
                <output aria-label="Time remaining">
                  {seconds === null
                    ? 'Syncing…'
                    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
                </output>
                <time dateTime={view.attempt.deadline_at}>
                  {formatMoment(view.attempt.deadline_at)}
                </time>
              </div>
            )}
            {view.display.intakeOpen && (
              <button
                ref={finishButton}
                className={e.button}
                disabled={busy || !!readError || expired}
                onClick={() => finishDialog.current?.showModal()}
              >
                Review &amp; finish
              </button>
            )}
          </div>
        </header>
        {readError && (
          <div className={e.alert} role="alert">
            <p>{readError}</p>
            <button className={e.button} onClick={() => void refresh()}>
              Retry checkpoint read
            </button>
          </div>
        )}
        {(view.display.expiredAwaitingEvaluation ||
          (seconds === 0 && view.attempt?.status === 'active')) && (
          <div className={e.alert} role="status">
            Trusted deadline reached. Intake is closed; awaiting server finalization. Accepted
            pre-deadline work remains valid. No draft is automatically submitted.
          </div>
        )}
        {view.attempt?.status === 'evaluating' && (
          <div className={e.alert} role="status">
            Intake is closed. Accepted work is still evaluating, including work accepted before the
            deadline.
          </div>
        )}
        {(['passed', 'failed', 'infrastructure_blocked'].includes(state) ||
          (scoredExam && view.attempt && !view.display.intakeOpen)) && (
          <div className={e.dialogActions}>
            <Link className={e.button} href={resultHref}>
              View authoritative result
            </Link>
          </div>
        )}
        {view.tasks.length && view.attempt ? (
          <CheckpointEditor
            key={`${learnerId ?? ''}:${cohort}:${node}:${view.attempt.id}`}
            learnerId={learnerId}
            cohort={cohort}
            node={node}
            view={view}
            paused={busy || !!readError}
            expired={expired}
            onRefresh={refresh}
            onAccessRemoved={removeEditorAccess}
            onDraftWarning={setDraftWarning}
          />
        ) : (
          <section className={e.entry}>
            <HairlineIcon name="gate" size={72} />
            <h2>{view.eligible ? 'A focused test of transfer' : 'This checkpoint is locked'}</h2>
            <p>
              Questions become visible when a legitimate attempt starts. Access, the deadline,
              submission allowance and final results are controlled by the server.
            </p>
            {view.display.startAvailable && (
              <button
                className={e.primary}
                disabled={busy || !!readError}
                onClick={() => void mutate('start')}
              >
                {busy ? 'Starting…' : 'Start checkpoint'}
              </button>
            )}
          </section>
        )}
        {view.attempt && view.tasks.length > 0 && view.display.startAvailable && (
          <button
            className={e.primary}
            disabled={busy || !!readError}
            onClick={() => void mutate('start')}
          >
            {busy ? 'Starting…' : 'Start next checkpoint attempt'}
          </button>
        )}
        {!scoredExam && view.attempt?.retake_at && (
          <p className={e.notice}>
            Earliest policy retake time: {formatMoment(view.attempt.retake_at)}. Current access and
            server approval are required.
          </p>
        )}
        {!scoredExam && view.replacement_available && (
          <p className={e.notice}>
            An authorized replacement grant is recorded. Starting still requires current access.
          </p>
        )}
        <p className={e.feedback} role="status">
          {message}
        </p>
        <section className={e.attempts}>
          <h2>Attempt history</h2>
          {view.history.length ? (
            <ol className={s.history}>
              {view.history.map((h) => (
                <li key={h.id} className={s.record}>
                  <span>
                    {h.kind === 'normal' ? 'Standard' : 'Replacement'} attempt {h.normal_slot}
                    {!checkpointScoredExamMetadata(h.scored_exam) && h.points !== null
                      ? ` · ${h.points} points`
                      : ''}
                  </span>
                  <StatusBadge
                    state={
                      checkpointScoredExamMetadata(h.scored_exam)
                        ? checkpointScoredExamResult(h.scored_result)?.status === 'passed'
                          ? 'passed'
                          : checkpointScoredExamResult(h.scored_result)?.status === 'failed'
                            ? 'failed'
                            : h.status === 'active'
                              ? 'active'
                              : 'evaluating'
                        : h.status
                    }
                  />
                  {checkpointResultHref(cohort, node, h) && (
                    <Link
                      className={e.button}
                      href={checkpointResultHref(cohort, node, h)!}
                      aria-label={'View result for attempt ' + h.id}
                    >
                      View result
                    </Link>
                  )}
                  <RecordDetails>
                    <span className={s.muted}>Attempt ID</span>
                    <code className={s.identity}>{h.id}</code>
                  </RecordDetails>
                </li>
              ))}
            </ol>
          ) : (
            <WorkspaceEmpty title="No checkpoint attempts yet">
              Starting an authorized attempt creates its permanent record.
            </WorkspaceEmpty>
          )}
        </section>
        <dialog
          ref={finishDialog}
          className={e.dialog}
          aria-labelledby="finish-title"
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            );
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          onClose={() => finishButton.current?.focus()}
        >
          <h2 id="finish-title">Finish checkpoint now?</h2>
          <p>
            {scoredExam
              ? 'New submissions stop immediately. Finishing does not submit drafts. Already accepted answers continue evaluation and later mentor review; you do not need to wait for a mentor to finish this exam.'
              : 'This is irreversible. New submissions stop immediately. Unanswered tasks contribute zero. Already accepted work continues to authoritative finalization.'}
          </p>
          {draftWarning && (
            <p role="alert">
              There are unsubmitted drafts or unconfirmed submissions. Finishing does not submit
              drafts. Review official history before continuing.
            </p>
          )}
          <ul>
            {view.tasks.map((t, i) => (
              <li key={t.key}>
                {i + 1}. {t.title} — {displayState(view.display.tasks[i]?.state ?? 'closed')}
              </li>
            ))}
          </ul>
          <div className={e.dialogActions}>
            <button autoFocus className={e.button} onClick={closeFinish}>
              Keep working
            </button>
            <button
              className={e.primary}
              disabled={busy || !!readError || expired}
              onClick={() => void mutate('finish')}
            >
              {busy ? 'Finishing…' : 'Confirm finish'}
            </button>
          </div>
        </dialog>
      </div>
    </LearningSurface>
  );
}
