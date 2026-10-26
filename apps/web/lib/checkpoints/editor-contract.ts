/** Client hints only: the eventual server must recheck every write and execution. */
export type EditorScope = Readonly<{
  learnerId: string;
  cohortId: string;
  attemptId: string;
  taskKey: string;
  definitionDigest: string;
}>;

export type VisibleRunLimits = Readonly<{
  timeoutMs: number;
  memoryMb: number;
  outputBytes: number;
  sourceBytes: number;
  requestsPerWindow: number;
  windowMs: number;
  concurrency: number;
}>;

export type EditorWindow = Readonly<{
  scope: EditorScope;
  access: 'confirmed' | 'session_expired' | 'removed' | 'unknown';
  attempt: 'active' | 'closed';
  serverNow: string;
  deadline: string;
  capabilities: Readonly<{
    draftsV1: boolean;
    officialSubmit: boolean;
    visibleRun: null | Readonly<{
      visibility: 'visible_examples';
      graded: false;
      consumesGradedAttempts: false;
      limits: VisibleRunLimits;
    }>;
  }>;
}>;

export type EditorBlock =
  | 'scope_mismatch'
  | 'session_expired'
  | 'removed'
  | 'unknown'
  | 'closed'
  | 'clock_unavailable'
  | 'expired'
  | 'capability_unavailable';

const scopeFields = ['learnerId', 'cohortId', 'attemptId', 'taskKey', 'definitionDigest'] as const;
export function sameEditorScope(a: EditorScope, b: EditorScope) {
  return scopeFields.every((key) => !!a[key] && a[key] === b[key]);
}

export function validVisibleRunLimits(limits: VisibleRunLimits) {
  return (
    !!limits &&
    (
      [
        'timeoutMs',
        'memoryMb',
        'outputBytes',
        'sourceBytes',
        'requestsPerWindow',
        'windowMs',
        'concurrency',
      ] as const
    ).every((key) => Number.isSafeInteger(limits[key]) && limits[key] > 0)
  );
}

export function editorActionBlock(
  scope: EditorScope,
  window: EditorWindow,
  action: 'save' | 'run' | 'submit',
): EditorBlock | null {
  if (!sameEditorScope(scope, window.scope)) return 'scope_mismatch';
  if (window.access !== 'confirmed') return window.access;
  if (window.attempt !== 'active') return 'closed';
  const now = Date.parse(window.serverNow),
    deadline = Date.parse(window.deadline);
  if (!Number.isFinite(now) || !Number.isFinite(deadline)) return 'clock_unavailable';
  if (now >= deadline) return 'expired';
  if (!window.capabilities) return 'capability_unavailable';
  if (action === 'save') return window.capabilities.draftsV1 ? null : 'capability_unavailable';
  if (action === 'submit')
    return window.capabilities.officialSubmit ? null : 'capability_unavailable';
  const run = window.capabilities.visibleRun;
  return run?.visibility === 'visible_examples' &&
    run.graded === false &&
    run.consumesGradedAttempts === false &&
    validVisibleRunLimits(run.limits)
    ? null
    : 'capability_unavailable';
}

export type SourceSnapshot = Readonly<{
  scope: EditorScope;
  requestId: string;
  filename: string;
  source: string;
  byteLength: number;
}>;

/** Keep exact text, including line endings. Return fresh bytes for each transport use. */
export function snapshotBytes(snapshot: SourceSnapshot) {
  return new TextEncoder().encode(snapshot.source);
}

export function captureSource(
  scope: EditorScope,
  source: string,
  requestId: string,
  filename: string,
  maxBytes: number,
): SourceSnapshot {
  if (!scopeFields.every((key) => scope[key])) throw new Error('EDITOR_SCOPE');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
    throw new Error('EDITOR_REQUEST_ID');
  if (
    !filename ||
    Array.from(filename).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    filename.includes('/') ||
    filename.includes(String.fromCharCode(92))
  )
    throw new Error('EDITOR_FILENAME');
  const byteLength = new TextEncoder().encode(source).byteLength;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || byteLength === 0 || byteLength > maxBytes)
    throw new Error('EDITOR_SOURCE_SIZE');
  return Object.freeze({
    scope: Object.freeze({ ...scope }),
    source,
    requestId,
    filename,
    byteLength,
  });
}

/** No grade or previous-question status is an input to navigation. */
export function selectExamQuestion<
  T extends { taskKeys: readonly string[]; selectedTaskKey: string | null },
>(state: T, taskKey: string): Omit<T, 'selectedTaskKey'> & { selectedTaskKey: string | null } {
  return state.taskKeys.includes(taskKey) ? { ...state, selectedTaskKey: taskKey } : state;
}
