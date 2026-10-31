import { checkpointExamAnswerKind } from './scored-exam-lifecycle.ts';
import type { CheckpointAnswerFormat } from './checkpoint-view.ts';
import type { ExamForm } from './exam-scoring.ts';
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
  item_key: string;
  learner_file: string;
} & (
  | { version: 1; function: string; input_type: 'string' | 'int64'; output_type: 'string' }
  | { version: 2; function: ''; input_type: 'stdin_utf8'; output_type: 'stdout_utf8_exact' }
  | {
      version: 4;
      learner_file: 'main.go';
      function: '';
      input_type: 'stdin_utf8';
      output_type: 'atm_report_events_v1';
    }
  | ({ version: 3; function: string } & (
      | { input_type: 'int_int' | 'string'; output_type: 'int' }
      | { input_type: 'pointer_int_int'; output_type: 'pointer_int' }
      | { input_type: 'int_slice_int_int' | 'int_slice'; output_type: 'int_slice_preserved' }
    ))
);
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
export type LegacyCheckpointDefinition = CheckpointPolicyHeader & { tasks: CheckpointTask[] };
/** Source metadata contains profile keys, never derived recursive binding hashes. */
export type ScoredExamSourceTask = Omit<CheckpointTask, 'testPackId' | 'declaredLimits'> & {
  answerFormat: CheckpointAnswerFormat;
  testPackId: string | null;
  declaredLimits: CheckpointTask['declaredLimits'] | null;
  scoredSubmissionPolicy?: Readonly<Record<string, unknown>>;
  answerContract?: Readonly<Record<string, unknown>>;
  officialAnswerPolicy?: Readonly<Record<string, unknown>>;
  answerEvaluator?: Readonly<Record<string, unknown>>;
};
export type ScoredExamSourceDefinition = {
  policyVersion: 3;
  durationSeconds: 10800;
  examScoring: { version: 1; form: ExamForm; rubricProfile: string };
  tasks: ScoredExamSourceTask[];
};
export type CheckpointDefinition = LegacyCheckpointDefinition | ScoredExamSourceDefinition;
export type CheckpointScoringDefinition = CheckpointPolicyHeader & {
  tasks: readonly unknown[];
};

/** Trusted frozen definition only. v2 never inherits a global passing threshold.
 * This is pure source support, not evidence that a database supports policy v2.
 */
export function checkpointScoringPolicy(
  definition: CheckpointScoringDefinition | ScoredExamSourceDefinition,
) {
  if (Object.hasOwn(definition, 'examScoring')) throw new Error('CHECKPOINT_POLICY');
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
/** Lifecycle validation only. Graded allowances/rates and scoring are not legacy quota/pass points. */
export function checkpointLifecyclePolicy(definition: CheckpointDefinition) {
  if (definition.policyVersion !== 3) {
    const legacy = checkpointScoringPolicy(definition);
    return Object.freeze({
      version: legacy.version,
      durationSeconds: 5400 as const,
      normalAttempts: 2 as const,
      replacementAllowed: true as const,
      taskCount: legacy.taskCount,
    });
  }
  const marker = definition.examScoring;
  if (
    definition.durationSeconds !== 10800 ||
    Object.hasOwn(definition, 'passPoints') ||
    !marker ||
    Reflect.ownKeys(marker).length !== 3 ||
    !['version', 'form', 'rubricProfile'].every((key) => Object.hasOwn(marker, key)) ||
    marker.version !== 1 ||
    !['A', 'B', 'C', 'D'].includes(marker.form) ||
    typeof marker.rubricProfile !== 'string' ||
    !/^[a-z][a-z0-9-]{0,99}$/.test(marker.rubricProfile) ||
    !Array.isArray(definition.tasks) ||
    definition.tasks.length !== 8
  )
    throw new Error('CHECKPOINT_EXAM_POLICY');
  for (const [index, task] of definition.tasks.entries()) {
    const format = task.answerFormat;
    if (
      task.key !== 'q' + (index + 1) ||
      !format ||
      Reflect.ownKeys(format).length !== 2 ||
      !['version', 'kind'].every((key) => Object.hasOwn(format, key)) ||
      format.version !== 1 ||
      format.kind !== checkpointExamAnswerKind(index) ||
      (format.kind === 'trace_with_reason' &&
        (task.testPackId !== null ||
          task.declaredLimits !== null ||
          task.submissionRules.required_files.length !== 0)) ||
      (format.kind !== 'trace_with_reason' &&
        (!task.testPackId ||
          !task.declaredLimits ||
          task.submissionRules.required_files.length !== 1))
    )
      throw new Error('CHECKPOINT_EXAM_POLICY');
  }
  return Object.freeze({
    version: 3 as const,
    durationSeconds: 10800 as const,
    normalAttempts: 1 as const,
    replacementAllowed: false as const,
    taskCount: 8 as const,
  });
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
