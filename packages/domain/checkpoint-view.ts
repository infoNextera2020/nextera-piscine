import {
  checkpointScoredExamResult,
  type ScoredExamResultMetadata,
} from './scored-exam-lifecycle.ts';
import {
  checkpointScoredExamMetadata,
  checkpointScoredSubmissionCapability,
  checkpointExamAnswerKind,
  type ScoredExamMetadata,
  type ScoredExamSubmissionCapability,
} from './scored-exam-lifecycle.ts';

export type CheckpointAnswerFormat = Readonly<{
  version: 1;
  kind: 'coding' | 'trace_with_reason' | 'debug_with_reason';
}>;

export type CheckpointView = {
  scored_result?: ScoredExamResultMetadata | null;
  scored_exam?: ScoredExamMetadata | null;
  policy?: CheckpointScoringMetadata | null;
  server_now: string;
  eligible: boolean;
  attempt: null | {
    id: string;
    status: string;
    normal_slot: number;
    kind: string;
    started_at: string;
    deadline_at: string;
    completed_at: string | null;
    retake_at: string | null;
  };
  tasks: {
    key: string;
    title: string;
    passed: boolean;
    reserved: number;
    subject: string;
    /** Omitted only for the existing source-only contract. No question type is inferred from copy. */
    answer_format?: CheckpointAnswerFormat;
    submission?: ScoredExamSubmissionCapability;
    rules: { required_files: string[]; max_size_kb: number };
  }[];
  submissions: {
    id: string;
    task_key: string;
    state: string;
    scoring_status?: 'provisional' | 'finalized';
    created_at: string;
    feedback?: { message?: string } | null;
  }[];
  history: {
    scored_result?: ScoredExamResultMetadata | null;
    scored_exam?: ScoredExamMetadata | null;
    policy?: CheckpointScoringMetadata | null;
    id: string;
    status: string;
    points: number | null;
    normal_slot: number;
    kind: string;
    started_at: string;
    deadline_at: string;
    completed_at: string | null;
    outcome_id: string | null;
  }[];
  replacement_available: boolean;
};
/** Read projection only. These checks never grant attempt, submission or progression authority. */
export type CheckpointScoringMetadata = Readonly<{
  policy_version: 1 | 2;
  task_count: number;
  pass_points: number;
}>;
export class CheckpointViewError extends Error {
  constructor() {
    super('CHECKPOINT_VIEW_UNAVAILABLE');
  }
}
const fail = (): never => {
  throw new CheckpointViewError();
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function instant(value: unknown): value is string {
  return text(value) && Number.isFinite(Date.parse(value));
}
function optionalInstant(value: unknown) {
  return value === null || instant(value);
}
function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}
export function checkpointScoringMetadata(value: unknown): CheckpointScoringMetadata | null {
  if (value === undefined || value === null) return null;
  const p = object(value);
  if (
    Object.keys(p).length !== 3 ||
    (p.policy_version !== 1 && p.policy_version !== 2) ||
    !integer(p.task_count, 1) ||
    !integer(p.pass_points, 1) ||
    p.pass_points > p.task_count ||
    (p.policy_version === 1 && (p.task_count !== 4 || p.pass_points !== 3))
  )
    return fail();
  return Object.freeze({
    policy_version: p.policy_version,
    task_count: p.task_count,
    pass_points: p.pass_points,
  });
}
const codingAnswerFormat = Object.freeze({ version: 1 as const, kind: 'coding' as const });
/** Response shape only; this does not enable persistence, submission, Run or scoring. */
export function checkpointAnswerFormat(value: unknown): CheckpointAnswerFormat {
  if (value === undefined) return codingAnswerFormat;
  const format = object(value);
  if (
    Reflect.ownKeys(format).length !== 2 ||
    !Object.hasOwn(format, 'version') ||
    !Object.hasOwn(format, 'kind') ||
    format.version !== 1 ||
    typeof format.kind !== 'string' ||
    !['coding', 'trace_with_reason', 'debug_with_reason'].includes(format.kind)
  )
    return fail();
  return Object.freeze({ version: 1, kind: format.kind as CheckpointAnswerFormat['kind'] });
}
function attemptFields(row: Record<string, unknown>) {
  if (
    !text(row.id) ||
    !text(row.status) ||
    (row.normal_slot !== 1 && row.normal_slot !== 2) ||
    !['normal', 'replacement'].includes(String(row.kind)) ||
    !instant(row.started_at) ||
    !instant(row.deadline_at) ||
    !optionalInstant(row.completed_at)
  )
    fail();
}
function scoredMetadata(value: unknown) {
  try {
    return checkpointScoredExamMetadata(value);
  } catch {
    return fail();
  }
}
function scoredAttempt(
  row: Record<string, unknown>,
  result: ScoredExamResultMetadata | null,
  serverNow: string,
) {
  const active = row.status === 'active';
  const finalized = row.status === 'passed' || row.status === 'failed';
  const beforeDeadline = Date.parse(serverNow) < Date.parse(String(row.deadline_at));
  if (
    row.normal_slot !== 1 ||
    row.kind !== 'normal' ||
    (Object.hasOwn(row, 'retake_at') && row.retake_at !== null) ||
    Date.parse(String(row.deadline_at)) - Date.parse(String(row.started_at)) !== 10800000 ||
    (active && row.completed_at !== null) ||
    (finalized && row.completed_at === null)
  )
    fail();
  if (
    result &&
    ((result.status === 'in_progress' &&
      (!active || row.completed_at !== null || !beforeDeadline)) ||
      (result.status === 'provisional' && active && beforeDeadline) ||
      ((result.status === 'passed' || result.status === 'failed') &&
        (row.status !== result.status || row.completed_at === null)))
  )
    fail();
}
/** Validate wire shape/scoring without inferring a v2 threshold or trusting a supplied display object. */
export function parseCheckpointView(value: unknown): CheckpointView {
  const row = object(value);
  if (
    !instant(row.server_now) ||
    typeof row.eligible !== 'boolean' ||
    typeof row.replacement_available !== 'boolean' ||
    !Array.isArray(row.tasks) ||
    !Array.isArray(row.submissions) ||
    !Array.isArray(row.history)
  )
    return fail();
  const policy = checkpointScoringMetadata(row.policy);
  const scored = scoredMetadata(row.scored_exam);
  let scoredResult: ScoredExamResultMetadata | null;
  try {
    scoredResult = checkpointScoredExamResult(row.scored_result);
  } catch {
    return fail();
  }
  if (scoredResult && !scored) fail();

  if (scored && (policy !== null || row.replacement_available !== false)) fail();
  const keys = new Set<string>();
  for (const [index, raw] of row.tasks.entries()) {
    const t = object(raw),
      rules = object(t.rules),
      format = checkpointAnswerFormat(t.answer_format);
    if (
      !text(t.key) ||
      keys.has(t.key) ||
      !text(t.title) ||
      typeof t.subject !== 'string' ||
      typeof t.passed !== 'boolean' ||
      !integer(t.reserved) ||
      !Array.isArray(rules.required_files) ||
      (format.kind !== 'trace_with_reason' && rules.required_files.length === 0) ||
      (format.kind === 'trace_with_reason' && rules.required_files.length !== 0) ||
      !rules.required_files.every(text) ||
      !integer(rules.max_size_kb, 1)
    )
      fail();
    if (scored) {
      if (
        index > 7 ||
        t.key !== 'q' + (index + 1) ||
        format.kind !== checkpointExamAnswerKind(index)
      )
        fail();
      try {
        checkpointScoredSubmissionCapability(t.submission, format.kind);
      } catch {
        fail();
      }
    }
    keys.add(t.key as string);
  }
  const attempt = row.attempt === null ? null : object(row.attempt);
  if (attempt) {
    attemptFields(attempt);
    if (!optionalInstant(attempt.retake_at) || (policy && row.tasks.length !== policy.task_count))
      fail();
  }
  if (scored) {
    if (attempt) {
      scoredAttempt(attempt, scoredResult, row.server_now);
      if (row.tasks.length !== 8) fail();
    } else if (row.tasks.length !== 0) fail();
  }

  if (scoredResult && !attempt) fail();
  const submissionIds = new Set<string>();
  for (const raw of row.submissions) {
    const s = object(raw);
    if (
      !text(s.id) ||
      submissionIds.has(s.id) ||
      !text(s.task_key) ||
      !text(s.state) ||
      !instant(s.created_at)
    )
      fail();
    if (
      (scored || s.scoring_status !== undefined) &&
      (typeof s.scoring_status !== 'string' ||
        !['provisional', 'finalized'].includes(s.scoring_status))
    )
      fail();
    if (scored && !keys.has(s.task_key as string)) fail();
    submissionIds.add(s.id as string);
    if (s.feedback !== undefined && s.feedback !== null) {
      const feedback = object(s.feedback);
      if (feedback.message !== undefined && typeof feedback.message !== 'string') fail();
    }
  }
  const historyIds = new Set<string>();
  for (const raw of row.history) {
    const h = object(raw);
    attemptFields(h);
    if (
      historyIds.has(String(h.id)) ||
      (h.points !== null && !integer(h.points)) ||
      (h.outcome_id !== null && !text(h.outcome_id))
    )
      fail();
    historyIds.add(String(h.id));
    const historical = checkpointScoringMetadata(h.policy);
    const historicalScored = scoredMetadata(h.scored_exam);
    let historicalResult: ScoredExamResultMetadata | null;
    try {
      historicalResult = checkpointScoredExamResult(h.scored_result);
    } catch {
      return fail();
    }
    if (historicalResult && !historicalScored) fail();

    if (historicalScored) {
      scoredAttempt(h, historicalResult, row.server_now);
      if (
        historicalResult &&
        (historicalResult.status === 'passed' || historicalResult.status === 'failed') &&
        ((h.points !== null && h.points !== historicalResult.total_points) ||
          (h.outcome_id !== null && h.outcome_id !== historicalResult.outcome_id))
      )
        fail();
      if (
        historical !== null ||
        (h.points !== null && Number(h.points) > 100) ||
        (h.status === 'passed' && h.points !== null && Number(h.points) < 60)
      )
        fail();
    }
    if (
      h.id === attempt?.id &&
      (scored || historicalScored) &&
      (!scored ||
        !historicalScored ||
        scored.form !== historicalScored.form ||
        scored.rubric_digest !== historicalScored.rubric_digest)
    )
      fail();

    if (
      historical &&
      h.points !== null &&
      (Number(h.points) > historical.task_count ||
        (h.status === 'passed' && Number(h.points) < historical.pass_points) ||
        (['failed', 'infrastructure_blocked'].includes(String(h.status)) &&
          Number(h.points) >= historical.pass_points))
    )
      fail();
    if (
      h.id === attempt?.id &&
      policy &&
      historical &&
      (historical.policy_version !== policy.policy_version ||
        historical.task_count !== policy.task_count ||
        historical.pass_points !== policy.pass_points)
    )
      fail();
  }
  // The shape is now validated. Preserve optional legacy policy absence; do not backfill constants.
  return row as unknown as CheckpointView;
}
