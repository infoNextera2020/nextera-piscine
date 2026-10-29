import { test } from 'node:test';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import {
  CHECKPOINT_CONTEXT_DRAFTS,
  MigrationContextError,
  withCheckpointDraftMigrationContext,
} from '../checkpoint-migration-context.mjs';

const { structuredClone } = globalThis;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
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
    database: 'foundation_test_context_contract',
    principal: 'migration_actor',
    mode: 'temporary_self_membership',
    draftSha256: Object.fromEntries(drafts.map((d) => [d.file, hash(d.bytes)])),
  };
  const initial = {
    database: policy.database,
    currentUser: policy.principal,
    sessionUser: policy.principal,
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
  };
  const repo = new FakeRepository(initial);
  let time = 1000;
  const runtime = { nowMs: () => time++ };
  return { repo, policy, drafts, runtime, initial };
}
class FakeRepository {
  constructor(facts) {
    this.facts = structuredClone(facts);
    this.applied = [];
    this.audit = [];
    this.calls = [];
    this.fail = null;
    this.reads = 0;
    this.ack = true;
  }
  async transaction(work) {
    this.calls.push('transaction');
    const before = structuredClone({ facts: this.facts, applied: this.applied, audit: this.audit });
    const tx = {
      lockOwnerMemberships: async (role) => {
        assert.equal(role, 'nextera_checkpoint_owner');
        this.calls.push('lock');
      },
      inspect: async () => {
        this.reads++;
        const facts = structuredClone(this.facts);
        if (this.fail === 'identity' && this.reads > 1) facts.transactionId = '2001';
        return facts;
      },
      audit: async (event) => {
        this.audit.push(event);
        if (this.fail === 'audit') throw new Error('PRIVATE_AUDIT_ERROR');
      },
      grantSelf: async (row) => {
        this.calls.push('grant');
        this.facts.memberships.push(structuredClone(row));
        this.facts.principalCanSetOwner = true;
        if (this.fail === 'bad_grant') this.facts.memberships.at(-1).admin = true;
        if (this.fail === 'grant') throw new Error('PRIVATE_GRANT_ERROR');
      },
      applyDraft: async (draft) => {
        this.calls.push('apply');
        this.applied.push(draft);
        assert.ok(
          draft.body.includes("pg_has_role(current_user,'nextera_checkpoint_owner','SET')"),
        );
        if (
          this.fail === 'first_draft' ||
          (this.fail === 'second_draft' && this.applied.length === 2)
        )
          throw new Error('PRIVATE_SQL_DSN');
        if (this.fail === 'concurrent_graph')
          this.facts.memberships.push({
            roleOid: 20,
            memberOid: 99,
            grantorOid: 1,
            admin: false,
            inherit: false,
            set: true,
          });
      },
      revokeIntroduced: async (row) => {
        this.calls.push('revoke');
        if (this.fail === 'revoke') throw new Error('PRIVATE_REVOKE_ERROR');
        if (this.fail !== 'missing_revoke')
          this.facts.memberships = this.facts.memberships.filter(
            (m) =>
              !(
                m.roleOid === row.roleOid &&
                m.memberOid === row.memberOid &&
                m.grantorOid === row.grantorOid
              ),
          );
        this.facts.principalCanSetOwner = this.fail === 'missing_revoke';
      },
    };
    try {
      const value = await work(tx);
      this.calls.push('commit');
      return { commitAcknowledged: this.ack, value };
    } catch (error) {
      Object.assign(this, before);
      this.calls.push('rollback');
      throw error;
    }
  }
}
const run = (f) => withCheckpointDraftMigrationContext(f.repo, f.policy, f.drafts, f.runtime);
test('temporary self context restores exact existing bootstrap-grant options before commit', async () => {
  const f = fixture(),
    before = structuredClone(f.repo.facts),
    result = await run(f);
  assert.equal(result.state, 'adapter_commit_acknowledged');
  assert.equal(result.originalAuthorityPreserved, true);
  assert.deepEqual(f.repo.facts, before);
  assert.equal(f.repo.applied.length, 2);
  assert.deepEqual(f.repo.calls, [
    'transaction',
    'lock',
    'grant',
    'apply',
    'apply',
    'revoke',
    'commit',
  ]);
  const grant = f.repo.audit.find((e) => e.kind === 'temporary_grant_requested').grant;
  assert.deepEqual(grant, {
    roleOid: 20,
    memberOid: 10,
    grantorOid: 10,
    admin: false,
    inherit: false,
    set: true,
  });
  assert.equal(f.repo.audit.at(-1).kind, 'context_restored');
  assert.ok(f.repo.audit.every((e) => e.approvedScopeSha256 === f.policy.approvedScopeSha256));
});
test('existing authority is preserved without grant or revoke', async () => {
  const f = fixture();
  f.policy.mode = 'existing_only';
  f.repo.facts.principalCanSetOwner = true;
  f.repo.facts.memberships[0].set = true;
  const before = structuredClone(f.repo.facts);
  await run(f);
  assert.deepEqual(f.repo.facts, before);
  assert.deepEqual(f.repo.calls, ['transaction', 'lock', 'apply', 'apply', 'commit']);
});
test('existing-only policy never turns missing SET into a grant', async () => {
  const f = fixture();
  f.policy.mode = 'existing_only';
  await assert.rejects(run(f), (e) => e.code === 'CONTEXT_REQUIRED');
  assert.ok(!f.repo.calls.includes('grant'));
  assert.equal(f.repo.applied.length, 0);
});
test('CREATEROLE or an asserted superuser substitute cannot replace verified ADMIN authority', async () => {
  for (const authority of ['none', 'superuser']) {
    const f = fixture();
    f.repo.facts.grantAuthority = authority;
    f.repo.facts.createrole = true;
    await assert.rejects(run(f), (e) => e.code === 'GRANT_AUTHORITY_REQUIRED');
    assert.ok(!f.repo.calls.includes('grant'));
    assert.equal(f.repo.applied.length, 0);
  }
});
test('same-grantor existing membership is ambiguous and never overwritten', async () => {
  const f = fixture();
  f.repo.facts.memberships.push({
    roleOid: 20,
    memberOid: 10,
    grantorOid: 10,
    admin: true,
    inherit: false,
    set: false,
  });
  const before = structuredClone(f.repo.facts);
  await assert.rejects(run(f), (e) => e.code === 'AMBIGUOUS_EXISTING_GRANT');
  assert.deepEqual(f.repo.facts, before);
  assert.ok(!f.repo.calls.includes('grant'));
});
for (const [name, change] of [
  ['web actor', (f) => (f.policy.principal = 'nextera_web')],
  ['missing explicit mode', (f) => delete f.policy.mode],
  ['wrong target', (f) => (f.repo.facts.database = 'retained_database')],
  ['role impersonation', (f) => (f.repo.facts.sessionUser = 'other_actor')],
  ['unsafe owner', (f) => (f.repo.facts.ownerSafe = false)],
  ['incomplete role graph', (f) => (f.repo.facts.graphComplete = false)],
  ['web SET reachability', (f) => (f.repo.facts.webCanSetOwner = true)],
  ['web inherited authority', (f) => (f.repo.facts.webCanInheritOwner = true)],
  ['unsupported membership options', (f) => (f.repo.facts.membershipOptionsSupported = false)],
])
  test('fails closed for ' + name, async () => {
    const f = fixture();
    change(f);
    await assert.rejects(run(f));
    assert.equal(f.repo.applied.length, 0);
    assert.ok(!f.repo.calls.includes('grant'));
  });
test('hash, order, encoding and transaction envelopes are checked before any transaction', async () => {
  const changes = [
    (f) => (f.drafts[0].bytes = Buffer.from('changed')),
    (f) => f.drafts.reverse(),
    (f) => {
      f.drafts[0].bytes = Buffer.from([0xff]);
      f.policy.draftSha256[f.drafts[0].file] = hash(f.drafts[0].bytes);
    },
    (f) => {
      f.drafts[0].bytes = Buffer.from(f.drafts[0].bytes.toString().replace('COMMIT;', 'ROLLBACK;'));
      f.policy.draftSha256[f.drafts[0].file] = hash(f.drafts[0].bytes);
    },
    (f) => {
      f.drafts[0].bytes = Buffer.from(
        f.drafts[0].bytes.toString().replace('DO $$', 'BEGIN;\nDO $$'),
      );
      f.policy.draftSha256[f.drafts[0].file] = hash(f.drafts[0].bytes);
    },
    (f) => {
      f.drafts[0].bytes = Buffer.from(
        f.drafts[0].bytes.toString().replace('DO $$', 'SET ROLE nextera_checkpoint_owner;\nDO $$'),
      );
      f.policy.draftSha256[f.drafts[0].file] = hash(f.drafts[0].bytes);
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    await assert.rejects(run(f));
    assert.deepEqual(f.repo.calls, []);
  }
});
for (const failAt of [
  'grant',
  'bad_grant',
  'first_draft',
  'second_draft',
  'revoke',
  'missing_revoke',
  'concurrent_graph',
  'identity',
  'audit',
])
  test('fake transaction aborts all changes on ' + failAt, async () => {
    const f = fixture(),
      before = structuredClone(f.repo.facts);
    f.repo.fail = failAt;
    await assert.rejects(run(f), (error) => {
      assert.equal(error.rollbackVerified, false);
      assert.ok(!JSON.stringify(error).includes('PRIVATE_'));
      return true;
    });
    assert.deepEqual(f.repo.facts, before);
    assert.equal(f.repo.applied.length, 0);
    assert.ok(f.repo.calls.includes('rollback'));
    assert.ok(!f.repo.calls.includes('commit'));
  });
test('commit uncertainty cannot become success or a rollback claim', async () => {
  const f = fixture();
  f.repo.ack = false;
  await assert.rejects(
    run(f),
    (e) => e.code === 'COMMIT_UNCERTAIN' && e.rollbackVerified === false,
  );
  assert.equal(f.repo.applied.length, 2);
  assert.ok(f.repo.calls.includes('commit'));
});
test('a transaction adapter cannot report success without completing the work', async () => {
  const f = fixture();
  f.repo.transaction = async () => ({ commitAcknowledged: true, value: {} });
  await assert.rejects(run(f), (e) => e.code === 'COMMIT_UNCERTAIN');
});
test('audit clock cannot move backwards', async () => {
  const f = fixture();
  let n = 0;
  f.runtime.nowMs = () => (n++ === 0 ? 100 : 99);
  await assert.rejects(run(f), (e) => e.code === 'CLOCK_INVALID');
  assert.equal(f.repo.applied.length, 0);
});
test('actual locked draft bodies retain guards and only lose their outer transaction envelope', async () => {
  const f = fixture();
  f.drafts = CHECKPOINT_CONTEXT_DRAFTS.map((file) => ({
    file,
    bytes: fs.readFileSync(new URL('../../packages/db/migration-drafts/' + file, import.meta.url)),
  }));
  f.policy.draftSha256 = Object.fromEntries(f.drafts.map((d) => [d.file, hash(d.bytes)]));
  await run(f);
  for (const [index, draft] of f.repo.applied.entries()) {
    const original = f.drafts[index].bytes.toString();
    assert.equal(draft.body, original.replace('BEGIN;', '').replace(/COMMIT;\s*$/, ''));
    assert.ok(draft.body.includes("pg_has_role(current_user,'nextera_checkpoint_owner','SET')"));
  }
});

test('claimed ADMIN authority without a direct existing ADMIN receipt is rejected', async () => {
  const f = fixture();
  f.repo.facts.memberships = [];
  await assert.rejects(run(f), (e) => e.code === 'GRANT_AUTHORITY_REQUIRED');
  assert.ok(!f.repo.calls.includes('grant'));
  assert.equal(f.repo.applied.length, 0);
});
test('non-catalog transaction identifiers cannot enter the audit trace', async () => {
  const f = fixture();
  f.repo.facts.transactionId = 'PRIVATE_DSN_SECRET';
  await assert.rejects(run(f), (e) => !JSON.stringify(e).includes('PRIVATE_DSN_SECRET'));
  assert.equal(f.repo.audit.length, 0);
  assert.ok(!f.repo.calls.includes('grant'));
});

test('adapter-supplied error codes and traces cannot expose private values', async () => {
  const f = fixture();
  f.repo.transaction = async () => {
    throw new MigrationContextError('PRIVATE_TOKEN_CODE', ['PRIVATE_TRACE']);
  };
  await assert.rejects(run(f), (error) => {
    assert.equal(error.code, 'TRANSACTION_FAILED');
    assert.deepEqual(error.trace, []);
    assert.ok(!JSON.stringify(error).includes('PRIVATE_'));
    return true;
  });
});

test('direct owner or web membership cannot be hidden by a false reachability attestation', async () => {
  for (const memberOid of [20, 30]) {
    const f = fixture();
    f.repo.facts.memberships.push({
      roleOid: 20,
      memberOid,
      grantorOid: 1,
      admin: false,
      inherit: false,
      set: false,
    });
    await assert.rejects(run(f), (e) => e.code === 'GRAPH_INVALID');
    assert.ok(!f.repo.calls.includes('grant'));
    assert.equal(f.repo.applied.length, 0);
  }
});
