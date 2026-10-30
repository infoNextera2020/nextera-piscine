/* Explicitly gated future private-PG runner. Import performs no I/O or connection. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import {
  buildMigrationCatalogGuard,
  createCheckpointMigrationPostgresRepository,
  MIGRATION_FACTS_SQL,
  MIGRATION_GUARD_ATTEST_SQL,
} from './checkpoint-migration-postgres.mjs';
import {
  CHECKPOINT_CONTEXT_DRAFTS,
  prepareCheckpointDraftMigration,
  withCheckpointDraftMigrationContext,
} from './checkpoint-migration-context.mjs';

export const TARGET =
  '/home/anas/.local/share/nextera-judge/checkpoint-migration-adapter-20261029/run-001';
export const DATABASE = 'foundation_test_checkpoint_migration_adapter_20261029';
export const RUNTIME_BLOCKERS = Object.freeze([
  'registered_prerequisite_acl_authority_requires_review',
]);
const ACTOR = 'checkpoint_migration_actor_20261029',
  PROBE = 'checkpoint_migration_probe_20261029';
const ROLES = [
  'nextera_web',
  'nextera_judge_owner',
  'nextera_runner',
  'nextera_judge_maintenance',
  'nextera_result_application',
  'nextera_checkpoint_owner',
  'nextera_raid_owner',
  ACTOR,
  PROBE,
];
export const CASE_ORDER = Object.freeze([
  'wrong_identity',
  'probe_acl_rejection',
  'second_ddl_rollback',
  'audit_rollback',
  'catalog_contention_and_rollback_release',
  'disconnect_release',
  'single_commit_last',
]);
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const quote = (v) => {
  assert.match(v, /^[a-z_][a-z0-9_]{0,62}$/);
  return '"' + v + '"';
};
const expectedAbort = () => {
  throw new Error('EXPECTED_REHEARSAL_ABORT');
};

// The driver reserves one physical connection for begin's callback. Bind identity
// there on EVERY transaction, including reconnects; never use a one-time pool SET.
// LOCAL restores bootstrap identity at commit/rollback. Only the synthetic actor
// or probe is accepted, and no test SQL runs until both identities are verified.
export function bindRoleTransactions(client, role) {
  assert.ok([ACTOR, PROBE].includes(role));
  assert.equal(client.options?.prepare, false);
  const begin = async (isolation, work) => {
    assert.equal(isolation, 'isolation level read committed');
    return client.begin(isolation, async (sql) => {
      await sql.unsafe('SET LOCAL SESSION AUTHORIZATION ' + quote(role));
      const rows = await sql.unsafe(
        'SELECT current_user::text AS actor,session_user::text AS session_actor',
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].actor, role);
      assert.equal(rows[0].session_actor, role);
      return work(sql);
    });
  };
  return Object.freeze({
    options: client.options,
    begin,
    unsafe: (text, params = []) => {
      assert.ok(
        !/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(text),
        'Unexpected transaction envelope',
      );
      return begin('isolation level read committed', (sql) => sql.unsafe(text, params));
    },
    end: (options) => client.end(options),
  });
}

export const DRAFT_FUNCTIONS = Object.freeze([
  ['app.checkpoint_draft_record(app.checkpoint_draft_revisions)', false],
  ['app.guard_checkpoint_draft_revision()', false],
  ['app.guard_checkpoint_draft_policy()', false],
  ['app.checkpoint_draft_context(uuid,uuid,text)', true],
  ['app.read_checkpoint_draft(uuid,uuid,text,text,uuid)', true],
  ['app.save_checkpoint_draft(uuid,uuid,text,text,uuid,bigint,bytea,text)', true],
  ['app.purge_expired_checkpoint_drafts(timestamptz,integer)', false],
  ['app.checkpoint_editor_context(uuid,uuid,text)', true],
]);
export const FUNCTION_ACL_SQL = `SELECT o.rolname AS owner,
 NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0) AS no_public,
 pg_catalog.has_function_privilege('nextera_web',p.oid,'EXECUTE') AS web_execute,
 NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 WHERE a.grantee<>p.proowner AND (a.privilege_type<>'EXECUTE' OR a.is_grantable)) AS execute_only,
 coalesce((SELECT jsonb_agg(DISTINCT r.rolname ORDER BY r.rolname) FROM
 pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner),'[]'::jsonb) AS grantees
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles o ON o.oid=p.proowner WHERE p.oid=pg_catalog.to_regprocedure($1)`;
export async function assertFunctionAcls(sql, specs) {
  for (const [signature, owner, allowWeb, extra = []] of specs) {
    const expected = [...(allowWeb ? ['nextera_web'] : []), ...extra].sort();
    const rows = await sql.unsafe(FUNCTION_ACL_SQL, [signature]);
    assert.equal(rows.length, 1, 'Missing expected function ' + signature);
    const row = rows[0];
    assert.equal(row.owner, owner, signature);
    assert.equal(row.no_public, true, signature);
    assert.equal(row.web_execute, allowWeb, signature);
    assert.equal(row.execute_only, true, signature);
    assert.deepEqual(row.grantees, expected, signature);
  }
}
export const PREREQUISITE_FUNCTIONS = Object.freeze([
  ['app.submission_context(uuid,uuid,text)', 'nextera_judge_owner', true, ['nextera_raid_owner']],
  [
    'app.accept_submission(uuid,uuid,text,uuid,text,bigint,text)',
    'nextera_judge_owner',
    true,
    ['nextera_raid_owner'],
  ],
  ['app.read_submissions(uuid,uuid,text)', 'nextera_judge_owner', true],
  ...[
    'claim_job()',
    'renew_lease(uuid,uuid,uuid,bigint)',
    'heartbeat()',
    'record_execution_attempt(uuid,uuid,uuid,bigint)',
    'record_result(uuid,uuid,uuid,bigint,text,jsonb)',
    'record_infrastructure_failure(uuid,uuid,uuid,bigint,text)',
  ].map((s) => ['judge.' + s, 'nextera_judge_owner', false, ['nextera_runner']]),
  ['judge.recover_expired(integer)', 'nextera_judge_owner', false, ['nextera_judge_maintenance']],
  ['app.start_checkpoint(uuid,uuid,text,uuid)', 'nextera_checkpoint_owner', true],
  ['app.finish_checkpoint(uuid,uuid)', 'nextera_checkpoint_owner', true],
  ['app.checkpoint_task_context(uuid,uuid,text)', 'nextera_checkpoint_owner', true],
  [
    'app.accept_checkpoint_submission(uuid,uuid,text,uuid,text,bigint,text)',
    'nextera_checkpoint_owner',
    true,
  ],
  ['app.read_checkpoint(uuid,uuid,text)', 'nextera_checkpoint_owner', true],
  ['app.grant_checkpoint_replacement(uuid,uuid)', 'nextera_checkpoint_owner', true],
  [
    'app.finalize_checkpoint(uuid)',
    'nextera_checkpoint_owner',
    false,
    ['nextera_result_application'],
  ],
  [
    'app.announce_checkpoint_retake(uuid)',
    'nextera_checkpoint_owner',
    false,
    ['nextera_result_application'],
  ],
  ['app.assign_raid_team(uuid,uuid,text,uuid,text,uuid,uuid[])', 'nextera_raid_owner', true],
  ['app.accept_raid_submission(uuid,uuid,text,uuid,text,bigint,text)', 'nextera_raid_owner', true],
  ['app.read_raid(uuid,uuid,text,uuid)', 'nextera_raid_owner', true],
  ['app.raid_review_queue(uuid)', 'nextera_raid_owner', true],
  ['app.review_raid(uuid,uuid,uuid,text,text)', 'nextera_raid_owner', true],
  ['app.raid_artifact_context(uuid,uuid)', 'nextera_raid_owner', true],
  [
    'app.apply_raid_automated_result(uuid)',
    'nextera_raid_owner',
    false,
    ['nextera_result_application'],
  ],
]);

export async function runOrderedCases(operations, timeoutMs = 15000) {
  assert.deepEqual(Object.keys(operations).sort(), [...CASE_ORDER].sort());
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000);
  const evidence = [];
  for (const name of CASE_ORDER) {
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => operations[name]()),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('CASE_TIMEOUT')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    evidence.push({ name, passed: true });
  }
  return evidence;
}
export function validateControl(r, nowMs) {
  assert.equal(r.target, TARGET);
  assert.equal(r.database, DATABASE);
  assert.equal(r.port, '55451');
  assert.equal(r.bootstrap, 'anas');
  assert.equal(r.actor, ACTOR);
  assert.equal(r.probe, PROBE);
  assert.match(r.scope_sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.approval.scope_sha256, r.scope_sha256);
  assert.equal(r.deadline, r.created + 1800);
  assert.equal(r.cleanup_at, r.deadline - 180);
  assert.ok(Number.isFinite(r.created) && nowMs / 1000 >= r.created && nowMs / 1000 < r.cleanup_at);
  assert.equal(r.uid, process.getuid());
  assert.ok(r.sources && Object.keys(r.sources).length > 20);
  for (const [name, digest] of Object.entries(r.sources)) {
    assert.ok(!path.isAbsolute(name) && !name.split('/').includes('..') && !name.includes('\\'));
    assert.match(digest, /^[0-9a-f]{64}$/);
  }
}
function privateFile(file, directory = false) {
  const s = fs.lstatSync(file);
  assert.equal(s.uid, process.getuid());
  assert.equal(s.mode & 0o777, directory ? 0o700 : 0o600);
  assert.ok(directory ? s.isDirectory() : s.isFile());
  assert.ok(!s.isSymbolicLink());
}
function sourceBytes(r, name) {
  const file = path.join(TARGET, 'snapshot', name);
  assert.ok(Object.hasOwn(r.sources, name));
  assert.ok(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
  const bytes = fs.readFileSync(file);
  assert.equal(hash(bytes), r.sources[name]);
  return bytes;
}
const GRAPH_SQL = `SELECT coalesce(jsonb_agg(jsonb_build_object('role',roleid::bigint,'member',member::bigint,
 'grantor',grantor::bigint,'admin',admin_option,'inherit',inherit_option,'set',set_option)
 ORDER BY roleid,member,grantor),'[]'::jsonb) AS graph FROM pg_catalog.pg_auth_members
 WHERE roleid=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='nextera_checkpoint_owner')`;
const ACL_SQL = `SELECT n.nspacl::text AS schema_acl,p.proacl::text AS function_acl,c.relacl::text AS table_acl
 FROM pg_catalog.pg_namespace n,pg_catalog.pg_proc p,pg_catalog.pg_class c
 WHERE n.oid='checkpoint_rehearsal'::regnamespace
 AND p.oid='checkpoint_rehearsal.lock_migration_catalogs()'::regprocedure
 AND c.oid='checkpoint_rehearsal.migration_context_audit'::regclass`;

export async function executePreparedRunner(record, postgres) {
  assert.equal(
    RUNTIME_BLOCKERS.length,
    0,
    'Prerequisite authority repair is not approved/implemented',
  );
  validateControl(record, Date.now());
  privateFile(TARGET, true);
  privateFile(path.join(TARGET, 's'), true);
  assert.ok(!fs.existsSync(path.join(TARGET, 'evidence/cleanup.json')));
  for (const name of Object.keys(record.sources)) sourceBytes(record, name);
  const clients = [];
  const connect = () => {
    const client = postgres({
      host: path.join(TARGET, 's'),
      port: 55451,
      database: DATABASE,
      username: 'anas',
      password: '',
      ssl: false,
      max: 1,
      prepare: false,
      connect_timeout: 3,
      idle_timeout: 3,
      max_lifetime: 60,
      onnotice: () => {},
    });
    clients.push(client);
    return client;
  };
  const admin = connect(),
    observer = connect();
  let actor,
    contender,
    phase = 'target',
    guard,
    result,
    cleanup = { guard_removed: false, roles_disabled: false };
  const checkTime = () =>
    assert.ok(Date.now() / 1000 < record.cleanup_at, 'REHEARSAL_CLEANUP_WINDOW');
  const end = async (c) => c.end({ timeout: 1 });
  const auditState = async () => {
    const [row] =
      await observer.unsafe(`SELECT to_regclass('app.checkpoint_draft_revisions')::text AS drafts,
      to_regprocedure('app.checkpoint_editor_context(uuid,uuid,text)')::text AS editor,
      (SELECT count(*)::integer FROM checkpoint_rehearsal.migration_context_audit) AS audits`);
    return { ...row };
  };
  try {
    const [target] = await admin.unsafe(
      "SELECT current_database() AS database,current_setting('data_directory') AS directory,current_setting('listen_addresses') AS listen,current_user AS actor,session_user AS session",
    );
    assert.deepEqual(
      { ...target },
      {
        database: DATABASE,
        directory: path.join(TARGET, 'data'),
        listen: '',
        actor: 'anas',
        session: 'anas',
      },
    );
    phase = 'prerequisites';
    checkTime();
    await admin.unsafe(`CREATE ROLE ${quote(ACTOR)} NOLOGIN NOINHERIT CREATEROLE NOSUPERUSER NOCREATEDB NOBYPASSRLS NOREPLICATION;
      CREATE ROLE ${quote(PROBE)} NOLOGIN NOINHERIT NOCREATEROLE NOSUPERUSER NOCREATEDB NOBYPASSRLS NOREPLICATION;
      ALTER DATABASE ${quote(DATABASE)} OWNER TO ${quote(ACTOR)};
      CREATE SCHEMA auth AUTHORIZATION ${quote(ACTOR)};
      CREATE TABLE auth.users(id uuid PRIMARY KEY);ALTER TABLE auth.users OWNER TO ${quote(ACTOR)};`);
    actor = bindRoleTransactions(connect(), ACTOR);
    const journal = JSON.parse(sourceBytes(record, 'packages/db/migrations/meta/_journal.json'));
    assert.deepEqual(
      journal.entries.map((e) => e.idx),
      Array.from({ length: 11 }, (_, i) => i),
    );
    for (const entry of journal.entries) {
      checkTime();
      await actor.unsafe(
        sourceBytes(record, 'packages/db/migrations/' + entry.tag + '.sql').toString('utf8'),
      );
    }
    await admin.unsafe('ALTER ROLE ' + quote(ACTOR) + ' NOCREATEROLE');
    await assertFunctionAcls(observer, PREREQUISITE_FUNCTIONS);
    const roles = await admin.unsafe(
      "SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolreplication FROM pg_catalog.pg_roles WHERE rolname !~ '^pg_' AND rolname<>'anas' ORDER BY rolname",
    );
    assert.deepEqual(
      roles.map((v) => v.rolname),
      [...ROLES].sort(),
    );
    assert.ok(
      roles.every(
        (v) =>
          !v.rolcanlogin &&
          !v.rolsuper &&
          !v.rolcreatedb &&
          !v.rolcreaterole &&
          !v.rolbypassrls &&
          !v.rolreplication,
      ),
    );
    assert.equal(
      (
        await admin.unsafe(
          'SELECT count(*)::integer AS n FROM pg_catalog.pg_authid WHERE rolpassword IS NOT NULL',
        )
      )[0].n,
      0,
    );
    const before = (await actor.unsafe(MIGRATION_FACTS_SQL))[0].data;
    assert.equal(before.principalCanSetOwner, false);
    assert.equal(before.grantAuthority, 'admin_option');
    assert.ok(
      before.memberships.some(
        (m) => m.memberOid === before.principalOid && m.admin && !m.set && !m.inherit,
      ),
    );
    guard = buildMigrationCatalogGuard({
      database: DATABASE,
      principal: ACTOR,
      guardOwner: 'anas',
      serverMajor: 16,
      maximumStatementMs: 5000,
      maximumIdleMs: 5000,
    });
    phase = 'guard_setup';
    await admin.unsafe(guard.setupSql);
    contender = bindRoleTransactions(connect(), ACTOR);
    const baselineGraph = (await observer.unsafe(GRAPH_SQL))[0].graph;
    const baselineAcl = { ...(await observer.unsafe(ACL_SQL))[0] };
    const drafts = CHECKPOINT_CONTEXT_DRAFTS.map((file) => ({
      file,
      bytes: sourceBytes(record, 'packages/db/migration-drafts/' + file),
    }));
    const policy = {
      version: 1,
      approvedScopeSha256: record.scope_sha256,
      database: DATABASE,
      principal: ACTOR,
      mode: 'temporary_self_membership',
      draftSha256: Object.fromEntries(drafts.map((d) => [d.file, hash(d.bytes)])),
    };
    const secondBody = prepareCheckpointDraftMigration(policy, drafts).bodies[1].body;
    const options = () => ({
      policy,
      drafts,
      guard,
      limits: {
        statementMs: 2000,
        lockMs: 1000,
        idleMs: 3000,
        checkpointBudgetMs: 20000,
        deadlineMs: Math.min(Date.now() + 20000, record.cleanup_at * 1000),
      },
      clock: { nowMs: Date.now, monotonicMs: () => performance.now() },
    });
    const run = (client = actor) =>
      withCheckpointDraftMigrationContext(
        createCheckpointMigrationPostgresRepository(client, options()),
        policy,
        drafts,
        { nowMs: Date.now },
      );
    const unchanged = async () => {
      assert.deepEqual((await observer.unsafe(GRAPH_SQL))[0].graph, baselineGraph);
      assert.deepEqual(await auditState(), { drafts: null, editor: null, audits: 0 });
      assert.deepEqual({ ...(await observer.unsafe(ACL_SQL))[0] }, baselineAcl);
    };
    const rollbackProbe = async () => {
      await assert.rejects(
        contender.begin('isolation level read committed', async (q) => {
          await q.unsafe(
            "SET LOCAL statement_timeout='2000ms';SET LOCAL idle_in_transaction_session_timeout='3000ms'",
          );
          await q.unsafe('SELECT checkpoint_rehearsal.lock_migration_catalogs()');
          expectedAbort();
        }),
        /EXPECTED_REHEARSAL_ABORT/,
      );
    };
    const decorate = (failure) => ({
      options: actor.options,
      begin: (isolation, work) =>
        actor.begin(isolation, (sql) =>
          work({
            unsafe: (text, params) => {
              if (failure === 'second' && text === secondBody)
                throw new Error('EXPECTED_SECOND_DDL_FAILURE');
              if (
                failure === 'audit' &&
                text.startsWith('INSERT INTO checkpoint_rehearsal.migration_context_audit') &&
                JSON.parse(params[2]).kind === 'draft_applied'
              )
                throw new Error('EXPECTED_AUDIT_FAILURE');
              return sql.unsafe(text, params);
            },
          }),
        ),
    });
    const operations = {
      wrong_identity: async () => {
        const wrong = bindRoleTransactions(connect(), PROBE);
        try {
          await assert.rejects(run(wrong));
        } finally {
          await end(wrong);
        }
        await unchanged();
      },
      probe_acl_rejection: async () => {
        for (const [kind, object, right] of [
          ['SCHEMA', 'checkpoint_rehearsal', 'USAGE'],
          ['TABLE', 'checkpoint_rehearsal.migration_context_audit', 'INSERT'],
          ['FUNCTION', 'checkpoint_rehearsal.lock_migration_catalogs()', 'EXECUTE'],
        ]) {
          await admin.unsafe(`GRANT ${right} ON ${kind} ${object} TO ${quote(PROBE)}`);
          try {
            await assert.rejects(run());
          } finally {
            await admin.unsafe(
              `REVOKE ${right} ON ${kind} ${object} FROM ${quote(PROBE)} RESTRICT`,
            );
          }
          await unchanged();
        }
      },
      second_ddl_rollback: async () => {
        await assert.rejects(run(decorate('second')));
        await unchanged();
      },
      audit_rollback: async () => {
        await assert.rejects(run(decorate('audit')));
        await unchanged();
      },
      catalog_contention_and_rollback_release: async () => {
        await assert.rejects(
          createCheckpointMigrationPostgresRepository(actor, options()).transaction(async (tx) => {
            await tx.lockOwnerMemberships('nextera_checkpoint_owner');
            await assert.rejects(
              contender.begin('isolation level read committed', async (q) => {
                await q.unsafe(
                  "SET LOCAL statement_timeout='2000ms';SET LOCAL idle_in_transaction_session_timeout='3000ms'",
                );
                await q.unsafe('SELECT checkpoint_rehearsal.lock_migration_catalogs()');
              }),
              (e) => e.code === '55P03',
            );
            await assert.rejects(
              admin.begin('isolation level read committed', async (q) => {
                await q.unsafe(
                  "SET LOCAL lock_timeout='250ms';SET LOCAL statement_timeout='2000ms'",
                );
                await q.unsafe(
                  'GRANT nextera_checkpoint_owner TO ' +
                    quote(PROBE) +
                    ' WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY "anas"',
                );
              }),
              (e) => e.code === '55P03',
            );
            expectedAbort();
          }),
        );
        await unchanged();
        await rollbackProbe();
      },
      disconnect_release: async () => {
        const disconnected = bindRoleTransactions(connect(), ACTOR);
        let ready, release;
        const reached = new Promise((r) => (ready = r)),
          gate = new Promise((r) => (release = r));
        const pending = disconnected.begin('isolation level read committed', async (q) => {
          await q.unsafe(
            "SET LOCAL statement_timeout='2000ms';SET LOCAL idle_in_transaction_session_timeout='3000ms'",
          );
          await q.unsafe('SELECT checkpoint_rehearsal.lock_migration_catalogs()');
          ready();
          await gate;
          expectedAbort();
        });
        // Observe rejection immediately; do not leave a rejected promise unhandled.
        const rejected = assert.rejects(pending);
        try {
          await Promise.race([reached, pending]);
          await disconnected.end({ timeout: 0 });
        } finally {
          release();
          await rejected;
        }
        await rollbackProbe();
        await unchanged();
      },
      single_commit_last: async () => {
        const receipt = await run();
        assert.equal(receipt.state, 'adapter_commit_acknowledged');
        assert.deepEqual((await observer.unsafe(GRAPH_SQL))[0].graph, baselineGraph);
        const state = await auditState();
        assert.ok(state.drafts && state.editor && state.audits > 0);
        const facts = (await actor.unsafe(MIGRATION_FACTS_SQL))[0].data;
        assert.equal(facts.principalCanSetOwner, false);
        assert.equal(facts.webCanSetOwner, false);
        assert.equal(facts.webCanInheritOwner, false);
        assert.equal((await actor.unsafe(MIGRATION_GUARD_ATTEST_SQL))[0].no_web_access, true);
        await assertFunctionAcls(
          observer,
          DRAFT_FUNCTIONS.map(([signature, web]) => [signature, 'nextera_checkpoint_owner', web]),
        );
        for (const table of ['checkpoint_draft_policies', 'checkpoint_draft_revisions']) {
          const rows = await observer.unsafe(
            `SELECT o.rolname AS owner,c.relrowsecurity AS rls,
            NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner) AS owner_only_acl,
            NOT pg_catalog.has_table_privilege('nextera_web',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_web
            FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles o ON o.oid=c.relowner WHERE c.oid=pg_catalog.to_regclass($1)`,
            ['app.' + table],
          );
          assert.equal(rows.length, 1);
          assert.deepEqual(
            { ...rows[0] },
            { owner: 'nextera_checkpoint_owner', rls: true, owner_only_acl: true, no_web: true },
          );
        }
        const [counts] = await observer.unsafe(
          'SELECT (SELECT count(*)::integer FROM app.submissions) AS submissions,(SELECT count(*)::integer FROM judge.jobs) AS jobs,(SELECT count(*)::integer FROM app.checkpoint_outcomes) AS outcomes',
        );
        assert.deepEqual({ ...counts }, { submissions: 0, jobs: 0, outcomes: 0 });
        await rollbackProbe();
      },
    };
    phase = 'cases';
    const cases = await runOrderedCases(
      Object.fromEntries(
        Object.entries(operations).map(([name, fn]) => [
          name,
          async () => {
            phase = name;
            checkTime();
            await fn();
          },
        ]),
      ),
    );
    result = {
      state: 'passed',
      scope_sha256: record.scope_sha256,
      cases,
      source_hashes: policy.draftSha256,
      real_postgres: true,
      retained_database_touched: false,
      existing_set_and_missing_admin_live: false,
      lost_ack_wire_fault: false,
    };
  } catch (error) {
    result = {
      state: 'failed',
      scope_sha256: record.scope_sha256,
      phase,
      sqlstate: /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : null,
      assertion_failure: error?.code === 'ERR_ASSERTION',
      raw_diagnostics_retained: false,
    };
  } finally {
    for (const c of clients.filter((c) => c !== admin)) await end(c).catch(() => {});
    try {
      const [f] = await admin.unsafe(
        "SELECT p.prosrc AS body,o.rolname AS owner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles o ON o.oid=p.proowner WHERE p.oid=to_regprocedure('checkpoint_rehearsal.lock_migration_catalogs()')",
      );
      if (f) {
        assert.ok(guard && hash(f.body) === guard.bodySha256 && f.owner === 'anas');
        await admin.unsafe(
          'REVOKE EXECUTE ON FUNCTION checkpoint_rehearsal.lock_migration_catalogs() FROM ' +
            quote(ACTOR) +
            ' RESTRICT;DROP FUNCTION checkpoint_rehearsal.lock_migration_catalogs()',
        );
      }
      cleanup.guard_removed = true;
      for (const role of [ACTOR, PROBE]) {
        const exists =
          (await admin.unsafe('SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=$1', [role]))
            .length === 1;
        if (exists) await admin.unsafe('ALTER ROLE ' + quote(role) + ' NOLOGIN NOCREATEROLE');
      }
      cleanup.roles_disabled =
        (
          await admin.unsafe(
            "SELECT count(*)::integer AS n FROM pg_catalog.pg_roles WHERE rolname !~ '^pg_' AND rolname<>'anas' AND (rolcanlogin OR rolcreaterole OR rolsuper OR rolbypassrls)",
          )
        )[0].n === 0;
    } catch {
      cleanup.guard_removed = false;
    }
    await end(admin).catch(() => {});
  }
  result.cleanup = cleanup;
  if (!cleanup.guard_removed || !cleanup.roles_disabled) result.state = 'failed';
  return result;
}
async function main() {
  assert.equal(
    RUNTIME_BLOCKERS.length,
    0,
    'Known prerequisite authority blocker; no runtime action allowed',
  );
  assert.equal(process.argv[2], '--execute-approved-private-rehearsal');
  assert.equal(process.argv[3], path.join(TARGET, 'control.json'));
  privateFile(process.argv[3]);
  const record = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  validateControl(record, Date.now());
  // Driver import occurs only after explicit execution/target/control validation.
  const { default: postgres } = await import('postgres');
  const result = await executePreparedRunner(record, postgres);
  fs.writeFileSync(
    path.join(TARGET, 'evidence/assertions.json'),
    JSON.stringify(result, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  process.exitCode = result.state === 'passed' ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write('Private adapter rehearsal failed; see protected receipts.\n');
    process.exitCode = 1;
  });
}
