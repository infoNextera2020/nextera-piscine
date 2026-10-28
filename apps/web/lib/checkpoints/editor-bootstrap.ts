import { sameEditorScope, type EditorScope, type EditorWindow } from './editor-contract';

export type EditorIdentity = Omit<EditorScope, 'definitionDigest'>;
export type BootstrapDraft = Readonly<{
  source: string;
  version: number;
  requestId: string | null;
}>;
export type EditorBootstrap = Readonly<{
  schema: 1;
  window: EditorWindow;
  filename: string;
  sourceBytes: number;
  draft: BootstrapDraft | null;
  offlineRecovery: null | Readonly<{ retentionMs: number }>;
}>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('EDITOR_RESPONSE');
  return value as Record<string, unknown>;
}
export function parseBootstrapDraft(value: unknown, maxBytes: number): BootstrapDraft {
  const record = object(value);
  if (
    typeof record.source !== 'string' ||
    new TextEncoder().encode(record.source).byteLength > maxBytes ||
    new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      new TextEncoder().encode(record.source),
    ) !== record.source ||
    typeof record.version !== 'number' ||
    !Number.isSafeInteger(record.version) ||
    record.version < 0 ||
    (record.requestId !== null &&
      (typeof record.requestId !== 'string' || !uuid.test(record.requestId)))
  )
    throw new Error('EDITOR_RESPONSE');
  return Object.freeze({
    source: record.source,
    version: record.version,
    requestId: record.requestId as string | null,
  });
}
/** Never construct the definition digest, learner identity or write window from fixture/client guesses. */
export function parseEditorBootstrap(value: unknown, expected: EditorIdentity): EditorBootstrap {
  const body = object(value),
    window = object(body.window),
    scope = object(window.scope),
    caps = object(window.capabilities);
  for (const key of ['learnerId', 'cohortId', 'attemptId'] as const)
    if (typeof scope[key] !== 'string' || !uuid.test(scope[key]) || scope[key] !== expected[key])
      throw new Error('EDITOR_SCOPE');
  if (
    body.schema !== 1 ||
    scope.taskKey !== expected.taskKey ||
    typeof scope.taskKey !== 'string' ||
    !/^[a-z0-9-]{1,100}$/.test(scope.taskKey) ||
    typeof scope.definitionDigest !== 'string' ||
    !digest.test(scope.definitionDigest) ||
    window.access !== 'confirmed' ||
    !['active', 'closed'].includes(String(window.attempt)) ||
    typeof window.serverNow !== 'string' ||
    !Number.isFinite(Date.parse(window.serverNow)) ||
    typeof window.deadline !== 'string' ||
    !Number.isFinite(Date.parse(window.deadline)) ||
    typeof body.sourceBytes !== 'number' ||
    !Number.isSafeInteger(body.sourceBytes) ||
    body.sourceBytes <= 0 ||
    body.sourceBytes > 262144 ||
    typeof body.filename !== 'string' ||
    !/^[A-Za-z0-9_]+\.go$/.test(body.filename) ||
    typeof caps.draftsV1 !== 'boolean' ||
    typeof caps.officialSubmit !== 'boolean' ||
    (caps.draftsV1 === false && (body.draft !== null || body.offlineRecovery !== null)) ||
    caps.visibleRun !== null ||
    (body.offlineRecovery !== null &&
      (!body.offlineRecovery ||
        typeof body.offlineRecovery !== 'object' ||
        !Number.isSafeInteger((body.offlineRecovery as { retentionMs?: unknown }).retentionMs) ||
        Number((body.offlineRecovery as { retentionMs?: unknown }).retentionMs) <= 0))
  )
    throw new Error('EDITOR_RESPONSE');
  const verifiedScope: EditorScope = Object.freeze({
    ...expected,
    definitionDigest: scope.definitionDigest,
  });
  return Object.freeze({
    schema: 1,
    window: Object.freeze({
      scope: verifiedScope,
      access: 'confirmed',
      attempt: window.attempt as 'active' | 'closed',
      serverNow: window.serverNow,
      deadline: window.deadline,
      capabilities: Object.freeze({
        draftsV1: caps.draftsV1,
        officialSubmit: caps.officialSubmit,
        visibleRun: null,
      }),
    }),
    filename: body.filename,
    sourceBytes: body.sourceBytes,
    draft: body.draft === null ? null : parseBootstrapDraft(body.draft, body.sourceBytes),
    offlineRecovery:
      body.offlineRecovery === null
        ? null
        : Object.freeze({
            retentionMs: Number((body.offlineRecovery as { retentionMs: number }).retentionMs),
          }),
  });
}

/** Bound JSON before parsing; six bytes per source byte covers escaped control characters. */
export async function readEditorJson(response: Response, sourceBytes: number): Promise<unknown> {
  const limit = sourceBytes * 6 + 8192;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('EDITOR_RESPONSE');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('EDITOR_RESPONSE_SIZE');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export async function loadCheckpointEditor(expected: EditorIdentity, send: typeof fetch = fetch) {
  try {
    const query = new URLSearchParams({ attempt: expected.attemptId, task: expected.taskKey });
    const response = await send(`/api/checkpoints/editor?${query}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) return { kind: 'blocked', reason: 'session_expired' } as const;
    if (response.status === 403) return { kind: 'blocked', reason: 'removed' } as const;
    if (response.status !== 200) return { kind: 'blocked', reason: 'unavailable' } as const;
    return {
      kind: 'available',
      bootstrap: parseEditorBootstrap(await readEditorJson(response, 262144), expected),
    } as const;
  } catch {
    return { kind: 'blocked', reason: 'unavailable' } as const;
  }
}
export function bootstrapMatchesScope(bootstrap: EditorBootstrap, scope: EditorScope) {
  return sameEditorScope(bootstrap.window.scope, scope);
}
