import { describe, expect, it } from 'vitest';
import {
  EXAM_SCORING_POLICY,
  examIntakeState,
  examSecondReviewRequirement,
  scoreExamAttempt,
  validateExamScoringRubric,
  type ExamAdjudication,
  type ExamAnswerKind,
  type ExamAttempt,
  type ExamCompletionReceipt,
  type ExamFunctionalEvidence,
  type ExamManualMarks,
  type ExamManualReview,
  type ExamQuestionKey,
  type ExamQuestionSubmission,
  type ExamReviewerAssignment,
  type ExamScoringRubric,
} from '../exam-scoring';
import { CHECKPOINT_POLICY } from '../checkpoints';

// All groups, identities, digests and microsecond timestamps here are synthetic.
// These unequal weights test mechanics; they are not approved Exam1 item rubrics.
const uid = (n: number) => '00000000-0000-0000-0000-' + n.toString(16).padStart(12, '0');
const hash = (n: string) => n.repeat(64);
const opened = 1000000000000000n;
const deadline = opened + 10800000000n;
const keys: ExamQuestionKey[] = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'];
const kind = (q: ExamQuestionKey): ExamAnswerKind =>
  q === 'q8' ? 'debug_with_reason' : q === 'q6' || q === 'q7' ? 'trace_with_reason' : 'coding';
const scope = Object.freeze({
  learnerId: uid(1),
  cohortId: uid(2),
  attemptId: uid(3),
  form: 'A' as const,
  definitionDigest: hash('a'),
  rubricDigest: hash('b'),
});
const attempt: ExamAttempt = {
  scope,
  assignedAttemptNumber: 1,
  openedAtMicros: String(opened),
  deadlineAtMicros: String(deadline),
};
const rubric: ExamScoringRubric = {
  version: 1,
  form: 'A',
  definitionDigest: scope.definitionDigest,
  digest: scope.rubricDigest,
  questions: keys.map((questionKey) => ({
    questionKey,
    kind: kind(questionKey),
    publishedCriteriaDigest: hash('c'),
    groupBasis: 'fixed_semantic',
    functionalGroups:
      kind(questionKey) === 'trace_with_reason'
        ? []
        : [
            { key: 'semantic-a', points: questionKey === 'q8' ? 5 : 7, criteriaDigest: hash('d') },
            { key: 'semantic-b', points: questionKey === 'q8' ? 4 : 6, criteriaDigest: hash('e') },
          ],
  })),
};
const assignment: ExamReviewerAssignment = {
  scope,
  digest: hash('f'),
  primaryMentorId: uid(10),
  eligibleMentorIds: [uid(10), uid(11)],
};
const completion: ExamCompletionReceipt = {
  id: uid(4),
  scope,
  completedAtMicros: String(opened + 100n),
  closureOrdinal: '1000',
};
function marks(questionKey: ExamQuestionKey): ExamManualMarks {
  return kind(questionKey) === 'coding'
    ? { contract: 2 }
    : kind(questionKey) === 'trace_with_reason'
      ? { reason: 2 }
      : { counterexample: 4, explanation: 2 };
}
function review(
  record: Pick<ExamQuestionSubmission, 'id' | 'answerSha256' | 'questionKey'>,
  awarded: ExamManualMarks,
  reviewerId = assignment.primaryMentorId,
): ExamManualReview {
  return {
    submissionId: record.id,
    answerSha256: record.answerSha256,
    rubricDigest: scope.rubricDigest,
    assignmentDigest: assignment.digest,
    reviewerId,
    evidenceDigest: hash('a'),
    marks: awarded,
  };
}
function submission(
  questionKey: ExamQuestionKey,
  n: number,
  options: {
    outcomes?: readonly boolean[];
    marks?: ExamManualMarks;
    output?: boolean;
    ordinal?: string;
    acceptedAtMicros?: string;
    secondary?: ExamManualMarks;
  } = {},
): ExamQuestionSubmission {
  const identity = { id: uid(n), answerSha256: n.toString(16).padStart(64, '0'), questionKey };
  const functionalBinding = {
    submissionId: identity.id,
    questionKey,
    answerSha256: identity.answerSha256,
    rubricDigest: scope.rubricDigest,
    publishedCriteriaDigest: rubric.questions.find((q) => q.questionKey === questionKey)!
      .publishedCriteriaDigest,
  };
  const functional: ExamFunctionalEvidence =
    kind(questionKey) === 'trace_with_reason'
      ? {
          ...functionalBinding,
          kind: 'trace_output',
          evidenceDigest: hash('d'),
          matched: options.output ?? true,
        }
      : {
          ...functionalBinding,
          kind: 'groups',
          evidenceDigest: hash('d'),
          outcomes: [
            {
              groupKey: 'semantic-a',
              criteriaDigest: hash('d'),
              passed: options.outcomes?.[0] ?? true,
            },
            {
              groupKey: 'semantic-b',
              criteriaDigest: hash('e'),
              passed: options.outcomes?.[1] ?? true,
            },
          ],
        };
  const awarded = options.marks ?? marks(questionKey);
  return {
    ...identity,
    scope,
    kind: kind(questionKey),
    acceptedAtMicros: options.acceptedAtMicros ?? String(opened + 1n),
    acceptedOrdinal: options.ordinal ?? String(n),
    assessment: {
      state: 'finalized',
      functional,
      primary: review(identity, awarded),
      secondary:
        options.secondary === undefined ? null : review(identity, options.secondary, uid(11)),
    },
  };
}
type Input = Parameters<typeof scoreExamAttempt>[0];
function input(records: readonly ExamQuestionSubmission[] = []): Input {
  return {
    attempt,
    rubric,
    assignment,
    submissions: records,
    serverNowMicros: String(opened + 200n),
    completion,
    adjudication: null,
  };
}
function adjudicate(value: Input, change: Partial<ExamAdjudication> = {}): Input {
  const provisional = scoreExamAttempt(value);
  return {
    ...value,
    adjudication: {
      selection: provisional.selection,
      priorFinalVerdict: null,
      proposedVerdict:
        provisional.knownTotalPoints >= 60 && provisional.knownCodingPoints >= 45
          ? 'passed'
          : 'failed',
      disputed: false,
      initialThresholdReview: 'not_required',
      affectedSubmissionIds: [],
      ...change,
    },
  };
}
function mutable<T>(value: T): T {
  return structuredClone(value);
}

describe('approved Exam1 categories with explicit synthetic frozen rubric details', () => {
  it('retains the approved policy and leaves the old checkpoint policy unchanged', () => {
    expect(EXAM_SCORING_POLICY).toMatchObject({
      durationSeconds: 10800,
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
    expect(CHECKPOINT_POLICY.durationSeconds).toBe(5400);
    expect(CHECKPOINT_POLICY.taskCount).toBe(4);
    expect(Object.isFrozen(EXAM_SCORING_POLICY)).toBe(true);
  });

  it.each(['A', 'B', 'C', 'D'] as const)('requires explicit valid details for form %s', (form) => {
    const r = { ...rubric, form };
    expect(() => validateExamScoringRubric(r)).not.toThrow();
    const attemptForForm = { ...attempt, scope: { ...scope, form } };
    expect(
      scoreExamAttempt({
        ...input(),
        rubric: r,
        attempt: attemptForForm,
        assignment: { ...assignment, scope: attemptForForm.scope },
        completion: null,
        serverNowMicros: String(opened),
      }).status,
    ).toBe('in_progress');
  });

  it.each([
    null,
    undefined,
    {},
    { ...rubric, questions: [] },
    { ...rubric, questions: [...rubric.questions.slice(0, 7), rubric.questions[0]] },
  ])('fails closed on missing or incomplete detailed rubric %j', (bad) => {
    expect(() => validateExamScoringRubric(bad as ExamScoringRubric)).toThrow('EXAM_RUBRIC');
  });

  it('rejects wrong totals, duplicate groups, fractional/zero weights and raw-case ratios', () => {
    for (const group of [
      { key: 'semantic-a', points: 8, criteriaDigest: hash('d') },
      { key: 'semantic-b', points: 7, criteriaDigest: hash('d') },
      { key: 'semantic-a', points: 7.5, criteriaDigest: hash('d') },
      { key: 'semantic-a', points: 0, criteriaDigest: hash('d') },
      { key: 'semantic-a', points: 7, criteriaDigest: hash('d'), caseRatio: 0.5 },
    ]) {
      const r = mutable(rubric);
      const q = r.questions[0]!;
      const bad = {
        ...r,
        questions: [
          { ...q, functionalGroups: [group, q.functionalGroups[1]!] },
          ...r.questions.slice(1),
        ],
      };
      expect(() => validateExamScoringRubric(bad)).toThrow('EXAM_RUBRIC');
    }
    expect(() =>
      validateExamScoringRubric({
        ...rubric,
        questions: rubric.questions.map((q) =>
          q.questionKey === 'q8'
            ? { ...q, functionalGroups: [{ key: 'all', points: 13, criteriaDigest: hash('d') }] }
            : q,
        ),
      }),
    ).toThrow('EXAM_RUBRIC');
  });

  it('requires published criterion digests and matching question kinds', () => {
    for (const patch of [
      { publishedCriteriaDigest: '' },
      { kind: 'trace_with_reason' },
      { groupBasis: 'case_count' },
    ]) {
      const bad = {
        ...rubric,
        questions: [{ ...rubric.questions[0]!, ...patch }, ...rubric.questions.slice(1)],
      } as ExamScoringRubric;
      expect(() => validateExamScoringRubric(bad)).toThrow('EXAM_RUBRIC');
    }
  });

  it('awards full 100/75 only after closure and trusted initial adjudication', () => {
    const value = input(keys.map((q, i) => submission(q, 100 + i)));
    expect(scoreExamAttempt(value)).toMatchObject({
      status: 'provisional',
      knownTotalPoints: 100,
      knownCodingPoints: 75,
      totalPoints: null,
      reviewRequirement: 'adjudication_required',
    });
    expect(scoreExamAttempt(adjudicate(value))).toMatchObject({
      status: 'passed',
      totalPoints: 100,
      codingPoints: 75,
    });
  });

  it('applies both exact thresholds; neither threshold alone passes', () => {
    const coding45 = [submission('q1', 100), submission('q2', 101), submission('q3', 102)];
    const at60 = [
      ...coding45,
      submission('q6', 103),
      submission('q7', 104),
      submission('q8', 105, {
        outcomes: [true, false],
        marks: { counterexample: 0, explanation: 0 },
      }),
    ];
    expect(scoreExamAttempt(adjudicate(input(at60)))).toMatchObject({
      status: 'passed',
      totalPoints: 60,
      codingPoints: 45,
    });
    expect(scoreExamAttempt(adjudicate(input(coding45)))).toMatchObject({
      status: 'failed',
      totalPoints: 45,
      codingPoints: 45,
    });
    const coding44 = [
      ...coding45.slice(0, 2),
      submission('q3', 102, { marks: { contract: 1 } }),
      submission('q6', 103),
      submission('q7', 104),
      submission('q8', 105),
    ];
    expect(scoreExamAttempt(adjudicate(input(coding44)))).toMatchObject({
      status: 'failed',
      totalPoints: 69,
      codingPoints: 44,
    });
  });

  it('uses fixed unequal semantic weights and separate manual point categories', () => {
    const records = [
      submission('q1', 100, { outcomes: [true, false], marks: { contract: 1 } }),
      submission('q6', 101, { output: false, marks: { reason: 2 } }),
      submission('q8', 102, {
        outcomes: [false, true],
        marks: { counterexample: 3, explanation: 1 },
      }),
    ];
    const result = scoreExamAttempt(adjudicate(input(records)));
    expect(result.questions.find((q) => q.questionKey === 'q1')!.points).toBe(8);
    expect(result.questions.find((q) => q.questionKey === 'q6')!.points).toBe(2);
    expect(result.questions.find((q) => q.questionKey === 'q8')!.points).toBe(8);
  });

  it('never combines functional groups or manual fields across whole snapshots', () => {
    const records = [
      submission('q1', 100, { outcomes: [true, false], marks: { contract: 0 } }),
      submission('q1', 101, { outcomes: [false, true], marks: { contract: 2 } }),
      submission('q8', 102, { marks: { counterexample: 4, explanation: 0 } }),
      submission('q8', 103, { marks: { counterexample: 2, explanation: 2 } }),
    ];
    const result = scoreExamAttempt(adjudicate(input(records)));
    expect(result.questions[0]).toMatchObject({ submissionId: uid(101), points: 8 });
    expect(result.questions[7]).toMatchObject({ submissionId: uid(103), points: 13 });
    expect(result.knownTotalPoints).toBe(21);
  });

  it('breaks ties using exact authoritative BIGINT ordinals, never timestamp/UUID order', () => {
    const a = submission('q1', 200, { ordinal: '9007199254740992' });
    const b = submission('q1', 100, { ordinal: '9007199254740993' });
    const value = { ...input([b, a]), completion: null, serverNowMicros: String(deadline) };
    expect(scoreExamAttempt(adjudicate(value)).questions[0]!.submissionId).toBe(b.id);
  });

  it.each(['', '0', '01', '+1', '1.0', '9223372036854775808', undefined, 1])(
    'rejects unproven or malformed acceptance order %s',
    (ordinal) => {
      const bad = { ...submission('q1', 100), acceptedOrdinal: ordinal } as ExamQuestionSubmission;
      expect(() => scoreExamAttempt(input([bad]))).toThrow('EXAM_ORDER_OR_TIME');
    },
  );

  it('rejects duplicate acceptance orders and duplicate current receipt rows', () => {
    expect(() =>
      scoreExamAttempt(input([submission('q1', 100), submission('q2', 101, { ordinal: '100' })])),
    ).toThrow('EXAM_ACCEPTANCE_ORDER');
    const row = submission('q1', 100);
    expect(() => scoreExamAttempt(input([row, row]))).toThrow('EXAM_SUBMISSION');
  });
});

describe('scope, immutable evidence and existing assigned mentor authority', () => {
  it.each([
    'learnerId',
    'cohortId',
    'attemptId',
    'form',
    'definitionDigest',
    'rubricDigest',
  ] as const)('rejects cross-boundary %s records', (field) => {
    const record = submission('q1', 100);
    const changed = {
      ...record,
      scope: {
        ...scope,
        [field]: field === 'form' ? 'B' : field.endsWith('Digest') ? hash('c') : uid(99),
      },
    };
    expect(() => scoreExamAttempt(input([changed as ExamQuestionSubmission]))).toThrow(
      'EXAM_SCOPE',
    );
  });

  it('binds rubric, reviewer assignment and review to the exact definition/answer/snapshot', () => {
    expect(() =>
      scoreExamAttempt({ ...input(), rubric: { ...rubric, digest: hash('a') } }),
    ).toThrow('EXAM_RUBRIC_BINDING');
    expect(() =>
      scoreExamAttempt({
        ...input(),
        assignment: { ...assignment, scope: { ...scope, attemptId: uid(99) } },
      }),
    ).toThrow('EXAM_SCOPE');
    for (const field of [
      'submissionId',
      'answerSha256',
      'rubricDigest',
      'assignmentDigest',
    ] as const) {
      const row = submission('q1', 100);
      if (row.assessment.state !== 'finalized') throw new Error('fixture');
      const bad = {
        ...row,
        assessment: {
          ...row.assessment,
          primary: {
            ...row.assessment.primary,
            [field]: field === 'submissionId' ? uid(99) : hash('c'),
          },
        },
      };
      expect(() => scoreExamAttempt(input([bad]))).toThrow('EXAM_REVIEW_IDENTITY');
    }
  });

  it('rejects learner self-review, an unassigned primary and identical secondary reviewer', () => {
    for (const reviewerId of [scope.learnerId, uid(11), uid(90)]) {
      const row = submission('q1', 100);
      if (row.assessment.state !== 'finalized') throw new Error('fixture');
      const bad = {
        ...row,
        assessment: { ...row.assessment, primary: { ...row.assessment.primary, reviewerId } },
      };
      expect(() => scoreExamAttempt(input([bad]))).toThrow('EXAM_REVIEW_IDENTITY');
    }
    const row = submission('q1', 100, { secondary: { contract: 2 } });
    const assessed = row.assessment;
    if (assessed.state !== 'finalized' || !assessed.secondary) throw new Error('fixture');
    expect(() =>
      scoreExamAttempt(
        input([
          {
            ...row,
            assessment: {
              ...assessed,
              secondary: { ...assessed.secondary!, reviewerId: uid(10) },
            },
          },
        ]),
      ),
    ).toThrow('EXAM_REVIEW_IDENTITY');
    expect(() =>
      scoreExamAttempt({
        ...input(),
        assignment: { ...assignment, eligibleMentorIds: [uid(10), scope.learnerId] },
      }),
    ).toThrow('EXAM_REVIEW_ASSIGNMENT');
  });

  it.each([
    { contract: 3 },
    { contract: 1.5 },
    { contract: -1 },
    { contract: 2, style: 1 },
    { role: 'mentor', contract: 2 },
  ])('rejects invented or client-shaped manual categories %j', (bad) => {
    expect(() =>
      scoreExamAttempt(
        input([
          submission('q1', 100, {
            marks: bad as ExamManualMarks,
          }),
        ]),
      ),
    ).toThrow('EXAM_REVIEW_MARKS');
  });

  it.each([
    ['submissionId', uid(999)],
    ['questionKey', 'q2'],
    ['answerSha256', hash('c')],
    ['rubricDigest', hash('c')],
    ['publishedCriteriaDigest', hash('d')],
  ])('rejects functional evidence rebound across %s', (field, value) => {
    const row = submission('q1', 100);
    if (row.assessment.state !== 'finalized') throw new Error('fixture');
    for (const state of ['finalized', 'review_pending'] as const) {
      const functional = { ...row.assessment.functional, [field]: value };
      const assessment =
        state === 'finalized' ? { ...row.assessment, functional } : { state, functional };
      expect(() =>
        scoreExamAttempt(input([{ ...row, assessment } as ExamQuestionSubmission])),
      ).toThrow('EXAM_FUNCTIONAL_EVIDENCE');
    }
  });

  it('binds each functional group outcome to its frozen criterion digest', () => {
    const row = submission('q1', 100);
    const assessment = row.assessment;
    if (assessment.state !== 'finalized') throw new Error('fixture');
    const functional = assessment.functional;
    if (functional.kind !== 'groups') throw new Error('fixture');
    const rebound = {
      ...functional,
      outcomes: functional.outcomes.map((outcome, i) =>
        i === 0 ? { ...outcome, criteriaDigest: hash('f') } : outcome,
      ),
    };
    expect(() =>
      scoreExamAttempt(input([{ ...row, assessment: { ...assessment, functional: rebound } }])),
    ).toThrow('EXAM_FUNCTIONAL_EVIDENCE');
  });

  it('requires exact semantic group evidence and rejects direct caller point overrides', () => {
    const row = submission('q1', 100);
    if (row.assessment.state !== 'finalized' || row.assessment.functional.kind !== 'groups')
      throw new Error('fixture');
    const evidence = row.assessment.functional;
    for (const outcomes of [
      [evidence.outcomes[0]!],
      [evidence.outcomes[0]!, evidence.outcomes[0]!],
      [{ groupKey: 'unknown', passed: true }, evidence.outcomes[1]!],
      [{ groupKey: 'semantic-a', passed: 1 }, evidence.outcomes[1]!],
    ]) {
      const bad = {
        ...row,
        assessment: { ...row.assessment, functional: { ...evidence, outcomes } },
      } as ExamQuestionSubmission;
      expect(() => scoreExamAttempt(input([bad]))).toThrow('EXAM_FUNCTIONAL_EVIDENCE');
    }
    expect(() =>
      scoreExamAttempt(input([{ ...row, points: 15 } as ExamQuestionSubmission])),
    ).toThrow('EXAM_SUBMISSION');
  });
});

describe('question acceptance, explicit completion and deadline closure are distinct', () => {
  it('allows free question submission and completion without grades, answers or mentor review', () => {
    const state = examIntakeState(attempt, String(opened), null);
    expect(state).toEqual({
      status: 'open',
      canSubmitQuestion: true,
      canCompleteExam: true,
      autoSubmitDrafts: false,
    });
    const pending = {
      ...submission('q1', 100),
      assessment: { state: 'review_pending' as const, functional: null },
    };
    const result = scoreExamAttempt({ ...input([pending]), completion: null });
    expect(result.status).toBe('in_progress');
    expect(result.intake.canCompleteExam).toBe(true);
    expect(result.intake.canSubmitQuestion).toBe(true);
  });

  it('manual completion closes intake without creating missing question submissions', () => {
    const result = scoreExamAttempt(adjudicate(input()));
    expect(result.status).toBe('failed');
    expect(result.intake).toEqual({
      status: 'completed',
      canSubmitQuestion: false,
      canCompleteExam: false,
      autoSubmitDrafts: false,
    });
    expect(result.questions).toHaveLength(8);
    expect(
      result.questions.every(
        (q) => q.state === 'unsubmitted' && q.points === null && q.submissionId === null,
      ),
    ).toBe(true);
  });

  it('expiry closes intake and never auto-submits drafts or waits for a completion receipt', () => {
    const value = { ...input(), completion: null, serverNowMicros: String(deadline) };
    const result = scoreExamAttempt(adjudicate(value));
    expect(result.status).toBe('failed');
    expect(result.intake).toEqual({
      status: 'expired',
      canSubmitQuestion: false,
      canCompleteExam: false,
      autoSubmitDrafts: false,
    });
    expect(result.questions.every((q) => q.state === 'unsubmitted')).toBe(true);
  });

  it('keeps accepted pre-deadline submissions eligible for grading after the deadline', () => {
    const row = submission('q1', 100, { acceptedAtMicros: String(deadline - 1n) });
    const value = { ...input([row]), completion: null, serverNowMicros: String(deadline + 1n) };
    expect(scoreExamAttempt(adjudicate(value)).knownCodingPoints).toBe(15);
    expect(() =>
      scoreExamAttempt({ ...value, submissions: [{ ...row, acceptedAtMicros: String(deadline) }] }),
    ).toThrow('EXAM_ACCEPTANCE_WINDOW');
  });

  it('uses closure ordinal for simultaneous microsecond acceptance/completion', () => {
    const row = submission('q1', 100, {
      ordinal: '999',
      acceptedAtMicros: completion.completedAtMicros,
    });
    expect(scoreExamAttempt(adjudicate(input([row]))).knownCodingPoints).toBe(15);
    expect(() => scoreExamAttempt(input([{ ...row, acceptedOrdinal: '1000' }]))).toThrow(
      'EXAM_ACCEPTANCE_WINDOW',
    );
    expect(() =>
      scoreExamAttempt(input([{ ...row, acceptedAtMicros: String(opened + 101n) }])),
    ).toThrow('EXAM_ACCEPTANCE_WINDOW');
  });

  it('rejects alternate duration, automatic extra attempts and future completion data', () => {
    expect(() =>
      examIntakeState(
        { ...attempt, deadlineAtMicros: String(deadline + 1n) },
        String(opened),
        null,
      ),
    ).toThrow('EXAM_DURATION');
    expect(() =>
      examIntakeState(
        { ...attempt, assignedAttemptNumber: 2 } as unknown as ExamAttempt,
        String(opened),
        null,
      ),
    ).toThrow('EXAM_ATTEMPT');
    expect(() => examIntakeState(attempt, String(opened), completion)).toThrow('EXAM_COMPLETION');
    expect(() =>
      examIntakeState(attempt, String(deadline), {
        ...completion,
        completedAtMicros: String(deadline),
      }),
    ).toThrow('EXAM_COMPLETION');
  });
});

describe('provisional evidence, whole-snapshot selection and independent second review', () => {
  it.each(['pending', 'infrastructure_unknown', 'review_pending'] as const)(
    '%s is unresolved, never a zero or a new learner opportunity',
    (state) => {
      const known = submission('q1', 100);
      const uncertain = {
        ...submission('q1', 101),
        assessment: state === 'review_pending' ? { state, functional: null } : { state },
      };
      const value = input([known, uncertain]);
      const result = scoreExamAttempt(adjudicate(value));
      expect(result).toMatchObject({
        status: 'provisional',
        totalPoints: null,
        knownCodingPoints: 15,
        pendingSubmissionIds: [uncertain.id],
      });
      expect(result.questions[0]!.submissionId).toBe(known.id);
      expect(result.intake.canSubmitQuestion).toBe(false);
      const reconciled = scoreExamAttempt(adjudicate(input([known, submission('q1', 101)])));
      expect(reconciled.status).toBe('failed');
      expect(reconciled.questions[0]!.submissionId).toBe(uncertain.id);
      expect(reconciled.pendingSubmissionIds).toEqual([]);
    },
  );

  it.each([
    [null, 'passed', false, 'unresolved', 'adjudication_required'],
    [null, 'failed', false, 'required', 'required'],
    [null, 'passed', false, 'not_required', 'not_required'],
    ['failed', 'passed', false, 'not_required', 'required'],
    ['passed', 'failed', false, 'not_required', 'required'],
    ['passed', 'passed', false, 'unresolved', 'not_required'],
    ['failed', 'failed', true, 'not_required', 'required'],
  ] as const)(
    'compares prior verdict and dispute without inventing an initial threshold rule',
    (priorFinalVerdict, proposedVerdict, disputed, initialThresholdReview, expected) => {
      expect(
        examSecondReviewRequirement({
          priorFinalVerdict,
          proposedVerdict,
          disputed,
          initialThresholdReview,
        }),
      ).toBe(expected);
    },
  );

  it('requires explicit affected records and two independent agreeing eligible reviewers', () => {
    const row = submission('q1', 100);
    const required = adjudicate(input([row]), { disputed: true, affectedSubmissionIds: [row.id] });
    expect(scoreExamAttempt(required)).toMatchObject({
      status: 'provisional',
      reviewRequirement: 'required',
      secondaryReviewPendingIds: [row.id],
    });
    expect(scoreExamAttempt(adjudicate(input([row]), { disputed: true }))).toMatchObject({
      status: 'provisional',
      reviewRequirement: 'adjudication_required',
    });
    const reviewed = submission('q1', 100, { secondary: { contract: 2 } });
    expect(
      scoreExamAttempt(
        adjudicate(input([reviewed]), { disputed: true, affectedSubmissionIds: [reviewed.id] }),
      ),
    ).toMatchObject({
      status: 'failed',
      reviewRequirement: 'required',
      secondaryReviewPendingIds: [],
    });
  });

  it('keeps verdict-changing rejudgements provisional until independent review completes', () => {
    const records = keys.map((q, i) => submission(q, 100 + i));
    const value = adjudicate(input(records), {
      priorFinalVerdict: 'failed',
      affectedSubmissionIds: [records[0]!.id],
    });
    expect(scoreExamAttempt(value)).toMatchObject({
      status: 'provisional',
      reviewRequirement: 'required',
      secondaryReviewPendingIds: [records[0]!.id],
    });
  });

  it('does not hide disagreement when different debug components have the same total', () => {
    const row = submission('q8', 100, {
      marks: { counterexample: 4, explanation: 0 },
      secondary: { counterexample: 2, explanation: 2 },
    });
    expect(scoreExamAttempt(adjudicate(input([row])))).toMatchObject({
      status: 'provisional',
      secondaryReviewPendingIds: [row.id],
    });
  });

  it('rejects stale adjudication selection and unbound affected snapshot identities', () => {
    const value = adjudicate(input([submission('q1', 100)]));
    const replaced = submission('q1', 101);
    expect(() =>
      scoreExamAttempt({ ...value, submissions: [...value.submissions, replaced] }),
    ).toThrow('EXAM_ADJUDICATION_BINDING');
    expect(() =>
      scoreExamAttempt(
        adjudicate(input(value.submissions), {
          disputed: true,
          affectedSubmissionIds: [uid(999)],
        }),
      ),
    ).toThrow('EXAM_ADJUDICATION_BINDING');
  });

  it('does not mutate authoritative records and freezes returned policy projections', () => {
    const value = adjudicate(input([submission('q1', 100)]));
    const before = structuredClone(value);
    const result = scoreExamAttempt(value);
    expect(value).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.questions)).toBe(true);
    expect(Object.isFrozen(result.questions[0])).toBe(true);
    expect(Object.isFrozen(result.selection)).toBe(true);
  });
});
