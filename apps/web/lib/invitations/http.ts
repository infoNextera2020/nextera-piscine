import type { Outcome } from './activation';
import { sameOrigin } from '../submissions/origin';

export type InvitationHttpSettings = Readonly<{
  enabled: boolean;
  allowedOrigins: readonly string[];
  maxBodyBytes: number;
  bodyTimeoutMs: number;
  /** Resolve from a trusted, configured transport/proxy; never trust forwarded headers by default. */
  callerKey(request: Request): Promise<string | null>;
  ingress: { consume(callerKey: string): Promise<boolean> } | null;
  activation: { activate(input: unknown, callerKey: string): Promise<Outcome> } | null;
}>;
// Engineering allocation ceiling, not a selected/default activation policy.
// The caller still must configure a positive envelope bound at or below this ceiling.
const BODY_ALLOCATION_CEILING = 1_048_576;
const HTTP_STATUS: Record<Outcome['status'], number> = {
  activated: 200,
  in_progress: 202,
  invalid: 404,
  expired: 410,
  used: 409,
  existing: 409,
  unavailable: 503,
  rate_limited: 429,
  forbidden: 403,
  invalid_input: 422,
  password_rejected: 422,
  recovery_required: 503,
  valid: 503,
};
function reply(status: Outcome['status'], http = HTTP_STATUS[status]) {
  return Response.json(
    { status },
    {
      status: http,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
}
function origin(value: string) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}
class BodyRejected extends Error {
  constructor(readonly http: number) {
    super('Request body rejected.');
  }
}
async function jsonBody(request: Request, maxBytes: number, timeoutMs: number) {
  const length = request.headers.get('content-length');
  if (
    length !== null &&
    (!/^[0-9]+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maxBytes)
  )
    throw new BodyRejected(413);
  if (!request.body) throw new BodyRejected(400);
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) throw new BodyRejected(413);
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw new BodyRejected(400);
    }
  };
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BodyRejected(408)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // Do not wait for an untrusted stream's cancellation acknowledgement.
    try {
      void reader.cancel().catch(() => undefined);
    } finally {
      // Cancellation acknowledgements can fail/stall; release this consumer's lock regardless.
      reader.releaseLock();
    }
  }
}
/** No policy, identity, SQL client or network operation is created on import or construction. */
export function createInvitationActivationHandler(settings: InvitationHttpSettings | null) {
  const p = settings;
  const configured = !!(
    p?.enabled &&
    p.activation &&
    p.ingress &&
    typeof p.callerKey === 'function' &&
    Array.isArray(p.allowedOrigins) &&
    p.allowedOrigins.length &&
    p.allowedOrigins.every(origin) &&
    p.maxBodyBytes <= BODY_ALLOCATION_CEILING &&
    [p.maxBodyBytes, p.bodyTimeoutMs].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647,
    )
  );
  return async function POST(request: Request) {
    if (!configured) return reply('unavailable');
    if (request.method !== 'POST') return reply('invalid_input', 405);
    // Never accept credentials in a query string, even if the JSON body is otherwise valid.
    if (
      new URL(request.url).search ||
      !sameOrigin(request) ||
      !p!.allowedOrigins.includes(request.headers.get('origin')!)
    )
      return reply('forbidden');
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get('content-type') ?? '',
      ) ||
      request.headers.has('content-encoding')
    )
      return reply('invalid_input', 415);
    try {
      const caller = await p!.callerKey(request);
      if (!caller || !/^[a-f0-9]{64}$/.test(caller)) return reply('unavailable');
      // Ingress budget is consumed before body/password-policy work, including malformed requests.
      if (!(await p!.ingress!.consume(caller))) return reply('rate_limited');
      const input = await jsonBody(request, p!.maxBodyBytes, p!.bodyTimeoutMs);
      const outcome = await p!.activation!.activate(input, caller);
      if (!outcome || outcome.status === 'valid' || !Object.hasOwn(HTTP_STATUS, outcome.status))
        return reply('unavailable');
      // Deliberately omit even optional email/provider fields; no tokens, cookies or session issued.
      return reply(outcome.status);
    } catch (error) {
      return error instanceof BodyRejected
        ? reply('invalid_input', error.http)
        : reply('unavailable');
    }
  };
}
