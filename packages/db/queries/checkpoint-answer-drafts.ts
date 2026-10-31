import { CHECKPOINT_TYPED_DRAFT_WRITE_WINDOW_SQL } from './checkpoint-write-window';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { isRequestId } from '@nextera/domain';
import type { OperationalDatabase } from '../operations/curriculum';
import { sameDraftScope, type DraftScope, type DraftStorageCode } from './checkpoint-drafts';

export type AnswerKind = 'trace_with_reason' | 'debug_with_reason';
export type AnswerDraftContract = Readonly<{
  version: 1;
  kind: AnswerKind;
  maxBytes: number;
  digest: string;
}>;
export type AnswerDraftContext = Readonly<{
  scope: DraftScope;
  readAllowed: boolean;
  status: 'active' | 'closed';
  serverNow: string;
  deadline: string;
  answerContract: AnswerDraftContract;
}>;
export type StructuredDraftRecord = Readonly<{
  scope: DraftScope;
  answerContractDigest: string;
  payload: string;
  sha256: string;
  byteLength: number;
  version: number;
  requestId: string;
}>;
export class CheckpointAnswerDraftStorageError extends Error {
  constructor(readonly code: DraftStorageCode = 'unavailable') {
    super('CHECKPOINT_ANSWER_DRAFT_' + code.toUpperCase());
  }
}
const ceiling = 262144,
  digest = /^[0-9a-f]{64}$/,
  task = /^[a-z0-9-]{1,100}$/;
const scopeKeys = ['learnerId', 'cohortId', 'attemptId', 'taskKey', 'definitionDigest'] as const;
function fail(code: DraftStorageCode = 'unavailable'): never {
  throw new CheckpointAnswerDraftStorageError(code);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function scope(value: unknown): DraftScope {
  const s = object(value);
  if (
    !exact(s, scopeKeys) ||
    !scopeKeys.every((key) => typeof s[key] === 'string') ||
    !isRequestId(s.learnerId as string) ||
    !isRequestId(s.cohortId as string) ||
    !isRequestId(s.attemptId as string) ||
    !task.test(s.taskKey as string) ||
    !digest.test(s.definitionDigest as string)
  )
    return fail();
  return Object.freeze({
    learnerId: (s.learnerId as string).toLowerCase(),
    cohortId: (s.cohortId as string).toLowerCase(),
    attemptId: (s.attemptId as string).toLowerCase(),
    taskKey: s.taskKey as string,
    definitionDigest: s.definitionDigest as string,
  });
}
function identity(authId: string, attemptId: string, taskKey: string) {
  if (
    !isRequestId(authId) ||
    !isRequestId(attemptId) ||
    typeof taskKey !== 'string' ||
    !task.test(taskKey)
  )
    fail('forbidden');
}
export function checkpointAnswerContractDigest(
  binding: DraftScope,
  contract: Readonly<{ version: 1; kind: AnswerKind; maxBytes: number }>,
) {
  const s = scope(binding);
  if (
    contract.version !== 1 ||
    typeof contract.kind !== 'string' ||
    !['trace_with_reason', 'debug_with_reason'].includes(contract.kind) ||
    !Number.isSafeInteger(contract.maxBytes) ||
    contract.maxBytes < 1 ||
    contract.maxBytes > ceiling
  )
    return fail();
  return createHash('sha256')
    .update(
      [
        '01coding-checkpoint-answer-contract-v1',
        s.learnerId,
        s.cohortId,
        s.attemptId,
        s.taskKey,
        s.definitionDigest,
        '1',
        contract.kind,
        String(contract.maxBytes),
      ].join('\n'),
      'utf8',
    )
    .digest('hex');
}
/** Strict fixed-order JSON, including escaped NUL; no field trim, Unicode or newline rewrite.
 * DRAFT0021's matching text grammar still requires separately authorized native PostgreSQL proof.
 * It accepts incomplete drafts, not grading answers or completion claims. */
export function encodeCheckpointAnswerDraft(payload: string) {
  if (typeof payload !== 'string') return fail();
  const bytes = Buffer.from(payload, 'utf8');
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > ceiling ||
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== payload
  )
    return fail();
  let raw: Record<string, unknown>;
  try {
    raw = object(JSON.parse(payload));
  } catch {
    return fail();
  }
  const names =
    raw.kind === 'trace_with_reason'
      ? ['version', 'kind', 'output', 'reason']
      : raw.kind === 'debug_with_reason'
        ? ['version', 'kind', 'source', 'explanation', 'counterexample']
        : null;
  if (
    !names ||
    !exact(raw, names) ||
    raw.version !== 1 ||
    !names
      .slice(2)
      .every(
        (key) =>
          typeof raw[key] === 'string' &&
          new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
            Buffer.from(raw[key] as string, 'utf8'),
          ) === raw[key],
      )
  )
    return fail();
  const canonical =
    raw.kind === 'trace_with_reason'
      ? JSON.stringify({ version: 1, kind: raw.kind, output: raw.output, reason: raw.reason })
      : JSON.stringify({
          version: 1,
          kind: raw.kind,
          source: raw.source,
          explanation: raw.explanation,
          counterexample: raw.counterexample,
        });
  if (canonical !== payload) return fail();
  return Object.freeze({
    payload,
    kind: raw.kind as AnswerKind,
    base64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  });
}
/** Exact source/catalog pin only. It is not native parity or persistence evidence. */
export const CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_SHA256 =
  'dfaeffc7bdcee0bee7d28a0182ba5184ee72bcb9d5763db7b9a15e88f9b20816';
/** Boolean catalog predicate shared by the draft and proposed official adapters. */
export const CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL = `EXISTS(
 SELECT FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
 JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE n.nspname='app' AND p.proname='checkpoint_answer_payload_valid'
 AND pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')='bytea,text'
 AND p.prorettype='pg_catalog.bool'::pg_catalog.regtype AND p.prokind='f'
 AND l.lanname='plpgsql' AND p.provolatile='i' AND p.proisstrict AND NOT p.prosecdef
 AND p.proconfig=ARRAY['search_path=pg_catalog']
 AND o.rolname='nextera_checkpoint_owner' AND NOT o.rolcanlogin AND NOT o.rolsuper
 AND NOT o.rolbypassrls AND NOT o.rolcreatedb AND NOT o.rolcreaterole AND NOT o.rolreplication
 AND pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8'))=pg_catalog.decode('${CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_SHA256}','hex')
 AND NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 WHERE a.grantee<>p.proowner AND a.privilege_type='EXECUTE'))`;

/** Catalog attestation only; no connection is opened or schema inferred at module import. */
export const CHECKPOINT_ANSWER_DRAFT_RETAINED_READINESS_SQL = `SELECT
 pg_catalog.current_setting('server_encoding')='UTF8' AND NOT EXISTS(SELECT FROM (VALUES
 ('checkpoint_answer_draft_context','uuid,uuid,text'),
 ('read_checkpoint_answer_draft','uuid,uuid,text,text,text,uuid'),
 ('save_checkpoint_answer_draft','uuid,uuid,text,text,text,uuid,bigint,bytea,text')) req(name,args)
 WHERE NOT EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
 WHERE n.nspname='app' AND p.proname=req.name AND replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')=req.args
 AND p.prorettype='pg_catalog.jsonb'::regtype AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']
 AND o.rolname='nextera_checkpoint_owner' AND NOT o.rolcanlogin AND NOT o.rolsuper AND NOT o.rolbypassrls AND NOT o.rolcreatedb AND NOT o.rolcreaterole AND NOT o.rolreplication
 AND pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE')
 AND NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner AND a.privilege_type='EXECUTE'
 AND (a.grantee=0 OR a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='nextera_web') OR a.is_grantable)))) AS contract,
 (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles o ON o.oid=c.relowner
 WHERE n.nspname='app' AND c.relname IN ('checkpoint_answer_draft_policies','checkpoint_answer_draft_revisions') AND c.relkind='r' AND c.relrowsecurity AND o.rolname='nextera_checkpoint_owner'
 AND NOT pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE'))=2 AS isolated_tables,
 EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname=current_user AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
 AND pg_catalog.pg_has_role(current_user,'nextera_web','USAGE') AND NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','USAGE') AND NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','SET')) AS web_caller,
 (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='app' AND NOT t.tgisinternal AND t.tgenabled='O' AND ((c.relname='checkpoint_answer_draft_revisions' AND t.tgname='checkpoint_answer_draft_revision_immutable')
 OR (c.relname='checkpoint_answer_draft_policies' AND t.tgname='checkpoint_answer_draft_policy_immutable')))=2 AS guards,
 ${CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL} AS canonical_validator`;

/** NEW writes/capability checks require the repaired POST window. Retained reads
 * preserve the original catalog, ownership, ACL and payload-validator checks. */
export const CHECKPOINT_ANSWER_DRAFT_READINESS_SQL =
  CHECKPOINT_ANSWER_DRAFT_RETAINED_READINESS_SQL.replace(
    'SELECT\n',
    `SELECT\n ${CHECKPOINT_TYPED_DRAFT_WRITE_WINDOW_SQL} AND\n`,
  );

export async function readCheckpointAnswerDraftReadiness(
  db: OperationalDatabase,
  access: 'read' | 'write' = 'write',
) {
  try {
    const [row] = await db.execute(
      sql.raw(
        access === 'read'
          ? CHECKPOINT_ANSWER_DRAFT_RETAINED_READINESS_SQL
          : CHECKPOINT_ANSWER_DRAFT_READINESS_SQL,
      ),
    );
    return {
      ready:
        !!row &&
        ['contract', 'isolated_tables', 'web_caller', 'guards', 'canonical_validator'].every(
          (key) => row[key] === true,
        ),
      livePersistenceVerified: false as const,
    };
  } catch {
    return { ready: false, livePersistenceVerified: false as const };
  }
}
function mapError(error: unknown): never {
  if (error instanceof CheckpointAnswerDraftStorageError) throw error;
  let current = error;
  for (let n = 0; n < 5 && current && typeof current === 'object'; n++) {
    const code = 'code' in current ? current.code : null;
    if (code === '42501') fail('forbidden');
    if (code === 'PA001') fail('closed');
    if (code === 'PA002') fail('definition_mismatch');
    if (code === 'PA003' || code === '23505') fail('idempotency_conflict');
    if (code === 'PA004') fail('storage_limit');
    current = 'cause' in current ? current.cause : null;
  }
  return fail();
}
async function rpc(
  db: OperationalDatabase,
  statement: ReturnType<typeof sql>,
  access: 'read' | 'write' = 'write',
) {
  if (!(await readCheckpointAnswerDraftReadiness(db, access)).ready) return fail();
  try {
    const [row] = await db.execute(statement);
    if (!row || !Object.hasOwn(row, 'data')) return fail();
    return row.data as unknown;
  } catch (error) {
    return mapError(error);
  }
}
export async function readCheckpointAnswerDraftContext(
  db: OperationalDatabase,
  authId: string,
  attemptId: string,
  taskKey: string,
): Promise<AnswerDraftContext> {
  identity(authId, attemptId, taskKey);
  const r = object(
    await rpc(
      db,
      sql`SELECT app.checkpoint_answer_draft_context(${authId}::uuid,${attemptId}::uuid,${taskKey}) AS data`,
      'read',
    ),
  );
  const s = scope(r.scope),
    c = object(r.answerContract);
  if (
    s.attemptId !== attemptId.toLowerCase() ||
    s.taskKey !== taskKey ||
    typeof r.readAllowed !== 'boolean' ||
    typeof r.status !== 'string' ||
    !['active', 'closed'].includes(r.status) ||
    typeof r.serverNow !== 'string' ||
    !Number.isFinite(Date.parse(r.serverNow)) ||
    typeof r.deadline !== 'string' ||
    !Number.isFinite(Date.parse(r.deadline)) ||
    !exact(c, ['version', 'kind', 'maxBytes', 'digest']) ||
    c.version !== 1 ||
    typeof c.kind !== 'string' ||
    !['trace_with_reason', 'debug_with_reason'].includes(c.kind) ||
    !Number.isSafeInteger(c.maxBytes) ||
    Number(c.maxBytes) < 1 ||
    Number(c.maxBytes) > ceiling ||
    typeof c.digest !== 'string' ||
    !digest.test(c.digest)
  )
    return fail();
  const contract = Object.freeze({
    version: 1 as const,
    kind: c.kind as AnswerKind,
    maxBytes: Number(c.maxBytes),
    digest: c.digest,
  });
  if (contract.digest !== checkpointAnswerContractDigest(s, contract)) return fail();
  return Object.freeze({
    scope: s,
    readAllowed: r.readAllowed,
    status: r.status as 'active' | 'closed',
    serverNow: r.serverNow,
    deadline: r.deadline,
    answerContract: contract,
  });
}
async function boundContext(
  db: OperationalDatabase,
  authId: string,
  expected: DraftScope,
  answerContractDigest: string,
) {
  const wanted = scope(expected);
  if (typeof answerContractDigest !== 'string' || !digest.test(answerContractDigest)) return fail();
  const context = await readCheckpointAnswerDraftContext(
    db,
    authId,
    wanted.attemptId,
    wanted.taskKey,
  );
  if (
    !sameDraftScope(wanted, context.scope) ||
    context.answerContract.digest !== answerContractDigest
  )
    return fail('definition_mismatch');
  if (!context.readAllowed) return fail('forbidden');
  return context;
}
function record(raw: unknown, context: AnswerDraftContext): StructuredDraftRecord {
  const r = object(raw),
    s = scope(r.scope);
  if (
    !sameDraftScope(s, context.scope) ||
    r.answerContractDigest !== context.answerContract.digest ||
    typeof r.payloadBase64 !== 'string' ||
    r.payloadBase64.length >
      Math.ceil(ceiling / 3) * 4 + Math.ceil((Math.ceil(ceiling / 3) * 4) / 76) ||
    typeof r.sha256 !== 'string' ||
    !digest.test(r.sha256) ||
    !Number.isSafeInteger(r.version) ||
    Number(r.version) < 1 ||
    typeof r.requestId !== 'string' ||
    !isRequestId(r.requestId) ||
    typeof r.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(r.expiresAt)) ||
    Date.parse(r.expiresAt) <= Date.parse(context.serverNow)
  )
    return fail();
  const base64 = r.payloadBase64.replace(/\n/g, '');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64 || bytes.byteLength > context.answerContract.maxBytes)
    return fail();
  let payload: string;
  try {
    payload = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail();
  }
  const encoded = encodeCheckpointAnswerDraft(payload);
  if (
    encoded.kind !== context.answerContract.kind ||
    encoded.sha256 !== r.sha256 ||
    encoded.byteLength !== r.byteLength ||
    !Buffer.from(encoded.payload, 'utf8').equals(bytes)
  )
    return fail();
  return Object.freeze({
    scope: s,
    answerContractDigest: context.answerContract.digest,
    payload,
    sha256: encoded.sha256,
    byteLength: encoded.byteLength,
    version: Number(r.version),
    requestId: r.requestId.toLowerCase(),
  });
}
export async function readCheckpointAnswerDraft(
  db: OperationalDatabase,
  authId: string,
  expected: DraftScope,
  answerContractDigest: string,
  requestId?: string,
): Promise<StructuredDraftRecord | null> {
  identity(authId, expected.attemptId, expected.taskKey);
  if (requestId !== undefined && !isRequestId(requestId)) return fail();
  const context = await boundContext(db, authId, expected, answerContractDigest);
  const raw = await rpc(
    db,
    sql`SELECT app.read_checkpoint_answer_draft(${authId}::uuid,${context.scope.attemptId}::uuid,${context.scope.taskKey},${context.scope.definitionDigest},${answerContractDigest},${requestId ?? null}::uuid) AS data`,
    'read',
  );
  if (raw === null) return null;
  const result = record(raw, context);
  if (requestId && result.requestId !== requestId.toLowerCase()) return fail();
  return result;
}
export async function saveCheckpointAnswerDraft(
  db: OperationalDatabase,
  input: Readonly<{
    authId: string;
    scope: DraftScope;
    answerContractDigest: string;
    requestId: string;
    baseVersion: number;
    payload: string;
    sha256: string;
    byteLength: number;
  }>,
) {
  identity(input.authId, input.scope.attemptId, input.scope.taskKey);
  if (
    !isRequestId(input.requestId) ||
    !Number.isSafeInteger(input.baseVersion) ||
    input.baseVersion < 0 ||
    input.baseVersion >= Number.MAX_SAFE_INTEGER
  )
    return fail();
  const encoded = encodeCheckpointAnswerDraft(input.payload);
  if (encoded.sha256 !== input.sha256 || encoded.byteLength !== input.byteLength) return fail();
  const context = await boundContext(db, input.authId, input.scope, input.answerContractDigest);
  if (
    encoded.kind !== context.answerContract.kind ||
    encoded.byteLength > context.answerContract.maxBytes
  )
    return fail('definition_mismatch');
  // DRAFT0030 checks the live write window before returning even an exact POST receipt replay.
  // It alone performs CAS/storage accounting; this call never creates an official submission or Run.
  const raw = object(
    await rpc(
      db,
      sql`SELECT app.save_checkpoint_answer_draft(${input.authId}::uuid,${context.scope.attemptId}::uuid,${context.scope.taskKey},${context.scope.definitionDigest},${input.answerContractDigest},${input.requestId}::uuid,${input.baseVersion}::bigint,decode(${encoded.base64},'base64'),${encoded.sha256}) AS data`,
    ),
  );
  if (raw.kind === 'conflict')
    return { kind: 'conflict', current: record(raw.current, context) } as const;
  if (raw.kind !== 'saved') return fail();
  const saved = record(raw.record, context);
  if (
    saved.requestId !== input.requestId.toLowerCase() ||
    saved.payload !== input.payload ||
    saved.version !== input.baseVersion + 1
  )
    return fail();
  return { kind: 'saved', record: saved } as const;
}
