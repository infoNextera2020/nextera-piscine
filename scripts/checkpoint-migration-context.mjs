/* Source-only contract. No database driver, CLI, credential, file or process adapter. */
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';

export const CHECKPOINT_CONTEXT_OWNER = 'nextera_checkpoint_owner';
export const CHECKPOINT_CONTEXT_DRAFTS = Object.freeze([
  '0011_checkpoint_drafts.DRAFT.sql',
  '0014_checkpoint_editor_context.DRAFT.sql',
]);
const CONTEXT_ERROR_CODES = new Set([
  'POLICY_REQUIRED',
  'DRAFT_SCOPE',
  'DRAFT_HASH',
  'DRAFT_ENCODING',
  'DRAFT_ENVELOPE',
  'DRAFT_GUARD',
  'FACTS_INVALID',
  'GRAPH_INVALID',
  'IDENTITY_CHANGED',
  'CLOCK_REQUIRED',
  'CLOCK_INVALID',
  'CONTEXT_REQUIRED',
  'GRANT_AUTHORITY_REQUIRED',
  'AMBIGUOUS_EXISTING_GRANT',
  'GRANT_NOT_EXACT',
  'RESTORATION_MISMATCH',
  'COMMIT_UNCERTAIN',
  'TRANSACTION_FAILED',
]);
export class MigrationContextError extends Error {
  constructor(code, trace = [], diagnostic = {}) {
    const safeCode = CONTEXT_ERROR_CODES.has(code) ? code : 'TRANSACTION_FAILED';
    super('CHECKPOINT_CONTEXT_' + safeCode);
    this.code = safeCode;
    this.trace = Object.freeze([...trace]);
    this.rollbackVerified = false;
    const stages = new Set([
      'begin',
      'guard_attestation',
      'catalog_lock',
      'facts',
      'grant',
      'draft',
      'revoke',
      'audit',
      'restore_check',
      'commit',
    ]);
    this.diagnostic = Object.freeze({
      stage: stages.has(diagnostic?.stage) ? diagnostic.stage : null,
      sqlstate:
        typeof diagnostic?.sqlstate === 'string' && /^[0-9A-Z]{5}$/.test(diagnostic.sqlstate)
          ? diagnostic.sqlstate
          : null,
    });
  }
}
const fail = (code) => {
  throw new MigrationContextError(code);
};
const oid = (n) => Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff;
const digest = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const identifier = (s) => typeof s === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(s);
function policyCopy(policy) {
  if (
    !policy ||
    policy.version !== 1 ||
    !digest(policy.approvedScopeSha256) ||
    typeof policy.database !== 'string' ||
    !/^foundation_test_[a-z0-9_]+$/.test(policy.database) ||
    !identifier(policy.principal) ||
    ['nextera_web', CHECKPOINT_CONTEXT_OWNER].includes(policy.principal) ||
    !['existing_only', 'temporary_self_membership'].includes(policy.mode) ||
    !policy.draftSha256 ||
    Object.keys(policy.draftSha256).sort().join() !==
      [...CHECKPOINT_CONTEXT_DRAFTS].sort().join() ||
    !Object.values(policy.draftSha256).every(digest)
  )
    fail('POLICY_REQUIRED');
  return Object.freeze({ ...policy, draftSha256: Object.freeze({ ...policy.draftSha256 }) });
}
function prepareBodies(policy, drafts) {
  if (!Array.isArray(drafts) || drafts.length !== 2) fail('DRAFT_SCOPE');
  return CHECKPOINT_CONTEXT_DRAFTS.map((file, index) => {
    const draft = drafts[index];
    if (
      !draft ||
      draft.file !== file ||
      !Buffer.isBuffer(draft.bytes) ||
      crypto.createHash('sha256').update(draft.bytes).digest('hex') !== policy.draftSha256[file]
    )
      fail('DRAFT_HASH');
    const text = draft.bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(draft.bytes)) fail('DRAFT_ENCODING');
    // Exact reviewed outer envelopes only; internal guards/body bytes are retained.
    const envelope = /^((?:[ \t]*(?:--[^\r\n]*)?\r?\n)*)BEGIN;([\s\S]*)COMMIT;\s*$/.exec(text);
    if (
      !envelope ||
      /\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i.test(envelope[2]) ||
      /\b(?:SET\s+ROLE|SET\s+(?:SESSION\s+)?AUTHORIZATION)\b/i.test(envelope[2])
    )
      fail('DRAFT_ENVELOPE');
    const body = envelope[1] + envelope[2];
    if (!body.includes("pg_has_role(current_user,'nextera_checkpoint_owner','SET')"))
      fail('DRAFT_GUARD');
    return Object.freeze({ file, sha256: policy.draftSha256[file], body });
  });
}
function factsCopy(facts, policy) {
  if (
    !facts ||
    facts.database !== policy.database ||
    facts.currentUser !== policy.principal ||
    facts.sessionUser !== policy.principal ||
    !oid(facts.principalOid) ||
    !oid(facts.ownerOid) ||
    !oid(facts.webOid) ||
    new Set([facts.principalOid, facts.ownerOid, facts.webOid]).size !== 3 ||
    typeof facts.transactionId !== 'string' ||
    !/^[0-9]{1,30}$/.test(facts.transactionId) ||
    facts.graphComplete !== true ||
    facts.membershipOptionsSupported !== true ||
    facts.ownerName !== CHECKPOINT_CONTEXT_OWNER ||
    facts.ownerSafe !== true ||
    facts.webCanSetOwner !== false ||
    facts.webCanInheritOwner !== false ||
    typeof facts.principalCanSetOwner !== 'boolean' ||
    !['none', 'admin_option', 'superuser'].includes(facts.grantAuthority) ||
    !Array.isArray(facts.memberships)
  )
    fail('FACTS_INVALID');
  const keys = new Set();
  const memberships = facts.memberships
    .map((row) => {
      if (
        !row ||
        row.roleOid !== facts.ownerOid ||
        row.memberOid === facts.ownerOid ||
        row.memberOid === facts.webOid ||
        !oid(row.memberOid) ||
        !oid(row.grantorOid) ||
        typeof row.admin !== 'boolean' ||
        typeof row.inherit !== 'boolean' ||
        typeof row.set !== 'boolean'
      )
        fail('GRAPH_INVALID');
      const key = `${row.roleOid}/${row.memberOid}/${row.grantorOid}`;
      if (keys.has(key)) fail('GRAPH_INVALID');
      keys.add(key);
      return Object.freeze({
        roleOid: row.roleOid,
        memberOid: row.memberOid,
        grantorOid: row.grantorOid,
        admin: row.admin,
        inherit: row.inherit,
        set: row.set,
      });
    })
    .sort(
      (a, b) => a.roleOid - b.roleOid || a.memberOid - b.memberOid || a.grantorOid - b.grantorOid,
    );
  return Object.freeze({ ...facts, memberships: Object.freeze(memberships) });
}
const graph = (facts) => JSON.stringify(facts.memberships);
function sameIdentity(a, b) {
  if (
    a.database !== b.database ||
    a.currentUser !== b.currentUser ||
    a.sessionUser !== b.sessionUser ||
    a.principalOid !== b.principalOid ||
    a.ownerOid !== b.ownerOid ||
    a.webOid !== b.webOid ||
    a.transactionId !== b.transactionId ||
    a.grantAuthority !== b.grantAuthority
  )
    fail('IDENTITY_CHANGED');
}

export function prepareCheckpointDraftMigration(policy, drafts) {
  const bound = policyCopy(policy);
  return Object.freeze({ policy: bound, bodies: Object.freeze(prepareBodies(bound, drafts)) });
}
export function validateCheckpointMigrationFacts(facts, policy) {
  return factsCopy(facts, policyCopy(policy));
}

/** Injection contract, not a live adapter or an authorization provider.
 * transaction(work) MUST use ONE connection/transaction, serialize the complete
 * owner membership graph, rollback on any failure, and resolve {commitAcknowledged,
 * value} only after server COMMIT acknowledgement. inspect() supplies server facts.
 * grantSelf()/revokeIntroduced() are constrained structured commands, never raw SQL.
 * A future adapter must quote identifiers, target only the existing owner->actor
 * grant, preserve grantor/options, use no CASCADE, and keep audit() in that transaction.
 * No implementation is connected to the runtime broker or application.
 */
export async function withCheckpointDraftMigrationContext(repository, policy, drafts, runtime) {
  const bound = policyCopy(policy),
    bodies = prepareBodies(bound, drafts),
    trace = [];
  if (!runtime || typeof runtime.nowMs !== 'function') fail('CLOCK_REQUIRED');
  let lastTime = -1,
    completed = false,
    expectedResult;
  const event = (kind, details = {}) => {
    const atMs = runtime.nowMs();
    if (!Number.isSafeInteger(atMs) || atMs < 0 || atMs < lastTime) fail('CLOCK_INVALID');
    lastTime = atMs;
    const value = Object.freeze({
      sequence: trace.length + 1,
      kind,
      atMs,
      approvedScopeSha256: bound.approvedScopeSha256,
      ...details,
    });
    trace.push(value);
    return value;
  };
  try {
    const result = await repository.transaction(async (tx) => {
      await tx.lockOwnerMemberships(CHECKPOINT_CONTEXT_OWNER);
      const before = factsCopy(await tx.inspect(), bound);
      await tx.audit(
        event('context_checked', {
          principal: before.currentUser,
          transactionId: before.transactionId,
          ownerRole: CHECKPOINT_CONTEXT_OWNER,
          initialMemberships: before.memberships,
        }),
      );
      let introduced = null;
      if (!before.principalCanSetOwner) {
        if (bound.mode !== 'temporary_self_membership') fail('CONTEXT_REQUIRED');
        if (
          before.grantAuthority !== 'admin_option' ||
          !before.memberships.some((m) => m.memberOid === before.principalOid && m.admin === true)
        )
          fail('GRANT_AUTHORITY_REQUIRED');
        if (
          before.memberships.some(
            (m) => m.memberOid === before.principalOid && m.grantorOid === before.principalOid,
          )
        )
          fail('AMBIGUOUS_EXISTING_GRANT');
        introduced = Object.freeze({
          roleOid: before.ownerOid,
          memberOid: before.principalOid,
          grantorOid: before.principalOid,
          admin: false,
          inherit: false,
          set: true,
        });
        await tx.audit(event('temporary_grant_requested', { grant: introduced }));
        await tx.grantSelf(introduced);
        const granted = factsCopy(await tx.inspect(), bound);
        sameIdentity(before, granted);
        const expected = [...before.memberships, introduced].sort(
          (a, b) =>
            a.roleOid - b.roleOid || a.memberOid - b.memberOid || a.grantorOid - b.grantorOid,
        );
        if (!granted.principalCanSetOwner || graph(granted) !== JSON.stringify(expected))
          fail('GRANT_NOT_EXACT');
        await tx.audit(event('temporary_grant_verified', { grant: introduced }));
      }
      for (const draft of bodies) {
        await tx.audit(event('draft_started', { file: draft.file, sha256: draft.sha256 }));
        await tx.applyDraft(draft);
        await tx.audit(event('draft_applied', { file: draft.file, sha256: draft.sha256 }));
      }
      if (introduced) {
        await tx.audit(event('temporary_revoke_requested', { grant: introduced }));
        await tx.revokeIntroduced(introduced);
      }
      const after = factsCopy(await tx.inspect(), bound);
      sameIdentity(before, after);
      if (
        graph(before) !== graph(after) ||
        before.principalCanSetOwner !== after.principalCanSetOwner
      )
        fail('RESTORATION_MISMATCH');
      await tx.audit(event('context_restored', { memberships: after.memberships }));
      expectedResult = Object.freeze({
        state: 'adapter_commit_acknowledged',
        mode: bound.mode,
        originalAuthorityPreserved: true,
        drafts: Object.freeze(bodies.map(({ file, sha256 }) => Object.freeze({ file, sha256 }))),
      });
      completed = true;
      return expectedResult;
    });
    if (!completed || result?.commitAcknowledged !== true || result.value !== expectedResult)
      fail('COMMIT_UNCERTAIN');
    return expectedResult;
  } catch (error) {
    const code = error instanceof MigrationContextError ? error.code : 'TRANSACTION_FAILED';
    // Raw adapter errors may contain credentials or SQL; retain controlled codes/trace only.
    throw new MigrationContextError(
      code,
      trace,
      error instanceof MigrationContextError ? error.diagnostic : {},
    );
  }
}
