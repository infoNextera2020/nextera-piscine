import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  prepareScoredExamPublication,
  assertScoredExamExecutionTask,
  checkpointCanonicalJson,
  scoredExamFramedDigest,
} from './scored-exam-publication';
import { EXAM_TRACE_DETAIL_APPROVAL } from './scored-exam-trace';
import {
  checkpointAnswerContractDigest,
  encodeCheckpointAnswerDraft,
} from '../queries/checkpoint-answer-drafts';
import {
  prepareScoredExamDebugFunctionalManifest,
  captureScoredExamDebugFunctionalReport,
} from '../queries/scored-exam-functional-producer';
import {
  recordExamFunctionalEvidence,
  type ExamFunctionalResult,
  type ExamScoringReviewClient,
  type ExamScoringWrite,
  type ExamScoringWriteResult,
} from '../queries/exam-scoring-review';
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const keyPattern = /^[a-z0-9-]{1,100}$/;
const ceiling = 1048576;
export class ScoredExamDebugError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable') {
    super('SCORED_EXAM_DEBUG_' + code.toUpperCase());
  }
}
const fail = (code: ScoredExamDebugError['code'] = 'unavailable'): never => {
  throw new ScoredExamDebugError(code);
};
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function object(v: unknown, names: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(v);
  if (
    Reflect.ownKeys(descriptors).length !== names.length ||
    !names.every(
      (name) => Object.hasOwn(descriptors, name) && Object.hasOwn(descriptors[name]!, 'value'),
    )
  )
    return fail();
  return Object.fromEntries(names.map((name) => [name, descriptors[name]!.value]));
}
function text(v: unknown, pattern: RegExp): string {
  if (typeof v !== 'string' || !pattern.test(v)) return fail();
  return v;
}
const hash = (v: unknown) => text(v, hashPattern);
const id = (v: unknown) => text(v, uuidPattern);
const key = (v: unknown) => text(v, keyPattern);
function integer(v: unknown, max = 2147483647): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > max) return fail();
  return v;
}
function decimal(v: unknown, allowZero = true): string {
  if (
    typeof v !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(v) ||
    BigInt(v) > 9223372036854775806n ||
    (!allowZero && v === '0')
  )
    return fail();
  return v;
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const intrinsicByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteLength',
)!.get!;
const intrinsicLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get!;
const intrinsicBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const intrinsicOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const intrinsicTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const intrinsicSet = Uint8Array.prototype.set;
/** Intrinsic bounds before any copy; no own getters, iterators or species callbacks. */
function copyBytes(v: unknown, max: number): Uint8Array {
  if (!(v instanceof Uint8Array) || intrinsicTag.call(v) !== 'Uint8Array') return fail();
  const length = intrinsicLength.call(v) as number,
    byteLength = intrinsicByteLength.call(v) as number;
  const buffer = intrinsicBuffer.call(v) as unknown,
    offset = intrinsicOffset.call(v) as number;
  if (
    length !== byteLength ||
    byteLength > max ||
    !(buffer instanceof ArrayBuffer) ||
    (resizable && resizable.call(buffer)) ||
    offset + byteLength > (bufferLength.call(buffer) as number)
  )
    return fail();
  const view = new Uint8Array(buffer, offset, length),
    captured = new Uint8Array(length);
  intrinsicSet.call(captured, view);
  return captured;
}
/** Bounded, data-only snapshot: no getters/toJSON/prototype callbacks across awaits. */
function snapshot(v: unknown, max: number): unknown {
  let budget = max,
    nodes = 0;
  const charge = (n: number) => {
    budget -= n;
    if (budget < 0) fail();
  };
  const walk = (value: unknown, depth: number): unknown => {
    if (++nodes > 8192 || depth > 16) return fail();
    charge(4);
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      charge(Buffer.byteLength(value, 'utf8'));
      if (Buffer.from(value).toString('utf8') !== value) return fail();
      return value;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))
    )
      return fail();
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(fields).length !== value.length + 1) return fail();
      return Object.freeze(
        Array.from({ length: value.length }, (_, i) => {
          const field = fields[String(i)];
          if (!field || !Object.hasOwn(field, 'value')) return fail();
          return walk(field.value, depth + 1);
        }),
      );
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const name of Reflect.ownKeys(fields)) {
      if (typeof name !== 'string' || !Object.hasOwn(fields[name]!, 'value')) return fail();
      charge(Buffer.byteLength(name, 'utf8'));
      result[name] = walk(fields[name]!.value, depth + 1);
    }
    return Object.freeze(result);
  };
  return walk(v, 0);
}
export type ScoredExamDebugLimits = Readonly<{
  maxContextBytes: number;
  maxAnswerBytes: number;
}>;
export type ScoredExamDebugPack = Readonly<{
  manifestBytes: Uint8Array;
  publicCasesBytes: Uint8Array;
  privateCasesBytes: Uint8Array;
}>;
const contextNames = [
  'version',
  'receiptId',
  'requestId',
  'attemptId',
  'learnerId',
  'authUserId',
  'cohortId',
  'curriculumVersionId',
  'nodeKey',
  'form',
  'questionKey',
  'answerKind',
  'answerContractDigest',
  'acceptedAtMicros',
  'acceptedOrdinal',
  'answerBase64',
  'answerSha256',
  'answerByteLength',
  'definitionDigest',
  'snapshotDigest',
  'publishedCriteriaDigest',
  'publication',
  'outbox',
  'expectedRevision',
] as const;

function capturedContext(value: unknown, receiptId: string, limits: ScoredExamDebugLimits) {
  const l = object(limits, ['maxContextBytes', 'maxAnswerBytes']);
  const c = object(snapshot(value, integer(l.maxContextBytes, ceiling)), contextNames);
  const maxAnswerBytes = integer(l.maxAnswerBytes, 262144);
  if (
    c.version !== 1 ||
    c.receiptId !== receiptId ||
    c.questionKey !== 'q8' ||
    c.answerKind !== 'debug_with_reason'
  )
    return fail();
  const publication = prepareScoredExamPublication(c.publication);
  const rubric = publication.scoringRubric,
    sourceBinding = publication.scoringSourceBinding;
  const q = rubric.questions[7],
    task = publication.checkpoint.tasks as unknown[];
  if (
    !q ||
    q.questionKey !== 'q8' ||
    q.kind !== 'debug_with_reason' ||
    q.functionalGroups.length !== 4 ||
    q.functionalGroups.some((g, i) => g.points !== [3, 2, 2, 2][i]) ||
    q.publishedCriteriaDigest !== c.publishedCriteriaDigest ||
    rubric.form !== c.form ||
    publication.nodeKey !== c.nodeKey ||
    publication.definitionDigest !== c.definitionDigest ||
    sourceBinding.decisions.weightsOwnerMessageId !== EXAM_TRACE_DETAIL_APPROVAL ||
    sourceBinding.decisions.traceComparatorOwnerMessageId !== EXAM_TRACE_DETAIL_APPROVAL
  )
    return fail();
  const executionTask = task[7] as Record<string, unknown>;
  assertScoredExamExecutionTask(executionTask);
  const contract = object(executionTask.answerContract, ['version', 'kind', 'maxBytes']);
  if (contract.version !== 1 || contract.kind !== 'debug_with_reason') return fail();
  const maxBytes = integer(contract.maxBytes, 262144);
  const scope = Object.freeze({
    learnerId: id(c.learnerId),
    cohortId: id(c.cohortId),
    attemptId: id(c.attemptId),
    taskKey: 'q8',
    definitionDigest: hash(c.definitionDigest),
  });
  if (
    checkpointAnswerContractDigest(scope, { version: 1, kind: 'debug_with_reason', maxBytes }) !==
    c.answerContractDigest
  )
    return fail();
  const route = object(executionTask.answerEvaluator, [
    'family',
    'version',
    'kind',
    'taskKey',
    'definitionDigest',
    'evaluatorKey',
    'evaluatorDigest',
  ]);
  if (
    route.family !== 'checkpoint_structured_answer' ||
    route.version !== 1 ||
    route.kind !== 'debug_with_reason' ||
    route.taskKey !== 'q8' ||
    route.definitionDigest !== c.definitionDigest
  )
    return fail();
  const binding = Object.freeze({
    version: 1 as const,
    receiptId: id(c.receiptId),
    requestId: id(c.requestId),
    attemptId: scope.attemptId,
    learnerId: scope.learnerId,
    authUserId: id(c.authUserId),
    cohortId: scope.cohortId,
    curriculumVersionId: id(c.curriculumVersionId),
    nodeKey: key(c.nodeKey),
    form: rubric.form,
    questionKey: 'q8' as const,
    answerKind: 'debug_with_reason' as const,
    answerSha256: hash(c.answerSha256),
    answerContractDigest: hash(c.answerContractDigest),
    acceptedAtMicros: decimal(c.acceptedAtMicros, false),
    acceptedOrdinal: decimal(c.acceptedOrdinal, false),
    definitionDigest: scope.definitionDigest,
    snapshotDigest: hash(c.snapshotDigest),
    rubricDigest: rubric.digest,
    rubricSourceBindingDigest: publication.scoringSourceBindingDigest,
    publishedCriteriaDigest: hash(c.publishedCriteriaDigest),
    evaluatorKey: key(route.evaluatorKey),
    evaluatorDigest: hash(route.evaluatorDigest),
    paperSha256: sourceBinding.paperSha256,
    manualCriteriaSha256: sourceBinding.decisions.manualCriteriaSha256,
  });
  const outbox = object(c.outbox, [
    'receiptId',
    'answerSha256',
    'snapshotDigest',
    'evaluatorKey',
    'evaluatorDigest',
    'evaluation',
  ]);
  if (
    checkpointCanonicalJson(outbox) !==
    checkpointCanonicalJson({
      receiptId,
      answerSha256: binding.answerSha256,
      snapshotDigest: binding.snapshotDigest,
      evaluatorKey: binding.evaluatorKey,
      evaluatorDigest: binding.evaluatorDigest,
      evaluation: 'pending',
    })
  )
    return fail();
  if (
    typeof c.answerBase64 !== 'string' ||
    c.answerBase64.length > Math.ceil(Math.min(maxBytes, maxAnswerBytes) / 3) * 4
  )
    return fail();
  const raw = Buffer.from(c.answerBase64, 'base64');
  if (
    raw.toString('base64') !== c.answerBase64 ||
    raw.length !== c.answerByteLength ||
    raw.length > maxBytes ||
    raw.length > maxAnswerBytes ||
    sha(raw) !== binding.answerSha256
  )
    return fail();
  const payload = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  const encoded = encodeCheckpointAnswerDraft(payload),
    answer = JSON.parse(payload) as Record<string, unknown>;
  if (
    encoded.kind !== 'debug_with_reason' ||
    encoded.sha256 !== binding.answerSha256 ||
    ['source', 'explanation', 'counterexample'].some(
      (name) => typeof answer[name] !== 'string' || !(answer[name] as string).trim(),
    )
  )
    return fail();
  const source = answer.source as string,
    sourceBytes = Buffer.from(source, 'utf8');
  const rules = object(executionTask.submissionRules, [
    'required_files',
    'allowed_extensions',
    'max_size_kb',
  ]);
  if (sourceBytes.length > integer(rules.max_size_kb) * 1024) return fail();
  const spec = executionTask.evaluationSpec as Record<string, unknown>;
  const executionContract = object(spec.execution_contract, [
    'version',
    'item_key',
    'learner_file',
    'function',
    'input_type',
    'output_type',
  ]);
  return Object.freeze({
    binding,
    publication,
    executionTask,
    source,
    sourceSha256: sha(sourceBytes),
    sourceByteLength: sourceBytes.length,
    filename: executionContract.learner_file as string,
    expectedRevision: decimal(c.expectedRevision),
  });
}

/** Pure projection, not authorization, upload, queue insertion or a learner acceptance.
 * The native reader must prove authentic immutable acceptance and current evaluator authority.
 * The private pack loader must prove real artifact provenance; hashes alone cannot do so. */
export function prepareScoredExamDebugProjection(
  value: unknown,
  pack: ScoredExamDebugPack,
  limits: ScoredExamDebugLimits,
) {
  const captured = snapshot(
    value,
    integer(object(limits, ['maxContextBytes', 'maxAnswerBytes']).maxContextBytes, ceiling),
  );
  const receipt = object(captured, contextNames).receiptId;
  const current = capturedContext(captured, id(receipt), limits);
  const packFields = object(pack, ['manifestBytes', 'publicCasesBytes', 'privateCasesBytes']);
  const prepared = prepareScoredExamDebugFunctionalManifest({
    evaluatorKey: 'official-code',
    evaluatorDigest: current.executionTask.evaluationDigest as string,
    testPackId: current.executionTask.testPackId as string,
    testPackDigest: (current.executionTask.evaluationSpec as Record<string, unknown>)
      .test_pack_digest as string,
    questionKey: 'q8',
    rubric: current.publication.scoringRubric,
    sourceBinding: current.publication.scoringSourceBinding,
    sourceBindingDigest: current.publication.scoringSourceBindingDigest,
    manifestBytes: copyBytes(packFields.manifestBytes, ceiling),
    publicCasesBytes: copyBytes(packFields.publicCasesBytes, ceiling),
    privateCasesBytes: copyBytes(packFields.privateCasesBytes, ceiling),
  });
  const request = Object.freeze({
    version: 1 as const,
    binding: current.binding,
    source: Object.freeze({
      filename: current.filename,
      utf8: current.source,
      sha256: current.sourceSha256,
      byteLength: current.sourceByteLength,
    }),
    execution: Object.freeze({
      evaluationSpec: current.executionTask.evaluationSpec,
      evaluationSpecDigest: current.executionTask.evaluationDigest as string,
      manifestBinding: prepared.binding,
      manifestBindingDigest: prepared.manifestBindingDigest,
      manifestBase64: prepared.manifestBase64,
      groups: Object.freeze(
        prepared.manifest.groups.map((g) =>
          Object.freeze({ groupKey: g.groupKey, criteriaDigest: g.criteriaDigest }),
        ),
      ),
    }),
  });
  const projection = Object.freeze({
    version: 1 as const,
    runtimeEnabled: false as const,
    request,
    projectionDigest: scoredExamFramedDigest(request, '01coding-exam-debug-projection-v1'),
  });
  return projection;
}
export type ScoredExamDebugProjection = ReturnType<typeof prepareScoredExamDebugProjection>;

/** Proposed q8 ledger ABI. Existing SQL/Storage do not implement this lane.
 * Its adapter must atomically bind a DISTINCT internal execution submission/job,
 * reuse the original learner receipt/debit, and independently verify snapshot,
 * target, owner, Storage bytes and current native authority. No role claim is proof. */
function job(value: unknown, projection: ScoredExamDebugProjection, max: number) {
  const j = object(snapshot(value, max), [
    'version',
    'projectionId',
    'internalSubmissionId',
    'jobId',
    'projectionDigest',
    'evaluationSnapshotDigest',
    'evaluationSpecDigest',
    'artifact',
  ]);
  const b = projection.request.binding,
    s = projection.request.source;
  if (
    j.version !== 1 ||
    j.projectionDigest !== projection.projectionDigest ||
    j.evaluationSpecDigest !== projection.request.execution.evaluationSpecDigest
  )
    return fail();
  const projectionId = id(j.projectionId),
    internalSubmissionId = id(j.internalSubmissionId),
    jobId = id(j.jobId);
  if (new Set([projectionId, internalSubmissionId, jobId, b.receiptId]).size !== 4) return fail();
  const artifact = object(j.artifact, ['id', 'bucket', 'key', 'filename', 'size_bytes', 'sha256']);
  // Proposed extension of the scoped namespace; current Go rejects q8 until separately implemented.
  if (
    artifact.bucket !== 'nextera-submissions' ||
    artifact.filename !== s.filename ||
    artifact.sha256 !== s.sha256 ||
    artifact.size_bytes !== s.byteLength ||
    artifact.key !==
      [b.authUserId, b.cohortId, 'scored-exam-v1', b.attemptId, 'q8', projectionId, s.sha256].join(
        '/',
      )
  )
    return fail();
  id(artifact.id);
  hash(j.evaluationSnapshotDigest);
  return j;
}

function terminal(
  value: unknown,
  boundJob: Record<string, unknown>,
  projection: ScoredExamDebugProjection,
  max: number,
) {
  const t = object(snapshot(value, max), [
    'version',
    'state',
    'projectionId',
    'internalSubmissionId',
    'jobId',
    'executionId',
    'evaluationSnapshotDigest',
    'evaluationSpecDigest',
    'resultDigest',
    'acknowledgedAtMicros',
    'report',
  ]);
  if (
    t.version !== 1 ||
    t.state !== 'persisted_terminal' ||
    [
      'projectionId',
      'internalSubmissionId',
      'jobId',
      'evaluationSnapshotDigest',
      'evaluationSpecDigest',
    ].some((k) => t[k] !== boundJob[k])
  )
    return fail();
  id(t.executionId);
  hash(t.resultDigest);
  decimal(t.acknowledgedAtMicros, false);
  const r = captureScoredExamDebugFunctionalReport(t.report),
    e = projection.request.execution,
    m = e.manifestBinding;
  if (
    r.jobId !== boundJob.jobId ||
    r.submissionId !== boundJob.internalSubmissionId ||
    r.evaluationSnapshotDigest !== boundJob.evaluationSnapshotDigest ||
    r.evaluationSpecDigest !== e.evaluationSpecDigest ||
    r.artifactSha256 !== projection.request.source.sha256 ||
    r.testPackId !== m.testPackId ||
    r.testPackDigest !== m.testPackDigest ||
    r.manifestSha256 !== m.manifestSha256 ||
    r.publicCasesSha256 !== m.publicCasesSha256 ||
    r.privateCasesSha256 !== m.privateCasesSha256 ||
    r.caseCount !== m.caseCount ||
    checkpointCanonicalJson(
      r.groups.map((g) => ({ groupKey: g.groupKey, criteriaDigest: g.criteriaDigest })),
    ) !== checkpointCanonicalJson(e.groups)
  )
    return fail();
  return Object.freeze({ binding: t, report: r });
}

export type PreparedScoredExamDebugWrite = Readonly<{
  version: 1;
  write: ExamScoringWrite;
  payload: ExamFunctionalResult;
  provenance: Readonly<{ projectionDigest: string; jobDigest: string; terminalDigest: string }>;
}>;
export type ScoredExamDebugSettings = Readonly<{
  reader: Readonly<{ read(receiptId: string): Promise<unknown> }> | null;
  packs: Readonly<{
    read(binding: ScoredExamDebugProjection['request']['binding']): Promise<ScoredExamDebugPack>;
  }> | null;
  jobs: Readonly<{
    read(projectionDigest: string): Promise<unknown>;
    terminal(jobId: string): Promise<unknown>;
  }> | null;
  publicationOutbox: Readonly<{
    store(operationId: string, bytes: Uint8Array): Promise<void>;
    read(operationId: string): Promise<Uint8Array | null>;
  }> | null;
  client: ExamScoringReviewClient | null;
  limits: Readonly<{
    operationMs: number;
    maxContextBytes: number;
    maxAnswerBytes: number;
    maxEnvelopeBytes: number;
  }> | null;
}>;
type Uncertain = Readonly<{ kind: 'uncertain'; operationId: string; retry: 'same_envelope_only' }>;
type Result = ExamScoringWriteResult | Uncertain | Readonly<{ kind: 'unavailable' }>;
function method<T extends object, K extends keyof T>(value: T, name: K): T[K] {
  const d = Object.getOwnPropertyDescriptor(value, name);
  if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'function') return fail();
  return d.value.bind(value) as T[K];
}
function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ScoredExamDebugError('unavailable')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
/** No native adapter, queue insertion, worker discovery or activation is supplied.
 * Trusted server ports must prove native scope/terminal acknowledgement; never accept
 * these DTOs from a learner. Null ports make the entire composition unavailable. */
export function createScoredExamDebugBridge(settings: ScoredExamDebugSettings | null = null) {
  const projections = new WeakSet<object>();
  type Owned = { raw: Uint8Array; pending: Promise<Result> | null; unknown: boolean };
  const owned = new WeakMap<object, Owned>();
  let p: Readonly<{
    read: NonNullable<ScoredExamDebugSettings['reader']>['read'];
    pack: NonNullable<ScoredExamDebugSettings['packs']>['read'];
    job: NonNullable<ScoredExamDebugSettings['jobs']>['read'];
    terminal: NonNullable<ScoredExamDebugSettings['jobs']>['terminal'];
    store: NonNullable<ScoredExamDebugSettings['publicationOutbox']>['store'];
    retained: NonNullable<ScoredExamDebugSettings['publicationOutbox']>['read'];
    client: ExamScoringReviewClient;
    operationMs: number;
    maxContextBytes: number;
    maxAnswerBytes: number;
    maxEnvelopeBytes: number;
  }> | null = null;
  try {
    if (
      settings?.reader &&
      settings.packs &&
      settings.jobs &&
      settings.publicationOutbox &&
      settings.client &&
      settings.limits
    ) {
      const l = object(settings.limits, [
        'operationMs',
        'maxContextBytes',
        'maxAnswerBytes',
        'maxEnvelopeBytes',
      ]);
      p = Object.freeze({
        read: method(settings.reader, 'read'),
        pack: method(settings.packs, 'read'),
        job: method(settings.jobs, 'read'),
        terminal: method(settings.jobs, 'terminal'),
        store: method(settings.publicationOutbox, 'store'),
        retained: method(settings.publicationOutbox, 'read'),
        client: Object.freeze({ unsafe: method(settings.client, 'unsafe') }),
        operationMs: integer(l.operationMs),
        maxContextBytes: integer(l.maxContextBytes, ceiling),
        maxAnswerBytes: integer(l.maxAnswerBytes, 262144),
        maxEnvelopeBytes: integer(l.maxEnvelopeBytes, ceiling),
      });
    }
  } catch {
    p = null;
  }
  function budget() {
    if (!p) return fail();
    const port = p,
      started = performance.now();
    return {
      port,
      limits: { maxContextBytes: port.maxContextBytes, maxAnswerBytes: port.maxAnswerBytes },
      run: <T>(fn: () => Promise<T>) => {
        const left = port.operationMs - (performance.now() - started);
        if (left <= 0) return fail();
        return bounded(Promise.resolve().then(fn), left);
      },
    };
  }
  async function prepareProjection(receiptId: string) {
    const { port, limits, run } = budget(),
      receipt = id(receiptId);
    try {
      const current = capturedContext(await run(() => port.read(receipt)), receipt, limits);
      const loaded = object(await run(() => port.pack(current.binding)), [
        'manifestBytes',
        'publicCasesBytes',
        'privateCasesBytes',
      ]);
      const pack = {
        manifestBytes: copyBytes(loaded.manifestBytes, ceiling),
        publicCasesBytes: copyBytes(loaded.publicCasesBytes, ceiling),
        privateCasesBytes: copyBytes(loaded.privateCasesBytes, ceiling),
      };
      const projection = prepareScoredExamDebugProjection(
        await run(() => port.read(receipt)),
        pack,
        limits,
      );
      if (
        checkpointCanonicalJson(projection.request.binding) !==
        checkpointCanonicalJson(current.binding)
      )
        return fail();
      projections.add(projection);
      return projection;
    } catch {
      return fail();
    }
  }
  async function prepareEvidence(
    projection: ScoredExamDebugProjection,
    operationId: string,
  ): Promise<PreparedScoredExamDebugWrite> {
    if (!projections.has(projection)) return fail('invalid_input');
    const { port, limits, run } = budget(),
      operation = id(operationId),
      receipt = projection.request.binding.receiptId;
    try {
      const current = capturedContext(await run(() => port.read(receipt)), receipt, limits);
      if (
        checkpointCanonicalJson(current.binding) !==
        checkpointCanonicalJson(projection.request.binding)
      )
        return fail();
      const j = job(
        await run(() => port.job(projection.projectionDigest)),
        projection,
        port.maxContextBytes,
      );
      const t = terminal(
        await run(() => port.terminal(j.jobId as string)),
        j,
        projection,
        port.maxContextBytes,
      );
      const confirmed = capturedContext(await run(() => port.read(receipt)), receipt, limits);
      if (checkpointCanonicalJson(confirmed) !== checkpointCanonicalJson(current)) return fail();
      const b = current.binding,
        provenance = Object.freeze({
          projectionDigest: projection.projectionDigest,
          jobDigest: scoredExamFramedDigest(j, '01coding-exam-debug-job-v1'),
          terminalDigest: scoredExamFramedDigest(t.binding, '01coding-exam-debug-terminal-v1'),
        });
      const payload: ExamFunctionalResult = Object.freeze({
        state: 'evaluated',
        evidence: Object.freeze({
          submissionId: receipt,
          questionKey: 'q8',
          answerSha256: b.answerSha256,
          rubricDigest: b.rubricDigest,
          publishedCriteriaDigest: b.publishedCriteriaDigest,
          kind: 'groups',
          outcomes: t.report.groups,
          evidenceDigest: scoredExamFramedDigest(
            { binding: b, provenance, report: t.report },
            '01coding-exam-debug-evidence-v1',
          ),
        }),
      });
      const prepared = Object.freeze({
        version: 1 as const,
        write: Object.freeze({
          operationId: operation,
          submissionId: receipt,
          expectedRevision: current.expectedRevision,
        }),
        payload,
        provenance,
      });
      const raw = Buffer.from(checkpointCanonicalJson(prepared));
      if (raw.length > port.maxEnvelopeBytes) return fail();
      await run(() => port.store(operation, new Uint8Array(raw)));
      if (
        !Buffer.from(
          copyBytes(await run(() => port.retained(operation)), port.maxEnvelopeBytes),
        ).equals(raw)
      )
        return fail();
      owned.set(prepared, { raw, pending: null, unknown: false });
      return prepared;
    } catch {
      return fail();
    }
  }

  const ports = p;
  async function record(prepared: PreparedScoredExamDebugWrite): Promise<Result> {
    if (!ports) return Object.freeze({ kind: 'unavailable' });
    const state = owned.get(prepared);
    if (!state) return fail('invalid_input');
    const p = ports;
    const uncertain = (): Uncertain =>
      Object.freeze({
        kind: 'uncertain',
        operationId: prepared.write.operationId,
        retry: 'same_envelope_only',
      });
    if (state.pending) return uncertain();
    const started = performance.now();
    const publication = async (): Promise<Result> => {
      let writeStarted = false;
      try {
        const retained = await p.retained(prepared.write.operationId);
        if (!Buffer.from(copyBytes(retained, p.maxEnvelopeBytes)).equals(Buffer.from(state.raw)))
          return state.unknown ? uncertain() : Object.freeze({ kind: 'unavailable' });
        if (performance.now() - started >= p.operationMs)
          return state.unknown ? uncertain() : Object.freeze({ kind: 'unavailable' });
        writeStarted = true;
        const result = await recordExamFunctionalEvidence(
          p.client,
          prepared.write,
          prepared.payload,
        );
        return state.unknown && result.kind !== 'recorded' ? uncertain() : result;
      } catch {
        if (writeStarted || state.unknown) {
          state.unknown = true;
          return uncertain();
        }
        return Object.freeze({ kind: 'unavailable' });
      }
    };
    state.pending = Promise.resolve()
      .then(publication)
      .finally(() => {
        state.pending = null;
      });
    try {
      const result = await bounded(state.pending, p.operationMs);
      if (result.kind === 'recorded') state.unknown = false;
      return result;
    } catch {
      state.unknown = true;
      return uncertain();
    }
  }
  return Object.freeze({
    available: ports !== null,
    prepareProjection,
    prepareEvidence,
    record,
    retry: record,
  });
}
