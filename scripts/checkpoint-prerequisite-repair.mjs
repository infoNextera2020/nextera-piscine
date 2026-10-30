/* Injected preparation adapters only: no driver, connection, file or process I/O. */
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { PREREQUISITE_FUNCTIONS, REGISTERED_SOURCES } from './checkpoint-prerequisite-manifest.mjs';
export { PREREQUISITE_FUNCTIONS, REGISTERED_SOURCES } from './checkpoint-prerequisite-manifest.mjs';

export const REPAIR_FILE = '0019_prerequisite_execute_repair.DRAFT.sql';
export const REPAIR_DATABASE = 'foundation_test_checkpoint_migration_adapter_20261029';
export const DBA = 'anas',
  ACTOR = 'checkpoint_migration_actor_20261029';
const HASH = /^[0-9a-f]{64}$/,
  hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const literal = (v) => "'" + v.replaceAll("'", "''") + "'";
const quote = (v) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(v)) throw new Error('Fixed identifier required');
  return '"' + v + '"';
};
export const EXECUTE_EDGES = Object.freeze(
  PREREQUISITE_FUNCTIONS.flatMap(([signature, owner, web, extra = []]) =>
    [...(web ? ['nextera_web'] : []), ...extra].map((grantee) =>
      Object.freeze({ signature, owner, grantee }),
    ),
  ),
);
export const REPAIR_STATEMENTS = Object.freeze(
  EXECUTE_EDGES.map((e) => 'GRANT EXECUTE ON FUNCTION ' + e.signature + ' TO ' + e.grantee + ';'),
);
const VALUES = PREREQUISITE_FUNCTIONS.map(
  ([sig, owner, web, extra = []]) =>
    '(' +
    literal(sig) +
    ',' +
    literal(owner) +
    ',ARRAY[' +
    [...(web ? ['nextera_web'] : []), ...extra].sort().map(literal).join(',') +
    ']::text[])',
).join(',\n');
function checkSql(exact) {
  return `DO $verify$ DECLARE item record; object_id oid; actual_owner name; actual_roles text[]; BEGIN
 FOR item IN SELECT * FROM (VALUES ${VALUES}) v(signature,owner_name,allowed_roles) LOOP
  object_id:=pg_catalog.to_regprocedure(item.signature);
  SELECT o.rolname INTO actual_owner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles o ON o.oid=p.proowner WHERE p.oid=object_id;
  IF object_id IS NULL OR actual_owner IS DISTINCT FROM item.owner_name THEN RAISE EXCEPTION 'Repair owner/identity precondition failed' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=object_id AND
   (a.grantee=0 OR (a.grantee<>p.proowner AND (r.oid IS NULL OR a.privilege_type<>'EXECUTE' OR a.is_grantable OR NOT(r.rolname=ANY(item.allowed_roles)))))) THEN
    RAISE EXCEPTION 'Unexpected or PUBLIC repair privilege' USING ERRCODE='42501'; END IF;
  SELECT coalesce(array_agg(DISTINCT r.rolname::text ORDER BY r.rolname::text),'{}'::text[]) INTO actual_roles
   FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=object_id AND a.grantee<>p.proowner;
  ${exact ? `IF actual_roles IS DISTINCT FROM item.allowed_roles THEN RAISE EXCEPTION 'Repair intended privileges incomplete' USING ERRCODE='42501'; END IF;` : ''}
 END LOOP;
END $verify$;\n`.replace(/[ \t]+$/gm, '');
}
const SCOPE_SQL = `DO $scope$ BEGIN
 IF pg_catalog.current_database()<>'${REPAIR_DATABASE}' OR current_user<>'${DBA}' OR session_user<>'${DBA}'
 OR NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname=current_user AND rolsuper)
 OR pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Private repair DBA context required' USING ERRCODE='42501'; END IF;
END $scope$;\n`;
const ROLE_SCOPE_SQL = `DO $roles$ BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('nextera_web','nextera_judge_owner','nextera_runner','nextera_judge_maintenance','nextera_result_application','nextera_checkpoint_owner','nextera_raid_owner','${ACTOR}','checkpoint_migration_probe_20261029'))<>9
 OR EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname IN ('nextera_web','nextera_judge_owner','nextera_runner','nextera_judge_maintenance','nextera_result_application','nextera_checkpoint_owner','nextera_raid_owner','${ACTOR}','checkpoint_migration_probe_20261029') AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication))
 OR EXISTS(SELECT FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname IN ('nextera_web','nextera_judge_owner','nextera_runner','nextera_judge_maintenance','nextera_result_application','nextera_checkpoint_owner','nextera_raid_owner')) THEN
  RAISE EXCEPTION 'Existing isolated permission roles required' USING ERRCODE='42501'; END IF;
END $roles$;\n`;
const ACTOR_SCOPE_SQL = `DO $actor$ BEGIN
 IF EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname IN ('nextera_web','nextera_judge_owner','nextera_runner','nextera_judge_maintenance','nextera_result_application','nextera_checkpoint_owner','nextera_raid_owner')
 AND (pg_catalog.pg_has_role('${ACTOR}',r.oid,'SET') OR pg_catalog.pg_has_role('${ACTOR}',r.oid,'USAGE')))
 OR EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='${ACTOR}' AND rolinherit)
 OR EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolcanlogin AND rolname<>'${DBA}') THEN
 RAISE EXCEPTION 'Repair must not expand effective actor access' USING ERRCODE='42501'; END IF;
END $actor$;\n`;
const LOCK_SQL =
  'LOCK TABLE pg_catalog.pg_authid,pg_catalog.pg_auth_members,pg_catalog.pg_proc,pg_catalog.pg_namespace IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n';
const START = '-- fixed-27-grants:start\n',
  END = '-- fixed-27-grants:end\n';
export function renderPrerequisiteRepairSql() {
  return (
    '-- REVIEW DRAFT ONLY. Not registered; private synthetic database and named DBA only.\n' +
    'BEGIN;\nSET LOCAL search_path=pg_catalog,pg_temp;\n' +
    SCOPE_SQL +
    LOCK_SQL +
    ROLE_SCOPE_SQL +
    ACTOR_SCOPE_SQL +
    checkSql(false) +
    START +
    REPAIR_STATEMENTS.join('\n') +
    '\n' +
    END +
    checkSql(true) +
    'COMMIT;\n'
  );
}

const CODES = new Set([
  'SCOPE',
  'SOURCE',
  'IDENTITY',
  'ACL',
  'GRAPH',
  'TIME',
  'TRANSACTION_FAILED',
  'COMMIT_UNCERTAIN',
]);
const STAGES = new Set([
  'validate',
  'begin',
  'identity',
  'source',
  'dba_block',
  'repair_pre',
  'repair_grant',
  'repair_post',
  'commit',
]);
export class PrerequisiteRepairError extends Error {
  constructor(code, stage = 'validate', sqlstate = null) {
    super('PREREQUISITE_REPAIR_' + (CODES.has(code) ? code : 'TRANSACTION_FAILED'));
    this.code = CODES.has(code) ? code : 'TRANSACTION_FAILED';
    this.stage = STAGES.has(stage) ? stage : 'validate';
    this.sqlstate =
      typeof sqlstate === 'string' && /^[0-9A-Z]{5}$/.test(sqlstate) ? sqlstate : null;
    this.rollbackVerified = false;
  }
}
const fail = (code, stage) => {
  throw new PrerequisiteRepairError(code, stage);
};
function validate(client, policy, clock) {
  if (
    !client ||
    typeof client.begin !== 'function' ||
    client.options?.prepare !== false ||
    policy?.database !== REPAIR_DATABASE ||
    policy?.dba !== DBA ||
    policy?.actor !== ACTOR ||
    !HASH.test(policy?.approvedScopeSha256 ?? '') ||
    policy?.allowFixedDbaSections !== true ||
    !clock ||
    typeof clock.nowMs !== 'function' ||
    typeof clock.monotonicMs !== 'function' ||
    !Number.isSafeInteger(policy.deadlineMs) ||
    policy.deadlineMs <= 0
  )
    fail('SCOPE');
  return Object.freeze({
    database: policy.database,
    dba: policy.dba,
    actor: policy.actor,
    approvedScopeSha256: policy.approvedScopeSha256,
    deadlineMs: policy.deadlineMs,
    allowFixedDbaSections: true,
    repairSha256: policy.repairSha256,
  });
}
const IDENTITY_SQL = `SELECT pg_catalog.current_database() AS database,current_user::text AS actor,session_user::text AS session_actor,
 (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) AS super`;
const GRAPH_SQL = `SELECT jsonb_build_object('roles',(SELECT jsonb_agg(jsonb_build_object('oid',oid::bigint,'name',rolname,'login',rolcanlogin,'super',rolsuper,'createRole',rolcreaterole,'createDb',rolcreatedb,'inherit',rolinherit,'bypass',rolbypassrls,'replicate',rolreplication) ORDER BY oid) FROM pg_catalog.pg_roles),
 'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',roleid::bigint,'member',member::bigint,'grantor',grantor::bigint,'admin',admin_option,'inherit',inherit_option,'set',set_option) ORDER BY roleid,member,grantor),'[]'::jsonb) FROM pg_catalog.pg_auth_members)) AS graph`;
export const REPAIR_GRAPH_SQL = GRAPH_SQL;
export const REPAIR_IDENTITY_SQL = IDENTITY_SQL;
export const REPAIR_ACTOR_ACCESS_SQL = `SELECT rolname AS role,pg_catalog.pg_has_role('${ACTOR}',oid,'SET') AS can_set,
 pg_catalog.pg_has_role('${ACTOR}',oid,'USAGE') AS can_inherit FROM pg_catalog.pg_roles WHERE rolname IN
 ('nextera_web','nextera_judge_owner','nextera_runner','nextera_judge_maintenance','nextera_result_application','nextera_checkpoint_owner','nextera_raid_owner') ORDER BY rolname`;
export const REPAIR_PROOF_SQL = `SELECT pg_catalog.pg_backend_pid() AS pid,pg_catalog.pg_current_xact_id()::text AS transaction_id,
 (SELECT count(DISTINCT relation)=4 FROM pg_catalog.pg_locks WHERE pid=pg_catalog.pg_backend_pid() AND granted
 AND locktype='relation' AND mode='ShareRowExclusiveLock' AND relation IN ('pg_catalog.pg_authid'::regclass,'pg_catalog.pg_auth_members'::regclass,'pg_catalog.pg_proc'::regclass,'pg_catalog.pg_namespace'::regclass)
 AND database IN (0,(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()))) AS locks_held`;
export const FUNCTION_ACL_SQL = `SELECT o.rolname AS owner,
 NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0) AS no_public,
 pg_catalog.has_function_privilege('nextera_web',p.oid,'EXECUTE') AS web_execute,
 NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 WHERE a.grantee<>p.proowner AND (a.privilege_type<>'EXECUTE' OR a.is_grantable)) AS execute_only,
 coalesce((SELECT jsonb_agg(DISTINCT r.rolname ORDER BY r.rolname) FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner),'[]'::jsonb) AS grantees
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles o ON o.oid=p.proowner WHERE p.oid=pg_catalog.to_regprocedure($1)`;
async function collectFunctionAcls(sql, specs, exact) {
  const observed = [];
  for (const [signature, owner, web, extra = []] of specs) {
    const rows = await sql.unsafe(FUNCTION_ACL_SQL, [signature]);
    if (rows.length !== 1) fail('ACL', 'repair_post');
    const r = rows[0];
    const expected = [...(web ? ['nextera_web'] : []), ...extra].sort();
    if (
      r.owner !== owner ||
      r.no_public !== true ||
      r.execute_only !== true ||
      !Array.isArray(r.grantees) ||
      r.web_execute !== r.grantees.includes('nextera_web') ||
      r.grantees.some((role) => !expected.includes(role)) ||
      (exact && (r.web_execute !== web || JSON.stringify(r.grantees) !== JSON.stringify(expected)))
    )
      fail('ACL', 'repair_post');
    observed.push(
      Object.freeze({
        signature,
        owner: r.owner,
        publicDenied: r.no_public,
        webExecute: r.web_execute,
        grantees: Object.freeze([...r.grantees]),
      }),
    );
  }
  return Object.freeze(observed);
}
export async function assertFunctionAcls(sql, specs) {
  return collectFunctionAcls(sql, specs, true);
}
function budget(policy, clock) {
  const mono = clock.monotonicMs();
  return () => {
    const remaining = Math.floor(
      Math.min(policy.deadlineMs - clock.nowMs(), 20000 - (clock.monotonicMs() - mono)),
    );
    if (!Number.isSafeInteger(remaining) || remaining <= 0) fail('TIME');
    return remaining;
  };
}
async function configure(sql, remaining) {
  await sql.unsafe(
    "SELECT pg_catalog.set_config('search_path','pg_catalog,pg_temp',true),pg_catalog.set_config('statement_timeout',$1,true),pg_catalog.set_config('lock_timeout',$2,true),pg_catalog.set_config('idle_in_transaction_session_timeout',$3,true)",
    [
      Math.min(2000, remaining) + 'ms',
      Math.min(1000, remaining) + 'ms',
      Math.min(3000, remaining) + 'ms',
    ],
  );
}
async function identity(sql, role) {
  const rows = await sql.unsafe(IDENTITY_SQL),
    r = rows[0];
  if (
    rows.length !== 1 ||
    r.database !== REPAIR_DATABASE ||
    r.actor !== role ||
    r.session_actor !== role ||
    r.super !== (role === DBA)
  )
    fail('IDENTITY', 'identity');
}
function errorResult(error, stage, finished) {
  return new PrerequisiteRepairError(
    finished
      ? 'COMMIT_UNCERTAIN'
      : error instanceof PrerequisiteRepairError
        ? error.code
        : 'TRANSACTION_FAILED',
    stage,
    ['ERROR', 'FATAL'].includes(error?.severity)
      ? error.code
      : error instanceof PrerequisiteRepairError
        ? error.sqlstate
        : null,
  );
}

/** Each registered file remains byte-identical and one physical transaction.
 * Explicit named DBA spans are test-bootstrap authority, never actor grants.
 */
export async function applyRegisteredPrerequisite(client, file, bytes, policy, clock) {
  policy = validate(client, policy, clock);
  const binding = REGISTERED_SOURCES[file];
  if (Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (!binding || !Buffer.isBuffer(bytes) || hash(bytes) !== binding.sha256) fail('SOURCE');
  const chunks = [
    bytes.subarray(0, binding.start),
    bytes.subarray(binding.start, binding.end),
    bytes.subarray(binding.end),
  ];
  if (
    !Buffer.concat(chunks).equals(bytes) ||
    chunks.some(
      (b, i) => hash(b) !== [binding.prefixSha256, binding.dbaSha256, binding.suffixSha256][i],
    )
  )
    fail('SOURCE');
  const remaining = budget(policy, clock);
  let stage = 'begin',
    finished = false,
    value;
  try {
    const result = await client.begin('isolation level read committed', async (sql) => {
      remaining();
      await configure(sql, remaining());
      const set = async (role) => {
        stage = 'identity';
        remaining();
        await sql.unsafe('SET LOCAL SESSION AUTHORIZATION ' + quote(role));
        await identity(sql, role);
      };
      await set(ACTOR);
      stage = 'source';
      if (chunks[0].length) await sql.unsafe(chunks[0].toString('utf8'));
      if (chunks[1].length) {
        await set(DBA);
        stage = 'dba_block';
        remaining();
        await sql.unsafe(chunks[1].toString('utf8'));
        await set(ACTOR);
      }
      stage = 'source';
      remaining();
      if (chunks[2].length) await sql.unsafe(chunks[2].toString('utf8'));
      await identity(sql, ACTOR);
      remaining();
      finished = true;
      stage = 'commit';
      value = Object.freeze({
        file,
        sha256: binding.sha256,
        dbaSha256: chunks[1].length ? binding.dbaSha256 : null,
        actorRestoredBeforeCommit: true,
      });
      return value;
    });
    if (!finished || result !== value) fail('COMMIT_UNCERTAIN', 'commit');
    remaining();
    return value;
  } catch (error) {
    throw errorResult(error, stage, finished);
  }
}

export async function applyPrerequisiteExecuteRepair(client, bytes, policy, clock) {
  policy = validate(client, policy, clock);
  if (Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (
    !Buffer.isBuffer(bytes) ||
    !HASH.test(policy.repairSha256 ?? '') ||
    hash(bytes) !== policy.repairSha256 ||
    bytes.toString('utf8') !== renderPrerequisiteRepairSql()
  )
    fail('SOURCE');
  const full = bytes.toString('utf8'),
    begin = full.indexOf('BEGIN;\n');
  const prefix = full.slice(0, begin) + full.slice(begin + 7, full.indexOf(START));
  const post = full.slice(full.indexOf(END) + END.length, full.lastIndexOf('COMMIT;'));
  const remaining = budget(policy, clock);
  let stage = 'begin',
    finished = false,
    value;
  try {
    const result = await client.begin('isolation level read committed', async (sql) => {
      remaining();
      await configure(sql, remaining());
      await identity(sql, DBA);
      stage = 'repair_pre';
      await sql.unsafe(prefix);
      remaining();
      const proof = (await sql.unsafe(REPAIR_PROOF_SQL))[0];
      if (
        !proof ||
        !Number.isSafeInteger(proof.pid) ||
        proof.pid <= 0 ||
        !/^\d{1,30}$/.test(proof.transaction_id) ||
        proof.locks_held !== true
      )
        fail('GRAPH', stage);
      const access = await sql.unsafe(REPAIR_ACTOR_ACCESS_SQL);
      const permissionRoles = [
        'nextera_web',
        'nextera_judge_owner',
        'nextera_runner',
        'nextera_judge_maintenance',
        'nextera_result_application',
        'nextera_checkpoint_owner',
        'nextera_raid_owner',
      ].sort();
      if (
        JSON.stringify(access.map((r) => r.role)) !== JSON.stringify(permissionRoles) ||
        access.some((r) => r.can_set !== false || r.can_inherit !== false)
      )
        fail('GRAPH', stage);
      const before = (await sql.unsafe(GRAPH_SQL))[0]?.graph;
      if (!before || !Array.isArray(before.roles) || !Array.isArray(before.memberships))
        fail('GRAPH', stage);
      const beforeAcl = await collectFunctionAcls(sql, PREREQUISITE_FUNCTIONS, false);
      stage = 'repair_grant';
      for (const statement of REPAIR_STATEMENTS) {
        remaining();
        await sql.unsafe(statement);
      }
      stage = 'repair_post';
      remaining();
      await sql.unsafe(post);
      const afterAcl = await assertFunctionAcls(sql, PREREQUISITE_FUNCTIONS);
      const after = (await sql.unsafe(GRAPH_SQL))[0]?.graph;
      if (JSON.stringify(after) !== JSON.stringify(before)) fail('GRAPH', stage);
      await identity(sql, DBA);
      remaining();
      finished = true;
      stage = 'commit';
      value = Object.freeze({
        sourceSha256: policy.repairSha256,
        executeEdges: 27,
        functions: 25,
        publicDenied: true,
        roleGraphUnchanged: true,
        beforeGraphSha256: hash(JSON.stringify(before)),
        afterGraphSha256: hash(JSON.stringify(after)),
        beforeAcl,
        afterAcl,
        actorPrivilegeExpansion: false,
        commitAcknowledged: true,
      });
      return value;
    });
    if (!finished || result !== value) fail('COMMIT_UNCERTAIN', 'commit');
    remaining();
    return value;
  } catch (error) {
    throw errorResult(error, stage, finished);
  }
}
