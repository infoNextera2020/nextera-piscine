import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';

export type ScoredExamIntakeClient = Pick<Sql, 'unsafe'>;
export type ScoredExamTaskKey = 'q1' | 'q2' | 'q3' | 'q4' | 'q5';
export type ScoredExamIntakePolicy = Readonly<{
  version: 1;
  gradedAcceptanceAllowance: number;
  rateWindowMs: number;
  maxAcceptancesPerWindow: number;
  maxCodeBytes: number;
  resourcePolicyDigest: string;
}>;
export type ScoredExamTaskContext = Readonly<{
  authUserId: string;
  learnerId: string;
  cohortId: string;
  attemptId: string;
  taskKey: ScoredExamTaskKey;
  definitionDigest: string;
  snapshotDigest: string;
  filename: string;
  maxCodeBytes: number;
  policy: ScoredExamIntakePolicy;
  policyDigest: string;
  serverNow: string;
  deadline: string;
  status: 'open' | 'closed';
  canSubmit: boolean;
}>;
export type ScoredExamSubmissionInput = Readonly<{
  authUserId: string;
  attemptId: string;
  taskKey: ScoredExamTaskKey;
  requestId: string;
  filename: string;
  byteLength: number;
  answerSha256: string;
}>;
export type ScoredExamIntakeDenial =
  | 'forbidden'
  | 'invalid_input'
  | 'unavailable'
  | 'closed'
  | 'conflict'
  | 'allowance_exhausted'
  | 'rate_limited';
export type ScoredExamSubmissionResult =
  | Readonly<{ kind: ScoredExamIntakeDenial }>
  | Readonly<{
      kind: 'accepted';
      attemptId: string;
      taskKey: ScoredExamTaskKey;
      definitionDigest: string;
      snapshotDigest: string;
      submissionId: string;
      jobId: string;
      artifactId: string;
      requestId: string;
      answerSha256: string;
      byteLength: number;
      filename: string;
      acceptedOrdinal: string;
      replayed: boolean;
    }>;
export class ScoredExamIntakeError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'outcome_unknown') {
    super('SCORED_EXAM_INTAKE_' + code.toUpperCase());
  }
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const filename = /^[A-Za-z0-9_][A-Za-z0-9_]*[.]go$/;
const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/;
function fail(code: 'invalid_input' | 'unavailable' | 'outcome_unknown' = 'invalid_input'): never {
  throw new ScoredExamIntakeError(code);
}
function data(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const d = Object.getOwnPropertyDescriptors(value),
    keys = Reflect.ownKeys(d);
  if (
    keys.length !== names.length ||
    !names.every((n) => Object.hasOwn(d, n)) ||
    keys.some((n) => typeof n !== 'string' || !Object.hasOwn(d[n]!, 'value'))
  )
    return fail();
  return Object.fromEntries(names.map((n) => [n, d[n]!.value]));
}
function id(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) return fail();
  return value;
}
function digest(value: unknown) {
  if (typeof value !== 'string' || !hash.test(value)) return fail();
  return value;
}
function positive(value: unknown, max = 2147483647) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max)
    return fail();
  return value;
}
function task(value: unknown): ScoredExamTaskKey {
  if (typeof value !== 'string' || !/^q[1-5]$/.test(value)) return fail();
  return value as ScoredExamTaskKey;
}
function file(value: unknown) {
  if (typeof value !== 'string' || !filename.test(value) || value.length > 100) return fail();
  return value;
}
function policy(value: unknown): ScoredExamIntakePolicy {
  const p = data(value, [
    'version',
    'gradedAcceptanceAllowance',
    'rateWindowMs',
    'maxAcceptancesPerWindow',
    'maxCodeBytes',
    'resourcePolicyDigest',
  ]);
  if (p.version !== 1) return fail();
  return Object.freeze({
    version: 1,
    gradedAcceptanceAllowance: positive(p.gradedAcceptanceAllowance),
    rateWindowMs: positive(p.rateWindowMs),
    maxAcceptancesPerWindow: positive(p.maxAcceptancesPerWindow),
    maxCodeBytes: positive(p.maxCodeBytes, 262144),
    resourcePolicyDigest: digest(p.resourcePolicyDigest),
  });
}
function policyHash(p: ScoredExamIntakePolicy) {
  const canonical =
    '{' +
    Object.entries(p)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v))
      .join(',') +
    '}';
  return createHash('sha256')
    .update('01coding-scored-exam-intake\0v1\0' + canonical)
    .digest('hex');
}
export const SCORED_EXAM_INTAKE_CONTEXT_SQL =
  'SELECT app.scored_exam_intake_context($1::uuid,$2::uuid,$3) AS data';
export const ACCEPT_SCORED_EXAM_SUBMISSION_SQL =
  'SELECT app.accept_scored_exam_submission($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::integer,$7) AS data';
/** Already configured client only; no database or Auth construction at import. */
export async function readScoredExamIntakeContext(
  client: ScoredExamIntakeClient,
  authUserId: string,
  attemptId: string,
  taskKey: ScoredExamTaskKey,
): Promise<ScoredExamTaskContext> {
  const who = id(authUserId),
    attempt = id(attemptId),
    key = task(taskKey);
  try {
    const rows = await client.unsafe(SCORED_EXAM_INTAKE_CONTEXT_SQL, [
      who,
      attempt,
      key,
    ] as never[]);
    if (!Array.isArray(rows) || rows.length !== 1) return fail('unavailable');
    const r = data(data(rows[0], ['data']).data, [
      'authUserId',
      'learnerId',
      'cohortId',
      'attemptId',
      'taskKey',
      'definitionDigest',
      'snapshotDigest',
      'filename',
      'maxCodeBytes',
      'policy',
      'policyDigest',
      'serverNow',
      'deadline',
      'status',
      'canSubmit',
    ]);
    const limits = policy(r.policy),
      maximum = positive(r.maxCodeBytes, 262144);
    if (
      r.authUserId !== who ||
      r.attemptId !== attempt ||
      r.taskKey !== key ||
      r.policyDigest !== policyHash(limits) ||
      maximum !== limits.maxCodeBytes ||
      typeof r.serverNow !== 'string' ||
      !timestamp.test(r.serverNow) ||
      typeof r.deadline !== 'string' ||
      !timestamp.test(r.deadline) ||
      !['open', 'closed'].includes(r.status as string) ||
      typeof r.canSubmit !== 'boolean' ||
      (r.status === 'closed' && r.canSubmit)
    )
      return fail('unavailable');
    return Object.freeze({
      authUserId: who,
      learnerId: id(r.learnerId),
      cohortId: id(r.cohortId),
      attemptId: attempt,
      taskKey: key,
      definitionDigest: digest(r.definitionDigest),
      snapshotDigest: digest(r.snapshotDigest),
      filename: file(r.filename),
      maxCodeBytes: maximum,
      policy: limits,
      policyDigest: digest(r.policyDigest),
      serverNow: r.serverNow,
      deadline: r.deadline,
      status: r.status as 'open' | 'closed',
      canSubmit: r.canSubmit,
    });
  } catch {
    return fail('unavailable');
  }
}
const denials = new Set<ScoredExamIntakeDenial>([
  'forbidden',
  'invalid_input',
  'unavailable',
  'closed',
  'conflict',
  'allowance_exhausted',
  'rate_limited',
]);
export async function acceptScoredExamSubmission(
  client: ScoredExamIntakeClient,
  input: ScoredExamSubmissionInput,
): Promise<ScoredExamSubmissionResult> {
  const value = data(input, [
    'authUserId',
    'attemptId',
    'taskKey',
    'requestId',
    'filename',
    'byteLength',
    'answerSha256',
  ]);
  const who = id(value.authUserId),
    attempt = id(value.attemptId),
    key = task(value.taskKey),
    request = id(value.requestId),
    name = file(value.filename),
    bytes = positive(value.byteLength, 262144),
    sha = digest(value.answerSha256);
  let rows: unknown;
  try {
    rows = await client.unsafe(ACCEPT_SCORED_EXAM_SUBMISSION_SQL, [
      who,
      attempt,
      key,
      request,
      name,
      bytes,
      sha,
    ] as never[]);
  } catch {
    return fail('outcome_unknown');
  }
  try {
    if (!Array.isArray(rows) || rows.length !== 1) return fail('outcome_unknown');
    const row = data(rows[0], ['data']);
    if (!row.data || typeof row.data !== 'object' || Array.isArray(row.data))
      return fail('outcome_unknown');
    const kind = Object.getOwnPropertyDescriptor(row.data, 'kind');
    if (!kind || !Object.hasOwn(kind, 'value')) return fail('outcome_unknown');
    if (typeof kind.value === 'string' && denials.has(kind.value as ScoredExamIntakeDenial)) {
      data(row.data, ['kind']);
      return Object.freeze({ kind: kind.value as ScoredExamIntakeDenial });
    }
    const r = data(row.data, [
      'kind',
      'attemptId',
      'taskKey',
      'definitionDigest',
      'snapshotDigest',
      'submissionId',
      'jobId',
      'artifactId',
      'requestId',
      'answerSha256',
      'byteLength',
      'filename',
      'acceptedOrdinal',
      'replayed',
    ]);
    if (
      r.kind !== 'accepted' ||
      r.attemptId !== attempt ||
      r.taskKey !== key ||
      r.requestId !== request ||
      r.answerSha256 !== sha ||
      r.byteLength !== bytes ||
      r.filename !== name ||
      typeof r.replayed !== 'boolean' ||
      typeof r.acceptedOrdinal !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(r.acceptedOrdinal) ||
      BigInt(r.acceptedOrdinal) > 9223372036854775807n
    )
      return fail('outcome_unknown');
    return Object.freeze({
      kind: 'accepted',
      attemptId: attempt,
      taskKey: key,
      definitionDigest: digest(r.definitionDigest),
      snapshotDigest: digest(r.snapshotDigest),
      submissionId: id(r.submissionId),
      jobId: id(r.jobId),
      artifactId: id(r.artifactId),
      requestId: request,
      answerSha256: sha,
      byteLength: bytes,
      filename: name,
      acceptedOrdinal: r.acceptedOrdinal,
      replayed: r.replayed,
    });
  } catch {
    return fail('outcome_unknown');
  }
}
