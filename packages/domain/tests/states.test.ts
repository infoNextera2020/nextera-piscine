import { describe, expect, it } from 'vitest';
import {
  JUDGE_ATTEMPT_STATES,
  JUDGE_JOB_STATES,
  PROGRESS_STATES,
  RESULT_APPLICATION_STATUSES,
  SUBMISSION_STATES,
  USER_ROLES,
} from '../index';

describe('persisted domain vocabulary', () => {
  it('preserves the approved progress, submission, and identity values', () => {
    expect(PROGRESS_STATES).toEqual(['locked', 'available', 'in_progress', 'mastered']);
    expect(SUBMISSION_STATES).toEqual([
      'queued',
      'running',
      'passed',
      'failed',
      'compile_error',
      'runtime_error',
      'timeout',
      'system_error',
      'cancelled',
    ]);
    expect(USER_ROLES).toEqual(['learner', 'operator', 'admin']);
  });

  it('keeps queue lifecycle, infrastructure attempts, and result receipts distinct', () => {
    expect(JUDGE_JOB_STATES).toEqual(['queued', 'claimed', 'running', 'completed', 'system_error']);
    expect(JUDGE_ATTEMPT_STATES).toEqual(['claimed', 'running', 'completed', 'system_error']);
    expect(RESULT_APPLICATION_STATUSES).toEqual(['pending', 'applied', 'superseded']);
    expect(JUDGE_JOB_STATES).not.toContain('passed');
    expect(JUDGE_ATTEMPT_STATES).not.toContain('queued');
  });
});
