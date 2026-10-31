import {
  captureManualEvidenceCommand,
  readManualReviewDisplay,
  recordManualEvidence,
  type ManualReviewDisplay,
} from '@nextera/db/scored-exam-manual-evidence';
import {
  scoreExamAttempt,
  type ExamAssessment,
  type ExamManualReview,
  type ExamQuestionSubmission,
} from '@nextera/domain';
import {
  readScoredExamReviewContext,
  readScoredExamReviewAnswer,
  verifyScoredExamReviewWriteCapability,
  type ScoredExamReviewClient,
  type ScoredExamReviewContext,
} from '@nextera/db/scored-exam-review-context';
import {
  readExamScoringHistory,
  recordExamMentorReview,
  recordExamIndependentReview,
  type ExamFunctionalResult,
  type ExamMentorReviewPayload,
  type ExamSecondaryReviewPayload,
  type ExamScoringHistory,
  type ExamScoringStoredEvent,
  type ExamScoringWrite,
} from '@nextera/db/exam-scoring-review';
import {
  readScoredExamReviewArtifact,
  type ScoredExamReviewArtifactPort,
} from './scored-exam-review-artifacts';

export type ScoredExamReviewBodyPolicy = Readonly<{
  version: 1;
  maxBodyBytes: number;
  bodyTimeoutMs: number;
}>;
export class ScoredExamReviewServiceError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'forbidden') {
    super('SCORED_EXAM_REVIEW_' + code.toUpperCase());
  }
}
function fail(code: 'invalid_input' | 'unavailable' | 'forbidden' = 'unavailable'): never {
  throw new ScoredExamReviewServiceError(code);
}
function data(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid_input');
  const d = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(d).length !== names.length ||
    !names.every((name) => Object.hasOwn(d, name) && Object.hasOwn(d[name]!, 'value'))
  )
    return fail('invalid_input');
  return Object.fromEntries(names.map((name) => [name, d[name]!.value]));
}
function manual(
  event: ExamScoringStoredEvent,
  context: ScoredExamReviewContext,
  submissionId: string,
): ExamManualReview {
  const p = event.payload as ExamMentorReviewPayload;
  const expected =
    event.eventKind === 'primary'
      ? context.assignment.primaryMentorId
      : context.assignment.eligibleMentorIds[1];
  if (
    typeof event.actorUserId !== 'string' ||
    event.actorUserId !== expected ||
    p.assignmentDigest !== context.assignment.digest
  )
    return fail();
  return Object.freeze({
    submissionId,
    answerSha256: p.answerSha256,
    rubricDigest: p.rubricDigest,
    assignmentDigest: p.assignmentDigest,
    reviewerId: event.actorUserId,
    evidenceDigest: p.evidenceDigest,
    marks: p.marks,
  });
}
/** Immutable events are projected per acceptance, never merged across submissions. */
function assessment(history: ExamScoringHistory, context: ScoredExamReviewContext): ExamAssessment {
  let functional: ExamFunctionalResult | null = null;
  let primary: ExamScoringStoredEvent | null = null;
  const primaries = new Map<string, ExamScoringStoredEvent>();
  const secondary = new Map<string, ExamScoringStoredEvent>();
  for (const event of history.events) {
    if (event.eventKind === 'functional') functional = event.payload as ExamFunctionalResult;
    else if (event.eventKind === 'primary') {
      manual(event, context, history.submissionId);
      primaries.set(event.eventId, event);
      primary = event;
    } else {
      manual(event, context, history.submissionId);
      const reference = (event.payload as ExamSecondaryReviewPayload).primaryEventId;
      const referenced = primaries.get(reference);
      if (!referenced || BigInt(referenced.revision) >= BigInt(event.revision)) return fail();
      secondary.set(reference, event);
    }
  }
  if (functional === null) return Object.freeze({ state: 'pending' });
  if (functional.state === 'infrastructure_unknown')
    return Object.freeze({ state: 'infrastructure_unknown' });
  if (primary === null)
    return Object.freeze({ state: 'review_pending', functional: functional.evidence });
  const p = manual(primary, context, history.submissionId);
  const second = secondary.get(primary.eventId);
  const s = second ? manual(second, context, history.submissionId) : null;
  return Object.freeze({
    state: 'finalized',
    functional: functional.evidence,
    primary: Object.freeze(p),
    secondary: s ? Object.freeze(s) : null,
  });
}
function stable(context: ScoredExamReviewContext): string {
  return JSON.stringify({ ...context, serverNowMicros: null });
}
function assertHistory(
  history: ExamScoringHistory,
  context: ScoredExamReviewContext,
  index: number,
) {
  const accepted = context.acceptances[index]!;
  const scope = context.attempt.scope;
  if (
    history.submissionId !== accepted.submissionId ||
    history.attemptId !== scope.attemptId ||
    history.learnerId !== scope.learnerId ||
    history.cohortId !== scope.cohortId ||
    history.form !== scope.form ||
    history.definitionDigest !== scope.definitionDigest ||
    history.rubricDigest !== scope.rubricDigest ||
    history.questionKey !== accepted.questionKey ||
    history.answerKind !== accepted.answerKind ||
    history.answerSha256 !== accepted.answerSha256 ||
    history.acceptedOrdinal !== accepted.acceptedOrdinal ||
    history.revision !== accepted.revision
  )
    return fail();
}
export type ScoredExamReviewSnapshot = Readonly<
  Omit<Parameters<typeof scoreExamAttempt>[0], 'adjudication'>
>;
/** Pure projection of already verified native records; never an authentication boundary. */
export function assembleScoredExamReviewSnapshot(
  context: ScoredExamReviewContext,
  histories: readonly ExamScoringHistory[],
): ScoredExamReviewSnapshot {
  if (histories.length !== context.acceptances.length) return fail();
  const submissions: ExamQuestionSubmission[] = histories.map((history, i) => {
    assertHistory(history, context, i);
    return Object.freeze({
      id: history.submissionId,
      scope: context.attempt.scope,
      questionKey: history.questionKey as ExamQuestionSubmission['questionKey'],
      kind: history.answerKind,
      answerSha256: history.answerSha256,
      acceptedAtMicros: context.acceptances[i]!.acceptedAtMicros,
      acceptedOrdinal: history.acceptedOrdinal,
      assessment: assessment(history, context),
    });
  });
  const snapshot = Object.freeze({
    attempt: context.attempt,
    rubric: context.rubric,
    assignment: context.assignment,
    submissions: Object.freeze(submissions),
    serverNowMicros: context.serverNowMicros,
    completion: context.completion,
  });
  scoreExamAttempt({ ...snapshot, adjudication: null });
  return snapshot;
}
export function createScoredExamReviewService(
  input: Readonly<{
    client: ScoredExamReviewClient;
    bodyPolicy: ScoredExamReviewBodyPolicy;
    artifactReader?: ScoredExamReviewArtifactPort | null;
    manualCriteria?: Readonly<Record<string, string>>;
  }>,
) {
  const { client, bodyPolicy } = input;
  const parsedPolicy = parseScoredExamReviewBodyPolicy(bodyPolicy);
  if (!parsedPolicy) return fail('invalid_input');
  const artifactReader = input.artifactReader ?? null;
  const manualCriteria = input.manualCriteria ?? {};
  async function readForOutcome(authUserId: string, attemptId: string) {
    const context = await readScoredExamReviewContext(client, authUserId, attemptId);
    const histories: ExamScoringHistory[] = [];
    for (let i = 0; i < context.acceptances.length; i++) {
      const history = await readExamScoringHistory(
        client,
        authUserId,
        context.acceptances[i]!.submissionId,
      );
      assertHistory(history, context, i);
      histories.push(history);
    }
    const confirmed = await readScoredExamReviewContext(client, authUserId, attemptId);
    if (stable(confirmed) !== stable(context)) return fail();
    return Object.freeze({
      context: confirmed,
      histories: Object.freeze(histories),
      snapshot: assembleScoredExamReviewSnapshot(confirmed, histories),
    });
  }
  return Object.freeze({
    bodyPolicy: parsedPolicy,
    readForOutcome,
    async readManualReview(
      authUserId: string,
      context: ScoredExamReviewContext,
    ): Promise<ManualReviewDisplay | null> {
      try {
        return await readManualReviewDisplay(
          client,
          authUserId,
          context,
          input.manualCriteria ?? {},
        );
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'forbidden')
          return fail('forbidden');
        return null;
      }
    },
    async read(authUserId: string, attemptId: string) {
      const loaded = await readForOutcome(authUserId, attemptId);
      const score = scoreExamAttempt({ ...loaded.snapshot, adjudication: null });
      let writeAvailable = false;
      try {
        await verifyScoredExamReviewWriteCapability(client);
        writeAvailable =
          loaded.context.access === 'assigned_mentor' && score.intake.status !== 'open';
      } catch {
        /* Unproven privilege cannot enable a write. */
      }
      return Object.freeze({
        context: loaded.context,
        histories: loaded.histories,
        score,
        finalOutcomePersisted: false as const,
        adjudicationPending: true as const,
        reviewWriteAvailable: writeAvailable,
        answerReadAvailable:
          loaded.context.access === 'assigned_mentor' &&
          score.intake.status !== 'open' &&
          artifactReader !== null,
        structuredAnswerReadAvailable:
          loaded.context.access === 'assigned_mentor' && score.intake.status !== 'open',
      });
    },
    async readAnswer(
      authUserId: string,
      attemptId: string,
      submissionId: string,
      signal?: AbortSignal,
    ) {
      if (signal?.aborted) return fail();
      const answer = await readScoredExamReviewAnswer(client, authUserId, attemptId, submissionId);
      const content = await readScoredExamReviewArtifact(answer, artifactReader, signal);
      const confirmed = await readScoredExamReviewAnswer(
        client,
        authUserId,
        attemptId,
        submissionId,
      );
      if (signal?.aborted || JSON.stringify(confirmed) !== JSON.stringify(answer)) return fail();
      return content;
    },
    async review(authUserId: string, value: unknown, signal?: AbortSignal) {
      if (signal?.aborted) return fail();
      if (value && typeof value === 'object' && 'version' in value && value.version === 2) {
        const command = captureManualEvidenceCommand(value);
        await verifyScoredExamReviewWriteCapability(client);
        const context = await readScoredExamReviewContext(client, authUserId, command.attemptId);
        if (context.access !== 'assigned_mentor') return fail('forbidden');
        if (signal?.aborted) return fail();
        // Native wrapper independently hashes criteria for NEW writes. Null preserves exact retained replay only.
        return recordManualEvidence(
          client,
          authUserId,
          context,
          command,
          manualCriteria[context.rubric.digest] ?? null,
        );
      }
      const input = data(value, ['version', 'review', 'attemptId', 'write', 'payload']);
      if (
        input.version !== 1 ||
        typeof input.review !== 'string' ||
        !['primary', 'secondary'].includes(input.review) ||
        typeof input.attemptId !== 'string'
      )
        return fail('invalid_input');
      const w = data(input.write, ['operationId', 'submissionId', 'expectedRevision']);
      if (![w.operationId, w.submissionId, w.expectedRevision].every((v) => typeof v === 'string'))
        return fail('invalid_input');
      const write = w as unknown as ExamScoringWrite;
      await verifyScoredExamReviewWriteCapability(client);
      if (signal?.aborted) return fail();
      const context = await readScoredExamReviewContext(client, authUserId, input.attemptId);
      if (
        context.access !== 'assigned_mentor' ||
        context.actorUserId !==
          (input.review === 'primary'
            ? context.assignment.primaryMentorId
            : context.assignment.eligibleMentorIds[1])
      )
        return fail('forbidden');
      const accepted = context.acceptances.find((a) => a.submissionId === write.submissionId);
      if (!accepted) return fail('forbidden');
      if (
        context.completion === null &&
        BigInt(context.serverNowMicros) < BigInt(context.attempt.deadlineAtMicros)
      )
        return Object.freeze({ kind: 'review_not_open' as const });
      const p = data(input.payload, [
        'answerSha256',
        'rubricDigest',
        'assignmentDigest',
        'evidenceDigest',
        'marks',
        ...(input.review === 'secondary' ? ['primaryEventId'] : []),
      ]);
      if (
        p.answerSha256 !== accepted.answerSha256 ||
        p.rubricDigest !== context.rubric.digest ||
        p.assignmentDigest !== context.assignment.digest
      )
        return Object.freeze({ kind: 'conflict' as const });
      // Existing RPC checks closure, actor, payload, immutable replay identity and CAS.
      // Do not pre-reject an old expected revision: it may be an exact idempotent replay.
      if (signal?.aborted) return fail();
      return input.review === 'primary'
        ? recordExamMentorReview(client, authUserId, write, p as unknown as ExamMentorReviewPayload)
        : recordExamIndependentReview(
            client,
            authUserId,
            write,
            p as unknown as ExamSecondaryReviewPayload,
          );
    },
  });
}
export type ScoredExamReviewService = ReturnType<typeof createScoredExamReviewService>;

export function parseScoredExamReviewBodyPolicy(value: unknown): ScoredExamReviewBodyPolicy | null {
  try {
    const p = data(value, ['version', 'maxBodyBytes', 'bodyTimeoutMs']);
    if (
      p.version !== 1 ||
      ![p.maxBodyBytes, p.bodyTimeoutMs].every(
        (n) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= 2147483647,
      )
    )
      return null;
    return Object.freeze({
      version: 1,
      maxBodyBytes: p.maxBodyBytes as number,
      bodyTimeoutMs: p.bodyTimeoutMs as number,
    });
  } catch {
    return null;
  }
}

/** Request-time opt-in only; malformed/missing policy is unavailable, never defaults. */
export function configuredScoredExamReviewService(
  client: () => ScoredExamReviewClient,
  environment: Readonly<Record<string, string | undefined>>,
  artifactReader: () => ScoredExamReviewArtifactPort | null = () => null,
): ScoredExamReviewService | null {
  if (environment.NEXTERA_SCORED_EXAM_REVIEW_V1 !== '1') return null;
  try {
    const p = parseScoredExamReviewBodyPolicy(
      JSON.parse(environment.NEXTERA_SCORED_EXAM_REVIEW_POLICY ?? ''),
    );
    if (!p) return null;
    return createScoredExamReviewService({
      client: client(),
      bodyPolicy: p,
      artifactReader: artifactReader(),
      manualCriteria: configuredManualCriteria(environment.NEXTERA_SCORED_EXAM_MANUAL_CRITERIA_V1),
    });
  } catch {
    return null;
  }
}

/** Whole private approved documents only. Missing/malformed configuration never supplies draft prose. */
export function configuredManualCriteria(
  raw: string | undefined,
): Readonly<Record<string, string>> {
  try {
    const parsed = JSON.parse(raw ?? '');
    const p = data(parsed, ['version', 'documents']);
    if (
      p.version !== 1 ||
      !p.documents ||
      typeof p.documents !== 'object' ||
      Array.isArray(p.documents)
    )
      return {};
    const docs = Object.getOwnPropertyDescriptors(p.documents);
    if (
      Reflect.ownKeys(docs).some(
        (k) =>
          typeof k !== 'string' ||
          !/^[0-9a-f]{64}$/.test(k) ||
          !Object.hasOwn(docs[k]!, 'value') ||
          typeof docs[k]!.value !== 'string',
      )
    )
      return {};
    return Object.freeze(
      Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, d.value as string])),
    );
  } catch {
    return {};
  }
}
