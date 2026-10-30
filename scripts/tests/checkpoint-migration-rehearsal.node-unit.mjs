import { test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import fs from 'node:fs';
import { URL } from 'node:url';
import {
  CASE_ORDER,
  DATABASE,
  TARGET,
  RUNTIME_BLOCKERS,
  PREREQUISITE_FUNCTIONS,
  DRAFT_FUNCTIONS,
  FUNCTION_ACL_SQL,
  assertFunctionAcls,
  bindRoleTransactions,
  executePreparedRunner,
  runOrderedCases,
  validateControl,
} from '../test-checkpoint-migration-adapter.mjs';

const control = () => ({
  target: TARGET,
  database: DATABASE,
  port: '55451',
  bootstrap: 'anas',
  actor: 'checkpoint_migration_actor_20261029',
  probe: 'checkpoint_migration_probe_20261029',
  created: 1,
  deadline: 1801,
  cleanup_at: 1621,
  uid: process.getuid(),
  scope_sha256: 'a'.repeat(64),
  approval: { scope_sha256: 'a'.repeat(64) },
  sources: Object.fromEntries(
    Array.from({ length: 21 }, (_, i) => ['scripts/file' + i + '.mjs', 'b'.repeat(64)]),
  ),
});
test('runner import is pure and control validation creates no client', () => {
  validateControl(control(), 2000);
  assert.equal(CASE_ORDER.at(-1), 'single_commit_last');
});
for (const [label, mutate] of [
  ['target', (r) => (r.target = '/retained')],
  ['database', (r) => (r.database = 'retained')],
  ['port', (r) => (r.port = '5432')],
  ['actor', (r) => (r.actor = 'nextera_web')],
  ['bootstrap', (r) => (r.bootstrap = 'other')],
  ['uid', (r) => (r.uid = -1)],
  ['deadline', (r) => r.deadline++],
  ['cleanup', (r) => r.cleanup_at++],
  ['binding', (r) => (r.approval.scope_sha256 = 'b'.repeat(64))],
  ['path escape', (r) => (r.sources['../outside'] = 'c'.repeat(64))],
  ['invalid digest', (r) => (r.sources['scripts/x.mjs'] = 'PRIVATE_VALUE')],
])
  test('runner rejects control ' + label, () => {
    const r = control();
    mutate(r);
    assert.throws(() => validateControl(r, 2000));
  });
test('runtime expiry rejects execution before any injected client', () => {
  assert.throws(() => validateControl(control(), 1621000));
});
test('ordered fake cases commit only after all preceding checks', async () => {
  const seen = [];
  const cases = await runOrderedCases(
    Object.fromEntries(CASE_ORDER.map((name) => [name, async () => seen.push(name)])),
  );
  assert.deepEqual(seen, CASE_ORDER);
  assert.equal(cases.length, 7);
  assert.ok(cases.every((c) => c.passed));
});
for (const failAt of CASE_ORDER.slice(0, -1))
  test('fake case failure prevents commit: ' + failAt, async () => {
    const seen = [];
    await assert.rejects(
      runOrderedCases(
        Object.fromEntries(
          CASE_ORDER.map((name) => [
            name,
            async () => {
              seen.push(name);
              if (name === failAt) throw new Error('EXPECTED_FAKE');
            },
          ]),
        ),
      ),
    );
    assert.ok(!seen.includes('single_commit_last'));
  });
test('an independently bounded case timeout aborts further cases', async () => {
  let committed = false;
  const ops = Object.fromEntries(
    CASE_ORDER.map((name) => [
      name,
      async () => {
        if (name === 'single_commit_last') committed = true;
      },
    ]),
  );
  ops.wrong_identity = () => new Promise(() => {});
  await assert.rejects(runOrderedCases(ops, 5), /CASE_TIMEOUT/);
  assert.equal(committed, false);
});
test('source uses explicit dynamic driver gate and exact body failure injection', () => {
  const code = fs.readFileSync(
    new URL('../test-checkpoint-migration-adapter.mjs', import.meta.url),
    'utf8',
  );
  assert.match(code, /validateControl\(record,\s*Date.now\(\)\);[\s\S]*await import\('postgres'\)/);
  assert.match(code, /text\s*===\s*secondBody/);
  assert.ok(!code.includes('process.env'));
  assert.ok(!code.includes('DROP SCHEMA') && !code.includes('DROP DATABASE'));
});

test('invalid control prevents all client creation', async () => {
  let constructed = false;
  assert.equal(RUNTIME_BLOCKERS.length, 0);
  await assert.rejects(
    executePreparedRunner({}, () => {
      constructed = true;
    }),
  );
  assert.equal(constructed, false);
});
test('every physical transaction rebinds and verifies role after simulated reconnect', async () => {
  const calls = [];
  const client = {
    options: { prepare: false },
    end: async () => {},
    begin: async (isolation, fn) => {
      assert.equal(isolation, 'isolation level read committed');
      let identity = 'anas'; // every begin is a newly reconnected physical backend
      return fn({
        unsafe: async (text) => {
          calls.push([identity, text]);
          if (text.startsWith('SET LOCAL SESSION AUTHORIZATION')) {
            identity = 'checkpoint_migration_actor_20261029';
            return [];
          }
          if (text.startsWith('SELECT current_user'))
            return [{ actor: identity, session_actor: identity }];
          assert.equal(identity, 'checkpoint_migration_actor_20261029');
          return [{ ok: true }];
        },
      });
    },
  };
  const bound = bindRoleTransactions(client, 'checkpoint_migration_actor_20261029');
  await bound.unsafe('SELECT prerequisite');
  await bound.begin('isolation level read committed', (sql) => sql.unsafe('SELECT adapter_work'));
  assert.equal(calls.filter(([, s]) => s.startsWith('SET LOCAL SESSION AUTHORIZATION')).length, 2);
  assert.equal(calls.filter(([, s]) => s.startsWith('SELECT current_user')).length, 2);
});
test('wrong role or failed physical identity cannot reach callback SQL', async () => {
  let callback = false;
  const client = {
    options: { prepare: false },
    end: async () => {},
    begin: async (_, fn) =>
      fn({
        unsafe: async (text) =>
          text.startsWith('SELECT current_user') ? [{ actor: 'anas', session_actor: 'anas' }] : [],
      }),
  };
  assert.throws(() => bindRoleTransactions(client, 'anas'));
  const bound = bindRoleTransactions(client, 'checkpoint_migration_actor_20261029');
  await assert.rejects(
    bound.begin('isolation level read committed', async () => {
      callback = true;
    }),
  );
  assert.equal(callback, false);
  assert.throws(() => bound.unsafe('COMMIT;SELECT unsafe'));
});
test('function ACL assertions enforce exact owner/public/web/other-grantee contract', async () => {
  const good = {
    owner: 'nextera_checkpoint_owner',
    no_public: true,
    web_execute: true,
    execute_only: true,
    grantees: ['nextera_web'],
  };
  const spec = [['app.expected()', 'nextera_checkpoint_owner', true]];
  for (const patch of [
    null,
    { owner: 'anas' },
    { no_public: false },
    { web_execute: false },
    { execute_only: false },
    { grantees: ['nextera_web', 'untrusted'] },
  ]) {
    const sql = {
      unsafe: async (text) => {
        assert.equal(text, FUNCTION_ACL_SQL);
        return [{ ...good, ...patch }];
      },
    };
    if (patch) await assert.rejects(assertFunctionAcls(sql, spec));
    else await assertFunctionAcls(sql, spec);
  }
});
test('ACL manifest includes all 27 required prerequisite execution edges and eight draft functions', () => {
  assert.equal(PREREQUISITE_FUNCTIONS.length, 25);
  assert.equal(
    PREREQUISITE_FUNCTIONS.reduce((n, [, , web, extra = []]) => n + Number(web) + extra.length, 0),
    27,
  );
  assert.equal(DRAFT_FUNCTIONS.length, 8);
});
for (const file of ['0011_checkpoint_drafts.DRAFT.sql', '0014_checkpoint_editor_context.DRAFT.sql'])
  test('draft ACLs are finalized by creator before ownership transfer: ' + file, () => {
    const sql = fs.readFileSync(
      new URL('../../packages/db/migration-drafts/' + file, import.meta.url),
      'utf8',
    );
    assert.ok(sql.lastIndexOf('GRANT EXECUTE ON FUNCTION') < sql.indexOf('ALTER FUNCTION'));
    assert.ok(sql.lastIndexOf('FROM PUBLIC') < sql.indexOf('ALTER FUNCTION'));
    assert.ok(!/\bSET\s+ROLE\b|\bINHERIT\s+TRUE\b/.test(sql));
    assert.ok(sql.includes("pg_has_role(current_user,'nextera_checkpoint_owner','SET')"));
    if (file.startsWith('0011'))
      assert.ok(!sql.includes("p.proname IN ('checkpoint_draft_record'"));
  });
