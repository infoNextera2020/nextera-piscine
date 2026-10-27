import {
  editorActionBlock,
  sameEditorScope,
  type EditorScope,
  type EditorWindow,
} from './editor-contract';
import { inspectOfflineDraft, type OfflineDraft } from './editor-drafts';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function recoveryKey(scope: EditorScope) {
  return (
    'nextera:checkpoint-draft:v1:' +
    [scope.learnerId, scope.cohortId, scope.attemptId, scope.taskKey, scope.definitionDigest]
      .map(encodeURIComponent)
      .join(':')
  );
}
/** Invoked only after an explicit retention capability. Never stores session credentials. */
export class EditorRecoveryStore {
  constructor(private readonly storage: () => Store) {}
  remove(scope: EditorScope) {
    try {
      this.storage().removeItem(recoveryKey(scope));
    } catch {
      /* Storage can be disabled. */
    }
  }
  write(local: OfflineDraft, maxBytes: number) {
    if (new TextEncoder().encode(local.source).byteLength > maxBytes) return false;
    try {
      this.storage().setItem(recoveryKey(local.scope), JSON.stringify(local));
      return true;
    } catch {
      return false;
    }
  }
  read(window: EditorWindow, remote: { source: string; version: number }, maxBytes: number) {
    let raw: string | null;
    try {
      raw = this.storage().getItem(recoveryKey(window.scope));
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      if (raw.length > maxBytes * 6 + 8192 || editorActionBlock(window.scope, window, 'save'))
        throw new Error();
      const local = JSON.parse(raw) as OfflineDraft;
      if (
        typeof local.source !== 'string' ||
        !local.scope ||
        !sameEditorScope(local.scope, window.scope) ||
        new TextEncoder().encode(local.source).byteLength > maxBytes ||
        new TextDecoder('utf-8', { ignoreBOM: true }).decode(
          new TextEncoder().encode(local.source),
        ) !== local.source
      )
        throw new Error();
      const inspected = inspectOfflineDraft(local, window, remote);
      if (inspected.kind === 'restore_available' || inspected.kind === 'conflict')
        return { local, kind: inspected.kind, remote: remote.source } as const;
    } catch {
      /* Malformed/expired/foreign source must never populate the editor. */
    }
    this.remove(window.scope);
    return null;
  }
}
