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
export type CheckpointDefinition = {
  policyVersion: 1;
  durationSeconds: 5400;
  tasks: CheckpointTask[];
};
export function aggregateCheckpoint(
  tasks: readonly { passed: boolean; pending: boolean; infrastructure: boolean }[],
) {
  if (tasks.length !== 4) throw new Error('CHECKPOINT_TASK_COUNT');
  if (tasks.some((t) => t.pending)) return { status: 'evaluating' as const, points: null };
  const points = tasks.filter((t) => t.passed).length;
  const uncertain = tasks.filter((t) => !t.passed && t.infrastructure).length;
  return {
    points,
    status:
      points >= 3
        ? ('passed' as const)
        : points + uncertain >= 3
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
