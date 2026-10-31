import { sql } from 'drizzle-orm';
import type { OperationalDatabase } from '../operations/curriculum';
import { parseCheckpointView } from '@nextera/domain';
import {
  parseScoredExamContextMarker,
  type ScoredExamContextMarker,
} from './checkpoint-editor-context';
import {
  SCORED_EXAM_INTAKE_CONTEXT_SQL,
  ACCEPT_SCORED_EXAM_SUBMISSION_SQL,
  type ScoredExamIntakeClient,
} from './scored-exam-intake';

/** Only the two reviewed0026 parameterized RPCs. No raw SQL escape hatch or cast of the underlying database client. */
export function createScoredExamIntakeClient(db: OperationalDatabase): ScoredExamIntakeClient {
  const unsafe = async (query: string, args: readonly unknown[] = []) => {
    if (query === SCORED_EXAM_INTAKE_CONTEXT_SQL && args.length === 3) {
      return db.execute(
        sql`SELECT app.scored_exam_intake_context(${args[0]}::uuid,${args[1]}::uuid,${args[2]}) AS data`,
      );
    }
    if (query === ACCEPT_SCORED_EXAM_SUBMISSION_SQL && args.length === 7) {
      return db.execute(
        sql`SELECT app.accept_scored_exam_submission(${args[0]}::uuid,${args[1]}::uuid,${args[2]},${args[3]}::uuid,${args[4]},${args[5]}::integer,${args[6]}) AS data`,
      );
    }
    throw new Error('SCORED_EXAM_RPC_UNAVAILABLE');
  };
  // postgres.Sql's generic overloaded result type is wider than Drizzle's row list;
  // the closed dispatch above preserves exact parameter positions and both adapters
  // independently validate every returned row. This never exposes a generic client.
  return Object.freeze({ unsafe }) as unknown as ScoredExamIntakeClient;
}

export type CheckpointSubmissionCapability = Readonly<{
  version: 1;
  allowed: boolean;
  status: 'open' | 'closed' | 'unavailable' | 'allowance_exhausted' | 'rate_limited';
  authority: 'scored_exam_intake_v1' | 'checkpoint_answers_v1';
}>;
export type CheckpointNativeTaskContext = Readonly<{
  user_id: string;
  cohort_id: string;
  rules: { required_files: string[]; max_size_kb: number };
  scoredExam?: ScoredExamContextMarker;
  answerFormat?: Readonly<{
    version: 1;
    kind: 'coding' | 'trace_with_reason' | 'debug_with_reason';
  }>;
  submission?: CheckpointSubmissionCapability;
  answerContract?: Readonly<{
    version: 1;
    kind: 'trace_with_reason' | 'debug_with_reason';
    maxBytes: number;
    digest: string;
  }>;
  officialAnswerPolicy?: Readonly<{ version: 1; gradedAllowance: number }>;
  answerEvaluator?: Readonly<{
    family: 'checkpoint_structured_answer';
    version: 1;
    kind: 'trace_with_reason' | 'debug_with_reason';
    definitionDigest: string;
    taskKey: string;
    evaluatorKey: string;
    evaluatorDigest: string;
  }>;
}>;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;
function unavailable(): never {
  throw new Error('CHECKPOINT_TASK_CONTEXT_UNAVAILABLE');
}
function record(raw: unknown, names?: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unavailable();
  const d = Object.getOwnPropertyDescriptors(raw),
    keys = Reflect.ownKeys(d);
  if (
    keys.some((k) => typeof k !== 'string' || !Object.hasOwn(d[k]!, 'value')) ||
    (names && (keys.length !== names.length || !names.every((k) => Object.hasOwn(d, k))))
  )
    return unavailable();
  return Object.fromEntries(keys.map((k) => [k, d[k as string]!.value]));
}
function positive(v: unknown, max = 2147483647): v is number {
  return Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= max;
}
export function parseCheckpointTaskContext(
  raw: unknown,
  taskKey: string,
): CheckpointNativeTaskContext {
  const r = record(raw),
    rules = record(r.rules);
  if (
    typeof r.user_id !== 'string' ||
    !uuidPattern.test(r.user_id) ||
    typeof r.cohort_id !== 'string' ||
    !uuidPattern.test(r.cohort_id) ||
    !Array.isArray(rules.required_files) ||
    !rules.required_files.every((v) => typeof v === 'string') ||
    !positive(rules.max_size_kb)
  )
    return unavailable();
  const base = {
    user_id: r.user_id,
    cohort_id: r.cohort_id,
    rules: Object.freeze({
      ...rules,
      required_files: Object.freeze([...rules.required_files]) as unknown as string[],
      max_size_kb: rules.max_size_kb,
    }),
  };
  if (!Object.hasOwn(r, 'scoredExam')) return Object.freeze(base);
  const scoredExam = parseScoredExamContextMarker(r.scoredExam);
  const answerFormat = record(r.answerFormat, ['version', 'kind']);
  const expectedKind = /^q[1-5]$/.test(taskKey)
    ? 'coding'
    : taskKey === 'q6' || taskKey === 'q7'
      ? 'trace_with_reason'
      : taskKey === 'q8'
        ? 'debug_with_reason'
        : null;
  const submission = record(r.submission, ['version', 'allowed', 'status', 'authority']);
  const authority = expectedKind === 'coding' ? 'scored_exam_intake_v1' : 'checkpoint_answers_v1';
  if (
    !expectedKind ||
    answerFormat.version !== 1 ||
    answerFormat.kind !== expectedKind ||
    submission.version !== 1 ||
    typeof submission.allowed !== 'boolean' ||
    typeof submission.status !== 'string' ||
    !['open', 'closed', 'unavailable', 'allowance_exhausted', 'rate_limited'].includes(
      String(submission.status),
    ) ||
    submission.authority !== authority ||
    submission.allowed !== (submission.status === 'open')
  )
    return unavailable();
  const common = {
    ...base,
    scoredExam,
    answerFormat: Object.freeze({
      version: 1 as const,
      kind: expectedKind as 'coding' | 'trace_with_reason' | 'debug_with_reason',
    }),
    submission: Object.freeze(submission) as unknown as CheckpointSubmissionCapability,
  };
  if (expectedKind === 'coding') {
    if (rules.required_files.length !== 1 || !/^[A-Za-z0-9_]+[.]go$/.test(rules.required_files[0]!))
      return unavailable();
    return Object.freeze(common);
  }
  const c = record(r.answerContract, ['version', 'kind', 'maxBytes', 'digest']);
  const p = record(r.officialAnswerPolicy, ['version', 'gradedAllowance']);
  const e = record(r.answerEvaluator, [
    'family',
    'version',
    'kind',
    'definitionDigest',
    'taskKey',
    'evaluatorKey',
    'evaluatorDigest',
  ]);
  if (
    c.version !== 1 ||
    c.kind !== expectedKind ||
    !positive(c.maxBytes, 262144) ||
    typeof c.digest !== 'string' ||
    !hashPattern.test(c.digest) ||
    p.version !== 1 ||
    !positive(p.gradedAllowance) ||
    e.family !== 'checkpoint_structured_answer' ||
    e.version !== 1 ||
    e.kind !== expectedKind ||
    e.taskKey !== taskKey ||
    typeof e.definitionDigest !== 'string' ||
    !hashPattern.test(e.definitionDigest) ||
    typeof e.evaluatorDigest !== 'string' ||
    !hashPattern.test(e.evaluatorDigest) ||
    typeof e.evaluatorKey !== 'string' ||
    !/^[a-z0-9-]{1,100}$/.test(e.evaluatorKey) ||
    (expectedKind === 'trace_with_reason' && rules.required_files.length !== 0) ||
    (expectedKind === 'debug_with_reason' &&
      (rules.required_files.length !== 1 || !/^[A-Za-z0-9_]+[.]go$/.test(rules.required_files[0]!)))
  )
    return unavailable();
  return Object.freeze({
    ...common,
    answerContract: Object.freeze(c),
    officialAnswerPolicy: Object.freeze(p),
    answerEvaluator: Object.freeze(e),
  }) as unknown as CheckpointNativeTaskContext;
}
export type { CheckpointView } from '@nextera/domain';
export async function readCheckpoint(
  db: OperationalDatabase,
  authId: string,
  cohortId: string,
  nodeKey: string,
) {
  const [row] = await db.execute(
    sql`SELECT app.read_checkpoint(${authId}::uuid,${cohortId}::uuid,${nodeKey}) AS data`,
  );
  return parseCheckpointView(row?.data);
}
export async function startCheckpoint(
  db: OperationalDatabase,
  authId: string,
  cohortId: string,
  nodeKey: string,
  requestId: string,
) {
  const [row] = await db.execute(
    sql`SELECT app.start_checkpoint(${authId}::uuid,${cohortId}::uuid,${nodeKey},${requestId}::uuid) AS id`,
  );
  return String(row!.id);
}
export async function finishCheckpoint(db: OperationalDatabase, authId: string, attemptId: string) {
  await db.execute(sql`SELECT app.finish_checkpoint(${authId}::uuid,${attemptId}::uuid)`);
}
export async function checkpointTaskContext(
  db: OperationalDatabase,
  authId: string,
  attemptId: string,
  taskKey: string,
) {
  const [row] = await db.execute(
    sql`SELECT app.checkpoint_task_context(${authId}::uuid,${attemptId}::uuid,${taskKey}) AS data`,
  );
  return parseCheckpointTaskContext(row?.data, taskKey);
}
export async function acceptCheckpointSubmission(
  db: OperationalDatabase,
  authId: string,
  attemptId: string,
  taskKey: string,
  requestId: string,
  filename: string,
  bytes: number,
  hash: string,
) {
  const [row] = await db.execute(
    sql`SELECT app.accept_checkpoint_submission(${authId}::uuid,${attemptId}::uuid,${taskKey},${requestId}::uuid,${filename},${bytes},${hash}) AS id`,
  );
  return String(row!.id);
}
export async function grantCheckpointReplacement(
  db: OperationalDatabase,
  authId: string,
  attemptId: string,
) {
  const [row] = await db.execute(
    sql`SELECT app.grant_checkpoint_replacement(${authId}::uuid,${attemptId}::uuid) AS id`,
  );
  return String(row!.id);
}
