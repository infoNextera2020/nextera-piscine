/* Pure source plan/proof-shape validation. No driver, connection, file, process,
 * credential, approval receipt or runtime-directory I/O. This is NOT an executor. */
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { REGISTERED_SOURCES } from './checkpoint-prerequisite-manifest.mjs';
import { EXECUTE_EDGES } from './checkpoint-prerequisite-repair.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export class InvitationAuthPlanError extends Error {
  constructor(code) {
    super('INVITATION_AUTH_PLAN_' + code);
    this.code = code;
  }
}
const reject = (code) => {
  throw new InvitationAuthPlanError(code);
};
export const INVITATION_AUTH_DRAFTS = freeze({
  '0019_prerequisite_execute_repair.DRAFT.sql':
    'aa313eb1ea95d653648856157084a1dc7df3ce960cef4a99fb952f9bfa25af3f',
  '0011_checkpoint_drafts.DRAFT.sql':
    'eaf3f7e95589fddf081f73084700ee994e9d87a775187d76f0d39d8d89e5a1e6',
  '0014_checkpoint_editor_context.DRAFT.sql':
    '8146ae6be34adfeacdbcaf3fb9e22b4a3516b9202eeee8cfaf3fbd88e81b78c3',
  '0013_invitations.DRAFT.sql': 'e20c9938753ddd7b0660f7240006fb65bb28a79ac1687f1629c1ce763ef4a675',
  '0020_invitation_issuance.DRAFT.sql':
    '3bba54e13b61b4bf76d33e65cc2446a34b09bef7e53984281914eef3cbefada4',
  '0016_invitation_operations.DRAFT.sql':
    'b2033271518a5079ca46f6678da3b103c0f05b17f137ee3437a2225358b58b49',
  '0018_invitation_admission.DRAFT.sql':
    '731047b27dfee25c017480ebe7ea5b499832fca771dc63d43d8aafdffaeaebf5',
});
export const INVITATION_AUTH_SQL_ORDER = freeze([
  ...Object.keys(REGISTERED_SOURCES).sort(),
  ...Object.keys(INVITATION_AUTH_DRAFTS),
]);
export const INVITATION_AUTH_CLOSED_DATABASES = freeze([
  'foundation_test_checkpoint_browser_20261028',
  'foundation_test_checkpoint_browser_20261029_attempt002',
  'foundation_test_checkpoint_browser_20261029_attempt003',
  'foundation_test_checkpoint_migration_adapter_20261029',
  'foundation_test_invitation_sql_20261030',
  'foundation_test_invitation_sql_20261030_attempt002',
]);
export const INVITATION_AUTH_REQUIRED_BINDINGS = freeze([
  'fresh_profile_and_source_lock_review',
  'target_bound_registered_dba_span_and_acl_repair_adapter',
  'target_bound_checkpoint_catalog_guard_and_transaction_adapter',
  'target_bound_invitation_owner_context_and_acl_adapter',
  'separate_restricted_issuer_activation_web_clients',
  'explicit_invitation_password_confirmation_rate_origin_and_name_policies',
  'real_api_path_without_direct_auth_or_enrollment_bypass',
  'uncertain_provider_identity_accounting_and_session_revocation',
  'independent_deadline_parent_loss_guard_and_shutdown_receipt',
  'fresh_authentic_owner_approval_and_verified_browser_context',
]);
const proofFlags = freeze([
  'publicExecuteDenied',
  'webOwnerSetDenied',
  'webOwnerInheritDenied',
  'webNoInvitationAuthority',
  'issuerOnlyIssuance',
  'activationCannotIssue',
  'temporaryMembershipsRestored',
  'actorAuthorityUnchanged',
]);
const exactKeys = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
function targetCopy(target) {
  if (INVITATION_AUTH_CLOSED_DATABASES.includes(target?.database)) reject('CLOSED_TARGET');
  if (
    !exactKeys(target, [
      'token',
      'database',
      'project',
      'directory',
      'migrationActor',
      'bootstrapDba',
      'issuerLogin',
      'activationLogin',
      'webLogin',
    ]) ||
    typeof target.token !== 'string' ||
    !/^[0-9]{8}_[a-z][a-z0-9_]{0,19}$/.test(target.token)
  )
    reject('TARGET_REQUIRED');
  const token = target.token,
    stem = token.replaceAll('_', '-');
  const expected = {
    token,
    database: 'foundation_test_week1_auth_' + token,
    project: '01coding-week1-auth-' + stem,
    directory: '/home/anas/.local/share/nextera-judge/week1-auth-' + stem + '/run-001',
    migrationActor: 'week1_auth_migrator_' + token,
    bootstrapDba: 'supabase_admin',
    issuerLogin: 'week1_auth_issuer_' + token,
    activationLogin: 'week1_auth_activate_' + token,
    webLogin: 'week1_auth_web_' + token,
  };
  if (Object.keys(expected).some((key) => target[key] !== expected[key])) reject('TARGET_BINDING');
  if (
    [
      expected.database,
      expected.migrationActor,
      expected.issuerLogin,
      expected.activationLogin,
      expected.webLogin,
    ].some((v) => v.length > 63)
  )
    reject('TARGET_BINDING');
  return freeze(expected);
}
/** Inputs are explicit source-review metadata, not action-time authorization.
 * Matching names does not establish that a target is unused; runtime preflight
 * must independently prove freshness. No existing closed allowlist is widened. */
export function prepareInvitationAuthMigrationPlan(settings, sources) {
  if (
    !exactKeys(settings, ['version', 'reviewedScopeSha256', 'reviewedHead', 'target', 'bounds']) ||
    settings.version !== 1 ||
    !digest(settings.reviewedScopeSha256) ||
    typeof settings.reviewedHead !== 'string' ||
    !/^[a-f0-9]{40}$/.test(settings.reviewedHead)
  )
    reject('REVIEW_REQUIRED');
  const target = targetCopy(settings.target),
    bounds = settings.bounds;
  if (
    !exactKeys(bounds, ['ownerApprovalStartSeconds', 'maximumSeconds', 'cleanupReserveSeconds']) ||
    bounds.ownerApprovalStartSeconds !== 600 ||
    bounds.maximumSeconds !== 3600 ||
    bounds.cleanupReserveSeconds !== 180
  )
    reject('BOUNDS_REQUIRED');
  if (!Array.isArray(sources) || sources.length !== INVITATION_AUTH_SQL_ORDER.length)
    reject('SOURCE_SCOPE');
  const metadata = INVITATION_AUTH_SQL_ORDER.map((file, index) => {
    const source = sources[index],
      expected = REGISTERED_SOURCES[file]?.sha256 ?? INVITATION_AUTH_DRAFTS[file];
    if (
      !exactKeys(source, ['file', 'bytes']) ||
      source.file !== file ||
      !Buffer.isBuffer(source.bytes)
    )
      reject('SOURCE_ORDER');
    // Copy before validating; no mutable SQL buffer is retained in the plan.
    const bytes = Buffer.from(source.bytes);
    if (hash(bytes) !== expected) reject('SOURCE_HASH');
    return { file, sha256: expected };
  });
  const steps = [
    ...metadata.slice(0, 11).map((file) => ({
      id: file.file,
      kind: 'registered_prerequisite',
      sources: [file],
      requiredAdapter: 'target_bound_registered_dba_spans',
    })),
    {
      id: metadata[11].file,
      kind: 'prerequisite_acl_repair',
      sources: [metadata[11]],
      requiredAdapter: 'target_bound_repair_27_execute_edges',
    },
    {
      id: 'checkpoint_draft_context',
      kind: 'checkpoint_atomic_pair',
      sources: metadata.slice(12, 14),
      requiredAdapter: 'verified_catalog_guard_and_restored_owner_context',
    },
    ...metadata.slice(14).map((file) => ({
      id: file.file,
      kind: 'invitation_draft',
      sources: [file],
      requiredAdapter: 'verified_invitation_owner_context',
    })),
  ];
  const body = {
    version: 1,
    status: 'source_prepared_runtime_unbound',
    runtimeReady: false,
    reviewedScopeSha256: settings.reviewedScopeSha256,
    reviewedHead: settings.reviewedHead,
    target,
    bounds: { ...bounds },
    steps,
    expectedExecuteEdgesSha256: hash(JSON.stringify(EXECUTE_EDGES)),
    roleBoundaries: {
      web: 'nextera_web',
      issuer: 'nextera_invitation_issuer',
      activation: 'nextera_invitation_runtime',
      owner: 'nextera_invitation_owner',
    },
    requiredProofs: [...proofFlags],
    requiredBindings: [...INVITATION_AUTH_REQUIRED_BINDINGS],
  };
  return freeze({ ...body, planSha256: hash(JSON.stringify(body)) });
}
/** Receipt shape checking only. This does not establish DB truth, runtime
 * approval, service readiness, or that unknown transactions rolled back. */
export function validateInvitationAuthMigrationReceipt(plan, receipt) {
  if (
    !plan ||
    plan.status !== 'source_prepared_runtime_unbound' ||
    plan.runtimeReady !== false ||
    !exactKeys(receipt, [
      'planSha256',
      'reviewedScopeSha256',
      'database',
      'migrationActor',
      'steps',
      'permissionProof',
    ])
  )
    reject('RECEIPT_SCOPE');
  if (
    receipt.planSha256 !== plan.planSha256 ||
    receipt.reviewedScopeSha256 !== plan.reviewedScopeSha256 ||
    receipt.database !== plan.target.database ||
    receipt.migrationActor !== plan.target.migrationActor
  )
    reject('RECEIPT_SCOPE');
  if (!Array.isArray(receipt.steps) || receipt.steps.length !== plan.steps.length)
    reject('RECEIPT_STEPS');
  for (let i = 0; i < plan.steps.length; i++) {
    const step = receipt.steps[i],
      expected = plan.steps[i];
    if (
      !exactKeys(step, [
        'id',
        'sources',
        'state',
        'connectionRoleBound',
        'transactionProofBound',
        'authorityRestored',
      ]) ||
      step.id !== expected.id ||
      JSON.stringify(step.sources) !== JSON.stringify(expected.sources) ||
      step.state !== 'commit_acknowledged' ||
      step.connectionRoleBound !== true ||
      step.transactionProofBound !== true ||
      step.authorityRestored !== true
    )
      reject('COMMIT_OR_PROOF_UNCERTAIN');
  }
  const proof = receipt.permissionProof;
  if (
    !exactKeys(proof, [...proofFlags, 'expectedExecuteEdgesSha256']) ||
    proof.expectedExecuteEdgesSha256 !== plan.expectedExecuteEdgesSha256 ||
    proofFlags.some((key) => proof[key] !== true)
  )
    reject('PERMISSION_PROOF');
  return freeze({ status: 'proof_shape_valid_runtime_unverified', planSha256: plan.planSha256 });
}
