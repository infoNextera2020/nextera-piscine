import { describe, it, expect } from 'vitest';
import {
  aggregateCheckpoint,
  checkpointScoringPolicy,
  checkpointTaskCredit,
  CHECKPOINT_POLICY,
  type CheckpointScoringDefinition,
} from '../checkpoints';

const outcome = (passed = false, infrastructure = false, pending = false) => ({
  passed,
  infrastructure,
  pending,
});
const v2 = (count: number, passPoints: number) => ({
  policyVersion: 2 as const,
  durationSeconds: 5400 as const,
  passPoints,
  tasks: Array.from({ length: count }, () => ({})),
});

describe('explicit per-exam checkpoint policy v2 (synthetic policy examples only)', () => {
  it('keeps every legacy outcome and accepted global rule unchanged', () => {
    const legacy = {
      policyVersion: 1 as const,
      durationSeconds: 5400 as const,
      tasks: [{}, {}, {}, {}],
    };
    for (let passes = 0; passes <= 4; passes++) {
      const tasks = Array.from({ length: 4 }, (_, i) => outcome(i < passes));
      expect(aggregateCheckpoint(tasks, legacy)).toEqual(aggregateCheckpoint(tasks));
    }
    expect(CHECKPOINT_POLICY).toEqual({
      version: 1,
      taskCount: 4,
      durationSeconds: 5400,
      passPoints: 3,
      taskQuota: 3,
      normalAttempts: 2,
      cooldownSeconds: 86400,
    });
    expect(
      checkpointTaskCredit(['system_error', 'failed', 'compile_error', 'timeout']).infrastructure,
    ).toBe(false);
  });
  it.each([1, 3, 4, 10])(
    'derives %s tasks from the supplied frozen definition, not a global count',
    (count) => {
      const definition = v2(count, count);
      expect(checkpointScoringPolicy(definition)).toEqual({
        version: 2,
        taskCount: count,
        passPoints: count,
      });
      expect(
        aggregateCheckpoint(
          Array.from({ length: count }, () => outcome(true)),
          definition,
        ),
      ).toEqual({ status: 'passed', points: count });
      expect(() =>
        aggregateCheckpoint(
          Array.from({ length: count + 1 }, () => outcome()),
          definition,
        ),
      ).toThrow('CHECKPOINT_TASK_COUNT');
    },
  );
  it.each([undefined, 0, -1, 1.5, NaN, Infinity, 4, '2'])(
    'rejects missing or invalid threshold %s rather than inheriting 3',
    (threshold) => {
      const definition = {
        ...v2(3, 2),
        passPoints: threshold,
      } as unknown as CheckpointScoringDefinition;
      expect(() => checkpointScoringPolicy(definition)).toThrow('CHECKPOINT_POLICY');
    },
  );
  it('rejects unsupported version, altered duration, empty tasks and extensions of v1', () => {
    for (const definition of [
      { ...v2(3, 2), policyVersion: 3 },
      { ...v2(3, 2), durationSeconds: 3600 },
      v2(0, 1),
      { policyVersion: 1, durationSeconds: 5400, tasks: [{}, {}, {}, {}], passPoints: 2 },
    ])
      expect(() =>
        checkpointScoringPolicy(definition as unknown as CheckpointScoringDefinition),
      ).toThrow('CHECKPOINT_POLICY');
  });
  it('uses this exam threshold for failure and infrastructure relevance and waits for pending', () => {
    const definition = v2(5, 4);
    expect(
      aggregateCheckpoint(
        [outcome(true), outcome(true), outcome(true), outcome(false, true), outcome()],
        definition,
      ),
    ).toEqual({ status: 'infrastructure_blocked', points: 3 });
    expect(
      aggregateCheckpoint(
        [outcome(true), outcome(true), outcome(), outcome(false, true), outcome()],
        definition,
      ),
    ).toEqual({ status: 'failed', points: 2 });
    expect(
      aggregateCheckpoint(
        [outcome(true), outcome(true), outcome(true), outcome(true), outcome(false, true)],
        definition,
      ),
    ).toEqual({ status: 'passed', points: 4 });
    expect(
      aggregateCheckpoint(
        [outcome(true), outcome(true), outcome(true), outcome(true), outcome(false, false, true)],
        definition,
      ),
    ).toEqual({ status: 'evaluating', points: null });
  });
  it('does not infer v2 from a non-legacy task list without a definition', () => {
    expect(() => aggregateCheckpoint([outcome(), outcome(), outcome()])).toThrow(
      'CHECKPOINT_TASK_COUNT',
    );
  });
});
