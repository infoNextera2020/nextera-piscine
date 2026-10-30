/**
 * Pure Exam1 policy over authoritative server records only. This is not a request
 * parser, authentication boundary, evaluator, timer, persistence adapter or rubric.
 * Adapters must verify immutable hashes and server/reviewer authority before use.
 * No group weights, output normalization or runtime activation are inferred here.
 */
export const EXAM_SCORING_POLICY = Object.freeze({
  durationSeconds: 10800,
  codingQuestionPoints: 15,
  codingFunctionalPoints: 13,
  codingContractPoints: 2,
  traceOutputPoints: 3,
  traceReasonPoints: 2,
  debugRepairPoints: 9,
  debugCounterexamplePoints: 4,
  debugExplanationPoints: 2,
  passTotalPoints: 60,
  passCodingPoints: 45,
  assignedAttempts: 1,
  automaticRetake: false,
});

export type ExamForm = 'A' | 'B' | 'C' | 'D';
export type ExamQuestionKey = 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6' | 'q7' | 'q8';
export type ExamAnswerKind = 'coding' | 'trace_with_reason' | 'debug_with_reason';
export type ExamVerdict = 'passed' | 'failed';
export type ExamScope = Readonly<{
  learnerId: string;
  cohortId: string;
  attemptId: string;
  form: ExamForm;
  definitionDigest: string;
  rubricDigest: string;
}>;
export type ExamAttempt = Readonly<{
  scope: ExamScope;
  assignedAttemptNumber: 1;
  openedAtMicros: string;
  deadlineAtMicros: string;
}>;
export type ExamFunctionalGroup = Readonly<{
  key: string;
  points: number;
  criteriaDigest: string;
}>;
export type ExamQuestionRubric = Readonly<{
  questionKey: ExamQuestionKey;
  kind: ExamAnswerKind;
  publishedCriteriaDigest: string;
  groupBasis: 'fixed_semantic';
  functionalGroups: readonly ExamFunctionalGroup[];
}>;
export type ExamScoringRubric = Readonly<{
  version: 1;
  form: ExamForm;
  definitionDigest: string;
  digest: string;
  questions: readonly ExamQuestionRubric[];
}>;
export type ExamCompletionReceipt = Readonly<{
  id: string;
  scope: ExamScope;
  completedAtMicros: string;
  /** Same authoritative monotonic sequence as question acceptance, not a UUID/time sort. */
  closureOrdinal: string;
}>;
export type ExamReviewerAssignment = Readonly<{
  scope: ExamScope;
  digest: string;
  primaryMentorId: string;
  eligibleMentorIds: readonly string[];
}>;
export type ExamManualMarks =
  | Readonly<{ contract: number }>
  | Readonly<{ reason: number }>
  | Readonly<{ counterexample: number; explanation: number }>;
export type ExamManualReview = Readonly<{
  submissionId: string;
  answerSha256: string;
  rubricDigest: string;
  assignmentDigest: string;
  reviewerId: string;
  evidenceDigest: string;
  marks: ExamManualMarks;
}>;
export type ExamFunctionalBinding = Readonly<{
  submissionId: string;
  questionKey: ExamQuestionKey;
  answerSha256: string;
  rubricDigest: string;
  publishedCriteriaDigest: string;
}>;
export type ExamFunctionalEvidence = ExamFunctionalBinding &
  (
    | Readonly<{
        kind: 'groups';
        evidenceDigest: string;
        outcomes: readonly Readonly<{
          groupKey: string;
          criteriaDigest: string;
          passed: boolean;
        }>[];
      }>
    | Readonly<{ kind: 'trace_output'; evidenceDigest: string; matched: boolean }>
  );
export type ExamAssessment =
  | Readonly<{ state: 'pending' | 'infrastructure_unknown' }>
  | Readonly<{ state: 'review_pending'; functional: ExamFunctionalEvidence | null }>
  | Readonly<{
      state: 'finalized';
      functional: ExamFunctionalEvidence;
      primary: ExamManualReview;
      secondary: ExamManualReview | null;
    }>;
export type ExamQuestionSubmission = Readonly<{
  id: string;
  scope: ExamScope;
  questionKey: ExamQuestionKey;
  kind: ExamAnswerKind;
  answerSha256: string;
  acceptedAtMicros: string;
  /** Canonical positive PostgreSQL BIGINT decimal, supplied by server acceptance. */
  acceptedOrdinal: string;
  assessment: ExamAssessment;
}>;
export type ExamSelectionIdentity = Readonly<{
  questionKey: ExamQuestionKey;
  submissionId: string | null;
}>;
export type ExamAdjudication = Readonly<{
  selection: readonly ExamSelectionIdentity[];
  priorFinalVerdict: ExamVerdict | null;
  proposedVerdict: ExamVerdict;
  disputed: boolean;
  initialThresholdReview: 'required' | 'not_required' | 'unresolved';
  affectedSubmissionIds: readonly string[];
}>;
export type ExamQuestionScore = Readonly<{
  questionKey: ExamQuestionKey;
  state: 'unsubmitted' | 'unresolved' | 'scored';
  submissionId: string | null;
  answerSha256: string | null;
  points: number | null;
}>;
export class ExamScoringError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const questionKeys: readonly ExamQuestionKey[] = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const groupKey = /^[a-z][a-z0-9-]{0,79}$/;
const bigintMax = 9223372036854775807n;
function fail(code: string): never {
  throw new ExamScoringError(code);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: unknown, names: readonly string[]) {
  return (
    object(value) &&
    Reflect.ownKeys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  );
}
function id(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && digest.test(value);
}
function boundedInteger(value: unknown, max: number) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
}
function decimal(value: unknown, positive: boolean): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value))
    return fail('EXAM_ORDER_OR_TIME');
  const parsed = BigInt(value);
  if (parsed > bigintMax || (positive && parsed === 0n)) return fail('EXAM_ORDER_OR_TIME');
  return parsed;
}
function kindFor(key: ExamQuestionKey): ExamAnswerKind {
  return key === 'q8'
    ? 'debug_with_reason'
    : key === 'q6' || key === 'q7'
      ? 'trace_with_reason'
      : 'coding';
}
function validScope(scope: ExamScope) {
  if (
    !exact(scope, [
      'learnerId',
      'cohortId',
      'attemptId',
      'form',
      'definitionDigest',
      'rubricDigest',
    ]) ||
    !id(scope.learnerId) ||
    !id(scope.cohortId) ||
    !id(scope.attemptId) ||
    !['A', 'B', 'C', 'D'].includes(scope.form) ||
    !hash(scope.definitionDigest) ||
    !hash(scope.rubricDigest)
  )
    fail('EXAM_SCOPE');
}
function sameScope(a: ExamScope, b: ExamScope) {
  validScope(a);
  validScope(b);
  if (
    a.learnerId !== b.learnerId ||
    a.cohortId !== b.cohortId ||
    a.attemptId !== b.attemptId ||
    a.form !== b.form ||
    a.definitionDigest !== b.definitionDigest ||
    a.rubricDigest !== b.rubricDigest
  )
    fail('EXAM_SCOPE');
}
function attemptTimes(attempt: ExamAttempt) {
  if (
    !exact(attempt, ['scope', 'assignedAttemptNumber', 'openedAtMicros', 'deadlineAtMicros']) ||
    attempt.assignedAttemptNumber !== 1
  )
    fail('EXAM_ATTEMPT');
  validScope(attempt.scope);
  const opened = decimal(attempt.openedAtMicros, false);
  const deadline = decimal(attempt.deadlineAtMicros, false);
  if (deadline - opened !== 10800000000n) fail('EXAM_DURATION');
  return { opened, deadline };
}
export function validateExamScoringRubric(rubric: ExamScoringRubric): void {
  if (
    !exact(rubric, ['version', 'form', 'definitionDigest', 'digest', 'questions']) ||
    rubric.version !== 1 ||
    !['A', 'B', 'C', 'D'].includes(rubric.form) ||
    !hash(rubric.definitionDigest) ||
    !hash(rubric.digest) ||
    !Array.isArray(rubric.questions) ||
    rubric.questions.length !== 8
  )
    fail('EXAM_RUBRIC');
  const seen = new Set<string>();
  for (const question of rubric.questions) {
    if (
      !exact(question, [
        'questionKey',
        'kind',
        'publishedCriteriaDigest',
        'groupBasis',
        'functionalGroups',
      ]) ||
      !questionKeys.includes(question.questionKey) ||
      seen.has(question.questionKey) ||
      question.kind !== kindFor(question.questionKey) ||
      !hash(question.publishedCriteriaDigest) ||
      question.groupBasis !== 'fixed_semantic' ||
      !Array.isArray(question.functionalGroups)
    )
      fail('EXAM_RUBRIC');
    seen.add(question.questionKey);
    const names = new Set<string>();
    let total = 0;
    for (const group of question.functionalGroups) {
      if (
        !exact(group, ['key', 'points', 'criteriaDigest']) ||
        typeof group.key !== 'string' ||
        !groupKey.test(group.key) ||
        names.has(group.key) ||
        !boundedInteger(group.points, 13) ||
        group.points < 1 ||
        !hash(group.criteriaDigest)
      )
        fail('EXAM_RUBRIC');
      names.add(group.key);
      total += group.points;
    }
    const expected =
      question.kind === 'coding' ? 13 : question.kind === 'debug_with_reason' ? 9 : 0;
    if (total !== expected) fail('EXAM_RUBRIC');
  }
}
/** Completion is independent of submissions, grades and mentor availability. No draft is submitted. */
export function examIntakeState(
  attempt: ExamAttempt,
  serverNowMicros: string,
  completion: ExamCompletionReceipt | null,
) {
  const times = attemptTimes(attempt);
  const now = decimal(serverNowMicros, false);
  if (now < times.opened) fail('EXAM_CLOCK');
  if (completion !== null) {
    if (
      !exact(completion, ['id', 'scope', 'completedAtMicros', 'closureOrdinal']) ||
      !id(completion.id)
    )
      fail('EXAM_COMPLETION');
    sameScope(attempt.scope, completion.scope);
    const completed = decimal(completion.completedAtMicros, false);
    decimal(completion.closureOrdinal, true);
    if (completed < times.opened || completed >= times.deadline || completed > now)
      fail('EXAM_COMPLETION');
  }
  const status = completion !== null ? 'completed' : now >= times.deadline ? 'expired' : 'open';
  return Object.freeze({
    status,
    canSubmitQuestion: status === 'open',
    canCompleteExam: status === 'open',
    autoSubmitDrafts: false as const,
  });
}
function validateAssignment(assignment: ExamReviewerAssignment, scope: ExamScope) {
  if (
    !exact(assignment, ['scope', 'digest', 'primaryMentorId', 'eligibleMentorIds']) ||
    !hash(assignment.digest) ||
    !id(assignment.primaryMentorId) ||
    !Array.isArray(assignment.eligibleMentorIds) ||
    assignment.eligibleMentorIds.length < 2
  )
    fail('EXAM_REVIEW_ASSIGNMENT');
  sameScope(scope, assignment.scope);
  const eligible = new Set<string>();
  for (const mentor of assignment.eligibleMentorIds) {
    if (!id(mentor) || mentor === scope.learnerId || eligible.has(mentor))
      fail('EXAM_REVIEW_ASSIGNMENT');
    eligible.add(mentor);
  }
  if (!eligible.has(assignment.primaryMentorId)) fail('EXAM_REVIEW_ASSIGNMENT');
}
function marksTotal(marks: ExamManualMarks, kind: ExamAnswerKind) {
  if (kind === 'coding') {
    if (!exact(marks, ['contract']) || !('contract' in marks) || !boundedInteger(marks.contract, 2))
      return fail('EXAM_REVIEW_MARKS');
    return marks.contract;
  }
  if (kind === 'trace_with_reason') {
    if (!exact(marks, ['reason']) || !('reason' in marks) || !boundedInteger(marks.reason, 2))
      return fail('EXAM_REVIEW_MARKS');
    return marks.reason;
  }
  if (
    !exact(marks, ['counterexample', 'explanation']) ||
    !('counterexample' in marks) ||
    !boundedInteger(marks.counterexample, 4) ||
    !boundedInteger(marks.explanation, 2)
  )
    return fail('EXAM_REVIEW_MARKS');
  return marks.counterexample + marks.explanation;
}
function validateReview(
  review: ExamManualReview,
  submission: ExamQuestionSubmission,
  assignment: ExamReviewerAssignment,
  primary: boolean,
) {
  if (
    !exact(review, [
      'submissionId',
      'answerSha256',
      'rubricDigest',
      'assignmentDigest',
      'reviewerId',
      'evidenceDigest',
      'marks',
    ]) ||
    review.submissionId !== submission.id ||
    review.answerSha256 !== submission.answerSha256 ||
    review.rubricDigest !== submission.scope.rubricDigest ||
    review.assignmentDigest !== assignment.digest ||
    !hash(review.evidenceDigest) ||
    !id(review.reviewerId) ||
    review.reviewerId === submission.scope.learnerId ||
    !assignment.eligibleMentorIds.includes(review.reviewerId) ||
    (primary && review.reviewerId !== assignment.primaryMentorId) ||
    (!primary && review.reviewerId === assignment.primaryMentorId)
  )
    fail('EXAM_REVIEW_IDENTITY');
  return marksTotal(review.marks, submission.kind);
}
function functionalTotal(
  evidence: ExamFunctionalEvidence,
  rubric: ExamQuestionRubric,
  submission: ExamQuestionSubmission,
) {
  if (
    !object(evidence) ||
    !hash(evidence.evidenceDigest) ||
    evidence.submissionId !== submission.id ||
    evidence.questionKey !== submission.questionKey ||
    evidence.answerSha256 !== submission.answerSha256 ||
    evidence.rubricDigest !== submission.scope.rubricDigest ||
    evidence.publishedCriteriaDigest !== rubric.publishedCriteriaDigest
  )
    return fail('EXAM_FUNCTIONAL_EVIDENCE');
  const bindingKeys = [
    'submissionId',
    'questionKey',
    'answerSha256',
    'rubricDigest',
    'publishedCriteriaDigest',
  ] as const;
  if (rubric.kind === 'trace_with_reason') {
    if (
      !exact(evidence, [...bindingKeys, 'kind', 'evidenceDigest', 'matched']) ||
      evidence.kind !== 'trace_output' ||
      typeof evidence.matched !== 'boolean'
    )
      return fail('EXAM_FUNCTIONAL_EVIDENCE');
    return evidence.matched ? 3 : 0;
  }
  if (
    !exact(evidence, [...bindingKeys, 'kind', 'evidenceDigest', 'outcomes']) ||
    evidence.kind !== 'groups' ||
    !Array.isArray(evidence.outcomes) ||
    evidence.outcomes.length !== rubric.functionalGroups.length
  )
    return fail('EXAM_FUNCTIONAL_EVIDENCE');
  const seen = new Set<string>();
  let total = 0;
  for (const outcome of evidence.outcomes) {
    if (
      !exact(outcome, ['groupKey', 'criteriaDigest', 'passed']) ||
      typeof outcome.groupKey !== 'string' ||
      seen.has(outcome.groupKey) ||
      typeof outcome.passed !== 'boolean'
    )
      return fail('EXAM_FUNCTIONAL_EVIDENCE');
    const group = rubric.functionalGroups.find((candidate) => candidate.key === outcome.groupKey);
    if (!group || outcome.criteriaDigest !== group.criteriaDigest)
      return fail('EXAM_FUNCTIONAL_EVIDENCE');
    seen.add(outcome.groupKey);
    if (outcome.passed) total += group.points;
  }
  return total;
}
export function examSecondReviewRequirement(
  input: Readonly<{
    priorFinalVerdict: ExamVerdict | null;
    proposedVerdict: ExamVerdict;
    disputed: boolean;
    initialThresholdReview: 'required' | 'not_required' | 'unresolved';
  }>,
): 'required' | 'not_required' | 'adjudication_required' {
  if (
    !exact(input, ['priorFinalVerdict', 'proposedVerdict', 'disputed', 'initialThresholdReview']) ||
    (input.priorFinalVerdict !== null && !['passed', 'failed'].includes(input.priorFinalVerdict)) ||
    !['passed', 'failed'].includes(input.proposedVerdict) ||
    typeof input.disputed !== 'boolean' ||
    !['required', 'not_required', 'unresolved'].includes(input.initialThresholdReview)
  )
    return fail('EXAM_ADJUDICATION');
  if (
    input.disputed ||
    (input.priorFinalVerdict !== null && input.priorFinalVerdict !== input.proposedVerdict)
  )
    return 'required';
  if (input.priorFinalVerdict !== null) return 'not_required';
  return input.initialThresholdReview === 'unresolved'
    ? 'adjudication_required'
    : input.initialThresholdReview;
}
/**
 * One current authoritative assessment per immutable acceptance. An adapter
 * reconciles system errors on that same acceptance, without creating an attempt.
 */
export function scoreExamAttempt(
  input: Readonly<{
    attempt: ExamAttempt;
    rubric: ExamScoringRubric;
    assignment: ExamReviewerAssignment;
    submissions: readonly ExamQuestionSubmission[];
    serverNowMicros: string;
    completion: ExamCompletionReceipt | null;
    adjudication: ExamAdjudication | null;
  }>,
) {
  if (
    !exact(input, [
      'attempt',
      'rubric',
      'assignment',
      'submissions',
      'serverNowMicros',
      'completion',
      'adjudication',
    ]) ||
    !Array.isArray(input.submissions)
  )
    fail('EXAM_INPUT');
  const { attempt, rubric, assignment, submissions, completion } = input;
  const intake = examIntakeState(attempt, input.serverNowMicros, completion);
  validateExamScoringRubric(rubric);
  validateAssignment(assignment, attempt.scope);
  if (
    rubric.form !== attempt.scope.form ||
    rubric.definitionDigest !== attempt.scope.definitionDigest ||
    rubric.digest !== attempt.scope.rubricDigest
  )
    fail('EXAM_RUBRIC_BINDING');
  const times = attemptTimes(attempt);
  const now = decimal(input.serverNowMicros, false);
  const ids = new Set<string>();
  const orders = new Set<string>();
  const pending: string[] = [];
  const scored = new Map<
    string,
    {
      record: ExamQuestionSubmission;
      points: number;
      secondaryAgrees: boolean;
      disagreement: boolean;
    }
  >();
  const best = new Map<ExamQuestionKey, { record: ExamQuestionSubmission; points: number }>();
  for (const submission of submissions) {
    if (
      !exact(submission, [
        'id',
        'scope',
        'questionKey',
        'kind',
        'answerSha256',
        'acceptedAtMicros',
        'acceptedOrdinal',
        'assessment',
      ]) ||
      !id(submission.id) ||
      ids.has(submission.id) ||
      !questionKeys.includes(submission.questionKey) ||
      submission.kind !== kindFor(submission.questionKey) ||
      !hash(submission.answerSha256)
    )
      fail('EXAM_SUBMISSION');
    sameScope(attempt.scope, submission.scope);
    const order = decimal(submission.acceptedOrdinal, true);
    if (orders.has(submission.acceptedOrdinal)) fail('EXAM_ACCEPTANCE_ORDER');
    orders.add(submission.acceptedOrdinal);
    ids.add(submission.id);
    const accepted = decimal(submission.acceptedAtMicros, false);
    if (
      accepted < times.opened ||
      accepted >= times.deadline ||
      accepted > now ||
      (completion !== null &&
        (order >= decimal(completion.closureOrdinal, true) ||
          accepted > decimal(completion.completedAtMicros, false)))
    )
      fail('EXAM_ACCEPTANCE_WINDOW');
    const questionRubric = rubric.questions.find((q) => q.questionKey === submission.questionKey)!;
    const assessment: ExamAssessment = submission.assessment;
    if (!object(assessment)) fail('EXAM_ASSESSMENT');
    if (assessment.state === 'pending' || assessment.state === 'infrastructure_unknown') {
      if (!exact(assessment, ['state'])) fail('EXAM_ASSESSMENT');
      pending.push(submission.id);
      continue;
    }
    if (assessment.state === 'review_pending') {
      if (!exact(assessment, ['state', 'functional'])) fail('EXAM_ASSESSMENT');
      if (assessment.functional !== null)
        functionalTotal(assessment.functional, questionRubric, submission);
      pending.push(submission.id);
      continue;
    }
    if (
      assessment.state !== 'finalized' ||
      !exact(assessment, ['state', 'functional', 'primary', 'secondary'])
    )
      fail('EXAM_ASSESSMENT');
    const manual = validateReview(assessment.primary, submission, assignment, true);
    const secondary =
      assessment.secondary === null
        ? null
        : validateReview(assessment.secondary, submission, assignment, false);
    const points = functionalTotal(assessment.functional, questionRubric, submission) + manual;
    // Compare components, not only their total: debug marks must not cancel out a disagreement.
    const marksAgree =
      assessment.secondary !== null &&
      Object.entries(assessment.primary.marks).every(
        ([key, value]) =>
          (assessment.secondary!.marks as unknown as Record<string, number>)[key] === value,
      );
    scored.set(submission.id, {
      record: submission,
      points,
      secondaryAgrees: secondary !== null && marksAgree,
      disagreement: secondary !== null && !marksAgree,
    });
    const previous = best.get(submission.questionKey);
    if (
      !previous ||
      points > previous.points ||
      (points === previous.points && order > decimal(previous.record.acceptedOrdinal, true))
    )
      best.set(submission.questionKey, { record: submission, points });
  }
  const questions: ExamQuestionScore[] = questionKeys.map((questionKey) => {
    const selected = best.get(questionKey);
    return Object.freeze(
      selected
        ? {
            questionKey,
            state: 'scored',
            submissionId: selected.record.id,
            answerSha256: selected.record.answerSha256,
            points: selected.points,
          }
        : {
            questionKey,
            state: submissions.some((s) => s.questionKey === questionKey)
              ? 'unresolved'
              : 'unsubmitted',
            submissionId: null,
            answerSha256: null,
            points: null,
          },
    );
  });
  const selection = Object.freeze(
    questions.map((q) =>
      Object.freeze({ questionKey: q.questionKey, submissionId: q.submissionId }),
    ),
  );
  const knownTotalPoints = questions.reduce((sum, q) => sum + (q.points ?? 0), 0);
  const knownCodingPoints = questions.slice(0, 5).reduce((sum, q) => sum + (q.points ?? 0), 0);
  const proposedVerdict: ExamVerdict =
    knownTotalPoints >= 60 && knownCodingPoints >= 45 ? 'passed' : 'failed';
  let reviewRequirement: 'required' | 'not_required' | 'adjudication_required' =
    'adjudication_required';
  const secondaryReviewPending: string[] = [];
  if (input.adjudication !== null) {
    const decision = input.adjudication;
    if (
      !exact(decision, [
        'selection',
        'priorFinalVerdict',
        'proposedVerdict',
        'disputed',
        'initialThresholdReview',
        'affectedSubmissionIds',
      ]) ||
      !Array.isArray(decision.selection) ||
      decision.selection.length !== 8 ||
      decision.proposedVerdict !== proposedVerdict ||
      !Array.isArray(decision.affectedSubmissionIds)
    )
      fail('EXAM_ADJUDICATION');
    const decisionKeys = new Set<string>();
    for (const identity of decision.selection) {
      if (
        !exact(identity, ['questionKey', 'submissionId']) ||
        !questionKeys.includes(identity.questionKey) ||
        decisionKeys.has(identity.questionKey) ||
        selection.find((q) => q.questionKey === identity.questionKey)?.submissionId !==
          identity.submissionId
      )
        fail('EXAM_ADJUDICATION_BINDING');
      decisionKeys.add(identity.questionKey);
    }
    reviewRequirement = examSecondReviewRequirement({
      priorFinalVerdict: decision.priorFinalVerdict,
      proposedVerdict: decision.proposedVerdict,
      disputed: decision.disputed,
      initialThresholdReview: decision.initialThresholdReview,
    });
    const affected = new Set<string>();
    for (const submissionId of decision.affectedSubmissionIds) {
      if (!id(submissionId) || affected.has(submissionId) || !scored.has(submissionId))
        fail('EXAM_ADJUDICATION_BINDING');
      affected.add(submissionId);
    }
    if (reviewRequirement === 'required' && affected.size === 0)
      reviewRequirement = 'adjudication_required';
    if (reviewRequirement === 'not_required' && affected.size !== 0)
      fail('EXAM_ADJUDICATION_BINDING');
    if (reviewRequirement === 'required')
      for (const submissionId of affected)
        if (!scored.get(submissionId)!.secondaryAgrees) secondaryReviewPending.push(submissionId);
  }
  // Any authoritative disagreement needs reconciliation, even on an older snapshot.
  for (const [submissionId, assessment] of scored)
    if (assessment.disagreement && !secondaryReviewPending.includes(submissionId))
      secondaryReviewPending.push(submissionId);
  const unresolved =
    pending.length > 0 ||
    reviewRequirement === 'adjudication_required' ||
    secondaryReviewPending.length > 0;
  const status =
    intake.status === 'open' ? 'in_progress' : unresolved ? 'provisional' : proposedVerdict;
  const final = status === 'passed' || status === 'failed';
  return Object.freeze({
    status,
    intake,
    questions: Object.freeze(questions),
    selection,
    knownTotalPoints,
    knownCodingPoints,
    totalPoints: final ? knownTotalPoints : null,
    codingPoints: final ? knownCodingPoints : null,
    pendingSubmissionIds: Object.freeze(pending),
    secondaryReviewPendingIds: Object.freeze(secondaryReviewPending),
    reviewRequirement,
  });
}
