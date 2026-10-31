import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import type { ExamFunctionalEvidence, ExamManualMarks } from '@nextera/domain';

export type ExamScoringReviewClient = Pick<Sql, 'unsafe'>;
export type ExamFunctionalResult =
  | Readonly<{ state: 'infrastructure_unknown' }>
  | Readonly<{ state: 'evaluated'; evidence: ExamFunctionalEvidence }>;
export type ExamMentorReviewPayload = Readonly<{
  answerSha256: string;
  rubricDigest: string;
  assignmentDigest: string;
  evidenceDigest: string;
  marks: ExamManualMarks;
}>;
export type ExamSecondaryReviewPayload = ExamMentorReviewPayload &
  Readonly<{ primaryEventId: string }>;
export type ExamScoringWrite = Readonly<{
  operationId: string;
  submissionId: string;
  expectedRevision: string;
}>;
export type ExamScoringWriteDenial =
  'forbidden' | 'invalid_input' | 'unavailable' | 'review_not_open' | 'conflict' | 'stale_revision';
export type ExamScoringWriteResult =
  | Readonly<{ kind: ExamScoringWriteDenial }>
  | Readonly<{
      kind: 'recorded';
      eventId: string;
      operationId: string;
      submissionId: string;
      revision: string;
      payloadDigest: string;
      replayed: boolean;
    }>;
export type ExamScoringStoredEvent = Readonly<{
  eventId: string;
  operationId: string;
  revision: string;
  eventKind: 'functional' | 'primary' | 'secondary';
  actorUserId: string | null;
  payload: ExamFunctionalResult | ExamMentorReviewPayload | ExamSecondaryReviewPayload;
  payloadDigest: string;
}>;
export type ExamScoringHistory = Readonly<{
  submissionId: string;
  attemptId: string;
  learnerId: string;
  cohortId: string;
  questionKey: string;
  answerKind: 'coding' | 'trace_with_reason' | 'debug_with_reason';
  answerSha256: string;
  definitionDigest: string;
  rubricDigest: string;
  form: 'A' | 'B' | 'C' | 'D';
  acceptedOrdinal: string;
  revision: string;
  status: 'provisional';
  events: readonly ExamScoringStoredEvent[];
}>;
export class ExamScoringReviewStorageError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'outcome_unknown') {
    super('EXAM_SCORING_REVIEW_' + code.toUpperCase());
  }
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const key = /^[a-z][a-z0-9-]{0,79}$/;
const maxBigint = 9223372036854775807n;
function fail(code: 'invalid_input' | 'unavailable' | 'outcome_unknown' = 'invalid_input'): never {
  throw new ExamScoringReviewStorageError(code);
}
function data(value: unknown, names?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const d = Object.getOwnPropertyDescriptors(value),
    keys = Reflect.ownKeys(d);
  if (
    (names && (keys.length !== names.length || !names.every((name) => Object.hasOwn(d, name)))) ||
    keys.some((name) => typeof name !== 'string' || !Object.hasOwn(d[name]!, 'value'))
  )
    return fail();
  return Object.fromEntries(keys.map((name) => [name, d[name as string]!.value]));
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) return fail();
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !hash.test(value)) return fail();
  return value;
}
function decimal(value: unknown, positive = false, max = maxBigint): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
    BigInt(value) > max ||
    (positive && value === '0')
  )
    return fail();
  return value;
}
function marks(value: unknown): ExamManualMarks {
  const m = data(value),
    keys = Object.keys(m);
  const bounded = (v: unknown, maximum: number) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= maximum;
  if (keys.length === 1 && Object.hasOwn(m, 'contract') && bounded(m.contract, 2))
    return Object.freeze({ contract: m.contract as number });
  if (keys.length === 1 && Object.hasOwn(m, 'reason') && bounded(m.reason, 2))
    return Object.freeze({ reason: m.reason as number });
  if (
    keys.length === 2 &&
    Object.hasOwn(m, 'counterexample') &&
    Object.hasOwn(m, 'explanation') &&
    bounded(m.counterexample, 4) &&
    bounded(m.explanation, 2)
  )
    return Object.freeze({
      counterexample: m.counterexample as number,
      explanation: m.explanation as number,
    });
  return fail();
}
function functional(value: unknown): ExamFunctionalResult {
  const body = data(value);
  if (body.state === 'infrastructure_unknown' && Object.keys(body).length === 1)
    return Object.freeze({ state: 'infrastructure_unknown' });
  if (
    body.state !== 'evaluated' ||
    Object.keys(body).length !== 2 ||
    !Object.hasOwn(body, 'evidence')
  )
    return fail();
  const e = data(body.evidence),
    names = [
      'submissionId',
      'questionKey',
      'answerSha256',
      'rubricDigest',
      'publishedCriteriaDigest',
      'kind',
      'evidenceDigest',
    ];
  if (
    Object.keys(e).length !== 8 ||
    !names.every((n) => Object.hasOwn(e, n)) ||
    typeof e.questionKey !== 'string' ||
    !/^q[1-8]$/.test(e.questionKey)
  )
    return fail();
  const binding = {
    submissionId: id(e.submissionId),
    questionKey: e.questionKey as ExamFunctionalEvidence['questionKey'],
    answerSha256: digest(e.answerSha256),
    rubricDigest: digest(e.rubricDigest),
    publishedCriteriaDigest: digest(e.publishedCriteriaDigest),
    evidenceDigest: digest(e.evidenceDigest),
  };
  if (e.kind === 'trace_output' && Object.hasOwn(e, 'matched') && typeof e.matched === 'boolean')
    return Object.freeze({
      state: 'evaluated',
      evidence: Object.freeze({ ...binding, kind: 'trace_output', matched: e.matched }),
    });
  if (
    e.kind !== 'groups' ||
    !Object.hasOwn(e, 'outcomes') ||
    !Array.isArray(e.outcomes) ||
    e.outcomes.length < 1 ||
    e.outcomes.length > 13
  )
    return fail();
  const seen = new Set<string>();
  const outcomes = e.outcomes.map((value) => {
    const o = data(value, ['groupKey', 'criteriaDigest', 'passed']);
    if (
      typeof o.groupKey !== 'string' ||
      !key.test(o.groupKey) ||
      seen.has(o.groupKey) ||
      typeof o.passed !== 'boolean'
    )
      return fail();
    seen.add(o.groupKey);
    return Object.freeze({
      groupKey: o.groupKey,
      criteriaDigest: digest(o.criteriaDigest),
      passed: o.passed,
    });
  });
  return Object.freeze({
    state: 'evaluated',
    evidence: Object.freeze({ ...binding, kind: 'groups', outcomes: Object.freeze(outcomes) }),
  });
}
function manual(
  value: unknown,
  secondary: boolean,
): ExamMentorReviewPayload | ExamSecondaryReviewPayload {
  const p = data(value, [
    'answerSha256',
    'rubricDigest',
    'assignmentDigest',
    'evidenceDigest',
    'marks',
    ...(secondary ? ['primaryEventId'] : []),
  ]);
  const base = {
    answerSha256: digest(p.answerSha256),
    rubricDigest: digest(p.rubricDigest),
    assignmentDigest: digest(p.assignmentDigest),
    evidenceDigest: digest(p.evidenceDigest),
    marks: marks(p.marks),
  };
  return Object.freeze(secondary ? { ...base, primaryEventId: id(p.primaryEventId) } : base);
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const v = data(value);
  return (
    '{' +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
      .join(',') +
    '}'
  );
}
export function examScoringEventDigest(
  payload: ExamFunctionalResult | ExamMentorReviewPayload | ExamSecondaryReviewPayload,
): string {
  return createHash('sha256')
    .update('01coding-exam-scoring-event\0v1\0', 'utf8')
    .update(canonical(payload), 'utf8')
    .digest('hex');
}
export const RECORD_EXAM_SCORING_EVENT_SQL =
  'SELECT app.record_exam_scoring_event($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5,$6::jsonb,$7) AS data';
export const READ_EXAM_SCORING_HISTORY_SQL =
  'SELECT app.exam_scoring_history($1::uuid,$2::uuid) AS data';
const denials = new Set<ExamScoringWriteDenial>([
  'forbidden',
  'invalid_input',
  'unavailable',
  'review_not_open',
  'conflict',
  'stale_revision',
]);
async function record(
  client: ExamScoringReviewClient,
  input: ExamScoringWrite,
  authUserId: string | null,
  kind: 'functional' | 'primary' | 'secondary',
  payload: ExamFunctionalResult | ExamMentorReviewPayload | ExamSecondaryReviewPayload,
): Promise<ExamScoringWriteResult> {
  const w = data(input, ['operationId', 'submissionId', 'expectedRevision']);
  const operationId = id(w.operationId),
    submissionId = id(w.submissionId),
    expectedRevision = decimal(w.expectedRevision, false, maxBigint - 1n);
  if (
    kind === 'functional' &&
    (payload as ExamFunctionalResult).state === 'evaluated' &&
    (payload as Extract<ExamFunctionalResult, { state: 'evaluated' }>).evidence.submissionId !==
      submissionId
  )
    return fail();
  const payloadDigest = examScoringEventDigest(payload),
    json = canonical(payload);
  let rows: unknown;
  try {
    rows = await client.unsafe(RECORD_EXAM_SCORING_EVENT_SQL, [
      authUserId,
      operationId,
      submissionId,
      expectedRevision,
      kind,
      json,
      payloadDigest,
    ] as never[]);
  } catch {
    return fail('outcome_unknown');
  }
  try {
    if (!Array.isArray(rows) || rows.length !== 1) return fail('unavailable');
    const r = data(data(rows[0], ['data']).data);
    if (
      typeof r.kind === 'string' &&
      denials.has(r.kind as ExamScoringWriteDenial) &&
      Object.keys(r).length === 1
    )
      return Object.freeze({ kind: r.kind as ExamScoringWriteDenial });
    data(r, [
      'kind',
      'eventId',
      'operationId',
      'submissionId',
      'revision',
      'payloadDigest',
      'replayed',
    ]);
    if (
      r.kind !== 'recorded' ||
      r.operationId !== operationId ||
      r.submissionId !== submissionId ||
      r.payloadDigest !== payloadDigest ||
      typeof r.replayed !== 'boolean' ||
      BigInt(decimal(r.revision, true)) !== BigInt(expectedRevision) + 1n
    )
      return fail('unavailable');
    return Object.freeze({
      kind: 'recorded',
      eventId: id(r.eventId),
      operationId,
      submissionId,
      revision: r.revision as string,
      payloadDigest,
      replayed: r.replayed,
    });
  } catch {
    return fail('outcome_unknown');
  }
}
/** Evaluator client identity is checked by PostgreSQL; there is no caller-supplied worker/role claim. */
export async function recordExamFunctionalEvidence(
  client: ExamScoringReviewClient,
  input: ExamScoringWrite,
  payload: ExamFunctionalResult,
) {
  return record(client, input, null, 'functional', functional(payload));
}
/** Existing authenticated server adapter supplies authUserId; SQL resolves the assigned, active mentor. */
export async function recordExamMentorReview(
  client: ExamScoringReviewClient,
  authUserId: string,
  input: ExamScoringWrite,
  payload: ExamMentorReviewPayload,
) {
  return record(client, input, id(authUserId), 'primary', manual(payload, false));
}
export async function recordExamIndependentReview(
  client: ExamScoringReviewClient,
  authUserId: string,
  input: ExamScoringWrite,
  payload: ExamSecondaryReviewPayload,
) {
  return record(client, input, id(authUserId), 'secondary', manual(payload, true));
}
export async function readExamScoringHistory(
  client: ExamScoringReviewClient,
  authUserId: string,
  submissionId: string,
): Promise<ExamScoringHistory> {
  const actor = id(authUserId),
    submission = id(submissionId);
  try {
    const rows = await client.unsafe(READ_EXAM_SCORING_HISTORY_SQL, [actor, submission] as never[]);
    if (!Array.isArray(rows) || rows.length !== 1) return fail('unavailable');
    const r = data(data(rows[0], ['data']).data, [
      'submissionId',
      'attemptId',
      'learnerId',
      'cohortId',
      'questionKey',
      'answerKind',
      'answerSha256',
      'definitionDigest',
      'rubricDigest',
      'form',
      'acceptedOrdinal',
      'revision',
      'status',
      'events',
    ]);
    if (
      r.submissionId !== submission ||
      typeof r.questionKey !== 'string' ||
      !/^q[1-8]$/.test(r.questionKey) ||
      !['A', 'B', 'C', 'D'].includes(r.form as string) ||
      !['coding', 'trace_with_reason', 'debug_with_reason'].includes(r.answerKind as string) ||
      r.status !== 'provisional' ||
      !Array.isArray(r.events)
    )
      return fail('unavailable');
    const expectedKind =
      r.questionKey === 'q8'
        ? 'debug_with_reason'
        : r.questionKey === 'q6' || r.questionKey === 'q7'
          ? 'trace_with_reason'
          : 'coding';
    if (r.answerKind !== expectedKind) return fail('unavailable');
    const revision = decimal(r.revision),
      answerSha256 = digest(r.answerSha256),
      rubricDigest = digest(r.rubricDigest);
    if (BigInt(revision) !== BigInt(r.events.length)) return fail('unavailable');
    const operations = new Set<string>(),
      identities = new Set<string>();
    const events = r.events.map((value, index) => {
      const e = data(value, [
        'eventId',
        'operationId',
        'revision',
        'eventKind',
        'actorUserId',
        'payload',
        'payloadDigest',
      ]);
      const eventId = id(e.eventId),
        operationId = id(e.operationId);
      if (
        operations.has(operationId) ||
        identities.has(eventId) ||
        decimal(e.revision, true) !== String(index + 1) ||
        !['functional', 'primary', 'secondary'].includes(e.eventKind as string)
      )
        return fail('unavailable');
      operations.add(operationId);
      identities.add(eventId);
      const eventKind = e.eventKind as ExamScoringStoredEvent['eventKind'];
      const payload =
        eventKind === 'functional'
          ? functional(e.payload)
          : manual(e.payload, eventKind === 'secondary');
      if (e.payloadDigest !== examScoringEventDigest(payload)) return fail('unavailable');
      const actorUserId =
        eventKind === 'functional'
          ? e.actorUserId === null
            ? null
            : fail('unavailable')
          : id(e.actorUserId);
      if (eventKind === 'functional') {
        const result = payload as ExamFunctionalResult;
        if (
          result.state === 'evaluated' &&
          (result.evidence.submissionId !== submission ||
            result.evidence.answerSha256 !== answerSha256 ||
            result.evidence.rubricDigest !== rubricDigest ||
            result.evidence.questionKey !== r.questionKey)
        )
          return fail('unavailable');
      } else if (
        (payload as ExamMentorReviewPayload).answerSha256 !== answerSha256 ||
        (payload as ExamMentorReviewPayload).rubricDigest !== rubricDigest
      )
        return fail('unavailable');
      return Object.freeze({
        eventId,
        operationId,
        revision: e.revision as string,
        eventKind,
        actorUserId,
        payload,
        payloadDigest: e.payloadDigest as string,
      });
    });
    return Object.freeze({
      submissionId: submission,
      attemptId: id(r.attemptId),
      learnerId: id(r.learnerId),
      cohortId: id(r.cohortId),
      questionKey: r.questionKey,
      answerKind: r.answerKind as ExamScoringHistory['answerKind'],
      answerSha256,
      definitionDigest: digest(r.definitionDigest),
      rubricDigest,
      form: r.form as ExamScoringHistory['form'],
      acceptedOrdinal: decimal(r.acceptedOrdinal, true),
      revision,
      status: 'provisional',
      events: Object.freeze(events),
    });
  } catch {
    return fail('unavailable');
  }
}
