import {
  AccessDenied,
  assertLearnerSubmission,
  isRequestId,
  type DomainUser,
} from '@nextera/domain';
import { sameOrigin } from '../submissions/origin';
import { serializeMixedAnswer } from './checkpoint-answer';
import type { EditorActor } from './editor-http';
import type { OfficialAnswerSubmissionOutcome } from './answer-submission';
import {
  AnswerApiError,
  assertAnswerContext,
  assertAnswerDraft,
  assertAnswerWriteWindow,
  prepareAnswer,
  type AnswerDraftRecord,
  type AnswerServerContext,
  type CheckpointAnswerDraftBackend,
} from './answer-server-contract';

export type AnswerBodyPolicy = Readonly<{ maxBodyBytes: number; bodyTimeoutMs: number }>;
type Dependencies = Readonly<{ authenticate(): Promise<DomainUser> }>;
export interface OfficialAnswerSubmitPort {
  submit(actor: EditorActor, command: unknown): Promise<OfficialAnswerSubmissionOutcome>;
}
const noStore = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};
const hex = /^[0-9a-f]{64}$/,
  key = /^[a-z0-9-]{1,100}$/;
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...noStore, ...extra } });
}
class WireError extends Error {
  constructor(
    readonly code: string,
    readonly http: number,
  ) {
    super(code);
  }
}
function failure(error: unknown) {
  if (error instanceof AccessDenied)
    return json(
      { error: error.code === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' },
      error.code === 'UNAUTHENTICATED' ? 401 : 403,
    );
  if (error instanceof WireError) return json({ error: error.code }, error.http);
  if (error instanceof AnswerApiError) {
    const status =
      error.code === 'FORBIDDEN'
        ? 403
        : ['DEFINITION_MISMATCH', 'CONTRACT_MISMATCH'].includes(error.code)
          ? 412
          : error.code === 'INVALID_ANSWER'
            ? 400
            : error.code === 'RATE_LIMITED'
              ? 429
              : ['CLOSED', 'IDEMPOTENCY_CONFLICT', 'BUDGET_EXHAUSTED', 'STORAGE_LIMIT'].includes(
                    error.code,
                  )
                ? 409
                : 503;
    const retry = error.retryAfterSeconds;
    return json(
      { error: error.code },
      status,
      Number.isSafeInteger(retry) && retry! > 0 ? { 'Retry-After': String(retry) } : {},
    );
  }
  return json({ error: 'ANSWER_CAPABILITY_UNAVAILABLE' }, 503);
}
function configured(policy: AnswerBodyPolicy | null | undefined): policy is AnswerBodyPolicy {
  return (
    !!policy &&
    Number.isSafeInteger(policy.maxBodyBytes) &&
    policy.maxBodyBytes > 0 &&
    policy.maxBodyBytes <= 262144 &&
    Number.isSafeInteger(policy.bodyTimeoutMs) &&
    policy.bodyTimeoutMs > 0 &&
    policy.bodyTimeoutMs <= 2147483647
  );
}
async function actor(deps: Dependencies): Promise<EditorActor> {
  const user = await deps.authenticate();
  assertLearnerSubmission(user);
  return Object.freeze({ id: user.id, authUserId: user.authUserId });
}
function readIdentity(request: Request) {
  const q = new URL(request.url).searchParams;
  if (
    [...q.keys()].some((k) => !['attempt', 'task', 'request'].includes(k)) ||
    ['attempt', 'task', 'request'].some((k) => q.getAll(k).length > 1)
  )
    return null;
  const attemptId = q.get('attempt'),
    taskKey = q.get('task'),
    requestId = q.get('request');
  return attemptId &&
    isRequestId(attemptId) &&
    taskKey &&
    key.test(taskKey) &&
    (requestId === null || isRequestId(requestId))
    ? { task: { attemptId: attemptId.toLowerCase(), taskKey }, requestId: requestId?.toLowerCase() }
    : null;
}
function writeIdentity(request: Request) {
  if (new URL(request.url).search) return null;
  const attemptId = request.headers.get('x-attempt-id'),
    taskKey = request.headers.get('x-task-key'),
    requestId = request.headers.get('idempotency-key'),
    definitionDigest = request.headers.get('x-definition-digest'),
    answerContractDigest = request.headers.get('x-answer-contract-digest');
  return attemptId &&
    isRequestId(attemptId) &&
    taskKey &&
    key.test(taskKey) &&
    requestId &&
    isRequestId(requestId) &&
    definitionDigest &&
    hex.test(definitionDigest) &&
    answerContractDigest &&
    hex.test(answerContractDigest)
    ? {
        task: { attemptId: attemptId.toLowerCase(), taskKey },
        requestId: requestId.toLowerCase(),
        definitionDigest,
        answerContractDigest,
      }
    : null;
}
function cancelUnread(request: Request) {
  if (request.body && !request.body.locked) void request.body.cancel().catch(() => {});
}
function wireFailure(request: Request, code: string, http: number): never {
  cancelUnread(request);
  throw new WireError(code, http);
}
/** One bounded canonical JSON envelope. Timed-out cancellation never waits on a hostile stream. */
async function answerBody(request: Request, policy: AnswerBodyPolicy) {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get('content-type') ?? '',
    ) ||
    request.headers.has('content-encoding')
  )
    wireFailure(request, 'INVALID_CONTENT_TYPE', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    wireFailure(request, 'INVALID_REQUEST', 400);
  if (length !== null && Number(length) > policy.maxBodyBytes)
    wireFailure(request, 'ANSWER_TOO_LARGE', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new WireError('INVALID_ANSWER', 400);
  let rejectStop!: (error: unknown) => void;
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  const abort = () => {
    rejectStop(new WireError('REQUEST_ABORTED', 408));
    cancel();
  };
  const timer = setTimeout(() => {
    rejectStop(new WireError('BODY_TIMEOUT', 408));
    cancel();
  }, policy.bodyTimeoutMs);
  const chunks: Uint8Array[] = [];
  let size = 0,
    complete = false;
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    if (request.signal.aborted) abort();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) {
        complete = true;
        break;
      }
      if (!(value instanceof Uint8Array)) throw new WireError('INVALID_ANSWER', 400);
      size += value.byteLength;
      if (size > policy.maxBodyBytes) {
        cancel();
        throw new WireError('ANSWER_TOO_LARGE', 413);
      }
      chunks.push(Uint8Array.from(value));
    }
    if (request.signal.aborted) throw new WireError('REQUEST_ABORTED', 408);
  } finally {
    if (!complete) cancel();
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    try {
      reader.releaseLock();
    } catch {
      cancel();
    }
  }
  if (size === 0 || (length !== null && Number(length) !== size))
    throw new WireError('INVALID_ANSWER', 400);
  try {
    const bytes = Buffer.concat(chunks),
      wire = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!Buffer.from(wire, 'utf8').equals(bytes)) throw new Error('Invalid UTF8');
    const prepared = serializeMixedAnswer(JSON.parse(wire), policy.maxBodyBytes);
    if (prepared.payload !== wire) throw new Error('Noncanonical wire');
    return prepared;
  } catch {
    throw new WireError('INVALID_ANSWER', 400);
  }
}
function publicDraft(record: AnswerDraftRecord, context: AnswerServerContext) {
  const prepared = assertAnswerDraft(record, context);
  return {
    schema: 1,
    scope: context.scope,
    answerContractDigest: context.answerContract.digest,
    answer: prepared.answer,
    sha256: prepared.sha256,
    byteLength: prepared.byteLength,
    version: record.version,
    requestId: record.requestId,
  };
}
export function createCheckpointAnswerDraftHandlers(
  deps: Dependencies & {
    backend: CheckpointAnswerDraftBackend | null;
    bodyPolicy: AnswerBodyPolicy | null;
  },
) {
  return {
    async GET(request: Request) {
      try {
        const who = await actor(deps),
          identity = readIdentity(request);
        if (!identity) return json({ error: 'INVALID_REQUEST' }, 400);
        if (!deps.backend || !configured(deps.bodyPolicy)) throw new AnswerApiError('UNAVAILABLE');
        const context = await deps.backend.context(who, identity.task);
        assertAnswerContext(context, who, identity.task);
        const record = await deps.backend.read(
          who,
          context.scope,
          context.answerContract.digest,
          identity.requestId,
        );
        if (!record) return json({ error: 'ANSWER_DRAFT_NOT_FOUND' }, 404);
        if (identity.requestId && record.requestId !== identity.requestId)
          throw new AnswerApiError('UNAVAILABLE');
        return json(publicDraft(record, context));
      } catch (error) {
        return failure(error);
      }
    },
    async POST(request: Request) {
      try {
        if (!sameOrigin(request)) throw new AnswerApiError('FORBIDDEN');
        const who = await actor(deps),
          identity = writeIdentity(request),
          base = request.headers.get('x-base-version');
        if (
          !identity ||
          base === null ||
          !/^\d+$/.test(base) ||
          !Number.isSafeInteger(Number(base)) ||
          Number(base) >= Number.MAX_SAFE_INTEGER
        )
          throw new WireError('INVALID_REQUEST', 400);
        if (!deps.backend || !configured(deps.bodyPolicy)) throw new AnswerApiError('UNAVAILABLE');
        const context = await deps.backend.context(who, identity.task);
        assertAnswerContext(context, who, identity.task);
        assertAnswerWriteWindow(context);
        if (identity.definitionDigest !== context.scope.definitionDigest)
          throw new AnswerApiError('DEFINITION_MISMATCH');
        if (identity.answerContractDigest !== context.answerContract.digest)
          throw new AnswerApiError('CONTRACT_MISMATCH');
        if (context.answerContract.maxBytes > deps.bodyPolicy.maxBodyBytes)
          throw new AnswerApiError('UNAVAILABLE');
        const wire = await answerBody(request, {
          ...deps.bodyPolicy,
          maxBodyBytes: context.answerContract.maxBytes,
        });
        const prepared = prepareAnswer(wire.answer, context);
        const result = await deps.backend.save({
          ...prepared,
          actor: who,
          scope: Object.freeze({ ...context.scope }),
          answerContractDigest: context.answerContract.digest,
          requestId: identity.requestId,
          baseVersion: Number(base),
        });
        if (result.kind === 'conflict')
          return json(
            { error: 'ANSWER_DRAFT_CONFLICT', current: publicDraft(result.current, context) },
            409,
          );
        if (
          result.kind !== 'saved' ||
          result.record.requestId !== identity.requestId ||
          result.record.payload !== prepared.payload ||
          result.record.version !== Number(base) + 1
        )
          throw new AnswerApiError('UNAVAILABLE');
        return json(publicDraft(result.record, context));
      } catch (error) {
        cancelUnread(request);
        return failure(error);
      }
    },
  };
}
export function createCheckpointAnswerSubmissionHandler(
  deps: Dependencies & {
    service: OfficialAnswerSubmitPort | null;
    bodyPolicy: AnswerBodyPolicy | null;
  },
) {
  return async function POST(request: Request) {
    try {
      if (!sameOrigin(request)) throw new AnswerApiError('FORBIDDEN');
      const who = await actor(deps),
        identity = writeIdentity(request);
      if (!identity) throw new WireError('INVALID_REQUEST', 400);
      if (!deps.service || !configured(deps.bodyPolicy)) throw new AnswerApiError('UNAVAILABLE');
      const prepared = await answerBody(request, deps.bodyPolicy);
      const result = await deps.service.submit(who, {
        ...identity.task,
        requestId: identity.requestId,
        definitionDigest: identity.definitionDigest,
        answerContractDigest: identity.answerContractDigest,
        answer: prepared.answer,
      });
      if (result.kind === 'accepted') {
        if (
          !isRequestId(result.id) ||
          result.requestId !== identity.requestId ||
          typeof result.replayed !== 'boolean' ||
          result.evaluation !== 'pending'
        )
          throw new AnswerApiError('UNAVAILABLE');
        return json(
          {
            schema: 1,
            id: result.id,
            requestId: result.requestId,
            replayed: result.replayed,
            evaluation: 'pending',
          },
          result.replayed ? 200 : 202,
        );
      }
      if (result.kind === 'uncertain')
        return result.requestId === identity.requestId
          ? json({ error: 'SUBMISSION_UNCERTAIN', requestId: result.requestId }, 503)
          : failure(new AnswerApiError('UNAVAILABLE'));
      const codes = {
        invalid_input: 400,
        forbidden: 403,
        closed: 409,
        definition_mismatch: 412,
        contract_mismatch: 412,
        conflict: 409,
        rate_limited: 429,
        budget_exhausted: 409,
        unavailable: 503,
      } as const;
      if (!Object.hasOwn(codes, result.kind)) throw new AnswerApiError('UNAVAILABLE');
      const retry = result.kind === 'rate_limited' ? result.retryAfterSeconds : undefined;
      return json(
        { error: result.kind.toUpperCase() },
        codes[result.kind],
        Number.isSafeInteger(retry) && retry! > 0 ? { 'Retry-After': String(retry) } : {},
      );
    } catch (error) {
      cancelUnread(request);
      return failure(error);
    }
  };
}
