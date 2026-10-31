import { checkpointScoredExamResult } from '../scored-exam-lifecycle';
import { describe, expect, it } from 'vitest';
import {
  checkpointLifecyclePolicy,
  checkpointScoringPolicy,
  type ScoredExamSourceDefinition,
} from '../checkpoints';
import { parseCheckpointView, type CheckpointView } from '../checkpoint-view';
import {
  checkpointExamMarker,
  checkpointScoredExamMetadata,
  checkpointScoredSubmissionCapability,
  checkpointExamAnswerKind,
} from '../scored-exam-lifecycle';

const hash = 'a'.repeat(64);
const metadata = () => ({
  version: 1 as const,
  form: 'A' as const,
  rubric_digest: hash,
  duration_seconds: 10800 as const,
  normal_attempts: 1 as const,
});
function source(): ScoredExamSourceDefinition {
  return {
    policyVersion: 3,
    durationSeconds: 10800,
    examScoring: { version: 1, form: 'A', rubricProfile: 'source-test-rubric' },
    tasks: Array.from({ length: 8 }, (_, index) => {
      const kind = checkpointExamAnswerKind(index),
        trace = kind === 'trace_with_reason';
      return {
        key: 'q' + (index + 1),
        title: 'Source fixture',
        subjectMarkdown: 'Synthetic fixture',
        subjectDigest: hash,
        configurationDigest: hash,
        answerFormat: { version: 1, kind },
        submissionRules: {
          required_files: trace ? [] : ['answer.go'],
          allowed_extensions: trace ? [] : ['.go'],
          max_size_kb: 1,
        },
        testPackId: trace ? null : 'fixture-' + index,
        declaredLimits: trace ? null : { timeout_ms: 1, memory_mb: 1, output_kb: 1 },
      };
    }),
  };
}
function view(): CheckpointView {
  return {
    scored_exam: metadata(),
    policy: null,
    server_now: '2026-11-01T12:10:00Z',
    eligible: true,
    replacement_available: false,
    attempt: {
      id: 'attempt',
      status: 'active',
      normal_slot: 1,
      kind: 'normal',
      started_at: '2026-11-01T12:00:00Z',
      deadline_at: '2026-11-01T15:00:00Z',
      completed_at: null,
      retake_at: null,
    },
    tasks: Array.from({ length: 8 }, (_, index) => {
      const kind = checkpointExamAnswerKind(index);
      return {
        key: 'q' + (index + 1),
        title: 'Source fixture',
        subject: 'Synthetic fixture',
        passed: index === 0,
        reserved: 100,
        answer_format: { version: 1, kind },
        rules: {
          required_files: kind === 'trace_with_reason' ? [] : ['answer.go'],
          max_size_kb: 1,
        },
        submission: {
          version: 1,
          allowed: true,
          status: 'open',
          authority: kind === 'coding' ? 'scored_exam_intake_v1' : 'checkpoint_answers_v1',
        },
      };
    }),
    submissions: [],
    history: [],
  };
}
describe('marked Exam1 lifecycle is distinct from legacy pass/quota policy', () => {
  it('uses 180 minutes, one attempt and no replacement without inventing an allowance', () => {
    expect(checkpointLifecyclePolicy(source())).toEqual({
      version: 3,
      durationSeconds: 10800,
      normalAttempts: 1,
      replacementAllowed: false,
      taskCount: 8,
    });
    expect(checkpointLifecyclePolicy(source())).not.toHaveProperty('taskQuota');
    expect(() => checkpointScoringPolicy(source())).toThrow('CHECKPOINT_POLICY');
  });
  it.each([5400, 7200, 10801])('rejects an unapproved duration %s', (duration) =>
    expect(() =>
      checkpointLifecyclePolicy({
        ...source(),
        durationSeconds: duration,
      } as ScoredExamSourceDefinition),
    ).toThrow(),
  );
  it('requires ordered five coding, two trace, one debug and no trace Go artifact', () => {
    const value = source();
    value.tasks[5]!.testPackId = 'invented-go-pack';
    expect(() => checkpointLifecyclePolicy(value)).toThrow();
    const other = source();
    other.tasks.reverse();
    expect(() => checkpointLifecyclePolicy(other)).toThrow();
    const missing = source();
    missing.tasks.pop();
    expect(() => checkpointLifecyclePolicy(missing)).toThrow();
  });
  it('preserves the exact legacy policy', () =>
    expect(
      checkpointLifecyclePolicy({
        policyVersion: 1,
        durationSeconds: 5400,
        tasks: Array.from({ length: 4 }, () => ({}) as never),
      }),
    ).toEqual({
      version: 1,
      durationSeconds: 5400,
      normalAttempts: 2,
      replacementAllowed: true,
      taskCount: 4,
    }));
});
describe('server-owned scored Exam1 metadata', () => {
  it('accepts exactnative and wire shapes', () => {
    expect(checkpointExamMarker({ version: 1, form: 'A', rubricDigest: hash })).toEqual({
      version: 1,
      form: 'A',
      rubricDigest: hash,
    });
    expect(checkpointScoredExamMetadata(metadata())).toEqual(metadata());
    expect(checkpointScoredExamMetadata(undefined)).toBeNull();
    expect(checkpointScoredExamMetadata(null)).toBeNull();
  });
  it.each([
    { duration_seconds: 5400 },
    { normal_attempts: 2 },
    { form: 'E' },
    { rubric_digest: 'x' },
    { extra: true },
  ])('rejects malformed or unknown metadata %#', (patch) =>
    expect(() => checkpointScoredExamMetadata({ ...metadata(), ...patch })).toThrow(),
  );
  it('does not execute an accessor or accept inherited required fields', () => {
    let ran = false;
    const getter = { ...metadata() };
    Object.defineProperty(getter, 'form', {
      get() {
        ran = true;
        return 'A';
      },
    });
    expect(() => checkpointScoredExamMetadata(getter)).toThrow();
    expect(ran).toBe(false);
    const inherited = Object.assign(Object.create({ form: 'A' }), {
      version: 1,
      rubricDigest: hash,
      extra: true,
    });
    expect(() => checkpointExamMarker(inherited)).toThrow();
  });
  it('keeps authority kind-specific and closed/unavailable denied', () => {
    expect(
      checkpointScoredSubmissionCapability(
        { version: 1, allowed: false, status: 'unavailable', authority: 'checkpoint_answers_v1' },
        'trace_with_reason',
      ).allowed,
    ).toBe(false);
    expect(() =>
      checkpointScoredSubmissionCapability(
        { version: 1, allowed: true, status: 'closed', authority: 'scored_exam_intake_v1' },
        'coding',
      ),
    ).toThrow();
    expect(() =>
      checkpointScoredSubmissionCapability(
        { version: 1, allowed: true, status: 'open', authority: 'scored_exam_intake_v1' },
        'debug_with_reason',
      ),
    ).toThrow();
  });
});
describe('actual markedCheckpoint read contract', () => {
  it('retains authoritative allowed resubmission even when passed or more than three reserved', () => {
    const value = view();
    expect(parseCheckpointView(value).tasks[0]!.submission?.allowed).toBe(true);
    expect(value.tasks[0]!.passed).toBe(true);
    expect(value.tasks[0]!.reserved).toBe(100);
  });
  it('allows metadata before start without exposing questions', () => {
    const value = view();
    value.attempt = null;
    value.tasks = [];
    expect(parseCheckpointView(value).tasks).toEqual([]);
    value.tasks = view().tasks;
    expect(() => parseCheckpointView(value)).toThrow();
  });
  it('requires all eight kinds and explicitnative capabilities', () => {
    const missing = view();
    delete missing.tasks[0]!.submission;
    expect(() => parseCheckpointView(missing)).toThrow();
    const swapped = view();
    swapped.tasks[5]!.answer_format = { version: 1, kind: 'coding' };
    expect(() => parseCheckpointView(swapped)).toThrow();
    const short = view();
    short.tasks.pop();
    expect(() => parseCheckpointView(short)).toThrow();
  });
  it('rejects legacy threshold/replacement/duration on scored Exam1', () => {
    expect(() =>
      parseCheckpointView({
        ...view(),
        policy: { policy_version: 1, task_count: 4, pass_points: 3 },
      }),
    ).toThrow();
    expect(() => parseCheckpointView({ ...view(), replacement_available: true })).toThrow();
    const value = view();
    value.attempt!.deadline_at = '2026-11-01T13:30:00Z';
    expect(() => parseCheckpointView(value)).toThrow();
  });
  it('binds current history marker and treats points as a 100-point scale', () => {
    const value = view();
    value.history = [
      {
        ...value.attempt!,
        points: 75,
        outcome_id: 'result',
        policy: null,
        scored_exam: metadata(),
      },
    ];
    expect(parseCheckpointView(value).history[0]!.points).toBe(75);
    value.history[0]!.scored_exam = { ...metadata(), form: 'B' };
    expect(() => parseCheckpointView(value)).toThrow();
  });
});

describe('scored receipt execution and provisional grading are separate', () => {
  it('keeps a passed automated job provisional until reviewed', () => {
    const value = view();
    value.submissions = [
      {
        id: 'receipt',
        task_key: 'q1',
        state: 'passed',
        scoring_status: 'provisional',
        created_at: value.server_now,
      },
    ];
    expect(parseCheckpointView(value).submissions[0]?.scoring_status).toBe('provisional');
    delete value.submissions[0]!.scoring_status;
    expect(() => parseCheckpointView(value)).toThrow();
  });
  it('rejects a marked receipt for an unrelated question', () => {
    const value = view();
    value.submissions = [
      {
        id: 'receipt',
        task_key: 'q9',
        state: 'pending',
        scoring_status: 'provisional',
        created_at: value.server_now,
      },
    ];
    expect(() => parseCheckpointView(value)).toThrow();
  });
});

describe('authoritative scored outcome projection', () => {
  const final = () => ({
    version: 1,
    status: 'passed',
    total_points: 60,
    coding_points: 45,
    outcome_id: '10000000-0000-4000-8000-000000000001',
  });
  it('requires both accepted pass thresholds and an immutable outcome identity', () => {
    expect(checkpointScoredExamResult(final())?.status).toBe('passed');
    expect(() => checkpointScoredExamResult({ ...final(), coding_points: 44 })).toThrow();
    expect(() => checkpointScoredExamResult({ ...final(), total_points: 59 })).toThrow();
    expect(() => checkpointScoredExamResult({ ...final(), status: 'failed' })).toThrow();
    expect(() => checkpointScoredExamResult({ ...final(), outcome_id: null })).toThrow();
  });
  it('never turns pending work into a zero grade', () => {
    expect(
      checkpointScoredExamResult({
        version: 1,
        status: 'provisional',
        total_points: null,
        coding_points: null,
        outcome_id: null,
      })?.total_points,
    ).toBeNull();
    expect(() =>
      checkpointScoredExamResult({
        ...final(),
        status: 'provisional',
        total_points: 0,
        coding_points: 0,
      }),
    ).toThrow();
  });
  it('does not accept final grade metadata on a still-active attempt', () => {
    expect(() => parseCheckpointView({ ...view(), scored_result: final() })).toThrow();
    const value = view();
    value.attempt!.status = 'passed';
    value.attempt!.completed_at = value.server_now;
    expect(
      parseCheckpointView({ ...value, scored_result: final() }).scored_result?.total_points,
    ).toBe(60);
  });
});

describe('marked current and historical attempt state parity', () => {
  const outcomeId = '10000000-0000-4000-8000-000000000001';
  const pending = (status: 'in_progress' | 'provisional') => ({
    version: 1 as const,
    status,
    total_points: null,
    coding_points: null,
    outcome_id: null,
  });
  const final = (status: 'passed' | 'failed') => ({
    version: 1 as const,
    status,
    total_points: status === 'passed' ? 60 : 59,
    coding_points: 45,
    outcome_id: outcomeId,
  });
  function historical(value: CheckpointView) {
    value.history = [
      {
        ...value.attempt!,
        id: 'historical-attempt',
        points: null,
        outcome_id: null,
        policy: null,
        scored_exam: metadata(),
        ...(value.scored_result ? { scored_result: value.scored_result } : {}),
      },
    ];
    return value;
  }
  for (const selection of ['current', 'history'] as const) {
    function selected(value: CheckpointView) {
      if (selection === 'history') {
        historical(value);
        value.attempt = view().attempt;
        delete value.scored_result;
      }
      return value;
    }
    it(selection + ' rejects a completed active attempt even without result metadata', () => {
      const value = view();
      value.attempt!.completed_at = value.server_now;
      expect(() => parseCheckpointView(selected(value))).toThrow();
    });
    it.each(['passed', 'failed'] as const)(
      selection + ' requires a completion date for raw finalized status %s',
      (status) => {
        const value = view();
        value.attempt!.status = status;
        value.scored_result = final(status);
        expect(() => parseCheckpointView(selected(value))).toThrow();
      },
    );
    it.each(['evaluating', 'passed', 'failed'] as const)(
      selection + ' rejects in_progress result on raw status %s',
      (status) => {
        const value = view();
        value.attempt!.status = status;
        value.attempt!.completed_at = status === 'evaluating' ? null : value.server_now;
        value.scored_result = pending('in_progress');
        expect(() => parseCheckpointView(selected(value))).toThrow();
      },
    );
    it(selection + ' rejects in_progress after the deadline and provisional before it', () => {
      const expired = view();
      expired.server_now = expired.attempt!.deadline_at;
      expired.scored_result = pending('in_progress');
      expect(() => parseCheckpointView(selected(expired))).toThrow();
      const open = view();
      open.scored_result = pending('provisional');
      expect(() => parseCheckpointView(selected(open))).toThrow();
    });
    it.each(['passed', 'failed'] as const)(
      selection + ' binds final result %s to the same raw status',
      (status) => {
        const value = view();
        value.attempt!.status = status === 'passed' ? 'failed' : 'passed';
        value.attempt!.completed_at = value.server_now;
        value.scored_result = final(status);
        expect(() => parseCheckpointView(selected(value))).toThrow();
      },
    );
    it(selection + ' accepts open, expired and closed native projections', () => {
      const open = view();
      open.scored_result = pending('in_progress');
      expect(() => parseCheckpointView(selected(open))).not.toThrow();
      const expired = view();
      expired.server_now = expired.attempt!.deadline_at;
      expired.scored_result = pending('provisional');
      expect(() => parseCheckpointView(selected(expired))).not.toThrow();
      const closed = view();
      closed.attempt!.status = 'evaluating';
      closed.scored_result = pending('provisional');
      expect(() => parseCheckpointView(selected(closed))).not.toThrow();
    });
    it.each(['passed', 'failed'] as const)(
      selection + ' preserves provisional after invalidation of raw verdict %s',
      (status) => {
        const value = view();
        value.attempt!.status = status;
        value.attempt!.completed_at = value.server_now;
        value.scored_result = pending('provisional');
        expect(() => parseCheckpointView(selected(value))).not.toThrow();
      },
    );
  }
  it('retains native null historical copies and checks any supplied final copies', () => {
    const value = view();
    value.attempt!.status = 'passed';
    value.attempt!.completed_at = value.server_now;
    value.scored_result = final('passed');
    historical(value);
    expect(() => parseCheckpointView(value)).not.toThrow();
    value.history[0]!.points = 60;
    value.history[0]!.outcome_id = outcomeId;
    expect(() => parseCheckpointView(value)).not.toThrow();
    value.history[0]!.points = 61;
    expect(() => parseCheckpointView(value)).toThrow();
    value.history[0]!.points = 60;
    value.history[0]!.outcome_id = '10000000-0000-4000-8000-000000000002';
    expect(() => parseCheckpointView(value)).toThrow();
  });
  it('does not compare stale historical score copies after policy invalidation', () => {
    const value = view();
    value.attempt!.status = 'passed';
    value.attempt!.completed_at = value.server_now;
    value.scored_result = pending('provisional');
    historical(value);
    value.history[0]!.points = 60;
    value.history[0]!.outcome_id = outcomeId;
    expect(() => parseCheckpointView(value)).not.toThrow();
  });
});
