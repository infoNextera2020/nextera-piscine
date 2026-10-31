import { isRequestId } from '@nextera/domain';
import { CheckpointDraftSync, type DraftWriteOutcome } from './editor-sync';
import { sameEditorScope, type EditorScope, type EditorWindow } from './editor-contract';
import { readEditorJson, type BootstrapDraft } from './editor-bootstrap';
import type { SaveIntent } from './editor-drafts';
import { SubmissionIntents } from '../submissions/retry-intent';
import {
  captureMixedAnswer,
  editMixedAnswer,
  emptyMixedAnswer,
  hasMixedAnswerDrafts,
  mixedAnswerDraft,
  serializeMixedAnswer,
  type MixedCheckpointAnswer,
} from './checkpoint-answer';

type Kind = MixedCheckpointAnswer['kind'];
type Context = { window: EditorWindow; contractDigest: string; maxBytes: number; kind: Kind };
type OfficialIntent = { requestId: string; intent: string; payload: string; context: Context };
export type MixedAnswerSessionState = Readonly<{
  answer: MixedCheckpointAnswer;
  phase: 'idle' | 'loading' | 'ready' | 'unavailable';
  status: 'unsaved' | 'saving' | 'saved' | 'failed' | 'conflict' | 'closed';
  conflict: MixedCheckpointAnswer | null;
  submitPending: boolean;
  submitting: boolean;
  canSubmit: boolean;
  message: string;
  acceptedPayload: string | null;
}>;
type Entry = {
  state: MixedAnswerSessionState;
  context?: Context;
  sync?: CheckpointDraftSync;
  loading?: AbortController;
  write?: AbortController;
  submission?: AbortController;
  official?: OfficialIntent;
  epoch: number;
  remoteChoice?: BootstrapDraft;
};
const hex = /^[0-9a-f]{64}$/;
function data(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('ANSWER_RESPONSE');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',')) throw Error('ANSWER_RESPONSE');
}
function scope(value: unknown, expected: Omit<EditorScope, 'definitionDigest'>): EditorScope {
  const s = data(value);
  exact(s, ['learnerId', 'cohortId', 'attemptId', 'taskKey', 'definitionDigest']);
  if (
    Object.entries(expected).some(([key, value]) => s[key] !== value) ||
    typeof s.definitionDigest !== 'string' ||
    !hex.test(s.definitionDigest)
  )
    throw Error('ANSWER_SCOPE');
  return Object.freeze({ ...expected, definitionDigest: s.definitionDigest });
}
async function sha(payload: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function draftRecord(raw: unknown, context: Context): Promise<BootstrapDraft> {
  const r = data(raw);
  exact(r, [
    'schema',
    'scope',
    'answerContractDigest',
    'answer',
    'sha256',
    'byteLength',
    'version',
    'requestId',
  ]);
  const bound = scope(r.scope, context.window.scope);
  const prepared = serializeMixedAnswer(r.answer, context.maxBytes);
  if (
    r.schema !== 1 ||
    !sameEditorScope(bound, context.window.scope) ||
    r.answerContractDigest !== context.contractDigest ||
    prepared.answer.kind !== context.kind ||
    r.byteLength !== prepared.byteLength ||
    r.sha256 !== (await sha(prepared.payload)) ||
    !Number.isSafeInteger(r.version) ||
    (r.version as number) < 1 ||
    typeof r.requestId !== 'string' ||
    !isRequestId(r.requestId)
  )
    throw Error('ANSWER_RECEIPT');
  return Object.freeze({
    source: prepared.payload,
    version: r.version as number,
    requestId: r.requestId as string | null,
  });
}
async function bootstrap(
  raw: unknown,
  expected: Omit<EditorScope, 'definitionDigest'>,
  kind: Kind,
) {
  const envelope = data(raw),
    c = data(envelope.context),
    contract = data(c.answerContract),
    caps = data(c.capabilities);
  exact(envelope, ['schema', 'context', 'draft']);
  exact(c, [
    'scope',
    'readAllowed',
    'status',
    'serverNow',
    'deadline',
    'answerContract',
    'capabilities',
  ]);
  exact(contract, ['version', 'kind', 'maxBytes', 'digest']);
  exact(caps, ['draftsV1', 'officialSubmit']);
  if (
    envelope.schema !== 1 ||
    c.readAllowed !== true ||
    !['active', 'closed'].includes(c.status as string) ||
    typeof c.serverNow !== 'string' ||
    !Number.isFinite(Date.parse(c.serverNow)) ||
    typeof c.deadline !== 'string' ||
    !Number.isFinite(Date.parse(c.deadline)) ||
    contract.version !== 1 ||
    contract.kind !== kind ||
    !Number.isSafeInteger(contract.maxBytes) ||
    (contract.maxBytes as number) <= 0 ||
    (contract.maxBytes as number) > 262144 ||
    typeof contract.digest !== 'string' ||
    !hex.test(contract.digest) ||
    caps.draftsV1 !== true ||
    typeof caps.officialSubmit !== 'boolean'
  )
    throw Error('ANSWER_BOOTSTRAP');
  const window: EditorWindow = {
    scope: scope(c.scope, expected),
    access: 'confirmed',
    attempt: c.status as 'active' | 'closed',
    serverNow: c.serverNow,
    deadline: c.deadline,
    capabilities: { draftsV1: true, officialSubmit: caps.officialSubmit, visibleRun: null },
  };
  const context: Context = {
    window,
    contractDigest: contract.digest,
    maxBytes: contract.maxBytes as number,
    kind,
  };
  return {
    context,
    draft: envelope.draft === null ? null : await draftRecord(envelope.draft, context),
  };
}
function headers(context: Context, requestId: string) {
  return {
    'content-type': 'application/json',
    'x-attempt-id': context.window.scope.attemptId,
    'x-task-key': context.window.scope.taskKey,
    'x-definition-digest': context.window.scope.definitionDigest,
    'x-answer-contract-digest': context.contractDigest,
    'idempotency-key': requestId,
  };
}

/** Answer-specific transport around the existing CAS machine. No filename, source API,
 * device storage, recovery TTL, Run, grading or final Finish is fabricated here. */
export class CheckpointMixedAnswerSession {
  private entries = new Map<string, Entry>();
  private paused = false;
  private closed = false;
  private disposed = false;
  constructor(
    private readonly identity: { learnerId: string; cohortId: string; attemptId: string },
    private readonly deps: {
      send: typeof fetch;
      now(): number;
      requestId(): string;
      intents: SubmissionIntents;
      changed(): void;
      accessRemoved(): void;
    },
  ) {}
  mount() {
    this.disposed = false;
  }
  state(key: string, kind: Kind): MixedAnswerSessionState {
    return this.entry(key, kind).state;
  }
  all() {
    return Object.fromEntries([...this.entries].map(([key, entry]) => [key, entry.state]));
  }
  private entry(key: string, kind: Kind) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        epoch: 0,
        state: {
          answer: emptyMixedAnswer(kind),
          phase: 'idle',
          status: 'unsaved',
          conflict: null,
          submitPending: false,
          submitting: false,
          canSubmit: false,
          message: '',
          acceptedPayload: null,
        },
      };
      this.entries.set(key, entry);
    }
    if (entry.state.answer.kind !== kind) throw Error('ANSWER_KIND_CHANGED');
    return entry;
  }
  private publish(entry: Entry, patch: Partial<MixedAnswerSessionState>) {
    if (this.disposed) return;
    entry.state = { ...entry.state, ...patch };
    this.deps.changed();
  }
  edit(key: string, answer: MixedCheckpointAnswer) {
    if (this.disposed || this.closed) return;
    const entry = this.entry(key, answer.kind);
    const captured = mixedAnswerDraft(editMixedAnswer({}, key, answer), key, answer.kind);
    entry.sync?.edit(JSON.stringify(captured));
    this.publish(entry, { answer: captured, status: entry.sync?.state.status ?? 'unsaved' });
  }
  updateWindow(paused: boolean, closed: boolean, serverNow: string, deadline: string) {
    this.paused = paused;
    this.closed = closed;
    for (const entry of this.entries.values()) {
      if (entry.context && entry.sync)
        entry.sync.refresh({
          ...entry.context.window,
          attempt: closed ? 'closed' : entry.context.window.attempt,
          serverNow,
          deadline,
        });
      if (paused || closed) {
        entry.loading?.abort();
        entry.write?.abort();
        entry.submission?.abort();
      }
      if (closed) this.publish(entry, { status: 'closed' });
    }
  }
  setSubmitCapability(key: string, allowed: boolean) {
    const entry = this.entries.get(key);
    allowed = allowed && entry?.context?.window.capabilities.officialSubmit === true;
    if (
      this.disposed ||
      !entry ||
      entry.state.phase !== 'ready' ||
      entry.state.canSubmit === allowed
    )
      return;
    this.publish(entry, { canSubmit: allowed });
  }
  private removed() {
    if (this.disposed) return;
    this.dispose();
    this.deps.accessRemoved();
  }
  async load(key: string, kind: Kind) {
    const entry = this.entry(key, kind);
    if (
      this.disposed ||
      this.paused ||
      this.closed ||
      entry.loading ||
      entry.sync ||
      ![this.identity.learnerId, this.identity.cohortId, this.identity.attemptId].every(isRequestId)
    )
      return;
    const controller = new AbortController(),
      epoch = ++entry.epoch;
    entry.loading = controller;
    this.publish(entry, { phase: 'loading' });
    try {
      const response = await this.deps.send(
        `/api/checkpoints/answers/drafts?attempt=${this.identity.attemptId}&task=${encodeURIComponent(key)}&bootstrap=1`,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        },
      );
      if (this.disposed || controller.signal.aborted) return;
      if ([401, 403].includes(response.status)) {
        this.removed();
        return;
      }
      if (!response.ok) throw Error('ANSWER_UNAVAILABLE');
      const loaded = await bootstrap(
        await readEditorJson(response, 262144),
        { ...this.identity, taskKey: key },
        kind,
      );
      if (this.disposed || controller.signal.aborted || epoch !== entry.epoch) return;
      entry.context = loaded.context;
      const local = JSON.stringify(entry.state.answer);
      const localContent = hasMixedAnswerDrafts({ answer: entry.state.answer });
      entry.sync = new CheckpointDraftSync(
        {
          window: loaded.context.window,
          sourceBytes: loaded.context.maxBytes,
          draft: loaded.draft,
        },
        {
          now: this.deps.now,
          requestId: this.deps.requestId,
          write: (intent) => this.write(entry, intent),
        },
        localContent ? local : (loaded.draft?.source ?? local),
      );
      if (loaded.draft && localContent && loaded.draft.source !== local)
        entry.remoteChoice = loaded.draft;
      const answer =
        localContent || !loaded.draft
          ? entry.state.answer
          : (JSON.parse(loaded.draft.source) as MixedCheckpointAnswer);
      this.publish(entry, {
        phase: 'ready',
        answer,
        status: entry.remoteChoice ? 'conflict' : entry.sync.state.status,
        canSubmit: loaded.context.window.capabilities.officialSubmit,
        conflict: entry.remoteChoice
          ? (JSON.parse(entry.remoteChoice.source) as MixedCheckpointAnswer)
          : null,
      });
    } catch {
      if (!this.disposed && !controller.signal.aborted && epoch === entry.epoch)
        this.publish(entry, {
          phase: 'unavailable',
          message: 'Server saving could not be confirmed. This answer stays on this page only.',
        });
    } finally {
      if (entry.loading === controller) delete entry.loading;
    }
  }
  private async write(entry: Entry, intent: SaveIntent): Promise<DraftWriteOutcome> {
    const context = entry.context!;
    const controller = new AbortController();
    entry.write = controller;
    try {
      const captured = serializeMixedAnswer(JSON.parse(intent.source), context.maxBytes);
      if (
        captured.answer.kind !== context.kind ||
        captured.payload !== intent.source ||
        !sameEditorScope(intent.scope, context.window.scope)
      )
        throw Error('ANSWER_SCOPE');
      const response = await this.deps.send('/api/checkpoints/answers/drafts', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          ...headers(context, intent.requestId),
          'x-base-version': String(intent.baseVersion),
        },
        body: intent.source,
      });
      if (this.disposed || controller.signal.aborted)
        return { kind: 'uncertain', reason: 'network' };
      if ([401, 403].includes(response.status)) {
        this.removed();
        return { kind: 'blocked', reason: 'removed' };
      }
      if (response.status === 412) return { kind: 'blocked', reason: 'definition_mismatch' };
      const body = data(await readEditorJson(response, context.maxBytes));
      if (response.status === 409 && body.error === 'CLOSED')
        return { kind: 'blocked', reason: 'closed' };
      if (response.status === 409 && body.error === 'ANSWER_DRAFT_CONFLICT') {
        const record = await draftRecord(body.current, context);
        return record.version > intent.baseVersion
          ? { kind: 'conflict', source: record.source, version: record.version }
          : { kind: 'uncertain', reason: 'unavailable' };
      }
      if (!response.ok) return { kind: 'uncertain', reason: 'unavailable' };
      const record = await draftRecord(body, context);
      return record.requestId === intent.requestId &&
        record.source === intent.source &&
        record.version === intent.baseVersion + 1
        ? { kind: 'saved', version: record.version }
        : { kind: 'uncertain', reason: 'unavailable' };
    } catch {
      return { kind: 'uncertain', reason: 'network' };
    } finally {
      if (entry.write === controller) delete entry.write;
    }
  }
  async save(key: string) {
    const entry = this.entries.get(key);
    if (
      !entry?.sync ||
      this.disposed ||
      this.paused ||
      this.closed ||
      entry.write ||
      entry.remoteChoice
    )
      return;
    if (entry.sync.saveBlock()) {
      this.publish(entry, { status: 'closed' });
      return;
    }
    if (entry.sync.state.draft.save.kind === 'idle') {
      try {
        serializeMixedAnswer(JSON.parse(entry.sync.state.draft.source), entry.context!.maxBytes);
      } catch {
        this.publish(entry, {
          status: 'failed',
          message: 'Enter valid answer text within the published response limit before saving.',
        });
        return;
      }
    }
    const operation = entry.sync.save();
    this.publish(entry, { status: entry.sync.state.status });
    await operation;
    const conflict = entry.sync.state.draft.save;
    this.publish(entry, {
      status: entry.sync.state.status,
      conflict:
        conflict.kind === 'conflict'
          ? (JSON.parse(conflict.remote.source) as MixedCheckpointAnswer)
          : null,
    });
  }
  async resolve(key: string, choice: 'keep_local' | 'use_server') {
    const entry = this.entries.get(key);
    if (!entry?.sync || this.paused || this.closed) return;
    const useInitialServer = !!entry.remoteChoice && choice === 'use_server';
    if (entry.remoteChoice) {
      if (choice === 'use_server') entry.sync.edit(entry.remoteChoice.source);
      delete entry.remoteChoice;
    } else entry.sync.resolveConflict(choice);
    this.publish(entry, {
      answer: JSON.parse(entry.sync.state.draft.source) as MixedCheckpointAnswer,
      status: useInitialServer ? 'saved' : entry.sync.state.status,
      conflict: null,
    });
    if (choice === 'keep_local') await this.save(key);
  }
  async submit(key: string) {
    const entry = this.entries.get(key);
    if (
      !entry?.context ||
      !entry.sync ||
      entry.state.phase !== 'ready' ||
      entry.state.submitting ||
      this.disposed ||
      this.paused ||
      this.closed ||
      entry.sync.saveBlock()
    )
      return;
    const context = entry.context;
    if (!entry.official && !entry.state.canSubmit) return;
    this.publish(entry, { submitting: true, message: 'Preparing an immutable answer snapshot…' });
    const epoch = entry.epoch;
    const controller = new AbortController();
    entry.submission = controller;
    try {
      if (!entry.official) {
        const captured = captureMixedAnswer(
          context.window.scope,
          entry.state.answer,
          context.maxBytes,
        );
        const intent =
          'checkpoint-answer:' +
          JSON.stringify([
            context.window.scope,
            context.contractDigest,
            await sha(captured.payload),
          ]);
        if (this.disposed || this.paused || this.closed || entry.sync.saveBlock()) return;
        entry.official = {
          intent,
          payload: captured.payload,
          requestId: this.deps.intents.requestId(intent),
          context,
        };
      }
      this.publish(entry, { submitPending: true, message: 'Submitting this answer snapshot…' });
      const packet = entry.official;
      const response = await this.deps.send('/api/checkpoints/answers/submissions', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: headers(packet.context, packet.requestId),
        body: packet.payload,
      });
      if (this.disposed || controller.signal.aborted) return;
      if ([401, 403].includes(response.status)) {
        this.removed();
        return;
      }
      const receipt = data(await readEditorJson(response, context.maxBytes));
      if (this.disposed || controller.signal.aborted || epoch !== entry.epoch) return;
      exact(receipt, ['schema', 'id', 'requestId', 'replayed', 'evaluation']);
      if (
        ![200, 202].includes(response.status) ||
        receipt.schema !== 1 ||
        typeof receipt.id !== 'string' ||
        !isRequestId(receipt.id) ||
        receipt.requestId !== packet.requestId ||
        receipt.evaluation !== 'pending' ||
        typeof receipt.replayed !== 'boolean'
      )
        throw Error('ANSWER_UNCERTAIN');
      this.deps.intents.confirm(packet.intent);
      delete entry.official;
      this.publish(entry, {
        submitPending: false,
        acceptedPayload: packet.payload,
        message:
          'Submission accepted. The result stays provisional until evaluation and mentor review finish. Later edits remain a separate draft.',
      });
    } catch {
      this.publish(entry, {
        submitPending: !!entry.official,
        message: entry.official
          ? 'Receipt unconfirmed. Check official history, then retry the exact original snapshot. Later edits are not sent by Retry.'
          : 'Complete the published answer fields within the size limit before submitting.',
      });
    } finally {
      if (entry.submission === controller) delete entry.submission;
      this.publish(entry, { submitting: false });
    }
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.epoch++;
      entry.loading?.abort();
      entry.write?.abort();
      entry.submission?.abort();
      entry.sync?.close('disposed');
    }
    this.entries.clear();
  }
}
