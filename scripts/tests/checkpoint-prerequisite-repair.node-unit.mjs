import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import {
  PREREQUISITE_FUNCTIONS,
  REGISTERED_SOURCES,
  EXECUTE_EDGES,
  REPAIR_STATEMENTS,
  REPAIR_FILE,
  REPAIR_DATABASE,
  DBA,
  ACTOR,
  FUNCTION_ACL_SQL,
  REPAIR_GRAPH_SQL,
  REPAIR_IDENTITY_SQL,
  REPAIR_PROOF_SQL,
  REPAIR_ACTOR_ACCESS_SQL,
  PrerequisiteRepairError,
  renderPrerequisiteRepairSql,
  applyRegisteredPrerequisite,
  applyPrerequisiteExecuteRepair,
} from '../checkpoint-prerequisite-repair.mjs';
const { structuredClone } = globalThis;
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const read = (file) =>
  fs.readFileSync(new URL('../../packages/db/migrations/' + file, import.meta.url));
const permissions = [
  'nextera_web',
  'nextera_judge_owner',
  'nextera_runner',
  'nextera_judge_maintenance',
  'nextera_result_application',
  'nextera_checkpoint_owner',
  'nextera_raid_owner',
].sort();
function fixture() {
  const f = { now: 1000, mono: 1000, bytes: Buffer.from(renderPrerequisiteRepairSql()) };
  f.policy = {
    database: REPAIR_DATABASE,
    dba: DBA,
    actor: ACTOR,
    allowFixedDbaSections: true,
    approvedScopeSha256: 'a'.repeat(64),
    deadlineMs: 5000,
    repairSha256: hash(f.bytes),
  };
  f.clock = { nowMs: () => f.now, monotonicMs: () => f.mono };
  f.client = new FakeClient(f);
  return f;
}
class FakeClient {
  constructor(f) {
    this.f = f;
    this.options = { prepare: false };
    this.calls = [];
    this.beginCount = 0;
    this.commits = 0;
    this.rollbacks = 0;
    this.fail = null;
    this.grants = 0;
    this.graphReads = 0;
    this.actorPath = null;
    this.role = DBA;
    this.graph = { roles: [{ name: ACTOR, super: false }], memberships: [] };
    this.acls = Object.fromEntries(PREREQUISITE_FUNCTIONS.map(([sig]) => [sig, []]));
    this.chunkCalls = [];
  }
  async unsafe() {
    throw new Error('ROOT_CLIENT_FORBIDDEN');
  }
  async begin(isolation, work) {
    assert.equal(isolation, 'isolation level read committed');
    this.beginCount++;
    const before = structuredClone({ acls: this.acls, graph: this.graph });
    this.onBegin?.();
    let value;
    try {
      value = await work({ unsafe: (sql, params = []) => this.execute(sql, params) });
    } catch (e) {
      this.acls = before.acls;
      this.graph = before.graph;
      this.role = DBA;
      this.rollbacks++;
      throw e;
    }
    this.role = DBA;
    this.commits++;
    if (this.fail === 'commit') throw new Error('PRIVATE_COMMIT_LOSS');
    return this.fail === 'ack' ? {} : value;
  }
  async execute(sql, params) {
    this.calls.push(sql);
    if (sql.includes("set_config('search_path'")) {
      assert.ok(params.every((v) => /^[1-9]\d*ms$/.test(v)));
      return [];
    }
    if (sql.startsWith('SET LOCAL SESSION AUTHORIZATION ')) {
      this.role = sql.slice(sql.indexOf('"') + 1, -1);
      return [];
    }
    if (sql === REPAIR_IDENTITY_SQL)
      return [
        {
          database: this.fail === 'database' ? 'retained' : REPAIR_DATABASE,
          actor: this.fail === 'identity' ? DBA : this.role,
          session_actor: this.role,
          super: this.fail === 'super' ? false : this.role === DBA,
        },
      ];
    if (sql === REPAIR_PROOF_SQL)
      return [{ pid: 123, transaction_id: '1001', locks_held: this.fail !== 'locks' }];
    if (sql === REPAIR_ACTOR_ACCESS_SQL)
      return permissions.map((role) => ({
        role,
        can_set: this.actorPath === 'set',
        can_inherit: this.actorPath === 'inherit',
      }));
    if (sql === REPAIR_GRAPH_SQL) {
      this.graphReads++;
      return [
        {
          graph:
            this.fail === 'graph' && this.graphReads > 1
              ? { ...this.graph, changed: true }
              : structuredClone(this.graph),
        },
      ];
    }
    if (sql === FUNCTION_ACL_SQL) {
      const entry = PREREQUISITE_FUNCTIONS.find(([sig]) => sig === params[0]);
      assert.ok(entry);
      const roles = this.acls[params[0]];
      return [
        {
          owner: entry[1],
          no_public: true,
          execute_only: true,
          web_execute: roles.includes('nextera_web'),
          grantees: [...roles].sort(),
        },
      ];
    }
    const edgeIndex = REPAIR_STATEMENTS.indexOf(sql);
    if (edgeIndex >= 0) {
      this.grants++;
      const edge = EXECUTE_EDGES[edgeIndex];
      this.acls[edge.signature] = [...new Set([...this.acls[edge.signature], edge.grantee])];
      if (this.fail === this.grants)
        throw Object.assign(new Error('PRIVATE_SQL_TEXT'), { severity: 'ERROR', code: '42501' });
      return [];
    }
    if (sql.includes('DO $scope$')) {
      if (['public', 'owner', 'unexpected_acl'].includes(this.fail))
        throw Object.assign(new Error('PRIVATE_ACL'), { severity: 'ERROR', code: '42501' });
      return [];
    }
    if (sql.startsWith('DO $verify$')) return [];
    if (this.registered) {
      const { bytes, binding } = this.registered;
      const chunks = [
        bytes.subarray(0, binding.start),
        bytes.subarray(binding.start, binding.end),
        bytes.subarray(binding.end),
      ];
      const i = chunks.findIndex((b) => b.length && b.toString() === sql);
      assert.ok(i >= 0, 'Only exact pinned source bytes may execute');
      assert.equal(this.role, i === 1 ? DBA : ACTOR);
      this.chunkCalls.push({ bytes: Buffer.from(sql), role: this.role });
      if (this.fail === 'chunk' + i) throw new Error('PRIVATE_SOURCE_FAILURE');
      return [];
    }
    throw new Error('UNEXPECTED_SQL');
  }
}
const repair = (f) => applyPrerequisiteExecuteRepair(f.client, f.bytes, f.policy, f.clock);
test('fixed repair matches unregistered artifact and contains exactly27 narrow statements', () => {
  const bytes = fs.readFileSync(
    new URL('../../packages/db/migration-drafts/' + REPAIR_FILE, import.meta.url),
  );
  assert.equal(bytes.toString(), renderPrerequisiteRepairSql());
  assert.equal(REPAIR_STATEMENTS.length, 27);
  assert.equal(new Set(REPAIR_STATEMENTS).size, 27);
  assert.equal(bytes.toString().match(/^GRANT EXECUTE ON FUNCTION /gm).length, 27);
  assert.ok(
    !/\b(?:CREATE|ALTER|DROP|DELETE|INSERT|UPDATE|TRUNCATE|REVOKE)\s+(?:ROLE|USER|TABLE|FUNCTION|SCHEMA|DATABASE)\b/.test(
      bytes.toString(),
    ),
  );
  assert.ok(!bytes.toString().includes('WITH GRANT OPTION'));
  assert.ok(bytes.toString().includes("pg_catalog.pg_has_role('" + ACTOR + "',r.oid,'SET')"));
  assert.ok(bytes.toString().includes("pg_catalog.pg_has_role('" + ACTOR + "',r.oid,'USAGE')"));
  const journal = fs.readFileSync(
    new URL('../../packages/db/migrations/meta/_journal.json', import.meta.url),
    'utf8',
  );
  assert.ok(!journal.includes('0019'));
});
function splitFunctions(text) {
  let depth = 0,
    start = 0,
    result = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') depth--;
    if (text[i] === ',' && depth === 0) {
      result.push(text.slice(start, i));
      start = i + 1;
    }
  }
  result.push(text.slice(start));
  return result.map((s) => s.replace(/\s+/g, ''));
}
test('all27 edges come exactly from unchanged registered contracts', () => {
  const actual = [];
  for (const file of [
    '0003_judge_protocol.sql',
    '0007_checkpoint_operations.sql',
    '0008_raid_domain.sql',
    '0009_raid_operations.sql',
  ]) {
    for (const match of read(file)
      .toString()
      .matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([^;]+?)\s+TO\s+(nextera_[a-z_]+);/g))
      actual.push(...splitFunctions(match[1]).map((sig) => sig + '|' + match[2]));
  }
  assert.equal(actual.length, 27);
  assert.deepEqual(actual.sort(), EXECUTE_EDGES.map((e) => e.signature + '|' + e.grantee).sort());
});
test('all11 files and privileged source chunks stay byte-for-byte identical', () => {
  let privileged = 0;
  for (const [file, b] of Object.entries(REGISTERED_SOURCES)) {
    const data = read(file),
      parts = [data.subarray(0, b.start), data.subarray(b.start, b.end), data.subarray(b.end)];
    assert.equal(hash(data), b.sha256);
    assert.ok(Buffer.concat(parts).equals(data));
    assert.deepEqual(parts.map(hash), [b.prefixSha256, b.dbaSha256, b.suffixSha256]);
    if (parts[1].length) {
      privileged++;
      if (!file.startsWith('0007'))
        assert.ok(parts[1].toString().trim().startsWith('GRANT EXECUTE ON FUNCTION'));
    }
  }
  assert.equal(privileged, 4);
});
test('fake repair fills missing grants without role graph mutation', async () => {
  const f = fixture(),
    before = structuredClone(f.client.graph);
  const r = await repair(f);
  assert.equal(r.executeEdges, 27);
  assert.equal(r.actorPrivilegeExpansion, false);
  assert.equal(r.commitAcknowledged, true);
  assert.deepEqual(f.client.graph, before);
  assert.equal(f.client.commits, 1);
  assert.equal(r.beforeAcl.length, 25);
  assert.equal(r.afterAcl.length, 25);
  assert.equal(r.beforeGraphSha256, r.afterGraphSha256);
  for (const [sig, , web, extra = []] of PREREQUISITE_FUNCTIONS)
    assert.deepEqual(f.client.acls[sig].sort(), [...(web ? ['nextera_web'] : []), ...extra].sort());
});
test('reconciliation of already-complete fake ACLs stays exact', async () => {
  const f = fixture();
  await repair(f);
  const before = structuredClone(f.client.acls);
  await repair(f);
  assert.deepEqual(f.client.acls, before);
});
for (const fail of [
  1,
  14,
  27,
  'public',
  'owner',
  'unexpected_acl',
  'database',
  'super',
  'locks',
  'graph',
])
  test(
    'fake repair rolls back on ' + fail + ' without raw diagnostics or rollback claims',
    async () => {
      const f = fixture(),
        before = structuredClone(f.client.acls);
      f.client.fail = fail;
      await assert.rejects(
        repair(f),
        (e) =>
          e instanceof PrerequisiteRepairError &&
          !e.rollbackVerified &&
          !JSON.stringify(e).includes('PRIVATE_'),
      );
      assert.deepEqual(f.client.acls, before);
      assert.equal(f.client.commits, 0);
    },
  );
for (const path of ['set', 'inherit'])
  test('actor ' + path + ' path fails before grants', async () => {
    const f = fixture();
    f.client.actorPath = path;
    await assert.rejects(repair(f));
    assert.equal(f.client.grants, 0);
  });
for (const mode of ['commit', 'ack'])
  test('fake ' + mode + ' uncertainty is never a pass or replay', async () => {
    const f = fixture();
    f.client.fail = mode;
    await assert.rejects(repair(f), (e) => e.code === 'COMMIT_UNCERTAIN' && !e.rollbackVerified);
    assert.equal(f.client.commits, 1);
    assert.equal(f.client.beginCount, 1);
  });
test('unbound policy or altered source cannot enter transaction', async () => {
  for (const change of [
    (f) => (f.policy.allowFixedDbaSections = false),
    (f) => (f.policy.allowFixedDbaSections = 'yes'),
    (f) => (f.policy.dba = ACTOR),
    (f) => {
      f.bytes = Buffer.concat([f.bytes, Buffer.from('GRANT ALL ON SCHEMA app TO nextera_web;')]);
      f.policy.repairSha256 = hash(f.bytes);
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(repair(f));
    assert.equal(f.client.beginCount, 0);
  }
});
test('caller cannot refresh the approved repair deadline mid-transaction', async () => {
  const f = fixture();
  f.client.onBegin = () => {
    f.policy.deadlineMs = 90000;
    f.now = 5001;
  };
  await assert.rejects(repair(f));
  assert.equal(f.client.grants, 0);
});
for (const file of Object.keys(REGISTERED_SOURCES))
  test('one pinned transaction restores actor for ' + file, async () => {
    const f = fixture(),
      data = read(file),
      binding = REGISTERED_SOURCES[file];
    f.client.registered = { bytes: Buffer.from(data), binding };
    const r = await applyRegisteredPrerequisite(f.client, file, data, f.policy, f.clock);
    assert.equal(r.actorRestoredBeforeCommit, true);
    assert.ok(Buffer.concat(f.client.chunkCalls.map((c) => c.bytes)).equals(data));
    assert.equal(f.client.commits, 1);
    assert.equal(f.client.role, DBA);
  });
for (const mode of ['chunk0', 'chunk1', 'chunk2', 'identity'])
  test('registered fake failure rolls back at ' + mode, async () => {
    const file = '0003_judge_protocol.sql',
      f = fixture(),
      data = read(file);
    f.client.registered = { bytes: Buffer.from(data), binding: REGISTERED_SOURCES[file] };
    f.client.fail = mode;
    await assert.rejects(applyRegisteredPrerequisite(f.client, file, data, f.policy, f.clock));
    assert.equal(f.client.commits, 0);
    assert.equal(f.client.role, DBA);
  });
test('registered input bytes are defensively copied before asynchronous work', async () => {
  const file = '0003_judge_protocol.sql',
    f = fixture(),
    data = read(file),
    expected = Buffer.from(data);
  f.client.registered = { bytes: expected, binding: REGISTERED_SOURCES[file] };
  f.client.onBegin = () => data.fill(0);
  await applyRegisteredPrerequisite(f.client, file, data, f.policy, f.clock);
  assert.ok(Buffer.concat(f.client.chunkCalls.map((c) => c.bytes)).equals(expected));
});
