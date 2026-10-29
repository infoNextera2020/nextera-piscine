/* Injected postgres-js adapter; construction/import never opens a connection. */
import crypto from 'node:crypto';
import {
  CHECKPOINT_CONTEXT_OWNER,
  MigrationContextError,
  prepareCheckpointDraftMigration,
  validateCheckpointMigrationFacts,
} from './checkpoint-migration-context.mjs';

const identifier = (v) => typeof v === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(v);
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const quote = (v) => {
  if (!identifier(v)) throw new MigrationContextError('POLICY_REQUIRED');
  return '"' + v + '"';
};
const reject = () => {
  throw new MigrationContextError('TRANSACTION_FAILED');
};
const GUARD = 'checkpoint_rehearsal.lock_migration_catalogs';
const ISOLATION = 'isolation level read committed';

export function buildMigrationCatalogGuard(config) {
  const { database, principal, guardOwner, serverMajor, maximumStatementMs, maximumIdleMs } =
    config ?? {};
  if (
    !/^foundation_test_[a-z0-9_]+$/.test(database ?? '') ||
    !identifier(principal) ||
    !identifier(guardOwner) ||
    new Set([principal, guardOwner, 'nextera_web', CHECKPOINT_CONTEXT_OWNER]).size !== 4 ||
    ![16, 17].includes(serverMajor) ||
    !positive(maximumStatementMs) ||
    !positive(maximumIdleMs)
  )
    throw new MigrationContextError('POLICY_REQUIRED');
  const body = `
BEGIN
 IF pg_catalog.current_database()<>'${database}' OR session_user<>'${principal}'
 OR current_user<>'${guardOwner}' OR pg_catalog.current_setting('transaction_isolation')<>'read committed'
 OR pg_catalog.current_setting('server_version_num')::integer/10000<>${serverMajor} THEN
  RAISE EXCEPTION 'Migration catalog guard scope denied' USING ERRCODE='42501';
 END IF;
 IF (SELECT setting::bigint FROM pg_catalog.pg_settings WHERE name='statement_timeout') NOT BETWEEN 1 AND ${maximumStatementMs}
 OR (SELECT setting::bigint FROM pg_catalog.pg_settings WHERE name='idle_in_transaction_session_timeout') NOT BETWEEN 1 AND ${maximumIdleMs} THEN
  RAISE EXCEPTION 'Bounded migration timeouts required' USING ERRCODE='42501';
 END IF;
 LOCK TABLE pg_catalog.pg_authid,pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 RETURN pg_catalog.jsonb_build_object('pid',pg_catalog.pg_backend_pid(),'transactionId',pg_catalog.pg_current_xact_id()::text);
END;
`;
  const setupSql = `BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL check_function_bodies=on;
DO $setup$ BEGIN
 IF pg_catalog.current_database()<>'${database}' OR current_user<>'${guardOwner}' OR session_user<>'${guardOwner}'
 OR NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname=current_user AND rolsuper) THEN
 RAISE EXCEPTION 'Existing trusted cluster administrator required'; END IF;
END $setup$;
CREATE SCHEMA checkpoint_rehearsal AUTHORIZATION ${quote(guardOwner)};
REVOKE ALL ON SCHEMA checkpoint_rehearsal FROM PUBLIC;
CREATE TABLE checkpoint_rehearsal.migration_context_audit(
 scope_sha256 text NOT NULL CHECK(scope_sha256 ~ '^[0-9a-f]{64}$'),
 transaction_id text NOT NULL, actor_name name NOT NULL, event_sequence integer NOT NULL CHECK(event_sequence>0),
 event_json jsonb NOT NULL, recorded_at timestamptz NOT NULL,
 PRIMARY KEY(scope_sha256,transaction_id,event_sequence));
REVOKE ALL ON TABLE checkpoint_rehearsal.migration_context_audit FROM PUBLIC;
CREATE FUNCTION ${GUARD}() RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp AS $guard$${body}$guard$;
REVOKE ALL ON FUNCTION ${GUARD}() FROM PUBLIC;
-- Strip deployment default ACLs on these three NEW fixed objects only.
DO $acl$ DECLARE recipient name; BEGIN
 FOR recipient IN
  SELECT DISTINCT r.rolname FROM (
   SELECT x.grantee FROM pg_catalog.pg_namespace n,
    LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) x
    WHERE n.oid='checkpoint_rehearsal'::pg_catalog.regnamespace
   UNION SELECT x.grantee FROM pg_catalog.pg_class c,
    LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) x
    WHERE c.oid='checkpoint_rehearsal.migration_context_audit'::pg_catalog.regclass
   UNION SELECT x.grantee FROM pg_catalog.pg_proc p,
    LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) x
    WHERE p.oid='checkpoint_rehearsal.lock_migration_catalogs()'::pg_catalog.regprocedure
  ) grants JOIN pg_catalog.pg_roles r ON r.oid=grants.grantee
  WHERE r.rolname<>current_user
 LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA checkpoint_rehearsal FROM %I',recipient);
  EXECUTE pg_catalog.format('REVOKE ALL ON TABLE checkpoint_rehearsal.migration_context_audit FROM %I',recipient);
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION checkpoint_rehearsal.lock_migration_catalogs() FROM %I',recipient);
 END LOOP;
END $acl$;
GRANT USAGE ON SCHEMA checkpoint_rehearsal TO ${quote(principal)};
GRANT INSERT ON TABLE checkpoint_rehearsal.migration_context_audit TO ${quote(principal)};
GRANT EXECUTE ON FUNCTION ${GUARD}() TO ${quote(principal)};
DO $web$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='nextera_web')
 OR pg_catalog.has_schema_privilege('nextera_web','checkpoint_rehearsal','USAGE')
 OR pg_catalog.has_schema_privilege('nextera_web','checkpoint_rehearsal','CREATE')
 OR pg_catalog.has_function_privilege('nextera_web','checkpoint_rehearsal.lock_migration_catalogs()','EXECUTE')
 OR pg_catalog.has_table_privilege('nextera_web','checkpoint_rehearsal.migration_context_audit','SELECT')
 OR pg_catalog.has_table_privilege('nextera_web','checkpoint_rehearsal.migration_context_audit','INSERT')
 OR pg_catalog.has_table_privilege('nextera_web','checkpoint_rehearsal.migration_context_audit','UPDATE')
 OR pg_catalog.has_table_privilege('nextera_web','checkpoint_rehearsal.migration_context_audit','DELETE')
 OR pg_catalog.has_table_privilege('nextera_web','checkpoint_rehearsal.migration_context_audit','TRUNCATE')
 OR pg_catalog.has_table_privilege('nextera_web','checkpoint_rehearsal.migration_context_audit','REFERENCES')
 OR pg_catalog.has_table_privilege('nextera_web','checkpoint_rehearsal.migration_context_audit','TRIGGER')
 OR pg_catalog.pg_has_role('nextera_web','${principal}','SET')
 OR pg_catalog.pg_has_role('nextera_web','${guardOwner}','SET') THEN
  RAISE EXCEPTION 'Web access to migration capability denied' USING ERRCODE='42501';
 END IF;
END $web$;
COMMIT;
`;
  return Object.freeze({
    database,
    principal,
    guardOwner,
    serverMajor,
    maximumStatementMs,
    maximumIdleMs,
    bodySha256: hash(body),
    body,
    setupSql,
  });
}

export const MIGRATION_GUARD_ATTEST_SQL = `WITH a AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
SELECT p.prosrc AS body,p.proconfig AS config,p.pronargs AS arguments,p.prokind AS kind,
 p.prosecdef AS definer,p.proretset AS returns_set,p.prorettype='pg_catalog.jsonb'::pg_catalog.regtype AS returns_json,
 l.lanname AS language,o.rolname AS owner,o.rolsuper AS owner_super,
 current_database() AS database,current_user::text AS actor,session_user::text AS session_actor,
 current_setting('server_version_num')::integer AS server_version,
 n.nspowner=p.proowner AS schema_owner,
 has_schema_privilege(current_user,n.oid,'USAGE') AS schema_usage,
 NOT has_schema_privilege(current_user,n.oid,'CREATE') AS no_schema_create,
 NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) x
  WHERE x.grantee NOT IN(p.proowner,a.oid) OR (x.grantee=a.oid AND (x.privilege_type<>'EXECUTE' OR x.is_grantable))) AS function_acl_safe,
 NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) x
  WHERE x.grantee NOT IN(n.nspowner,a.oid) OR (x.grantee=a.oid AND (x.privilege_type<>'USAGE' OR x.is_grantable))) AS schema_acl_safe,
 c.relowner=p.proowner AND c.relkind='r' AS audit_owner,
 NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) x
  WHERE x.grantee NOT IN(c.relowner,a.oid) OR (x.grantee=a.oid AND (x.privilege_type<>'INSERT' OR x.is_grantable))) AS audit_acl_safe,
 has_function_privilege(current_user,p.oid,'EXECUTE') AS can_execute,
 has_table_privilege(current_user,c.oid,'INSERT') AS can_audit,
 NOT (pg_catalog.has_schema_privilege('nextera_web',n.oid,'USAGE')
  OR pg_catalog.has_schema_privilege('nextera_web',n.oid,'CREATE')
  OR pg_catalog.has_function_privilege('nextera_web',p.oid,'EXECUTE')
  OR pg_catalog.has_table_privilege('nextera_web',c.oid,'SELECT')
  OR pg_catalog.has_table_privilege('nextera_web',c.oid,'INSERT')
  OR pg_catalog.has_table_privilege('nextera_web',c.oid,'UPDATE')
  OR pg_catalog.has_table_privilege('nextera_web',c.oid,'DELETE')
  OR pg_catalog.has_table_privilege('nextera_web',c.oid,'TRUNCATE')
  OR pg_catalog.has_table_privilege('nextera_web',c.oid,'REFERENCES')
  OR pg_catalog.has_table_privilege('nextera_web',c.oid,'TRIGGER')
  OR pg_catalog.pg_has_role('nextera_web',a.oid,'SET')
  OR pg_catalog.pg_has_role('nextera_web',p.proowner,'SET')) AS no_web_access
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
JOIN pg_catalog.pg_roles o ON o.oid=p.proowner JOIN pg_catalog.pg_language l ON l.oid=p.prolang
CROSS JOIN a JOIN pg_catalog.pg_class c ON c.oid='checkpoint_rehearsal.migration_context_audit'::pg_catalog.regclass
WHERE p.oid='checkpoint_rehearsal.lock_migration_catalogs()'::pg_catalog.regprocedure`;
export const MIGRATION_LOCK_PROOF_SQL = `SELECT pg_catalog.pg_backend_pid() AS pid,
 pg_catalog.pg_current_xact_id()::text AS transaction_id,
 (SELECT count(DISTINCT relation)=2 FROM pg_catalog.pg_locks WHERE pid=pg_catalog.pg_backend_pid()
  AND locktype='relation' AND database=0 AND granted AND mode='ShareRowExclusiveLock'
  AND relation IN('pg_catalog.pg_authid'::pg_catalog.regclass,'pg_catalog.pg_auth_members'::pg_catalog.regclass)) AS locks_held`;
export const MIGRATION_FACTS_SQL = `WITH a AS (SELECT * FROM pg_catalog.pg_roles WHERE rolname=current_user),
 o AS (SELECT * FROM pg_catalog.pg_roles WHERE rolname='nextera_checkpoint_owner'),
 w AS (SELECT * FROM pg_catalog.pg_roles WHERE rolname='nextera_web')
SELECT pg_catalog.jsonb_build_object('database',current_database(),'currentUser',current_user,'sessionUser',session_user,
 'principalOid',a.oid::bigint,'ownerOid',o.oid::bigint,'webOid',w.oid::bigint,
 'transactionId',pg_catalog.pg_current_xact_id()::text,'graphComplete',true,
 'membershipOptionsSupported',current_setting('server_version_num')::integer>=160000,
 'ownerName',o.rolname,'ownerSafe',NOT(o.rolcanlogin OR o.rolsuper OR o.rolbypassrls OR o.rolcreatedb OR o.rolcreaterole OR o.rolreplication)
  AND NOT EXISTS(SELECT FROM pg_catalog.pg_auth_members WHERE member=o.oid),
 'webCanSetOwner',pg_catalog.pg_has_role(w.oid,o.oid,'SET'),'webCanInheritOwner',pg_catalog.pg_has_role(w.oid,o.oid,'USAGE'),
 'principalCanSetOwner',pg_catalog.pg_has_role(a.oid,o.oid,'SET'),
 'grantAuthority',CASE WHEN a.rolsuper THEN 'superuser' WHEN EXISTS(SELECT FROM pg_catalog.pg_auth_members WHERE roleid=o.oid AND member=a.oid AND admin_option) THEN 'admin_option' ELSE 'none' END,
 'memberships',coalesce((SELECT jsonb_agg(jsonb_build_object('roleOid',roleid::bigint,'memberOid',member::bigint,'grantorOid',grantor::bigint,
 'admin',admin_option,'inherit',inherit_option,'set',set_option) ORDER BY roleid,member,grantor)
 FROM pg_catalog.pg_auth_members WHERE roleid=o.oid),'[]'::jsonb)) AS data FROM a CROSS JOIN o CROSS JOIN w`;
const AUDIT_SQL = `INSERT INTO checkpoint_rehearsal.migration_context_audit(scope_sha256,transaction_id,actor_name,event_sequence,event_json,recorded_at)
 VALUES($1,pg_catalog.pg_current_xact_id()::text,session_user,$2,$3::jsonb,pg_catalog.clock_timestamp())`;

export function createCheckpointMigrationPostgresRepository(client, options) {
  const prepared = prepareCheckpointDraftMigration(options?.policy, options?.drafts),
    policy = prepared.policy;
  const guard = buildMigrationCatalogGuard(options?.guard),
    limits = options?.limits,
    clock = options?.clock;
  if (
    !client ||
    typeof client.begin !== 'function' ||
    client.options?.prepare !== false ||
    guard.database !== policy.database ||
    guard.principal !== policy.principal ||
    !limits ||
    !['statementMs', 'lockMs', 'idleMs', 'checkpointBudgetMs', 'deadlineMs'].every((k) =>
      positive(limits[k]),
    ) ||
    limits.statementMs > guard.maximumStatementMs ||
    limits.idleMs > guard.maximumIdleMs ||
    !clock ||
    typeof clock.nowMs !== 'function' ||
    typeof clock.monotonicMs !== 'function'
  )
    throw new MigrationContextError('POLICY_REQUIRED');
  const bound = Object.freeze({ ...limits });
  return Object.freeze({
    async transaction(work) {
      // Admission/between-query budget, NOT cancellation of an in-flight SQL batch.
      // A separately supervised caller must enforce an overall runtime deadline.
      const wallEnd = bound.deadlineMs,
        monoEnd = clock.monotonicMs() + Math.min(bound.checkpointBudgetMs, wallEnd - clock.nowMs());
      let stage = 'begin',
        active = false,
        finished = false,
        expectedResult;
      const budget = () => {
        const remaining = Math.floor(
          Math.min(wallEnd - clock.nowMs(), monoEnd - clock.monotonicMs()),
        );
        if (!positive(remaining)) reject();
        return remaining;
      };
      try {
        budget();
        const result = await client.begin(ISOLATION, async (sql) => {
          active = true;
          let locked = false,
            baseline = null,
            introduced = null,
            applied = 0,
            sequence = 0,
            busy = false,
            proof = null;
          const raw = async (text, params = []) => {
            if (!active) reject();
            budget();
            return sql.unsafe(text, params);
          };
          const query = async (text, params = []) => {
            const remaining = budget();
            await raw(
              "SELECT pg_catalog.set_config('statement_timeout',$1,true),pg_catalog.set_config('lock_timeout',$2,true),pg_catalog.set_config('idle_in_transaction_session_timeout',$3,true),pg_catalog.set_config('search_path','pg_catalog,pg_temp',true)",
              [
                Math.min(bound.statementMs, remaining) + 'ms',
                Math.min(bound.lockMs, remaining) + 'ms',
                Math.min(bound.idleMs, remaining) + 'ms',
              ],
            );
            return raw(text, params);
          };
          const inspect = async () => {
            if (!locked) reject();
            const rows = await query(MIGRATION_FACTS_SQL);
            if (rows.length !== 1) reject();
            const facts = validateCheckpointMigrationFacts(rows[0].data, policy);
            if (facts.transactionId !== proof.transaction_id) reject();
            return facts;
          };
          const exclusive =
            (fn) =>
            async (...args) => {
              if (busy || !active) reject();
              busy = true;
              try {
                return await fn(...args);
              } finally {
                busy = false;
              }
            };
          const tx = {
            lockOwnerMemberships: exclusive(async (role) => {
              if (role !== CHECKPOINT_CONTEXT_OWNER || locked) reject();
              stage = 'guard_attestation';
              const attest = async () => {
                const rows = await query(MIGRATION_GUARD_ATTEST_SQL),
                  g = rows[0];
                if (
                  rows.length !== 1 ||
                  !g ||
                  hash(g.body) !== guard.bodySha256 ||
                  g.database !== policy.database ||
                  g.actor !== policy.principal ||
                  g.session_actor !== policy.principal ||
                  g.owner !== guard.guardOwner ||
                  g.owner_super !== true ||
                  Math.floor(g.server_version / 10000) !== guard.serverMajor ||
                  g.arguments !== 0 ||
                  g.kind !== 'f' ||
                  g.definer !== true ||
                  g.returns_set !== false ||
                  g.returns_json !== true ||
                  g.language !== 'plpgsql' ||
                  !Array.isArray(g.config) ||
                  g.config.length !== 1 ||
                  !/^search_path=pg_catalog,\s*pg_temp$/.test(g.config[0]) ||
                  ![
                    'schema_owner',
                    'schema_usage',
                    'no_schema_create',
                    'function_acl_safe',
                    'schema_acl_safe',
                    'audit_owner',
                    'audit_acl_safe',
                    'can_execute',
                    'can_audit',
                    'no_web_access',
                  ].every((k) => g[k] === true)
                )
                  reject();
              };
              await attest();
              stage = 'catalog_lock';
              const response = await query('SELECT ' + GUARD + '() AS proof');
              const actual = await query(MIGRATION_LOCK_PROOF_SQL);
              proof = actual[0];
              if (
                response.length !== 1 ||
                actual.length !== 1 ||
                proof.locks_held !== true ||
                !positive(proof.pid) ||
                !/^\d+$/.test(proof.transaction_id) ||
                response[0].proof?.pid !== proof.pid ||
                response[0].proof?.transactionId !== proof.transaction_id
              )
                reject();
              await attest();
              locked = true;
              baseline = await inspect();
            }),
            inspect: exclusive(async () => {
              stage = 'facts';
              return inspect();
            }),
            grantSelf: exclusive(async (row) => {
              stage = 'grant';
              const f = await inspect();
              if (
                policy.mode !== 'temporary_self_membership' ||
                introduced ||
                applied !== 0 ||
                f.principalCanSetOwner ||
                f.grantAuthority !== 'admin_option' ||
                !f.memberships.some((m) => m.memberOid === f.principalOid && m.admin) ||
                f.memberships.some(
                  (m) => m.memberOid === f.principalOid && m.grantorOid === f.principalOid,
                ) ||
                row.roleOid !== f.ownerOid ||
                row.memberOid !== f.principalOid ||
                row.grantorOid !== f.principalOid ||
                row.admin !== false ||
                row.inherit !== false ||
                row.set !== true
              )
                reject();
              await query(
                'GRANT ' +
                  quote(CHECKPOINT_CONTEXT_OWNER) +
                  ' TO ' +
                  quote(policy.principal) +
                  ' WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY ' +
                  quote(policy.principal),
              );
              introduced = Object.freeze({ ...row });
            }),
            applyDraft: exclusive(async (draft) => {
              stage = 'draft';
              const expected = prepared.bodies[applied];
              if (
                !locked ||
                !expected ||
                draft.file !== expected.file ||
                draft.sha256 !== expected.sha256 ||
                draft.body !== expected.body ||
                !(await inspect()).principalCanSetOwner
              )
                reject();
              await query(expected.body);
              applied++;
            }),
            revokeIntroduced: exclusive(async (row) => {
              stage = 'revoke';
              if (
                !introduced ||
                applied !== 2 ||
                JSON.stringify(row) !== JSON.stringify(introduced)
              )
                reject();
              await query(
                'REVOKE ' +
                  quote(CHECKPOINT_CONTEXT_OWNER) +
                  ' FROM ' +
                  quote(policy.principal) +
                  ' GRANTED BY ' +
                  quote(policy.principal) +
                  ' RESTRICT',
              );
              introduced = null;
            }),
            audit: exclusive(async (event) => {
              stage = 'audit';
              const keys = new Set([
                'sequence',
                'kind',
                'atMs',
                'approvedScopeSha256',
                'principal',
                'transactionId',
                'ownerRole',
                'initialMemberships',
                'grant',
                'file',
                'sha256',
                'memberships',
              ]);
              const kinds = new Set([
                'context_checked',
                'temporary_grant_requested',
                'temporary_grant_verified',
                'draft_started',
                'draft_applied',
                'temporary_revoke_requested',
                'context_restored',
              ]);
              if (
                !locked ||
                !event ||
                Object.keys(event).some((k) => !keys.has(k)) ||
                !kinds.has(event.kind) ||
                !Number.isSafeInteger(event.atMs) ||
                event.atMs < 0 ||
                event.approvedScopeSha256 !== policy.approvedScopeSha256 ||
                event.sequence !== sequence + 1 ||
                (Object.hasOwn(event, 'principal') && event.principal !== policy.principal) ||
                (Object.hasOwn(event, 'transactionId') &&
                  event.transactionId !== proof.transaction_id) ||
                (Object.hasOwn(event, 'ownerRole') &&
                  event.ownerRole !== CHECKPOINT_CONTEXT_OWNER) ||
                (Object.hasOwn(event, 'file') &&
                  !prepared.bodies.some(
                    (d) => d.file === event.file && d.sha256 === event.sha256,
                  )) ||
                ['initialMemberships', 'memberships'].some(
                  (k) =>
                    Object.hasOwn(event, k) &&
                    JSON.stringify(event[k]) !== JSON.stringify(baseline.memberships),
                )
              )
                reject();
              if (Object.hasOwn(event, 'grant')) {
                const row = event.grant;
                if (
                  !row ||
                  Object.keys(row).sort().join() !==
                    'admin,grantorOid,inherit,memberOid,roleOid,set' ||
                  row.roleOid !== baseline.ownerOid ||
                  row.memberOid !== baseline.principalOid ||
                  row.grantorOid !== baseline.principalOid ||
                  row.admin !== false ||
                  row.inherit !== false ||
                  row.set !== true
                )
                  reject();
              }
              await query(AUDIT_SQL, [
                policy.approvedScopeSha256,
                event.sequence,
                JSON.stringify(event),
              ]);
              sequence++;
            }),
          };
          try {
            expectedResult = await work(Object.freeze(tx));
            stage = 'restore_check';
            const after = await inspect();
            if (introduced || applied !== 2 || JSON.stringify(after) !== JSON.stringify(baseline))
              reject();
            budget();
            finished = true;
            stage = 'commit';
            return expectedResult;
          } finally {
            active = false;
          }
        });
        stage = 'commit';
        if (!positive(Math.floor(Math.min(wallEnd - clock.nowMs(), monoEnd - clock.monotonicMs()))))
          throw new MigrationContextError('COMMIT_UNCERTAIN');
        if (!finished || result !== expectedResult)
          throw new MigrationContextError('COMMIT_UNCERTAIN');
        return { commitAcknowledged: true, value: result };
      } catch (error) {
        const sqlstate =
          ['ERROR', 'FATAL'].includes(error?.severity) && /^[0-9A-Z]{5}$/.test(error?.code)
            ? error.code
            : null;
        const diagnostic = { stage, sqlstate };
        throw new MigrationContextError(
          error instanceof MigrationContextError
            ? error.code
            : finished
              ? 'COMMIT_UNCERTAIN'
              : 'TRANSACTION_FAILED',
          [],
          diagnostic,
        );
      }
    },
  });
}
