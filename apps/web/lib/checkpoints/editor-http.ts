import { createHash } from 'node:crypto';
import {
  AccessDenied,
  assertLearnerSubmission,
  isRequestId,
  type DomainUser,
} from '@nextera/domain';
import { sameOrigin } from '../submissions/origin';
import {
  sameEditorScope,
  validVisibleRunLimits,
  type EditorScope,
  type VisibleRunLimits,
} from './editor-contract';

// Existing source intake ceiling, not a new Run or retention policy default.
const SOURCE_CEILING = 262144;
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};
const digestPattern = /^[0-9a-f]{64}$/;
const taskPattern = /^[a-z0-9-]{1,100}$/;

export class EditorApiError extends Error {
  constructor(
    readonly code:
      | 'FORBIDDEN'
      | 'CLOSED'
      | 'DEFINITION_MISMATCH'
      | 'IDEMPOTENCY_CONFLICT'
      | 'RATE_LIMITED'
      | 'UNAVAILABLE',
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}
export type EditorActor = Readonly<{ id: string; authUserId: string }>;
export type EditorTaskIdentity = Readonly<{ attemptId: string; taskKey: string }>;
export type EditorServerContext = Readonly<{
  scope: EditorScope;
  readAllowed: boolean;
  status: 'active' | 'closed';
  serverNow: string;
  deadline: string;
  sourceBytes: number;
  filename: string;
}>;
export type DraftRecord = Readonly<{ source: string; version: number; requestId: string | null }>;
export type EditorSourceWrite = Readonly<{
  actor: EditorActor;
  scope: EditorScope;
  requestId: string;
  source: string;
  sha256: string;
  byteLength: number;
}>;

/** Future adapters MUST recheck access, time, version and idempotency atomically at commit. */
export interface CheckpointDraftBackend {
  context(actor: EditorActor, task: EditorTaskIdentity): Promise<EditorServerContext>;
  read(actor: EditorActor, scope: EditorScope, requestId?: string): Promise<DraftRecord | null>;
  save(
    input: EditorSourceWrite & { baseVersion: number },
  ): Promise<{ kind: 'saved'; record: DraftRecord } | { kind: 'conflict'; current: DraftRecord }>;
}
export type RunServerContext = EditorServerContext &
  Readonly<{
    visibleExamplesDigest: string;
    policy: Readonly<{
      visibility: 'visible_examples';
      graded: false;
      consumesGradedAttempts: false;
      limits: VisibleRunLimits;
    }>;
  }>;
export type VisibleRunRecord = Readonly<{
  id: string;
  requestId: string;
  sourceDigest: string;
  state:
    | 'queued'
    | 'running'
    | 'completed'
    | 'compile_error'
    | 'runtime_error'
    | 'timeout'
    | 'output_limit'
    | 'system_error';
  output: string | null;
}>;
/** Dedicated visible-example executor only; never app.submissions, judge.jobs or private test packs. */
export interface CheckpointRunBackend {
  context(actor: EditorActor, task: EditorTaskIdentity): Promise<RunServerContext>;
  read(actor: EditorActor, scope: EditorScope, runId: string): Promise<VisibleRunRecord | null>;
  readByRequest?(
    actor: EditorActor,
    scope: EditorScope,
    requestId: string,
  ): Promise<VisibleRunRecord | null>;
  accept(
    input: EditorSourceWrite & {
      filename: string;
      visibleExamplesDigest: string;
      limits: VisibleRunLimits;
    },
  ): Promise<VisibleRunRecord>;
}

type Dependencies = { authenticate(): Promise<DomainUser> };
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...headers, ...extra } });
}
function failure(error: unknown) {
  if (error instanceof AccessDenied)
    return json(
      { error: error.code === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' },
      error.code === 'UNAUTHENTICATED' ? 401 : 403,
    );
  if (error instanceof EditorApiError) {
    if (error.code === 'FORBIDDEN') return json({ error: 'FORBIDDEN' }, 403);
    if (error.code === 'DEFINITION_MISMATCH') return json({ error: 'DEFINITION_MISMATCH' }, 412);
    if (error.code === 'CLOSED' || error.code === 'IDEMPOTENCY_CONFLICT')
      return json({ error: error.code }, 409);
    if (error.code === 'RATE_LIMITED') {
      const retry = error.retryAfterSeconds;
      return json(
        { error: 'RATE_LIMITED' },
        429,
        Number.isSafeInteger(retry) && retry! > 0 ? { 'Retry-After': String(retry) } : {},
      );
    }
  }
  return json({ error: 'EDITOR_CAPABILITY_UNAVAILABLE' }, 503);
}
async function actor(deps: Dependencies) {
  const user = await deps.authenticate();
  assertLearnerSubmission(user);
  return Object.freeze({ id: user.id, authUserId: user.authUserId });
}
function taskIdentity(request: Request, mutation: boolean): EditorTaskIdentity | null {
  const query = new URL(request.url).searchParams;
  const attemptId = (
    mutation ? request.headers.get('x-attempt-id') : query.get('attempt')
  )?.toLowerCase();
  const taskKey = mutation ? request.headers.get('x-task-key') : query.get('task');
  return attemptId && isRequestId(attemptId) && taskKey && taskPattern.test(taskKey)
    ? { attemptId: attemptId.toLowerCase(), taskKey }
    : null;
}
function checkContext(context: EditorServerContext, who: EditorActor, task: EditorTaskIdentity) {
  const scope = context.scope;
  if (
    scope.learnerId !== who.id ||
    scope.attemptId !== task.attemptId ||
    scope.taskKey !== task.taskKey ||
    !isRequestId(scope.cohortId) ||
    !digestPattern.test(scope.definitionDigest)
  )
    throw new EditorApiError('FORBIDDEN');
  if (!context.readAllowed) throw new EditorApiError('FORBIDDEN');
  if (
    !Number.isSafeInteger(context.sourceBytes) ||
    context.sourceBytes <= 0 ||
    context.sourceBytes > SOURCE_CEILING
  )
    throw new EditorApiError('UNAVAILABLE');
}
function checkWriteWindow(context: EditorServerContext) {
  const now = Date.parse(context.serverNow),
    deadline = Date.parse(context.deadline);
  if (!Number.isFinite(now) || !Number.isFinite(deadline)) throw new EditorApiError('UNAVAILABLE');
  if (context.status !== 'active' || now >= deadline) throw new EditorApiError('CLOSED');
}
function checkRunContext(context: RunServerContext) {
  const p = context.policy;
  if (
    !p ||
    p.visibility !== 'visible_examples' ||
    p.graded !== false ||
    p.consumesGradedAttempts !== false ||
    !validVisibleRunLimits(p.limits) ||
    p.limits.sourceBytes > context.sourceBytes ||
    !digestPattern.test(context.visibleExamplesDigest) ||
    !/^[A-Za-z0-9_]+\.go$/.test(context.filename)
  )
    throw new EditorApiError('UNAVAILABLE');
}
function validDraft(record: DraftRecord, maxBytes: number) {
  return (
    typeof record.source === 'string' &&
    new TextEncoder().encode(record.source).byteLength <= maxBytes &&
    Number.isSafeInteger(record.version) &&
    record.version >= 0 &&
    (record.requestId === null || isRequestId(record.requestId))
  );
}
function publicDraft(record: DraftRecord, context: EditorServerContext) {
  if (!validDraft(record, context.sourceBytes)) throw new EditorApiError('UNAVAILABLE');
  return {
    source: record.source,
    version: record.version,
    requestId: record.requestId,
    definitionDigest: context.scope.definitionDigest,
  };
}
function publicRun(record: VisibleRunRecord, context: RunServerContext) {
  const states = [
    'queued',
    'running',
    'completed',
    'compile_error',
    'runtime_error',
    'timeout',
    'output_limit',
    'system_error',
  ];
  if (
    !isRequestId(record.id) ||
    !isRequestId(record.requestId) ||
    !digestPattern.test(record.sourceDigest) ||
    !states.includes(record.state) ||
    (record.output !== null &&
      (typeof record.output !== 'string' ||
        new TextEncoder().encode(record.output).byteLength > context.policy.limits.outputBytes)) ||
    (['queued', 'running'].includes(record.state) && record.output !== null)
  )
    throw new EditorApiError('UNAVAILABLE');
  // Explicit allowlist: no grading metadata, private pack references or arbitrary backend fields.
  return {
    id: record.id,
    requestId: record.requestId,
    sourceDigest: record.sourceDigest,
    state: record.state,
    output: record.output,
  };
}
async function sourceBody(request: Request, maxBytes: number, emptyAllowed: boolean) {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/octet-stream'
  )
    return { error: json({ error: 'INVALID_CONTENT_TYPE' }, 415) } as const;
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    return { error: json({ error: 'INVALID_REQUEST' }, 400) } as const;
  if (length !== null && Number(length) > maxBytes)
    return { error: json({ error: 'SOURCE_TOO_LARGE' }, 413) } as const;
  if (request.signal.aborted) {
    await request.body?.cancel();
    throw new EditorApiError('UNAVAILABLE');
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader?.cancel().catch(() => {});
  };
  request.signal.addEventListener('abort', abort, { once: true });
  if (reader)
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return { error: json({ error: 'SOURCE_TOO_LARGE' }, 413) } as const;
        }
        chunks.push(value);
      }
    } finally {
      request.signal.removeEventListener('abort', abort);
      reader.releaseLock();
    }
  else request.signal.removeEventListener('abort', abort);
  if (request.signal.aborted) throw new EditorApiError('UNAVAILABLE');
  if ((length !== null && Number(length) !== size) || (!emptyAllowed && size === 0))
    return { error: json({ error: 'INVALID_SOURCE' }, 400) } as const;
  const bytes = Buffer.concat(chunks);
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { error: json({ error: 'INVALID_UTF8' }, 400) } as const;
  }
  if (!Buffer.from(source, 'utf8').equals(bytes))
    return { error: json({ error: 'INVALID_UTF8' }, 400) } as const;
  return {
    source,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: size,
  } as const;
}
function writeIdentity(request: Request) {
  const task = taskIdentity(request, true),
    requestId = request.headers.get('idempotency-key')?.toLowerCase(),
    definition = request.headers.get('x-definition-digest');
  return task && requestId && isRequestId(requestId) && definition && digestPattern.test(definition)
    ? { task, requestId: requestId.toLowerCase(), definition }
    : null;
}

/** An independently configured server authority, never a client/query capability flag.
 * submitAllowed must include the current task intake and remaining allowance. Every actual
 * official POST still rechecks authorization, time, immutable attempt and quota atomically.
 */
export interface CheckpointOfficialSubmitAuthority {
  context(
    actor: EditorActor,
    task: EditorTaskIdentity,
  ): Promise<EditorServerContext & { submitAllowed: boolean }>;
}

/** Read-only bootstrap: capabilities remain independent and require authoritative metadata. */
export function createCheckpointEditorHandler(
  deps: Dependencies & {
    backend: CheckpointDraftBackend | null;
    officialSubmission?: CheckpointOfficialSubmitAuthority;
  },
) {
  return async function GET(request: Request) {
    try {
      const who = await actor(deps),
        task = taskIdentity(request, false);
      if (!task) return json({ error: 'INVALID_REQUEST' }, 400);
      if (!deps.backend && !deps.officialSubmission) throw new EditorApiError('UNAVAILABLE');
      const draftContext = deps.backend ? await deps.backend.context(who, task) : null;
      const officialContext = deps.officialSubmission
        ? await deps.officialSubmission.context(who, task)
        : null;
      let context: EditorServerContext = officialContext ?? draftContext!;
      checkContext(context, who, task);
      if (officialContext && typeof officialContext.submitAllowed !== 'boolean')
        throw new EditorApiError('UNAVAILABLE');
      if (draftContext) {
        checkContext(draftContext, who, task);
        if (
          !sameEditorScope(draftContext.scope, context.scope) ||
          draftContext.filename !== context.filename ||
          draftContext.sourceBytes > context.sourceBytes ||
          draftContext.status !== context.status ||
          Date.parse(draftContext.deadline) !== Date.parse(context.deadline)
        )
          throw new EditorApiError('UNAVAILABLE');
        // The draft policy may deliberately be stricter than official intake. The shared
        // editor honors that smaller server-owned ceiling without changing Submit rules.
        context = { ...context, sourceBytes: draftContext.sourceBytes };
      }
      if (
        !Number.isFinite(Date.parse(context.serverNow)) ||
        !Number.isFinite(Date.parse(context.deadline)) ||
        !['active', 'closed'].includes(context.status) ||
        !/^[A-Za-z0-9_]+\.go$/.test(context.filename)
      )
        throw new EditorApiError('UNAVAILABLE');
      const draft = deps.backend ? await deps.backend.read(who, context.scope) : null;
      return json({
        schema: 1,
        window: {
          scope: context.scope,
          access: 'confirmed',
          attempt: context.status,
          serverNow: context.serverNow,
          deadline: context.deadline,
          capabilities: {
            draftsV1: deps.backend !== null,
            officialSubmit:
              officialContext?.submitAllowed === true &&
              context.status === 'active' &&
              Date.parse(context.serverNow) < Date.parse(context.deadline),
            visibleRun: null,
          },
        },
        filename: context.filename,
        sourceBytes: context.sourceBytes,
        draft: draft === null ? null : publicDraft(draft, context),
        offlineRecovery: null,
      });
    } catch (error) {
      return failure(error);
    }
  };
}

export function createCheckpointDraftHandlers(
  deps: Dependencies & { backend: CheckpointDraftBackend | null },
) {
  return {
    async GET(request: Request) {
      try {
        const who = await actor(deps),
          task = taskIdentity(request, false),
          requestId = new URL(request.url).searchParams.get('request')?.toLowerCase() ?? null;
        if (!task || (requestId !== null && !isRequestId(requestId)))
          return json({ error: 'INVALID_REQUEST' }, 400);
        if (!deps.backend) throw new EditorApiError('UNAVAILABLE');
        const context = await deps.backend.context(who, task);
        checkContext(context, who, task);
        const record = await deps.backend.read(who, context.scope, requestId ?? undefined);
        if (!record) return json({ error: 'DRAFT_NOT_FOUND' }, 404);
        if (requestId && record.requestId !== requestId) throw new EditorApiError('UNAVAILABLE');
        return json(publicDraft(record, context));
      } catch (error) {
        return failure(error);
      }
    },
    async POST(request: Request) {
      try {
        if (!sameOrigin(request)) return json({ error: 'FORBIDDEN' }, 403);
        const who = await actor(deps),
          identity = writeIdentity(request),
          base = request.headers.get('x-base-version');
        if (
          !identity ||
          base === null ||
          !/^\d+$/.test(base) ||
          !Number.isSafeInteger(Number(base))
        )
          return json({ error: 'INVALID_REQUEST' }, 400);
        if (!deps.backend) throw new EditorApiError('UNAVAILABLE');
        const context = await deps.backend.context(who, identity.task);
        checkContext(context, who, identity.task);
        checkWriteWindow(context);
        if (identity.definition !== context.scope.definitionDigest)
          return json({ error: 'DEFINITION_MISMATCH' }, 412);
        const body = await sourceBody(request, context.sourceBytes, true);
        if (body.error) return body.error;
        const result = await deps.backend.save({
          actor: who,
          scope: context.scope,
          requestId: identity.requestId,
          baseVersion: Number(base),
          source: body.source,
          sha256: body.sha256,
          byteLength: body.byteLength,
        });
        if (result.kind === 'conflict')
          return json(
            { error: 'DRAFT_CONFLICT', current: publicDraft(result.current, context) },
            409,
          );
        if (
          result.kind !== 'saved' ||
          result.record.requestId !== identity.requestId ||
          result.record.source !== body.source ||
          result.record.version <= Number(base)
        )
          throw new EditorApiError('UNAVAILABLE');
        return json(publicDraft(result.record, context));
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function createCheckpointRunHandlers(
  deps: Dependencies & { backend: CheckpointRunBackend | null },
) {
  return {
    async GET(request: Request) {
      try {
        const who = await actor(deps),
          task = taskIdentity(request, false),
          runId = new URL(request.url).searchParams.get('run')?.toLowerCase() ?? null,
          requestId = new URL(request.url).searchParams.get('request')?.toLowerCase() ?? null;
        if (
          !task ||
          !!runId === !!requestId ||
          (runId !== null && !isRequestId(runId)) ||
          (requestId !== null && !isRequestId(requestId))
        )
          return json({ error: 'INVALID_REQUEST' }, 400);
        if (!deps.backend) throw new EditorApiError('UNAVAILABLE');
        const context = await deps.backend.context(who, task);
        checkContext(context, who, task);
        checkRunContext(context);
        if (requestId && !deps.backend.readByRequest) throw new EditorApiError('UNAVAILABLE');
        const record = requestId
          ? await deps.backend.readByRequest!(who, context.scope, requestId)
          : await deps.backend.read(who, context.scope, runId!);
        if (!record) return json({ error: 'RUN_NOT_FOUND' }, 404);
        if ((runId && record.id !== runId) || (requestId && record.requestId !== requestId))
          throw new EditorApiError('UNAVAILABLE');
        return json(publicRun(record, context));
      } catch (error) {
        return failure(error);
      }
    },
    async POST(request: Request) {
      try {
        if (!sameOrigin(request)) return json({ error: 'FORBIDDEN' }, 403);
        const who = await actor(deps),
          identity = writeIdentity(request);
        if (!identity) return json({ error: 'INVALID_REQUEST' }, 400);
        if (!deps.backend) throw new EditorApiError('UNAVAILABLE');
        const context = await deps.backend.context(who, identity.task);
        checkContext(context, who, identity.task);
        checkWriteWindow(context);
        checkRunContext(context);
        if (identity.definition !== context.scope.definitionDigest)
          return json({ error: 'DEFINITION_MISMATCH' }, 412);
        const body = await sourceBody(request, context.policy.limits.sourceBytes, false);
        if (body.error) return body.error;
        const record = await deps.backend.accept({
          actor: who,
          scope: context.scope,
          requestId: identity.requestId,
          source: body.source,
          sha256: body.sha256,
          byteLength: body.byteLength,
          filename: context.filename,
          visibleExamplesDigest: context.visibleExamplesDigest,
          limits: context.policy.limits,
        });
        if (record.requestId !== identity.requestId || record.sourceDigest !== body.sha256)
          throw new EditorApiError('UNAVAILABLE');
        return json(publicRun(record, context), 202);
      } catch (error) {
        return failure(error);
      }
    },
  };
}
