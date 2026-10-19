import { describe, it, expect } from 'vitest';
import {
  aggregateCheckpoint,
  checkpointTaskCredit,
  consumesCheckpointQuota,
  CHECKPOINT_POLICY,
} from '../checkpoints';
import { checkpointFixture } from '../../../tests/fixtures/checkpoints';
import { parseCurriculum } from '../../../scripts/curriculum/load';
import { resolveEvaluations } from '../../../scripts/curriculum/evaluation';
import candidate from '../../../infra/runner/catalog/candidate.json';
describe('accepted checkpoint policy', () => {
  it.each([0, 1, 2, 3, 4])('aggregates %i binary task passes', (points) => {
    const result = aggregateCheckpoint(
      Array.from({ length: 4 }, (_, i) => ({
        passed: i < points,
        pending: false,
        infrastructure: false,
      })),
    );
    expect(result).toEqual({ points, status: points >= 3 ? 'passed' : 'failed' });
  });
  it.each([
    [2, 1, 'infrastructure_blocked'],
    [3, 1, 'passed'],
    [0, 1, 'failed'],
    [1, 2, 'infrastructure_blocked'],
  ])('resolves threshold relevance of infrastructure (%s,%s)', (points, infra, status) => {
    expect(
      aggregateCheckpoint(
        Array.from({ length: 4 }, (_, i) => ({
          passed: i < Number(points),
          pending: false,
          infrastructure: i >= Number(points) && i < Number(points) + Number(infra),
        })),
      ).status,
    ).toBe(status);
  });
  it('waits for relevant accepted pending submissions', () => {
    expect(
      aggregateCheckpoint(
        Array.from({ length: 4 }, (_, i) => ({
          passed: i < 3,
          pending: i === 3,
          infrastructure: false,
        })),
      ),
    ).toEqual({ status: 'evaluating', points: null });
  });
  it('counts only terminal learner outcomes against quota', () => {
    for (const state of ['passed', 'failed', 'compile_error', 'runtime_error', 'timeout'] as const)
      expect(consumesCheckpointQuota(state)).toBe(true);
    for (const state of ['queued', 'running', 'system_error'] as const)
      expect(consumesCheckpointQuota(state)).toBe(false);
    expect(CHECKPOINT_POLICY).toMatchObject({
      durationSeconds: 5400,
      normalAttempts: 2,
      cooldownSeconds: 86400,
      taskCount: 4,
    });
  });
  it('loads four separate tasks and rejects invented clock/task policy', () => {
    const f = checkpointFixture();
    expect(f.curriculum.nodes.find((n) => n.kind === 'checkpoint')!.checkpoint!.tasks).toHaveLength(
      4,
    );
    for (const [from, to] of [
      ['duration_seconds: 5400', 'duration_seconds: 3600'],
      ['policy_version: 1', 'policy_version: 2'],
      [
        'normalize-label, count-vowels, digit-sum, sign-label',
        'normalize-label, count-vowels, digit-sum',
      ],
    ]) {
      const files = f.files.map((file) => ({
        ...file,
        bytes: Buffer.from(Buffer.from(file.bytes).toString().replace(from!, to!)),
      }));
      expect(() => parseCurriculum(files)).toThrow();
    }
  });
  it('retains the explicit publication blocker for the regenerated candidate', () => {
    expect(candidate.status).toBe('CANDIDATE');
    expect(() => resolveEvaluations(checkpointFixture().curriculum, candidate)).toThrow();
  });
});

describe('infrastructure uncertainty and fair quota', () => {
  it('resolves historical system_error after all three fair failures', () => {
    expect(checkpointTaskCredit(['system_error', 'failed', 'compile_error', 'timeout'])).toEqual({
      passed: false,
      pending: false,
      infrastructure: false,
    });
  });
  it.each([1, 2])('keeps threshold-relevant uncertainty with %s fair outcomes', (fair) => {
    const affected = checkpointTaskCredit([
      'system_error',
      ...Array.from({ length: fair }, () => 'failed' as const),
    ]);
    expect(affected.infrastructure).toBe(true);
    expect(
      aggregateCheckpoint([
        { passed: true, pending: false, infrastructure: false },
        { passed: true, pending: false, infrastructure: false },
        { passed: false, pending: false, infrastructure: false },
        affected,
      ]).status,
    ).toBe('infrastructure_blocked');
  });
  it('passes three tasks despite infrastructure uncertainty on the fourth', () => {
    expect(
      aggregateCheckpoint([
        checkpointTaskCredit(['passed']),
        checkpointTaskCredit(['passed']),
        checkpointTaskCredit(['passed']),
        checkpointTaskCredit(['system_error']),
      ]),
    ).toEqual({ status: 'passed', points: 3 });
  });
});
