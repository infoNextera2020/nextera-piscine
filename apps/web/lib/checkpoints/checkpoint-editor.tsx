'use client';
import { useEffect, useRef, useState } from 'react';
import type { CheckpointPresentation } from '../learning/checkpoint-presentation';
import { displayState } from '../learning/display';
import { SubmissionIntents } from '../submissions/retry-intent';
import { HairlineIcon } from '../../components/learning/hairline-icon';
import { Subject, SafeHistory } from '../../components/learning/workspace-parts';
import {
  acceptQuestion,
  captureCheckpointSource,
  editQuestion,
  hasUnsubmittedDrafts,
  identifyCheckpointSource,
  isQuestionDraftDirty,
  questionDraft,
  sendCheckpointSource,
  type OfficialSnapshot,
  type QuestionDrafts,
} from './checkpoint-source';
import e from './checkpoint-editor.module.css';

function questionStatus(task: CheckpointPresentation['display']['tasks'][number] | undefined) {
  if (!task) return 'Closed';
  if (task.state === 'available') return task.submitAvailable ? 'Open' : 'No slots available';
  if (task.state === 'system_error')
    return task.submitAvailable ? 'System retry' : 'Infrastructure issue';
  return displayState(task.state);
}

/** Scoped by the parent's attempt key. No source is written to browser storage. */
export function CheckpointEditor({
  cohort,
  node,
  view,
  paused,
  expired,
  onRefresh,
  onAccessRemoved,
  onDraftWarning,
}: {
  cohort: string;
  node: string;
  view: CheckpointPresentation;
  paused: boolean;
  expired: boolean;
  onRefresh(): Promise<void>;
  onAccessRemoved(): void;
  onDraftWarning(value: boolean): void;
}) {
  const [selected, setSelected] = useState(view.tasks[0]?.key ?? '');
  const [panel, setPanel] = useState<'statement' | 'editor' | 'history'>('editor');
  const [drafts, setDrafts] = useState<QuestionDrafts>({});
  const [pending, setPending] = useState<Record<string, OfficialSnapshot>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const busy = useRef(false);
  const mounted = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ view, paused, expired });
  latest.current = { view, paused, expired };
  const intents = useRef<SubmissionIntents | null>(null);
  if (!intents.current) intents.current = new SubmissionIntents(() => sessionStorage);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const unsaved = hasUnsubmittedDrafts(drafts) || Object.keys(pending).length > 0;
  useEffect(() => {
    onDraftWarning(unsaved);
    const warn = (event: BeforeUnloadEvent) => {
      if (unsaved) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      onDraftWarning(false);
    };
  }, [unsaved, onDraftWarning]);
  const index = Math.max(
    0,
    view.tasks.findIndex((t) => t.key === selected),
  );
  const item = view.tasks[index];
  if (!item || !view.attempt) return null;
  const taskState = view.display.tasks[index];
  const draft = questionDraft(drafts, item.key);
  const intake = !paused && !expired && view.display.intakeOpen;
  const submitAllowed = intake && !!taskState?.submitAvailable;
  const ambiguous = Object.hasOwn(pending, item.key) ? pending[item.key] : undefined;
  async function submit(retry?: OfficialSnapshot) {
    if (busy.current || !submitAllowed || !item || !view.attempt) return;
    busy.current = true;
    setSending(item.key);
    setFeedback((old) => ({ ...old, [item.key]: 'Preparing an immutable submission…' }));
    let snapshot = retry;
    try {
      snapshot ??= await identifyCheckpointSource(
        captureCheckpointSource({
          cohort,
          node,
          attemptId: view.attempt.id,
          taskKey: item.key,
          source: draft.source,
          rules: item.rules,
        }),
        intents.current!,
      );
      if (!mounted.current) return;
      setPending((old) => ({ ...old, [snapshot!.taskKey]: snapshot! }));
      const current = latest.current;
      if (
        current.paused ||
        current.expired ||
        !current.view.display.intakeOpen ||
        current.view.attempt?.id !== snapshot.attemptId ||
        !current.view.display.tasks.find((t) => t.key === snapshot!.taskKey)?.submitAvailable
      ) {
        setFeedback((old) => ({
          ...old,
          [snapshot!.taskKey]:
            'Intake changed while preparing source. Nothing was sent. Recheck server state before retrying this snapshot.',
        }));
        return;
      }
      setFeedback((old) => ({ ...old, [snapshot!.taskKey]: 'Submitting this source snapshot…' }));
      const outcome = await sendCheckpointSource(snapshot);
      if (!mounted.current) return;
      if (outcome.kind === 'access_removed') {
        onAccessRemoved();
        return;
      }
      if (outcome.kind === 'accepted') {
        intents.current!.confirm(snapshot.intent);
        setPending((old) => {
          const next = { ...old };
          delete next[snapshot!.taskKey];
          return next;
        });
        setDrafts((old) => acceptQuestion(old, snapshot!));
        setFeedback((old) => ({
          ...old,
          [snapshot!.taskKey]:
            'Submission accepted. Awaiting trusted evaluation. Later edits remain a separate draft.',
        }));
      } else {
        setFeedback((old) => ({
          ...old,
          [snapshot!.taskKey]:
            'Receipt not confirmed. Check official history before retrying the exact original snapshot. Later edits will not be sent by Retry.',
        }));
      }
      await onRefresh();
    } catch {
      if (mounted.current)
        setFeedback((old) => ({
          ...old,
          [item.key]: snapshot
            ? 'Submission could not be confirmed. Keep the original snapshot for an exact retry.'
            : 'Enter valid source within the published single-file size limit before submitting.',
        }));
      if (!snapshot) textarea.current?.focus();
    } finally {
      busy.current = false;
      if (mounted.current) setSending(null);
    }
  }
  return (
    <div className={e.workspace}>
      <nav className={e.questions} aria-label="Checkpoint questions">
        <span className={e.eyebrow}>Questions · {view.tasks.length}</span>
        <div className={e.questionList}>
          {view.tasks.map((t, i) => {
            const label = questionStatus(view.display.tasks[i]);
            const local = questionDraft(drafts, t.key);
            return (
              <button
                key={t.key}
                className={e.question}
                aria-pressed={t.key === item.key}
                aria-label={`Question ${i + 1}: ${t.title}. ${label}${isQuestionDraftDirty(local) ? '. Unsaved draft' : ''}`}
                onClick={() => setSelected(t.key)}
              >
                <span className={e.number}>{String(i + 1).padStart(2, '0')}</span>
                <span className={e.questionInfo}>
                  <strong>{t.title}</strong>
                  <small>
                    {label}
                    {isQuestionDraftDirty(local) ? ' · Draft' : ''}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
        <p className={e.railHelp}>
          Choose any question. Each draft stays separate while this page is open.
        </p>
      </nav>
      <div className={e.selectedHeading}>
        <span className={e.eyebrow}>Question {String(index + 1).padStart(2, '0')}</span>
        <h2>{item.title}</h2>
        <span>{questionStatus(taskState)}</span>
      </div>
      <div className={e.mobileTabs} aria-label="Question panels">
        {(['statement', 'editor', 'history'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={panel === value}
            aria-controls={`checkpoint-${value}`}
            onClick={() => setPanel(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <section
        id="checkpoint-statement"
        className={e.statement}
        data-visible={panel === 'statement'}
        aria-label="Selected checkpoint question"
      >
        <span className={e.eyebrow}>Question {String(index + 1).padStart(2, '0')}</span>
        <h2>{item.title}</h2>
        <span className={e.state}>{questionStatus(taskState)}</span>
        <Subject>{item.subject}</Subject>
        <div className={e.requirements}>
          <span className={e.eyebrow}>Submission requirements</span>
          <p>
            <code>{item.rules.required_files.join(', ')}</code> · {item.rules.max_size_kb} KiB
            maximum
          </p>
          <p>
            {item.reserved} submission slots used or pending. The server controls the remaining
            allowance.
          </p>
        </div>
      </section>
      <section
        id="checkpoint-editor"
        className={e.editorColumn}
        data-visible={panel === 'editor'}
        aria-label="Internal code editor"
      >
        <div className={e.editorFrame}>
          <div className={e.editorHeader}>
            <HairlineIcon name="code" size={28} />
            <label htmlFor="checkpoint-code">
              {item.rules.required_files[0] ?? 'Question source'}
            </label>
            <span>Go</span>
          </div>
          <textarea
            ref={textarea}
            id="checkpoint-code"
            key={item.key}
            className={e.code}
            value={draft.source}
            aria-label={`Source code for ${item.title}`}
            aria-describedby="checkpoint-save-status checkpoint-code-help"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            wrap="off"
            readOnly={!intake}
            onChange={(event) =>
              setDrafts((old) => editQuestion(old, item.key, event.target.value))
            }
          />
          <div id="checkpoint-code-help" className={e.editorFooter}>
            <span>Plain code editor</span>
            <span>
              {draft.source === draft.acceptedSource
                ? 'Submitted snapshot unchanged'
                : 'Draft / not submitted'}
            </span>
          </div>
        </div>
        <div id="checkpoint-save-status" className={e.saveStatus}>
          <span className={e.eyebrow}>Draft status</span>
          <strong>Not saved to server</strong>
          <p>
            Autosave and reload recovery are unavailable. Drafts stay in this page only; leaving or
            refreshing can lose them.
          </p>
        </div>
        <div className={e.editorActions}>
          <button className={e.button} disabled aria-describedby="checkpoint-run-status">
            Run <HairlineIcon name="arrow" />
          </button>
          {ambiguous ? (
            <button
              className={e.primary}
              disabled={!submitAllowed || sending !== null}
              onClick={() => void submit(ambiguous)}
            >
              {sending === item.key ? 'Submitting…' : 'Retry original snapshot'}
              <HairlineIcon name="arrow" />
            </button>
          ) : (
            <button
              className={e.primary}
              disabled={!submitAllowed || sending !== null || !draft.source}
              onClick={() => void submit()}
            >
              {sending === item.key ? 'Submitting…' : 'Submit this question'}
              <HairlineIcon name="arrow" />
            </button>
          )}
        </div>
        {!submitAllowed && (
          <p className={e.notice}>
            Official intake is paused, closed, passed, or has no available slot. Refresh confirms
            current server access and allowance.
          </p>
        )}
        <p className={e.feedback} role="status">
          {(Object.hasOwn(feedback, item.key) ? feedback[item.key] : undefined) ??
            'Submit evaluates a fixed snapshot. Editing does not submit your work.'}
        </p>
        {ambiguous && (
          <details className={e.snapshot}>
            <summary>Original snapshot awaiting confirmation</summary>
            <pre tabIndex={0}>{ambiguous.source}</pre>
            <p>
              Request <code>{ambiguous.requestId}</code>
            </p>
          </details>
        )}
        <div id="checkpoint-run-status" className={e.runOutput}>
          <span className={e.eyebrow}>Run output</span>
          <strong>Run unavailable</strong>
          <p>
            The visible-example execution service is not enabled. No Run has been started. Run is
            separate from official grading and submission allowance.
          </p>
        </div>
      </section>
      <section
        id="checkpoint-history"
        className={e.officialHistory}
        data-visible={panel === 'history'}
        aria-label="Official submission history"
      >
        <h2>Official submission history</h2>
        <SafeHistory items={view.submissions.filter((h) => h.task_key === item.key)} />
      </section>
    </div>
  );
}
