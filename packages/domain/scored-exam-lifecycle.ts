import type { ExamForm, ExamAnswerKind } from './exam-scoring.ts';

/** The approved Exam1 lifecycle. Submission allowances/rates remain explicit server policy. */
export const SCORED_EXAM_LIFECYCLE = Object.freeze({
  policyVersion: 3 as const,
  durationSeconds: 10800 as const,
  taskCount: 8 as const,
  normalAttempts: 1 as const,
  replacementAllowed: false as const,
});
export type ScoredExamMarker = Readonly<{ version: 1; form: ExamForm; rubricDigest: string }>;
export type ScoredExamMetadata = Readonly<{
  version: 1;
  form: ExamForm;
  rubric_digest: string;
  duration_seconds: 10800;
  normal_attempts: 1;
}>;
export type ScoredExamSubmissionCapability = Readonly<{
  version: 1;
  allowed: boolean;
  status: 'open' | 'closed' | 'unavailable' | 'allowance_exhausted' | 'rate_limited';
  authority: 'scored_exam_intake_v1' | 'checkpoint_answers_v1';
}>;
export class CheckpointExamPolicyError extends Error {
  constructor() {
    super('CHECKPOINT_EXAM_POLICY');
  }
}
const fail = (): never => {
  throw new CheckpointExamPolicyError();
};
function exact(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(fields);
  if (
    keys.length !== names.length ||
    !names.every((name) => Object.hasOwn(fields, name)) ||
    keys.some((name) => typeof name !== 'string' || !Object.hasOwn(fields[name]!, 'value'))
  )
    return fail();
  return Object.fromEntries(names.map((name) => [name, fields[name]!.value]));
}
function form(value: unknown): ExamForm {
  if (typeof value !== 'string' || !['A', 'B', 'C', 'D'].includes(value)) return fail();
  return value as ExamForm;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return fail();
  return value;
}
/** Read metadata only; this never establishes actor/access/submission authority. */
export function checkpointExamMarker(value: unknown): ScoredExamMarker | null {
  if (value === undefined || value === null) return null;
  const item = exact(value, ['version', 'form', 'rubricDigest']);
  if (item.version !== 1) return fail();
  return Object.freeze({
    version: 1,
    form: form(item.form),
    rubricDigest: hash(item.rubricDigest),
  });
}
export function checkpointScoredExamMetadata(value: unknown): ScoredExamMetadata | null {
  if (value === undefined || value === null) return null;
  const item = exact(value, [
    'version',
    'form',
    'rubric_digest',
    'duration_seconds',
    'normal_attempts',
  ]);
  if (item.version !== 1 || item.duration_seconds !== 10800 || item.normal_attempts !== 1)
    return fail();
  return Object.freeze({
    version: 1,
    form: form(item.form),
    rubric_digest: hash(item.rubric_digest),
    duration_seconds: 10800,
    normal_attempts: 1,
  });
}
export function checkpointExamAnswerKind(index: number): ExamAnswerKind {
  if (!Number.isInteger(index) || index < 0 || index > 7) return fail();
  return index < 5 ? 'coding' : index < 7 ? 'trace_with_reason' : 'debug_with_reason';
}
export function checkpointScoredSubmissionCapability(
  value: unknown,
  kind: ExamAnswerKind,
): ScoredExamSubmissionCapability {
  const item = exact(value, ['version', 'allowed', 'status', 'authority']);
  const authority = kind === 'coding' ? 'scored_exam_intake_v1' : 'checkpoint_answers_v1';
  if (
    item.version !== 1 ||
    typeof item.allowed !== 'boolean' ||
    typeof item.status !== 'string' ||
    !['open', 'closed', 'unavailable', 'allowance_exhausted', 'rate_limited'].includes(
      item.status,
    ) ||
    item.authority !== authority ||
    (item.allowed && item.status !== 'open')
  )
    return fail();
  return Object.freeze({
    version: 1,
    allowed: item.allowed,
    status: item.status as ScoredExamSubmissionCapability['status'],
    authority,
  });
}

export type ScoredExamResultMetadata = Readonly<{
  version: 1;
  status: 'in_progress' | 'provisional' | 'passed' | 'failed';
  total_points: number | null;
  coding_points: number | null;
  outcome_id: string | null;
}>;
/** Only the authoritative native outcome projection may supply a final result. */
export function checkpointScoredExamResult(value: unknown): ScoredExamResultMetadata | null {
  if (value === undefined || value === null) return null;
  const item = exact(value, ['version', 'status', 'total_points', 'coding_points', 'outcome_id']);
  if (
    item.version !== 1 ||
    typeof item.status !== 'string' ||
    !['in_progress', 'provisional', 'passed', 'failed'].includes(item.status)
  )
    return fail();
  const final = item.status === 'passed' || item.status === 'failed';
  if (final) {
    if (
      !Number.isSafeInteger(item.total_points) ||
      Number(item.total_points) < 0 ||
      Number(item.total_points) > 100 ||
      !Number.isSafeInteger(item.coding_points) ||
      Number(item.coding_points) < 0 ||
      Number(item.coding_points) > 75 ||
      Number(item.total_points) < Number(item.coding_points) ||
      Number(item.total_points) - Number(item.coding_points) > 25 ||
      typeof item.outcome_id !== 'string' ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(item.outcome_id) ||
      (item.status === 'passed') !==
        (Number(item.total_points) >= 60 && Number(item.coding_points) >= 45)
    )
      return fail();
  } else if (item.total_points !== null || item.coding_points !== null || item.outcome_id !== null)
    return fail();
  return Object.freeze({
    version: 1,
    status: item.status as ScoredExamResultMetadata['status'],
    total_points: item.total_points as number | null,
    coding_points: item.coding_points as number | null,
    outcome_id: item.outcome_id as string | null,
  });
}
