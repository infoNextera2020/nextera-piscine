import { sql } from 'drizzle-orm';
import { isRequestId } from '@nextera/domain';
import type { OperationalDatabase } from '../operations/curriculum';
import type { DraftScope } from './checkpoint-drafts';
import {
  CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL,
  checkpointAnswerContractDigest,
  encodeCheckpointAnswerDraft,
  type AnswerDraftContext,
  type AnswerKind,
} from './checkpoint-answer-drafts';

export type AnswerSubmissionActor = Readonly<{ id: string; authUserId: string }>;
export type StructuredAnswerEvaluator = Readonly<{
  family: 'checkpoint_structured_answer';
  version: 1;
  kind: AnswerKind;
  definitionDigest: string;
  taskKey: string;
  evaluatorKey: string;
  evaluatorDigest: string;
}>;
export type StructuredAnswerSubmissionContext = AnswerDraftContext &
  Readonly<{ submitAllowed: boolean }>;
export type StructuredAnswerSubmissionWrite = Readonly<{
  schema: 1;
  actor: AnswerSubmissionActor;
  scope: DraftScope;
  requestId: string;
  answerContractDigest: string;
  answer: Readonly<{ version: 1; kind: AnswerKind }>;
  payload: string;
  sha256: string;
  byteLength: number;
  evaluator: StructuredAnswerEvaluator;
  allowNew: boolean;
}>;
export type StructuredAnswerReceipt = Readonly<{
  id: string;
  actor: AnswerSubmissionActor;
  scope: DraftScope;
  requestId: string;
  answerContractDigest: string;
  answerVersion: 1;
  answerKind: AnswerKind;
  sha256: string;
  byteLength: number;
  evaluator: StructuredAnswerEvaluator;
  evaluation: 'pending';
}>;
export type StructuredAnswerSubmissionRejection =
  | 'invalid_input'
  | 'forbidden'
  | 'closed'
  | 'definition_mismatch'
  | 'contract_mismatch'
  | 'conflict'
  | 'rate_limited'
  | 'budget_exhausted'
  | 'unavailable';
export type StructuredAnswerSubmissionCommit =
  | Readonly<{ kind: 'accepted'; receipt: StructuredAnswerReceipt; replayed: boolean }>
  | Readonly<{ kind: StructuredAnswerSubmissionRejection }>;
export class CheckpointAnswerSubmissionStorageError extends Error {
  constructor(readonly code: StructuredAnswerSubmissionRejection = 'unavailable') {
    super('CHECKPOINT_ANSWER_SUBMISSION_' + code.toUpperCase());
  }
}
const hash = /^[0-9a-f]{64}$/,
  key = /^[a-z0-9-]{1,100}$/;
const scopeKeys = ['learnerId', 'cohortId', 'attemptId', 'taskKey', 'definitionDigest'] as const;
const routeKeys = [
  'family',
  'version',
  'kind',
  'definitionDigest',
  'taskKey',
  'evaluatorKey',
  'evaluatorDigest',
] as const;
const denials = new Set<StructuredAnswerSubmissionRejection>([
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
function fail(code: StructuredAnswerSubmissionRejection = 'unavailable'): never {
  throw new CheckpointAnswerSubmissionStorageError(code);
}
function data(value: unknown, names?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value),
    actual = Reflect.ownKeys(descriptors);
  if (
    (names &&
      (actual.length !== names.length ||
        !names.every((name) => Object.hasOwn(descriptors, name)))) ||
    actual.some((name) => typeof name !== 'string' || !Object.hasOwn(descriptors[name]!, 'value'))
  )
    return fail();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const name of actual as string[]) result[name] = descriptors[name]!.value;
  return result;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !isRequestId(value)) return fail();
  return value.toLowerCase();
}
function actor(value: unknown): AnswerSubmissionActor {
  const a = data(value, ['id', 'authUserId']);
  return Object.freeze({ id: uuid(a.id), authUserId: uuid(a.authUserId) });
}
function scope(value: unknown): DraftScope {
  const s = data(value, scopeKeys);
  if (
    typeof s.taskKey !== 'string' ||
    !key.test(s.taskKey) ||
    typeof s.definitionDigest !== 'string' ||
    !hash.test(s.definitionDigest)
  )
    return fail();
  return Object.freeze({
    learnerId: uuid(s.learnerId),
    cohortId: uuid(s.cohortId),
    attemptId: uuid(s.attemptId),
    taskKey: s.taskKey,
    definitionDigest: s.definitionDigest,
  });
}
function evaluator(value: unknown): StructuredAnswerEvaluator {
  const r = data(value, routeKeys);
  if (
    r.family !== 'checkpoint_structured_answer' ||
    r.version !== 1 ||
    !['trace_with_reason', 'debug_with_reason'].includes(r.kind as string) ||
    typeof r.kind !== 'string' ||
    typeof r.definitionDigest !== 'string' ||
    !hash.test(r.definitionDigest) ||
    typeof r.taskKey !== 'string' ||
    !key.test(r.taskKey) ||
    typeof r.evaluatorKey !== 'string' ||
    !key.test(r.evaluatorKey) ||
    typeof r.evaluatorDigest !== 'string' ||
    !hash.test(r.evaluatorDigest)
  )
    return fail();
  return Object.freeze({
    family: 'checkpoint_structured_answer',
    version: 1,
    kind: r.kind as AnswerKind,
    definitionDigest: r.definitionDigest,
    taskKey: r.taskKey,
    evaluatorKey: r.evaluatorKey,
    evaluatorDigest: r.evaluatorDigest,
  });
}
const same = (a: object, b: object, names: readonly string[]) =>
  names.every((name) => a[name as keyof typeof a] === b[name as keyof typeof b]);
function capture(input: StructuredAnswerSubmissionWrite) {
  const raw = data(input),
    who = actor(raw.actor),
    binding = scope(raw.scope),
    route = evaluator(raw.evaluator);
  const encoded = encodeCheckpointAnswerDraft(raw.payload as string),
    answer = data(raw.answer);
  const parsed = JSON.parse(encoded.payload) as Record<string, unknown>;
  const required =
    encoded.kind === 'trace_with_reason' ? ['reason'] : ['source', 'explanation', 'counterexample'];
  if (
    raw.schema !== 1 ||
    typeof raw.allowNew !== 'boolean' ||
    typeof raw.answerContractDigest !== 'string' ||
    !hash.test(raw.answerContractDigest) ||
    binding.learnerId !== who.id ||
    route.kind !== encoded.kind ||
    route.definitionDigest !== binding.definitionDigest ||
    route.taskKey !== binding.taskKey ||
    raw.sha256 !== encoded.sha256 ||
    raw.byteLength !== encoded.byteLength ||
    Reflect.ownKeys(answer).length !== Reflect.ownKeys(parsed).length ||
    !Reflect.ownKeys(parsed).every(
      (name) => Object.hasOwn(answer, name) && answer[name as string] === parsed[name as string],
    ) ||
    required.some((name) => typeof parsed[name] !== 'string' || !(parsed[name] as string).trim())
  )
    return fail('invalid_input');
  return Object.freeze({
    actor: who,
    scope: binding,
    requestId: uuid(raw.requestId),
    answerContractDigest: raw.answerContractDigest,
    evaluator: route,
    allowNew: raw.allowNew,
    ...encoded,
  });
}

/** Read-only catalog attestation, never native/parity/evaluator/result proof. No connection at import. */
export const CHECKPOINT_ANSWER_SUBMISSION_READINESS_SQL = `SELECT
 pg_catalog.current_setting('server_encoding')='UTF8' AND NOT EXISTS(SELECT FROM (VALUES
 ('checkpoint_answer_submission_context','uuid,uuid,uuid,text'),
 ('accept_checkpoint_answer','uuid,uuid,uuid,uuid,text,text,text,uuid,bytea,text,text,text,boolean'))
 req(name,args) WHERE NOT EXISTS(SELECT FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
 WHERE n.nspname='app' AND p.proname=req.name
 AND replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')=req.args
 AND p.prorettype='pg_catalog.jsonb'::regtype AND p.prosecdef
 AND p.proconfig @> ARRAY['search_path=pg_catalog'] AND o.rolname='nextera_checkpoint_owner'
 AND NOT o.rolcanlogin AND NOT o.rolsuper AND NOT o.rolbypassrls AND NOT o.rolcreatedb
 AND NOT o.rolcreaterole AND NOT o.rolreplication
 AND pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE')
 AND NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 WHERE a.grantee<>p.proowner AND a.privilege_type='EXECUTE' AND
 (a.grantee=0 OR a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='nextera_web') OR a.is_grantable)))) AS contract,
 (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_roles o ON o.oid=c.relowner WHERE n.nspname='app' AND c.relname IN
 ('checkpoint_answer_submit_policies','checkpoint_answer_receipts','checkpoint_answer_outbox','checkpoint_answer_allowance_debits')
 AND c.relkind='r' AND c.relrowsecurity AND o.rolname='nextera_checkpoint_owner'
 AND NOT pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE'))=4 AS isolated_tables,
 EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname=current_user AND NOT r.rolsuper
 AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
 AND pg_catalog.pg_has_role(current_user,'nextera_web','USAGE')
 AND NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','USAGE')
 AND NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','SET')) AS web_caller,
 (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND NOT t.tgisinternal
 AND t.tgenabled='O' AND (c.relname,t.tgname) IN
 (('checkpoint_answer_submit_policies','checkpoint_answer_submit_policy_immutable'),
 ('checkpoint_answer_receipts','checkpoint_answer_receipt_immutable'),
 ('checkpoint_answer_outbox','checkpoint_answer_outbox_immutable'),
 ('checkpoint_answer_allowance_debits','checkpoint_answer_debit_immutable')))=4 AS guards,
 ${CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL} AS canonical_validator`;
export async function readCheckpointAnswerSubmissionReadiness(db: OperationalDatabase) {
  try {
    const [row] = await db.execute(sql.raw(CHECKPOINT_ANSWER_SUBMISSION_READINESS_SQL));
    return {
      ready:
        !!row &&
        ['contract', 'isolated_tables', 'web_caller', 'guards', 'canonical_validator'].every(
          (name) => row[name] === true,
        ),
      livePersistenceVerified: false as const,
      resultReconciliationVerified: false as const,
    };
  } catch {
    return {
      ready: false,
      livePersistenceVerified: false as const,
      resultReconciliationVerified: false as const,
    };
  }
}
function contextError(error: unknown): never {
  if (error instanceof CheckpointAnswerSubmissionStorageError) throw error;
  let current = error;
  for (let n = 0; n < 5 && current && typeof current === 'object'; n++) {
    if ('code' in current && current.code === '42501') return fail('forbidden');
    current = 'cause' in current ? current.cause : null;
  }
  return fail();
}
export async function readCheckpointAnswerSubmissionContext(
  db: OperationalDatabase,
  who: AnswerSubmissionActor,
  task: Readonly<{ attemptId: string; taskKey: string }>,
): Promise<StructuredAnswerSubmissionContext> {
  const a = actor(who),
    attempt = uuid(task.attemptId),
    taskKey = task.taskKey;
  if (typeof taskKey !== 'string' || !key.test(taskKey)) return fail('forbidden');
  if (!(await readCheckpointAnswerSubmissionReadiness(db)).ready) return fail();
  let r: Record<string, unknown>;
  try {
    const [row] = await db.execute(
      sql`SELECT app.checkpoint_answer_submission_context(${a.authUserId}::uuid,${a.id}::uuid,${attempt}::uuid,${taskKey}) AS data`,
    );
    r = data(row?.data, [
      'actor',
      'scope',
      'readAllowed',
      'status',
      'serverNow',
      'deadline',
      'answerContract',
      'submitAllowed',
    ]);
  } catch (error) {
    return contextError(error);
  }
  const provider = actor(r.actor),
    s = scope(r.scope),
    c = data(r.answerContract, ['version', 'kind', 'maxBytes', 'digest']);
  if (
    provider.id !== a.id ||
    provider.authUserId !== a.authUserId ||
    s.learnerId !== a.id ||
    s.attemptId !== attempt ||
    s.taskKey !== taskKey ||
    r.readAllowed !== true ||
    typeof r.submitAllowed !== 'boolean' ||
    !['active', 'closed'].includes(r.status as string) ||
    typeof r.status !== 'string' ||
    typeof r.serverNow !== 'string' ||
    !Number.isFinite(Date.parse(r.serverNow)) ||
    typeof r.deadline !== 'string' ||
    !Number.isFinite(Date.parse(r.deadline)) ||
    c.version !== 1 ||
    typeof c.kind !== 'string' ||
    !['trace_with_reason', 'debug_with_reason'].includes(c.kind) ||
    !Number.isSafeInteger(c.maxBytes) ||
    Number(c.maxBytes) < 1 ||
    Number(c.maxBytes) > 262144 ||
    typeof c.digest !== 'string' ||
    !hash.test(c.digest) ||
    c.digest !==
      checkpointAnswerContractDigest(s, {
        version: 1,
        kind: c.kind as AnswerKind,
        maxBytes: Number(c.maxBytes),
      })
  )
    return fail();
  return Object.freeze({
    scope: s,
    readAllowed: true,
    status: r.status as 'active' | 'closed',
    serverNow: r.serverNow,
    deadline: r.deadline,
    submitAllowed: r.submitAllowed,
    answerContract: Object.freeze({
      version: 1,
      kind: c.kind as AnswerKind,
      maxBytes: Number(c.maxBytes),
      digest: c.digest,
    }),
  });
}
/** One mutating RPC. Transport errors or malformed acknowledgements throw: commit may have
 * succeeded. Never retry automatically. A returned denial proves no new intake committed.
 */
export async function acceptCheckpointAnswer(
  db: OperationalDatabase,
  input: StructuredAnswerSubmissionWrite,
): Promise<StructuredAnswerSubmissionCommit> {
  let write: ReturnType<typeof capture>;
  try {
    write = capture(input);
  } catch {
    return { kind: 'invalid_input' };
  }
  if (!(await readCheckpointAnswerSubmissionReadiness(db)).ready) return { kind: 'unavailable' };
  const { actor: who, scope: s, evaluator: route } = write;
  const [row] = await db.execute(
    sql`SELECT app.accept_checkpoint_answer(${who.authUserId}::uuid,${who.id}::uuid,${s.cohortId}::uuid,${s.attemptId}::uuid,${s.taskKey},${s.definitionDigest},${write.answerContractDigest},${write.requestId}::uuid,decode(${write.base64},'base64'),${write.sha256},${route.evaluatorKey},${route.evaluatorDigest},${write.allowNew}) AS data`,
  );
  const result = data(row?.data);
  if (
    typeof result.kind === 'string' &&
    denials.has(result.kind as StructuredAnswerSubmissionRejection)
  ) {
    data(result, ['kind']);
    return { kind: result.kind as StructuredAnswerSubmissionRejection };
  }
  data(result, ['kind', 'receipt', 'replayed']);
  if (
    result.kind !== 'accepted' ||
    typeof result.replayed !== 'boolean' ||
    (!write.allowNew && !result.replayed)
  )
    return fail();
  const r = data(result.receipt, [
    'id',
    'actor',
    'scope',
    'requestId',
    'answerContractDigest',
    'answerVersion',
    'answerKind',
    'sha256',
    'byteLength',
    'evaluator',
    'evaluation',
    'payloadBase64',
  ]);
  const acceptedActor = actor(r.actor),
    acceptedScope = scope(r.scope),
    acceptedRoute = evaluator(r.evaluator),
    receiptId = uuid(r.id);
  if (
    r.id !== receiptId ||
    !same(acceptedActor, who, ['id', 'authUserId']) ||
    !same(acceptedScope, s, scopeKeys) ||
    !same(acceptedRoute, route, routeKeys) ||
    r.requestId !== write.requestId ||
    r.answerContractDigest !== write.answerContractDigest ||
    r.answerVersion !== 1 ||
    r.answerKind !== write.kind ||
    r.sha256 !== write.sha256 ||
    r.byteLength !== write.byteLength ||
    r.evaluation !== 'pending' ||
    r.payloadBase64 !== write.base64
  )
    return fail();
  return Object.freeze({
    kind: 'accepted',
    replayed: result.replayed,
    receipt: Object.freeze({
      id: receiptId,
      actor: acceptedActor,
      scope: acceptedScope,
      requestId: write.requestId,
      answerContractDigest: write.answerContractDigest,
      answerVersion: 1,
      answerKind: write.kind,
      sha256: write.sha256,
      byteLength: write.byteLength,
      evaluator: acceptedRoute,
      evaluation: 'pending',
    }),
  });
}
