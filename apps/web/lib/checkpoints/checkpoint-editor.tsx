'use client';
import { useEffect, useRef, useState } from 'react';
import {
  checkpointAnswerFormat,
  checkpointScoredExamMetadata,
  checkpointScoredExamResult,
} from '@nextera/domain';
import {
  scoredCheckpointExecutionLabel,
  type CheckpointPresentation,
} from '../learning/checkpoint-presentation';
import { displayState, formatMoment } from '../learning/display';
import { SubmissionIntents } from '../submissions/retry-intent';
import { HairlineIcon } from '../../components/learning/hairline-icon';
import { Subject, SafeHistory, RecordDetails } from '../../components/learning/workspace-parts';
import {
  captureCheckpointSource,
  hasUnsubmittedDrafts,
  identifyCheckpointSource,
  isQuestionDraftDirty,
  questionDraft,
  sendCheckpointSource,
  type OfficialSnapshot,
  type QuestionDrafts,
} from './checkpoint-source';
import e from './checkpoint-editor.module.css';
import w from '../../components/learning/workspace.module.css';
import { useEditorSession } from './use-editor-session';
import type { QuestionSession } from './editor-session';
import { CheckpointAnswerInput } from './checkpoint-answer-input';
import { useCheckpointMixedAnswerSession } from './use-answer-session';
import { checkpointSourceTaskKey, hasMixedAnswerDrafts } from './checkpoint-answer';

function questionStatus(task: CheckpointPresentation['display']['tasks'][number] | undefined) {
  if (!task) return 'Closed';
  if ('stateLabel' in task && task.stateLabel) return task.stateLabel;
  if (task.state === 'available') return task.submitAvailable ? 'Open' : 'No slots available';
  if (task.state === 'system_error')
    return task.submitAvailable ? 'System retry' : 'Infrastructure issue';
  return displayState(task.state);
}

/** Scoped by authenticated identity and attempt. Recovery stays disabled without explicit policy. */
export function CheckpointEditor({
  learnerId,
  cohort,
  node,
  view,
  paused,
  expired,
  onRefresh,
  onAccessRemoved,
  onDraftWarning,
}: {
  learnerId?: string | undefined;
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
  const [acceptedSources, setAcceptedSources] = useState<Record<string, string>>({});
  const selectedTask = view.tasks.find((task) => task.key === selected) ?? view.tasks[0];
  const selectedFormat = selectedTask ? checkpointAnswerFormat(selectedTask.answer_format) : null;
  const scoredExam = checkpointScoredExamMetadata(view.scored_exam) !== null;
  const finalResult = scoredExam ? checkpointScoredExamResult(view.scored_result) : null;
  const finalOutcomeKnown = finalResult?.status === 'passed' || finalResult?.status === 'failed';
  const { session: answerSession, states: answerStates } = useCheckpointMixedAnswerSession({
    learnerId: learnerId ?? '',
    cohortId: cohort,
    attemptId: view.attempt?.id ?? '',
    selected:
      scoredExam && selectedTask && selectedFormat && selectedFormat.kind !== 'coding'
        ? { key: selectedTask.key, kind: selectedFormat.kind }
        : null,
    paused,
    closed: expired || !view.display.intakeOpen,
    serverNow: view.server_now,
    newSubmitAllowed:
      view.display.tasks.find((task) => task.key === selectedTask?.key)?.submitAvailable ?? false,
    deadline: view.attempt?.deadline_at ?? view.server_now,
    onAccessRemoved,
  });
  const answerState =
    selectedTask && selectedFormat && selectedFormat.kind !== 'coding'
      ? answerSession.state(selectedTask.key, selectedFormat.kind)
      : undefined;
  useEffect(() => {
    if (
      !selectedTask ||
      !answerState ||
      paused ||
      expired ||
      !view.display.intakeOpen ||
      answerState.phase !== 'ready' ||
      answerState.status !== 'unsaved' ||
      !hasMixedAnswerDrafts({ answer: answerState.answer })
    )
      return;
    const timer = setTimeout(() => {
      void answerSession.save(selectedTask.key);
    }, 500);
    return () => clearTimeout(timer);
  }, [answerSession, selectedTask, answerState, paused, expired, view.display.intakeOpen]);
  const { session, drafts: questionSessions } = useEditorSession({
    learnerId,
    cohortId: cohort,
    attemptId: view.attempt?.id ?? '',
    // Mixed responses must never load or autosave through the source-only transport.
    selected: checkpointSourceTaskKey(selectedTask),
    paused,
    expired,
    serverNow: view.server_now,
    deadline: view.attempt?.deadline_at ?? view.server_now,
    active: view.attempt?.status === 'active',
    onAccessRemoved,
  });
  const drafts: QuestionDrafts = Object.fromEntries(
    Object.entries(questionSessions).map(([key, value]) => [
      key,
      {
        source: value.source,
        acceptedSource: Object.hasOwn(acceptedSources, key) ? acceptedSources[key]! : null,
      },
    ]),
  );
  const [pending, setPending] = useState<Record<string, OfficialSnapshot>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const busy = useRef(false);
  const mounted = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ view, paused, expired, questionSessions });
  latest.current = { view, paused, expired, questionSessions };
  const intents = useRef<SubmissionIntents | null>(null);
  if (!intents.current) intents.current = new SubmissionIntents(() => sessionStorage);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const unsaved =
    hasUnsubmittedDrafts(drafts) ||
    Object.values(answerStates).some(
      (state) =>
        state.submitPending ||
        (hasMixedAnswerDrafts({ answer: state.answer }) &&
          JSON.stringify(state.answer) !== state.acceptedPayload),
    ) ||
    Object.keys(pending).length > 0;
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
  const format = checkpointAnswerFormat(item.answer_format);
  const mixed = format.kind === 'coding' ? null : (answerState?.answer ?? null);
  const submitAllowed =
    intake &&
    (format.kind === 'coding'
      ? !!taskState?.submitAvailable &&
        (!scoredExam ||
          (questionSessions[item.key]?.phase === 'ready' &&
            questionSessions[item.key]?.officialSubmit === true))
      : scoredExam &&
        answerState?.phase === 'ready' &&
        ((!!taskState?.submitAvailable && answerState.canSubmit) || answerState.submitPending));
  const ambiguous = Object.hasOwn(pending, item.key) ? pending[item.key] : undefined;
  async function submit(retry?: OfficialSnapshot) {
    if (
      busy.current ||
      !(
        submitAllowed ||
        (scoredExam && retry && intake && questionSessions[retry.taskKey]?.phase === 'ready')
      ) ||
      format.kind !== 'coding' ||
      !item ||
      !view.attempt
    )
      return;
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
        checkpointSourceTaskKey(
          current.view.tasks.find((task) => task.key === snapshot!.taskKey),
        ) !== snapshot.taskKey ||
        (scoredExam && current.questionSessions[snapshot.taskKey]?.phase !== 'ready') ||
        (!(scoredExam && retry) &&
          (!current.view.display.tasks.find((t) => t.key === snapshot!.taskKey)?.submitAvailable ||
            (scoredExam && current.questionSessions[snapshot.taskKey]?.officialSubmit !== true)))
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
        setAcceptedSources((old) => ({ ...old, [snapshot!.taskKey]: snapshot!.source }));
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
            const taskFormat = checkpointAnswerFormat(t.answer_format);
            const dirty =
              taskFormat.kind === 'coding'
                ? isQuestionDraftDirty(local)
                : (() => {
                    const state = answerSession.state(t.key, taskFormat.kind);
                    return (
                      state.submitPending ||
                      (hasMixedAnswerDrafts({ answer: state.answer }) &&
                        JSON.stringify(state.answer) !== state.acceptedPayload)
                    );
                  })();
            return (
              <button
                key={t.key}
                className={e.question}
                aria-pressed={t.key === item.key}
                aria-label={`Question ${i + 1}: ${t.title}. ${label}${dirty ? '. Unsaved draft' : ''}`}
                onClick={() => setSelected(t.key)}
              >
                <span className={e.number}>{String(i + 1).padStart(2, '0')}</span>
                <span className={e.questionInfo}>
                  <strong>{t.title}</strong>
                  <small>
                    {label}
                    {dirty ? ' · Draft' : ''}
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
        <div className={e.statementCopy}>
          <Subject>{item.subject}</Subject>
        </div>
        <div className={e.requirements}>
          <span className={e.eyebrow}>Submission requirements</span>
          <p>
            {format.kind === 'trace_with_reason' ? (
              'Exact output and brief reason'
            ) : (
              <code>{item.rules.required_files.join(', ')}</code>
            )}{' '}
            · {item.rules.max_size_kb} KiB{' '}
            {format.kind === 'coding' ? 'maximum' : 'response maximum'}
          </p>
          {format.kind === 'debug_with_reason' && (
            <p>
              Include the corrected function, explanation, and counterexample with its expected
              result.
            </p>
          )}
          <p>
            {scoredExam ? (
              'Question resubmissions are separate from finishing the exam. The server controls intake and rate limits.'
            ) : (
              <>
                {item.reserved} submission slots used or pending. The server controls the remaining
                allowance.
              </>
            )}
          </p>
        </div>
      </section>
      <section
        id="checkpoint-editor"
        className={e.editorColumn}
        data-visible={panel === 'editor'}
        aria-label={format.kind === 'coding' ? 'Internal code editor' : 'Internal answer editor'}
      >
        {mixed ? (
          <>
            <CheckpointAnswerInput
              key={item.key + ':' + format.kind}
              taskKey={item.key}
              title={item.title}
              filename={item.rules.required_files[0]}
              answer={mixed}
              maxBytes={Math.min(262144, item.rules.max_size_kb * 1024)}
              readOnly={expired || !view.display.intakeOpen}
              onChange={(answer) => answerSession.edit(item.key, answer)}
            />
            <div
              className={e.saveStatus}
              data-phase={answerState?.phase ?? 'idle'}
              data-status={answerState?.status ?? 'unsaved'}
            >
              <span className={e.eyebrow}>Draft status</span>
              <strong role="status">
                {answerState?.phase === 'loading'
                  ? 'Checking autosave…'
                  : answerState?.phase !== 'ready'
                    ? 'Mixed-answer saving unavailable'
                    : (
                        {
                          unsaved: 'Not saved to server',
                          saving: 'Saving…',
                          saved: 'Saved to server',
                          failed: 'Save failed',
                          conflict: 'Choose a draft version',
                          closed: 'Autosave closed',
                        } as const
                      )[answerState.status]}
              </strong>
              <p id="checkpoint-mixed-status">
                {!scoredExam
                  ? 'This answer stays on this page only. The server does not support saving or official submission for this answer type. Leaving or refreshing can lose it. No answer has been saved or submitted from this page.'
                  : answerState?.phase === 'ready'
                    ? 'Saving keeps an answer draft. Only Submit this question sends an immutable answer for evaluation. Device recovery is unavailable without an explicit policy.'
                    : 'This answer stays on this page until server saving is confirmed. Leaving or refreshing can lose it. No draft is automatically submitted.'}
              </p>
              <button
                className={e.button}
                disabled={
                  !scoredExam ||
                  !intake ||
                  answerState?.status === 'saving' ||
                  answerState?.status === 'saved' ||
                  answerState?.status === 'conflict'
                }
                onClick={() =>
                  void (answerState?.phase === 'ready'
                    ? answerSession.save(item.key)
                    : answerSession.load(item.key, mixed.kind))
                }
              >
                {!scoredExam
                  ? 'Save draft'
                  : answerState?.phase !== 'ready'
                    ? 'Recheck autosave'
                    : answerState.status === 'failed'
                      ? 'Retry same save'
                      : 'Save draft'}
              </button>
              {answerState?.conflict && (
                <div
                  className={e.draftConflict}
                  role="group"
                  aria-label="Resolve answer draft conflict"
                >
                  <p>A newer server answer exists. Your answer has not been overwritten.</p>
                  <details open>
                    <summary>Server draft</summary>
                    <pre tabIndex={0}>{JSON.stringify(answerState.conflict, null, 2)}</pre>
                  </details>
                  <p>Your current answer remains in the form.</p>
                  <div className={e.dialogActions}>
                    <button
                      className={e.button}
                      disabled={!intake}
                      onClick={() => answerSession.resolve(item.key, 'keep_local')}
                    >
                      Keep my draft and save
                    </button>
                    <button
                      className={e.button}
                      disabled={!intake}
                      onClick={() => answerSession.resolve(item.key, 'use_server')}
                    >
                      Use server draft
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
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
                readOnly={expired || !view.display.intakeOpen}
                onChange={(event) => session.edit(item.key, event.target.value)}
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
            <DraftSyncStatus
              state={questionSessions[item.key]}
              paused={paused || expired}
              canLoad={!!learnerId}
              onRetry={() =>
                void (questionSessions[item.key]?.phase === 'unavailable'
                  ? session.load(item.key, true)
                  : session.save(item.key))
              }
              onConflict={(choice) => session.resolve(item.key, choice)}
              onRecovery={(choice) => session.chooseRecovery(item.key, choice)}
            />
          </>
        )}
        <div className={e.editorActions}>
          <button className={e.button} disabled aria-describedby="checkpoint-run-status">
            Run <HairlineIcon name="arrow" />
          </button>
          {mixed ? (
            <button
              className={e.primary}
              disabled={!submitAllowed || answerState?.submitting}
              onClick={() => void answerSession.submit(item.key).then(onRefresh)}
            >
              {answerState?.submitting
                ? 'Submitting…'
                : answerState?.submitPending
                  ? 'Retry original snapshot'
                  : 'Submit this question'}
              <HairlineIcon name="arrow" />
            </button>
          ) : ambiguous ? (
            <button
              className={e.primary}
              disabled={
                !(
                  submitAllowed ||
                  (scoredExam && intake && questionSessions[ambiguous.taskKey]?.phase === 'ready')
                ) || sending !== null
              }
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
        {!submitAllowed && format.kind === 'coding' && (
          <p className={e.notice}>
            {scoredExam
              ? 'Official intake is paused, closed or currently unavailable. Refresh confirms current server access and allowance.'
              : 'Official intake is paused, closed, passed, or has no available slot. Refresh confirms current server access and allowance.'}
          </p>
        )}
        <p className={e.feedback} role="status">
          {(Object.hasOwn(feedback, item.key) ? feedback[item.key] : undefined) ??
            (mixed
              ? !scoredExam
                ? 'Official submission is unavailable for this answer type. Editing does not submit your work.'
                : answerState?.message ||
                  'Editing and saving do not submit this answer. Submit this question sends one immutable snapshot.'
              : 'Submit evaluates a fixed snapshot. Editing does not submit your work.')}
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
          <strong>
            {format.kind === 'trace_with_reason' ? 'Run not applicable' : 'Run unavailable'}
          </strong>
          <p>
            {format.kind === 'trace_with_reason'
              ? 'Trace the published program without changing or running it here. No Run has been started.'
              : 'The visible-example execution service is not enabled. No Run has been started. Run is separate from official grading and submission allowance.'}
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
        {scoredExam && view.submissions.some((h) => h.task_key === item.key) ? (
          <ol className={w.history}>
            {view.submissions
              .filter((h) => h.task_key === item.key)
              .map((h) => (
                <li key={h.id} className={w.record} data-execution-state={h.state}>
                  <div className={w.recordHead}>
                    <strong>Submission</strong>
                    <span className={e.state}>
                      {scoredCheckpointExecutionLabel(h.state, finalOutcomeKnown)}
                    </span>
                  </div>
                  <p>
                    {finalOutcomeKnown
                      ? 'This is recorded execution feedback, not an individual rubric grade. The authoritative finalized exam outcome is shown above.'
                      : 'This is execution feedback, not the final question grade. Reasoning and published method criteria are reviewed later; you can keep working and finish the exam without waiting.'}
                  </p>
                  <RecordDetails>
                    <span className={w.muted}>Submission ID</span>
                    <code className={w.identity}>{h.id}</code>
                  </RecordDetails>
                  <time dateTime={h.created_at}>{formatMoment(h.created_at)}</time>
                </li>
              ))}
          </ol>
        ) : (
          <SafeHistory items={view.submissions.filter((h) => h.task_key === item.key)} />
        )}
      </section>
    </div>
  );
}

function DraftSyncStatus({
  state,
  paused,
  canLoad,
  onRetry,
  onConflict,
  onRecovery,
}: {
  state?: QuestionSession | undefined;
  paused: boolean;
  canLoad: boolean;
  onRetry(): void;
  onConflict(choice: 'keep_local' | 'use_server'): void;
  onRecovery(choice: 'use_device' | 'keep_current'): void;
}) {
  const phase = state?.phase ?? 'idle',
    status = state?.status ?? 'unsaved';
  const label =
    phase === 'loading'
      ? 'Checking autosave…'
      : phase !== 'ready'
        ? 'Autosave unavailable'
        : (
            {
              unsaved: 'Not saved to server',
              saving: 'Saving…',
              saved: 'Saved to server',
              failed: 'Save failed',
              conflict: 'Choose a draft version',
              closed: 'Autosave closed',
            } as const
          )[status];
  return (
    <div
      id="checkpoint-save-status"
      className={e.saveStatus}
      data-phase={phase}
      data-status={status}
    >
      <span className={e.eyebrow}>Draft status</span>
      <strong role="status" aria-live="polite">
        {label}
      </strong>
      <p>
        {phase !== 'ready'
          ? 'Server saving could not be confirmed. Drafts stay in this page only; leaving or refreshing can lose them. Saving is separate from official Submit.'
          : status === 'saved'
            ? 'This draft is saved. It has not been submitted for grading.'
            : status === 'failed'
              ? 'Save receipt is unconfirmed. Retry uses the exact original write before later edits.'
              : status === 'closed'
                ? 'Saving and resync are closed. No draft is automatically submitted.'
                : 'Each question keeps a separate draft. Submit evaluates an immutable snapshot.'}
      </p>
      {state?.recovery ? (
        <p>A device draft is awaiting your choice. No recovered text has been sent.</p>
      ) : state?.localStatus === 'stored' ? (
        <p>
          Temporary recovery is stored on this device until its configured expiry, at most the exam
          deadline.
        </p>
      ) : (
        <p>
          {state?.localStatus === 'failed'
            ? 'Device recovery could not be stored.'
            : 'Device recovery is unavailable without a configured retention policy.'}
        </p>
      )}
      {(phase === 'unavailable' || status === 'failed') && canLoad && (
        <button className={e.button} disabled={paused} onClick={onRetry}>
          {phase === 'unavailable' ? 'Recheck autosave' : 'Retry same save'}
        </button>
      )}
      {state?.conflict && (
        <div className={e.draftConflict} role="group" aria-label="Resolve draft conflict">
          <p>A newer server draft exists. Nothing has been overwritten.</p>
          <details open>
            <summary>Server draft</summary>
            <pre tabIndex={0}>{state.conflict.source}</pre>
          </details>
          <p>Your current draft remains in the editor.</p>
          <div className={e.dialogActions}>
            <button className={e.button} disabled={paused} onClick={() => onConflict('keep_local')}>
              Keep my draft and save
            </button>
            <button className={e.button} disabled={paused} onClick={() => onConflict('use_server')}>
              Use server draft
            </button>
          </div>
        </div>
      )}
      {state?.recovery && (
        <div className={e.draftConflict} role="group" aria-label="Review device recovery">
          <p>
            {state.recovery.conflict
              ? 'The device draft and server version differ. Choose explicitly before syncing.'
              : 'An unexpired draft is available on this device. Review it before replacing the editor.'}
          </p>
          <details open>
            <summary>Device draft</summary>
            <pre tabIndex={0}>{state.recovery.source}</pre>
          </details>
          <details>
            <summary>Server draft</summary>
            <pre tabIndex={0}>{state.recovery.remote}</pre>
          </details>
          <div className={e.dialogActions}>
            <button className={e.button} disabled={paused} onClick={() => onRecovery('use_device')}>
              Use device draft
            </button>
            <button
              className={e.button}
              disabled={paused}
              onClick={() => onRecovery('keep_current')}
            >
              Keep current editor draft
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
