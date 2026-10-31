'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ExamManualMarks } from '@nextera/domain';
import type { MentorReviewIdentity, MentorReviewSnapshot } from './scored-exam-review-contract';
import { createBrowserScoredExamMentorReviewClient } from './scored-exam-review-client';
import type { ScoredExamMentorReviewClient } from './scored-exam-review-client';
import styles from './staff.module.css';
import formStyles from '../../lib/raids/raid.module.css';

export function StaffExamReviewDetail({
  identity,
  submissionId,
}: {
  identity: MentorReviewIdentity;
  submissionId?: string;
}) {
  const [, changed] = useState(0),
    [selected, setSelected] = useState(submissionId ?? '');
  const key = JSON.stringify([identity.authUserId, identity.actorUserId, identity.attemptId]);
  const latest = useRef(key);
  latest.current = key;
  const [session, setSession] = useState<{
    key: string;
    client: ScoredExamMentorReviewClient;
  } | null>(null);
  useEffect(() => {
    // Each effect setup owns a fresh client; development effect replay cannot reuse a disposed instance.
    let active = true;
    const client = createBrowserScoredExamMentorReviewClient(
      identity,
      () => {
        if (active && latest.current === key) changed((n) => n + 1);
      },
      () => {
        if (active && latest.current === key) changed((n) => n + 1);
      },
    );
    setSession({ key, client });
    void client.load();
    const hide = () => client.hidePrivateContent();
    const show = () => {
      void client.load();
    };
    const back = () => {
      client.hidePrivateContent();
      const id = new URL(window.location.href).searchParams.get('submission');
      setSelected(id ?? '');
      void client.load();
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    window.addEventListener('popstate', back);
    return () => {
      active = false;
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      window.removeEventListener('popstate', back);
      client.dispose();
    };
  }, [identity, key]);
  const client = session?.key === key ? session.client : null;
  const state = client?.getSnapshot(),
    snapshot = state?.snapshot;
  const persisted = client?.getCurrentPersistedOutcome();
  const accepted =
    snapshot?.context.acceptances.find((a) => a.submissionId === selected) ??
    snapshot?.context.acceptances.at(-1);
  const pending = client?.getPendingCommand();
  const select = (id: string) => {
    if (pending) return;
    setSelected(id);
    const url = new URL(window.location.href);
    url.searchParams.set('submission', id);
    window.history.replaceState(null, '', url);
  };
  return (
    <section className={styles.detail} aria-label="Exam review">
      <a className={styles.backLink} href="/operator">
        Back to reviews
      </a>
      <header className={styles.detailHeading}>
        <div>
          <span className={styles.eyebrow}>Assigned exam review</span>
          <h1>01coding · Exam 1</h1>
          <p>
            {snapshot?.manualReview?.learner.displayName ??
              'Learner identity awaiting native confirmation'}
          </p>
          <p>Student number: unavailable in the current source record.</p>
        </div>
        <button
          className={styles.outlineButton}
          type="button"
          onClick={() => void client?.load()}
          disabled={!client || state?.phase === 'loading' || state?.write.kind === 'sending'}
        >
          Refresh review
        </button>
      </header>
      <p className={styles.note} role="status" aria-live="polite">
        {state?.message ||
          (!snapshot
            ? 'Checking the exact assigned attempt…'
            : state?.fresh
              ? 'Current native history verified.'
              : 'Refresh before recording a review.')}
      </p>
      {snapshot && client && (
        <>
          <p className={styles.alert}>
            {snapshot.score.intake.status === 'open'
              ? 'Review opens after official intake closes.'
              : persisted
                ? `Persisted result: ${persisted.verdict}.`
                : 'Automated execution and score remain provisional until official outcome application.'}
          </p>
          <div className={formStyles.controls}>
            <label htmlFor="exam-question">Question</label>
            <select
              id="exam-question"
              value={accepted?.questionKey ?? ''}
              disabled={!!pending}
              onChange={(e) => {
                const a = snapshot.context.acceptances
                  .filter((a) => a.questionKey === e.target.value)
                  .at(-1);
                if (a) select(a.submissionId);
              }}
            >
              <option value="" disabled>
                Select a submitted question
              </option>
              {snapshot.context.rubric.questions.map((q) => (
                <option
                  key={q.questionKey}
                  value={q.questionKey}
                  disabled={
                    !snapshot.context.acceptances.some((a) => a.questionKey === q.questionKey)
                  }
                >
                  {q.questionKey.toUpperCase()}
                </option>
              ))}
            </select>
            <label htmlFor="exam-submission">Immutable submission snapshot</label>
            <select
              id="exam-submission"
              value={accepted?.submissionId ?? ''}
              disabled={!!pending}
              onChange={(e) => select(e.target.value)}
            >
              {snapshot.context.acceptances
                .filter((a) => a.questionKey === accepted?.questionKey)
                .map((a) => (
                  <option key={a.submissionId} value={a.submissionId}>
                    Acceptance {a.acceptedOrdinal} · {a.submissionId}
                  </option>
                ))}
            </select>
          </div>
          {!accepted ? (
            <p className={styles.unavailable}>
              No official question submission exists for this attempt.
            </p>
          ) : (
            <StaffExamReviewSelection
              key={accepted.submissionId}
              client={client}
              snapshot={snapshot}
              submissionId={accepted.submissionId}
            />
          )}
        </>
      )}
    </section>
  );
}
export function StaffExamReviewSelection({
  client,
  snapshot,
  submissionId,
}: {
  client: ScoredExamMentorReviewClient;
  snapshot: MentorReviewSnapshot;
  submissionId: string;
}) {
  const [notes, setNotes] = useState(''),
    [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const s = client.getSnapshot(),
    h = snapshot.histories.find((h) => h.submissionId === submissionId)!,
    a = s.answers[submissionId];
  const manual = snapshot.manualReview,
    review =
      snapshot.context.actorUserId === snapshot.context.assignment.primaryMentorId
        ? 'primary'
        : 'secondary';
  const primary = h.events.filter((e) => e.eventKind === 'primary').at(-1);
  const fields =
    h.answerKind === 'coding'
      ? ([['contract', 2]] as const)
      : h.answerKind === 'trace_with_reason'
        ? ([['reason', 2]] as const)
        : ([
            ['counterexample', 4],
            ['explanation', 2],
          ] as const);
  const pending = client?.getPendingCommand();
  const canRead =
    snapshot.score.intake.status !== 'open' &&
    (h.answerKind === 'coding'
      ? snapshot.answerReadAvailable
      : snapshot.structuredAnswerReadAvailable);
  const blocked =
    !s.fresh ||
    !a ||
    !manual?.canRecordNew ||
    !snapshot.reviewWriteAvailable ||
    (review === 'secondary' && !primary);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (blocked) {
      setError(
        'Verify a fresh answer, the approved criteria document and native recording policy before saving.',
      );
      return;
    }
    const entries = fields.map(([k, max]) => [k, values[k], max] as const);
    if (
      entries.some(
        ([, v, max]) => v === undefined || v === '' || !/^\d+$/.test(v) || Number(v) > max,
      )
    ) {
      setError('Enter an integer within every published mark range.');
      return;
    }
    const marks = Object.fromEntries(entries.map(([k, v]) => [k, Number(v)])) as ExamManualMarks;
    client.editReview(submissionId, {
      review,
      evidenceDigest: '0'.repeat(64),
      marks,
      ...(review === 'secondary' ? { primaryEventId: primary!.eventId } : {}),
    });
    await client.record(submissionId, notes === '' ? null : notes);
  }
  return (
    <div className={styles.reviewBody}>
      <ol>
        <li>
          <div>
            <h2>{h.questionKey.toUpperCase()}</h2>
            <span className={styles.queueState}>Revision {h.revision}</span>
          </div>
          <p>
            Answer SHA-256: <code>{h.answerSha256}</code>
          </p>
          {!a ? (
            <div className={styles.unavailable}>
              <p>
                {canRead
                  ? 'Read the exact accepted answer before assessing it.'
                  : 'Official answer reading is unavailable until closure and native authority are confirmed.'}
              </p>
              <button
                type="button"
                className={styles.outlineButton}
                disabled={!canRead || s.answerLoading !== null}
                onClick={() => void client.readAnswer(submissionId)}
              >
                {s.answerLoading === submissionId ? 'Verifying answer…' : 'Read accepted answer'}
              </button>
            </div>
          ) : (
            <details className={styles.disclosure} open>
              <summary>Immutable accepted answer</summary>
              {a.kind === 'coding' ? (
                <>
                  <p>{a.filename}</p>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{a.source}</pre>
                </>
              ) : (
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {JSON.stringify(a.answer, null, 2)}
                </pre>
              )}
            </details>
          )}
          <details className={styles.disclosure}>
            <summary>Approved manual criteria</summary>
            {manual?.criteria ? (
              <>
                <p>
                  Verified whole document · SHA-256 <code>{manual.criteria.sha256}</code>
                </p>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {manual.criteria.text}
                </pre>
              </>
            ) : (
              <p>
                Criteria unavailable: {manual?.reason ?? 'native_evidence_reader_unavailable'}. New
                recording is paused.
              </p>
            )}
          </details>
          <details className={styles.disclosure}>
            <summary>Automated provisional evidence</summary>
            {h.events.filter((e) => e.eventKind === 'functional').length === 0 ? (
              <p>No automated execution evidence has been recorded.</p>
            ) : (
              h.events
                .filter((e) => e.eventKind === 'functional')
                .map((e) => (
                  <div key={e.eventId}>
                    <p>Revision {e.revision} · provisional execution evidence</p>
                    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  </div>
                ))
            )}
          </details>
          <details className={styles.disclosure}>
            <summary>Recorded manual assessments</summary>
            {h.events.filter((e) => e.eventKind !== 'functional').length === 0 ? (
              <p>No manual assessment is recorded.</p>
            ) : (
              h.events
                .filter((e) => e.eventKind !== 'functional')
                .map((e) => {
                  const record = manual?.records.find((r) => r.eventId === e.eventId);
                  return (
                    <div key={e.eventId}>
                      <p>
                        {e.eventKind} · revision {e.revision} · actor <code>{e.actorUserId}</code>
                      </p>
                      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {JSON.stringify(e.payload, null, 2)}
                      </pre>
                      {record ? (
                        <>
                          <p>
                            Durable assessment reference: <code>{record.digest}</code>
                          </p>
                          <p>Original source role: {record.sourceRole}</p>
                          <p>
                            Notes:{' '}
                            {record.document.notes === null
                              ? 'No notes were stored.'
                              : String(record.document.notes)}
                          </p>
                        </>
                      ) : (
                        <p>
                          This event has a digest-only V1 reference. Saved notes are not available.
                        </p>
                      )}
                    </div>
                  );
                })
            )}
          </details>
          <form className={formStyles.controls} onSubmit={(e) => void save(e)}>
            <fieldset disabled={s.write.kind === 'sending' || !!pending}>
              <legend>
                {review === 'primary' ? 'Primary assessment' : 'Independent secondary assessment'}
              </legend>
              <p>
                Recording opens after intake closure. Marks and optional notes are kept with the
                immutable answer and rubric.
              </p>
              {fields.map(([name, max]) => (
                <label key={name} htmlFor={`mark-${name}`}>
                  {name} · 0–{max}
                  <input
                    id={`mark-${name}`}
                    name={name}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={max}
                    step={1}
                    required
                    value={values[name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                  />
                </label>
              ))}
              <label htmlFor="review-notes">
                Notes (optional)
                <textarea
                  id="review-notes"
                  name="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  aria-describedby="notes-format"
                />
              </label>
              <p id="notes-format">
                Notes preserve exact UTF-8 text. NUL characters and invalid Unicode are rejected.
                Empty notes store no note.
              </p>
              {error && <p role="alert">{error}</p>}
              {blocked && (
                <p>
                  {manual?.reason ?? 'Native evidence reader unavailable.'} Read the answer and
                  refresh before saving.
                </p>
              )}
              <button className={styles.outlineButton} type="submit">
                {s.write.kind === 'sending' ? 'Recording…' : 'Record assessment'}
              </button>
            </fieldset>
            {s.write.kind === 'recorded' && s.write.receipt.evidenceReference && (
              <p role="status">
                Assessment stored with evidence reference{' '}
                <code>{s.write.receipt.evidenceReference.digest}</code>.{' '}
                {s.write.receipt.evidenceReference.notesStored
                  ? 'Notes stored.'
                  : 'No notes stored.'}
              </p>
            )}
            {s.write.kind === 'uncertain' && (
              <>
                <p>
                  The outcome is unknown. Refresh, then retry the original operation and document.
                </p>
                <button
                  type="button"
                  className={styles.outlineButton}
                  disabled={!s.fresh}
                  onClick={() => void client.record(submissionId)}
                >
                  Retry original assessment
                </button>
              </>
            )}
            {['conflict', 'rejected'].includes(s.write.kind) && (
              <>
                <p>Inspect the current native history before making a new decision.</p>
                <button
                  type="button"
                  className={styles.outlineButton}
                  disabled={!s.fresh}
                  onClick={() => client.acknowledgeFreshHistory()}
                >
                  I reviewed the refreshed history
                </button>
              </>
            )}
          </form>
        </li>
      </ol>
    </div>
  );
}
