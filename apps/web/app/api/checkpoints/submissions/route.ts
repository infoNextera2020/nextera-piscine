import { createHash } from 'node:crypto';
import {
  assertLearnerSubmission,
  checkpointExamMarker,
  isRequestId,
  validateSubmissionFile,
  type DomainUser,
} from '@nextera/domain';
import {
  checkpointTaskContext,
  acceptCheckpointSubmission,
  createScoredExamIntakeClient,
} from '@nextera/db/checkpoints';
import {
  readScoredExamIntakeContext,
  type ScoredExamTaskKey,
} from '@nextera/db/scored-exam-intake';
import { getDatabase, requireDomainUser } from '../../../../lib/auth/server';
import { sameOrigin } from '../../../../lib/submissions/origin';
import { storeSource } from '../../../../lib/submissions/storage';
import { checkpointAnswerHttpPolicy } from '../../../../lib/checkpoints/answer-http-policy';
import { createScoredExamCodeUploadClient } from '@nextera/db/scored-exam-code-upload';
import {
  submitScoredExamCode,
  ScoredExamCodeUploadError,
} from '../../../../lib/checkpoints/scored-exam-code-upload';
export const runtime = 'nodejs';
const noStore = { 'Cache-Control': 'private, no-store' };
async function scoredSubmission(
  request: Request,
  db: ReturnType<typeof getDatabase>,
  user: DomainUser,
  ctx: Awaited<ReturnType<typeof checkpointTaskContext>>,
  attempt: string,
  task: string,
  requestId: string,
  filename: string,
) {
  if (
    !/^q[1-5]$/.test(task) ||
    ctx.answerFormat?.kind !== 'coding' ||
    ctx.submission?.authority !== 'scored_exam_intake_v1'
  )
    return Response.json(
      { error: 'SCORED_EXAM_CAPABILITY_UNAVAILABLE' },
      { status: 503, headers: noStore },
    );
  const client = createScoredExamIntakeClient(db);
  const current = await readScoredExamIntakeContext(
    client,
    user.authUserId,
    attempt,
    task as ScoredExamTaskKey,
  );
  if (
    current.learnerId !== user.id ||
    ctx.user_id !== user.id ||
    current.cohortId !== ctx.cohort_id ||
    current.filename !== filename ||
    current.filename !== ctx.rules.required_files[0]
  )
    return Response.json(
      { error: 'SCORED_EXAM_IDENTITY_MISMATCH' },
      { status: 403, headers: noStore },
    );
  if (current.status !== 'open' || Date.parse(current.serverNow) >= Date.parse(current.deadline))
    return Response.json({ error: 'SCORED_EXAM_CLOSED' }, { status: 409, headers: noStore });
  // canSubmit is a NEW-intake hint, not permission to suppress exact receipt replay.
  // Native intake transactions decide allowance/rate/idempotency; no legacy quota is inherited.
  const bodyPolicy = checkpointAnswerHttpPolicy(process.env.CHECKPOINT_ANSWER_HTTP_POLICY_V1);
  if (!bodyPolicy || bodyPolicy.maxBodyBytes < current.maxCodeBytes)
    return Response.json(
      { error: 'SCORED_EXAM_HTTP_POLICY_UNAVAILABLE' },
      { status: 503, headers: noStore },
    );
  const maximum = Math.min(
    262144,
    current.maxCodeBytes,
    ctx.rules.max_size_kb * 1024,
    bodyPolicy.maxBodyBytes,
  );
  const length = request.headers.get('content-length');
  if (request.headers.has('content-encoding')) return new Response(null, { status: 415 });
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    return new Response(null, { status: 400 });
  if (length !== null && Number(length) > maximum) return new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  const abort = () => {
    cancel();
    rejectAbort(new Error('REQUEST_ABORTED'));
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    cancel();
    rejectAbort(new Error('BODY_TIMEOUT'));
  }, bodyPolicy.bodyTimeoutMs);
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    if (request.signal.aborted) return new Response(null, { status: 408 });
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(Uint8Array.from(value));
    }
  } catch (error) {
    if (timedOut || request.signal.aborted) return new Response(null, { status: 408 });
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    if (request.signal.aborted) cancel();
    try {
      reader.releaseLock();
    } catch {
      cancel();
    }
  }
  if (timedOut || request.signal.aborted) return new Response(null, { status: 408 });
  if (length !== null && Number(length) !== size) return new Response(null, { status: 400 });
  validateSubmissionFile(filename, size, { ...ctx.rules, allowed_extensions: ['.go'] });
  const source = Buffer.concat(chunks);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source);
  } catch {
    return new Response(null, { status: 400, headers: noStore });
  }
  if (!Buffer.from(text, 'utf8').equals(source)) return new Response(null, { status: 400 });
  const expectedHash = createHash('sha256').update(source).digest('hex');
  if (request.signal.aborted) return new Response(null, { status: 408, headers: noStore });
  const outcome = await submitScoredExamCode(
    createScoredExamCodeUploadClient(db),
    {
      authUserId: user.authUserId,
      learnerId: current.learnerId,
      cohortId: current.cohortId,
      attemptId: attempt,
      taskKey: task as ScoredExamTaskKey,
      definitionDigest: current.definitionDigest,
      snapshotDigest: current.snapshotDigest,
      requestId,
      filename,
      byteLength: size,
      answerSha256: expectedHash,
    },
    source,
    request.signal,
  );
  if (outcome.kind === 'accepted')
    return Response.json({ id: outcome.submissionId }, { status: 202, headers: noStore });
  const statuses = {
    forbidden: 403,
    invalid_input: 400,
    unavailable: 503,
    resource_unavailable: 503,
    closed: 409,
    conflict: 409,
    allowance_exhausted: 409,
    rate_limited: 429,
  } as const;
  return Response.json(
    { error: 'SCORED_EXAM_' + outcome.kind.toUpperCase() },
    { status: statuses[outcome.kind], headers: noStore },
  );
}
export async function POST(request: Request) {
  let marked = false;
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
    const db = getDatabase();
    const ctx = await checkpointTaskContext(db, user.authUserId, attempt, task);
    let marker;
    try {
      marker = checkpointExamMarker(ctx.scoredExam);
    } catch {
      return Response.json(
        { error: 'SCORED_EXAM_CAPABILITY_UNAVAILABLE' },
        { status: 503, headers: noStore },
      );
    }
    if (marker) {
      marked = true;
      return await scoredSubmission(request, db, user, ctx, attempt, task, requestId, filename);
    }
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
      db,
      user.authUserId,
      attempt,
      task,
      requestId,
      filename,
      size,
      hash,
    );
    return Response.json({ id }, { status: 202, headers: noStore });
  } catch (error) {
    if (request.body && !request.body.locked) void request.body.cancel().catch(() => {});
    if (marked && error instanceof ScoredExamCodeUploadError && error.code === 'outcome_unknown')
      return Response.json(
        { error: 'SUBMISSION_UNCERTAIN', requestId: request.headers.get('idempotency-key') },
        { status: 503, headers: noStore },
      );
    if (marked && error instanceof ScoredExamCodeUploadError && error.code === 'invalid_input')
      return Response.json(
        { error: 'SCORED_EXAM_INVALID_INPUT' },
        { status: 400, headers: noStore },
      );
    if (marked)
      return Response.json(
        { error: 'SCORED_EXAM_SUBMISSION_UNAVAILABLE' },
        { status: 503, headers: noStore },
      );
    return Response.json({ error: 'CHECKPOINT_SUBMISSION_UNAVAILABLE' }, { status: 409 });
  }
}
