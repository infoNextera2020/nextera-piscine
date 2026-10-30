import { sameOrigin } from '../submissions/origin';
import type { Outcome } from './activation';
import { BodyRejected, jsonBody } from './http';

export type InvitationInspectionHttpSettings = Readonly<{
  enabled: boolean;
  allowedOrigins: readonly string[];
  maxBodyBytes: number;
  bodyTimeoutMs: number;
  /** Resolve from configured trusted transport; forwarded headers are not identity. */
  callerKey(request: Request): Promise<string | null>;
  ingress: { consume(callerKey: string): Promise<boolean> } | null;
  inspection: { inspect(token: unknown, callerKey: string): Promise<Outcome> } | null;
}>;
const statuses = {
  valid: 200,
  invalid: 404,
  expired: 410,
  used: 409,
  existing: 409,
  unavailable: 503,
  rate_limited: 429,
  forbidden: 403,
  invalid_input: 422,
} as const;
type InspectionStatus = keyof typeof statuses;
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
function reply(
  status: InspectionStatus,
  http: number = statuses[status],
  identity?: { email: string; displayName: string },
) {
  return Response.json(status === 'valid' ? { status, ...identity } : { status }, {
    status: http,
    headers: {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });
}
function validOrigin(value: string) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}
/** Source seam only: does not construct an identity, client, policy, session or account. */
export function createInvitationInspectionHandler(
  settings: InvitationInspectionHttpSettings | null,
) {
  const p = settings;
  const origins = Array.isArray(p?.allowedOrigins) ? [...p.allowedOrigins] : [];
  const configured = !!(
    p?.enabled &&
    p.inspection &&
    p.ingress &&
    typeof p.callerKey === 'function' &&
    origins.length &&
    origins.every(validOrigin) &&
    // Same allocation ceiling as activation; not an invitation/rate policy default.
    p.maxBodyBytes <= 1_048_576 &&
    [p.maxBodyBytes, p.bodyTimeoutMs].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647,
    )
  );
  return async function POST(request: Request) {
    if (!configured) return reply('unavailable');
    if (request.method !== 'POST') return reply('invalid_input', 405);
    if (
      new URL(request.url).search ||
      !sameOrigin(request) ||
      !origins.includes(request.headers.get('origin')!)
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
      // The service separately applies its token-aware inspect budget and eligibility checks.
      if (!(await p!.ingress!.consume(caller))) return reply('rate_limited');
      const input = await jsonBody(request, p!.maxBodyBytes, p!.bodyTimeoutMs);
      if (!input || typeof input !== 'object' || Array.isArray(input))
        return reply('invalid_input');
      const form = input as Record<string, unknown>;
      if (
        Object.keys(form).join(',') !== 'token' ||
        typeof form.token !== 'string' ||
        !CAPABILITY.test(form.token)
      )
        return reply('invalid_input');
      const outcome = await p!.inspection!.inspect(form.token, caller);
      if (!outcome || !Object.hasOwn(statuses, outcome.status)) return reply('unavailable');
      if (outcome.status === 'valid') {
        // Match the existing issuance identity bound; no new canonicalization/name policy.
        if (
          typeof outcome.email !== 'string' ||
          !outcome.email ||
          outcome.email.length > 320 ||
          /\s/.test(outcome.email) ||
          [...outcome.email].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
        )
          return reply('unavailable');
        // The accepted ledger name is the activation name; no client override or trimming.
        if (
          typeof outcome.displayName !== 'string' ||
          !outcome.displayName.trim() ||
          outcome.displayName.length > 120 ||
          [...outcome.displayName].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
        )
          return reply('unavailable');
        return reply('valid', 200, { email: outcome.email, displayName: outcome.displayName });
      }
      return reply(outcome.status as InspectionStatus);
    } catch (error) {
      return error instanceof BodyRejected
        ? reply('invalid_input', error.http)
        : reply('unavailable');
    }
  };
}
