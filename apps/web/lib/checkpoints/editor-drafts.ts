import {
  editorActionBlock,
  sameEditorScope,
  type EditorScope,
  type EditorWindow,
} from './editor-contract';

export type SaveIntent = Readonly<{
  scope: EditorScope;
  requestId: string;
  source: string;
  revision: number;
  baseVersion: number;
}>;
type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving'; intent: SaveIntent }
  | { kind: 'failed'; intent: SaveIntent; reason: 'network' | 'unavailable' }
  | { kind: 'conflict'; intent: SaveIntent; remote: Readonly<{ source: string; version: number }> };
export type QuestionDraft = Readonly<{
  scope: EditorScope;
  source: string;
  revision: number;
  serverVersion: number;
  savedRevision: number | null;
  save: SaveState;
}>;

export function createQuestionDraft(
  scope: EditorScope,
  remote?: { source: string; version: number },
): QuestionDraft {
  if (remote && (!Number.isSafeInteger(remote.version) || remote.version < 0))
    throw new Error('DRAFT_VERSION');
  return {
    scope: Object.freeze({ ...scope }),
    source: remote?.source ?? '',
    revision: 0,
    serverVersion: remote?.version ?? 0,
    savedRevision: remote ? 0 : null,
    save: { kind: 'idle' },
  };
}

export function editQuestionDraft(draft: QuestionDraft, source: string): QuestionDraft {
  return source === draft.source ? draft : { ...draft, source, revision: draft.revision + 1 };
}

export function draftSaveStatus(draft: QuestionDraft) {
  return draft.save.kind !== 'idle'
    ? draft.save.kind
    : draft.savedRevision === draft.revision
      ? 'saved'
      : 'unsaved';
}

/** Failed/uncertain writes retry their original immutable intent before a later revision. */
export function beginDraftSave(draft: QuestionDraft, window: EditorWindow, requestId: string) {
  const blocked = editorActionBlock(draft.scope, window, 'save');
  if (blocked) return { draft, blocked } as const;
  if (draft.save.kind === 'conflict') return { draft, blocked: 'conflict' } as const;
  if (draft.save.kind === 'saving') return { draft, blocked: 'save_pending' } as const;
  if (draftSaveStatus(draft) === 'saved') return { draft, blocked: 'already_saved' } as const;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
    throw new Error('DRAFT_REQUEST_ID');
  const intent =
    draft.save.kind === 'failed'
      ? draft.save.intent
      : Object.freeze({
          scope: draft.scope,
          requestId,
          source: draft.source,
          revision: draft.revision,
          baseVersion: draft.serverVersion,
        });
  return {
    draft: { ...draft, save: { kind: 'saving', intent } } as QuestionDraft,
    request: intent,
  } as const;
}

function matchesSave(draft: QuestionDraft, ack: { scope: EditorScope; requestId: string }) {
  return (
    draft.save.kind !== 'idle' &&
    sameEditorScope(draft.scope, ack.scope) &&
    draft.save.intent.requestId === ack.requestId
  );
}

export function acknowledgeDraftSave(
  draft: QuestionDraft,
  ack: {
    scope: EditorScope;
    requestId: string;
    version: number;
  },
): QuestionDraft {
  if (
    !matchesSave(draft, ack) ||
    draft.save.kind === 'idle' ||
    draft.save.kind === 'conflict' ||
    !Number.isSafeInteger(ack.version) ||
    ack.version <= draft.save.intent.baseVersion
  )
    return draft;
  return {
    ...draft,
    serverVersion: ack.version,
    savedRevision: draft.save.intent.revision,
    save: { kind: 'idle' },
  };
}

export function failDraftSave(
  draft: QuestionDraft,
  requestId: string,
  reason: 'network' | 'unavailable',
): QuestionDraft {
  if (draft.save.kind !== 'saving' || draft.save.intent.requestId !== requestId) return draft;
  return { ...draft, save: { kind: 'failed', intent: draft.save.intent, reason } };
}

export function conflictDraftSave(
  draft: QuestionDraft,
  ack: {
    scope: EditorScope;
    requestId: string;
    source: string;
    version: number;
  },
): QuestionDraft {
  if (
    !matchesSave(draft, ack) ||
    draft.save.kind === 'idle' ||
    !Number.isSafeInteger(ack.version) ||
    ack.version <= draft.save.intent.baseVersion ||
    (draft.save.kind === 'conflict' && ack.version <= draft.save.remote.version)
  )
    return draft;
  return {
    ...draft,
    save: {
      kind: 'conflict',
      intent: draft.save.intent,
      remote: Object.freeze({ source: ack.source, version: ack.version }),
    },
  };
}

/** Only an explicit UI choice may call this; no reconnect handler chooses a winner. */
export function resolveDraftConflict(
  draft: QuestionDraft,
  choice: 'keep_local' | 'use_server',
): QuestionDraft {
  if (draft.save.kind !== 'conflict') return draft;
  const remote = draft.save.remote;
  if (choice === 'keep_local')
    return { ...draft, serverVersion: remote.version, savedRevision: null, save: { kind: 'idle' } };
  const revision = draft.revision + 1;
  return {
    ...draft,
    source: remote.source,
    revision,
    serverVersion: remote.version,
    savedRevision: revision,
    save: { kind: 'idle' },
  };
}

export type OfflineDraft = Readonly<{
  schema: 1;
  scope: EditorScope;
  source: string;
  baseVersion: number;
  expiresAt: string;
}>;

/** Envelope preparation only: no browser storage or persistence is performed here. No retention default. */
export function prepareOfflineDraft(
  draft: QuestionDraft,
  window: EditorWindow,
  retentionMs: number,
): OfflineDraft | null {
  if (
    editorActionBlock(draft.scope, window, 'save') ||
    !Number.isSafeInteger(retentionMs) ||
    retentionMs <= 0
  )
    return null;
  return Object.freeze({
    schema: 1,
    scope: draft.scope,
    source: draft.source,
    baseVersion: draft.serverVersion,
    expiresAt: new Date(
      Math.min(Date.parse(window.deadline), Date.parse(window.serverNow) + retentionMs),
    ).toISOString(),
  });
}

export function inspectOfflineDraft(
  local: OfflineDraft,
  window: EditorWindow,
  remote: { source: string; version: number },
) {
  const blocked = editorActionBlock(local.scope, window, 'save');
  if (blocked) return { kind: 'blocked', reason: blocked } as const;
  if (
    local.schema !== 1 ||
    !Number.isSafeInteger(local.baseVersion) ||
    local.baseVersion < 0 ||
    !Number.isSafeInteger(remote.version) ||
    remote.version < 0 ||
    !Number.isFinite(Date.parse(local.expiresAt)) ||
    Date.parse(window.serverNow) >= Date.parse(local.expiresAt) ||
    Date.parse(local.expiresAt) > Date.parse(window.deadline)
  )
    return { kind: 'blocked', reason: 'recovery_expired' } as const;
  if (remote.version < local.baseVersion)
    return { kind: 'blocked', reason: 'stale_server_version' } as const;
  if (local.source === remote.source) return { kind: 'already_synced' } as const;
  if (local.baseVersion !== remote.version)
    return { kind: 'conflict', local: local.source, remote: remote.source } as const;
  return { kind: 'restore_available', source: local.source } as const;
}
