import { assertLearnerSubmission, isRequestId, validateSubmissionFile } from '@nextera/domain';
import { checkpointTaskContext, acceptCheckpointSubmission } from '@nextera/db/checkpoints';
import { getDatabase, requireDomainUser } from '../../../../lib/auth/server';
import { sameOrigin } from '../../../../lib/submissions/origin';
import { storeSource } from '../../../../lib/submissions/storage';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return new Response(null, { status: 403 });
    const user = await requireDomainUser();
    assertLearnerSubmission(user);
    const attempt = request.headers.get('x-attempt-id') ?? '';
    const task = request.headers.get('x-task-key') ?? '';
    const requestId = request.headers.get('idempotency-key') ?? '';
    const filename = request.headers.get('x-filename') ?? '';
    if (!isRequestId(attempt) || !isRequestId(requestId) || !/^[a-z0-9-]{1,100}$/.test(task))
      return new Response(null, { status: 400 });
    const ctx = await checkpointTaskContext(getDatabase(), user.authUserId, attempt, task);
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > Math.min(262144, ctx.rules.max_size_kb * 1024)) {
          await reader.cancel();
          return new Response(null, { status: 413 });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    validateSubmissionFile(filename, size, { ...ctx.rules, allowed_extensions: ['.go'] });
    const hash = await storeSource(
      user.authUserId,
      ctx.cohort_id,
      requestId,
      Buffer.concat(chunks),
    );
    const id = await acceptCheckpointSubmission(
      getDatabase(),
      user.authUserId,
      attempt,
      task,
      requestId,
      filename,
      size,
      hash,
    );
    return Response.json(
      { id },
      { status: 202, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return Response.json({ error: 'CHECKPOINT_SUBMISSION_UNAVAILABLE' }, { status: 409 });
  }
}
