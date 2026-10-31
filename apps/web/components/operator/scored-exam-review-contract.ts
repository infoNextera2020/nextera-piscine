import { parseManualReviewDisplay } from './scored-exam-manual-contract';
import type { ManualReviewDisplay } from '@nextera/db/scored-exam-manual-evidence';
import {
  EXAM_SCORING_POLICY,
  scoreExamAttempt,
  validateExamScoringRubric,
  type ExamAssessment,
  type ExamManualMarks,
  type ExamManualReview,
} from '@nextera/domain';
import type { ScoredExamReviewContext } from '@nextera/db/scored-exam-review-context';
import type { ExamScoringHistory, ExamScoringStoredEvent } from '@nextera/db/exam-scoring-review';
import type { ScoredExamOutcomeState } from '@nextera/db/scored-exam-outcomes';
import {
  serializeMixedAnswer,
  type MixedCheckpointAnswer,
} from '../../lib/checkpoints/checkpoint-answer';

export type MentorReviewIdentity = Readonly<{
  authUserId: string;
  actorUserId: string;
  attemptId: string;
}>;
export type MentorReviewSnapshot = Readonly<{
  context: ScoredExamReviewContext;
  histories: readonly ExamScoringHistory[];
  score: ReturnType<typeof scoreExamAttempt>;
  reviewWriteAvailable: boolean;
  answerReadAvailable: boolean;
  structuredAnswerReadAvailable: boolean;
  adjudicationPending: boolean;
  manualReview: ManualReviewDisplay | null;
  persistedOutcome: ScoredExamOutcomeState['currentOutcome'];
}>;
export type MentorReviewAnswer = Readonly<
  {
    binding: Readonly<{
      attemptId: string;
      submissionId: string;
      questionKey: string;
      learnerId: string;
      cohortId: string;
      definitionDigest: string;
      snapshotDigest: string;
      rubricDigest: string;
      answerSha256: string;
      byteLength: number;
    }>;
  } & (
    | { kind: 'coding'; filename: string; source: string }
    | {
        kind: MixedCheckpointAnswer['kind'];
        answer: MixedCheckpointAnswer;
      }
  )
>;
export type MentorReviewDraft = Readonly<{
  review: 'primary' | 'secondary';
  evidenceDigest: string;
  marks: ExamManualMarks;
  primaryEventId?: string;
}>;
export type MentorReviewCommand = Readonly<{
  version: 1;
  review: 'primary' | 'secondary';
  attemptId: string;
  write: Readonly<{ operationId: string; submissionId: string; expectedRevision: string }>;
  payload: Readonly<{
    answerSha256: string;
    rubricDigest: string;
    assignmentDigest: string;
    evidenceDigest: string;
    marks: ExamManualMarks;
    primaryEventId?: string;
  }>;
}>;
export class MentorReviewContractError extends Error {
  constructor() {
    super('MENTOR_REVIEW_RESPONSE_UNCONFIRMED');
  }
}
export class MentorReviewAccessError extends MentorReviewContractError {}
const fail = (): never => {
  throw new MentorReviewContractError();
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
export function validMentorIdentity(value: MentorReviewIdentity) {
  return [value.authUserId, value.actorUserId, value.attemptId].every(
    (v) => typeof v === 'string' && uuid.test(v),
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]) {
  const v = object(value);
  if (Object.keys(v).length !== keys.length || !keys.every((key) => Object.hasOwn(v, key)))
    return fail();
  return v;
}
function decimal(value: unknown, positive = false) {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
    BigInt(value) > 9223372036854775807n ||
    (positive && value === '0')
  )
    return fail();
  return value;
}
function id(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) return fail();
  return value;
}
function digest(value: unknown) {
  if (typeof value !== 'string' || !hash.test(value)) return fail();
  return value;
}
/** Copy JSON data without invoking getters or retaining caller-owned mutable graphs. */
export function captureMentorJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail();
    return value;
  }
  if (!value || typeof value !== 'object') return fail();
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(fields);
  if (keys.some((key) => typeof key !== 'string' || !Object.hasOwn(fields[key]!, 'value')))
    return fail();
  if (Array.isArray(value)) {
    if (
      keys.length !== value.length + 1 ||
      !Array.from({ length: value.length }, (_, i) => String(i)).every((k) =>
        Object.hasOwn(fields, k),
      )
    )
      return fail();
    return Object.freeze(
      Array.from({ length: value.length }, (_, i) => captureMentorJson(fields[String(i)]!.value)),
    );
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    return fail();
  return Object.freeze(
    Object.fromEntries(keys.map((key) => [key, captureMentorJson(fields[key as string]!.value)])),
  );
}
export function mentorCanonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(mentorCanonical).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map(
        (key) =>
          JSON.stringify(key) + ':' + mentorCanonical((value as Record<string, unknown>)[key]),
      )
      .join(',') +
    '}'
  );
}
export async function mentorBytesDigest(bytes: Uint8Array) {
  const result = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return [...new Uint8Array(result)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function mentorFramedDigest(value: unknown, domain: string) {
  return mentorBytesDigest(new TextEncoder().encode(domain + '\0v1\0' + mentorCanonical(value)));
}
export function mentorReviewPayloadDigest(value: MentorReviewCommand['payload']) {
  return mentorFramedDigest(value, '01coding-exam-scoring-event');
}
export function captureMentorMarks(kind: string, value: unknown): ExamManualMarks {
  const limits =
    kind === 'coding'
      ? { contract: EXAM_SCORING_POLICY.codingContractPoints }
      : kind === 'trace_with_reason'
        ? { reason: EXAM_SCORING_POLICY.traceReasonPoints }
        : kind === 'debug_with_reason'
          ? {
              counterexample: EXAM_SCORING_POLICY.debugCounterexamplePoints,
              explanation: EXAM_SCORING_POLICY.debugExplanationPoints,
            }
          : fail();
  const m = exact(captureMentorJson(value), Object.keys(limits));
  for (const [key, maximum] of Object.entries(limits))
    if (
      typeof m[key] !== 'number' ||
      !Number.isSafeInteger(m[key]) ||
      Number(m[key]) < 0 ||
      Number(m[key]) > maximum
    )
      return fail();
  return captureMentorJson(m) as ExamManualMarks;
}
function manual(
  event: ExamScoringStoredEvent,
  context: ScoredExamReviewContext,
  history: ExamScoringHistory,
): ExamManualReview {
  const p = exact(event.payload, [
    'answerSha256',
    'rubricDigest',
    'assignmentDigest',
    'evidenceDigest',
    'marks',
    ...(event.eventKind === 'secondary' ? ['primaryEventId'] : []),
  ]);
  const reviewer =
    event.eventKind === 'primary'
      ? context.assignment.primaryMentorId
      : context.assignment.eligibleMentorIds[1];
  if (
    event.actorUserId !== reviewer ||
    p.answerSha256 !== history.answerSha256 ||
    p.rubricDigest !== context.rubric.digest ||
    p.assignmentDigest !== context.assignment.digest
  )
    return fail();
  return {
    submissionId: history.submissionId,
    reviewerId: reviewer!,
    answerSha256: history.answerSha256,
    rubricDigest: context.rubric.digest,
    assignmentDigest: context.assignment.digest,
    evidenceDigest: digest(p.evidenceDigest),
    marks: captureMentorMarks(history.answerKind, p.marks),
  };
}
async function assessment(
  history: ExamScoringHistory,
  context: ScoredExamReviewContext,
): Promise<ExamAssessment> {
  let functional: Record<string, unknown> | null = null;
  let primary: ExamScoringStoredEvent | null = null;
  const primaries = new Map<string, ExamScoringStoredEvent>(),
    secondary = new Map<string, ExamScoringStoredEvent>();
  for (const [index, event] of history.events.entries()) {
    exact(event, [
      'eventId',
      'operationId',
      'revision',
      'eventKind',
      'actorUserId',
      'payload',
      'payloadDigest',
    ]);
    id(event.eventId);
    id(event.operationId);
    if (
      decimal(event.revision, true) !== String(index + 1) ||
      (await mentorFramedDigest(event.payload, '01coding-exam-scoring-event')) !==
        digest(event.payloadDigest)
    )
      return fail();
    if (event.eventKind === 'functional') {
      if (event.actorUserId !== null) return fail();
      functional = object(event.payload);
    } else if (event.eventKind === 'primary') {
      manual(event, context, history);
      primaries.set(event.eventId, event);
      primary = event;
    } else if (event.eventKind === 'secondary') {
      manual(event, context, history);
      const reference = id(object(event.payload).primaryEventId);
      if (!primaries.has(reference)) return fail();
      secondary.set(reference, event);
    } else return fail();
  }
  if (history.revision !== String(history.events.length)) return fail();
  if (!functional) return { state: 'pending' };
  if (functional.state === 'infrastructure_unknown') {
    exact(functional, ['state']);
    return { state: 'infrastructure_unknown' };
  }
  exact(functional, ['state', 'evidence']);
  if (functional.state !== 'evaluated') return fail();
  const evidence = functional.evidence as Extract<
    ExamAssessment,
    { state: 'finalized' }
  >['functional'];
  if (!primary) return { state: 'review_pending', functional: evidence };
  const second = secondary.get(primary.eventId);
  return {
    state: 'finalized',
    functional: evidence,
    primary: manual(primary, context, history),
    secondary: second ? manual(second, context, history) : null,
  };
}
/** This validates the server projection for display/CAS. It grants no assignment or grading authority. */
export async function parseMentorReviewSnapshot(
  raw: unknown,
  identity: MentorReviewIdentity,
): Promise<MentorReviewSnapshot> {
  if (!validMentorIdentity(identity)) return fail();
  const r = object(captureMentorJson(raw));
  const c = object(r.context) as unknown as ScoredExamReviewContext;
  if (c.version !== 1) return fail();
  if (
    c.authUserId !== identity.authUserId ||
    c.actorUserId !== identity.actorUserId ||
    c.access !== 'assigned_mentor' ||
    c.attempt?.scope?.attemptId !== identity.attemptId
  )
    throw new MentorReviewAccessError();
  digest(c.snapshotDigest);
  validateExamScoringRubric(c.rubric);
  const { digest: rubricDigest, ...rubricBody } = c.rubric;
  if ((await mentorFramedDigest(rubricBody, '01coding-exam-scoring-rubric')) !== rubricDigest)
    return fail();
  const s = c.attempt.scope;
  if (
    (await mentorFramedDigest(
      {
        version: 1,
        attemptId: s.attemptId,
        learnerId: s.learnerId,
        cohortId: s.cohortId,
        definitionDigest: s.definitionDigest,
        rubricDigest: s.rubricDigest,
        primaryMentorId: c.assignment.primaryMentorId,
        secondaryMentorId: c.assignment.eligibleMentorIds[1],
      },
      '01coding-exam-scoring-assignment',
    )) !== c.assignment.digest
  )
    return fail();
  if (
    !c.assignment.eligibleMentorIds.includes(identity.actorUserId) ||
    !Array.isArray(c.acceptances) ||
    !Array.isArray(r.histories) ||
    r.histories.length !== c.acceptances.length
  )
    return fail();
  const histories = r.histories as readonly ExamScoringHistory[];
  const seen = new Set<string>();
  const submissions = [];
  for (const [index, accepted] of c.acceptances.entries()) {
    id(accepted.submissionId);
    digest(accepted.answerSha256);
    decimal(accepted.acceptedAtMicros);
    decimal(accepted.acceptedOrdinal, true);
    decimal(accepted.revision);
    if (seen.has(accepted.submissionId)) return fail();
    seen.add(accepted.submissionId);
    const h = histories[index]!;
    if (
      h.submissionId !== accepted.submissionId ||
      h.attemptId !== s.attemptId ||
      h.learnerId !== s.learnerId ||
      h.cohortId !== s.cohortId ||
      h.form !== s.form ||
      h.definitionDigest !== s.definitionDigest ||
      h.rubricDigest !== s.rubricDigest ||
      h.questionKey !== accepted.questionKey ||
      h.answerKind !== accepted.answerKind ||
      h.answerSha256 !== accepted.answerSha256 ||
      h.acceptedOrdinal !== accepted.acceptedOrdinal ||
      h.revision !== accepted.revision ||
      h.status !== 'provisional' ||
      !Array.isArray(h.events)
    )
      return fail();
    submissions.push({
      id: h.submissionId,
      scope: s,
      questionKey: accepted.questionKey,
      kind: accepted.answerKind,
      answerSha256: h.answerSha256,
      acceptedAtMicros: accepted.acceptedAtMicros,
      acceptedOrdinal: h.acceptedOrdinal,
      assessment: await assessment(h, c),
    });
  }
  const a = r.adjudication === undefined || r.adjudication === null ? null : object(r.adjudication);
  const decision =
    a?.current === true && object(r.score).reviewRequirement !== 'adjudication_required'
      ? object(a.body).decision
      : null;
  const score = scoreExamAttempt({
    attempt: c.attempt,
    rubric: c.rubric,
    assignment: c.assignment,
    submissions,
    serverNowMicros: c.serverNowMicros,
    completion: c.completion,
    adjudication: decision as Parameters<typeof scoreExamAttempt>[0]['adjudication'],
  });
  if (mentorCanonical(score) !== mentorCanonical(r.score)) return fail();
  for (const key of [
    'reviewWriteAvailable',
    'answerReadAvailable',
    'structuredAnswerReadAvailable',
    'adjudicationPending',
    'finalOutcomePersisted',
  ])
    if (typeof r[key] !== 'boolean') return fail();
  if (
    score.intake.status === 'open' &&
    (r.reviewWriteAvailable || r.answerReadAvailable || r.structuredAnswerReadAvailable)
  )
    return fail();
  let persistedOutcome: ScoredExamOutcomeState['currentOutcome'] = null;
  if (r.finalOutcomePersisted) {
    const o = object(r.currentOutcome);
    if (
      !a ||
      a.current !== true ||
      r.adjudicationPending !== false ||
      o.current !== true ||
      o.adjudicationId !== id(a.id) ||
      o.projectionDigest !== digest(a.projectionDigest) ||
      o.verdict !== score.status ||
      o.totalPoints !== score.totalPoints ||
      o.codingPoints !== score.codingPoints ||
      !['passed', 'failed'].includes(score.status)
    )
      return fail();
    id(o.id);
    decimal(o.revision, true);
    digest(o.resultDigest);
    digest(o.implementationDigest);
    persistedOutcome = o as unknown as ScoredExamOutcomeState['currentOutcome'];
  }
  return Object.freeze({
    context: c,
    histories,
    score,
    reviewWriteAvailable: r.reviewWriteAvailable as boolean,
    answerReadAvailable: r.answerReadAvailable as boolean,
    structuredAnswerReadAvailable: r.structuredAnswerReadAvailable as boolean,
    adjudicationPending: r.adjudicationPending as boolean,
    persistedOutcome,
    manualReview: await parseManualReviewDisplay(r.manualReview, { context: c, histories, score }),
  });
}
export function mentorAnswerMatches(answer: MentorReviewAnswer, snapshot: MentorReviewSnapshot) {
  const b = answer.binding,
    c = snapshot.context,
    s = c.attempt.scope;
  const accepted = c.acceptances.find((a) => a.submissionId === b.submissionId);
  return (
    !!accepted &&
    accepted.questionKey === b.questionKey &&
    accepted.answerKind === answer.kind &&
    accepted.answerSha256 === b.answerSha256 &&
    b.attemptId === s.attemptId &&
    b.learnerId === s.learnerId &&
    b.cohortId === s.cohortId &&
    b.definitionDigest === s.definitionDigest &&
    b.rubricDigest === s.rubricDigest &&
    b.snapshotDigest === c.snapshotDigest
  );
}
export async function parseMentorReviewAnswer(
  raw: unknown,
  snapshot: MentorReviewSnapshot,
  submissionId: string,
): Promise<MentorReviewAnswer> {
  const r = object(captureMentorJson(raw)),
    b = exact(r.binding, [
      'attemptId',
      'submissionId',
      'questionKey',
      'learnerId',
      'cohortId',
      'definitionDigest',
      'snapshotDigest',
      'rubricDigest',
      'answerSha256',
      'byteLength',
    ]);
  if (
    b.submissionId !== submissionId ||
    !Number.isSafeInteger(b.byteLength) ||
    Number(b.byteLength) < 1 ||
    Number(b.byteLength) > 262144 ||
    !mentorAnswerMatches(r as unknown as MentorReviewAnswer, snapshot)
  )
    return fail();
  let text: string;
  if (r.kind === 'coding') {
    exact(r, ['binding', 'kind', 'filename', 'source']);
    if (
      typeof r.source !== 'string' ||
      typeof r.filename !== 'string' ||
      !/^[A-Za-z0-9_]+[.]go$/.test(r.filename)
    )
      return fail();
    text = r.source;
  } else {
    exact(r, ['binding', 'kind', 'answer']);
    const prepared = serializeMixedAnswer(r.answer, 262144);
    if (prepared.answer.kind !== r.kind) return fail();
    text = prepared.payload;
  }
  const bytes = new TextEncoder().encode(text);
  if (
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== text ||
    bytes.byteLength !== b.byteLength ||
    (await mentorBytesDigest(bytes)) !== b.answerSha256
  )
    return fail();
  return r as unknown as MentorReviewAnswer;
}
/** Existing evidence digest must be supplied. This never invents or persists review evidence. */
export function captureMentorReviewCommand(
  snapshot: MentorReviewSnapshot,
  answer: MentorReviewAnswer,
  draft: MentorReviewDraft,
  operationId: string,
): MentorReviewCommand {
  if (
    snapshot.score.intake.status === 'open' ||
    !snapshot.reviewWriteAvailable ||
    !mentorAnswerMatches(answer, snapshot)
  )
    return fail();
  const d = exact(captureMentorJson(draft), [
    'review',
    'evidenceDigest',
    'marks',
    ...(draft.review === 'secondary' ? ['primaryEventId'] : []),
  ]);
  if (d.review !== 'primary' && d.review !== 'secondary') return fail();
  const c = snapshot.context,
    primary = d.review === 'primary';
  if (
    c.actorUserId !== (primary ? c.assignment.primaryMentorId : c.assignment.eligibleMentorIds[1])
  )
    return fail();
  const h = snapshot.histories.find((h) => h.submissionId === answer.binding.submissionId);
  if (!h) return fail();
  if (
    !primary &&
    d.primaryEventId !== h.events.filter((e) => e.eventKind === 'primary').at(-1)?.eventId
  )
    return fail();
  return captureMentorJson({
    version: 1,
    review: d.review,
    attemptId: c.attempt.scope.attemptId,
    write: {
      operationId: id(operationId),
      submissionId: h.submissionId,
      expectedRevision: h.revision,
    },
    payload: {
      answerSha256: h.answerSha256,
      rubricDigest: c.rubric.digest,
      assignmentDigest: c.assignment.digest,
      evidenceDigest: digest(d.evidenceDigest),
      marks: captureMentorMarks(h.answerKind, d.marks),
      ...(!primary ? { primaryEventId: id(d.primaryEventId) } : {}),
    },
  }) as MentorReviewCommand;
}
