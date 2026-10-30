import { createHash } from 'node:crypto';
import { isRequestId } from '@nextera/domain';
import {
  captureMixedAnswer,
  serializeMixedAnswer,
  type MixedCheckpointAnswer,
} from './checkpoint-answer';
import { sameEditorScope, type EditorScope } from './editor-contract';
import type { EditorActor, EditorTaskIdentity } from './editor-http';

export type AnswerKind = MixedCheckpointAnswer['kind'];
export type AnswerContract = Readonly<{
  version: 1;
  kind: AnswerKind;
  maxBytes: number;
  digest: string;
}>;
export type AnswerServerContext = Readonly<{
  scope: EditorScope;
  readAllowed: boolean;
  status: 'active' | 'closed';
  serverNow: string;
  deadline: string;
  answerContract: AnswerContract;
}>;
export type PreparedAnswer = Readonly<{
  answer: MixedCheckpointAnswer;
  payload: string;
  sha256: string;
  byteLength: number;
}>;
export type AnswerDraftRecord = Readonly<{
  scope: EditorScope;
  answerContractDigest: string;
  payload: string;
  sha256: string;
  byteLength: number;
  version: number;
  requestId: string | null;
}>;
export type AnswerDraftWrite = PreparedAnswer &
  Readonly<{
    actor: EditorActor;
    scope: EditorScope;
    answerContractDigest: string;
    requestId: string;
    baseVersion: number;
  }>;
/** Every implementation rechecks authority, clock, contract, CAS and idempotency atomically. */
export interface CheckpointAnswerDraftBackend {
  context(actor: EditorActor, task: EditorTaskIdentity): Promise<AnswerServerContext>;
  read(
    actor: EditorActor,
    scope: EditorScope,
    answerContractDigest: string,
    requestId?: string,
  ): Promise<AnswerDraftRecord | null>;
  save(
    input: AnswerDraftWrite,
  ): Promise<
    { kind: 'saved'; record: AnswerDraftRecord } | { kind: 'conflict'; current: AnswerDraftRecord }
  >;
}
export class AnswerApiError extends Error {
  constructor(
    readonly code:
      | 'INVALID_ANSWER'
      | 'FORBIDDEN'
      | 'CLOSED'
      | 'DEFINITION_MISMATCH'
      | 'CONTRACT_MISMATCH'
      | 'IDEMPOTENCY_CONFLICT'
      | 'RATE_LIMITED'
      | 'BUDGET_EXHAUSTED'
      | 'STORAGE_LIMIT'
      | 'UNAVAILABLE',
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}
const hex = /^[0-9a-f]{64}$/;
const taskKey = /^[a-z0-9-]{1,100}$/;
const scopeKeys = ['learnerId', 'cohortId', 'attemptId', 'taskKey', 'definitionDigest'];
const exact = (value: object, keys: readonly string[]) =>
  Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function scopeValid(scope: EditorScope) {
  return (
    !!scope &&
    typeof scope === 'object' &&
    exact(scope, scopeKeys) &&
    [scope.learnerId, scope.cohortId, scope.attemptId].every(
      (id) => typeof id === 'string' && id === id.toLowerCase() && isRequestId(id),
    ) &&
    typeof scope.taskKey === 'string' &&
    taskKey.test(scope.taskKey) &&
    typeof scope.definitionDigest === 'string' &&
    hex.test(scope.definitionDigest)
  );
}
function contractFields(contract: Omit<AnswerContract, 'digest'>) {
  return (
    contract?.version === 1 &&
    typeof contract.kind === 'string' &&
    ['trace_with_reason', 'debug_with_reason'].includes(contract.kind) &&
    Number.isSafeInteger(contract.maxBytes) &&
    contract.maxBytes > 0 &&
    contract.maxBytes <= 262144
  );
}
/** Matches SQL concat_ws(E'\\n', ...); all fields are newline-free and UUIDs are canonical. */
export function answerContractDigest(scope: EditorScope, contract: Omit<AnswerContract, 'digest'>) {
  if (!scopeValid(scope) || !contractFields(contract)) throw new AnswerApiError('UNAVAILABLE');
  return createHash('sha256')
    .update(
      [
        '01coding-checkpoint-answer-contract-v1',
        scope.learnerId,
        scope.cohortId,
        scope.attemptId,
        scope.taskKey,
        scope.definitionDigest,
        '1',
        contract.kind,
        String(contract.maxBytes),
      ].join('\n'),
      'utf8',
    )
    .digest('hex');
}
function assertContract(context: AnswerServerContext) {
  const c = context?.answerContract;
  if (
    !c ||
    typeof c !== 'object' ||
    !exact(c, ['version', 'kind', 'maxBytes', 'digest']) ||
    !contractFields(c) ||
    typeof c.digest !== 'string' ||
    !hex.test(c.digest) ||
    c.digest !== answerContractDigest(context.scope, c)
  )
    throw new AnswerApiError('UNAVAILABLE');
}
export function assertAnswerContext(
  context: AnswerServerContext,
  actor: EditorActor,
  task: EditorTaskIdentity,
) {
  if (!context || !scopeValid(context.scope)) throw new AnswerApiError('UNAVAILABLE');
  if (
    context.scope.learnerId !== actor.id ||
    context.scope.attemptId !== task.attemptId ||
    context.scope.taskKey !== task.taskKey ||
    context.readAllowed !== true
  )
    throw new AnswerApiError('FORBIDDEN');
  if (
    !['active', 'closed'].includes(context.status) ||
    !Number.isFinite(Date.parse(context.serverNow)) ||
    !Number.isFinite(Date.parse(context.deadline))
  )
    throw new AnswerApiError('UNAVAILABLE');
  assertContract(context);
}
export function assertAnswerWriteWindow(context: AnswerServerContext) {
  const now = Date.parse(context.serverNow),
    deadline = Date.parse(context.deadline);
  if (!Number.isFinite(now) || !Number.isFinite(deadline)) throw new AnswerApiError('UNAVAILABLE');
  if (context.status !== 'active' || now >= deadline) throw new AnswerApiError('CLOSED');
}
/** Canonical envelope only; answer text itself is never trimmed, normalized or newline-rewritten. */
export function prepareAnswer(
  value: unknown,
  context: AnswerServerContext,
  complete = false,
): PreparedAnswer {
  assertContract(context);
  try {
    const parsed = complete
      ? captureMixedAnswer(context.scope, value, context.answerContract.maxBytes)
      : serializeMixedAnswer(value, context.answerContract.maxBytes);
    if (parsed.answer.kind !== context.answerContract.kind)
      throw new AnswerApiError('CONTRACT_MISMATCH');
    return Object.freeze({
      answer: parsed.answer,
      payload: parsed.payload,
      byteLength: parsed.byteLength,
      sha256: createHash('sha256').update(parsed.payload, 'utf8').digest('hex'),
    });
  } catch (error) {
    if (error instanceof AnswerApiError) throw error;
    throw new AnswerApiError('INVALID_ANSWER');
  }
}
/** Backend acknowledgements must prove the exact scoped bytes, not merely a success flag. */
export function assertAnswerDraft(
  record: AnswerDraftRecord,
  context: AnswerServerContext,
): PreparedAnswer {
  try {
    if (
      !record ||
      !scopeValid(record.scope) ||
      !sameEditorScope(record.scope, context.scope) ||
      record.answerContractDigest !== context.answerContract.digest ||
      typeof record.payload !== 'string' ||
      typeof record.sha256 !== 'string' ||
      !hex.test(record.sha256) ||
      !Number.isSafeInteger(record.version) ||
      record.version < 1 ||
      (record.requestId !== null &&
        (typeof record.requestId !== 'string' || !isRequestId(record.requestId)))
    )
      throw new Error('Invalid acknowledgement');
    const prepared = prepareAnswer(JSON.parse(record.payload), context);
    if (
      prepared.payload !== record.payload ||
      prepared.sha256 !== record.sha256 ||
      prepared.byteLength !== record.byteLength
    )
      throw new Error('Mismatched acknowledgement');
    return prepared;
  } catch {
    throw new AnswerApiError('UNAVAILABLE');
  }
}
