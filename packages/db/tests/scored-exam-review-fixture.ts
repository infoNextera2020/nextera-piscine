import { createHash } from 'node:crypto';
import type { ExamScoringRubric } from '@nextera/domain';
import {
  examScoringEventDigest,
  type ExamScoringHistory,
  type ExamScoringStoredEvent,
} from '../queries/exam-scoring-review';
import type {
  ScoredExamAcceptance,
  ScoredExamReviewContext,
  ScoredExamReviewAnswer,
} from '../queries/scored-exam-review-context';
import {
  READ_SCORED_EXAM_REVIEW_CONTEXT_SQL,
  READ_SCORED_EXAM_REVIEW_ANSWER_SQL,
  SCORED_EXAM_REVIEW_WRITE_CAPABILITY_SQL,
  type ScoredExamReviewClient,
} from '../queries/scored-exam-review-context';
import {
  READ_EXAM_SCORING_HISTORY_SQL,
  RECORD_EXAM_SCORING_EVENT_SQL,
} from '../queries/exam-scoring-review';
export const id = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
export const hash = (c = 'a') => c.repeat(64);
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.entries(v)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
      .join(',') +
    '}'
  );
}
export const framed = (v: unknown, domain: string) =>
  createHash('sha256')
    .update(domain + '\0v1\0' + canonical(v))
    .digest('hex');
export function contextFixture(): ScoredExamReviewContext {
  const body = {
    version: 1 as const,
    form: 'A' as const,
    definitionDigest: hash('d'),
    questions: Array.from({ length: 8 }, (_, i) => ({
      questionKey: `q${i + 1}` as ExamScoringRubric['questions'][number]['questionKey'],
      kind:
        i === 7
          ? ('debug_with_reason' as const)
          : i > 4
            ? ('trace_with_reason' as const)
            : ('coding' as const),
      publishedCriteriaDigest: hash('b'),
      groupBasis: 'fixed_semantic' as const,
      functionalGroups:
        i === 5 || i === 6
          ? []
          : [{ key: 'semantic', points: i === 7 ? 9 : 13, criteriaDigest: hash('c') }],
    })),
  };
  const rubric = { ...body, digest: framed(body, '01coding-exam-scoring-rubric') };
  const scope = {
    learnerId: id(1),
    cohortId: id(2),
    attemptId: id(3),
    form: 'A' as const,
    definitionDigest: body.definitionDigest,
    rubricDigest: rubric.digest,
  };
  const assignmentDigest = framed(
    {
      version: 1,
      attemptId: id(3),
      learnerId: id(1),
      cohortId: id(2),
      definitionDigest: body.definitionDigest,
      rubricDigest: rubric.digest,
      primaryMentorId: id(4),
      secondaryMentorId: id(5),
    },
    '01coding-exam-scoring-assignment',
  );
  return {
    version: 1,
    authUserId: id(101),
    actorUserId: id(4),
    access: 'assigned_mentor',
    attempt: {
      scope,
      assignedAttemptNumber: 1,
      openedAtMicros: '1000000',
      deadlineAtMicros: '10801000000',
    },
    snapshotDigest: hash('f'),
    rubric,
    assignment: {
      scope,
      digest: assignmentDigest,
      primaryMentorId: id(4),
      eligibleMentorIds: [id(4), id(5)],
    },
    completion: { id: id(3), scope, completedAtMicros: '2000000', closureOrdinal: '100' },
    serverNowMicros: '3000000',
    acceptances: [],
    adjudication: null,
  };
}
export function acceptance(
  question: number,
  serial = question,
  revision = '0',
): ScoredExamAcceptance {
  return {
    submissionId: id(1000 + serial),
    questionKey: `q${question}` as ScoredExamAcceptance['questionKey'],
    answerKind:
      question === 8
        ? 'debug_with_reason'
        : question === 6 || question === 7
          ? 'trace_with_reason'
          : 'coding',
    answerSha256: hash(String(serial % 10)),
    acceptedAtMicros: String(1500000 + serial),
    acceptedOrdinal: String(serial),
    revision,
  };
}
export function historyFixture(
  context: ScoredExamReviewContext,
  accepted: ScoredExamAcceptance,
  events: readonly ExamScoringStoredEvent[] = [],
): ExamScoringHistory {
  const s = context.attempt.scope;
  return {
    submissionId: accepted.submissionId,
    attemptId: s.attemptId,
    learnerId: s.learnerId,
    cohortId: s.cohortId,
    questionKey: accepted.questionKey,
    answerKind: accepted.answerKind,
    answerSha256: accepted.answerSha256,
    definitionDigest: s.definitionDigest,
    rubricDigest: s.rubricDigest,
    form: s.form,
    acceptedOrdinal: accepted.acceptedOrdinal,
    revision: String(events.length),
    status: 'provisional',
    events,
  };
}
export function eventFixture(
  context: ScoredExamReviewContext,
  accepted: ScoredExamAcceptance,
  kind: ExamScoringStoredEvent['eventKind'],
  revision: number,
  marks = 2,
  primaryEventId?: string,
): ExamScoringStoredEvent {
  const number = Number(accepted.acceptedOrdinal),
    q = context.rubric.questions.find((q) => q.questionKey === accepted.questionKey)!;
  const payload =
    kind === 'functional'
      ? {
          state: 'evaluated' as const,
          evidence: {
            submissionId: accepted.submissionId,
            questionKey: accepted.questionKey,
            answerSha256: accepted.answerSha256,
            rubricDigest: context.rubric.digest,
            publishedCriteriaDigest: q.publishedCriteriaDigest,
            evidenceDigest: hash('e'),
            ...(q.kind === 'trace_with_reason'
              ? { kind: 'trace_output' as const, matched: true }
              : {
                  kind: 'groups' as const,
                  outcomes: q.functionalGroups.map((g) => ({
                    groupKey: g.key,
                    criteriaDigest: g.criteriaDigest,
                    passed: true,
                  })),
                }),
          },
        }
      : {
          answerSha256: accepted.answerSha256,
          rubricDigest: context.rubric.digest,
          assignmentDigest: context.assignment.digest,
          evidenceDigest: hash('e'),
          marks:
            q.kind === 'coding'
              ? { contract: marks }
              : q.kind === 'trace_with_reason'
                ? { reason: marks }
                : { counterexample: 4, explanation: marks },
          ...(kind === 'secondary' ? { primaryEventId: primaryEventId! } : {}),
        };
  return {
    eventId: id(100000 + number * 100 + revision),
    operationId: id(200000 + number * 100 + revision),
    revision: String(revision),
    eventKind: kind,
    actorUserId: kind === 'functional' ? null : kind === 'primary' ? id(4) : id(5),
    payload,
    payloadDigest: examScoringEventDigest(payload),
  } as ExamScoringStoredEvent;
}
/** SQL transport double only; this never invokes a native database. */
export function reviewClient(
  context: ScoredExamReviewContext,
  histories: readonly ExamScoringHistory[] = [],
  hooks: {
    context?: (read: number) => unknown;
    record?: (parameters: readonly unknown[]) => unknown;
    capability?: boolean;
    answer?: (parameters: readonly unknown[]) => unknown;
  } = {},
) {
  const calls: { sql: string; parameters: readonly unknown[] }[] = [];
  let reads = 0;
  const client = {
    unsafe: async (sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      if (sql === SCORED_EXAM_REVIEW_WRITE_CAPABILITY_SQL)
        return [{ permitted: hooks.capability ?? true }];
      if (sql === READ_SCORED_EXAM_REVIEW_ANSWER_SQL && hooks.answer)
        return [{ data: structuredClone(hooks.answer(parameters)) }];
      if (sql === READ_SCORED_EXAM_REVIEW_CONTEXT_SQL)
        return [{ data: structuredClone(hooks.context ? hooks.context(++reads) : context) }];
      if (sql === READ_EXAM_SCORING_HISTORY_SQL)
        return [{ data: structuredClone(histories.find((h) => h.submissionId === parameters[1])) }];
      if (sql === RECORD_EXAM_SCORING_EVENT_SQL) {
        if (hooks.record) return [{ data: await hooks.record(parameters) }];
        return [
          {
            data: {
              kind: 'recorded',
              eventId: id(999),
              operationId: parameters[1],
              submissionId: parameters[2],
              revision: String(BigInt(String(parameters[3])) + 1n),
              payloadDigest: parameters[6],
              replayed: false,
            },
          },
        ];
      }
      throw new Error('Unexpected fake SQL');
    },
  } as unknown as ScoredExamReviewClient;
  return { client, calls };
}

export function reviewAnswerFixture(kind: ScoredExamReviewAnswer['answerKind'] = 'coding') {
  const c = contextFixture(),
    questionKey = kind === 'coding' ? 'q1' : kind === 'trace_with_reason' ? 'q6' : 'q8';
  const text =
    kind === 'coding'
      ? 'func F(a int) int { return a }\n'
      : kind === 'trace_with_reason'
        ? JSON.stringify({
            version: 1,
            kind,
            output: '0\n',
            reason: 'A zero value is printed.\u0000',
          })
        : JSON.stringify({
            version: 1,
            kind,
            source: 'func F(a int) int { return a }',
            explanation: 'Return the argument.',
            counterexample: 'A nonzero input.',
          });
  const bytes = Buffer.from(text),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  const ownerAuthUserId = id(100),
    requestId = id(500),
    maximum = 1024;
  const contract = {
    version: 1 as const,
    kind: kind === 'coding' ? ('trace_with_reason' as const) : kind,
    maxBytes: maximum,
    digest: createHash('sha256')
      .update(
        [
          '01coding-checkpoint-answer-contract-v1',
          id(1),
          id(2),
          id(3),
          questionKey,
          c.attempt.scope.definitionDigest,
          '1',
          kind,
          String(maximum),
        ].join('\n'),
      )
      .digest('hex'),
  };
  const answer: ScoredExamReviewAnswer = {
    version: 1,
    authUserId: c.authUserId,
    actorUserId: c.actorUserId,
    ownerAuthUserId,
    attemptId: id(3),
    submissionId: id(1001),
    requestId,
    learnerId: id(1),
    cohortId: id(2),
    questionKey,
    answerKind: kind,
    definitionDigest: c.attempt.scope.definitionDigest,
    snapshotDigest: c.snapshotDigest,
    rubricDigest: c.rubric.digest,
    answerSha256: sha256,
    byteLength: bytes.byteLength,
    source:
      kind === 'coding'
        ? {
            kind: 'stored_source',
            bucket: 'nextera-submissions',
            objectKey: `${ownerAuthUserId}/${id(2)}/${requestId}/${sha256}`,
            filename: 'f.go',
          }
        : {
            kind: 'structured_payload',
            payloadBase64: bytes.toString('base64'),
            answerContract: contract,
          },
  };
  return { answer, bytes, text };
}
