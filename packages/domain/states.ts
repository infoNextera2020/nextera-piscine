export const PROGRESS_STATES = ['locked', 'available', 'in_progress', 'mastered'] as const;
export type ProgressState = (typeof PROGRESS_STATES)[number];

export const SUBMISSION_STATES = [
  'queued',
  'running',
  'passed',
  'failed',
  'compile_error',
  'runtime_error',
  'timeout',
  'system_error',
  'cancelled',
] as const;
export type SubmissionState = (typeof SUBMISSION_STATES)[number];

export const JUDGE_JOB_STATES = [
  'queued',
  'claimed',
  'running',
  'completed',
  'system_error',
] as const;
export type JudgeJobState = (typeof JUDGE_JOB_STATES)[number];

export const JUDGE_ATTEMPT_STATES = ['claimed', 'running', 'completed', 'system_error'] as const;
export type JudgeAttemptState = (typeof JUDGE_ATTEMPT_STATES)[number];

export const RESULT_APPLICATION_STATUSES = ['pending', 'applied', 'superseded'] as const;
export type ResultApplicationStatus = (typeof RESULT_APPLICATION_STATUSES)[number];

export const USER_ROLES = ['learner', 'operator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];
