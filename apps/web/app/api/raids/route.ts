import {
  AccessDenied,
  assertRaidRoster,
  isRequestId,
  RAID_REVIEW_DECISIONS,
} from '@nextera/domain';
import { assignRaidTeam, readRaid, reviewRaid } from '@nextera/db/raids';
import { getDatabase, requireDomainUser } from '../../../lib/auth/server';
import { sameOrigin } from '../../../lib/submissions/origin';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) {
  let current: unknown = error;
  let code: unknown;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    if ('code' in current) code = current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  const status =
    error instanceof AccessDenied
      ? error.code === 'UNAUTHENTICATED'
        ? 401
        : 403
      : code === '42501'
        ? 403
        : code === '22023' || code === '23505'
          ? 409
          : 503;
  return Response.json(
    {
      error:
        status === 401
          ? 'UNAUTHENTICATED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 409
              ? 'CONFLICT'
              : 'RAID_UNAVAILABLE',
    },
    { status, headers },
  );
}
export async function GET(request: Request) {
  try {
    const user = await requireDomainUser();
    const q = new URL(request.url).searchParams;
    const cohort = q.get('cohort') ?? '',
      node = q.get('node') ?? '',
      team = q.get('team');
    if (
      !isRequestId(cohort) ||
      !/^[a-z0-9-]{1,100}$/.test(node) ||
      (team !== null && !isRequestId(team))
    )
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
    return Response.json(
      await readRaid(getDatabase(), user.authUserId, cohort, node, team ?? undefined),
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers });
    const user = await requireDomainUser();
    // Bound JSON before parsing, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8192) {
          await reader.cancel();
          return Response.json({ error: 'INVALID_REQUEST' }, { status: 413, headers });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
    }
    if (!body || typeof body !== 'object' || !isRequestId(String(body.requestId ?? '')))
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
    if (body.action === 'review') {
      if (!['operator', 'admin'].includes(user.role))
        return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers });
      if (
        typeof body.attempt !== 'string' ||
        !isRequestId(body.attempt) ||
        !RAID_REVIEW_DECISIONS.includes(body.decision as 'approved' | 'changes_requested') ||
        typeof body.feedback !== 'string' ||
        !body.feedback.trim() ||
        body.feedback.length > 2000
      )
        return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
      const result = await reviewRaid(getDatabase(), user.authUserId, {
        attempt: body.attempt,
        requestId: String(body.requestId),
        decision: body.decision as 'approved' | 'changes_requested',
        feedback: body.feedback,
      });
      return Response.json(result, {
        status: result.status === 'owner_decision_required' ? 409 : 200,
        headers,
      });
    }
    if (body.action === 'assign') {
      if (user.role !== 'admin')
        return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers });
      if (
        typeof body.cohort !== 'string' ||
        !isRequestId(body.cohort) ||
        typeof body.node !== 'string' ||
        !/^[a-z0-9-]{1,100}$/.test(body.node) ||
        typeof body.mentor !== 'string' ||
        !isRequestId(body.mentor) ||
        typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.length > 100 ||
        !Array.isArray(body.members) ||
        body.members.some((id) => typeof id !== 'string' || !isRequestId(id))
      )
        return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
      try {
        assertRaidRoster(body.members as string[]);
      } catch {
        return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
      }
      const id = await assignRaidTeam(getDatabase(), user.authUserId, {
        cohort: body.cohort,
        node: body.node,
        requestId: String(body.requestId),
        name: body.name,
        mentor: body.mentor,
        members: body.members as string[],
      });
      return Response.json({ id }, { status: 201, headers });
    }
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
  } catch (error) {
    return failure(error);
  }
}
