import { isRequestId } from '@nextera/domain';
import { serializeMixedAnswer } from './checkpoint-answer';
import { sameEditorScope, type EditorScope } from './editor-contract';
import type { EditorActor, EditorTaskIdentity } from './editor-http';
import {
  AnswerApiError,
  assertAnswerContext,
  assertAnswerWriteWindow,
  prepareAnswer,
  type AnswerKind,
  type AnswerServerContext,
  type PreparedAnswer,
} from './answer-server-contract';

export type OfficialAnswerContext = AnswerServerContext & Readonly<{ submitAllowed: boolean }>;
/** A reviewed registry entry, never an executable path, source grader or visible-example route. */
export type AnswerEvaluatorRoute = Readonly<{
  family: 'checkpoint_structured_answer';
  version: 1;
  kind: AnswerKind;
  definitionDigest: string;
  taskKey: string;
  evaluatorKey: string;
  evaluatorDigest: string;
}>;
export type OfficialAnswerWrite = PreparedAnswer &
  Readonly<{
    schema: 1;
    actor: EditorActor;
    scope: EditorScope;
    requestId: string;
    answerContractDigest: string;
    evaluator: AnswerEvaluatorRoute;
    /** false means exact existing-receipt replay only; never new intake. */
    allowNew: boolean;
  }>;
export type OfficialAnswerReceipt = Readonly<{
  id: string;
  actor: EditorActor;
  scope: EditorScope;
  requestId: string;
  answerContractDigest: string;
  answerVersion: 1;
  answerKind: AnswerKind;
  sha256: string;
  byteLength: number;
  evaluator: AnswerEvaluatorRoute;
  /** Original acceptance/outbox state, not a verdict or current evaluation-history query. */
  evaluation: 'pending';
}>;
export type AnswerSubmissionRejection =
  | 'invalid_input'
  | 'forbidden'
  | 'closed'
  | 'definition_mismatch'
  | 'contract_mismatch'
  | 'conflict'
  | 'rate_limited'
  | 'budget_exhausted'
  | 'unavailable';
export type AnswerSubmissionCommit =
  | Readonly<{ kind: 'accepted'; receipt: OfficialAnswerReceipt; replayed: boolean }>
  | Readonly<{ kind: AnswerSubmissionRejection }>;
/**
 * No official typed-answer SQL adapter/RPC exists in this slice. A future implementation MUST:
 * - bind verified auth identity to active learner/cohort/attempt/question and frozen kind/contract;
 * - recheck live access, server clock, routing and definition atomically even for receipt replay;
 * - replay only the exact actor/scope/request/payload/contract/evaluator identity, otherwise conflict;
 * - for NEW intake check allowNew AND live graded allowance, then insert immutable payload, pending
 *   evaluator outbox and allowance debit in ONE transaction; no partial records/jobs/debits;
 * - return known denials only after proving no new intake committed. Exceptions are uncertain.
 * Draft Save is deliberately absent. This port must never route to Go Runner or grade reasoning.
 */
export interface AnswerSubmissionRepository {
  context(actor: EditorActor, task: EditorTaskIdentity): Promise<OfficialAnswerContext>;
  accept(input: OfficialAnswerWrite): Promise<AnswerSubmissionCommit>;
}
export type OfficialAnswerSubmissionOutcome =
  | Readonly<{
      kind: 'accepted';
      id: string;
      requestId: string;
      replayed: boolean;
      evaluation: 'pending';
    }>
  | Readonly<{ kind: AnswerSubmissionRejection; retryAfterSeconds?: number }>
  | Readonly<{ kind: 'uncertain'; requestId: string }>;
export type AnswerSubmissionSettings = Readonly<{
  enabled: boolean;
  repository: AnswerSubmissionRepository | null;
  evaluators: readonly AnswerEvaluatorRoute[] | null;
}>;
const hex = /^[a-f0-9]{64}$/;
const key = /^[a-z0-9-]{1,100}$/;
const routeKeys = [
  'family',
  'version',
  'kind',
  'definitionDigest',
  'taskKey',
  'evaluatorKey',
  'evaluatorDigest',
] as const;
const commandKeys = [
  'attemptId',
  'taskKey',
  'requestId',
  'definitionDigest',
  'answerContractDigest',
  'answer',
] as const;
const scopeKeys = ['learnerId', 'cohortId', 'attemptId', 'taskKey', 'definitionDigest'];
const rejectionKinds = new Set<AnswerSubmissionRejection>([
  'invalid_input',
  'forbidden',
  'closed',
  'definition_mismatch',
  'contract_mismatch',
  'conflict',
  'rate_limited',
  'budget_exhausted',
  'unavailable',
]);
function dataObject(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AnswerApiError('INVALID_ANSWER');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (
    (keys &&
      (names.length !== keys.length || !keys.every((name) => Object.hasOwn(descriptors, name)))) ||
    names.some((name) => typeof name !== 'string' || !Object.hasOwn(descriptors[name]!, 'value'))
  )
    throw new AnswerApiError('INVALID_ANSWER');
  // A data-only copy snapshots mutable/getter-backed caller objects before the first await.
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const name of names as string[]) result[name] = descriptors[name]!.value;
  return result;
}
function frozenRoute(value: unknown): AnswerEvaluatorRoute {
  const route = dataObject(value, routeKeys);
  if (
    route.family !== 'checkpoint_structured_answer' ||
    route.version !== 1 ||
    !['trace_with_reason', 'debug_with_reason'].includes(route.kind as string) ||
    typeof route.kind !== 'string' ||
    typeof route.definitionDigest !== 'string' ||
    !hex.test(route.definitionDigest) ||
    typeof route.taskKey !== 'string' ||
    !key.test(route.taskKey) ||
    typeof route.evaluatorKey !== 'string' ||
    !key.test(route.evaluatorKey) ||
    typeof route.evaluatorDigest !== 'string' ||
    !hex.test(route.evaluatorDigest)
  )
    throw new AnswerApiError('UNAVAILABLE');
  return Object.freeze({
    family: 'checkpoint_structured_answer',
    version: 1,
    kind: route.kind as AnswerKind,
    definitionDigest: route.definitionDigest,
    taskKey: route.taskKey,
    evaluatorKey: route.evaluatorKey,
    evaluatorDigest: route.evaluatorDigest,
  });
}
function sameRoute(a: AnswerEvaluatorRoute, b: AnswerEvaluatorRoute) {
  return !!a && routeKeys.every((name) => a[name] === b[name]);
}
function rejection(error: unknown): OfficialAnswerSubmissionOutcome {
  if (!(error instanceof AnswerApiError)) return { kind: 'unavailable' };
  const codes: Record<AnswerApiError['code'], AnswerSubmissionRejection> = {
    INVALID_ANSWER: 'invalid_input',
    FORBIDDEN: 'forbidden',
    CLOSED: 'closed',
    DEFINITION_MISMATCH: 'definition_mismatch',
    CONTRACT_MISMATCH: 'contract_mismatch',
    IDEMPOTENCY_CONFLICT: 'conflict',
    RATE_LIMITED: 'rate_limited',
    BUDGET_EXHAUSTED: 'budget_exhausted',
    UNAVAILABLE: 'unavailable',
    STORAGE_LIMIT: 'unavailable',
  };
  if (!Object.hasOwn(codes, error.code)) return { kind: 'unavailable' };
  const retry = error.retryAfterSeconds;
  return error.code === 'RATE_LIMITED' &&
    typeof retry === 'number' &&
    Number.isSafeInteger(retry) &&
    retry > 0
    ? { kind: codes[error.code], retryAfterSeconds: retry }
    : { kind: codes[error.code] };
}
function captureCommand(input: unknown) {
  const raw = dataObject(input, commandKeys);
  if (
    typeof raw.attemptId !== 'string' ||
    !isRequestId(raw.attemptId) ||
    typeof raw.requestId !== 'string' ||
    !isRequestId(raw.requestId) ||
    typeof raw.taskKey !== 'string' ||
    !key.test(raw.taskKey) ||
    typeof raw.definitionDigest !== 'string' ||
    !hex.test(raw.definitionDigest) ||
    typeof raw.answerContractDigest !== 'string' ||
    !hex.test(raw.answerContractDigest)
  )
    throw new AnswerApiError('INVALID_ANSWER');
  let captured: ReturnType<typeof serializeMixedAnswer>;
  try {
    captured = serializeMixedAnswer(dataObject(raw.answer), 262144);
  } catch {
    throw new AnswerApiError('INVALID_ANSWER');
  }
  return Object.freeze({
    attemptId: raw.attemptId.toLowerCase(),
    taskKey: raw.taskKey,
    requestId: raw.requestId.toLowerCase(),
    definitionDigest: raw.definitionDigest,
    answerContractDigest: raw.answerContractDigest,
    answer: captured.answer,
  });
}
function frozenContext(value: OfficialAnswerContext): OfficialAnswerContext {
  return Object.freeze({
    scope: Object.freeze({
      learnerId: value.scope.learnerId,
      cohortId: value.scope.cohortId,
      attemptId: value.scope.attemptId,
      taskKey: value.scope.taskKey,
      definitionDigest: value.scope.definitionDigest,
    }),
    readAllowed: value.readAllowed,
    status: value.status,
    serverNow: value.serverNow,
    deadline: value.deadline,
    answerContract: Object.freeze({
      version: value.answerContract.version,
      kind: value.answerContract.kind,
      maxBytes: value.answerContract.maxBytes,
      digest: value.answerContract.digest,
    }),
    submitAllowed: value.submitAllowed,
  });
}
function validReceipt(receipt: OfficialAnswerReceipt, write: OfficialAnswerWrite) {
  return (
    !!receipt &&
    typeof receipt.id === 'string' &&
    isRequestId(receipt.id) &&
    receipt.id === receipt.id.toLowerCase() &&
    !!receipt.actor &&
    receipt.actor.id === write.actor.id &&
    receipt.actor.authUserId === write.actor.authUserId &&
    !!receipt.scope &&
    Reflect.ownKeys(receipt.scope).length === scopeKeys.length &&
    scopeKeys.every((name) => Object.hasOwn(receipt.scope, name)) &&
    sameEditorScope(receipt.scope, write.scope) &&
    receipt.requestId === write.requestId &&
    receipt.answerContractDigest === write.answerContractDigest &&
    receipt.answerVersion === write.answer.version &&
    receipt.answerKind === write.answer.kind &&
    receipt.sha256 === write.sha256 &&
    receipt.byteLength === write.byteLength &&
    sameRoute(receipt.evaluator, write.evaluator) &&
    receipt.evaluation === 'pending'
  );
}

/** Explicit Submit only. Construction creates no client, evaluator, database or policy default. */
export function createOfficialAnswerSubmission(settings: AnswerSubmissionSettings | null) {
  let routes: readonly AnswerEvaluatorRoute[] = [];
  let configured = false;
  const repository = settings?.repository;
  try {
    if (
      settings?.enabled === true &&
      repository &&
      typeof repository.context === 'function' &&
      typeof repository.accept === 'function' &&
      Array.isArray(settings.evaluators) &&
      settings.evaluators.length
    ) {
      routes = Object.freeze(settings.evaluators.map(frozenRoute));
      const identities = routes.map((route) =>
        JSON.stringify([route.kind, route.version, route.definitionDigest, route.taskKey]),
      );
      configured = new Set(identities).size === routes.length;
    }
  } catch {
    configured = false;
  }
  const context = configured ? repository!.context.bind(repository) : null;
  const accept = configured ? repository!.accept.bind(repository) : null;
  return {
    async submit(actor: EditorActor, input: unknown): Promise<OfficialAnswerSubmissionOutcome> {
      if (!configured || !context || !accept) return { kind: 'unavailable' };
      let write: OfficialAnswerWrite;
      try {
        const id = actor?.id,
          authUserId = actor?.authUserId;
        if (
          typeof id !== 'string' ||
          !isRequestId(id) ||
          typeof authUserId !== 'string' ||
          !isRequestId(authUserId)
        )
          throw new AnswerApiError('FORBIDDEN');
        const who = Object.freeze({ id: id.toLowerCase(), authUserId: authUserId.toLowerCase() });
        const command = captureCommand(input);
        const route = routes.find(
          (item) =>
            item.kind === command.answer.kind &&
            item.version === command.answer.version &&
            item.taskKey === command.taskKey &&
            item.definitionDigest === command.definitionDigest,
        );
        if (!route) return { kind: 'unavailable' };
        const task = Object.freeze({ attemptId: command.attemptId, taskKey: command.taskKey });
        const rawAuthority = await context(who, task);
        assertAnswerContext(rawAuthority, who, task);
        const authority = frozenContext(rawAuthority);
        assertAnswerContext(authority, who, task);
        assertAnswerWriteWindow(authority);
        if (typeof authority.submitAllowed !== 'boolean') throw new AnswerApiError('UNAVAILABLE');
        if (authority.scope.definitionDigest !== command.definitionDigest)
          throw new AnswerApiError('DEFINITION_MISMATCH');
        if (authority.answerContract.digest !== command.answerContractDigest)
          throw new AnswerApiError('CONTRACT_MISMATCH');
        const prepared = prepareAnswer(command.answer, authority, true);
        write = Object.freeze({
          ...prepared,
          schema: 1,
          actor: who,
          scope: authority.scope,
          requestId: command.requestId,
          answerContractDigest: authority.answerContract.digest,
          evaluator: route,
          allowNew: authority.submitAllowed,
        });
      } catch (error) {
        return rejection(error);
      }
      try {
        const committed = await accept(write);
        if (committed?.kind === 'accepted') {
          if (
            typeof committed.replayed !== 'boolean' ||
            (!write.allowNew && !committed.replayed) ||
            !validReceipt(committed.receipt, write)
          )
            return { kind: 'uncertain', requestId: write.requestId };
          return Object.freeze({
            kind: 'accepted',
            id: committed.receipt.id,
            requestId: write.requestId,
            replayed: committed.replayed,
            evaluation: 'pending',
          });
        }
        if (committed && rejectionKinds.has(committed.kind as AnswerSubmissionRejection))
          return { kind: committed.kind as AnswerSubmissionRejection };
      } catch {
        /* Commit may have succeeded; no automatic retry, new request ID or false failure. */
      }
      return { kind: 'uncertain', requestId: write.requestId };
    },
  };
}
