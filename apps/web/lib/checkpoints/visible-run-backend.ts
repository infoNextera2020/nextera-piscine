import { isRequestId } from '@nextera/domain';
import { sameEditorScope } from './editor-contract';
import {
  EditorApiError,
  type CheckpointRunBackend,
  type EditorActor,
  type EditorServerContext,
  type EditorTaskIdentity,
  type EditorSourceWrite,
  type RunServerContext,
  type VisibleRunRecord,
} from './editor-http';
import {
  exactRunBytes,
  parseVisibleExampleManifest,
  parseVisibleRunPolicy,
  runIntentDigest,
  runSourceDigest,
  visibleManifestDigest,
  visiblePolicyDigest,
  type VisibleExampleManifest,
  type VisibleRunIntent,
  type VisibleRunPolicy,
} from './visible-run-spec';

export type RunAuthority = Readonly<{
  editor: EditorServerContext;
  manifest: unknown;
  manifestDigest: string;
  policy: unknown;
}>;
export interface VisibleRunAuthority {
  /** Only authored public data bound to this exact frozen exam definition; never private grading packs. */
  load(actor: EditorActor, task: EditorTaskIdentity): Promise<RunAuthority>;
}
export type ReservedVisibleRun = Readonly<{ intent: VisibleRunIntent; record: VisibleRunRecord }>;
/** Implementation still required. No production memory store or graded quota fallback.
 * reserve must atomically recheck current access/attempt/definition, enabled policy and manifest,
 * trusted clock before deadline, learner/attempt concurrency and learner rate-window allowances.
 * The request binds every intent field. Identical retries reconcile without charging twice;
 * conflicting reuse fails. Commit the immutable source plus a dedicated dispatch/outbox atomically.
 * A lease/reaper must not release capacity until execution is proven stopped; retries cannot run twice.
 * read reauthorizes every call; neither operation writes graded submissions/jobs/progress.
 */
export interface VisibleRunReservations {
  reserve(
    input: Readonly<{
      actor: EditorActor;
      intent: VisibleRunIntent;
      intentDigest: string;
      manifest: VisibleExampleManifest;
      policy: VisibleRunPolicy;
    }>,
  ): Promise<ReservedVisibleRun>;
  read(
    actor: EditorActor,
    scope: EditorServerContext['scope'],
    lookup: Readonly<{ runId: string } | { requestId: string }>,
  ): Promise<ReservedVisibleRun | null>;
}
function unavailable(): never {
  throw new EditorApiError('UNAVAILABLE');
}
function sameLimits(
  a: RunServerContext['policy']['limits'],
  b: RunServerContext['policy']['limits'],
) {
  return (
    [
      'timeoutMs',
      'memoryMb',
      'outputBytes',
      'sourceBytes',
      'requestsPerWindow',
      'windowMs',
      'concurrency',
    ] as const
  ).every((key) => a?.[key] === b[key]);
}
/** Prepared factory only. No executor is invoked and production wiring remains null. */
export function createVisibleRunBackend(deps: {
  authority: VisibleRunAuthority;
  reservations: VisibleRunReservations;
}): CheckpointRunBackend {
  async function load(actor: EditorActor, task: EditorTaskIdentity) {
    if (
      !isRequestId(actor.id) ||
      !isRequestId(actor.authUserId) ||
      !isRequestId(task.attemptId) ||
      !/^[a-z0-9-]{1,100}$/.test(task.taskKey)
    )
      throw new EditorApiError('FORBIDDEN');
    const raw = await deps.authority.load(actor, task),
      c = raw.editor;
    if (
      !c ||
      c.scope.learnerId !== actor.id ||
      c.scope.attemptId !== task.attemptId ||
      c.scope.taskKey !== task.taskKey ||
      !isRequestId(c.scope.cohortId) ||
      !/^[0-9a-f]{64}$/.test(c.scope.definitionDigest) ||
      c.readAllowed !== true
    )
      throw new EditorApiError('FORBIDDEN');
    const manifest = parseVisibleExampleManifest(raw.manifest),
      policy = parseVisibleRunPolicy(raw.policy);
    if (
      manifest.taskKey !== c.scope.taskKey ||
      manifest.definitionDigest !== c.scope.definitionDigest ||
      manifest.filename !== c.filename ||
      visibleManifestDigest(manifest) !== raw.manifestDigest ||
      manifest.examples.length > policy.maxExamples ||
      !Number.isSafeInteger(c.sourceBytes) ||
      c.sourceBytes < policy.limits.sourceBytes ||
      c.sourceBytes > 262144
    )
      unavailable();
    if (
      !Number.isFinite(Date.parse(c.serverNow)) ||
      !Number.isFinite(Date.parse(c.deadline)) ||
      !['active', 'closed'].includes(c.status)
    )
      unavailable();
    // Fresh deeply frozen copies, never mutable authority objects supplied by a request.
    const context: RunServerContext = Object.freeze({
      scope: Object.freeze({
        learnerId: c.scope.learnerId,
        cohortId: c.scope.cohortId,
        attemptId: c.scope.attemptId,
        taskKey: c.scope.taskKey,
        definitionDigest: c.scope.definitionDigest,
      }),
      readAllowed: true,
      status: c.status,
      serverNow: c.serverNow,
      deadline: c.deadline,
      sourceBytes: c.sourceBytes,
      filename: c.filename,
      visibleExamplesDigest: raw.manifestDigest,
      policy: Object.freeze({
        visibility: 'visible_examples',
        graded: false,
        consumesGradedAttempts: false,
        limits: policy.limits,
      }),
    });
    return { context, manifest, policy };
  }
  function project(
    value: ReservedVisibleRun,
    c: RunServerContext,
    expected?: VisibleRunIntent,
  ): VisibleRunRecord {
    const i = value?.intent,
      r = value?.record;
    if (
      !i ||
      !r ||
      !sameEditorScope(i.scope, c.scope) ||
      !isRequestId(i.requestId) ||
      i.filename !== c.filename ||
      !/^[0-9a-f]{64}$/.test(i.policyDigest) ||
      i.manifestDigest !== c.visibleExamplesDigest ||
      i.deadline !== c.deadline
    )
      unavailable();
    if (expected && runIntentDigest(i) !== runIntentDigest(expected)) unavailable();
    const bytes = exactRunBytes(i.source, c.policy.limits.sourceBytes);
    if (
      bytes.length !== i.byteLength ||
      runSourceDigest(i.source) !== i.sourceDigest ||
      r.requestId !== i.requestId ||
      r.sourceDigest !== i.sourceDigest ||
      !isRequestId(r.id) ||
      ![
        'queued',
        'running',
        'completed',
        'compile_error',
        'runtime_error',
        'timeout',
        'output_limit',
        'system_error',
      ].includes(r.state)
    )
      unavailable();
    if (['queued', 'running'].includes(r.state) && r.output !== null) unavailable();
    const output = r.state === 'system_error' ? '' : r.output;
    if (output !== null) exactRunBytes(output, c.policy.limits.outputBytes, true);
    return Object.freeze({
      id: r.id,
      requestId: r.requestId,
      sourceDigest: r.sourceDigest,
      state: r.state,
      output,
    });
  }
  async function read(
    actor: EditorActor,
    scope: EditorServerContext['scope'],
    lookup: { runId: string } | { requestId: string },
  ) {
    const { context } = await load(actor, { attemptId: scope.attemptId, taskKey: scope.taskKey });
    if (!sameEditorScope(context.scope, scope)) throw new EditorApiError('FORBIDDEN');
    const id = 'runId' in lookup ? lookup.runId : lookup.requestId;
    if (!isRequestId(id)) unavailable();
    const value = await deps.reservations.read(actor, context.scope, lookup);
    if (!value) return null;
    const record = project(value, context);
    if (
      ('runId' in lookup && record.id !== lookup.runId) ||
      ('requestId' in lookup && record.requestId !== lookup.requestId)
    )
      unavailable();
    return record;
  }
  return {
    async context(actor, task) {
      return (await load(actor, task)).context;
    },
    read(actor, scope, runId) {
      return read(actor, scope, { runId });
    },
    readByRequest(actor, scope, requestId) {
      return read(actor, scope, { requestId });
    },
    async accept(
      input: EditorSourceWrite & {
        filename: string;
        visibleExamplesDigest: string;
        limits: RunServerContext['policy']['limits'];
      },
    ) {
      const { context, manifest, policy } = await load(input.actor, {
        attemptId: input.scope.attemptId,
        taskKey: input.scope.taskKey,
      });
      if (!sameEditorScope(context.scope, input.scope)) throw new EditorApiError('FORBIDDEN');
      if (
        context.status !== 'active' ||
        Date.parse(context.serverNow) >= Date.parse(context.deadline)
      )
        throw new EditorApiError('CLOSED');
      if (
        input.filename !== context.filename ||
        input.visibleExamplesDigest !== context.visibleExamplesDigest ||
        !sameLimits(input.limits, policy.limits) ||
        !isRequestId(input.requestId)
      )
        unavailable();
      const bytes = exactRunBytes(input.source, policy.limits.sourceBytes);
      if (input.sha256 !== runSourceDigest(input.source) || input.byteLength !== bytes.length)
        unavailable();
      const intent: VisibleRunIntent = Object.freeze({
        scope: context.scope,
        requestId: input.requestId,
        filename: manifest.filename,
        source: input.source,
        sourceDigest: input.sha256,
        byteLength: bytes.length,
        manifestDigest: context.visibleExamplesDigest,
        policyDigest: visiblePolicyDigest(policy),
        deadline: context.deadline,
      });
      const result = await deps.reservations.reserve(
        Object.freeze({
          actor: Object.freeze({ ...input.actor }),
          intent,
          intentDigest: runIntentDigest(intent),
          manifest,
          policy,
        }),
      );
      return project(result, context, intent);
    },
  };
}
