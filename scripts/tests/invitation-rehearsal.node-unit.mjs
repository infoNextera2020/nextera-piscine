import process from 'node:process';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TARGET,
  DATABASE,
  PORT,
  ACTOR,
  PROBE,
  ISSUER,
  ACTIVATOR,
  ROLES,
  DRAFT_ORDER,
  CASE_ORDER,
  validateControl,
  draftBody,
  bindSession,
  applyPrerequisite,
  runCases,
  fixtureSpec,
} from '../test-invitation-rehearsal.mjs';
import { REGISTERED_SOURCES } from '../checkpoint-prerequisite-manifest.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = 'a'.repeat(64),
  created = Date.parse('2026-10-30T12:00:00.123Z') / 1000;
const record = () => ({
  target: TARGET,
  database: DATABASE,
  port: String(PORT),
  bootstrap: 'anas',
  actor: ACTOR,
  probe: PROBE,
  issuer: ISSUER,
  activator: ACTIVATOR,
  uid: process.getuid(),
  scope_sha256: hash,
  created,
  deadline: created + 1800,
  cleanup_at: created + 1620,
  approval: {
    owner_message_id: 'Sentinel_syntheticfixture',
    owner_approved_at: '2026-10-30T11:59:59.123000+00:00',
    scope_sha256: hash,
  },
  sources: Object.fromEntries(Array.from({ length: 11 }, (_, n) => ['synthetic/' + n, hash])),
});
test('imports and static profile do not create or adopt the runtime target', () => {
  assert.equal(ROLES.length, 14);
  assert.equal(new Set(ROLES).size, 14);
  assert.equal(PORT, 55461);
  assert.equal(fs.existsSync(TARGET), false);
  assert.deepEqual(DRAFT_ORDER, [
    '0013_invitations.DRAFT.sql',
    '0020_invitation_issuance.DRAFT.sql',
    '0016_invitation_operations.DRAFT.sql',
    '0018_invitation_admission.DRAFT.sql',
  ]);
});
test('control binds the exact unused target, roles, clock and authentic approval scope', () => {
  validateControl(record(), (created + 1) * 1000);
  for (const patch of [
    { target: '/tmp/old' },
    { database: 'postgres' },
    { port: '5432' },
    { bootstrap: ACTOR },
    { actor: 'anas' },
    { probe: 'other' },
    { uid: process.getuid() + 1 },
    { deadline: created + 1801 },
    { cleanup_at: created + 1700 },
    { approval: { ...record().approval, scope_sha256: 'b'.repeat(64) } },
    { approval: { ...record().approval, owner_approved_at: '2026-10-30T10:00:00Z' } },
  ])
    assert.throws(() => validateControl({ ...record(), ...patch }, (created + 1) * 1000));
  assert.throws(() => validateControl(record(), (created + 1620) * 1000));
  assert.throws(() => validateControl(record(), (created - 1) * 1000));
});
for (const file of DRAFT_ORDER)
  test('exact transaction wrapper extraction: ' + file, () => {
    const bytes = fs.readFileSync(path.join(repo, 'packages/db/migration-drafts', file));
    const body = draftBody(file, bytes);
    assert.ok(body.includes('CREATE '));
    assert.equal(body.startsWith('BEGIN;'), false);
    assert.equal(body.endsWith('COMMIT;\n'), false);
    assert.throws(() => draftBody('0011_checkpoint_drafts.DRAFT.sql', bytes));
    assert.throws(() => draftBody(file, Buffer.from('BEGIN;\nSELECT 1;\nCOMMIT;')));
  });
function fakePool({ wrong = false, lostAck = false, failBody = false } = {}) {
  const calls = [],
    transactions = [];
  let serial = 0;
  const client = {
    options: { prepare: false },
    begin: async (isolation, work) => {
      assert.equal(isolation, 'isolation level read committed');
      serial++;
      let role = 'anas';
      const own = [];
      transactions.push(own);
      const sql = {
        unsafe: async (text, args) => {
          calls.push([serial, text, args]);
          own.push(text);
          if (text.startsWith('SET LOCAL SESSION AUTHORIZATION ')) {
            role = text.split('"')[1];
            return [];
          }
          if (text.startsWith('SELECT current_user'))
            return [
              {
                actor: wrong ? 'unrelated' : role,
                session_actor: role,
                ...(text.includes('current_database') ? { database: DATABASE } : {}),
              },
            ];
          if (failBody && !text.startsWith('SET ')) throw new Error('SYNTHETIC_SQL_ERROR');
          return [];
        },
      };
      const result = await work(sql);
      if (lostAck) throw new Error('SYNTHETIC_LOST_ACK');
      return result;
    },
  };
  return { client, calls, transactions };
}
test('each pooled/reconnected transaction rebinds both identities before any test query', async () => {
  const f = fakePool(),
    client = bindSession(f.client, ISSUER);
  await client.unsafe('SELECT synthetic_one');
  await client.unsafe('SELECT synthetic_two');
  assert.equal(f.transactions.length, 2);
  for (const statements of f.transactions) {
    assert.equal(statements[0], `SET LOCAL SESSION AUTHORIZATION "${ISSUER}"`);
    assert.match(statements[1], /current_user/);
    assert.match(statements[2], /statement_timeout/);
  }
  assert.throws(() => bindSession(f.client, 'anas'));
  assert.throws(() => bindSession({ options: { prepare: true } }, ISSUER));
});
test('mismatched role identity aborts before SQL; caller transaction envelopes rejected', async () => {
  const f = fakePool({ wrong: true }),
    client = bindSession(f.client, ACTIVATOR);
  await assert.rejects(client.unsafe('SELECT forbidden'));
  assert.equal(
    f.calls.some(([, text]) => text === 'SELECT forbidden'),
    false,
  );
  assert.throws(() => client.unsafe('COMMIT; SELECT bad'));
});
for (const [file, m] of Object.entries(REGISTERED_SOURCES))
  test('byte-preserving prerequisite and narrow DBA span: ' + file, async () => {
    const bytes = fs.readFileSync(path.join(repo, 'packages/db/migrations', file)),
      f = fakePool();
    const receipt = await applyPrerequisite(f.client, file, bytes, () => {});
    assert.equal(receipt.sha256, m.sha256);
    assert.equal(receipt.actorRestoredBeforeCommit, true);
    const body = f.calls
      .filter(
        ([, text]) => !text.startsWith('SET LOCAL') && !text.startsWith('SELECT current_user'),
      )
      .map(([, text]) => text)
      .join('');
    assert.equal(body, bytes.toString('utf8'));
    const roles = f.calls
      .filter(([, text]) => text.startsWith('SET LOCAL SESSION'))
      .map(([, text]) => text);
    assert.deepEqual(
      roles,
      m.start === m.end
        ? [`SET LOCAL SESSION AUTHORIZATION "${ACTOR}"`]
        : [
            `SET LOCAL SESSION AUTHORIZATION "${ACTOR}"`,
            'SET LOCAL SESSION AUTHORIZATION "anas"',
            `SET LOCAL SESSION AUTHORIZATION "${ACTOR}"`,
          ],
    );
  });
test('tampered source, budget expiry and lost acknowledgement cannot be reported committed', async () => {
  const file = Object.keys(REGISTERED_SOURCES)[0],
    bytes = fs.readFileSync(path.join(repo, 'packages/db/migrations', file));
  await assert.rejects(
    applyPrerequisite(fakePool().client, file, Buffer.concat([bytes, Buffer.from(' ')]), () => {}),
  );
  await assert.rejects(
    applyPrerequisite(fakePool().client, file, bytes, () => {
      throw new Error('EXPIRED');
    }),
  );
  await assert.rejects(
    applyPrerequisite(fakePool({ lostAck: true }).client, file, bytes, () => {}),
    /SYNTHETIC_LOST_ACK/,
  );
});
test('test cases have exact coverage/order and sanitized receipts with no token/provider data', async () => {
  const reached = [];
  const operations = Object.fromEntries(
    CASE_ORDER.map((name) => [name, async () => reached.push(name)]),
  );
  assert.deepEqual(
    await runCases(operations),
    CASE_ORDER.map((name) => ({ name, passed: true })),
  );
  assert.deepEqual(reached, CASE_ORDER);
  await assert.rejects(runCases({}), /AssertionError/);
  assert.ok(
    CASE_ORDER.includes('concurrent_issuance') &&
      CASE_ORDER.includes('concurrent_enrollment') &&
      CASE_ORDER.includes('outer_transaction_rollback'),
  );
});
test('case failure stops later cases; timeout is bounded and never renews the lease', async () => {
  const reached = [];
  const operations = Object.fromEntries(
    CASE_ORDER.map((name) => [
      name,
      async () => {
        reached.push(name);
        if (name === CASE_ORDER[1]) throw new Error('SYNTHETIC_ABORT');
      },
    ]),
  );
  await assert.rejects(runCases(operations), /SYNTHETIC_ABORT/);
  assert.deepEqual(reached, CASE_ORDER.slice(0, 2));
  const stalled = Object.fromEntries(
    CASE_ORDER.map((name) => [name, async () => new Promise(() => {})]),
  );
  await assert.rejects(runCases(stalled, 5), /INVITATION_CASE_TIMEOUT/);
});
test('synthetic projection meets structural publication fields but promises no executable pack', () => {
  const spec = fixtureSpec('root');
  assert.equal(spec.node_key, 'root');
  assert.match(spec.test_pack_artifact, /fixture.invalid\/unexecuted/);
  assert.equal(spec.dependency_policy, 'offline');
  for (const phase of ['compilation', 'execution'])
    for (const n of Object.values(spec.resource_limits[phase]))
      assert.ok(Number.isSafeInteger(n) && n > 0);
});
