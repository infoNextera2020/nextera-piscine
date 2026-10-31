import { CHECKPOINT_CODE_DRAFT_WRITE_WINDOW_SQL } from './checkpoint-write-window';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { isRequestId } from '@nextera/domain';
import type { OperationalDatabase } from '../operations/curriculum';

export type DraftScope = Readonly<{
  learnerId: string;
  cohortId: string;
  attemptId: string;
  taskKey: string;
  definitionDigest: string;
}>;
export type DraftContext = Readonly<{
  scope: DraftScope;
  readAllowed: boolean;
  status: 'active' | 'closed';
  serverNow: string;
  deadline: string;
  sourceBytes: number;
  filename: string;
}>;
export type StoredQuestionDraft = Readonly<{ source: string; version: number; requestId: string }>;
export type DraftStorageCode =
  | 'unavailable'
  | 'forbidden'
  | 'closed'
  | 'definition_mismatch'
  | 'idempotency_conflict'
  | 'storage_limit';
export class CheckpointDraftStorageError extends Error {
  constructor(readonly code: DraftStorageCode) {
    super('CHECKPOINT_DRAFT_' + code.toUpperCase());
  }
}
const ceiling = 262144,
  digest = /^[0-9a-f]{64}$/,
  task = /^[a-z0-9-]{1,100}$/;

/** Read-only catalogs; readiness is not a successful live persistence test. */
export const CHECKPOINT_DRAFT_RETAINED_READINESS_SQL = `SELECT
 NOT EXISTS(SELECT FROM (VALUES ('checkpoint_draft_context','uuid,uuid,text'),('read_checkpoint_draft','uuid,uuid,text,text,uuid'),('save_checkpoint_draft','uuid,uuid,text,text,uuid,bigint,bytea,text')) req(name,args)
 WHERE NOT EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
 WHERE n.nspname='app' AND p.proname=req.name AND replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')=req.args AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']
 AND o.rolname='nextera_checkpoint_owner' AND NOT o.rolcanlogin AND NOT o.rolsuper AND NOT o.rolbypassrls AND NOT o.rolcreatedb AND NOT o.rolcreaterole AND NOT o.rolreplication
 AND pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE')
 AND NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner AND a.privilege_type='EXECUTE' AND (a.grantee=0 OR a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='nextera_web') OR a.is_grantable)))) AS contract,
 (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles o ON o.oid=c.relowner
 WHERE n.nspname='app' AND c.relname IN ('checkpoint_draft_policies','checkpoint_draft_revisions') AND c.relkind='r' AND c.relrowsecurity AND o.rolname='nextera_checkpoint_owner'
 AND NOT pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE'))=2 AS isolated_tables,
 EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname=current_user AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
 AND pg_catalog.pg_has_role(current_user,'nextera_web','USAGE') AND NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','USAGE') AND NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','SET')) AS web_caller,
 (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='app' AND NOT t.tgisinternal AND t.tgenabled='O' AND ((c.relname='checkpoint_draft_revisions' AND t.tgname='checkpoint_draft_revision_immutable') OR(c.relname='checkpoint_draft_policies' AND t.tgname='checkpoint_draft_policy_immutable')))=2 AS guards`;

/** NEW writes/capability checks require the repaired POST window. Retained reads
 * preserve the original catalog, ownership, ACL and payload-validator checks. */
export const CHECKPOINT_DRAFT_READINESS_SQL = CHECKPOINT_DRAFT_RETAINED_READINESS_SQL.replace(
  'SELECT\n',
  `SELECT\n ${CHECKPOINT_CODE_DRAFT_WRITE_WINDOW_SQL} AND\n`,
);

function fail(code: DraftStorageCode = 'unavailable'): never {
  throw new CheckpointDraftStorageError(code);
}
function mapError(error: unknown): never {
  if (error instanceof CheckpointDraftStorageError) throw error;
  let current = error;
  for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
    const code = 'code' in current ? current.code : null;
    if (code === '42501') fail('forbidden');
    if (code === 'PD001') fail('closed');
    if (code === 'PD002') fail('definition_mismatch');
    if (code === 'PD003' || code === '23505') fail('idempotency_conflict');
    if (code === 'PD004') fail('storage_limit');
    current = 'cause' in current ? current.cause : null;
  }
  fail();
}
export async function readCheckpointDraftReadiness(
  db: OperationalDatabase,
  access: 'read' | 'write' = 'write',
) {
  try {
    const [row] = await db.execute(
      sql.raw(
        access === 'read'
          ? CHECKPOINT_DRAFT_RETAINED_READINESS_SQL
          : CHECKPOINT_DRAFT_READINESS_SQL,
      ),
    );
    return {
      ready:
        !!row &&
        ['contract', 'isolated_tables', 'web_caller', 'guards'].every((key) => row[key] === true),
      livePersistenceVerified: false as const,
    };
  } catch {
    return { ready: false, livePersistenceVerified: false as const };
  }
}
async function rpc(
  db: OperationalDatabase,
  statement: ReturnType<typeof sql>,
  access: 'read' | 'write' = 'write',
) {
  if (!(await readCheckpointDraftReadiness(db, access)).ready) fail();
  try {
    const [row] = await db.execute(statement);
    if (!row || !('data' in row)) fail();
    return row.data as unknown;
  } catch (error) {
    return mapError(error);
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function validScope(scope: DraftScope) {
  return (
    isRequestId(scope.learnerId) &&
    isRequestId(scope.cohortId) &&
    isRequestId(scope.attemptId) &&
    task.test(scope.taskKey) &&
    digest.test(scope.definitionDigest)
  );
}
function parseScope(value: unknown): DraftScope {
  const s = object(value);
  if (
    !['learnerId', 'cohortId', 'attemptId', 'taskKey', 'definitionDigest'].every(
      (key) => typeof s[key] === 'string',
    )
  )
    fail();
  const result = {
    learnerId: String(s.learnerId).toLowerCase(),
    cohortId: String(s.cohortId).toLowerCase(),
    attemptId: String(s.attemptId).toLowerCase(),
    taskKey: String(s.taskKey),
    definitionDigest: String(s.definitionDigest),
  };
  if (!validScope(result)) fail();
  return Object.freeze(result);
}
export function sameDraftScope(a: DraftScope, b: DraftScope) {
  return (
    validScope(a) &&
    validScope(b) &&
    a.learnerId.toLowerCase() === b.learnerId.toLowerCase() &&
    a.cohortId.toLowerCase() === b.cohortId.toLowerCase() &&
    a.attemptId.toLowerCase() === b.attemptId.toLowerCase() &&
    a.taskKey === b.taskKey &&
    a.definitionDigest === b.definitionDigest
  );
}
function identity(authId: string, attemptId: string, taskKey: string) {
  if (!isRequestId(authId) || !isRequestId(attemptId) || !task.test(taskKey)) fail();
}
export function encodeCheckpointDraft(source: string) {
  if (typeof source !== 'string') fail();
  const bytes = Buffer.from(source, 'utf8');
  if (
    bytes.byteLength > ceiling ||
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== source
  )
    fail();
  return {
    base64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  };
}
function record(value: unknown, expected: DraftScope): StoredQuestionDraft {
  const r = object(value),
    scope = parseScope(r.scope);
  if (
    !sameDraftScope(scope, expected) ||
    typeof r.sourceBase64 !== 'string' ||
    r.sourceBase64.length >
      Math.ceil(ceiling / 3) * 4 + Math.ceil((Math.ceil(ceiling / 3) * 4) / 76) ||
    typeof r.sourceDigest !== 'string' ||
    !digest.test(r.sourceDigest) ||
    !Number.isSafeInteger(r.version) ||
    Number(r.version) < 1 ||
    typeof r.requestId !== 'string' ||
    !isRequestId(r.requestId) ||
    typeof r.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(r.expiresAt))
  )
    fail();
  const base64 = r.sourceBase64.replace(/\n/g, '');
  const bytes = Buffer.from(base64, 'base64');
  if (
    bytes.toString('base64') !== base64 ||
    bytes.byteLength > ceiling ||
    bytes.byteLength !== r.byteLength ||
    createHash('sha256').update(bytes).digest('hex') !== r.sourceDigest
  )
    fail();
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    fail();
  }
  if (!Buffer.from(source, 'utf8').equals(bytes)) fail();
  return { source, version: Number(r.version), requestId: r.requestId.toLowerCase() };
}
export async function readCheckpointDraftContext(
  db: OperationalDatabase,
  authId: string,
  attemptId: string,
  taskKey: string,
): Promise<DraftContext> {
  identity(authId, attemptId, taskKey);
  const r = object(
    await rpc(
      db,
      sql`SELECT app.checkpoint_draft_context(${authId}::uuid,${attemptId}::uuid,${taskKey}) AS data`,
      'read',
    ),
  );
  const scope = parseScope(r.scope);
  if (
    scope.attemptId !== attemptId.toLowerCase() ||
    scope.taskKey !== taskKey ||
    typeof r.readAllowed !== 'boolean' ||
    !['active', 'closed'].includes(String(r.status)) ||
    typeof r.serverNow !== 'string' ||
    !Number.isFinite(Date.parse(r.serverNow)) ||
    typeof r.deadline !== 'string' ||
    !Number.isFinite(Date.parse(r.deadline)) ||
    !Number.isSafeInteger(r.sourceBytes) ||
    Number(r.sourceBytes) < 1 ||
    Number(r.sourceBytes) > ceiling ||
    typeof r.filename !== 'string' ||
    !/^[A-Za-z0-9_]+\.go$/.test(r.filename)
  )
    fail();
  return {
    scope,
    readAllowed: r.readAllowed,
    status: r.status as 'active' | 'closed',
    serverNow: r.serverNow,
    deadline: r.deadline,
    sourceBytes: Number(r.sourceBytes),
    filename: r.filename,
  };
}
export async function readCheckpointDraft(
  db: OperationalDatabase,
  authId: string,
  scope: DraftScope,
  requestId?: string,
): Promise<StoredQuestionDraft | null> {
  identity(authId, scope.attemptId, scope.taskKey);
  if (!validScope(scope) || (requestId !== undefined && !isRequestId(requestId))) fail();
  const raw = await rpc(
    db,
    sql`SELECT app.read_checkpoint_draft(${authId}::uuid,${scope.attemptId}::uuid,${scope.taskKey},${scope.definitionDigest},${requestId ?? null}::uuid) AS data`,
    'read',
  );
  if (raw === null) return null;
  const result = record(raw, scope);
  if (requestId && result.requestId !== requestId.toLowerCase()) fail();
  return result;
}
export async function saveCheckpointDraft(
  db: OperationalDatabase,
  input: {
    authId: string;
    scope: DraftScope;
    requestId: string;
    baseVersion: number;
    source: string;
  },
) {
  const { scope } = input;
  identity(input.authId, scope.attemptId, scope.taskKey);
  if (
    !validScope(scope) ||
    !isRequestId(input.requestId) ||
    !Number.isSafeInteger(input.baseVersion) ||
    input.baseVersion < 0 ||
    input.baseVersion >= Number.MAX_SAFE_INTEGER
  )
    fail();
  const encoded = encodeCheckpointDraft(input.source);
  const raw = object(
    await rpc(
      db,
      sql`SELECT app.save_checkpoint_draft(${input.authId}::uuid,${scope.attemptId}::uuid,${scope.taskKey},${scope.definitionDigest},${input.requestId}::uuid,${input.baseVersion}::bigint,decode(${encoded.base64},'base64'),${encoded.sha256}) AS data`,
    ),
  );
  if (raw.kind === 'conflict')
    return { kind: 'conflict', current: record(raw.current, scope) } as const;
  if (raw.kind !== 'saved') fail();
  const result = record(raw.record, scope);
  if (
    result.requestId !== input.requestId.toLowerCase() ||
    result.source !== input.source ||
    result.version !== input.baseVersion + 1
  )
    fail();
  return { kind: 'saved', record: result } as const;
}
