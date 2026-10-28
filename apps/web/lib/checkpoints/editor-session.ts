import { sameEditorScope } from './editor-contract';
import type { EditorBootstrap, EditorIdentity } from './editor-bootstrap';
import { loadCheckpointEditor } from './editor-bootstrap';
import { CheckpointDraftSync, sendDraftIntent } from './editor-sync';
import { EditorRecoveryStore } from './editor-recovery';
export type QuestionSession = Readonly<{
  source: string;
  phase: 'idle' | 'loading' | 'unavailable' | 'ready';
  status: 'unsaved' | 'saving' | 'saved' | 'failed' | 'conflict' | 'closed';
  conflict: null | { source: string; version: number };
  recovery: null | { source: string; remote: string; conflict: boolean };
  localStatus: 'disabled' | 'stored' | 'failed';
}>;
type Entry = {
  buffer: string;
  edited: boolean;
  phase: QuestionSession['phase'];
  sync?: CheckpointDraftSync;
  boot?: EditorBootstrap;
  generation: number;
  timer?: unknown;
  recovery: QuestionSession['recovery'];
  localStatus: QuestionSession['localStatus'];
};
type Dependencies = {
  now(): number;
  requestId(): string;
  load: typeof loadCheckpointEditor;
  write: typeof sendDraftIntent;
  schedule(fn: () => void): unknown;
  cancel(timer: unknown): void;
  recovery?: EditorRecoveryStore;
  accessRemoved(): void;
};
/** One lifecycle per attested learner/cohort/attempt. Question selection never disposes it. */
export class CheckpointEditorSession {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private snapshot: Readonly<Record<string, QuestionSession>> = {};
  private active = true;
  private paused = true;
  private expired = false;
  private windowHint: { serverNow: string; deadline: string; active: boolean } | null = null;
  constructor(
    private readonly identity: Omit<EditorIdentity, 'taskKey'>,
    private readonly deps: Dependencies,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  activate() {
    this.active = true;
  }
  private entry(key: string) {
    let e = this.entries.get(key);
    if (!e) {
      e = {
        buffer: '',
        edited: false,
        phase: 'idle',
        generation: 0,
        recovery: null,
        localStatus: 'disabled',
      };
      this.entries.set(key, e);
    }
    return e;
  }
  private emit() {
    if (!this.active) return;
    const next: Record<string, QuestionSession> = {};
    for (const [key, e] of this.entries) {
      const s = e.sync?.state;
      next[key] = {
        source: s?.draft.source ?? e.buffer,
        phase: e.phase,
        status:
          s?.blocked || this.expired || this.windowHint?.active === false
            ? 'closed'
            : (s?.status ?? 'unsaved'),
        conflict: s?.draft.save.kind === 'conflict' ? s.draft.save.remote : null,
        recovery: e.recovery,
        localStatus: e.localStatus,
      };
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
  setAvailability(
    paused: boolean,
    expired: boolean,
    hint: { serverNow: string; deadline: string; active: boolean },
  ) {
    this.paused = paused;
    this.expired = expired;
    this.windowHint = hint;
    for (const [key, e] of this.entries) {
      if (e.sync && e.boot)
        e.sync.refresh({
          ...e.boot.window,
          serverNow: hint.serverNow,
          deadline: hint.deadline,
          attempt: hint.active ? 'active' : 'closed',
        });
      if (paused || expired) {
        if (e.timer !== undefined) this.deps.cancel(e.timer);
        e.timer = undefined;
        if (expired && e.boot) this.deps.recovery?.remove(e.boot.window.scope);
      } else if (e.sync?.state.status === 'unsaved') this.schedule(key, e);
    }
    this.emit();
  }
  private permitted(e: Entry) {
    return (
      this.active &&
      !this.paused &&
      !this.expired &&
      e.phase === 'ready' &&
      !!e.sync &&
      !e.sync.saveBlock()
    );
  }
  private schedule(key: string, e: Entry) {
    if (e.timer !== undefined) this.deps.cancel(e.timer);
    e.timer = undefined;
    if (this.permitted(e))
      e.timer = this.deps.schedule(() => {
        e.timer = undefined;
        void this.save(key);
      });
  }
  private persist(e: Entry) {
    const policy = e.boot?.offlineRecovery;
    if (!policy || !e.sync || !this.active || this.expired || e.recovery) {
      e.localStatus = 'disabled';
      return;
    }
    const local = e.sync.recoveryEnvelope(policy);
    if (!local) {
      this.deps.recovery?.remove(e.boot!.window.scope);
      e.localStatus = 'disabled';
      return;
    }
    e.localStatus = this.deps.recovery?.write(local, e.boot!.sourceBytes) ? 'stored' : 'failed';
  }
  edit(key: string, source: string) {
    if (!this.active || this.expired) return;
    const e = this.entry(key);
    e.edited = true;
    e.buffer = source;
    e.sync?.edit(source);
    this.persist(e);
    this.schedule(key, e);
    this.emit();
  }
  async load(key: string, fresh = false) {
    if (!this.active) return;
    const e = this.entry(key);
    if (!fresh && (e.phase === 'loading' || e.sync)) return;
    const generation = ++e.generation;
    if (e.timer !== undefined) this.deps.cancel(e.timer);
    e.timer = undefined;
    e.phase = 'loading';
    this.emit();
    let result: Awaited<ReturnType<typeof loadCheckpointEditor>>;
    try {
      result = await this.deps.load({ ...this.identity, taskKey: key });
    } catch {
      result = { kind: 'blocked', reason: 'unavailable' };
    }
    if (!this.active || e.generation !== generation) return;
    if (result.kind === 'blocked') {
      e.phase = 'unavailable';
      if (result.reason === 'removed' || result.reason === 'session_expired') this.revoke();
      else this.emit();
      return;
    }
    const boot = result.bootstrap;
    if (e.boot && !sameEditorScope(e.boot.window.scope, boot.window.scope)) {
      this.revoke();
      return;
    }
    if (!boot.window.capabilities.draftsV1) {
      // Official Submit may be attested independently. Never label it as autosave readiness.
      // Retain a prior controller/uncertain intent for exact reconciliation if saving returns.
      e.sync?.refresh(boot.window);
      e.boot = boot;
      e.phase = 'unavailable';
      e.recovery = null;
      e.localStatus = 'disabled';
      this.deps.recovery?.remove(boot.window.scope);
      this.emit();
      return;
    }
    if (e.sync) {
      if (!sameEditorScope(e.sync.state.draft.scope, boot.window.scope)) {
        this.revoke();
        return;
      }
      e.sync.refresh(boot.window);
    } else
      e.sync = new CheckpointDraftSync(
        boot,
        {
          now: this.deps.now,
          requestId: this.deps.requestId,
          write: (intent) => this.deps.write(intent, boot.sourceBytes),
        },
        e.edited ? e.buffer : undefined,
      );
    const first = !e.boot;
    e.boot = boot;
    e.phase = 'ready';
    // Never relax the outer access/read pause. Mutations always recheck server authority too.
    if (this.windowHint)
      e.sync.refresh({
        ...boot.window,
        serverNow: this.windowHint.serverNow,
        deadline: this.windowHint.deadline,
        attempt: this.windowHint.active ? 'active' : 'closed',
      });
    if (first && boot.offlineRecovery && !this.paused && !this.expired) {
      const found = this.deps.recovery?.read(
        boot.window,
        boot.draft ?? { source: '', version: 0 },
        boot.sourceBytes,
      );
      if (found)
        e.recovery = {
          source: found.local.source,
          remote: found.remote,
          conflict: found.kind === 'conflict',
        };
    }
    this.persist(e);
    this.emit();
    if (!e.recovery && (e.edited || e.sync.state.status === 'failed')) this.schedule(key, e);
  }
  async save(key: string) {
    const e = this.entry(key);
    if (!this.permitted(e) || e.recovery || e.sync!.state.status === 'saving') return;
    const generation = e.generation;
    const pending = e.sync!.save();
    this.emit();
    const outcome = await pending;
    if (!this.active || e.generation !== generation) return;
    if (
      e.sync!.state.blocked &&
      ['removed', 'session_expired', 'definition_mismatch'].includes(e.sync!.state.blocked!)
    ) {
      this.revoke();
      return;
    }
    this.persist(e);
    this.emit();
    if (!outcome.blocked && e.sync!.state.status === 'unsaved') this.schedule(key, e);
  }
  resolve(key: string, choice: 'keep_local' | 'use_server') {
    const e = this.entry(key);
    if (!this.permitted(e)) return;
    e.sync!.resolveConflict(choice);
    e.buffer = e.sync!.state.draft.source;
    this.persist(e);
    this.emit();
    if (choice === 'keep_local') this.schedule(key, e);
  }
  chooseRecovery(key: string, choice: 'use_device' | 'keep_current') {
    const e = this.entry(key);
    if (!this.permitted(e) || !e.recovery) return;
    if (choice === 'use_device') {
      e.sync!.edit(e.recovery.source);
      e.buffer = e.recovery.source;
      e.edited = true;
    }
    e.recovery = null;
    if (e.boot) this.deps.recovery?.remove(e.boot.window.scope);
    this.persist(e);
    this.emit();
    if (e.sync!.state.status === 'unsaved') this.schedule(key, e);
  }
  private revoke() {
    this.dispose(true);
    this.deps.accessRemoved();
  }
  /** Navigation/unmount preserves an unexpired device draft; access revocation purges known scopes. */
  dispose(purge = false) {
    this.active = false;
    for (const e of this.entries.values()) {
      ++e.generation;
      if (e.timer !== undefined) this.deps.cancel(e.timer);
      e.sync?.close();
      if (purge && e.boot) this.deps.recovery?.remove(e.boot.window.scope);
      e.buffer = '';
      e.recovery = null;
    }
    this.entries.clear();
    this.snapshot = {};
    for (const listener of this.listeners) listener();
  }
}
