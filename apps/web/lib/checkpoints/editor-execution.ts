import {
  captureSource,
  editorActionBlock,
  sameEditorScope,
  type EditorScope,
  type EditorWindow,
  type SourceSnapshot,
} from './editor-contract';
import type { QuestionDraft } from './editor-drafts';

export type VisibleRun =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'pending'; snapshot: SourceSnapshot; maxOutputBytes: number }>
  | Readonly<{ kind: 'uncertain'; snapshot: SourceSnapshot; maxOutputBytes: number }>
  | Readonly<{
      kind: 'complete';
      snapshot: SourceSnapshot;
      state:
        | 'completed'
        | 'compile_error'
        | 'runtime_error'
        | 'timeout'
        | 'output_limit'
        | 'system_error';
      output: string;
    }>
  | Readonly<{ kind: 'unavailable'; snapshot: SourceSnapshot }>;

export function beginVisibleRun(
  run: VisibleRun,
  draft: QuestionDraft,
  window: EditorWindow,
  requestId: string,
  filename: string,
) {
  const blocked = editorActionBlock(draft.scope, window, 'run');
  if (blocked) return { run, blocked } as const;
  if (run.kind !== 'idle' && !sameEditorScope(run.snapshot.scope, draft.scope))
    return { run, blocked: 'scope_mismatch' } as const;
  if (run.kind === 'pending') return { run, blocked: 'run_pending' } as const;
  if (run.kind === 'uncertain')
    return { run: { ...run, kind: 'pending' } as VisibleRun, request: run.snapshot } as const;
  if (run.kind !== 'idle' && requestId === run.snapshot.requestId)
    return { run, blocked: 'new_intent_required' } as const;
  const limits = window.capabilities.visibleRun!.limits;
  const snapshot = captureSource(
    draft.scope,
    draft.source,
    requestId,
    filename,
    limits.sourceBytes,
  );
  return {
    run: Object.freeze({
      kind: 'pending',
      snapshot,
      maxOutputBytes: limits.outputBytes,
    }) as VisibleRun,
    request: snapshot,
  } as const;
}

export function completeVisibleRun(
  run: VisibleRun,
  response: {
    scope: EditorScope;
    requestId: string;
    state:
      'completed' | 'compile_error' | 'runtime_error' | 'timeout' | 'output_limit' | 'system_error';
    output: string;
  },
): VisibleRun {
  if (
    (run.kind !== 'pending' && run.kind !== 'uncertain') ||
    response.requestId !== run.snapshot.requestId ||
    !sameEditorScope(response.scope, run.snapshot.scope)
  )
    return run;
  if (
    ![
      'completed',
      'compile_error',
      'runtime_error',
      'timeout',
      'output_limit',
      'system_error',
    ].includes(response.state) ||
    typeof response.output !== 'string' ||
    new TextEncoder().encode(response.output).byteLength > run.maxOutputBytes
  )
    return Object.freeze({ kind: 'unavailable', snapshot: run.snapshot });
  return Object.freeze({
    kind: 'complete',
    snapshot: run.snapshot,
    state: response.state,
    output: response.output,
  });
}

export function failVisibleRun(run: VisibleRun, requestId: string): VisibleRun {
  return run.kind === 'pending' && run.snapshot.requestId === requestId
    ? Object.freeze({ ...run, kind: 'uncertain' })
    : run;
}

export function visibleRunIsStale(run: VisibleRun, draft: QuestionDraft) {
  return (
    run.kind !== 'idle' &&
    (!sameEditorScope(run.snapshot.scope, draft.scope) || run.snapshot.source !== draft.source)
  );
}

/** The existing raw-byte endpoint may carry this snapshot only after server capabilities are confirmed. */
export function prepareOfficialSubmit(
  draft: QuestionDraft,
  window: EditorWindow,
  requestId: string,
  filename: string,
  maxBytes: number,
) {
  const blocked = editorActionBlock(draft.scope, window, 'submit');
  if (blocked) return { blocked } as const;
  return {
    snapshot: captureSource(draft.scope, draft.source, requestId, filename, maxBytes),
  } as const;
}

export type OfficialSubmit =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'pending' | 'uncertain'; snapshot: SourceSnapshot }>
  | Readonly<{ kind: 'accepted'; snapshot: SourceSnapshot; receiptId: string }>;

/** One unresolved official intent owns its exact bytes, even if the editor changes. */
export function beginOfficialSubmit(
  submission: OfficialSubmit,
  draft: QuestionDraft,
  window: EditorWindow,
  requestId: string,
  filename: string,
  maxBytes: number,
) {
  const blocked = editorActionBlock(draft.scope, window, 'submit');
  if (blocked) return { submission, blocked } as const;
  if (submission.kind !== 'idle' && !sameEditorScope(submission.snapshot.scope, draft.scope))
    return { submission, blocked: 'scope_mismatch' } as const;
  if (submission.kind === 'pending') return { submission, blocked: 'submit_pending' } as const;
  if (submission.kind === 'uncertain') {
    if (!sameEditorScope(submission.snapshot.scope, draft.scope))
      return { submission, blocked: 'scope_mismatch' } as const;
    return {
      submission: Object.freeze({
        kind: 'pending',
        snapshot: submission.snapshot,
      }) as OfficialSubmit,
      request: submission.snapshot,
    } as const;
  }
  if (submission.kind === 'accepted' && requestId === submission.snapshot.requestId)
    return { submission, blocked: 'new_intent_required' } as const;
  const snapshot = captureSource(draft.scope, draft.source, requestId, filename, maxBytes);
  return {
    submission: Object.freeze({ kind: 'pending', snapshot }) as OfficialSubmit,
    request: snapshot,
  } as const;
}

export function failOfficialSubmit(submission: OfficialSubmit, requestId: string): OfficialSubmit {
  return submission.kind === 'pending' && submission.snapshot.requestId === requestId
    ? Object.freeze({ kind: 'uncertain', snapshot: submission.snapshot })
    : submission;
}

export function acceptOfficialSubmit(
  submission: OfficialSubmit,
  response: {
    scope: EditorScope;
    requestId: string;
    receiptId: string;
  },
): OfficialSubmit {
  if (
    (submission.kind !== 'pending' && submission.kind !== 'uncertain') ||
    !sameEditorScope(submission.snapshot.scope, response.scope) ||
    response.requestId !== submission.snapshot.requestId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(response.receiptId)
  )
    return submission;
  // A receipt confirms acceptance only. It carries no grade, mastery, unlock or quota claim.
  return Object.freeze({
    kind: 'accepted',
    snapshot: submission.snapshot,
    receiptId: response.receiptId,
  });
}
