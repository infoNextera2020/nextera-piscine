import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  compareExamTraceOutput,
  EXAM_TRACE_COMPARATOR_V1,
  validateExamScoringRubric,
  type ExamScoringRubric,
} from '@nextera/domain';
import {
  assertScoredExamSourceBinding,
  checkpointCanonicalJson,
  scoredExamFramedDigest,
  scoredExamRubricDigest,
} from './scored-exam-publication';
import { encodeCheckpointAnswerDraft } from '../queries/checkpoint-answer-drafts';
import {
  recordExamFunctionalEvidence,
  type ExamFunctionalResult,
  type ExamScoringReviewClient,
  type ExamScoringWrite,
  type ExamScoringWriteResult,
} from '../queries/exam-scoring-review';

export const EXAM_TRACE_DETAIL_APPROVAL = 'Sentinel_e849fe300ea88191acd6431b61521c7a';
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const keyPattern = /^[a-z0-9-]{1,100}$/;
const ceiling = 1048576;
export class ScoredExamTraceError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable') {
    super('SCORED_EXAM_TRACE_' + code.toUpperCase());
  }
}
const fail = (code: ScoredExamTraceError['code'] = 'unavailable'): never => {
  throw new ScoredExamTraceError(code);
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
function bytes(v: unknown, max: number): Uint8Array {
  const captured = copyBytes(v, max);
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(captured);
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
type TraceKey = 'q6' | 'q7';
type Form = 'A' | 'B' | 'C' | 'D';
function question(v: unknown): TraceKey {
  if (v !== 'q6' && v !== 'q7') return fail();
  return v;
}
function form(v: unknown): Form {
  if (v !== 'A' && v !== 'B' && v !== 'C' && v !== 'D') return fail();
  return v;
}
export type ScoredExamTraceOracle = Readonly<{
  version: 1;
  evaluatorKey: string;
  evaluatorDigest: string;
  spec: Readonly<{
    version: 1;
    form: Form;
    questionKey: TraceKey;
    paperSha256: string;
    publishedCriteriaDigest: string;
    comparator: typeof EXAM_TRACE_COMPARATOR_V1;
    programSha256: string;
    expectedOutputSha256: string;
    checkpointDocumentSha256: string;
    referenceVerificationSha256: string;
    approvalMessageId: typeof EXAM_TRACE_DETAIL_APPROVAL;
  }>;
}>;
const oracleBytes = new WeakMap<object, Uint8Array>();
/** Private artifact preparation only. Caller must verify review/approval authenticity;
 * hashes and this brand prove supplied bytes, not owner identity or permission to activate. */
export function prepareScoredExamTraceOracle(
  input: Readonly<{
    evaluatorKey: string;
    form: Form;
    questionKey: TraceKey;
    paperSha256: string;
    publishedCriteriaDigest: string;
    programBytes: Uint8Array;
    expectedOutputBytes: Uint8Array;
    checkpointDocumentBytes: Uint8Array;
    review: Readonly<{
      programSha256: string;
      expectedOutputSha256: string;
      checkpointDocumentSha256: string;
      referenceVerificationSha256: string;
      approvalMessageId: typeof EXAM_TRACE_DETAIL_APPROVAL;
    }>;
  }>,
): ScoredExamTraceOracle {
  try {
    const r = object(input, [
      'evaluatorKey',
      'form',
      'questionKey',
      'paperSha256',
      'publishedCriteriaDigest',
      'programBytes',
      'expectedOutputBytes',
      'checkpointDocumentBytes',
      'review',
    ]);
    const program = bytes(r.programBytes, ceiling),
      output = bytes(r.expectedOutputBytes, ceiling),
      document = bytes(r.checkpointDocumentBytes, ceiling);
    if (!program.length || !document.length) return fail();
    const review = object(r.review, [
      'programSha256',
      'expectedOutputSha256',
      'checkpointDocumentSha256',
      'referenceVerificationSha256',
      'approvalMessageId',
    ]);
    if (
      review.approvalMessageId !== EXAM_TRACE_DETAIL_APPROVAL ||
      review.programSha256 !== sha(program) ||
      review.expectedOutputSha256 !== sha(output) ||
      review.checkpointDocumentSha256 !== sha(document)
    )
      return fail();
    const spec = Object.freeze({
      version: 1 as const,
      form: form(r.form),
      questionKey: question(r.questionKey),
      paperSha256: hash(r.paperSha256),
      publishedCriteriaDigest: hash(r.publishedCriteriaDigest),
      comparator: EXAM_TRACE_COMPARATOR_V1,
      programSha256: hash(review.programSha256),
      expectedOutputSha256: hash(review.expectedOutputSha256),
      checkpointDocumentSha256: hash(review.checkpointDocumentSha256),
      referenceVerificationSha256: hash(review.referenceVerificationSha256),
      approvalMessageId: EXAM_TRACE_DETAIL_APPROVAL,
    });
    const evaluatorKey = key(r.evaluatorKey);
    const oracle = Object.freeze({
      version: 1 as const,
      evaluatorKey,
      spec,
      evaluatorDigest: scoredExamFramedDigest({ evaluatorKey, spec }, '01coding-exam-trace-oracle'),
    });
    oracleBytes.set(oracle, output);
    return oracle;
  } catch {
    return fail('invalid_input');
  }
}

const contextNames = [
  'version',
  'receiptId',
  'attemptId',
  'learnerId',
  'cohortId',
  'curriculumVersionId',
  'nodeKey',
  'form',
  'questionKey',
  'answerKind',
  'answerContractDigest',
  'acceptedAtMicros',
  'answerBase64',
  'answerSha256',
  'answerByteLength',
  'definitionDigest',
  'snapshotDigest',
  'evaluatorKey',
  'evaluatorDigest',
  'publishedCriteriaDigest',
  'rubricSourceBindingDigest',
  'rubric',
  'sourceBinding',
  'outbox',
  'expectedRevision',
] as const;
export type ScoredExamTraceBinding = Readonly<{
  receiptId: string;
  attemptId: string;
  learnerId: string;
  cohortId: string;
  curriculumVersionId: string;
  nodeKey: string;
  form: Form;
  questionKey: TraceKey;
  answerSha256: string;
  answerContractDigest: string;
  acceptedAtMicros: string;
  definitionDigest: string;
  snapshotDigest: string;
  evaluatorKey: string;
  evaluatorDigest: string;
  publishedCriteriaDigest: string;
  rubricDigest: string;
  rubricSourceBindingDigest: string;
  expectedRevision: string;
  paperSha256: string;
}>;
function context(value: unknown, receiptId: string, maxBytes: number, maxAnswerBytes: number) {
  const captured = snapshot(value, maxBytes),
    c = object(captured, contextNames);
  if (c.version !== 1 || c.receiptId !== receiptId || c.answerKind !== 'trace_with_reason')
    return fail();
  const rubric = c.rubric as ExamScoringRubric;
  validateExamScoringRubric(rubric);
  const { digest: rubricDigest, ...body } = rubric;
  if (rubricDigest !== scoredExamRubricDigest(body)) return fail();
  assertScoredExamSourceBinding(c.sourceBinding, rubric);
  const source = c.sourceBinding;
  const q = question(c.questionKey),
    f = form(c.form),
    qr = rubric.questions.find((item) => item.questionKey === q);
  if (
    rubric.form !== f ||
    rubric.definitionDigest !== c.definitionDigest ||
    !qr ||
    qr.kind !== 'trace_with_reason' ||
    qr.functionalGroups.length !== 0 ||
    qr.publishedCriteriaDigest !== c.publishedCriteriaDigest ||
    source.decisions.traceComparator !== EXAM_TRACE_COMPARATOR_V1 ||
    source.decisions.traceComparatorOwnerMessageId !== EXAM_TRACE_DETAIL_APPROVAL ||
    source.decisions.weightsOwnerMessageId !== EXAM_TRACE_DETAIL_APPROVAL ||
    c.rubricSourceBindingDigest !==
      scoredExamFramedDigest(source, 'nextera-exam1-rubric-source-binding')
  )
    return fail();
  const binding: ScoredExamTraceBinding = Object.freeze({
    receiptId: id(c.receiptId),
    attemptId: id(c.attemptId),
    learnerId: id(c.learnerId),
    cohortId: id(c.cohortId),
    curriculumVersionId: id(c.curriculumVersionId),
    nodeKey: key(c.nodeKey),
    form: f,
    questionKey: q,
    answerSha256: hash(c.answerSha256),
    answerContractDigest: hash(c.answerContractDigest),
    acceptedAtMicros: decimal(c.acceptedAtMicros, false),
    definitionDigest: hash(c.definitionDigest),
    snapshotDigest: hash(c.snapshotDigest),
    evaluatorKey: key(c.evaluatorKey),
    evaluatorDigest: hash(c.evaluatorDigest),
    publishedCriteriaDigest: hash(c.publishedCriteriaDigest),
    rubricDigest: hash(rubricDigest),
    rubricSourceBindingDigest: hash(c.rubricSourceBindingDigest),
    expectedRevision: decimal(c.expectedRevision),
    paperSha256: source.paperSha256,
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
    c.answerBase64.length > Math.ceil(maxAnswerBytes / 3) * 4
  )
    return fail();
  const raw = Buffer.from(c.answerBase64, 'base64');
  if (
    raw.toString('base64') !== c.answerBase64 ||
    raw.length !== c.answerByteLength ||
    raw.length > maxAnswerBytes ||
    sha(raw) !== binding.answerSha256
  )
    return fail();
  const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  const encoded = encodeCheckpointAnswerDraft(decoded),
    answer = JSON.parse(decoded) as Record<string, unknown>;
  if (
    encoded.kind !== 'trace_with_reason' ||
    encoded.sha256 !== binding.answerSha256 ||
    typeof answer.output !== 'string' ||
    typeof answer.reason !== 'string' ||
    !answer.reason.trim()
  )
    return fail();
  // Output can legitimately be empty. No deadline/active-intake check: this is grading an accepted receipt.
  return Object.freeze({
    binding,
    contextDigest: scoredExamFramedDigest(captured, '01coding-exam-trace-context'),
    actualOutput: Buffer.from(answer.output, 'utf8'),
  });
}
export type PreparedScoredExamTraceWrite = Readonly<{
  version: 1;
  write: ExamScoringWrite;
  payload: ExamFunctionalResult;
  provenance: Readonly<{
    contextDigest: string;
    oracleDigest: string;
    comparator: typeof EXAM_TRACE_COMPARATOR_V1;
    actualOutputSha256: string;
    expectedOutputSha256: string;
  }>;
}>;
export type ScoredExamTraceSettings = Readonly<{
  reader: Readonly<{ read(receiptId: string): Promise<unknown> }> | null;
  criteria: Readonly<{
    read(binding: ScoredExamTraceBinding): Promise<ScoredExamTraceOracle>;
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
  const field = Object.getOwnPropertyDescriptor(value, name);
  if (!field || !Object.hasOwn(field, 'value') || typeof field.value !== 'function') return fail();
  return field.value.bind(value) as T[K];
}
function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ScoredExamTraceError('unavailable')), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
/** Processes one explicitly supplied pending receipt, never discovers/claims work.
 * Reader/criteria/outbox are trusted server ports, NOT HTTP role or authority claims.
 * No native reader or file adapter is created: existing SQL lacks the evaluator read boundary. */
export function createScoredExamTraceProcessor(settings: ScoredExamTraceSettings | null = null) {
  type Owned = { raw: Uint8Array; pending: Promise<Result> | null; unknown: boolean };
  const owned = new WeakMap<object, Owned>();
  let ports: Readonly<{
    read: NonNullable<ScoredExamTraceSettings['reader']>['read'];
    criteria: NonNullable<ScoredExamTraceSettings['criteria']>['read'];
    store: NonNullable<ScoredExamTraceSettings['publicationOutbox']>['store'];
    retained: NonNullable<ScoredExamTraceSettings['publicationOutbox']>['read'];
    client: ExamScoringReviewClient;
    operationMs: number;
    maxContextBytes: number;
    maxAnswerBytes: number;
    maxEnvelopeBytes: number;
  }> | null = null;
  try {
    if (
      settings?.reader &&
      settings.criteria &&
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
      ports = Object.freeze({
        read: method(settings.reader, 'read'),
        criteria: method(settings.criteria, 'read'),
        store: method(settings.publicationOutbox, 'store'),
        retained: method(settings.publicationOutbox, 'read'),
        client: Object.freeze({ unsafe: method(settings.client, 'unsafe') }),
        operationMs: integer(l.operationMs),
        maxContextBytes: integer(l.maxContextBytes, ceiling),
        maxAnswerBytes: integer(l.maxAnswerBytes, ceiling),
        maxEnvelopeBytes: integer(l.maxEnvelopeBytes, ceiling),
      });
    }
  } catch {
    ports = null;
  }
  async function prepare(
    receiptId: string,
    operationId: string,
  ): Promise<PreparedScoredExamTraceWrite> {
    if (!ports) return fail();
    const p = ports,
      receipt = id(receiptId),
      operation = id(operationId);
    // One original preparation budget; no renewed timeout on the second read/store.
    const started = performance.now();
    const run = <T>(fn: () => Promise<T>) => {
      const remaining = p.operationMs - (performance.now() - started);
      if (remaining <= 0) return fail();
      return bounded(Promise.resolve().then(fn), remaining);
    };
    try {
      const current = context(
        await run(() => p.read(receipt)),
        receipt,
        p.maxContextBytes,
        p.maxAnswerBytes,
      );
      const oracle = await run(() => p.criteria(current.binding));
      const expected = oracleBytes.get(oracle);
      if (
        !expected ||
        oracle.version !== 1 ||
        oracle.evaluatorKey !== current.binding.evaluatorKey ||
        oracle.evaluatorDigest !== current.binding.evaluatorDigest ||
        oracle.spec.form !== current.binding.form ||
        oracle.spec.questionKey !== current.binding.questionKey ||
        oracle.spec.paperSha256 !== current.binding.paperSha256 ||
        oracle.spec.publishedCriteriaDigest !== current.binding.publishedCriteriaDigest ||
        oracle.spec.comparator !== EXAM_TRACE_COMPARATOR_V1
      )
        return fail();
      const confirmed = context(
        await run(() => p.read(receipt)),
        receipt,
        p.maxContextBytes,
        p.maxAnswerBytes,
      );
      if (confirmed.contextDigest !== current.contextDigest) return fail();
      const provenance = Object.freeze({
        contextDigest: current.contextDigest,
        oracleDigest: oracle.evaluatorDigest,
        comparator: EXAM_TRACE_COMPARATOR_V1,
        actualOutputSha256: sha(current.actualOutput),
        expectedOutputSha256: sha(expected),
      });
      const matched = compareExamTraceOutput(
        current.actualOutput,
        expected,
        EXAM_TRACE_COMPARATOR_V1,
      );
      const payload: ExamFunctionalResult = Object.freeze({
        state: 'evaluated',
        evidence: Object.freeze({
          submissionId: receipt,
          questionKey: current.binding.questionKey,
          answerSha256: current.binding.answerSha256,
          rubricDigest: current.binding.rubricDigest,
          publishedCriteriaDigest: current.binding.publishedCriteriaDigest,
          kind: 'trace_output',
          matched,
          evidenceDigest: scoredExamFramedDigest(
            { binding: current.binding, provenance, matched },
            '01coding-exam-trace-evidence',
          ),
        }),
      });
      const prepared = Object.freeze({
        version: 1 as const,
        write: Object.freeze({
          operationId: operation,
          submissionId: receipt,
          expectedRevision: current.binding.expectedRevision,
        }),
        payload,
        provenance,
      });
      const raw = Buffer.from(checkpointCanonicalJson(prepared));
      if (raw.length > p.maxEnvelopeBytes) return fail();
      // Required durable immutable store/readback BEFORE any scoring-event write.
      await run(() => p.store(operation, new Uint8Array(raw)));
      const retained = await run(() => p.retained(operation));
      if (!Buffer.from(copyBytes(retained, p.maxEnvelopeBytes)).equals(raw)) return fail();
      owned.set(prepared, { raw, pending: null, unknown: false });
      return prepared;
    } catch {
      return fail();
    }
  }
  async function record(prepared: PreparedScoredExamTraceWrite): Promise<Result> {
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
  return Object.freeze({ available: ports !== null, prepare, record, retry: record });
}
