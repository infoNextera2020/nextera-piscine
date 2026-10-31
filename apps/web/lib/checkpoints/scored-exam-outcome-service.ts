import { scoreExamAttempt, type ExamAdjudication } from '@nextera/domain';
import {
  readScoredExamOutcomeState,
  recordScoredExamAdjudication,
  applyScoredExamOutcome,
  parseScoredExamAdjudicationPolicy,
  scoredExamOutcomeDigest,
  captureScoredExamFinalResult,
  type ScoredExamOutcomeClient,
  type ScoredExamOutcomeState,
  type ScoredExamOutcomeProjection,
  type ScoredExamAdjudicationPolicy,
  type ScoredExamAdjudicationBody,
  type ScoredExamFinalResult,
  ScoredExamOutcomeError,
} from '@nextera/db/scored-exam-outcomes';
import type {
  ScoredExamReviewService,
  ScoredExamReviewSnapshot,
} from './scored-exam-review-service';

export class ScoredExamOutcomeServiceError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'forbidden') {
    super('SCORED_EXAM_OUTCOME_' + code.toUpperCase());
  }
}
const fail = (code: ScoredExamOutcomeServiceError['code'] = 'unavailable'): never => {
  throw new ScoredExamOutcomeServiceError(code);
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
function id(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) return fail('invalid_input');
  return value;
}
function sameProjection(a: ScoredExamOutcomeState, b: ScoredExamOutcomeState) {
  return (
    a.projectionDigest === b.projectionDigest &&
    a.adjudication?.id === b.adjudication?.id &&
    a.adjudication?.revision === b.adjudication?.revision &&
    a.currentOutcome?.id === b.currentOutcome?.id &&
    a.currentOutcome?.revision === b.currentOutcome?.revision
  );
}
function bind(
  snapshot: ScoredExamReviewSnapshot,
  state: ScoredExamOutcomeState,
  context: Awaited<ReturnType<ScoredExamReviewService['readForOutcome']>>['context'],
) {
  const p = state.projection;
  const expected: ScoredExamOutcomeProjection = {
    version: 1,
    scope: snapshot.attempt.scope,
    snapshotDigest: context.snapshotDigest,
    assignmentDigest: snapshot.assignment.digest,
    closure: p.closure,
    acceptances: context.acceptances,
  };
  if (
    scoredExamOutcomeDigest(expected, '01coding-exam-outcome-projection') !== state.projectionDigest
  )
    return fail();
  if (p.closure) {
    if (BigInt(p.closure.closedAtMicros) > BigInt(snapshot.serverNowMicros)) return fail();
    if (p.closure.reason === 'finished') {
      if (
        !snapshot.completion ||
        snapshot.completion.completedAtMicros !== p.closure.closedAtMicros ||
        snapshot.completion.closureOrdinal !== p.closure.closureOrdinal
      )
        return fail();
    } else if (
      snapshot.completion !== null ||
      BigInt(p.closure.closedAtMicros) < BigInt(snapshot.attempt.deadlineAtMicros) ||
      BigInt(snapshot.serverNowMicros) < BigInt(snapshot.attempt.deadlineAtMicros)
    )
      return fail();
  } else if (snapshot.completion !== null) return fail();
}
function proposedVerdict(score: ReturnType<typeof scoreExamAttempt>) {
  return score.knownTotalPoints >= 60 && score.knownCodingPoints >= 45
    ? ('passed' as const)
    : ('failed' as const);
}
function finalResult(
  score: ReturnType<typeof scoreExamAttempt>,
  state: ScoredExamOutcomeState,
  implementationDigest: string,
): ScoredExamFinalResult {
  if (
    (score.status !== 'passed' && score.status !== 'failed') ||
    score.totalPoints === null ||
    score.codingPoints === null ||
    !state.adjudication
  )
    return fail();
  return captureScoredExamFinalResult({
    version: 1,
    adjudicationId: state.adjudication.id,
    projectionDigest: state.projectionDigest,
    selection: score.selection,
    questions: score.questions,
    totalPoints: score.totalPoints,
    codingPoints: score.codingPoints,
    verdict: score.status,
    implementationDigest,
  });
}
/** Configured clients only. Construction performs no I/O, login or key generation. */
export function createScoredExamOutcomeService(
  input: Readonly<{
    review: Pick<ScoredExamReviewService, 'readForOutcome'>;
    webClient: ScoredExamOutcomeClient;
    applierClient: ScoredExamOutcomeClient | null;
    implementationDigest: string;
    policies: readonly ScoredExamAdjudicationPolicy[];
  }>,
) {
  if (
    !input.review ||
    typeof input.review.readForOutcome !== 'function' ||
    !hash.test(input.implementationDigest)
  )
    return fail('invalid_input');
  const policies = Object.freeze(input.policies.map(parseScoredExamAdjudicationPolicy));
  const policyKeys = policies.map((p) => JSON.stringify([p.attemptId, p.projectionDigest]));
  if (new Set(policyKeys).size !== policyKeys.length) return fail('invalid_input');
  const review = input.review,
    web = input.webClient,
    applier = input.applierClient,
    implementation = input.implementationDigest;
  async function read(authUserId: string, attemptId: string) {
    const who = id(authUserId),
      attempt = id(attemptId);
    const bundle = await review.readForOutcome(who, attempt);
    const state = await readScoredExamOutcomeState(web, who, attempt);
    bind(bundle.snapshot, state, bundle.context);
    const policy =
      policies.find(
        (p) =>
          p.attemptId === attempt &&
          p.projectionDigest === state.projectionDigest &&
          p.snapshotDigest === state.projection.snapshotDigest &&
          p.assignmentDigest === state.projection.assignmentDigest &&
          p.rubricDigest === state.projection.scope.rubricDigest,
      ) ?? null;
    const authorizedAdjudication =
      policy !== null &&
      state.adjudication?.current === true &&
      scoredExamOutcomeDigest(policy, '01coding-exam-adjudication-policy') ===
        state.adjudication.policyDigest;
    const adjudication = authorizedAdjudication ? state.adjudication!.body.decision : null;
    const score = scoreExamAttempt({ ...bundle.snapshot, adjudication });
    const confirmed = await readScoredExamOutcomeState(web, who, attempt);
    if (!sameProjection(state, confirmed)) return fail();
    let finalOutcomePersisted = false;
    if (state.currentOutcome?.current && authorizedAdjudication) {
      const result = finalResult(score, state, state.currentOutcome.implementationDigest);
      if (
        scoredExamOutcomeDigest(result, '01coding-exam-final-outcome') !==
          state.currentOutcome.resultDigest ||
        result.verdict !== state.currentOutcome.verdict ||
        result.totalPoints !== state.currentOutcome.totalPoints ||
        result.codingPoints !== state.currentOutcome.codingPoints
      )
        return fail();
      finalOutcomePersisted = true;
    }
    return Object.freeze({
      context: bundle.context,
      histories: bundle.histories,
      state,
      snapshot: bundle.snapshot,
      score,
      policy,
      finalOutcomePersisted,
    });
  }
  return Object.freeze({
    read,
    async adjudicate(authUserId: string, attemptId: string, operationId: string) {
      const operation = id(operationId),
        value = await read(authUserId, attemptId);
      if (
        value.context.access !== 'assigned_mentor' ||
        value.context.actorUserId !== value.snapshot.assignment.primaryMentorId
      )
        return fail('forbidden');
      if (value.finalOutcomePersisted)
        return Object.freeze({
          kind: 'already_final' as const,
          outcomeId: value.state.currentOutcome!.id,
        });
      if (value.score.intake.status === 'open' || value.state.projection.closure === null)
        return Object.freeze({ kind: 'not_closed' as const });
      if (!value.policy) return Object.freeze({ kind: 'policy_unavailable' as const });
      if (value.score.pendingSubmissionIds.length || value.score.secondaryReviewPendingIds.length)
        return Object.freeze({ kind: 'provisional' as const });
      const decision: ExamAdjudication = Object.freeze({
        selection: value.score.selection,
        priorFinalVerdict: value.state.currentOutcome?.verdict ?? null,
        proposedVerdict: proposedVerdict(value.score),
        disputed: value.policy.disputed,
        initialThresholdReview: value.policy.initialThresholdReview,
        affectedSubmissionIds: value.policy.affectedSubmissionIds,
      });
      // Validate the generated policy/decision before creating immutable history.
      scoreExamAttempt({ ...value.snapshot, adjudication: decision });
      const body: ScoredExamAdjudicationBody = Object.freeze({
        version: 1,
        projectionDigest: value.state.projectionDigest,
        priorOutcomeId: value.state.currentOutcome?.id ?? null,
        policy: value.policy,
        decision,
      });
      if (
        value.state.adjudication?.current &&
        value.state.adjudication.bodyDigest ===
          scoredExamOutcomeDigest(body, '01coding-exam-adjudication')
      )
        return Object.freeze({
          kind: 'already_recorded' as const,
          adjudicationId: value.state.adjudication.id,
        });
      try {
        return await recordScoredExamAdjudication(web, {
          authUserId: id(authUserId),
          attemptId: id(attemptId),
          operationId: operation,
          expectedAdjudicationId: value.state.adjudication?.id ?? null,
          body,
        });
      } catch (error) {
        if (error instanceof ScoredExamOutcomeError && error.code === 'outcome_unknown')
          return Object.freeze({ kind: 'uncertain' as const, operationId: operation });
        throw error;
      }
    },
    async apply(authUserId: string, attemptId: string, operationId: string) {
      const operation = id(operationId),
        value = await read(authUserId, attemptId);
      if (
        value.context.access !== 'assigned_mentor' ||
        value.context.actorUserId !== value.snapshot.assignment.primaryMentorId
      )
        return fail('forbidden');
      if (value.finalOutcomePersisted)
        return Object.freeze({
          kind: 'already_final' as const,
          outcomeId: value.state.currentOutcome!.id,
        });
      if (!applier) return Object.freeze({ kind: 'unavailable' as const });
      if (
        !value.policy ||
        !value.state.adjudication?.current ||
        scoredExamOutcomeDigest(value.policy, '01coding-exam-adjudication-policy') !==
          value.state.adjudication.policyDigest
      )
        return Object.freeze({ kind: 'policy_unavailable' as const });
      if (value.score.status !== 'passed' && value.score.status !== 'failed')
        return Object.freeze({ kind: 'provisional' as const });
      const result = finalResult(value.score, value.state, implementation);
      try {
        const committed = await applyScoredExamOutcome(applier, {
          attemptId: id(attemptId),
          operationId: operation,
          adjudicationId: value.state.adjudication.id,
          expectedOutcomeId: value.state.currentOutcome?.id ?? null,
          implementationDigest: implementation,
          result,
        });
        if (committed.kind !== 'accepted') return committed;
        let current = false;
        try {
          const confirmed = await readScoredExamOutcomeState(web, id(authUserId), id(attemptId));
          current =
            confirmed.currentOutcome?.id === committed.receipt.id &&
            confirmed.currentOutcome.current;
        } catch {
          /* Acknowledged commit remains acknowledged; no false failure/retry. */
        }
        return Object.freeze({ ...committed, current });
      } catch (error) {
        if (error instanceof ScoredExamOutcomeError && error.code === 'outcome_unknown')
          return Object.freeze({ kind: 'uncertain' as const, operationId: operation });
        throw error;
      }
    },
  });
}
export type ScoredExamOutcomeService = ReturnType<typeof createScoredExamOutcomeService>;
/** Source-only opt-in. Missing explicit scoped policies/applier yields no constructed service. */
export function configuredScoredExamOutcomeService(
  input: Omit<Parameters<typeof createScoredExamOutcomeService>[0], 'policies'>,
  environment: Readonly<Record<string, string | undefined>>,
): ScoredExamOutcomeService | null {
  if (environment.NEXTERA_SCORED_EXAM_OUTCOMES_V1 !== '1') return null;
  try {
    const policies = JSON.parse(environment.NEXTERA_SCORED_EXAM_OUTCOME_POLICIES ?? '') as unknown;
    if (!Array.isArray(policies)) return null;
    return createScoredExamOutcomeService({
      ...input,
      policies: policies.map(parseScoredExamAdjudicationPolicy),
    });
  } catch {
    return null;
  }
}
