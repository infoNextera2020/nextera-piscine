import type { SubmissionState } from './states.ts';
export const CHECKPOINT_POLICY = Object.freeze({
  version: 1,
  taskCount: 4,
  durationSeconds: 5400,
  passPoints: 3,
  taskQuota: 3,
  normalAttempts: 2,
  cooldownSeconds: 86400,
});
export const CHECKPOINT_ATTEMPT_STATES = [
  'active',
  'evaluating',
  'passed',
  'failed',
  'infrastructure_blocked',
] as const;
export type CheckpointAttemptState = (typeof CHECKPOINT_ATTEMPT_STATES)[number];
export type ExecutionContract = {
  version: 1;
  item_key: string;
  learner_file: string;
  function: string;
  input_type: 'string' | 'int64';
  output_type: 'string';
};
export type CheckpointTask = {
  key: string;
  title: string;
  subjectMarkdown: string;
  subjectDigest: string;
  configurationDigest: string;
  submissionRules: { required_files: string[]; allowed_extensions: string[]; max_size_kb: number };
  testPackId: string;
  declaredLimits: { timeout_ms: number; memory_mb: number; output_kb: number };
};
type CheckpointPolicyHeader =
  | { policyVersion: 1; durationSeconds: 5400 }
  | { policyVersion: 2; durationSeconds: 5400; passPoints: number };
export type CheckpointDefinition = CheckpointPolicyHeader & { tasks: CheckpointTask[] };
export type CheckpointScoringDefinition = CheckpointPolicyHeader & {
  tasks: readonly unknown[];
};

/** Trusted frozen definition only. v2 never inherits a global passing threshold.
 * This is pure source support, not evidence that a database supports policy v2.
 */
export function checkpointScoringPolicy(definition: CheckpointScoringDefinition) {
  if (
    definition.durationSeconds !== CHECKPOINT_POLICY.durationSeconds ||
    !Array.isArray(definition.tasks) ||
    !definition.tasks.length
  )
    throw new Error('CHECKPOINT_POLICY');
  const taskCount = definition.tasks.length;
  if (definition.policyVersion === 1) {
    if (taskCount !== CHECKPOINT_POLICY.taskCount || Object.hasOwn(definition, 'passPoints'))
      throw new Error('CHECKPOINT_POLICY');
    return Object.freeze({
      version: 1 as const,
      taskCount,
      passPoints: CHECKPOINT_POLICY.passPoints,
    });
  }
  if (
    definition.policyVersion !== 2 ||
    !Number.isSafeInteger(definition.passPoints) ||
    definition.passPoints < 1 ||
    definition.passPoints > taskCount
  )
    throw new Error('CHECKPOINT_POLICY');
  return Object.freeze({ version: 2 as const, taskCount, passPoints: definition.passPoints });
}
export function aggregateCheckpoint(
  tasks: readonly { passed: boolean; pending: boolean; infrastructure: boolean }[],
  definition?: CheckpointScoringDefinition,
) {
  const policy = definition ? checkpointScoringPolicy(definition) : CHECKPOINT_POLICY;
  if (tasks.length !== policy.taskCount) throw new Error('CHECKPOINT_TASK_COUNT');
  if (tasks.some((t) => t.pending)) return { status: 'evaluating' as const, points: null };
  const points = tasks.filter((t) => t.passed).length;
  const uncertain = tasks.filter((t) => !t.passed && t.infrastructure).length;
  return {
    points,
    status:
      points >= policy.passPoints
        ? ('passed' as const)
        : points + uncertain >= policy.passPoints
          ? ('infrastructure_blocked' as const)
          : ('failed' as const),
  };
}
export const consumesCheckpointQuota = (state: SubmissionState) =>
  ['passed', 'failed', 'compile_error', 'runtime_error', 'timeout'].includes(state);

/** Historical infrastructure uncertainty ends once all fair learner opportunities
 * are terminal, or a task passes. Pending jobs continue to reserve quota slots.
 */
export function checkpointTaskCredit(states: readonly SubmissionState[]) {
  const passed = states.includes('passed');
  return {
    passed,
    pending: states.some((s) => s === 'queued' || s === 'running'),
    infrastructure:
      !passed &&
      states.includes('system_error') &&
      states.filter(consumesCheckpointQuota).length < CHECKPOINT_POLICY.taskQuota,
  };
}
