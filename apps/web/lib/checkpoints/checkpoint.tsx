'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CheckpointPresentation } from '../learning/checkpoint-presentation';
import { StatusBadge } from '../../components/learning/primitives';
import { SafeHistory, Subject, WorkspaceEmpty } from '../../components/learning/workspace-parts';
import { HairlineFigure } from '../../components/learning/hairline-figure';
import { formatMoment } from '../learning/display';
import s from '../../components/learning/workspace.module.css';
export function Checkpoint({
  cohort,
  node,
  initial,
}: {
  cohort: string;
  node: string;
  initial: CheckpointPresentation;
}) {
  const [view, setView] = useState(initial);
  const [task, setTask] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [readError, setReadError] = useState('');
  const [seconds, setSeconds] = useState<number | null>(null);
  const clock = useRef({ at: 0, remaining: 0 });
  const source = useRef<HTMLInputElement>(null);
  const finishDialog = useRef<HTMLDialogElement>(null);
  const finishButton = useRef<HTMLButtonElement>(null);
  const uploadId = useRef('');
  const startId = useRef('');
  const inFlight = useRef(false);
  const reading = useRef(false);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (reading.current) return;
      reading.current = true;
      try {
        const response = await fetch(`/api/checkpoints?cohort=${cohort}&node=${node}`, {
          cache: 'no-store',
          signal: signal ?? null,
        });
        if (!response.ok) throw new Error();
        const data = (await response.json()) as CheckpointPresentation;
        if (!signal?.aborted) {
          setView(data);
          setReadError('');
        }
      } catch {
        if (!signal?.aborted)
          setReadError(
            'Checkpoint could not be refreshed. Check your connection and access, then retry. Actions are paused until a fresh server read succeeds.',
          );
      } finally {
        reading.current = false;
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
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(controller.signal);
    }, 3000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh(controller.signal);
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
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
          ? 'Finish accepted. Already accepted work continues evaluation.'
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
  async function submit() {
    const file = source.current?.files?.[0];
    const item = view.tasks[task];
    if (inFlight.current || !item || !view.attempt) return;
    if (
      !file ||
      file.name !== item.rules.required_files[0] ||
      file.size < 1 ||
      file.size > item.rules.max_size_kb * 1024
    ) {
      setMessage('Choose the required solution file within the published size limit.');
      source.current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage('Uploading checkpoint task…');
    try {
      uploadId.current ||= crypto.randomUUID();
      const response = await fetch('/api/checkpoints/submissions', {
        method: 'POST',
        headers: {
          'x-attempt-id': view.attempt.id,
          'x-task-key': item.key,
          'x-filename': file.name,
          'idempotency-key': uploadId.current,
        },
        body: file,
      });
      if (!response.ok) throw new Error();
      await response.json();
      uploadId.current = '';
      if (source.current) source.current.value = '';
      setMessage('Submission accepted. Awaiting trusted evaluation.');
      await refresh();
    } catch {
      setMessage(
        'Submission could not be confirmed. Refresh and check access, trusted time and task allowance before retrying.',
      );
      await refresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const item = view.tasks[task];
  const taskDisplay = view.display.tasks[task];
  const resultHref = `/app/cohorts/${cohort}/checkpoints/${node}/result`;
  const state = view.attempt?.status ?? (view.eligible ? 'available' : 'locked');
  return (
    <div className={s.stack}>
      {readError && (
        <div className={s.notice} role="alert">
          <p>{readError}</p>
          <button className={s.button} onClick={() => void refresh()}>
            Retry checkpoint read
          </button>
        </div>
      )}
      <div className={s.notice} role="status">
        <div className={s.recordHead}>
          <span>
            Checkpoint status: <strong>{state}</strong>
          </span>
          <StatusBadge state={state} />
        </div>
        {view.display.expiredAwaitingEvaluation && (
          <p>
            Trusted deadline reached. Intake is closed; awaiting server finalization. Accepted
            pre-deadline work remains valid.
          </p>
        )}
        {view.attempt?.status === 'evaluating' && (
          <p>
            Intake is closed. Accepted work is still evaluating, including work accepted before the
            deadline.
          </p>
        )}
        {['passed', 'failed', 'infrastructure_blocked'].includes(state) && (
          <div className={s.actions}>
            <Link className={s.button} href={resultHref}>
              View authoritative result
            </Link>
          </div>
        )}
      </div>
      <div className={s.columns}>
        <div className={s.stack}>
          {!view.tasks.length ? (
            <section className={s.card}>
              <HairlineFigure kind="gate" state={state} />
              <WorkspaceEmpty
                title={view.eligible ? 'A focused test of transfer' : 'This gate is locked'}
              >
                Four checkpoint-specific tasks become visible when a legitimate attempt starts. The
                server controls access.
              </WorkspaceEmpty>
              {view.display.startAvailable && (
                <button
                  className={s.button + ' ' + s.primary}
                  disabled={busy || !!readError}
                  onClick={() => void mutate('start')}
                >
                  {busy ? 'Starting…' : 'Start checkpoint'}
                </button>
              )}
            </section>
          ) : (
            <>
              <section className={s.card}>
                <div className={s.sectionHead}>
                  <h2>Checkpoint tasks</h2>
                  <span className={s.muted}>Four tasks · unrestricted order</span>
                </div>
                <nav aria-label="Checkpoint tasks" className={s.taskList}>
                  {view.tasks.map((t, i) => (
                    <button
                      key={t.key}
                      className={s.task}
                      data-state={view.display.tasks[i]?.state}
                      aria-pressed={task === i}
                      onClick={() => {
                        setTask(i);
                        uploadId.current = '';
                        if (source.current) source.current.value = '';
                      }}
                    >
                      <span className={s.recordHead}>
                        <strong>
                          {i + 1}. {t.title}
                        </strong>
                        <StatusBadge
                          state={view.display.tasks[i]?.state ?? 'locked'}
                          label={
                            view.display.tasks[i]?.state === 'available'
                              ? 'Open'
                              : (view.display.tasks[i]?.state ?? 'Closed')
                          }
                        />
                      </span>
                      <small>{t.reserved} of 3 submission slots used or pending</small>
                      {view.display.tasks[i]?.state === 'system_error' && (
                        <small>System retry · no learner quota consumed by system_error</small>
                      )}
                    </button>
                  ))}
                </nav>
              </section>
              {item && (
                <section className={s.card} aria-label="Selected checkpoint task">
                  <h2>{item.title}</h2>
                  <Subject>{item.subject}</Subject>
                  <p className={s.notice} style={{ marginTop: 20 }}>
                    {item.passed
                      ? 'Task passed'
                      : `${item.reserved} of 3 submission slots used or pending`}
                  </p>
                  {taskDisplay?.submitAvailable && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                      }}
                    >
                      <fieldset
                        disabled={busy || !!readError}
                        style={{ border: 0, padding: 0, minWidth: 0 }}
                      >
                        <div className={s.upload}>
                          <label>
                            Solution file ({item.rules.required_files[0]})
                            <input
                              ref={source}
                              type="file"
                              required
                              accept={'.' + item.rules.required_files[0]?.split('.').at(-1)}
                              aria-describedby="checkpoint-file-help"
                              onChange={() => {
                                uploadId.current = '';
                              }}
                            />
                          </label>
                          <p id="checkpoint-file-help" className={s.muted}>
                            {item.rules.max_size_kb} KiB maximum · exact filename required
                          </p>
                        </div>
                        <button className={s.button + ' ' + s.primary} type="submit">
                          {busy ? 'Submitting…' : 'Submit checkpoint task'}
                        </button>
                      </fieldset>
                    </form>
                  )}
                  {!taskDisplay?.submitAvailable && (
                    <p className={s.muted}>
                      Task intake is closed or no submission slot is currently available. The server
                      controls the allowance.
                    </p>
                  )}
                  <h3 style={{ marginTop: 24, marginBottom: 12 }}>Safe task history</h3>
                  <SafeHistory items={view.submissions.filter((h) => h.task_key === item.key)} />
                </section>
              )}
            </>
          )}
        </div>
        <aside className={s.stack} aria-label="Checkpoint controls">
          {!!view.tasks.length && (
            <div className={s.card}>
              <HairlineFigure kind="gate" state={state} />
              <p className={s.muted}>Four tasks · one authoritative gate</p>
            </div>
          )}
          {view.attempt && (
            <div className={s.timer}>
              <small>DISPLAY-ONLY TIME LEFT</small>
              <output aria-label="Time remaining">
                {seconds === null
                  ? 'Syncing…'
                  : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
              </output>
              <small>Trusted deadline</small>
              <time dateTime={view.attempt.deadline_at}>
                {formatMoment(view.attempt.deadline_at)}
              </time>
              <p className={s.muted}>Countdown does not close intake or decide the outcome.</p>
            </div>
          )}
          <section className={s.card}>
            <h2>Checkpoint policy</h2>
            <ol className={s.policy}>
              <li>
                <strong>90 trusted minutes</strong>Refresh and reconnect never extend the deadline.
              </li>
              <li>
                <strong>Pass 3 of 4 tasks</strong>Up to 3 learner-result submissions per task.
              </li>
              <li>
                <strong>Infrastructure is separate</strong>system_error consumes no learner quota.
              </li>
              <li>
                <strong>Accepted work remains valid</strong>Pre-deadline submissions count even when
                evaluation finishes later.
              </li>
            </ol>
          </section>
          {view.display.intakeOpen && (
            <section className={s.card}>
              <h2>Finish early?</h2>
              <p className={s.muted}>
                Finishing is irreversible. New intake closes immediately. Unanswered tasks receive
                no credit; accepted work continues evaluation.
              </p>
              <div className={s.actions}>
                <button
                  ref={finishButton}
                  className={s.button + ' ' + s.danger}
                  disabled={busy || !!readError}
                  onClick={() => finishDialog.current?.showModal()}
                >
                  Finish checkpoint
                </button>
              </div>
            </section>
          )}
          {view.attempt && view.display.startAvailable && (
            <button
              className={s.button + ' ' + s.primary}
              disabled={busy || !!readError}
              onClick={() => void mutate('start')}
            >
              {busy ? 'Starting…' : 'Start next checkpoint attempt'}
            </button>
          )}
          {view.attempt?.retake_at && (
            <p className={s.notice}>
              Earliest policy retake time: {formatMoment(view.attempt.retake_at)}. Current access
              and server approval are required.
            </p>
          )}
          {view.replacement_available && (
            <p className={s.notice} data-tone="system">
              An authorized replacement grant is recorded. Starting still requires current access.
            </p>
          )}
        </aside>
      </div>
      <p className={s.feedback} role="status">
        {message}
      </p>
      <section className={s.card}>
        <h2>Attempt history</h2>
        {view.history.length ? (
          <ol className={s.history}>
            {view.history.map((h) => (
              <li key={h.id} className={s.record}>
                <span>
                  {h.kind} attempt {h.normal_slot}: {h.status}
                  {h.points !== null ? ` · ${h.points}/4` : ''}
                </span>
                <code className={s.identity}>{h.id}</code>
                <StatusBadge state={h.status} />
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
        className={s.dialog}
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
          This is irreversible. New submissions stop immediately. Unanswered tasks contribute zero.
          Already accepted work continues to authoritative finalization.
        </p>
        <div className={s.actions}>
          <button autoFocus className={s.button} onClick={closeFinish}>
            Keep working
          </button>
          <button
            className={s.button + ' ' + s.danger}
            disabled={busy || !!readError}
            onClick={() => void mutate('finish')}
          >
            {busy ? 'Finishing…' : 'Confirm finish'}
          </button>
        </div>
      </dialog>
    </div>
  );
}
