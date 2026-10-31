import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import postgres from 'postgres';
import { checkpointCanonicalJson } from '../operations/scored-exam-publication';

export const ATM_SEMANTIC_PROFILE_DIGEST =
  'f09da2b66999409f6dc08ea8f54ef5c34ac259d48cccf5b1d66ecb63ad4c1007';
export const ATM_MODEL_ID = 'atm-independent-model-v1';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
export class AtmEvidenceError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'unknown_outcome') {
    super('ATM_EVIDENCE_' + code.toUpperCase());
  }
}
function fail(code: AtmEvidenceError['code'] = 'invalid_input'): never {
  throw new AtmEvidenceError(code);
}
function object(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail();
  const d = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(d).length !== names.length ||
    names.some((n) => !Object.hasOwn(d, n) || !Object.hasOwn(d[n]!, 'value'))
  )
    return fail();
  return Object.fromEntries(names.map((n) => [n, d[n]!.value]));
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) return fail();
  return value;
}
const id = (v: unknown) => text(v, UUID);
const hash = (v: unknown) => text(v, HASH);
function integer(v: unknown, low = 0, high = 2147483647): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < low || v > high) return fail();
  return v;
}
function generation(v: unknown): string {
  const value = text(v, /^[1-9][0-9]{0,18}$/);
  if (BigInt(value) > 9223372036854775807n) return fail();
  return value;
}
export function atmCanonical(value: unknown): string {
  try {
    return checkpointCanonicalJson(value);
  } catch {
    return fail();
  }
}
export function atmDigest(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain + '\0v1\0' + atmCanonical(value))
    .digest('hex');
}
export type AtmEvidenceLimits = Readonly<{
  maxPayloadBytes: number;
  maxStdinBytes: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxCaseCount: number;
}>;
export function captureAtmLimits(value: unknown): AtmEvidenceLimits {
  const v = object(value, [
    'maxPayloadBytes',
    'maxStdinBytes',
    'maxStdoutBytes',
    'maxStderrBytes',
    'maxCaseCount',
  ]);
  return Object.freeze(
    Object.fromEntries(Object.entries(v).map(([k, n]) => [k, integer(n, 1)])),
  ) as AtmEvidenceLimits;
}
export type AtmResolveRequest = Readonly<{
  version: 1;
  jobId: string;
  judgeAttemptId: string;
  workerId: string;
  generation: string;
  submissionId: string;
  evaluationSnapshotDigest: string;
}>;
export function captureAtmResolve(value: unknown): AtmResolveRequest {
  const v = object(value, [
    'version',
    'jobId',
    'judgeAttemptId',
    'workerId',
    'generation',
    'submissionId',
    'evaluationSnapshotDigest',
  ]);
  if (v.version !== 1) return fail();
  return Object.freeze({
    version: 1,
    jobId: id(v.jobId),
    judgeAttemptId: id(v.judgeAttemptId),
    workerId: id(v.workerId),
    generation: generation(v.generation),
    submissionId: id(v.submissionId),
    evaluationSnapshotDigest: hash(v.evaluationSnapshotDigest),
  });
}
const CONTEXT_KEYS = [
  'version',
  'jobId',
  'judgeAttemptId',
  'workerId',
  'generation',
  'submissionId',
  'raidAttemptId',
  'teamId',
  'cohortId',
  'curriculumVersionId',
  'nodeKey',
  'sourceSha256',
  'evaluationSnapshotDigest',
  'evaluationSpecDigest',
  'definitionDigest',
  'testPackId',
  'testPackDigest',
  'semanticProfileDigest',
  'runnerImageDigest',
  'resourcePolicyDigest',
  'modelId',
  'caseCount',
  'contextDigest',
] as const;
export type AtmCaptureContext = AtmResolveRequest &
  Readonly<{
    raidAttemptId: string;
    teamId: string;
    cohortId: string;
    curriculumVersionId: string;
    nodeKey: string;
    sourceSha256: string;
    evaluationSpecDigest: string;
    definitionDigest: string;
    testPackId: string;
    testPackDigest: string;
    semanticProfileDigest: string;
    runnerImageDigest: string;
    resourcePolicyDigest: string;
    modelId: typeof ATM_MODEL_ID;
    caseCount: number;
    contextDigest: string;
  }>;
export function captureAtmContext(value: unknown): AtmCaptureContext {
  const v = object(value, CONTEXT_KEYS);
  const context: AtmCaptureContext = Object.freeze({
    ...captureAtmResolve(
      Object.fromEntries(
        [
          'version',
          'jobId',
          'judgeAttemptId',
          'workerId',
          'generation',
          'submissionId',
          'evaluationSnapshotDigest',
        ].map((k) => [k, v[k]]),
      ),
    ),
    raidAttemptId: id(v.raidAttemptId),
    teamId: id(v.teamId),
    cohortId: id(v.cohortId),
    curriculumVersionId: id(v.curriculumVersionId),
    nodeKey: text(v.nodeKey, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/),
    sourceSha256: hash(v.sourceSha256),
    evaluationSpecDigest: hash(v.evaluationSpecDigest),
    definitionDigest: hash(v.definitionDigest),
    testPackId: text(v.testPackId, /^[a-z][a-z0-9-]{0,99}$/),
    testPackDigest: hash(v.testPackDigest),
    semanticProfileDigest: hash(v.semanticProfileDigest),
    runnerImageDigest: text(v.runnerImageDigest, /^sha256:[0-9a-f]{64}$/),
    resourcePolicyDigest: hash(v.resourcePolicyDigest),
    modelId: ATM_MODEL_ID,
    caseCount: integer(v.caseCount, 1),
    contextDigest: hash(v.contextDigest),
  });
  const { contextDigest, ...body } = context;
  if (
    v.modelId !== ATM_MODEL_ID ||
    context.semanticProfileDigest !== ATM_SEMANTIC_PROFILE_DIGEST ||
    contextDigest !== atmDigest('nextera-atm-capture-context', body)
  )
    return fail();
  return context;
}
export type AtmCaseCapture = Readonly<{
  caseFile: 'cases/public.json' | 'cases/private.json';
  caseIndex: number;
  inputSha256: string;
  stdinBase64: string;
  stdoutBase64: string;
  stderrBase64: string;
  exitCode: number | null;
  transportWriteComplete: boolean;
  stdinHalfClosed: boolean;
  outputComplete: boolean;
  termination: 'exited' | 'timed_out' | 'unknown';
  assessment:
    | 'observations_match'
    | 'projection_mismatch'
    | 'execution_not_clean'
    | 'incomplete_observation'
    | 'capture_unavailable';
}>;
function bytes(v: unknown, maximum: number): { text: string; bytes: Buffer } {
  if (
    typeof v !== 'string' ||
    v.length > 4 * Math.ceil(maximum / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v)
  )
    return fail();
  const made = Buffer.from(v, 'base64');
  if (made.byteLength > maximum || made.toString('base64') !== v) return fail();
  return { text: v, bytes: made };
}
export function captureAtmCases(
  value: unknown,
  context: AtmCaptureContext,
  limits: AtmEvidenceLimits,
): readonly AtmCaseCapture[] {
  if (
    !Array.isArray(value) ||
    value.length > context.caseCount ||
    value.length > limits.maxCaseCount ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return fail();
  let privateSeen = false;
  return Object.freeze(
    Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return fail();
      const raw: unknown = descriptor.value;
      const v = object(raw, [
        'caseFile',
        'caseIndex',
        'inputSha256',
        'stdinBase64',
        'stdoutBase64',
        'stderrBase64',
        'exitCode',
        'transportWriteComplete',
        'stdinHalfClosed',
        'outputComplete',
        'termination',
        'assessment',
      ]);
      const caseFile = text(v.caseFile, /^cases\/(?:public|private)[.]json$/);
      if (integer(v.caseIndex) !== index || (privateSeen && caseFile === 'cases/public.json'))
        return fail();
      privateSeen ||= caseFile === 'cases/private.json';
      const input = bytes(v.stdinBase64, limits.maxStdinBytes);
      const output = bytes(v.stdoutBase64, limits.maxStdoutBytes),
        error = bytes(v.stderrBase64, limits.maxStderrBytes);
      if (createHash('sha256').update(input.bytes).digest('hex') !== hash(v.inputSha256))
        return fail();
      for (const key of ['transportWriteComplete', 'stdinHalfClosed', 'outputComplete'])
        if (typeof v[key] !== 'boolean') return fail();
      const termination = text(v.termination, /^(?:exited|timed_out|unknown)$/);
      const assessment = text(
        v.assessment,
        /^(?:observations_match|projection_mismatch|execution_not_clean|incomplete_observation|capture_unavailable)$/,
      );
      const exitCode = v.exitCode === null ? null : integer(v.exitCode, 0, 255);
      if (
        (termination === 'exited') !== (exitCode !== null) ||
        (v.outputComplete && termination !== 'exited') ||
        (['observations_match', 'projection_mismatch'].includes(assessment) &&
          !(
            v.transportWriteComplete &&
            v.stdinHalfClosed &&
            v.outputComplete &&
            termination === 'exited' &&
            exitCode === 0
          ))
      )
        return fail();
      return Object.freeze({
        ...v,
        caseFile,
        termination,
        assessment,
        stdinBase64: input.text,
        stdoutBase64: output.text,
        stderrBase64: error.text,
        exitCode,
      }) as AtmCaseCapture;
    }),
  );
}
export type AtmRetainRequest = Readonly<{
  version: 1;
  operationId: string;
  context: AtmCaptureContext;
  captureDigest: string;
  captures: readonly AtmCaseCapture[];
}>;
export function captureAtmRetain(value: unknown, limits: AtmEvidenceLimits): AtmRetainRequest {
  const v = object(value, ['version', 'operationId', 'context', 'captureDigest', 'captures']);
  if (v.version !== 1) return fail();
  const context = captureAtmContext(v.context),
    captures = captureAtmCases(v.captures, context, limits);
  const body = { version: 1 as const, context, captures };
  if (
    Buffer.byteLength(atmCanonical(body)) > limits.maxPayloadBytes ||
    hash(v.captureDigest) !== atmDigest('nextera-atm-capture', body)
  )
    return fail();
  return Object.freeze({
    version: 1,
    operationId: id(v.operationId),
    context,
    captureDigest: v.captureDigest as string,
    captures,
  });
}
export type AtmReconcileRequest = Omit<AtmRetainRequest, 'captures'>;
export function captureAtmReconcile(value: unknown): AtmReconcileRequest {
  const v = object(value, ['version', 'operationId', 'context', 'captureDigest']);
  if (v.version !== 1) return fail();
  return Object.freeze({
    version: 1,
    operationId: id(v.operationId),
    context: captureAtmContext(v.context),
    captureDigest: hash(v.captureDigest),
  });
}
export type AtmRetainedReceipt = Readonly<{
  version: 1;
  operationId: string;
  contextDigest: string;
  captureDigest: string;
  state: 'retained';
}>;
export type AtmReconciledReceipt = Omit<AtmRetainedReceipt, 'state'> &
  Readonly<{ state: 'retained' | 'not_retained' }>;
export interface AtmEvidenceClient {
  unsafe(query: string, values: never[]): Promise<unknown>;
}
/** Existing postgres-js driver, explicit worker DSN and lifetime; inert on import. */
export function openAtmEvidencePostgres(
  dsn: string,
  timeoutMs: number,
): Readonly<{ client: AtmEvidenceClient; close(): Promise<void> }> {
  try {
    integer(timeoutMs, 1);
    if (typeof dsn !== 'string' || !dsn) return fail('unavailable');
    const url = new URL(dsn);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.username ||
      url.pathname === '/'
    )
      return fail('unavailable');
    const seconds = Math.ceil(timeoutMs / 1000);
    const connection = postgres(dsn, {
      prepare: false,
      max: 1,
      connect_timeout: seconds,
      idle_timeout: seconds,
      debug: false,
      onnotice: () => {
        /* Never print provider notices or bound parameters. */
      },
    });
    return Object.freeze({
      client: {
        async unsafe(query: string, values: never[]) {
          // Await explicit COMMIT, not just a SELECT's row/CommandComplete delivery.
          return await connection.begin(
            async (transaction) => await transaction.unsafe(query, values),
          );
        },
      },
      close: () => connection.end({ timeout: seconds }),
    });
  } catch {
    return fail('unavailable');
  }
}
export const ATM_RESOLVE_SQL =
  'SELECT judge.resolve_atm_capture_context($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid,$6::text,$7::uuid) AS data';
export const ATM_RETAIN_SQL =
  'SELECT judge.retain_atm_capture($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid,$6::jsonb,$7::text,$8::jsonb,$9::uuid) AS data';
export const ATM_RECONCILE_SQL =
  'SELECT judge.reconcile_atm_capture($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid,$6::jsonb,$7::text,$8::uuid) AS data';
function one(rows: unknown): unknown {
  if (!Array.isArray(rows) || rows.length !== 1) return fail('unavailable');
  return object(rows[0], ['data']).data;
}
function ack(value: unknown, input: AtmReconcileRequest, reconcile: boolean): AtmReconciledReceipt {
  const v = object(value, ['version', 'operationId', 'contextDigest', 'captureDigest', 'state']);
  if (
    v.version !== 1 ||
    v.operationId !== input.operationId ||
    v.contextDigest !== input.context.contextDigest ||
    v.captureDigest !== input.captureDigest ||
    (v.state !== 'retained' && (!reconcile || v.state !== 'not_retained'))
  )
    return fail('unavailable');
  return Object.freeze({ ...v }) as AtmReconciledReceipt;
}
export function createPostgresAtmEvidenceStore(
  client: AtmEvidenceClient,
  policy: AtmEvidenceLimits,
) {
  const limits = captureAtmLimits(policy);
  return Object.freeze({
    async resolve(value: unknown, token: string): Promise<AtmCaptureContext> {
      const request = captureAtmResolve(value),
        claim = id(token);
      try {
        const context = captureAtmContext(
          one(
            await client.unsafe(ATM_RESOLVE_SQL, [
              request.jobId,
              request.judgeAttemptId,
              request.workerId,
              request.generation,
              request.submissionId,
              request.evaluationSnapshotDigest,
              claim,
            ] as never[]),
          ),
        );
        if (
          Object.entries(request).some(([k, v]) => context[k as keyof AtmCaptureContext] !== v) ||
          context.caseCount > limits.maxCaseCount
        )
          return fail('unavailable');
        return context;
      } catch {
        return fail('unavailable');
      }
    },
    async retain(value: unknown, token: string): Promise<AtmRetainedReceipt> {
      const input = captureAtmRetain(value, limits),
        claim = id(token),
        c = input.context;
      try {
        const result = one(
          await client.unsafe(ATM_RETAIN_SQL, [
            c.jobId,
            c.judgeAttemptId,
            c.workerId,
            c.generation,
            input.operationId,
            atmCanonical(c),
            input.captureDigest,
            atmCanonical(input.captures),
            claim,
          ] as never[]),
        );
        return ack(result, input, false) as AtmRetainedReceipt;
      } catch {
        return fail('unknown_outcome');
      } // Never retry or replace the caller's original operation.
    },
    async reconcile(value: unknown, token: string): Promise<AtmReconciledReceipt> {
      const input = captureAtmReconcile(value),
        claim = id(token),
        c = input.context;
      try {
        return ack(
          one(
            await client.unsafe(ATM_RECONCILE_SQL, [
              c.jobId,
              c.judgeAttemptId,
              c.workerId,
              c.generation,
              input.operationId,
              atmCanonical(c),
              input.captureDigest,
              claim,
            ] as never[]),
          ),
          input,
          true,
        );
      } catch {
        return fail('unavailable');
      }
    },
  });
}
