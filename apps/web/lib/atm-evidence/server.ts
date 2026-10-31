import 'server-only';
import {
  AtmEvidenceError,
  captureAtmLimits,
  captureAtmResolve,
  captureAtmRetain,
  captureAtmReconcile,
  createPostgresAtmEvidenceStore,
  openAtmEvidencePostgres,
  type AtmEvidenceClient,
  type AtmEvidenceLimits,
} from '@nextera/db/atm-evidence';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
type Operation = 'resolve' | 'retain' | 'reconcile';
type Configuration = Readonly<{
  expiresAt: number;
  timeoutMs: number;
  maxRequestBytes: number;
  limits: AtmEvidenceLimits;
  workers: ReadonlyMap<string, string>;
}>;
export type AtmEvidenceConnection = Readonly<{ client: AtmEvidenceClient; close(): Promise<void> }>;
export type AtmEvidenceOpener = (explicitWorkerDsn: string) => AtmEvidenceConnection;
function unavailable(): never {
  throw new AtmEvidenceError('unavailable');
}
function exact(v: unknown, names: readonly string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length !== names.length ||
    names.some((n) => !Object.hasOwn(v, n))
  )
    return unavailable();
  return v as Record<string, unknown>;
}
function positive(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > 2147483647)
    return unavailable();
  return v;
}
/** Explicit provider selection; no DATABASE_URL, cookie, JWT mint or connection on import. */
export function configuredAtmEvidence(
  environment: Readonly<Record<string, string | undefined>>,
  now: number,
): Configuration {
  if (environment.NEXTERA_ATM_EVIDENCE_V1 !== '1') return unavailable();
  try {
    const v = exact(JSON.parse(environment.NEXTERA_ATM_EVIDENCE_CONFIGURATION ?? ''), [
      'version',
      'expiresAt',
      'timeoutMs',
      'maxRequestBytes',
      'limits',
      'workers',
    ]);
    if (
      v.version !== 1 ||
      typeof v.expiresAt !== 'number' ||
      !Number.isSafeInteger(v.expiresAt) ||
      v.expiresAt <= now ||
      !Array.isArray(v.workers) ||
      !v.workers.length
    )
      return unavailable();
    const workers = new Map<string, string>();
    for (const item of v.workers) {
      const w = exact(item, ['workerId', 'connectionEnv']);
      if (
        typeof w.workerId !== 'string' ||
        !UUID.test(w.workerId) ||
        workers.has(w.workerId) ||
        typeof w.connectionEnv !== 'string' ||
        !/^NEXTERA_ATM_EVIDENCE_DB_[A-Z0-9_]+$/.test(w.connectionEnv)
      )
        return unavailable();
      const dsn = environment[w.connectionEnv];
      if (!dsn) return unavailable();
      const u = new URL(dsn);
      if (
        !['postgres:', 'postgresql:'].includes(u.protocol) ||
        !u.username ||
        !u.pathname ||
        u.pathname === '/'
      )
        return unavailable();
      workers.set(w.workerId, dsn);
    }
    return Object.freeze({
      expiresAt: v.expiresAt,
      timeoutMs: positive(v.timeoutMs),
      maxRequestBytes: positive(v.maxRequestBytes),
      limits: captureAtmLimits(v.limits),
      workers,
    });
  } catch {
    return unavailable();
  }
}
async function readBoundedBody(
  request: Request,
  maximum: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (!request.body || request.signal.aborted) return unavailable();
  const length = request.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > maximum))
    return unavailable();
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  let count = 0,
    done = false;
  try {
    while (true) {
      if (request.signal.aborted || signal.aborted) return unavailable();
      const next = await reader.read();
      if (next.done) {
        done = true;
        break;
      }
      count += next.value.byteLength;
      if (count > maximum) return unavailable();
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const raw = text.endsWith('\n') ? text.slice(0, -1) : text;
    const value = JSON.parse(raw);
    // All wire strings are fixed ASCII metadata/base64. Compact Go JSON is accepted;
    // duplicates, alternate noncanonical numeric/string spellings and extra frames fail.
    if (JSON.stringify(value) !== raw) return unavailable();
    return value;
  } finally {
    signal.removeEventListener('abort', abort);
    if (!done) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** No public/learner artifact reader. Each call proves the native current claim again. */
export async function handleAtmEvidenceRequest(
  request: Request,
  operation: Operation,
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: Readonly<{ open?: AtmEvidenceOpener; now?: () => number }> = {},
): Promise<Response> {
  const now = dependencies.now ?? Date.now;
  let connection: AtmEvidenceConnection | undefined,
    sent = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  let operationId: string | undefined;
  const controller = new AbortController();
  let rejectBudget: (() => void) | undefined;
  const externalAbort = () => {
    controller.abort();
    rejectBudget?.();
  };
  try {
    if (
      request.method !== 'POST' ||
      request.headers.has('cookie') ||
      request.headers.has('origin') ||
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')
    )
      return unavailable();
    const auth = request.headers.get('authorization');
    if (!auth || !/^Bearer [0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(auth))
      return unavailable();
    const token = auth.slice(7),
      configuration = configuredAtmEvidence(environment, now());
    const admitted = now();
    const budget = new Promise<never>((_, reject) => {
      rejectBudget = () => reject(new AtmEvidenceError('unavailable'));
      timer = setTimeout(
        () => {
          controller.abort();
          rejectBudget!();
        },
        Math.min(configuration.timeoutMs, configuration.expiresAt - admitted),
      );
    });
    request.signal.addEventListener('abort', externalAbort, { once: true });
    const body = await Promise.race([
      readBoundedBody(request, configuration.maxRequestBytes, controller.signal),
      budget,
    ]);
    const input =
      operation === 'resolve'
        ? captureAtmResolve(body)
        : operation === 'retain'
          ? captureAtmRetain(body, configuration.limits)
          : captureAtmReconcile(body);
    const workerId = 'context' in input ? input.context.workerId : input.workerId;
    if ('operationId' in input) operationId = input.operationId;
    const dsn = configuration.workers.get(workerId);
    if (!dsn || now() < admitted || now() >= configuration.expiresAt || request.signal.aborted)
      return unavailable();
    connection = dependencies.open
      ? dependencies.open(dsn)
      : openAtmEvidencePostgres(dsn, configuration.timeoutMs);
    const client: AtmEvidenceClient = {
      unsafe(query, values) {
        sent = true;
        return connection!.client.unsafe(query, values);
      },
    };
    const store = createPostgresAtmEvidenceStore(client, configuration.limits);
    const secondsLeft = Math.min(
      configuration.timeoutMs - (now() - admitted),
      configuration.expiresAt - now(),
    );
    if (secondsLeft <= 0) return unavailable();
    const pending =
      operation === 'resolve'
        ? store.resolve(input, token)
        : operation === 'retain'
          ? store.retain(input, token)
          : store.reconcile(input, token);
    const result = await Promise.race([pending, budget]);
    if (
      now() < admitted ||
      now() >= configuration.expiresAt ||
      now() - admitted >= configuration.timeoutMs ||
      request.signal.aborted
    )
      return unavailable();
    return Response.json(result, { headers: HEADERS });
  } catch {
    // No raw request, token, DSN, private bytes or SQL/provider error reaches the response/log.
    return Response.json(
      operation === 'retain' && sent
        ? { error: 'ATM_EVIDENCE_UNRESOLVED', outcome: 'unknown', operationId }
        : { error: 'ATM_EVIDENCE_UNAVAILABLE' },
      { status: 503, headers: HEADERS },
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    request.signal.removeEventListener('abort', externalAbort);
    controller.abort();
    // A timed-out database call can have an unknown outcome. Start pool shutdown,
    // retain the original envelope at the caller, and require explicit reconciliation.
    if (connection) {
      try {
        void connection.close().catch(() => {});
      } catch {
        /* No raw close/provider diagnostics. */
      }
    }
  }
}
