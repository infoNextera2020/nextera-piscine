import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { isRequestId } from '@nextera/domain';
import type { OperationalDatabase } from '../operations/curriculum';
import type { DraftContext, DraftScope } from './checkpoint-drafts';

export type RunStorageCode =
  | 'unavailable'
  | 'forbidden'
  | 'closed'
  | 'definition_mismatch'
  | 'idempotency_conflict'
  | 'rate_limited'
  | 'stale_lease'
  | 'storage_limit';
export class VisibleRunStorageError extends Error {
  constructor(readonly code: RunStorageCode) {
    super('VISIBLE_RUN_' + code.toUpperCase());
  }
}
function fail(code: RunStorageCode = 'unavailable'): never {
  throw new VisibleRunStorageError(code);
}
function error(value: unknown): never {
  if (value instanceof VisibleRunStorageError) throw value;
  const codes: Record<string, RunStorageCode> = {
    '42501': 'forbidden',
    RV001: 'closed',
    RV002: 'definition_mismatch',
    RV003: 'idempotency_conflict',
    RV004: 'rate_limited',
    RV005: 'unavailable',
    RV006: 'stale_lease',
    RV007: 'storage_limit',
    '23505': 'idempotency_conflict',
  };
  let current = value;
  for (let n = 0; n < 5 && current && typeof current === 'object'; n++) {
    if ('code' in current && typeof current.code === 'string' && codes[current.code])
      fail(codes[current.code]);
    current = 'cause' in current ? current.cause : null;
  }
  fail();
}
const ceiling = 262144,
  digest = /^[0-9a-f]{64}$/,
  task = /^[a-z0-9-]{1,100}$/;
const roles = {
  web: 'nextera_web',
  worker: 'nextera_visible_run_worker',
  maintenance: 'nextera_visible_run_maintenance',
} as const;
export const VISIBLE_RUN_READINESS_SQL = `SELECT
 NOT EXISTS(SELECT FROM(VALUES
 ('visible_run_context','uuid,uuid,text','nextera_web'),('reserve_visible_run','uuid,uuid,text,text,uuid,text,text,bytea,text,text','nextera_web'),('read_visible_run','uuid,uuid,text,text,uuid,uuid','nextera_web'),
 ('list_queued_visible_runs','integer','nextera_visible_run_worker'),('claim_visible_run','uuid','nextera_visible_run_worker'),('pulse_visible_run','uuid,bigint,uuid,boolean','nextera_visible_run_worker'),('complete_visible_run','uuid,bigint,uuid,text,bytea,text','nextera_visible_run_worker'),
 ('list_recoverable_visible_runs','integer','nextera_visible_run_maintenance'),('reconcile_visible_run','uuid,bigint,text','nextera_visible_run_maintenance'),('purge_visible_run_sources','timestamp with time zone,integer','nextera_visible_run_maintenance')) req(name,args,grantee)
 WHERE NOT EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
 WHERE n.nspname='app' AND p.proname=req.name AND replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')=replace(req.args,' ','') AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']
 AND o.rolname='nextera_checkpoint_owner' AND NOT o.rolcanlogin AND NOT o.rolsuper AND NOT o.rolbypassrls AND NOT o.rolcreatedb AND NOT o.rolcreaterole AND NOT o.rolreplication
 AND pg_catalog.has_function_privilege(req.grantee,p.oid,'EXECUTE')
 AND NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner AND (a.grantee=0 OR a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=req.grantee) OR a.is_grantable)))) AS contract,
 (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles o ON o.oid=c.relowner WHERE n.nspname='app' AND c.relname IN('visible_run_profiles','visible_run_receipts','visible_run_sources','visible_run_outputs','visible_run_outbox','visible_run_principals') AND c.relkind='r' AND c.relrowsecurity AND o.rolname='nextera_checkpoint_owner' AND NOT pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE'))=6 AS isolated_tables,
 (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgname IN('visible_run_profile_guard','visible_run_receipt_guard','visible_run_source_guard','visible_run_output_guard','visible_run_outbox_guard'))=5 AS guards,
 (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles o ON o.oid=p.proowner WHERE n.nspname='app' AND p.proname IN('visible_run_blob_digest','visible_run_deadline','visible_run_policy','guard_visible_run_history','visible_run_record','lock_visible_run','visible_run_principal') AND o.rolname='nextera_checkpoint_owner' AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog'] AND NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner))=7 AS private_helpers,
 (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN('nextera_checkpoint_owner','nextera_visible_run_worker','nextera_visible_run_maintenance') AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)=3 AND NOT pg_catalog.has_schema_privilege('nextera_checkpoint_owner','app','CREATE') AS permission_roles,
 NOT EXISTS(SELECT FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname IN('nextera_checkpoint_owner','nextera_visible_run_worker','nextera_visible_run_maintenance')) AS owner_isolation,
 EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname=current_user AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
 AND NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','USAGE') AND NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','SET')) AS caller_isolation`;
export async function readVisibleRunReadiness(
  db: OperationalDatabase,
  capability: keyof typeof roles = 'web',
) {
  try {
    if (!Object.hasOwn(roles, capability)) fail();
    const [row] = await db.execute(sql.raw(VISIBLE_RUN_READINESS_SQL));
    const [caller] = await db.execute(
      sql`SELECT pg_catalog.pg_has_role(current_user,${roles[capability]},'USAGE') AND pg_catalog.has_schema_privilege(current_user,'app','USAGE') AND (SELECT count(*) FROM (VALUES ('nextera_web'),('nextera_visible_run_worker'),('nextera_visible_run_maintenance')) allowed(role_name) WHERE pg_catalog.pg_has_role(current_user,allowed.role_name,'USAGE'))=1 AS permitted`,
    );
    return {
      ready:
        !!row &&
        [
          'contract',
          'isolated_tables',
          'guards',
          'private_helpers',
          'permission_roles',
          'owner_isolation',
          'caller_isolation',
        ].every((key) => row[key] === true) &&
        caller?.permitted === true,
      liveRunVerified: false as const,
    };
  } catch {
    return { ready: false, liveRunVerified: false as const };
  }
}
async function rpc(
  db: OperationalDatabase,
  capability: keyof typeof roles,
  statement: ReturnType<typeof sql>,
) {
  if (!(await readVisibleRunReadiness(db, capability)).ready) fail();
  try {
    const [row] = await db.execute(statement);
    if (!row || !Object.hasOwn(row, 'data')) fail();
    return row.data as unknown;
  } catch (e) {
    return error(e);
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !isRequestId(value)) fail();
  return value.toLowerCase();
}
function hex(value: unknown): string {
  if (typeof value !== 'string' || !digest.test(value)) fail();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail();
  return value;
}
function scope(value: unknown): DraftScope {
  const s = object(value);
  if (typeof s.taskKey !== 'string' || !task.test(s.taskKey)) fail();
  return Object.freeze({
    learnerId: uuid(s.learnerId),
    cohortId: uuid(s.cohortId),
    attemptId: uuid(s.attemptId),
    taskKey: s.taskKey,
    definitionDigest: hex(s.definitionDigest),
  });
}
function match(a: DraftScope, b: DraftScope) {
  return Object.keys(a).every((key) => a[key as keyof DraftScope] === b[key as keyof DraftScope]);
}
export function encodeVisibleRunSource(source: string) {
  if (typeof source !== 'string' || source.length > ceiling) fail();
  const bytes = Buffer.from(source, 'utf8');
  if (
    !bytes.length ||
    bytes.length > ceiling ||
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== source
  )
    fail();
  return {
    base64: bytes.toString('base64'),
    digest: createHash('sha256').update(bytes).digest('hex'),
    length: bytes.length,
  };
}
function decode(value: unknown, max = ceiling): { bytes: Buffer; text: string } {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 + Math.ceil(max / 57))
    fail();
  const compact = value.replace(/\n/g, '');
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length > max || bytes.toString('base64') !== compact) fail();
  try {
    return {
      bytes,
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
    };
  } catch {
    return fail();
  }
}
export type StoredRunIntent = Readonly<{
  scope: DraftScope;
  requestId: string;
  filename: string;
  source: string;
  sourceDigest: string;
  byteLength: number;
  manifestDigest: string;
  policyDigest: string;
  deadline: string;
}>;
export type StoredVisibleRun = Readonly<{
  intent: StoredRunIntent;
  record: Readonly<{
    id: string;
    requestId: string;
    sourceDigest: string;
    state:
      | 'queued'
      | 'running'
      | 'completed'
      | 'compile_error'
      | 'runtime_error'
      | 'timeout'
      | 'output_limit'
      | 'system_error';
    output: string | null;
  }>;
}>;
export function storedRunIntentDigest(i: StoredRunIntent) {
  const s = i.scope;
  return createHash('sha256')
    .update(
      'nextera-visible-run-intent\0v1\0' +
        JSON.stringify([
          s.learnerId,
          s.cohortId,
          s.attemptId,
          s.taskKey,
          s.definitionDigest,
          i.requestId,
          i.filename,
          i.sourceDigest,
          i.byteLength,
          i.manifestDigest,
          i.policyDigest,
          i.deadline,
        ]),
    )
    .digest('hex');
}
function receipt(value: unknown, expected: DraftScope): StoredVisibleRun {
  const body = object(value),
    i = object(body.intent),
    r = object(body.record),
    s = scope(i.scope);
  if (
    !match(s, expected) ||
    typeof i.filename !== 'string' ||
    !/^[A-Za-z0-9_]+\.go$/.test(i.filename)
  )
    fail();
  const source = decode(i.sourceBase64),
    encoded = encodeVisibleRunSource(source.text);
  if (i.byteLength !== encoded.length || i.sourceDigest !== encoded.digest) fail();
  const intent = Object.freeze({
    scope: s,
    requestId: uuid(i.requestId),
    filename: i.filename,
    source: source.text,
    sourceDigest: encoded.digest,
    byteLength: encoded.length,
    manifestDigest: hex(i.manifestDigest),
    policyDigest: hex(i.policyDigest),
    deadline: timestamp(i.deadline),
  });
  if (
    body.intentDigest !== storedRunIntentDigest(intent) ||
    uuid(r.requestId) !== intent.requestId ||
    r.sourceDigest !== intent.sourceDigest ||
    ![
      'queued',
      'running',
      'completed',
      'compile_error',
      'runtime_error',
      'timeout',
      'output_limit',
      'system_error',
    ].includes(String(r.state))
  )
    fail();
  const pending = r.state === 'queued' || r.state === 'running';
  if (pending && r.outputBase64 !== null) fail();
  if (!pending && typeof r.outputBase64 !== 'string') fail();
  const output = pending ? null : r.state === 'system_error' ? '' : decode(r.outputBase64).text;
  return Object.freeze({
    intent,
    record: Object.freeze({
      id: uuid(r.id),
      requestId: intent.requestId,
      sourceDigest: intent.sourceDigest,
      state: r.state as StoredVisibleRun['record']['state'],
      output,
    }),
  });
}
export type StoredRunAuthority = Readonly<{
  editor: DraftContext;
  manifest: unknown;
  manifestDigest: string;
  policy: unknown;
  policyDigest: string;
}>;
export async function readVisibleRunAuthority(
  db: OperationalDatabase,
  authId: string,
  attemptId: string,
  taskKey: string,
): Promise<StoredRunAuthority> {
  uuid(authId);
  uuid(attemptId);
  if (!task.test(taskKey)) fail();
  const row = object(
      await rpc(
        db,
        'web',
        sql`SELECT app.visible_run_context(${authId}::uuid,${attemptId}::uuid,${taskKey}) AS data`,
      ),
    ),
    e = object(row.editor),
    s = scope(e.scope);
  if (
    s.attemptId !== attemptId.toLowerCase() ||
    s.taskKey !== taskKey ||
    typeof e.readAllowed !== 'boolean' ||
    !['active', 'closed'].includes(String(e.status)) ||
    !Number.isSafeInteger(e.sourceBytes) ||
    Number(e.sourceBytes) < 1 ||
    Number(e.sourceBytes) > ceiling ||
    typeof e.filename !== 'string' ||
    !/^[A-Za-z0-9_]+\.go$/.test(e.filename)
  )
    fail();
  const manifest = decode(row.manifestBase64),
    policy = decode(row.policyBase64),
    manifestDigest = hex(row.manifestDigest),
    policyDigest = hex(row.policyDigest);
  for (const [blob, domain, expected] of [
    [manifest, 'nextera-visible-examples', manifestDigest],
    [policy, 'nextera-visible-run-policy', policyDigest],
  ] as const) {
    if (
      createHash('sha256')
        .update(domain + '\0v1\0')
        .update(blob.bytes)
        .digest('hex') !== expected
    )
      fail();
  }
  try {
    return {
      editor: {
        scope: s,
        readAllowed: e.readAllowed,
        status: e.status as 'active' | 'closed',
        sourceBytes: Number(e.sourceBytes),
        filename: e.filename,
        serverNow: timestamp(e.serverNow),
        deadline: timestamp(e.deadline),
      },
      manifest: JSON.parse(manifest.text) as unknown,
      manifestDigest,
      policy: JSON.parse(policy.text) as unknown,
      policyDigest,
    };
  } catch {
    return fail();
  }
}
export async function reserveVisibleRun(
  db: OperationalDatabase,
  input: { authId: string; intent: StoredRunIntent; intentDigest: string },
) {
  const auth = uuid(input.authId),
    i = input.intent,
    s = scope(i.scope);
  uuid(i.requestId);
  const source = encodeVisibleRunSource(i.source);
  if (
    storedRunIntentDigest(i) !== hex(input.intentDigest) ||
    i.sourceDigest !== source.digest ||
    i.byteLength !== source.length ||
    !/^[A-Za-z0-9_]+\.go$/.test(i.filename)
  )
    fail();
  hex(i.manifestDigest);
  hex(i.policyDigest);
  timestamp(i.deadline);
  const raw = await rpc(
    db,
    'web',
    sql`SELECT app.reserve_visible_run(${auth}::uuid,${s.attemptId}::uuid,${s.taskKey},${s.definitionDigest},${i.requestId}::uuid,${i.manifestDigest},${i.policyDigest},decode(${source.base64},'base64'),${source.digest},${input.intentDigest}) AS data`,
  );
  const result = receipt(raw, s);
  if (
    storedRunIntentDigest(result.intent) !== input.intentDigest ||
    result.intent.source !== i.source
  )
    fail();
  return result;
}
export async function readVisibleRun(
  db: OperationalDatabase,
  authId: string,
  requested: DraftScope,
  lookup: { runId: string } | { requestId: string },
) {
  const auth = uuid(authId),
    s = scope(requested),
    run = 'runId' in lookup ? uuid(lookup.runId) : null,
    request = 'requestId' in lookup ? uuid(lookup.requestId) : null;
  const raw = await rpc(
    db,
    'web',
    sql`SELECT app.read_visible_run(${auth}::uuid,${s.attemptId}::uuid,${s.taskKey},${s.definitionDigest},${run}::uuid,${request}::uuid) AS data`,
  );
  if (raw === null) return null;
  const result = receipt(raw, s);
  if ((run && result.record.id !== run) || (request && result.record.requestId !== request)) fail();
  return result;
}
type Lease = Readonly<{ runId: string; generation: number; token: string }>;
function lease(l: Lease) {
  uuid(l.runId);
  uuid(l.token);
  if (!Number.isSafeInteger(l.generation) || l.generation < 1) fail();
}
export async function claimVisibleRun(
  db: OperationalDatabase,
  runId: string,
  expected: DraftScope,
) {
  const id = uuid(runId),
    s = scope(expected),
    raw = await rpc(db, 'worker', sql`SELECT app.claim_visible_run(${id}::uuid) AS data`);
  if (raw === null) return null;
  const body = object(raw),
    run = receipt(body.run, s);
  if (
    run.record.id !== id ||
    !Number.isSafeInteger(body.leaseGeneration) ||
    Number(body.leaseGeneration) < 1 ||
    run.record.state !== 'queued'
  )
    fail();
  const manifest = decode(body.manifestBase64),
    policy = decode(body.policyBase64);
  if (
    createHash('sha256')
      .update('nextera-visible-examples\0v1\0')
      .update(manifest.bytes)
      .digest('hex') !== run.intent.manifestDigest ||
    createHash('sha256')
      .update('nextera-visible-run-policy\0v1\0')
      .update(policy.bytes)
      .digest('hex') !== run.intent.policyDigest
  )
    fail();
  try {
    return {
      run,
      manifest: JSON.parse(manifest.text) as unknown,
      policy: JSON.parse(policy.text) as unknown,
      lease: { runId: id, generation: Number(body.leaseGeneration), token: uuid(body.leaseToken) },
      leaseExpiresAt: timestamp(body.leaseExpiresAt),
    };
  } catch {
    return fail();
  }
}
export async function pulseVisibleRun(db: OperationalDatabase, l: Lease, startExecution: boolean) {
  lease(l);
  if (typeof startExecution !== 'boolean') fail();
  const raw = object(
    await rpc(
      db,
      'worker',
      sql`SELECT app.pulse_visible_run(${l.runId}::uuid,${l.generation}::bigint,${l.token}::uuid,${startExecution}) AS data`,
    ),
  );
  if (raw.kind === 'stop_required') return { kind: 'stop_required' } as const;
  if (raw.kind !== 'authorized' || !['claimed', 'running'].includes(String(raw.state))) fail();
  return {
    kind: 'authorized',
    state: raw.state as 'claimed' | 'running',
    leaseExpiresAt: timestamp(raw.leaseExpiresAt),
  } as const;
}
export async function completeVisibleRun(
  db: OperationalDatabase,
  l: Lease,
  expected: DraftScope,
  state: StoredVisibleRun['record']['state'],
  output: string,
  stoppedProof: string,
) {
  lease(l);
  hex(stoppedProof);
  const s = scope(expected);
  if (
    ![
      'completed',
      'compile_error',
      'runtime_error',
      'timeout',
      'output_limit',
      'system_error',
    ].includes(state) ||
    typeof output !== 'string'
  )
    fail();
  const bytes = Buffer.from(output, 'utf8');
  if (
    bytes.length > ceiling ||
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== output
  )
    fail();
  const raw = await rpc(
    db,
    'worker',
    sql`SELECT app.complete_visible_run(${l.runId}::uuid,${l.generation}::bigint,${l.token}::uuid,${state},decode(${bytes.toString('base64')},'base64'),${stoppedProof}) AS data`,
  );
  const result = receipt(raw, s);
  if (
    result.record.id !== l.runId ||
    result.record.state !== state ||
    result.record.output !== (state === 'system_error' ? '' : output)
  )
    fail();
  return result;
}
export async function reconcileVisibleRun(
  db: OperationalDatabase,
  runId: string,
  generation: number,
  stoppedProof: string | null,
) {
  uuid(runId);
  if (!Number.isSafeInteger(generation) || generation < 0) fail();
  if (stoppedProof !== null) hex(stoppedProof);
  const result = await rpc(
    db,
    'maintenance',
    sql`SELECT app.reconcile_visible_run(${runId}::uuid,${generation}::bigint,${stoppedProof}) AS data`,
  );
  if (typeof result !== 'boolean') fail();
  return result;
}
export async function purgeExpiredVisibleRunPayloads(
  db: OperationalDatabase,
  cutoff: string,
  batch: number,
) {
  timestamp(cutoff);
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > 1000) fail();
  const result = await rpc(
    db,
    'maintenance',
    sql`SELECT app.purge_visible_run_sources(${cutoff}::timestamptz,${batch}::integer) AS data`,
  );
  if (!Number.isSafeInteger(result) || Number(result) < 0 || Number(result) > batch) fail();
  return Number(result);
}

export type RunQueueHint = Readonly<{
  runId: string;
  scope: DraftScope;
  generation: number;
  state: 'queued' | 'claimed' | 'running' | 'recovery_required';
}>;
function hints(raw: unknown, batch: number): readonly RunQueueHint[] {
  if (!Array.isArray(raw) || raw.length > batch) fail();
  const seen = new Set<string>();
  return raw.map((value) => {
    const r = object(value),
      runId = uuid(r.runId);
    if (
      seen.has(runId) ||
      !Number.isSafeInteger(r.generation) ||
      Number(r.generation) < 0 ||
      !['queued', 'claimed', 'running', 'recovery_required'].includes(String(r.state))
    )
      fail();
    if (
      (r.state === 'queued' && Number(r.generation) !== 0) ||
      (r.state !== 'queued' && Number(r.generation) < 1)
    )
      fail();
    seen.add(runId);
    return Object.freeze({
      runId,
      scope: scope(r.scope),
      generation: Number(r.generation),
      state: r.state as RunQueueHint['state'],
    });
  });
}
export async function listQueuedVisibleRuns(db: OperationalDatabase, batch: number) {
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > 100) fail();
  return hints(
    await rpc(db, 'worker', sql`SELECT app.list_queued_visible_runs(${batch}::integer) AS data`),
    batch,
  );
}
export async function listRecoverableVisibleRuns(db: OperationalDatabase, batch: number) {
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > 100) fail();
  return hints(
    await rpc(
      db,
      'maintenance',
      sql`SELECT app.list_recoverable_visible_runs(${batch}::integer) AS data`,
    ),
    batch,
  );
}
