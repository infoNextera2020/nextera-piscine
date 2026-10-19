'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckpointView } from '@nextera/db/checkpoints';
export function Checkpoint({
  cohort,
  node,
  initial,
}: {
  cohort: string;
  node: string;
  initial: CheckpointView;
}) {
  const [view, setView] = useState(initial);
  const [task, setTask] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [seconds, setSeconds] = useState(0);
  const clock = useRef({ at: 0, remaining: 0 });
  const source = useRef<HTMLInputElement>(null);
  const uploadId = useRef('');
  const startId = useRef('');
  const refresh = useCallback(async () => {
    const r = await fetch(`/api/checkpoints?cohort=${cohort}&node=${node}`, { cache: 'no-store' });
    if (r.ok) setView((await r.json()) as CheckpointView);
  }, [cohort, node]);
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
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [view]);
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function mutate(action: string) {
    if (
      action === 'finish' &&
      !window.confirm(
        'Finish checkpoint? This is irreversible. Unanswered tasks receive no credit.',
      )
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      startId.current ||= crypto.randomUUID();
      const r = await fetch('/api/checkpoints', {
        method: 'POST',
        headers: {
          'x-action': action,
          'x-cohort-id': cohort,
          'x-node-key': node,
          'x-attempt-id': view.attempt?.id ?? '',
          'idempotency-key': startId.current,
        },
      });
      if (!r.ok) throw new Error('This action is currently unavailable.');
      await r.json();
      if (action === 'start') startId.current = '';
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to complete request.');
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    const file = source.current?.files?.[0];
    const item = view.tasks[task];
    if (!file || !item || !view.attempt) return;
    setBusy(true);
    setMessage('');
    try {
      uploadId.current ||= crypto.randomUUID();
      const r = await fetch('/api/checkpoints/submissions', {
        method: 'POST',
        headers: {
          'x-attempt-id': view.attempt.id,
          'x-task-key': item.key,
          'x-filename': file.name,
          'idempotency-key': uploadId.current,
        },
        body: file,
      });
      if (!r.ok) throw new Error('Submission unavailable. Check access, time and task allowance.');
      await r.json();
      uploadId.current = '';
      if (source.current) source.current.value = '';
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Submission unavailable.');
    } finally {
      setBusy(false);
    }
  }
  const active = view.attempt?.status === 'active';
  const item = view.tasks[task];
  const history = item ? view.submissions.filter((s) => s.task_key === item.key) : [];
  const reserved = item?.reserved ?? 0;
  const passed = item?.passed ?? false;
  const canStart =
    !view.attempt ||
    (view.attempt.status === 'failed' &&
      view.attempt.normal_slot === 1 &&
      !!view.attempt.retake_at &&
      Date.parse(view.attempt.retake_at) <= Date.parse(view.server_now)) ||
    view.replacement_available;
  return (
    <section className="space-y-4">
      <p>90 minutes · four tasks · pass any three · up to three learner outcomes per task.</p>
      {view.attempt && (
        <>
          <p>
            Checkpoint status: <strong>{view.attempt.status}</strong>
          </p>
          <p>
            Time remaining (display):{' '}
            <output aria-label="Time remaining">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </output>
          </p>
          <p>
            Deadline: <time>{view.attempt.deadline_at}</time>
          </p>
        </>
      )}
      {view.eligible && canStart && (
        <button disabled={busy} onClick={() => void mutate('start')}>
          {view.attempt ? 'Start next checkpoint attempt' : 'Start checkpoint'}
        </button>
      )}
      {view.attempt?.retake_at && (
        <p>Retake opens at {view.attempt.retake_at}. Current access is required.</p>
      )}
      {active && (
        <button disabled={busy} onClick={() => void mutate('finish')}>
          Finish checkpoint
        </button>
      )}
      {!!view.tasks.length && (
        <nav aria-label="Checkpoint tasks">
          {view.tasks.map((t, i) => (
            <button
              key={t.key}
              aria-pressed={task === i}
              onClick={() => {
                setTask(i);
                uploadId.current = '';
                if (source.current) source.current.value = '';
              }}
            >
              {i + 1}. {t.title}
            </button>
          ))}
        </nav>
      )}
      {item && (
        <article>
          <h2>{item.title}</h2>
          <p className="whitespace-pre-wrap">{item.subject}</p>
          <p>{passed ? 'Task passed' : `${reserved} of 3 submission slots used or pending`}</p>
          {active && seconds > 0 && !passed && reserved < 3 && (
            <>
              <label>
                Solution file ({item.rules.required_files[0]})
                <input
                  ref={source}
                  type="file"
                  accept=".go"
                  onChange={() => {
                    uploadId.current = '';
                  }}
                />
              </label>
              <button disabled={busy} onClick={() => void submit()}>
                Submit checkpoint task
              </button>
            </>
          )}
          <ul>
            {history.map((s) => (
              <li key={s.id}>
                {s.state}
                {s.feedback?.message ? ` — ${s.feedback.message}` : ''}
              </li>
            ))}
          </ul>
        </article>
      )}
      {message && <p role="alert">{message}</p>}
      <h2>Attempt history</h2>
      <ul>
        {view.history.map((h) => (
          <li key={h.id}>
            {h.kind} attempt {h.normal_slot}: {h.status}
            {h.points !== null ? ` · ${h.points}/4` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}
