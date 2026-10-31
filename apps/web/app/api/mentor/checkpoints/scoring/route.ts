import { AccessDenied, assertRole, isRequestId } from '@nextera/domain';
import { ExamScoringReviewStorageError } from '@nextera/db/exam-scoring-review';
import { ScoredExamReviewContextError } from '@nextera/db/scored-exam-review-context';
import { createDatabase } from '@nextera/db/connection';
import { ScoredExamOutcomeError } from '@nextera/db/scored-exam-outcomes';
import {
  configuredScoredExamOutcomeService,
  ScoredExamOutcomeServiceError,
} from '../../../../../lib/checkpoints/scored-exam-outcome-service';
import type { ScoredExamReviewService } from '../../../../../lib/checkpoints/scored-exam-review-service';
import { getDatabase, requireDomainUser } from '../../../../../lib/auth/server';
import { sameOrigin } from '../../../../../lib/submissions/origin';
import {
  configuredScoredExamReviewService,
  ScoredExamReviewServiceError,
  type ScoredExamReviewBodyPolicy,
} from '../../../../../lib/checkpoints/scored-exam-review-service';
import { configuredScoredExamReviewArtifactPort } from '../../../../../lib/checkpoints/scored-exam-review-artifacts';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
function response(body: unknown, status: number) {
  return Response.json(body, { status, headers });
}
class BodyError extends Error {
  constructor(readonly status: number) {
    super('SCORING_REVIEW_BODY_UNAVAILABLE');
  }
}
function failure(error: unknown): Response {
  if (error instanceof AccessDenied)
    return response({ error: error.code }, error.code === 'UNAUTHENTICATED' ? 401 : 403);
  if (error instanceof BodyError)
    return response({ error: 'SCORING_REVIEW_BODY_INVALID' }, error.status);
  if (
    error instanceof ExamScoringReviewStorageError ||
    error instanceof ScoredExamReviewContextError ||
    error instanceof ScoredExamReviewServiceError ||
    error instanceof ScoredExamOutcomeError ||
    error instanceof ScoredExamOutcomeServiceError
  ) {
    if (error.code === 'invalid_input')
      return response({ error: 'SCORING_REVIEW_INPUT_INVALID' }, 400);
    if (error.code === 'forbidden') return response({ error: 'FORBIDDEN' }, 403);
    if (error.code === 'outcome_unknown')
      return response(
        { error: 'SCORING_WRITE_OUTCOME_UNKNOWN', retry: 'same_operation_only' },
        409,
      );
  }
  return response({ error: 'SCORING_REVIEW_UNAVAILABLE' }, 503);
}
async function readBody(request: Request, policy: ScoredExamReviewBodyPolicy): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  )
    throw new BodyError(415);
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError(400);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BodyError(408)), policy.bodyTimeoutMs);
  });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      if (request.signal.aborted) throw new BodyError(400);
      const result = await Promise.race([reader.read(), timeout]);
      if (result.done) {
        complete = true;
        break;
      }
      bytes += result.value.byteLength;
      if (bytes > policy.maxBodyBytes) throw new BodyError(413);
      chunks.push(result.value);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
    } catch {
      throw new BodyError(400);
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (!complete) void reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      /* A cancelled pending read owns the lock until settlement. */
    }
  }
}
function outcomeService(
  review: ScoredExamReviewService,
  applier: ReturnType<typeof createDatabase> | null = null,
) {
  return configuredScoredExamOutcomeService(
    {
      review,
      webClient: getDatabase().$client,
      applierClient: applier?.db.$client ?? null,
      implementationDigest: process.env.NEXTERA_SCORED_EXAM_OUTCOME_IMPLEMENTATION_DIGEST ?? '',
    },
    process.env,
  );
}
function outcomeAction(
  value: unknown,
): { action: 'adjudicate' | 'apply'; attemptId: string; operationId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value),
    b = value as Record<string, unknown>;
  if (
    keys.length !== 4 ||
    !['version', 'action', 'attemptId', 'operationId'].every((k) => keys.includes(k)) ||
    b.version !== 1 ||
    (b.action !== 'adjudicate' && b.action !== 'apply') ||
    typeof b.attemptId !== 'string' ||
    !isRequestId(b.attemptId) ||
    typeof b.operationId !== 'string' ||
    !isRequestId(b.operationId)
  )
    return null;
  return { action: b.action, attemptId: b.attemptId, operationId: b.operationId };
}
function outcomeResponse(result: { kind: string }) {
  const status =
    result.kind === 'accepted'
      ? 202
      : ['already_final', 'already_recorded'].includes(result.kind)
        ? 200
        : result.kind === 'forbidden'
          ? 403
          : result.kind === 'invalid_input'
            ? 400
            : ['unavailable', 'policy_unavailable'].includes(result.kind)
              ? 503
              : 409;
  return response(
    result.kind === 'uncertain' ? { ...result, retry: 'same_operation_only' } : result,
    status,
  );
}
export async function GET(request: Request) {
  try {
    const user = assertRole(await requireDomainUser(), ['operator', 'admin']);
    const params = new URL(request.url).searchParams;
    const attemptId = params.get('attempt') ?? '';
    const submissionId = params.get('submission');
    if (
      [...params.keys()].some((k) => !['attempt', 'submission'].includes(k)) ||
      params.getAll('attempt').length !== 1 ||
      params.getAll('submission').length > 1 ||
      !isRequestId(attemptId) ||
      (submissionId !== null && !isRequestId(submissionId))
    )
      return response({ error: 'SCORING_REVIEW_INPUT_INVALID' }, 400);
    const service = configuredScoredExamReviewService(
      () => getDatabase().$client,
      process.env,
      () => configuredScoredExamReviewArtifactPort(process.env, fetch),
    );
    if (!service) return response({ error: 'SCORING_REVIEW_UNAVAILABLE' }, 503);
    if (submissionId !== null)
      return response(
        await service.readAnswer(user.authUserId, attemptId, submissionId, request.signal),
        200,
      );
    const result = await service.read(user.authUserId, attemptId);
    if (result.context.access !== 'assigned_mentor') return response({ error: 'FORBIDDEN' }, 403);
    if (process.env.NEXTERA_SCORED_EXAM_OUTCOMES_V1 === '1') {
      const outcome = outcomeService(service);
      if (!outcome) return response({ error: 'SCORING_OUTCOME_UNAVAILABLE' }, 503);
      const loaded = await outcome.read(user.authUserId, attemptId);
      return response(
        {
          ...result,
          context: loaded.context,
          histories: loaded.histories,
          score: loaded.score,
          finalOutcomePersisted: loaded.finalOutcomePersisted,
          adjudicationPending: !loaded.state.adjudication?.current,
          adjudication: loaded.state.adjudication,
          currentOutcome: loaded.state.currentOutcome,
        },
        200,
      );
    }
    return response(result, 200);
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return response({ error: 'FORBIDDEN' }, 403);
    const user = assertRole(await requireDomainUser(), ['operator', 'admin']);
    const service = configuredScoredExamReviewService(
      () => getDatabase().$client,
      process.env,
      () => configuredScoredExamReviewArtifactPort(process.env, fetch),
    );
    if (!service) return response({ error: 'SCORING_REVIEW_UNAVAILABLE' }, 503);
    const body = await readBody(request, service.bodyPolicy);
    if (body && typeof body === 'object' && Object.hasOwn(body, 'action')) {
      const action = outcomeAction(body);
      if (!action) return response({ error: 'SCORING_REVIEW_INPUT_INVALID' }, 400);
      let outcome = outcomeService(service);
      if (!outcome) return response({ error: 'SCORING_OUTCOME_UNAVAILABLE' }, 503);
      if (request.signal.aborted) throw new BodyError(400);
      if (action.action === 'adjudicate')
        return outcomeResponse(
          await outcome.adjudicate(user.authUserId, action.attemptId, action.operationId),
        );
      const url = process.env.NEXTERA_SCORED_EXAM_OUTCOME_APPLIER_DATABASE_URL;
      if (!url) return response({ kind: 'unavailable' }, 503);
      // This explicit server configuration must name the separately restricted,
      // registered applier principal; SQL independently proves its exact authority.
      const applier = createDatabase(url);
      try {
        outcome = outcomeService(service, applier);
        if (!outcome) return response({ error: 'SCORING_OUTCOME_UNAVAILABLE' }, 503);
        return outcomeResponse(
          await outcome.apply(user.authUserId, action.attemptId, action.operationId),
        );
      } finally {
        // A close failure cannot erase an acknowledged/uncertain native write.
        await applier.close().catch(() => {});
      }
    }
    const result = await service.review(user.authUserId, body, request.signal);
    if (result.kind === 'recorded') return response(result, 202);
    const status =
      result.kind === 'forbidden'
        ? 403
        : result.kind === 'invalid_input'
          ? 400
          : result.kind === 'unavailable'
            ? 503
            : result.kind === 'stale_revision'
              ? 412
              : 409;
    return response(result, status);
  } catch (error) {
    return failure(error);
  }
}
