import { editorActionBlock, sameEditorScope, type EditorWindow } from './editor-contract';
import {
  acknowledgeDraftSave,
  beginDraftSave,
  conflictDraftSave,
  createQuestionDraft,
  draftSaveStatus,
  editQuestionDraft,
  failDraftSave,
  prepareOfflineDraft,
  resolveDraftConflict,
  type QuestionDraft,
  type SaveIntent,
} from './editor-drafts';
import { parseBootstrapDraft, readEditorJson, type EditorBootstrap } from './editor-bootstrap';

export type DraftWriteOutcome =
  | { kind: 'saved'; version: number }
  | { kind: 'conflict'; source: string; version: number }
  | { kind: 'blocked'; reason: 'session_expired' | 'removed' | 'closed' | 'definition_mismatch' }
  | { kind: 'uncertain'; reason: 'network' | 'unavailable' };
export async function sendDraftIntent(
  intent: SaveIntent,
  maxBytes: number,
  send: typeof fetch = fetch,
): Promise<DraftWriteOutcome> {
  try {
    const response = await send('/api/checkpoints/drafts', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        'content-type': 'application/octet-stream',
        'x-attempt-id': intent.scope.attemptId,
        'x-task-key': intent.scope.taskKey,
        'x-definition-digest': intent.scope.definitionDigest,
        'x-base-version': String(intent.baseVersion),
        'idempotency-key': intent.requestId,
      },
      body: new Blob([intent.source], { type: 'application/octet-stream' }),
    });
    if (response.status === 401) return { kind: 'blocked', reason: 'session_expired' };
    if (response.status === 403) return { kind: 'blocked', reason: 'removed' };
    if (response.status === 412) return { kind: 'blocked', reason: 'definition_mismatch' };
    if (response.status !== 200 && response.status !== 409)
      return { kind: 'uncertain', reason: 'unavailable' };
    const body = (await readEditorJson(response, maxBytes)) as Record<string, unknown>;
    if (response.status === 409 && body.error === 'CLOSED')
      return { kind: 'blocked', reason: 'closed' };
    const raw =
      response.status === 200 ? body : body.error === 'DRAFT_CONFLICT' ? body.current : null;
    const record = parseBootstrapDraft(raw, maxBytes);
    if (
      (raw as Record<string, unknown>).definitionDigest !== intent.scope.definitionDigest ||
      record.version <= intent.baseVersion
    )
      return { kind: 'uncertain', reason: 'unavailable' };
    if (response.status === 409)
      return { kind: 'conflict', source: record.source, version: record.version };
    return record.source === intent.source && record.requestId === intent.requestId
      ? { kind: 'saved', version: record.version }
      : { kind: 'uncertain', reason: 'unavailable' };
  } catch {
    return { kind: 'uncertain', reason: 'network' };
  }
}

/** One controller per attested question. No timers, browser storage, Run or graded Submit side effects. */
export class CheckpointDraftSync {
  private draft: QuestionDraft;
  private window: EditorWindow;
  private receivedAt: number;
  private epoch = 0;
  private blocked: string | null = null;
  constructor(
    private readonly bootstrap: EditorBootstrap,
    private readonly deps: {
      now(): number;
      requestId(): string;
      write(intent: SaveIntent): Promise<DraftWriteOutcome>;
    },
    initialSource?: string,
  ) {
    this.window = bootstrap.window;
    this.receivedAt = deps.now();
    this.draft = createQuestionDraft(this.window.scope, bootstrap.draft ?? undefined);
    if (initialSource !== undefined) this.draft = editQuestionDraft(this.draft, initialSource);
  }
  get state() {
    return {
      draft: this.draft,
      status: draftSaveStatus(this.draft),
      blocked: this.blocked,
    } as const;
  }
  edit(source: string) {
    if (this.blocked) return;
    this.draft = editQuestionDraft(this.draft, source);
  }
  private currentWindow(): EditorWindow {
    const elapsed = this.deps.now() - this.receivedAt;
    const now = new Date(Date.parse(this.window.serverNow) + elapsed);
    return Number.isFinite(elapsed) && elapsed >= 0 && Number.isFinite(now.getTime())
      ? { ...this.window, serverNow: now.toISOString() }
      : { ...this.window, access: 'unknown' };
  }
  /** Refreshes hints only. The API rechecks access/time/CAS atomically on every write. */
  refresh(window: EditorWindow) {
    if (this.blocked) return;
    if (!sameEditorScope(window.scope, this.draft.scope)) {
      this.close('scope_mismatch');
      return;
    }
    if (window.access !== 'confirmed') {
      this.close(window.access);
      return;
    }
    const current = this.currentWindow();
    const oldNow = Date.parse(current.serverNow),
      nextNow = Date.parse(window.serverNow);
    const oldDeadline = Date.parse(current.deadline),
      nextDeadline = Date.parse(window.deadline);
    this.window =
      Number.isFinite(oldNow) &&
      Number.isFinite(nextNow) &&
      Number.isFinite(oldDeadline) &&
      Number.isFinite(nextDeadline)
        ? {
            ...window,
            serverNow: new Date(Math.max(oldNow, nextNow)).toISOString(),
            deadline: new Date(Math.min(oldDeadline, nextDeadline)).toISOString(),
          }
        : window;
    this.receivedAt = this.deps.now();
  }
  saveBlock() {
    return this.blocked ?? editorActionBlock(this.draft.scope, this.currentWindow(), 'save');
  }
  async save() {
    if (this.blocked) return { blocked: this.blocked };
    const result = beginDraftSave(this.draft, this.currentWindow(), this.deps.requestId());
    if (!result.request) return { blocked: result.blocked };
    const bytes = new TextEncoder().encode(result.request.source);
    if (
      bytes.byteLength > this.bootstrap.sourceBytes ||
      new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== result.request.source
    )
      return { blocked: 'source_invalid' };
    this.draft = result.draft;
    const intent = result.request,
      epoch = this.epoch;
    let outcome: DraftWriteOutcome;
    try {
      outcome = await this.deps.write(intent);
    } catch {
      outcome = { kind: 'uncertain', reason: 'network' };
    }
    if (epoch !== this.epoch) return { blocked: this.blocked ?? 'disposed' };
    if (outcome.kind === 'saved')
      this.draft = acknowledgeDraftSave(this.draft, {
        scope: intent.scope,
        requestId: intent.requestId,
        version: outcome.version,
      });
    else if (outcome.kind === 'conflict')
      this.draft = conflictDraftSave(this.draft, {
        scope: intent.scope,
        requestId: intent.requestId,
        source: outcome.source,
        version: outcome.version,
      });
    else if (outcome.kind === 'blocked') {
      if (['removed', 'session_expired', 'definition_mismatch'].includes(outcome.reason))
        this.close(outcome.reason);
      else {
        this.draft = failDraftSave(this.draft, intent.requestId, 'unavailable');
        this.window = { ...this.window, attempt: 'closed' };
      }
    } else this.draft = failDraftSave(this.draft, intent.requestId, outcome.reason);
    if (this.draft.save.kind === 'saving')
      this.draft = failDraftSave(this.draft, intent.requestId, 'unavailable');
    return { status: draftSaveStatus(this.draft), blocked: this.blocked };
  }
  resolveConflict(choice: 'keep_local' | 'use_server') {
    if (!this.blocked) this.draft = resolveDraftConflict(this.draft, choice);
  }
  /** Policy must be supplied explicitly by a future configured recovery adapter. No default TTL. */
  recoveryEnvelope(policy: null | { retentionMs: number }) {
    if (
      this.blocked ||
      !policy ||
      editorActionBlock(this.draft.scope, this.currentWindow(), 'save')
    )
      return null;
    return prepareOfflineDraft(this.draft, this.currentWindow(), policy.retentionMs);
  }
  close(reason = 'disposed') {
    this.epoch++;
    this.blocked = reason;
    this.draft = createQuestionDraft(this.draft.scope);
  }
}
