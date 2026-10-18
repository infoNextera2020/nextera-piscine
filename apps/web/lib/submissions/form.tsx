'use client';
import { useEffect, useState } from 'react';
import type { SubmissionSummary } from '@nextera/db/submissions';

export function SubmissionForm({
  cohort,
  node,
  filename,
}: {
  cohort: string;
  node: string;
  filename: string;
}) {
  const [history, setHistory] = useState<SubmissionSummary[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const response = await fetch(`/api/submissions/history?cohort=${cohort}&node=${node}`, {
        cache: 'no-store',
      });
      if (response.ok && !disposed) setHistory((await response.json()) as SubmissionSummary[]);
    };
    void refresh().catch(() => {});
    const timer = setInterval(() => void refresh().catch(() => {}), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [cohort, node]);
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Submit a local solution</h2>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage('');
          const file = new FormData(event.currentTarget).get('source');
          try {
            if (
              !(file instanceof File) ||
              file.size < 1 ||
              file.size > 262144 ||
              file.name !== filename
            )
              throw new Error();
            // Persist the request identity across reloads and transport retries for this exact file.
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
            setMessage('Submission accepted.');
            const result = await fetch(`/api/submissions/history?cohort=${cohort}&node=${node}`, {
              cache: 'no-store',
            });
            if (result.ok) setHistory((await result.json()) as SubmissionSummary[]);
          } catch {
            setMessage('Submission could not be accepted. Check the required file and try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block">
          Solution file ({filename})
          <input className="block py-2" type="file" name="source" required accept=".go" />
        </label>
        <button
          className="rounded bg-teal-300 px-4 py-2 text-slate-950 disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          Submit solution
        </button>
      </form>
      <p role="status">{message}</p>
      <h2 className="text-xl font-semibold">Attempt history</h2>
      <ul className="space-y-2">
        {history.map((item) => (
          <li key={item.id} className="rounded border border-slate-700 p-3">
            <p>{item.state.toUpperCase()}</p>
            <p>{item.feedback?.message}</p>
            <time>{item.created_at}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}
