import { sameOrigin } from '../submissions/origin';
import { BodyRejected, jsonBody } from './http';
import type { IssueOutcome } from './issuance';

export type IssuanceHttpSettings = Readonly<{
  enabled: boolean;
  allowedOrigins: readonly string[];
  maxBodyBytes: number;
  bodyTimeoutMs: number;
  /** Required trusted ingress limiter; no forwarded-header inference or rate default. */
  ingress: { consume(request: Request): Promise<boolean> } | null;
  issuer: { issue(input: unknown): Promise<IssueOutcome> } | null;
}>;
const statuses: Record<IssueOutcome['status'], number> = {
  issued: 201,
  unavailable: 503,
  forbidden: 403,
  invalid_input: 422,
  rate_limited: 429,
  already_issued: 409,
  conflict: 409,
  uncertain: 503,
};
function reply(outcome: IssueOutcome, status = statuses[outcome.status]) {
  const body =
    outcome.status === 'issued'
      ? { status: outcome.status, link: outcome.link, expiresAt: outcome.expiresAt }
      : { status: outcome.status };
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });
}
/** No issuer, identity, clients, delivery, token or environment configuration by default. */
export function createInvitationIssuanceHandler(settings: IssuanceHttpSettings | null) {
  const origins = [...(settings?.allowedOrigins ?? [])];
  const configured = !!(
    settings?.enabled &&
    settings.issuer &&
    settings.ingress &&
    origins.length &&
    origins.every((value) => {
      try {
        const u = new URL(value);
        return u.origin === value && /^https?:$/.test(u.protocol);
      } catch {
        return false;
      }
    }) &&
    settings.maxBodyBytes <= 1_048_576 &&
    [settings.maxBodyBytes, settings.bodyTimeoutMs].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647,
    )
  );
  return async function POST(request: Request) {
    if (!configured) return reply({ status: 'unavailable' });
    if (request.method !== 'POST') return reply({ status: 'invalid_input' }, 405);
    if (
      new URL(request.url).search ||
      !sameOrigin(request) ||
      !origins.includes(request.headers.get('origin')!)
    )
      return reply({ status: 'forbidden' });
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get('content-type') ?? '',
      ) ||
      request.headers.has('content-encoding')
    )
      return reply({ status: 'invalid_input' }, 415);
    try {
      if (!(await settings!.ingress!.consume(request))) return reply({ status: 'rate_limited' });
      const input = await jsonBody(request, settings!.maxBodyBytes, settings!.bodyTimeoutMs);
      const outcome = await settings!.issuer!.issue(input);
      if (!outcome || !Object.hasOwn(statuses, outcome.status))
        return reply({ status: 'unavailable' });
      return reply(outcome);
    } catch (error) {
      return error instanceof BodyRejected
        ? reply({ status: 'invalid_input' }, error.http)
        : reply({ status: 'unavailable' });
    }
  };
}
