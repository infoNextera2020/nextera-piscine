import 'server-only';
import { AccessDenied, assertRole, type DomainUser } from '@nextera/domain';
import { requireDomainUser, getDatabase } from '../../lib/auth/server';
import {
  configuredScoredExamReviewService,
  type ScoredExamReviewService,
} from '../../lib/checkpoints/scored-exam-review-service';
import { configuredScoredExamReviewArtifactPort } from '../../lib/checkpoints/scored-exam-review-artifacts';
import {
  configuredScoredExamOutcomeService,
  type createScoredExamOutcomeService,
} from '../../lib/checkpoints/scored-exam-outcome-service';
import {
  MentorReviewAccessError,
  captureMentorJson,
  parseMentorReviewAnswer,
  parseMentorReviewSnapshot,
  type MentorReviewAnswer,
  type MentorReviewIdentity,
  type MentorReviewSnapshot,
} from './scored-exam-review-contract';

type OutcomeReader = Pick<ReturnType<typeof createScoredExamOutcomeService>, 'read'>;
export type AssignedScoredExamReviewLoad =
  | Readonly<{
      kind: 'available';
      identity: MentorReviewIdentity;
      snapshot: MentorReviewSnapshot;
      answer: MentorReviewAnswer | null;
    }>
  | Readonly<{ kind: 'invalid_input' | 'forbidden' | 'unavailable' }>;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const stopped = (signal?: AbortSignal) => signal?.aborted === true;

/** Protected exact-selection server loader. No queue enumeration, write, role grant,
 * sample attempt or outcome application is performed. Existing pages do not mount it yet. */
export function createAssignedScoredExamReviewLoader(deps: {
  authenticate(): Promise<DomainUser>;
  review(): ScoredExamReviewService | null;
  outcomes?: (review: ScoredExamReviewService) => OutcomeReader | null;
}) {
  return async function load(
    input: Readonly<{ attemptId: string; submissionId?: string }>,
    signal?: AbortSignal,
  ): Promise<AssignedScoredExamReviewLoad> {
    const selection = (() => {
      try {
        const raw = captureMentorJson(input);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const value = raw as Record<string, unknown>;
        if (
          Object.keys(value).some((key) => !['attemptId', 'submissionId'].includes(key)) ||
          typeof value.attemptId !== 'string' ||
          !uuid.test(value.attemptId) ||
          (value.submissionId !== undefined &&
            (typeof value.submissionId !== 'string' || !uuid.test(value.submissionId)))
        )
          return null;
        return Object.freeze({
          attemptId: value.attemptId,
          submissionId: value.submissionId as string | undefined,
        });
      } catch {
        return null;
      }
    })();
    if (!selection) return { kind: 'invalid_input' };
    try {
      if (stopped(signal)) return { kind: 'unavailable' };
      const user = assertRole(await deps.authenticate(), ['operator', 'admin']);
      if (stopped(signal)) return { kind: 'unavailable' };
      const review = deps.review();
      if (!review) return { kind: 'unavailable' };
      let raw: unknown = await review.read(user.authUserId, selection.attemptId);
      if (stopped(signal)) return { kind: 'unavailable' };
      const context = (raw as { context?: { access?: string } })?.context;
      if (context?.access !== 'assigned_mentor') return { kind: 'forbidden' };
      if (deps.outcomes) {
        const outcome = deps.outcomes(review);
        if (!outcome) return { kind: 'unavailable' };
        const result = await outcome.read(user.authUserId, selection.attemptId);
        if (stopped(signal)) return { kind: 'unavailable' };
        raw = {
          ...(raw as object),
          context: result.context,
          histories: result.histories,
          score: result.score,
          finalOutcomePersisted: result.finalOutcomePersisted,
          adjudicationPending: !result.state.adjudication?.current,
          adjudication: result.state.adjudication,
          currentOutcome: result.state.currentOutcome,
        };
      }
      const identity = Object.freeze({
        authUserId: user.authUserId,
        actorUserId: user.id,
        attemptId: selection.attemptId,
      });
      const snapshot = await parseMentorReviewSnapshot(raw, identity);
      if (stopped(signal)) return { kind: 'unavailable' };
      let answer: MentorReviewAnswer | null = null;
      if (selection.submissionId !== undefined) {
        const accepted = snapshot.context.acceptances.find(
          (a) => a.submissionId === selection.submissionId,
        );
        if (!accepted) return { kind: 'forbidden' };
        if (
          snapshot.score.intake.status === 'open' ||
          !(accepted.answerKind === 'coding'
            ? snapshot.answerReadAvailable
            : snapshot.structuredAnswerReadAvailable)
        )
          return { kind: 'unavailable' };
        const content = await review.readAnswer(
          user.authUserId,
          selection.attemptId,
          selection.submissionId,
          signal,
        );
        if (stopped(signal)) return { kind: 'unavailable' };
        answer = await parseMentorReviewAnswer(content, snapshot, selection.submissionId);
      }
      if (stopped(signal)) return { kind: 'unavailable' };
      return Object.freeze({ kind: 'available', identity, snapshot, answer });
    } catch (error) {
      if (
        error instanceof AccessDenied ||
        error instanceof MentorReviewAccessError ||
        (error && typeof error === 'object' && 'code' in error && error.code === 'forbidden')
      )
        return { kind: 'forbidden' };
      return { kind: 'unavailable' };
    }
  };
}

/** The same configured read services as the existing mentor API, with no applier client.
 * Construction reads no account/database; use is intentionally pending UI approval. */
export function loadAssignedScoredExamReview(
  input: Readonly<{ attemptId: string; submissionId?: string }>,
  signal?: AbortSignal,
) {
  return createAssignedScoredExamReviewLoader({
    authenticate: requireDomainUser,
    review: () =>
      configuredScoredExamReviewService(
        () => getDatabase().$client,
        process.env,
        () => configuredScoredExamReviewArtifactPort(process.env, fetch),
      ),
    ...(process.env.NEXTERA_SCORED_EXAM_OUTCOMES_V1 === '1'
      ? {
          outcomes: (review: ScoredExamReviewService) =>
            configuredScoredExamOutcomeService(
              {
                review,
                webClient: getDatabase().$client,
                applierClient: null,
                implementationDigest:
                  process.env.NEXTERA_SCORED_EXAM_OUTCOME_IMPLEMENTATION_DIGEST ?? '',
              },
              process.env,
            ),
        }
      : {}),
  })(input, signal);
}
