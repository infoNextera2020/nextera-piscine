import { SubmissionIntents } from '../submissions/retry-intent';

export type OfficialSource = Readonly<{
  cohort: string;
  node: string;
  attemptId: string;
  taskKey: string;
  filename: string;
  source: string;
  byteLength: number;
}>;
export type OfficialSnapshot = OfficialSource & Readonly<{ intent: string; requestId: string }>;
const requestPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Capture before any await. This uses the existing raw submission contract, not a fabricated editor scope. */
export function captureCheckpointSource(
  input: Omit<OfficialSource, 'filename' | 'byteLength'> & {
    rules: { required_files: readonly string[]; max_size_kb: number };
  },
): OfficialSource {
  const { rules, ...scope } = input;
  const filename = rules.required_files[0];
  const bytes = new TextEncoder().encode(input.source);
  if (
    rules.required_files.length !== 1 ||
    !filename ||
    !/^[A-Za-z0-9_]+\.go$/.test(filename) ||
    !Number.isSafeInteger(rules.max_size_kb) ||
    rules.max_size_kb <= 0 ||
    !scope.cohort ||
    !scope.node ||
    !scope.attemptId ||
    !scope.taskKey ||
    bytes.byteLength === 0 ||
    bytes.byteLength > Math.min(262144, rules.max_size_kb * 1024) ||
    new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== input.source
  )
    throw new Error('INVALID_CHECKPOINT_SOURCE');
  return Object.freeze({ ...scope, filename, byteLength: bytes.byteLength });
}
export async function identifyCheckpointSource(
  source: OfficialSource,
  intents: SubmissionIntents,
): Promise<OfficialSnapshot> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source.source));
  const digest = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  const intent = `checkpoint-submission:${source.cohort}:${source.node}:${source.attemptId}:${source.taskKey}:${source.filename}:${digest}`;
  return Object.freeze({ ...source, intent, requestId: intents.requestId(intent) });
}
export async function sendCheckpointSource(
  snapshot: OfficialSnapshot,
  send: typeof fetch = fetch,
): Promise<{ kind: 'accepted'; id: string } | { kind: 'access_removed' } | { kind: 'uncertain' }> {
  try {
    const response = await send('/api/checkpoints/submissions', {
      method: 'POST',
      headers: {
        'x-attempt-id': snapshot.attemptId,
        'x-task-key': snapshot.taskKey,
        'x-filename': snapshot.filename,
        'idempotency-key': snapshot.requestId,
        'content-type': 'application/octet-stream',
      },
      body: new Blob([snapshot.source], { type: 'application/octet-stream' }),
    });
    if (response.status === 401 || response.status === 403) return { kind: 'access_removed' };
    if (response.status !== 202) return { kind: 'uncertain' };
    const record = (await response.json()) as { id?: unknown };
    return typeof record.id === 'string' && requestPattern.test(record.id)
      ? { kind: 'accepted', id: record.id }
      : { kind: 'uncertain' };
  } catch {
    return { kind: 'uncertain' };
  }
}

export type QuestionDraft = Readonly<{ source: string; acceptedSource: string | null }>;
export type QuestionDrafts = Readonly<Record<string, QuestionDraft>>;
export function questionDraft(drafts: QuestionDrafts, key: string): QuestionDraft {
  return Object.hasOwn(drafts, key) ? drafts[key]! : { source: '', acceptedSource: null };
}
export function editQuestion(drafts: QuestionDrafts, key: string, source: string): QuestionDrafts {
  return { ...drafts, [key]: { ...questionDraft(drafts, key), source } };
}
export function acceptQuestion(drafts: QuestionDrafts, snapshot: OfficialSource): QuestionDrafts {
  return {
    ...drafts,
    [snapshot.taskKey]: {
      ...questionDraft(drafts, snapshot.taskKey),
      acceptedSource: snapshot.source,
    },
  };
}
export function hasUnsubmittedDrafts(drafts: QuestionDrafts) {
  return Object.values(drafts).some(isQuestionDraftDirty);
}

export function isQuestionDraftDirty(draft: QuestionDraft) {
  return draft.source !== (draft.acceptedSource ?? '');
}
