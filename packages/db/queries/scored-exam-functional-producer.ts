import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { validateExamScoringRubric, type ExamScoringRubric } from '@nextera/domain';
import {
  assertScoredExamSourceBinding,
  checkpointCanonicalJson,
  scoredExamFramedDigest,
  scoredExamRubricDigest,
} from '../operations/scored-exam-publication';
import {
  recordExamFunctionalEvidence,
  ExamScoringReviewStorageError,
  type ExamFunctionalResult,
  type ExamScoringReviewClient,
  type ExamScoringWrite,
} from './exam-scoring-review';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
const key = /^[a-z][a-z0-9-]{0,99}$/;
export class ScoredExamFunctionalProducerError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable') {
    super('SCORED_EXAM_FUNCTIONAL_' + code.toUpperCase());
  }
}
const fail = (code: ScoredExamFunctionalProducerError['code'] = 'invalid_input'): never => {
  throw new ScoredExamFunctionalProducerError(code);
};
function data(v: unknown, names: readonly string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  )
    return fail();
  const d = Object.getOwnPropertyDescriptors(v),
    keys = Reflect.ownKeys(d);
  if (
    keys.length !== names.length ||
    !names.every((k) => Object.hasOwn(d, k) && Object.hasOwn(d[k]!, 'value'))
  )
    return fail();
  return Object.fromEntries(names.map((k) => [k, d[k]!.value]));
}
function array(v: unknown): unknown[] {
  if (!Array.isArray(v) || Reflect.ownKeys(v).length !== v.length + 1) return fail();
  return Array.from({ length: v.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (!d || !Object.hasOwn(d, 'value')) return fail();
    return d.value;
  });
}
function text(v: unknown, pattern: RegExp): string {
  if (typeof v !== 'string' || !pattern.test(v)) return fail();
  return v;
}
const id = (v: unknown) => text(v, uuid),
  hash = (v: unknown) => text(v, sha);
function integer(v: unknown, positive = false): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < (positive ? 1 : 0) || v > 2147483647)
    return fail();
  return v;
}
function decimal(v: unknown): string {
  if (
    typeof v !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(v) ||
    BigInt(v) >= 9223372036854775807n
  )
    return fail();
  return v;
}
const digest = (v: Uint8Array | string) => createHash('sha256').update(v).digest('hex');
function utf8(v: unknown): { bytes: Uint8Array; text: string } {
  if (!(v instanceof Uint8Array) || v.byteLength < 1 || v.byteLength > 1048576) return fail();
  const bytes = new Uint8Array(v);
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail();
  }
  return { bytes, text: decoded };
}
export type ScoredExamFunctionalGroup = Readonly<{ groupKey: string; criteriaDigest: string }>;
export type ScoredExamFunctionalManifest = Readonly<{
  version: 1;
  failureSemantics: 'complete-observations-only-v1';
  caseFiles: Readonly<{ publicSha256: string; privateSha256: string }>;
  groups: readonly (ScoredExamFunctionalGroup &
    Readonly<{ cases: readonly Readonly<{ index: number; caseSha256: string }>[] }>)[];
}>;
function manifest(value: unknown, caseCount: number): ScoredExamFunctionalManifest {
  const m = data(value, ['version', 'failureSemantics', 'caseFiles', 'groups']),
    files = data(m.caseFiles, ['publicSha256', 'privateSha256']);
  if (m.version !== 1 || m.failureSemantics !== 'complete-observations-only-v1') return fail();
  const seen = new Set<number>(),
    keys = new Set<string>();
  const groups = array(m.groups).map((v) => {
    const g = data(v, ['groupKey', 'criteriaDigest', 'cases']),
      groupKey = text(g.groupKey, /^[a-z][a-z0-9-]{0,79}$/);
    if (keys.has(groupKey)) return fail();
    keys.add(groupKey);
    const cases = array(g.cases).map((v) => {
      const c = data(v, ['index', 'caseSha256']),
        index = integer(c.index);
      if (index >= caseCount || seen.has(index)) return fail();
      seen.add(index);
      return Object.freeze({ index, caseSha256: hash(c.caseSha256) });
    });
    if (!cases.length) return fail();
    return Object.freeze({
      groupKey,
      criteriaDigest: hash(g.criteriaDigest),
      cases: Object.freeze(cases),
    });
  });
  if (!groups.length || groups.length > 13 || seen.size !== caseCount) return fail();
  return Object.freeze({
    version: 1,
    failureSemantics: 'complete-observations-only-v1',
    caseFiles: Object.freeze({
      publicSha256: hash(files.publicSha256),
      privateSha256: hash(files.privateSha256),
    }),
    groups: Object.freeze(groups),
  });
}
/** The exact raw JSON object bytes match Go json.RawMessage: no array separator whitespace. */
function rawCases(source: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return fail();
  }
  const values = array(parsed);
  if (values.some((v) => !v || typeof v !== 'object' || Array.isArray(v))) return fail();
  const parts: string[] = [];
  let i = 0;
  const whitespace = () => {
    while (/[\t\n\r ]/.test(source[i] ?? '') && i < source.length) i++;
  };
  whitespace();
  if (source[i++] !== '[') return fail();
  whitespace();
  while (source[i] !== ']') {
    const start = i;
    let depth = 0,
      inString = false,
      escaped = false;
    for (; i < source.length; i++) {
      const c = source[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    if (depth !== 0 || inString || i === start) return fail();
    parts.push(source.slice(start, i));
    whitespace();
    if (source[i] === ',') {
      i++;
      whitespace();
    } else if (source[i] !== ']') return fail();
  }
  i++;
  whitespace();
  if (i !== source.length || parts.length !== values.length) return fail();
  return parts;
}

/** Private source preparation only. It proves supplied bytes/bindings, not owner identity or permission to publish. */
export function prepareScoredExamFunctionalManifest(
  input: Readonly<{
    evaluatorKey: 'official-code';
    evaluatorDigest: string;
    testPackId: string;
    testPackDigest: string;
    questionKey: string;
    rubric: ExamScoringRubric;
    sourceBinding: unknown;
    sourceBindingDigest: string;
    manifestBytes: Uint8Array;
    publicCasesBytes: Uint8Array;
    privateCasesBytes: Uint8Array;
  }>,
) {
  const captured = data(input, [
    'evaluatorKey',
    'evaluatorDigest',
    'testPackId',
    'testPackDigest',
    'questionKey',
    'rubric',
    'sourceBinding',
    'sourceBindingDigest',
    'manifestBytes',
    'publicCasesBytes',
    'privateCasesBytes',
  ]);
  const rubric = JSON.parse(checkpointCanonicalJson(captured.rubric)) as ExamScoringRubric;
  validateExamScoringRubric(rubric);
  if (
    rubric.digest !==
    scoredExamRubricDigest({
      version: rubric.version,
      form: rubric.form,
      definitionDigest: rubric.definitionDigest,
      questions: rubric.questions,
    })
  )
    return fail();
  assertScoredExamSourceBinding(captured.sourceBinding, rubric);
  const sourceBindingDigest = hash(captured.sourceBindingDigest);
  if (
    sourceBindingDigest !==
      scoredExamFramedDigest(captured.sourceBinding, 'nextera-exam1-rubric-source-binding') ||
    captured.evaluatorKey !== 'official-code'
  )
    return fail();
  const questionKey = text(captured.questionKey, /^q[1-5]$/),
    q = rubric.questions.find((q) => q.questionKey === questionKey);
  if (!q || q.kind !== 'coding') return fail();
  const raw = utf8(captured.manifestBytes),
    pub = utf8(captured.publicCasesBytes),
    priv = utf8(captured.privateCasesBytes),
    cases = [...rawCases(pub.text), ...rawCases(priv.text)];
  if (!cases.length) return fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    return fail();
  }
  const m = manifest(parsed, cases.length);
  if (
    m.caseFiles.publicSha256 !== digest(pub.bytes) ||
    m.caseFiles.privateSha256 !== digest(priv.bytes) ||
    m.groups.length !== q.functionalGroups.length
  )
    return fail();
  for (let i = 0; i < m.groups.length; i++) {
    const g = m.groups[i]!,
      r = q.functionalGroups[i]!;
    if (
      g.groupKey !== r.key ||
      g.criteriaDigest !== r.criteriaDigest ||
      g.cases.some((c) => c.caseSha256 !== digest(cases[c.index]!))
    )
      return fail();
  }
  const binding = Object.freeze({
    version: 1 as const,
    evaluatorKey: 'official-code' as const,
    evaluatorDigest: hash(captured.evaluatorDigest),
    definitionDigest: rubric.definitionDigest,
    rubricDigest: rubric.digest,
    rubricSourceBindingDigest: sourceBindingDigest,
    questionKey,
    testPackId: text(captured.testPackId, key),
    testPackDigest: hash(captured.testPackDigest),
    manifestSha256: digest(raw.bytes),
    publicCasesSha256: m.caseFiles.publicSha256,
    privateCasesSha256: m.caseFiles.privateSha256,
    caseCount: cases.length,
  });
  return Object.freeze({
    runtimeEnabled: false as const,
    binding,
    manifest: m,
    manifestBase64: Buffer.from(raw.bytes).toString('base64'),
    manifestBindingDigest: scoredExamFramedDigest(
      binding,
      '01coding-exam-functional-manifest-binding',
    ),
  });
}

const contextNames = [
  'version',
  'submissionId',
  'jobId',
  'attemptId',
  'learnerId',
  'cohortId',
  'questionKey',
  'answerSha256',
  'definitionDigest',
  'snapshotDigest',
  'rubricDigest',
  'rubricSourceBindingDigest',
  'publishedCriteriaDigest',
  'evaluatorKey',
  'evaluatorDigest',
  'evaluationSnapshotDigest',
  'evaluationSpecDigest',
  'testPackId',
  'testPackDigest',
  'manifestSha256',
  'publicCasesSha256',
  'privateCasesSha256',
  'caseCount',
  'manifestBindingDigest',
  'expectedRevision',
  'groups',
] as const;
export type ScoredExamFunctionalContext = Readonly<{
  version: 1;
  submissionId: string;
  jobId: string;
  attemptId: string;
  learnerId: string;
  cohortId: string;
  questionKey: string;
  answerSha256: string;
  definitionDigest: string;
  snapshotDigest: string;
  rubricDigest: string;
  rubricSourceBindingDigest: string;
  publishedCriteriaDigest: string;
  evaluatorKey: 'official-code';
  evaluatorDigest: string;
  evaluationSnapshotDigest: string;
  evaluationSpecDigest: string;
  testPackId: string;
  testPackDigest: string;
  manifestSha256: string;
  publicCasesSha256: string;
  privateCasesSha256: string;
  caseCount: number;
  manifestBindingDigest: string;
  expectedRevision: string;
  groups: readonly ScoredExamFunctionalGroup[];
}>;
function captureContext(value: unknown): ScoredExamFunctionalContext {
  const c = data(value, contextNames);
  if (
    c.version !== 1 ||
    c.evaluatorKey !== 'official-code' ||
    c.evaluatorDigest !== c.evaluationSpecDigest
  )
    return fail();
  const seen = new Set<string>();
  const groups = array(c.groups).map((v) => {
    const g = data(v, ['groupKey', 'criteriaDigest']),
      groupKey = text(g.groupKey, /^[a-z][a-z0-9-]{0,79}$/);
    if (seen.has(groupKey)) return fail();
    seen.add(groupKey);
    return Object.freeze({ groupKey, criteriaDigest: hash(g.criteriaDigest) });
  });
  if (!groups.length || groups.length > 13) return fail();
  return Object.freeze({
    version: 1,
    submissionId: id(c.submissionId),
    jobId: id(c.jobId),
    attemptId: id(c.attemptId),
    learnerId: id(c.learnerId),
    cohortId: id(c.cohortId),
    questionKey: text(c.questionKey, /^q[1-5]$/),
    answerSha256: hash(c.answerSha256),
    definitionDigest: hash(c.definitionDigest),
    snapshotDigest: hash(c.snapshotDigest),
    rubricDigest: hash(c.rubricDigest),
    rubricSourceBindingDigest: hash(c.rubricSourceBindingDigest),
    publishedCriteriaDigest: hash(c.publishedCriteriaDigest),
    evaluatorKey: 'official-code',
    evaluatorDigest: hash(c.evaluatorDigest),
    evaluationSnapshotDigest: hash(c.evaluationSnapshotDigest),
    evaluationSpecDigest: hash(c.evaluationSpecDigest),
    testPackId: text(c.testPackId, key),
    testPackDigest: hash(c.testPackDigest),
    manifestSha256: hash(c.manifestSha256),
    publicCasesSha256: hash(c.publicCasesSha256),
    privateCasesSha256: hash(c.privateCasesSha256),
    caseCount: integer(c.caseCount, true),
    manifestBindingDigest: hash(c.manifestBindingDigest),
    expectedRevision: decimal(c.expectedRevision),
    groups: Object.freeze(groups),
  });
}
export type ScoredExamFunctionalReport = Readonly<{
  version: 1;
  jobId: string;
  submissionId: string;
  itemKey: string;
  evaluationSnapshotDigest: string;
  evaluationSpecDigest: string;
  artifactSha256: string;
  testPackId: string;
  testPackDigest: string;
  manifestSha256: string;
  publicCasesSha256: string;
  privateCasesSha256: string;
  caseCount: number;
  groups: readonly (ScoredExamFunctionalGroup & Readonly<{ passed: boolean }>)[];
}>;
export function captureScoredExamFunctionalReport(value: unknown): ScoredExamFunctionalReport {
  const r = data(value, [
    'version',
    'jobId',
    'submissionId',
    'itemKey',
    'evaluationSnapshotDigest',
    'evaluationSpecDigest',
    'artifactSha256',
    'testPackId',
    'testPackDigest',
    'manifestSha256',
    'publicCasesSha256',
    'privateCasesSha256',
    'caseCount',
    'groups',
  ]);
  if (r.version !== 1) return fail();
  const seen = new Set<string>();
  const groups = array(r.groups).map((v) => {
    const g = data(v, ['groupKey', 'criteriaDigest', 'passed']),
      groupKey = text(g.groupKey, /^[a-z][a-z0-9-]{0,79}$/);
    if (seen.has(groupKey) || typeof g.passed !== 'boolean') return fail();
    seen.add(groupKey);
    return Object.freeze({ groupKey, criteriaDigest: hash(g.criteriaDigest), passed: g.passed });
  });
  if (!groups.length || groups.length > 13) return fail();
  return Object.freeze({
    version: 1,
    jobId: id(r.jobId),
    submissionId: id(r.submissionId),
    itemKey: text(r.itemKey, /^q[1-5]$/),
    evaluationSnapshotDigest: hash(r.evaluationSnapshotDigest),
    evaluationSpecDigest: hash(r.evaluationSpecDigest),
    artifactSha256: hash(r.artifactSha256),
    testPackId: text(r.testPackId, key),
    testPackDigest: hash(r.testPackDigest),
    manifestSha256: hash(r.manifestSha256),
    publicCasesSha256: hash(r.publicCasesSha256),
    privateCasesSha256: hash(r.privateCasesSha256),
    caseCount: integer(r.caseCount, true),
    groups: Object.freeze(groups),
  });
}
export const READ_SCORED_EXAM_FUNCTIONAL_CONTEXT_SQL =
  'SELECT app.scored_exam_functional_context($1::uuid,$2::uuid) AS data';
export async function readScoredExamFunctionalContext(
  client: ExamScoringReviewClient,
  submissionId: string,
  jobId: string,
): Promise<ScoredExamFunctionalContext> {
  const submission = id(submissionId),
    job = id(jobId);
  try {
    const rows = await client.unsafe(READ_SCORED_EXAM_FUNCTIONAL_CONTEXT_SQL, [
      submission,
      job,
    ] as never[]);
    if (!Array.isArray(rows) || rows.length !== 1) return fail('unavailable');
    const c = captureContext(data(rows[0], ['data']).data);
    if (c.submissionId !== submission || c.jobId !== job) return fail('unavailable');
    return c;
  } catch {
    return fail('unavailable');
  }
}
export function buildScoredExamFunctionalEvidence(
  context: ScoredExamFunctionalContext,
  value: unknown,
): ExamFunctionalResult {
  const c = captureContext(context),
    r = captureScoredExamFunctionalReport(value);
  if (
    r.submissionId !== c.submissionId ||
    r.jobId !== c.jobId ||
    r.itemKey !== c.questionKey ||
    r.artifactSha256 !== c.answerSha256 ||
    r.evaluationSnapshotDigest !== c.evaluationSnapshotDigest ||
    r.evaluationSpecDigest !== c.evaluationSpecDigest ||
    r.testPackId !== c.testPackId ||
    r.testPackDigest !== c.testPackDigest ||
    r.manifestSha256 !== c.manifestSha256 ||
    r.publicCasesSha256 !== c.publicCasesSha256 ||
    r.privateCasesSha256 !== c.privateCasesSha256 ||
    r.caseCount !== c.caseCount ||
    r.groups.length !== c.groups.length ||
    r.groups.some(
      (g, i) =>
        g.groupKey !== c.groups[i]!.groupKey || g.criteriaDigest !== c.groups[i]!.criteriaDigest,
    )
  )
    return fail('unavailable');
  return Object.freeze({
    state: 'evaluated',
    evidence: Object.freeze({
      submissionId: c.submissionId,
      questionKey: c.questionKey as 'q1',
      answerSha256: c.answerSha256,
      rubricDigest: c.rubricDigest,
      publishedCriteriaDigest: c.publishedCriteriaDigest,
      evidenceDigest: scoredExamFramedDigest(
        { version: 1, context: c, report: r },
        '01coding-exam-functional-evidence',
      ),
      kind: 'groups',
      outcomes: r.groups,
    }),
  });
}
export type PreparedScoredExamFunctionalWrite = Readonly<{
  write: ExamScoringWrite;
  payload: ExamFunctionalResult;
  context: ScoredExamFunctionalContext;
  report: ScoredExamFunctionalReport;
}>;
/** A configured evaluator client only: no URLs, role claims, keys, cookie fallback or automatic retries. */
export function createScoredExamFunctionalProducer(client: ExamScoringReviewClient) {
  const prepared = new WeakSet<object>();
  async function record(envelope: PreparedScoredExamFunctionalWrite) {
    if (!prepared.has(envelope)) return fail();
    try {
      return await recordExamFunctionalEvidence(client, envelope.write, envelope.payload);
    } catch (error) {
      if (error instanceof ExamScoringReviewStorageError && error.code === 'outcome_unknown')
        return Object.freeze({
          kind: 'uncertain' as const,
          operationId: envelope.write.operationId,
          retry: 'same_envelope_only' as const,
        });
      throw error;
    }
  }
  return Object.freeze({
    async prepare(value: unknown, operationId: string) {
      const report = captureScoredExamFunctionalReport(value),
        operation = id(operationId),
        context = await readScoredExamFunctionalContext(client, report.submissionId, report.jobId),
        payload = buildScoredExamFunctionalEvidence(context, report);
      const envelope = Object.freeze({
        write: Object.freeze({
          operationId: operation,
          submissionId: context.submissionId,
          expectedRevision: context.expectedRevision,
        }),
        payload,
        context,
        report,
      });
      prepared.add(envelope);
      return envelope;
    },
    record,
    /** Caller deliberately reuses the exact prepared envelope after an uncertain acknowledgement. */
    retry: record,
  });
}
