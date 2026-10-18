import {
  AccessDenied,
  assertLearnerSubmission,
  isRequestId,
  validateSubmissionFile,
} from '@nextera/domain';
import { acceptSubmission, submissionContext } from '@nextera/db/submissions';
import { getDatabase, requireDomainUser } from '../../../lib/auth/server';
import { storeSource } from '../../../lib/submissions/storage';
import { sameOrigin } from '../../../lib/submissions/origin';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    // Cookie-authenticated mutation: require same origin, never accept ambient cross-site requests.
    if (!sameOrigin(request)) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    const user = await requireDomainUser();
    assertLearnerSubmission(user);
    const cohort = request.headers.get('x-cohort-id') ?? '';
    const node = request.headers.get('x-node-key') ?? '';
    const requestId = request.headers.get('idempotency-key') ?? '';
    const filename = request.headers.get('x-filename') ?? '';
    if (!isRequestId(cohort) || !isRequestId(requestId) || !/^[a-z0-9-]{1,100}$/.test(node))
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    const ctx = await submissionContext(getDatabase(), user.authUserId, cohort, node);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: 'INVALID_ARTIFACT' }, { status: 400 });
    // Stream a raw file, so multipart parsing cannot allocate an unbounded request.
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > Math.min(262144, ctx.rules.max_size_kb * 1024)) {
          await reader.cancel();
          return Response.json({ error: 'INVALID_ARTIFACT' }, { status: 413 });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    validateSubmissionFile(filename, size, ctx.rules);
    const digest = await storeSource(user.authUserId, cohort, requestId, Buffer.concat(chunks));
    const id = await acceptSubmission(getDatabase(), {
      authId: user.authUserId,
      cohort,
      node,
      requestId,
      filename,
      size,
      digest,
    });
    console.info(
      JSON.stringify({ event: 'submission_accepted', submission_id: id, artifact_digest: digest }),
    );
    return Response.json(
      { id },
      { status: 202, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    let databaseError: { code?: unknown; message?: unknown } = {};
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
      if ('code' in current) databaseError = current;
      current = 'cause' in current ? current.cause : undefined;
    }
    const code =
      error instanceof AccessDenied
        ? error.code
        : error instanceof Error && error.message === 'INVALID_ARTIFACT'
          ? 'INVALID_ARTIFACT'
          : databaseError.code === '42501'
            ? 'FORBIDDEN'
            : databaseError.code === '22023' && databaseError.message === 'IDEMPOTENCY_CONFLICT'
              ? 'IDEMPOTENCY_CONFLICT'
              : databaseError.code === '22023'
                ? 'INVALID_ARTIFACT'
                : 'SUBMISSION_UNAVAILABLE';
    return Response.json(
      { error: code },
      {
        status:
          code === 'UNAUTHENTICATED'
            ? 401
            : ['FORBIDDEN', 'NOT_PROVISIONED', 'INACTIVE'].includes(code)
              ? 403
              : code === 'IDEMPOTENCY_CONFLICT'
                ? 409
                : code === 'INVALID_ARTIFACT'
                  ? 400
                  : 503,
      },
    );
  }
}
