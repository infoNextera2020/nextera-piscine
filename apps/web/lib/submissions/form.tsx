'use client';
import { useRef, useState } from 'react';
import s from '../../components/learning/workspace.module.css';
export function SubmissionForm({
  cohort,
  node,
  filename,
  maxSizeKb = 256,
  onAccepted,
}: {
  cohort: string;
  node: string;
  filename: string;
  maxSizeKb?: number;
  onAccepted?: () => void;
}) {
  const [phase, setPhase] = useState<'ready' | 'uploading' | 'accepted' | 'error'>('ready');
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  return (
    <section aria-label="Submission">
      <h2>Submission</h2>
      <p className={s.muted}>
        Write your solution locally. Accepted work enters trusted evaluation.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          const file = input.current?.files?.[0];
          if (!file || file.size < 1 || file.size > maxSizeKb * 1024 || file.name !== filename) {
            setPhase('error');
            setMessage(`Choose ${filename}, between 1 byte and ${maxSizeKb} KiB.`);
            input.current?.focus();
            return;
          }
          pending.current = true;
          setPhase('uploading');
          setMessage('Uploading solution…');
          try {
            const bytes = await file.arrayBuffer();
            const digest = Array.from(
              new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
              (b) => b.toString(16).padStart(2, '0'),
            ).join('');
            const key = `submission:${cohort}:${node}:${file.name}:${digest}`;
            const requestId = sessionStorage.getItem(key) ?? crypto.randomUUID();
            sessionStorage.setItem(key, requestId);
            const response = await fetch('/api/submissions', {
              method: 'POST',
              body: file,
              headers: {
                'x-cohort-id': cohort,
                'x-node-key': node,
                'x-filename': file.name,
                'idempotency-key': requestId,
              },
            });
            if (!response.ok) throw new Error();
            const receipt = (await response.json()) as { id?: unknown };
            if (typeof receipt.id !== 'string') throw new Error();
            setPhase('accepted');
            setMessage('Submission accepted. Evaluation is pending.');
            if (input.current) input.current.value = '';
            onAccepted?.();
          } catch {
            setPhase('error');
            setMessage(
              'Submission could not be confirmed. Check access and the required file, then retry.',
            );
          } finally {
            pending.current = false;
          }
        }}
      >
        <fieldset disabled={phase === 'uploading'} style={{ border: 0, padding: 0, minWidth: 0 }}>
          <div className={s.upload}>
            <label>
              Solution file ({filename})
              <input
                ref={input}
                type="file"
                name="source"
                required
                accept={filename.includes('.') ? '.' + filename.split('.').at(-1) : undefined}
                aria-describedby="submission-help submission-message"
                aria-invalid={phase === 'error' || undefined}
                onChange={() => {
                  setPhase('ready');
                  setMessage('');
                }}
              />
            </label>
            <p id="submission-help" className={s.muted}>
              Required filename · {maxSizeKb} KiB maximum
            </p>
          </div>
          <button className={s.button + ' ' + s.primary} type="submit">
            {phase === 'uploading' ? 'Uploading…' : 'Submit solution'}
          </button>
        </fieldset>
        <p
          id="submission-message"
          className={s.feedback}
          role={phase === 'error' ? 'alert' : 'status'}
        >
          {message}
        </p>
      </form>
    </section>
  );
}
