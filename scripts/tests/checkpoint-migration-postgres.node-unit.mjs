import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  CHECKPOINT_CONTEXT_DRAFTS,
  MigrationContextError,
  prepareCheckpointDraftMigration,
  withCheckpointDraftMigrationContext,
} from '../checkpoint-migration-context.mjs';
import {
  buildMigrationCatalogGuard,
  createCheckpointMigrationPostgresRepository,
  MIGRATION_FACTS_SQL,
  MIGRATION_GUARD_ATTEST_SQL,
  MIGRATION_LOCK_PROOF_SQL,
} from '../checkpoint-migration-postgres.mjs';

const { structuredClone } = globalThis;
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
function fixture() {
  const drafts = CHECKPOINT_CONTEXT_DRAFTS.map((file) => ({
    file,
    bytes: Buffer.from(
      `-- ${file}\nBEGIN;\nDO $$ BEGIN IF NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET') THEN RAISE EXCEPTION 'required'; END IF; END $$;\nCOMMIT;\n`,
    ),
  }));
  const policy = {
    version: 1,
    approvedScopeSha256: 'a'.repeat(64),
    database: 'foundation_test_adapter',
    principal: 'migration_actor',
    mode: 'temporary_self_membership',
    draftSha256: Object.fromEntries(drafts.map((d) => [d.file, hash(d.bytes)])),
  };
  const guard = {
    database: policy.database,
    principal: policy.principal,
    guardOwner: 'bootstrap_owner',
    serverMajor: 16,
    maximumStatementMs: 5000,
    maximumIdleMs: 5000,
  };
  const f = {
    drafts,
    policy,
    guard,
    limits: {
      statementMs: 1000,
      lockMs: 500,
      idleMs: 1000,
      checkpointBudgetMs: 10000,
      deadlineMs: 11000,
    },
    wall: 1000,
    mono: 1000,
  };
  f.clock = { nowMs: () => f.wall, monotonicMs: () => f.mono };
  f.runtime = { nowMs: () => f.wall };
  f.client = new FakeClient(f);
  return f;
}
class FakeClient {
  constructor(f) {
    this.f = f;
    this.options = { prepare: false };
    this.beginCalls = 0;
    this.calls = [];
    this.rootCalls = 0;
    this.commits = 0;
    this.rollbacks = 0;
    this.attestReads = 0;
    this.mutateAttestation = null;
    this.mutateProof = null;
    this.mutateResponse = null;
    this.fail = null;
    this.state = {
      applied: [],
      audit: [],
      facts: {
        database: f.policy.database,
        currentUser: f.policy.principal,
        sessionUser: f.policy.principal,
        principalOid: 10,
        ownerOid: 20,
        webOid: 30,
        transactionId: '1001',
        graphComplete: true,
        membershipOptionsSupported: true,
        ownerName: 'nextera_checkpoint_owner',
        ownerSafe: true,
        webCanSetOwner: false,
        webCanInheritOwner: false,
        principalCanSetOwner: false,
        grantAuthority: 'admin_option',
        memberships: [
          { roleOid: 20, memberOid: 10, grantorOid: 1, admin: true, inherit: false, set: false },
        ],
      },
    };
  }
  async unsafe() {
    this.rootCalls++;
    throw new Error('ROOT_CLIENT_FORBIDDEN');
  }
  async begin(isolation, work) {
    this.beginCalls++;
    assert.equal(isolation, 'isolation level read committed');
    if (this.fail === 'begin') throw new Error('PRIVATE_CONNECTION_STRING');
    const before = structuredClone(this.state);
    let value;
    try {
      value = await work({ unsafe: (sql, params) => this.execute(sql, params) });
    } catch (error) {
      this.state = before;
      this.rollbacks++;
      throw error;
    }
    this.commits++;
    if (this.fail === 'commit') throw new Error('PRIVATE_COMMIT_RESPONSE_LOST');
    if (this.fail === 'late_ack') this.f.wall = this.f.limits.deadlineMs;
    return this.fail === 'wrong_ack' ? {} : value;
  }
  async execute(sql, params = []) {
    this.calls.push({ sql, params });
    if (sql.includes("set_config('statement_timeout'")) {
      assert.equal(params.length, 3);
      assert.ok(params.every((v) => /^[1-9]\d*ms$/.test(v)));
      assert.ok(sql.includes("set_config('search_path','pg_catalog,pg_temp',true)"));
      return [];
    }
    if (sql === MIGRATION_GUARD_ATTEST_SQL) {
      const g = {
        body: buildMigrationCatalogGuard(this.f.guard).body,
        config: ['search_path=pg_catalog, pg_temp'],
        arguments: 0,
        kind: 'f',
        definer: true,
        returns_set: false,
        returns_json: true,
        language: 'plpgsql',
        owner: this.f.guard.guardOwner,
        owner_super: true,
        database: this.f.policy.database,
        actor: this.f.policy.principal,
        session_actor: this.f.policy.principal,
        server_version: 160004,
        schema_owner: true,
        schema_usage: true,
        no_schema_create: true,
        function_acl_safe: true,
        schema_acl_safe: true,
        audit_owner: true,
        audit_acl_safe: true,
        can_execute: true,
        can_audit: true,
        no_web_access: true,
      };
      this.attestReads++;
      this.mutateAttestation?.(g, this.attestReads);
      return [g];
    }
    if (sql === 'SELECT checkpoint_rehearsal.lock_migration_catalogs() AS proof') {
      if (this.fail === 'lock')
        throw Object.assign(new Error('PRIVATE_LOCK_DETAIL'), { severity: 'ERROR', code: '55P03' });
      const response = { pid: 123, transactionId: '1001' };
      this.mutateResponse?.(response);
      return [{ proof: response }];
    }
    if (sql === MIGRATION_LOCK_PROOF_SQL) {
      const proof = { pid: 123, transaction_id: '1001', locks_held: true };
      this.mutateProof?.(proof);
      return [proof];
    }
    if (sql === MIGRATION_FACTS_SQL) return [{ data: structuredClone(this.state.facts) }];
    if (sql.startsWith('GRANT ')) {
      assert.equal(
        sql,
        'GRANT "nextera_checkpoint_owner" TO "migration_actor" WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY "migration_actor"',
      );
      if (this.fail === 'grant') throw new Error('PRIVATE_GRANT_FAILURE');
      this.state.facts.memberships.push({
        roleOid: 20,
        memberOid: 10,
        grantorOid: 10,
        admin: false,
        inherit: false,
        set: true,
      });
      this.state.facts.principalCanSetOwner = true;
      if (this.fail === 'bad_grant') this.state.facts.memberships.at(-1).admin = true;
      return [];
    }
    if (sql.startsWith('REVOKE ')) {
      assert.equal(
        sql,
        'REVOKE "nextera_checkpoint_owner" FROM "migration_actor" GRANTED BY "migration_actor" RESTRICT',
      );
      if (this.fail === 'revoke') throw new Error('PRIVATE_REVOKE_FAILURE');
      if (this.fail !== 'missing_revoke') {
        this.state.facts.memberships = this.state.facts.memberships.filter(
          (m) => m.grantorOid !== 10,
        );
        this.state.facts.principalCanSetOwner = false;
      }
      return [];
    }
    if (sql.startsWith('INSERT INTO checkpoint_rehearsal.migration_context_audit')) {
      if (this.fail === 'audit')
        throw Object.assign(new Error('PRIVATE_AUDIT_DETAIL'), {
          severity: 'ERROR',
          code: '42501',
        });
      this.state.audit.push(JSON.parse(params[2]));
      return [];
    }
    const expected = prepareCheckpointDraftMigration(this.f.policy, this.f.drafts).bodies[
      this.state.applied.length
    ];
    assert.equal(sql, expected?.body, 'only an exact prevalidated draft body may reach unsafe');
    this.state.applied.push(expected.file);
    if (
      this.fail === 'first_draft' ||
      (this.fail === 'second_draft' && this.state.applied.length === 2)
    )
      throw Object.assign(new Error('PRIVATE_SQL_AND_TOKEN'), { severity: 'ERROR', code: '42704' });
    if (this.fail === 'clock_expiry') this.f.wall = this.f.limits.deadlineMs;
    if (this.fail === 'monotonic_expiry') this.f.mono += this.f.limits.checkpointBudgetMs;
    if (this.fail === 'graph_change')
      this.state.facts.memberships.push({
        roleOid: 20,
        memberOid: 99,
        grantorOid: 1,
        admin: false,
        inherit: false,
        set: true,
      });
    return [];
  }
}
const repository = (f) => createCheckpointMigrationPostgresRepository(f.client, f);
const run = (f) =>
  withCheckpointDraftMigrationContext(repository(f), f.policy, f.drafts, f.runtime);

test('construction is pure and a complete fake transaction uses only the transaction client', async () => {
  const f = fixture(),
    before = structuredClone(f.client.state.facts);
  const repo = repository(f);
  assert.equal(f.client.beginCalls, 0);
  const result = await withCheckpointDraftMigrationContext(repo, f.policy, f.drafts, f.runtime);
  assert.equal(result.state, 'adapter_commit_acknowledged');
  assert.equal(f.client.beginCalls, 1);
  assert.equal(f.client.rootCalls, 0);
  assert.equal(f.client.commits, 1);
  assert.equal(f.client.attestReads, 2);
  assert.deepEqual(f.client.state.facts, before);
  assert.equal(f.client.state.applied.length, 2);
  assert.equal(f.client.state.audit.at(-1).kind, 'context_restored');
});
test('existing verified SET context does not issue grant or revoke', async () => {
  const f = fixture();
  f.policy.mode = 'existing_only';
  f.client.state.facts.principalCanSetOwner = true;
  f.client.state.facts.memberships[0].set = true;
  await run(f);
  assert.ok(!f.client.calls.some((c) => /^(GRANT|REVOKE) /.test(c.sql)));
});
for (const [label, change] of [
  ['prepared queries enabled', (f) => (f.client.options.prepare = true)],
  ['missing clock', (f) => delete f.clock],
  ['guard database mismatch', (f) => (f.guard.database = 'foundation_test_other')],
  ['guard actor mismatch', (f) => (f.guard.principal = 'other_actor')],
  ['statement timeout exceeds guard', (f) => (f.limits.statementMs = 5001)],
  ['idle timeout exceeds guard', (f) => (f.limits.idleMs = 5001)],
  ['missing checkpoint budget', (f) => delete f.limits.checkpointBudgetMs],
  ['negative lock timeout', (f) => (f.limits.lockMs = -1)],
  ['unsupported server', (f) => (f.guard.serverMajor = 15)],
  ['owner equals actor', (f) => (f.guard.guardOwner = f.policy.principal)],
  ['unsafe identifier', (f) => (f.guard.guardOwner = 'x;PRIVATE')],
  ['tampered draft bytes', (f) => (f.drafts[0].bytes = Buffer.from('PRIVATE_CHANGED'))],
])
  test('pure construction rejects ' + label, () => {
    const f = fixture();
    change(f);
    assert.throws(() => repository(f), MigrationContextError);
    assert.equal(f.client.beginCalls, 0);
  });
for (const [key, value] of Object.entries({
  body: 'PRIVATE_REPLACEMENT',
  config: ['search_path=public'],
  arguments: 1,
  kind: 'p',
  definer: false,
  returns_set: true,
  returns_json: false,
  language: 'sql',
  owner: 'other_owner',
  owner_super: false,
  database: 'retained',
  actor: 'nextera_web',
  session_actor: 'other_actor',
  server_version: 150000,
  schema_owner: false,
  schema_usage: false,
  no_schema_create: false,
  function_acl_safe: false,
  schema_acl_safe: false,
  audit_owner: false,
  audit_acl_safe: false,
  can_execute: false,
  can_audit: false,
  no_web_access: false,
}))
  test('attestation rejects ' + key + ' before invoking capability', async () => {
    const f = fixture();
    f.client.mutateAttestation = (g) => (g[key] = value);
    await assert.rejects(run(f));
    assert.ok(!f.client.calls.some((c) => c.sql.includes('() AS proof')));
    assert.equal(f.client.commits, 0);
  });
test('permissions are re-attested under the catalog locks before any grant or DDL', async () => {
  const f = fixture();
  f.client.mutateAttestation = (g, n) => {
    if (n === 2) g.no_web_access = false;
  };
  await assert.rejects(run(f));
  assert.equal(f.client.attestReads, 2);
  assert.ok(!f.client.calls.some((c) => c.sql.startsWith('GRANT ')));
  assert.equal(f.client.state.applied.length, 0);
});
for (const [key, value] of Object.entries({
  pid: 0,
  transaction_id: 'PRIVATE_XID',
  locks_held: false,
}))
  test('independent lock proof rejects ' + key, async () => {
    const f = fixture();
    f.client.mutateProof = (p) => (p[key] = value);
    await assert.rejects(run(f));
    assert.equal(f.client.state.applied.length, 0);
  });
test('guard cannot substitute another session or transaction in its response', async () => {
  for (const mutate of [(p) => p.pid++, (p) => (p.transactionId = '1002')]) {
    const f = fixture();
    f.client.mutateResponse = mutate;
    await assert.rejects(run(f));
    assert.equal(f.client.state.applied.length, 0);
  }
});
for (const [label, change] of [
  ['wrong current actor', (s) => (s.currentUser = 'other_actor')],
  ['wrong session actor', (s) => (s.sessionUser = 'other_actor')],
  ['wrong database', (s) => (s.database = 'foundation_test_wrong')],
  ['wrong transaction', (s) => (s.transactionId = '1002')],
  ['web owner reachability', (s) => (s.webCanSetOwner = true)],
  ['no existing ADMIN', (s) => (s.memberships[0].admin = false)],
  ['CREATEROLE is not ADMIN', (s) => (s.grantAuthority = 'none')],
  [
    'ambiguous existing own grant',
    (s) => s.memberships.push({ ...s.memberships[0], grantorOid: 10 }),
  ],
])
  test('server facts reject ' + label, async () => {
    const f = fixture();
    change(f.client.state.facts);
    await assert.rejects(run(f));
    assert.ok(!f.client.calls.some((c) => c.sql.startsWith('GRANT ')));
  });
for (const failure of [
  'begin',
  'lock',
  'grant',
  'bad_grant',
  'first_draft',
  'second_draft',
  'revoke',
  'missing_revoke',
  'audit',
  'clock_expiry',
  'monotonic_expiry',
  'graph_change',
])
  test('fake failure is fail closed and never claims verified rollback: ' + failure, async () => {
    const f = fixture(),
      before = structuredClone(f.client.state);
    f.client.fail = failure;
    await assert.rejects(run(f), (e) => {
      assert.equal(e.rollbackVerified, false);
      assert.ok(!JSON.stringify(e).includes('PRIVATE_'));
      return true;
    });
    assert.deepEqual(f.client.state, before);
    assert.equal(f.client.commits, 0);
  });
for (const failure of ['commit', 'late_ack', 'wrong_ack'])
  test('commit ambiguity never becomes success: ' + failure, async () => {
    const f = fixture();
    f.client.fail = failure;
    await assert.rejects(run(f), (e) => e.code === 'COMMIT_UNCERTAIN' && !e.rollbackVerified);
    assert.equal(f.client.commits, 1);
    assert.equal(f.client.state.applied.length, 2);
  });
test('controlled diagnostics retain only stage and SQLSTATE', async () => {
  const f = fixture();
  f.client.fail = 'second_draft';
  await assert.rejects(run(f), (e) => {
    assert.deepEqual(e.diagnostic, { stage: 'draft', sqlstate: '42704' });
    assert.ok(!e.stack.includes('PRIVATE_'));
    return true;
  });
  const bad = new MigrationContextError('PRIVATE_TOKEN', [], {
    stage: 'PRIVATE_STAGE',
    sqlstate: 'PRIVATE_TOKEN',
    detail: 'PRIVATE_DSN',
  });
  assert.deepEqual(bad.diagnostic, { stage: null, sqlstate: null });
});
test('leaked transaction handle cannot execute after callback resolution', async () => {
  const f = fixture();
  let handle;
  await assert.rejects(
    repository(f).transaction(async (tx) => {
      handle = tx;
    }),
  );
  const before = f.client.calls.length;
  await assert.rejects(handle.lockOwnerMemberships('nextera_checkpoint_owner'));
  assert.equal(f.client.calls.length, before);
});
test('direct adapter rejects unreviewed draft body and unapproved grant tuple', async () => {
  for (const command of ['draft', 'grant', 'audit']) {
    const f = fixture();
    await assert.rejects(
      repository(f).transaction(async (tx) => {
        await tx.lockOwnerMemberships('nextera_checkpoint_owner');
        if (command === 'draft')
          await tx.applyDraft({
            file: f.drafts[0].file,
            sha256: f.policy.draftSha256[f.drafts[0].file],
            body: 'PRIVATE_SQL',
          });
        if (command === 'grant')
          await tx.grantSelf({
            roleOid: 20,
            memberOid: 30,
            grantorOid: 10,
            admin: false,
            inherit: false,
            set: true,
          });
        if (command === 'audit')
          await tx.audit({
            sequence: 1,
            kind: 'context_checked',
            atMs: 1000,
            approvedScopeSha256: f.policy.approvedScopeSha256,
            secret: 'PRIVATE_VALUE',
          });
      }),
    );
    assert.equal(f.client.state.applied.length, 0);
    assert.equal(f.client.state.audit.length, 0);
  }
});
test('guard SQL is fixed, narrow, catalog locked and strips default ACLs before commit', () => {
  const f = fixture(),
    guard = buildMigrationCatalogGuard(f.guard);
  assert.equal(guard.bodySha256, hash(guard.body));
  assert.ok(
    guard.body.includes(
      'LOCK TABLE pg_catalog.pg_authid,pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE NOWAIT;',
    ),
  );
  assert.ok(!/EXECUTE|GRANT |REVOKE |ALTER /i.test(guard.body));
  assert.ok(guard.setupSql.includes('SECURITY DEFINER'));
  assert.ok(
    guard.setupSql.startsWith(
      'BEGIN;\nSET LOCAL search_path=pg_catalog,pg_temp;\nSET LOCAL check_function_bodies=on;',
    ),
  );
  assert.ok(guard.setupSql.includes('SET search_path=pg_catalog,pg_temp'));
  assert.ok(guard.setupSql.indexOf('DO $acl$') < guard.setupSql.indexOf('GRANT INSERT'));
  assert.ok(guard.setupSql.includes("pg_catalog.acldefault('f',p.proowner)"));
  assert.ok(guard.setupSql.includes('WHERE r.rolname<>current_user'));
  assert.ok(guard.setupSql.indexOf('DO $web$') < guard.setupSql.lastIndexOf('COMMIT;'));
  assert.ok(
    guard.setupSql.includes("pg_catalog.pg_has_role('nextera_web','migration_actor','SET')"),
  );
  assert.ok(!guard.setupSql.includes('ALTER DEFAULT PRIVILEGES'));
  assert.ok(!guard.setupSql.includes('CASCADE'));
  assert.ok(MIGRATION_LOCK_PROOF_SQL.includes('database=0'));
  assert.ok(MIGRATION_LOCK_PROOF_SQL.includes('pid=pg_catalog.pg_backend_pid()'));
});
