import type { ScoredExamReviewContext } from '../queries/scored-exam-review-context';
import {
  scoredExamOutcomeDigest,
  type ScoredExamOutcomeProjection,
  type ScoredExamAdjudicationPolicy,
  type ScoredExamAdjudicationBody,
  type ScoredExamFinalResult,
  type ScoredExamOutcomeState,
  type ScoredExamOutcomeClient,
  READ_SCORED_EXAM_OUTCOME_STATE_SQL,
  RECORD_SCORED_EXAM_ADJUDICATION_SQL,
  APPLY_SCORED_EXAM_OUTCOME_SQL,
  SCORED_EXAM_OUTCOME_WEB_READINESS_SQL,
  SCORED_EXAM_OUTCOME_APPLIER_READINESS_SQL,
} from '../queries/scored-exam-outcomes';
import {
  acceptance,
  contextFixture,
  id,
  hash,
  eventFixture,
  historyFixture,
  reviewClient,
} from './scored-exam-review-fixture';
export { id, hash };
export function completeReviewFixture() {
  const original = contextFixture();
  const acceptances = Array.from({ length: 8 }, (_, i) => acceptance(i + 1, i + 1, '2'));
  const context = { ...original, acceptances };
  const histories = acceptances.map((a) =>
    historyFixture(context, a, [
      eventFixture(context, a, 'functional', 1),
      eventFixture(context, a, 'primary', 2),
    ]),
  );
  return { context, histories };
}
export function projectionFixture(
  context: ScoredExamReviewContext = completeReviewFixture().context,
): ScoredExamOutcomeProjection {
  return {
    version: 1,
    scope: context.attempt.scope,
    snapshotDigest: context.snapshotDigest,
    assignmentDigest: context.assignment.digest,
    closure: context.completion
      ? {
          reason: 'finished',
          closedAtMicros: context.completion.completedAtMicros,
          closureOrdinal: context.completion.closureOrdinal,
        }
      : {
          reason: 'expired',
          closedAtMicros: context.attempt.deadlineAtMicros,
          closureOrdinal: '100',
        },
    acceptances: context.acceptances,
  };
}
export function policyFixture(
  p: ScoredExamOutcomeProjection = projectionFixture(),
): ScoredExamAdjudicationPolicy {
  return {
    version: 1,
    attemptId: p.scope.attemptId,
    snapshotDigest: p.snapshotDigest,
    rubricDigest: p.scope.rubricDigest,
    assignmentDigest: p.assignmentDigest,
    projectionDigest: scoredExamOutcomeDigest(p, '01coding-exam-outcome-projection'),
    initialThresholdReview: 'not_required',
    disputed: false,
    affectedSubmissionIds: [],
    evidenceDigest: hash('c'),
  };
}
export function adjudicationBodyFixture(
  p: ScoredExamOutcomeProjection = projectionFixture(),
): ScoredExamAdjudicationBody {
  const policy = policyFixture(p);
  return {
    version: 1,
    projectionDigest: policy.projectionDigest,
    priorOutcomeId: null,
    policy,
    decision: {
      selection: p.acceptances.map((a) => ({
        questionKey: a.questionKey,
        submissionId: a.submissionId,
      })),
      priorFinalVerdict: null,
      proposedVerdict: 'passed',
      disputed: false,
      initialThresholdReview: 'not_required',
      affectedSubmissionIds: [],
    },
  };
}
export function resultFixture(
  p: ScoredExamOutcomeProjection = projectionFixture(),
): ScoredExamFinalResult {
  return {
    version: 1,
    adjudicationId: id(900),
    projectionDigest: scoredExamOutcomeDigest(p, '01coding-exam-outcome-projection'),
    selection: p.acceptances.map((a) => ({
      questionKey: a.questionKey,
      submissionId: a.submissionId,
    })),
    questions: p.acceptances.map((a) => ({
      questionKey: a.questionKey,
      state: 'scored',
      submissionId: a.submissionId,
      answerSha256: a.answerSha256,
      points: ['q6', 'q7'].includes(a.questionKey) ? 5 : 15,
    })),
    totalPoints: 100,
    codingPoints: 75,
    verdict: 'passed',
    implementationDigest: hash('d'),
  };
}
export function outcomeStateFixture(
  adjudicated = false,
  final = false,
  p: ScoredExamOutcomeProjection = projectionFixture(),
): ScoredExamOutcomeState {
  const body = adjudicationBodyFixture(p),
    result = resultFixture(p),
    digest = scoredExamOutcomeDigest(p, '01coding-exam-outcome-projection');
  return {
    version: 1,
    projection: p,
    projectionDigest: digest,
    adjudication: adjudicated
      ? {
          id: id(900),
          revision: '1',
          operationId: id(700),
          projectionDigest: digest,
          expectedPriorOutcomeId: null,
          policyDigest: scoredExamOutcomeDigest(body.policy, '01coding-exam-adjudication-policy'),
          bodyDigest: scoredExamOutcomeDigest(body, '01coding-exam-adjudication'),
          body,
          current: true,
        }
      : null,
    currentOutcome: final
      ? {
          id: id(901),
          revision: '1',
          verdict: 'passed',
          totalPoints: 100,
          codingPoints: 75,
          projectionDigest: digest,
          adjudicationId: id(900),
          resultDigest: scoredExamOutcomeDigest(result, '01coding-exam-final-outcome'),
          implementationDigest: hash('d'),
          current: true,
        }
      : null,
  };
}
/** Fake SQL transport, never a PostgreSQL connection. */
export function outcomeClient(
  initial: ScoredExamOutcomeState = outcomeStateFixture(),
  hooks: {
    ready?: boolean;
    state?: (read: number) => unknown;
    record?: (parameters: readonly unknown[]) => unknown;
    apply?: (parameters: readonly unknown[]) => unknown;
  } = {},
) {
  const calls: { sql: string; parameters: readonly unknown[] }[] = [];
  let reads = 0;
  let state = initial;
  const client = {
    unsafe: async (sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      if (
        sql === SCORED_EXAM_OUTCOME_WEB_READINESS_SQL ||
        sql === SCORED_EXAM_OUTCOME_APPLIER_READINESS_SQL
      )
        return [{ ready: hooks.ready ?? true }];
      if (sql === READ_SCORED_EXAM_OUTCOME_STATE_SQL)
        return [{ data: structuredClone(hooks.state ? hooks.state(++reads) : state) }];
      if (sql === RECORD_SCORED_EXAM_ADJUDICATION_SQL) {
        if (hooks.record) return [{ data: await hooks.record(parameters) }];
        const body = JSON.parse(String(parameters[4])) as ScoredExamAdjudicationBody;
        return [
          {
            data: {
              kind: 'accepted',
              receipt: {
                id: id(900),
                attemptId: parameters[2],
                operationId: parameters[1],
                revision: '1',
                projectionDigest: body.projectionDigest,
                policyDigest: scoredExamOutcomeDigest(
                  body.policy,
                  '01coding-exam-adjudication-policy',
                ),
                bodyDigest: parameters[5],
              },
              replayed: false,
            },
          },
        ];
      }
      if (sql === APPLY_SCORED_EXAM_OUTCOME_SQL) {
        if (hooks.apply) return [{ data: await hooks.apply(parameters) }];
        const result = JSON.parse(String(parameters[5])) as ScoredExamFinalResult;
        return [
          {
            data: {
              kind: 'accepted',
              receipt: {
                id: id(901),
                attemptId: parameters[1],
                operationId: parameters[0],
                revision: '1',
                adjudicationId: parameters[2],
                projectionDigest: result.projectionDigest,
                resultDigest: parameters[6],
                verdict: result.verdict,
                totalPoints: result.totalPoints,
                codingPoints: result.codingPoints,
              },
              replayed: false,
            },
          },
        ];
      }
      throw new Error('Unexpected fake outcome SQL');
    },
  } as unknown as ScoredExamOutcomeClient;
  return {
    client,
    calls,
    setState: (next: ScoredExamOutcomeState) => {
      state = next;
    },
  };
}
export function combinedWebClient(
  initial = outcomeStateFixture(),
  hooks: Parameters<typeof outcomeClient>[1] = {},
) {
  const review = completeReviewFixture(),
    old = reviewClient(review.context, review.histories),
    outcomes = outcomeClient(initial, hooks);
  const client = {
    unsafe: async (sql: string, parameters: readonly unknown[] = []) =>
      sql === READ_SCORED_EXAM_OUTCOME_STATE_SQL ||
      sql === RECORD_SCORED_EXAM_ADJUDICATION_SQL ||
      sql === APPLY_SCORED_EXAM_OUTCOME_SQL ||
      sql === SCORED_EXAM_OUTCOME_WEB_READINESS_SQL ||
      sql === SCORED_EXAM_OUTCOME_APPLIER_READINESS_SQL
        ? outcomes.client.unsafe(sql, parameters as never[])
        : old.client.unsafe(sql, parameters as never[]),
  } as unknown as ScoredExamOutcomeClient;
  return { client, review, outcomes, old };
}
