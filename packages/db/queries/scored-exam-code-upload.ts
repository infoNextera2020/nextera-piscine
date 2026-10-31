import { sql } from 'drizzle-orm';
import type { Sql } from 'postgres';
import type { OperationalDatabase } from '../operations/curriculum';
import type { ScoredExamSubmissionInput, ScoredExamSubmissionResult } from './scored-exam-intake';

export type ScoredExamCodeUploadClient = Pick<Sql, 'unsafe'>;
export type ScoredExamCodeUploadInput = ScoredExamSubmissionInput &
  Readonly<{
    learnerId: string;
    cohortId: string;
    definitionDigest: string;
    snapshotDigest: string;
  }>;
export type ScoredExamCodeUploadDenial =
  | 'forbidden'
  | 'invalid_input'
  | 'unavailable'
  | 'closed'
  | 'conflict'
  | 'allowance_exhausted'
  | 'rate_limited'
  | 'resource_unavailable';
export type ScoredExamCodeAccepted = Extract<ScoredExamSubmissionResult, { kind: 'accepted' }>;
export type ScoredExamCodeUploadResult =
  ScoredExamCodeAccepted | Readonly<{ kind: ScoredExamCodeUploadDenial }>;
export type ScoredExamCodeReservation = Readonly<{
  kind: 'reserved';
  authUserId: string;
  learnerId: string;
  cohortId: string;
  attemptId: string;
  taskKey: ScoredExamSubmissionInput['taskKey'];
  requestId: string;
  definitionDigest: string;
  snapshotDigest: string;
  filename: string;
  byteLength: number;
  answerSha256: string;
  intakePolicyDigest: string;
  uploadPolicyDigest: string;
  bucket: 'nextera-submissions';
  objectKey: string;
  reservedAt: string;
  serverNow: string;
  deadline: string;
  resumed: boolean;
}>;
export class ScoredExamCodeUploadError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'outcome_unknown') {
    super('SCORED_EXAM_CODE_UPLOAD_' + code.toUpperCase());
  }
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const time = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/;
const inputKeys = [
  'authUserId',
  'attemptId',
  'taskKey',
  'requestId',
  'filename',
  'byteLength',
  'answerSha256',
  'learnerId',
  'cohortId',
  'definitionDigest',
  'snapshotDigest',
] as const;
function fail(code: 'invalid_input' | 'unavailable' | 'outcome_unknown' = 'invalid_input'): never {
  throw new ScoredExamCodeUploadError(code);
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const d = Object.getOwnPropertyDescriptors(value),
    names = Reflect.ownKeys(d);
  if (
    names.length !== keys.length ||
    !keys.every((k) => Object.hasOwn(d, k)) ||
    names.some((k) => typeof k !== 'string' || !Object.hasOwn(d[k]!, 'value'))
  )
    return fail();
  return Object.fromEntries(keys.map((k) => [k, d[k]!.value]));
}
function isId(v: unknown): v is string {
  return typeof v === 'string' && uuid.test(v);
}
function isHash(v: unknown): v is string {
  return typeof v === 'string' && hash.test(v);
}
function validTime(v: unknown): v is string {
  return typeof v === 'string' && time.test(v) && Number.isFinite(Date.parse(v));
}
/** Capture a plain immutable exact scope before any I/O. No caller roles/policy overrides. */
export function captureScoredExamCodeUploadInput(
  value: ScoredExamCodeUploadInput,
): ScoredExamCodeUploadInput {
  const r = record(value, inputKeys);
  if (
    ![r.authUserId, r.learnerId, r.cohortId, r.attemptId, r.requestId].every(isId) ||
    ![r.definitionDigest, r.snapshotDigest, r.answerSha256].every(isHash) ||
    typeof r.taskKey !== 'string' ||
    !/^q[1-5]$/.test(r.taskKey) ||
    typeof r.filename !== 'string' ||
    r.filename.length > 100 ||
    !/^[A-Za-z0-9_][A-Za-z0-9_]*[.]go$/.test(r.filename) ||
    !Number.isSafeInteger(r.byteLength) ||
    Number(r.byteLength) < 1 ||
    Number(r.byteLength) > 262144
  )
    return fail();
  return Object.freeze(r) as unknown as ScoredExamCodeUploadInput;
}
export function scoredExamCodeObjectKey(i: ScoredExamCodeUploadInput) {
  return (
    i.authUserId +
    '/' +
    i.cohortId +
    '/scored-exam-v1/' +
    i.attemptId +
    '/' +
    i.taskKey +
    '/' +
    i.requestId +
    '/' +
    i.answerSha256
  );
}
export const SCORED_EXAM_CODE_RECEIPT_SQL =
  'SELECT app.scored_exam_code_receipt($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::integer,$7) AS data';
export const RESERVE_SCORED_EXAM_CODE_UPLOAD_SQL =
  'SELECT app.reserve_scored_exam_code_upload($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::integer,$7) AS data';
export const ACCEPT_SCORED_EXAM_CODE_UPLOAD_SQL =
  'SELECT app.accept_scored_exam_code_upload($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::integer,$7) AS data';
/** Closed parameterized dispatch: never exposes the underlying database's SQL surface. */
export function createScoredExamCodeUploadClient(
  db: OperationalDatabase,
): ScoredExamCodeUploadClient {
  const unsafe = async (statement: string, a: readonly unknown[] = []) => {
    if (a.length !== 7) throw new Error('SCORED_EXAM_CODE_RPC_UNAVAILABLE');
    if (statement === SCORED_EXAM_CODE_RECEIPT_SQL)
      return db.execute(
        sql`SELECT app.scored_exam_code_receipt(${a[0]}::uuid,${a[1]}::uuid,${a[2]},${a[3]}::uuid,${a[4]},${a[5]}::integer,${a[6]}) AS data`,
      );
    if (statement === RESERVE_SCORED_EXAM_CODE_UPLOAD_SQL)
      return db.execute(
        sql`SELECT app.reserve_scored_exam_code_upload(${a[0]}::uuid,${a[1]}::uuid,${a[2]},${a[3]}::uuid,${a[4]},${a[5]}::integer,${a[6]}) AS data`,
      );
    if (statement === ACCEPT_SCORED_EXAM_CODE_UPLOAD_SQL)
      return db.execute(
        sql`SELECT app.accept_scored_exam_code_upload(${a[0]}::uuid,${a[1]}::uuid,${a[2]},${a[3]}::uuid,${a[4]},${a[5]}::integer,${a[6]}) AS data`,
      );
    throw new Error('SCORED_EXAM_CODE_RPC_UNAVAILABLE');
  };
  return Object.freeze({ unsafe }) as unknown as ScoredExamCodeUploadClient;
}
const denials = new Set<ScoredExamCodeUploadDenial>([
  'forbidden',
  'invalid_input',
  'unavailable',
  'closed',
  'conflict',
  'allowance_exhausted',
  'rate_limited',
  'resource_unavailable',
]);
function accepted(
  raw: unknown,
  i: ScoredExamCodeUploadInput,
  replayOnly: boolean,
): ScoredExamCodeAccepted {
  const r = record(raw, [
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
    r.attemptId !== i.attemptId ||
    r.taskKey !== i.taskKey ||
    r.definitionDigest !== i.definitionDigest ||
    r.snapshotDigest !== i.snapshotDigest ||
    r.requestId !== i.requestId ||
    r.answerSha256 !== i.answerSha256 ||
    r.byteLength !== i.byteLength ||
    r.filename !== i.filename ||
    ![r.submissionId, r.jobId, r.artifactId].every(isId) ||
    typeof r.replayed !== 'boolean' ||
    (replayOnly && r.replayed !== true) ||
    typeof r.acceptedOrdinal !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(r.acceptedOrdinal) ||
    BigInt(r.acceptedOrdinal) > 9223372036854775807n
  )
    return fail();
  return Object.freeze(r) as unknown as ScoredExamCodeAccepted;
}
function reserved(raw: unknown, i: ScoredExamCodeUploadInput): ScoredExamCodeReservation {
  const r = record(raw, [
    'kind',
    ...inputKeys,
    'intakePolicyDigest',
    'uploadPolicyDigest',
    'bucket',
    'objectKey',
    'reservedAt',
    'serverNow',
    'deadline',
    'resumed',
  ]);
  if (
    r.kind !== 'reserved' ||
    !inputKeys.every((k) => r[k] === i[k]) ||
    !isHash(r.intakePolicyDigest) ||
    !isHash(r.uploadPolicyDigest) ||
    r.bucket !== 'nextera-submissions' ||
    r.objectKey !== scoredExamCodeObjectKey(i) ||
    !validTime(r.reservedAt) ||
    !validTime(r.serverNow) ||
    !validTime(r.deadline) ||
    Date.parse(r.reservedAt) > Date.parse(r.serverNow) ||
    Date.parse(r.serverNow) >= Date.parse(r.deadline) ||
    typeof r.resumed !== 'boolean'
  )
    return fail();
  return Object.freeze(r) as unknown as ScoredExamCodeReservation;
}
async function invoke(
  client: ScoredExamCodeUploadClient,
  input: ScoredExamCodeUploadInput,
  statement: string,
  mode: 'receipt' | 'reserve' | 'accept',
) {
  const i = captureScoredExamCodeUploadInput(input),
    failure = mode === 'receipt' ? 'unavailable' : 'outcome_unknown';
  let rows: unknown;
  try {
    rows = await client.unsafe(statement, [
      i.authUserId,
      i.attemptId,
      i.taskKey,
      i.requestId,
      i.filename,
      i.byteLength,
      i.answerSha256,
    ] as never[]);
  } catch {
    return fail(failure);
  }
  try {
    if (!Array.isArray(rows) || rows.length !== 1) return fail();
    const raw = record(rows[0], ['data']).data;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
    const d = Object.getOwnPropertyDescriptor(raw, 'kind');
    if (!d || !Object.hasOwn(d, 'value')) return fail();
    if (typeof d.value === 'string' && denials.has(d.value as ScoredExamCodeUploadDenial)) {
      record(raw, ['kind']);
      return Object.freeze({ kind: d.value as ScoredExamCodeUploadDenial });
    }
    if (d.value === 'absent' && mode === 'receipt') {
      record(raw, ['kind']);
      return Object.freeze({ kind: 'absent' as const });
    }
    if (d.value === 'reserved' && mode === 'reserve') return reserved(raw, i);
    return accepted(raw, i, mode === 'receipt');
  } catch {
    return fail(failure);
  }
}
/** Read-only POST receipt lookup: SQL freshly checks active access and deadline even on replay. */
export async function readScoredExamCodeReceipt(
  client: ScoredExamCodeUploadClient,
  input: ScoredExamCodeUploadInput,
) {
  return invoke(client, input, SCORED_EXAM_CODE_RECEIPT_SQL, 'receipt') as Promise<
    ScoredExamCodeUploadResult | Readonly<{ kind: 'absent' }>
  >;
}
/** Ambiguous reservation outcomes stay unknown and must resume the same exact request. */
export async function reserveScoredExamCodeUpload(
  client: ScoredExamCodeUploadClient,
  input: ScoredExamCodeUploadInput,
) {
  return invoke(client, input, RESERVE_SCORED_EXAM_CODE_UPLOAD_SQL, 'reserve') as Promise<
    ScoredExamCodeUploadResult | ScoredExamCodeReservation
  >;
}
export async function acceptScoredExamCodeUpload(
  client: ScoredExamCodeUploadClient,
  input: ScoredExamCodeUploadInput,
) {
  return invoke(
    client,
    input,
    ACCEPT_SCORED_EXAM_CODE_UPLOAD_SQL,
    'accept',
  ) as Promise<ScoredExamCodeUploadResult>;
}
