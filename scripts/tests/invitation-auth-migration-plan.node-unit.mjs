import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import {
  INVITATION_AUTH_SQL_ORDER,
  INVITATION_AUTH_DRAFTS,
  INVITATION_AUTH_CLOSED_DATABASES,
  INVITATION_AUTH_REQUIRED_BINDINGS,
  prepareInvitationAuthMigrationPlan,
  validateInvitationAuthMigrationReceipt,
} from '../invitation-auth-migration-plan.mjs';
const clone = globalThis.structuredClone;
function fixture() {
  const token = '20261030_source001',
    stem = token.replaceAll('_', '-');
  const settings = {
    version: 1,
    reviewedScopeSha256: 'a'.repeat(64),
    reviewedHead: 'b'.repeat(40),
    target: {
      token,
      database: 'foundation_test_week1_auth_' + token,
      project: '01coding-week1-auth-' + stem,
      directory: '/home/anas/.local/share/nextera-judge/week1-auth-' + stem + '/run-001',
      migrationActor: 'week1_auth_migrator_' + token,
      bootstrapDba: 'supabase_admin',
      issuerLogin: 'week1_auth_issuer_' + token,
      activationLogin: 'week1_auth_activate_' + token,
      webLogin: 'week1_auth_web_' + token,
    },
    bounds: { ownerApprovalStartSeconds: 600, maximumSeconds: 3600, cleanupReserveSeconds: 180 },
  };
  const sources = INVITATION_AUTH_SQL_ORDER.map((file) => ({
    file,
    bytes: fs.readFileSync(
      new URL(
        '../../packages/db/' +
          (Object.hasOwn(INVITATION_AUTH_DRAFTS, file) ? 'migration-drafts/' : 'migrations/') +
          file,
        import.meta.url,
      ),
    ),
  }));
  return { settings, sources };
}
function receipt(plan) {
  return {
    planSha256: plan.planSha256,
    reviewedScopeSha256: plan.reviewedScopeSha256,
    database: plan.target.database,
    migrationActor: plan.target.migrationActor,
    steps: plan.steps.map((s) => ({
      id: s.id,
      sources: clone(s.sources),
      state: 'commit_acknowledged',
      connectionRoleBound: true,
      transactionProofBound: true,
      authorityRestored: true,
    })),
    permissionProof: {
      ...Object.fromEntries(plan.requiredProofs.map((key) => [key, true])),
      expectedExecuteEdgesSha256: plan.expectedExecuteEdgesSha256,
    },
  };
}
test('pure source plan preserves exact18SQLfiles, non-numeric invitation order and atomic checkpoint pair', () => {
  const f = fixture(),
    plan = prepareInvitationAuthMigrationPlan(f.settings, f.sources);
  assert.equal(f.sources.length, 18);
  assert.equal(plan.steps.length, 17);
  assert.deepEqual(
    plan.steps.at(-4).sources.map((s) => s.file),
    ['0013_invitations.DRAFT.sql'],
  );
  assert.deepEqual(
    plan.steps.slice(-4).map((s) => s.id),
    [
      '0013_invitations.DRAFT.sql',
      '0020_invitation_issuance.DRAFT.sql',
      '0016_invitation_operations.DRAFT.sql',
      '0018_invitation_admission.DRAFT.sql',
    ],
  );
  assert.deepEqual(
    plan.steps[12].sources.map((s) => s.file),
    ['0011_checkpoint_drafts.DRAFT.sql', '0014_checkpoint_editor_context.DRAFT.sql'],
  );
  assert.equal(plan.steps[11].kind, 'prerequisite_acl_repair');
  assert.equal(plan.runtimeReady, false);
  assert.deepEqual(plan.requiredBindings, INVITATION_AUTH_REQUIRED_BINDINGS);
  assert.ok(
    Object.isFrozen(plan) && Object.isFrozen(plan.target) && Object.isFrozen(plan.steps[0]),
  );
});
for (const database of INVITATION_AUTH_CLOSED_DATABASES)
  test('refuses closed target ' + database, () => {
    const f = fixture();
    f.settings.target.database = database;
    assert.throws(() => prepareInvitationAuthMigrationPlan(f.settings, f.sources), /CLOSED_TARGET/);
  });
for (const field of [
  'database',
  'project',
  'directory',
  'migrationActor',
  'bootstrapDba',
  'issuerLogin',
  'activationLogin',
  'webLogin',
])
  test('requires exact bound ' + field, () => {
    const f = fixture();
    f.settings.target[field] = 'nextera_web';
    assert.throws(
      () => prepareInvitationAuthMigrationPlan(f.settings, f.sources),
      /TARGET_BINDING/,
    );
  });
test('requires explicit immutable target and policy, not arbitrary fields or implicit bounds', () => {
  for (const mutate of [
    (f) => delete f.settings.bounds,
    (f) => (f.settings.bounds.maximumSeconds = 3601),
    (f) => (f.settings.bounds.ownerApprovalStartSeconds = 601),
    (f) => (f.settings.bounds.cleanupReserveSeconds = 179),
    (f) => (f.settings.reviewedScopeSha256 = 'bad'),
    (f) => (f.settings.reviewedHead = 'bad'),
    (f) => (f.settings.target.token = '../escape'),
    (f) => (f.settings.credentials = 'never'),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => prepareInvitationAuthMigrationPlan(f.settings, f.sources));
  }
});
for (const file of INVITATION_AUTH_SQL_ORDER)
  test('rejects altered source ' + file, () => {
    const f = fixture();
    const s = f.sources.find((s) => s.file === file);
    s.bytes = Buffer.concat([s.bytes, Buffer.from('\n')]);
    assert.throws(() => prepareInvitationAuthMigrationPlan(f.settings, f.sources), /SOURCE_HASH/);
  });
test('refuses missing repair, missing invitation source, duplicate source, extra migration and numeric sorting', () => {
  for (const mutate of [
    (f) => f.sources.splice(11, 1),
    (f) => f.sources.pop(),
    (f) => (f.sources[12] = f.sources[11]),
    (f) => f.sources.push(f.sources[0]),
    (f) => f.sources.sort((a, b) => a.file.localeCompare(b.file)),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(
      () => prepareInvitationAuthMigrationPlan(f.settings, f.sources),
      /SOURCE_(SCOPE|ORDER)/,
    );
  }
});
test('does not retain mutable SQL bytes or caller settings in its frozen plan', () => {
  const f = fixture(),
    plan = prepareInvitationAuthMigrationPlan(f.settings, f.sources);
  f.sources[0].bytes.fill(0);
  f.settings.target.database = 'retained';
  assert.match(plan.target.database, /foundation_test_week1_auth_/);
  assert.equal(JSON.stringify(plan).includes('bytes'), false);
});
test('accepts only structurally complete fake proof and still does not claim runtime verification', () => {
  const f = fixture(),
    p = prepareInvitationAuthMigrationPlan(f.settings, f.sources);
  assert.deepEqual(validateInvitationAuthMigrationReceipt(p, receipt(p)), {
    status: 'proof_shape_valid_runtime_unverified',
    planSha256: p.planSha256,
  });
});
for (const state of ['unknown', 'started', 'rollback_assumed', 'failed', 'committed_without_ack'])
  test('refuses ambiguous transaction state ' + state, () => {
    const f = fixture(),
      p = prepareInvitationAuthMigrationPlan(f.settings, f.sources),
      r = receipt(p);
    r.steps[5].state = state;
    assert.throws(() => validateInvitationAuthMigrationReceipt(p, r), /COMMIT_OR_PROOF_UNCERTAIN/);
  });
for (const key of ['connectionRoleBound', 'transactionProofBound', 'authorityRestored'])
  test('requires exact per-transaction proof ' + key, () => {
    const f = fixture(),
      p = prepareInvitationAuthMigrationPlan(f.settings, f.sources),
      r = receipt(p);
    r.steps[1][key] = false;
    assert.throws(() => validateInvitationAuthMigrationReceipt(p, r), /COMMIT_OR_PROOF_UNCERTAIN/);
  });
for (const flag of [
  'publicExecuteDenied',
  'webOwnerSetDenied',
  'webOwnerInheritDenied',
  'webNoInvitationAuthority',
  'issuerOnlyIssuance',
  'activationCannotIssue',
  'temporaryMembershipsRestored',
  'actorAuthorityUnchanged',
])
  test('requires permission assertion ' + flag, () => {
    const f = fixture(),
      p = prepareInvitationAuthMigrationPlan(f.settings, f.sources),
      r = receipt(p);
    r.permissionProof[flag] = false;
    assert.throws(() => validateInvitationAuthMigrationReceipt(p, r), /PERMISSION_PROOF/);
  });
test('refuses extra privileges, changed Execute edges, receipt target drift and incomplete proof order', () => {
  for (const mutate of [
    (r) => (r.permissionProof.superuser = true),
    (r) => (r.permissionProof.expectedExecuteEdgesSha256 = 'c'.repeat(64)),
    (r) => (r.database = 'retained'),
    (r) => (r.migrationActor = 'nextera_web'),
    (r) => r.steps.reverse(),
    (r) => r.steps.pop(),
    (r) => (r.steps[0].sources[0].sha256 = 'd'.repeat(64)),
    (r) => (r.steps[0].rollbackVerified = true),
  ]) {
    const f = fixture(),
      p = prepareInvitationAuthMigrationPlan(f.settings, f.sources),
      r = receipt(p);
    mutate(r);
    assert.throws(() => validateInvitationAuthMigrationReceipt(p, r));
  }
});
