/* Fresh-scope broker source. Import/preparation performs no I/O or key generation.
 * Only the explicit future controller may call executePhase after fresh admission.
 * Injected tests are not provider, PostgreSQL, Docker or browser conformance proof. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';
import { TextDecoder } from 'node:util';
import { execFileSync } from 'node:child_process';
import { REGISTERED_SOURCES, PREREQUISITE_FUNCTIONS } from './checkpoint-prerequisite-manifest.mjs';
import {
  EXECUTE_EDGES,
  FUNCTION_ACL_SQL,
  REPAIR_GRAPH_SQL,
  assertFunctionAcls,
} from './checkpoint-prerequisite-repair.mjs';
import { INVITATION_AUTH_DRAFTS } from './invitation-auth-migration-plan.mjs';

export const WEEK1_TARGET = Object.freeze({
  profile: 'week1-auth-20261030-invitation1',
  root: '/home/anas/.local/share/nextera-judge/week1-auth-20261030-invitation1/run-002',
  project: '01coding-week1-auth-20261030-invitation1',
  database: 'foundation_test_week1_auth_20261030_invitation1',
  origin: 'http://127.0.0.1:3151',
  authOrigin: 'http://127.0.0.1:56531',
  dbHost: '127.0.0.1',
  dbPort: 56532,
  dba: 'supabase_admin',
  actor: 'week1_auth_migrator_20261030_invitation1',
  roles: Object.freeze({
    issuer: 'week1_auth_issuer_20261030_invitation1',
    activation: 'week1_auth_activate_20261030_invitation1',
    web: 'week1_auth_web_20261030_invitation1',
  }),
});
export const WEEK1_SERVICES = Object.freeze([
  'db',
  'auth',
  'rest',
  'storage',
  'imgproxy',
  'meta',
  'studio',
  'api-gw',
]);
export const WEEK1_CHECKPOINT = Object.freeze({
  fixtureFile: 'tests/fixtures/checkpoints.ts',
  snapshotFile: 'infra/week1-auth-rehearsal/checkpoint-fixture.json',
  nodeKey: 'transfer-checkpoint',
  taskKey: 'normalize-label',
  durationSeconds: 5400,
  draftPolicy: Object.freeze({
    maxSourceBytes: 1024,
    maxReceiptsPerTask: 64,
    maxBytesPerTask: 65536,
    retentionAfterDeadlineSeconds: 600,
    offlineRecovery: false,
  }),
});
export const WEEK1_SQL_ORDER = Object.freeze([
  ...Object.keys(REGISTERED_SOURCES).sort(),
  '0019_prerequisite_execute_repair.DRAFT.sql',
  '0011_checkpoint_drafts.DRAFT.sql',
  '0014_checkpoint_editor_context.DRAFT.sql',
  '0013_invitations.DRAFT.sql',
  '0020_invitation_issuance.DRAFT.sql',
  '0016_invitation_operations.DRAFT.sql',
  '0018_invitation_admission.DRAFT.sql',
  '0023_invitation_runtime_readers.DRAFT.sql',
]);
const HASH = /^[a-f0-9]{64}$/,
  UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const check = (ok, code) => {
  if (!ok) throw new Error('WEEK1_BROKER_' + code);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => globalThis.structuredClone(v);
const freeze = (v) => {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
const sorted = (v) =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted(v[k])]),
        )
      : v;
export function week1ScopeSha256(spec) {
  const body = Object.fromEntries(
    Object.entries(spec).filter(([k]) => !['scopeSha256', 'status', 'runtimeReady'].includes(k)),
  );
  return digest(Buffer.from(JSON.stringify(sorted(body))));
}
const quote = (v) => {
  check(/^[a-z_][a-z0-9_]{0,62}$/.test(v), 'IDENTIFIER');
  return '"' + v + '"';
};
const literal = (v) => "'" + String(v).replaceAll("'", "''") + "'";
// Catalog facts are read back before publishing any web startup anchor. A successful
// CREATE/GRANT reply does not attest the exact LOGIN flags, membership or expiry.
export async function assertWeek1RestrictedLogin(client, role, member, cleanupAt) {
  const expected = {
    [WEEK1_TARGET.roles.issuer]: 'nextera_invitation_issuer',
    [WEEK1_TARGET.roles.activation]: 'nextera_invitation_runtime',
    [WEEK1_TARGET.roles.web]: 'nextera_web',
  };
  check(
    expected[role] === member && Number.isSafeInteger(cleanupAt) && cleanupAt > 0,
    'LOGIN_SCOPE',
  );
  const rows = await client.unsafe(
    `SELECT r.rolname,r.rolcanlogin,r.rolinherit,
    r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,r.rolreplication,
    r.rolconfig,(extract(epoch FROM r.rolvaliduntil)*1000)::bigint::text AS valid_until_ms,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('role',g.rolname,'admin',m.admin_option,
      'inherit',m.inherit_option,'set',m.set_option) ORDER BY g.rolname)
      FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles g ON g.oid=m.roleid
      WHERE m.member=r.oid),'[]'::jsonb) AS memberships
    FROM pg_catalog.pg_roles r WHERE r.rolname=$1`,
    [role],
  );
  check(rows.length === 1, 'LOGIN_CATALOG');
  const r = rows[0];
  check(
    r.rolname === role &&
      r.rolcanlogin === true &&
      r.rolinherit === true &&
      r.rolsuper === false &&
      r.rolcreatedb === false &&
      r.rolcreaterole === false &&
      r.rolbypassrls === false &&
      r.rolreplication === false &&
      r.rolconfig === null &&
      r.valid_until_ms === String(cleanupAt) &&
      same(r.memberships, [{ role: member, admin: false, inherit: true, set: false }]),
    'LOGIN_CATALOG',
  );
  return true;
}
// This sole public SQL leaf contains only current_setting substitutions. It is
// a container mount, never a credentials/config writer. All secret writers stay 0600.
export function writeWeek1PublicJwtTemplate(file, text, io = fs, uid = process.getuid?.()) {
  check(
    file === WEEK1_TARGET.root + '/stack/volumes/db/jwt.sql' &&
      typeof text === 'string' &&
      Number.isSafeInteger(uid) &&
      uid >= 0,
    'PUBLIC_SQL_SCOPE',
  );
  const fd = io.openSync(file, io.constants.O_RDWR | io.constants.O_NOFOLLOW);
  try {
    const before = io.fstatSync(fd);
    check(
      before.isFile() &&
        before.uid === uid &&
        before.nlink === 1 &&
        (before.mode & 0o777) === 0o644,
      'PUBLIC_SQL_METADATA',
    );
    io.ftruncateSync(fd, 0);
    io.writeFileSync(fd, text, 'utf8');
    io.fchmodSync(fd, 0o644);
    io.fsyncSync(fd);
    const after = io.fstatSync(fd),
      expected = Buffer.from(text, 'utf8'),
      observed = Buffer.alloc(expected.length);
    let offset = 0;
    while (offset < observed.length) {
      const n = io.readSync(fd, observed, offset, observed.length - offset, offset);
      check(Number.isInteger(n) && n > 0 && n <= observed.length - offset, 'PUBLIC_SQL_READBACK');
      offset += n;
    }
    check(
      after.isFile() &&
        after.uid === uid &&
        after.nlink === 1 &&
        before.dev === after.dev &&
        before.ino === after.ino &&
        (after.mode & 0o777) === 0o644 &&
        after.size === expected.length &&
        observed.equals(expected),
      'PUBLIC_SQL_READBACK',
    );
  } finally {
    io.closeSync(fd);
  }
}
export const WEEK1_LEARNERS = Object.freeze([
  Object.freeze({
    email: 'week1-a-20261030-invitation1@example.invalid',
    displayName: 'Week 1 Synthetic Learner A',
  }),
  Object.freeze({
    email: 'week1-b-20261030-invitation1@example.invalid',
    displayName: 'Week 1 Synthetic Learner B',
  }),
]);
function combinedCheckpointMode(spec) {
  check(
    ['auth-invitation-only', 'auth-invitation-checkpoint'].includes(spec?.rehearsalChecks),
    'REHEARSAL_CHECKS',
  );
  return spec.rehearsalChecks === 'auth-invitation-checkpoint';
}
export function week1RegistrationDriver(spec) {
  check(
    ['http-only', 'operator-browser-learner-b'].includes(spec?.registrationDriver),
    'REGISTRATION_DRIVER',
  );
  return spec.registrationDriver;
}
export function week1AuthPhases(spec, native = false) {
  return [
    'stage',
    'stack',
    ...(native ? ['baseline', 'migrate'] : ['migrations']),
    'bootstrap',
    'web',
    'invitations',
    ...(week1RegistrationDriver(spec) === 'operator-browser-learner-b' ? ['await_browser'] : []),
    'assert_http',
  ];
}

// These are synthetic operator QA receipts, never product authorization. Native
// Auth/enrollment facts below remain authoritative. No raw capability is retained.
export function validateWeek1BrowserProof(proof, acknowledgement, now) {
  const fields = [
    'version',
    'scopeSha256',
    'sourceLockSha256',
    'nonce',
    'issueRequestId',
    'tokenSha256',
    'origin',
    'email',
    'cohortId',
    'observedAt',
    'browser',
    'checks',
  ];
  check(proof && same(Object.keys(proof).sort(), fields.sort()), 'BROWSER_PROOF_FIELDS');
  for (const key of [
    'version',
    'scopeSha256',
    'sourceLockSha256',
    'nonce',
    'issueRequestId',
    'tokenSha256',
    'origin',
    'email',
    'cohortId',
  ])
    check(proof[key] === acknowledgement[key], 'BROWSER_PROOF_BINDING');
  check(
    proof.browser === 'chrome' &&
      Number.isSafeInteger(proof.observedAt) &&
      proof.observedAt >= acknowledgement.issuedAt &&
      proof.observedAt <= now &&
      proof.observedAt < acknowledgement.expiresAt &&
      now < acknowledgement.expiresAt,
    'BROWSER_PROOF_TIME',
  );
  const checks = [
    'fragmentRemoved',
    'inviteEmailFixed',
    'activationSucceeded',
    'ordinaryLoginSucceeded',
  ];
  check(
    proof.checks &&
      same(Object.keys(proof.checks).sort(), checks.sort()) &&
      checks.every((key) => proof.checks[key] === true),
    'BROWSER_PROOF_CHECKS',
  );
  return true;
}
export async function readWeek1BrowserFacts(
  client,
  { acknowledgement: ack, issuerId, curriculumVersionId },
  checkTime,
) {
  checkTime();
  check(
    UUID.test(ack.issueRequestId ?? '') &&
      HASH.test(ack.tokenSha256 ?? '') &&
      UUID.test(issuerId ?? '') &&
      UUID.test(ack.cohortId ?? '') &&
      UUID.test(curriculumVersionId ?? '') &&
      ack.email === WEEK1_LEARNERS[1].email &&
      ack.displayName === WEEK1_LEARNERS[1].displayName &&
      Number.isSafeInteger(ack.expiresAt),
    'BROWSER_NATIVE_SCOPE',
  );
  const rows = await client.unsafe(
    "SELECT u.auth_user_id::text AS \"authId\", u.id::text AS \"userId\" FROM app.invitation_acceptances a JOIN app.invitation_activations i ON i.id=a.invitation_id AND i.accepted_admission_id=a.id JOIN app.invitation_enrollment_receipts e ON e.invitation_id=i.id AND e.request_id=i.request_id AND e.admission_id=a.id AND e.auth_user_id=i.auth_user_id JOIN app.users u ON u.id=e.domain_user_id AND u.auth_user_id=i.auth_user_id JOIN auth.users au ON au.id=u.auth_user_id JOIN app.cohort_memberships m ON m.user_id=u.id AND m.cohort_id=e.cohort_id WHERE a.request_id=$1::uuid AND i.token_digest=$2 AND a.issuer_id=$3::uuid AND a.cohort_id=$4::uuid AND a.curriculum_version_id=$5::uuid AND e.cohort_id=a.cohort_id AND e.curriculum_version_id=a.curriculum_version_id AND a.email=$6 AND au.email=a.email AND a.display_name=$7 AND u.display_name=a.display_name AND a.expires_at_ms=$8 AND i.phase='complete' AND i.revoked_at IS NULL AND i.completed_at IS NOT NULL AND u.active AND u.role='learner' AND m.status='active'",
    [
      ack.issueRequestId,
      ack.tokenSha256,
      issuerId,
      ack.cohortId,
      curriculumVersionId,
      ack.email,
      ack.displayName,
      ack.expiresAt,
    ],
  );
  check(rows.length <= 1, 'BROWSER_NATIVE_DUPLICATE');
  checkTime();
  if (rows.length === 0) return null;
  check(
    same(Object.keys(rows[0]).sort(), ['authId', 'userId']) &&
      UUID.test(rows[0].authId ?? '') &&
      UUID.test(rows[0].userId ?? ''),
    'BROWSER_NATIVE_IDENTITY',
  );
  return { ...rows[0] };
}

export async function awaitWeek1BrowserRegistration({
  acknowledgement,
  readProof,
  readFacts,
  signIn,
  checkTime,
  now,
  sleep,
  deadline = Infinity,
}) {
  const cutoff = Math.min(now() + 150000, acknowledgement.expiresAt, deadline);
  while (now() < cutoff) {
    checkTime();
    const proof = await readProof();
    if (proof !== null) {
      validateWeek1BrowserProof(proof, acknowledgement, now());
      const facts = await readFacts(acknowledgement);
      if (facts !== null) {
        check(
          UUID.test(facts.authId ?? '') && UUID.test(facts.userId ?? ''),
          'BROWSER_NATIVE_FACTS',
        );
        checkTime();
        await signIn(facts);
        checkTime();
        check(same(await readFacts(acknowledgement), facts), 'BROWSER_NATIVE_FACTS_CHANGED');
        checkTime();
        check(now() < cutoff, 'BROWSER_WAIT_EXPIRED');
        return facts;
      }
    }
    await sleep(250);
  }
  throw new Error('WEEK1_BROKER_BROWSER_WAIT_EXPIRED');
}

export function week1LearnerSessionCount(spec, index) {
  const enabled = combinedCheckpointMode(spec);
  check(index === 0 || index === 1, 'LEARNER_SESSION_SCOPE');
  return enabled && index === 0 ? 2 : 1;
}
export async function runWeek1SelectedCheckpoint(spec, operation) {
  const enabled = combinedCheckpointMode(spec);
  check(typeof operation === 'function', 'CHECKPOINT_OPERATION');
  return enabled ? await operation() : null;
}
export function prepareWeek1AuthBroker(spec) {
  combinedCheckpointMode(spec);
  week1RegistrationDriver(spec);
  check(spec.hostGuardExecutionPolicy === 'process-RemoteSigned', 'HOST_GUARD_EXECUTION_POLICY');
  check(spec.hostGuardDriver === 'native-windows-parent-v1', 'HOST_GUARD_DRIVER');
  check(spec?.version === 1 && same(spec.target, WEEK1_TARGET), 'TARGET');
  check(
    HASH.test(spec.scopeSha256 ?? '') &&
      HASH.test(spec.sourceLockSha256 ?? '') &&
      /^[a-f0-9]{40}$/.test(spec.reviewedHead ?? ''),
    'REVIEW',
  );
  check(spec.scopeSha256 === week1ScopeSha256(spec), 'SCOPE_CONTENT');
  check(spec.buildBundler === 'webpack', 'ISOLATED_BUILD_MODE');
  check(same(spec.learners, WEEK1_LEARNERS), 'LEARNERS');
  check(
    spec.checkpoint &&
      same(
        Object.fromEntries(Object.keys(WEEK1_CHECKPOINT).map((k) => [k, spec.checkpoint[k]])),
        WEEK1_CHECKPOINT,
      ) &&
      HASH.test(spec.checkpoint.fixtureSha256 ?? '') &&
      HASH.test(spec.checkpoint.snapshotSha256 ?? '') &&
      HASH.test(spec.checkpoint.contentDigest ?? '') &&
      same(
        Object.keys(spec.checkpoint).sort(),
        [
          ...Object.keys(WEEK1_CHECKPOINT),
          'fixtureSha256',
          'snapshotSha256',
          'contentDigest',
        ].sort(),
      ),
    'CHECKPOINT_FIXTURE_SCOPE',
  );
  check(
    spec.bounds?.ownerApprovalStartSeconds === 600 &&
      spec.bounds?.maximumSeconds === 3600 &&
      spec.bounds?.cleanupReserveSeconds === 180,
    'BOUNDS',
  );
  check(
    spec.policy &&
      typeof spec.policy.emailConfirmed === 'boolean' &&
      spec.policy.passwordContract === 'ascii-synthetic-v1',
    'EXPLICIT_POLICY',
  );
  check(
    same(
      Object.keys(spec.policy.rates ?? {}).sort(),
      ['activate', 'ingress', 'inspect', 'issueIngress', 'issuer'].sort(),
    ),
    'RATE_POLICY',
  );
  for (const rate of Object.values(spec.policy.rates))
    check(
      typeof rate.profile === 'string' &&
        /^[a-z][a-z0-9_-]{0,63}$/.test(rate.profile) &&
        ['windowMs', 'maxRequests', 'retentionMs'].every(
          (k) => Number.isSafeInteger(rate[k]) && rate[k] > 0,
        ) &&
        rate.retentionMs >= rate.windowMs,
      'RATE_POLICY',
    );
  for (const name of [
    'minPasswordBytes',
    'maxPasswordBytes',
    'maxTokenBytes',
    'claimLeaseMs',
    'maxLifetimeMs',
    'maxBodyBytes',
    'bodyTimeoutMs',
    'publicTimeoutMs',
    'maxResponseBytes',
    'publicMaxPasswordBytes',
  ])
    check(Number.isSafeInteger(spec.policy[name]) && spec.policy[name] > 0, 'EXPLICIT_POLICY');
  check(
    spec.policy.maxTokenBytes === 43 &&
      spec.policy.minPasswordBytes <= spec.policy.maxPasswordBytes &&
      spec.policy.maxPasswordBytes === spec.policy.publicMaxPasswordBytes &&
      spec.policy.claimLeaseMs < spec.policy.maxLifetimeMs &&
      spec.policy.maxLifetimeMs <= 3600000,
    'EXPLICIT_POLICY',
  );
  check(
    Number.isSafeInteger(spec.maxLimiterReceipts) && spec.maxLimiterReceipts > 0,
    'LIMITER_CAPACITY',
  );
  check(
    Number.isSafeInteger(spec.authJwtSeconds) &&
      spec.authJwtSeconds > 0 &&
      spec.authJwtSeconds <= 300,
    'EXPLICIT_JWT_POLICY',
  );
  check(
    spec.cookieName === 'sb-127-auth-token' &&
      Number.isSafeInteger(spec.maxCookieBytes) &&
      spec.maxCookieBytes > 0 &&
      spec.maxCookieBytes <= 65536,
    'COOKIE_POLICY',
  );
  check(
    same(Object.keys(spec.images ?? {}).sort(), [...WEEK1_SERVICES].sort()) &&
      Object.values(spec.images).every((v) => /^.+@sha256:[a-f0-9]{64}$/.test(v)),
    'IMAGES',
  );
  check(same(spec.sqlOrder, WEEK1_SQL_ORDER) && HASH.test(spec.readersSha256 ?? ''), 'SQL_ORDER');
  return freeze(clone({ ...spec, status: 'source_prepared_not_authorized', runtimeReady: false }));
}

export function validateWeek1Lease(lease, now, mono, parent, guard, cleanup = false) {
  check(
    lease?.profile === WEEK1_TARGET.profile &&
      HASH.test(lease.scopeSha256 ?? '') &&
      HASH.test(lease.sourceLockSha256 ?? ''),
    'LEASE',
  );
  check(
    lease.deadline - lease.started === 3600000 &&
      lease.cleanupAt === lease.deadline - 180000 &&
      lease.monotonicDeadline - lease.monotonicStarted === 3600000,
    'LEASE_BOUNDS',
  );
  check(
    Number.isFinite(now) &&
      Number.isFinite(mono) &&
      now >= lease.started &&
      mono >= lease.monotonicStarted,
    'CLOCK',
  );
  check(
    cleanup
      ? now < lease.deadline - 30000 && mono < lease.monotonicDeadline - 30000
      : now < lease.cleanupAt && mono < lease.monotonicDeadline - 180000,
    'CUTOFF',
  );
  check(
    (cleanup || (parent?.pid === lease.parentPid && parent.ticks === lease.parentTicks)) &&
      guard?.pid === lease.guardPid &&
      guard.ticks === lease.guardTicks &&
      lease.parentPid !== guard.pid,
    'PROCESS_IDENTITY',
  );
}
const IDENTITY_SQL =
  'SELECT current_database()::text AS database,current_user::text AS actor,session_user::text AS session_actor,(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) AS super';
export const WEEK1_OWNER_GRAPH_SQL = REPAIR_GRAPH_SQL;
const OWNER_SQL = `SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,
 EXISTS(SELECT FROM pg_catalog.pg_auth_members WHERE member=r.oid) AS member
 FROM pg_catalog.pg_roles r WHERE rolname=$1`;
async function identity(sql, role) {
  const rows = await sql.unsafe(IDENTITY_SQL);
  check(
    rows.length === 1 &&
      same(
        { ...rows[0] },
        {
          database: WEEK1_TARGET.database,
          actor: role,
          session_actor: role,
          super: role === WEEK1_TARGET.dba,
        },
      ),
    'SQL_IDENTITY',
  );
}
async function setIdentity(sql, role) {
  await sql.unsafe('SET LOCAL SESSION AUTHORIZATION ' + quote(role));
  await identity(sql, role);
}
async function graph(sql) {
  const rows = await sql.unsafe(REPAIR_GRAPH_SQL);
  check(
    rows.length === 1 &&
      Array.isArray(rows[0].graph?.roles) &&
      Array.isArray(rows[0].graph?.memberships),
    'GRAPH',
  );
  return clone(rows[0].graph);
}
async function owner(sql, name) {
  const rows = await sql.unsafe(OWNER_SQL, [name]);
  check(
    rows.length === 1 &&
      rows[0].rolname === name &&
      [
        'rolcanlogin',
        'rolsuper',
        'rolbypassrls',
        'rolcreatedb',
        'rolcreaterole',
        'rolreplication',
        'member',
      ].every((k) => rows[0][k] === false),
    'OWNER_CONTEXT',
  );
}
const acl = (signature, ownerName, grantees = []) => [
  signature,
  ownerName,
  grantees.includes('nextera_web'),
  grantees.filter((v) => v !== 'nextera_web'),
];
const cp = (s, web = false) =>
  acl('app.' + s, 'nextera_checkpoint_owner', web ? ['nextera_web'] : []);
const iv = (s, grantees = []) => acl('app.' + s, 'nextera_invitation_owner', grantees);
export const WEEK1_DRAFT_ACLS = Object.freeze({
  '0011_checkpoint_drafts.DRAFT.sql': [
    cp('checkpoint_draft_record(app.checkpoint_draft_revisions)'),
    cp('guard_checkpoint_draft_revision()'),
    cp('guard_checkpoint_draft_policy()'),
    cp('checkpoint_draft_context(uuid,uuid,text)', true),
    cp('read_checkpoint_draft(uuid,uuid,text,text,uuid)', true),
    cp('save_checkpoint_draft(uuid,uuid,text,text,uuid,bigint,bytea,text)', true),
    cp('purge_expired_checkpoint_drafts(timestamptz,integer)'),
  ],
  '0014_checkpoint_editor_context.DRAFT.sql': [
    cp('checkpoint_editor_context(uuid,uuid,text)', true),
  ],
  '0013_invitations.DRAFT.sql': [acl('app.guard_invitation_activation()', WEEK1_TARGET.actor)],
  '0020_invitation_issuance.DRAFT.sql': [
    iv('guard_invitation_acceptance()'),
    iv('invitation_admission_current(uuid,text,text,uuid)'),
    iv('_invitation_issuer_guard()'),
    iv('invitation_issue(uuid,uuid,uuid,text,text,text,uuid,bigint)', [
      'nextera_invitation_issuer',
    ]),
  ],
  '0016_invitation_operations.DRAFT.sql': [
    iv('_invitation_operations_guard()'),
    ...[
      'invitation_operations_ready()',
      'invitation_find(text)',
      'invitation_claim(text,uuid,integer)',
      'invitation_advance(uuid,bigint,text,text,uuid)',
      'invitation_complete(uuid,bigint,uuid,text,text,uuid)',
      'invitation_release(uuid,bigint)',
    ].map((s) => iv(s, ['nextera_invitation_runtime'])),
  ],
  '0018_invitation_admission.DRAFT.sql': [
    iv('invitation_receipt_immutable()'),
    iv('_invitation_admission_guard()'),
    ...[
      'invitation_admission_ready(boolean)',
      'invitation_scope_current(uuid,uuid,text,text,uuid)',
      'invitation_enroll(uuid,bigint,uuid,text,text,uuid,uuid)',
      'invitation_rate_consume(text,text,text,text)',
    ].map((s) => iv(s, ['nextera_invitation_runtime'])),
  ],
  '0023_invitation_runtime_readers.DRAFT.sql': [
    iv('guard_invitation_runtime_policy()'),
    iv('guard_invitation_runtime_rate_binding()'),
    iv('guard_invitation_runtime_limit_receipt()'),
    iv('_invitation_runtime_binding(text,text,uuid,uuid,uuid,text)'),
    iv('invitation_runtime_policy_rows(text,text,uuid,uuid,uuid)', ['nextera_invitation_runtime']),
    iv('invitation_runtime_authority_rows(text,text,uuid,uuid,uuid)', [
      'nextera_invitation_issuer',
    ]),
    iv(
      'invitation_runtime_limit_consume(text,text,uuid,uuid,uuid,uuid,text,text,integer,integer,bigint)',
      ['nextera_invitation_issuer'],
    ),
  ],
});
const DRAFT_TABLES = {
  '0011_checkpoint_drafts.DRAFT.sql': ['checkpoint_draft_policies', 'checkpoint_draft_revisions'],
  '0014_checkpoint_editor_context.DRAFT.sql': [],
  '0013_invitations.DRAFT.sql': ['invitation_activations'],
  '0020_invitation_issuance.DRAFT.sql': [
    'invitation_issuance_policy',
    'invitation_acceptances',
    'invitation_activations',
  ],
  '0016_invitation_operations.DRAFT.sql': ['invitation_activations'],
  '0018_invitation_admission.DRAFT.sql': [
    'invitation_admission_policy',
    'invitation_rate_profiles',
    'invitation_rate_counters',
    'invitation_enrollment_receipts',
  ],
  '0023_invitation_runtime_readers.DRAFT.sql': [
    'invitation_runtime_profiles',
    'invitation_runtime_rate_bindings',
    'invitation_runtime_limit_counters',
    'invitation_runtime_limit_receipts',
  ],
};
const TABLE_ACL_SQL = `SELECT c.relname AS name,o.rolname AS owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS force,
 NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE a.grantee=0) AS no_public,
 ARRAY(SELECT DISTINCT r.rolname::text FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE a.grantee<>c.relowner ORDER BY r.rolname::text) AS grantees,
 ARRAY(SELECT v.role FROM (VALUES('nextera_web'),('nextera_invitation_issuer'),('nextera_invitation_runtime')) v(role) WHERE pg_catalog.has_table_privilege(v.role,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR pg_catalog.has_any_column_privilege(v.role,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) AS direct_clients
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles o ON o.oid=c.relowner WHERE n.nspname='app' AND c.relname=$1`;
async function tableAcls(sql, file) {
  const observed = [];
  for (const name of DRAFT_TABLES[file] ?? []) {
    const rows = await sql.unsafe(TABLE_ACL_SQL, [name]),
      r = rows[0],
      ledger = name === 'invitation_activations';
    const ownerName = name.startsWith('checkpoint_')
      ? 'nextera_checkpoint_owner'
      : ledger
        ? WEEK1_TARGET.actor
        : 'nextera_invitation_owner';
    check(
      rows.length === 1 &&
        r.owner === ownerName &&
        r.rls === true &&
        (name.startsWith('checkpoint_') || r.force === true) &&
        r.no_public === true &&
        same(r.direct_clients, []) &&
        Array.isArray(r.grantees) &&
        r.grantees.every((v) => ledger && v === 'nextera_invitation_owner'),
      'TABLE_ACL',
    );
    observed.push({ ...r });
  }
  return observed;
}
export async function applyWeek1Registered(client, file, input, checkTime, journal) {
  const binding = REGISTERED_SOURCES[file],
    bytes = Buffer.from(input);
  check(
    client.options?.prepare === false && binding && digest(bytes) === binding.sha256,
    'REGISTERED_SOURCE',
  );
  const chunks = [
    bytes.subarray(0, binding.start),
    bytes.subarray(binding.start, binding.end),
    bytes.subarray(binding.end),
  ];
  check(
    same(chunks.map(digest), [binding.prefixSha256, binding.dbaSha256, binding.suffixSha256]),
    'REGISTERED_SPANS',
  );
  await journal({ kind: 'migration', file, sha256: binding.sha256, state: 'intent' });
  let receipt;
  const result = await client.begin('isolation level read committed', async (sql) => {
    checkTime();
    await sql.unsafe(
      "SET LOCAL statement_timeout='15000ms';SET LOCAL lock_timeout='2000ms';SET LOCAL idle_in_transaction_session_timeout='20000ms'",
    );
    await setIdentity(sql, WEEK1_TARGET.actor);
    if (chunks[0].length) await sql.unsafe(chunks[0].toString('utf8'));
    if (chunks[1].length) {
      checkTime();
      await setIdentity(sql, WEEK1_TARGET.dba);
      await sql.unsafe(chunks[1].toString('utf8'));
      await setIdentity(sql, WEEK1_TARGET.actor);
    }
    checkTime();
    if (chunks[2].length) await sql.unsafe(chunks[2].toString('utf8'));
    await identity(sql, WEEK1_TARGET.actor);
    receipt = Object.freeze({ file, sha256: binding.sha256, actorRestoredBeforeCommit: true });
    return receipt;
  });
  check(result === receipt, 'COMMIT_UNCERTAIN');
  checkTime();
  await journal({ ...receipt, state: 'commit_acknowledged' });
  return receipt;
}
export async function applyWeek1ExecuteRepair(client, bytes, checkTime, journal) {
  check(
    client.options?.prepare === false &&
      digest(bytes) === INVITATION_AUTH_DRAFTS['0019_prerequisite_execute_repair.DRAFT.sql'],
    'REPAIR_SOURCE',
  );
  // The old draft has an immutable OLD target. Execute only its reviewed 27 edges
  // in this NEW exact context; never replace strings in or execute that old body.
  await journal({
    kind: 'migration',
    file: '0019_prerequisite_execute_repair.DRAFT.sql',
    state: 'intent',
  });
  let receipt;
  const result = await client.begin('isolation level read committed', async (sql) => {
    checkTime();
    await setIdentity(sql, WEEK1_TARGET.dba);
    await sql.unsafe(
      'LOCK TABLE pg_catalog.pg_authid,pg_catalog.pg_auth_members,pg_catalog.pg_proc,pg_catalog.pg_namespace IN SHARE ROW EXCLUSIVE MODE NOWAIT',
    );
    const before = await graph(sql);
    for (const [sig, expectedOwner, web, extra = []] of PREREQUISITE_FUNCTIONS) {
      const rows = await sql.unsafe(FUNCTION_ACL_SQL, [sig]),
        r = rows[0],
        allowed = [...(web ? ['nextera_web'] : []), ...extra];
      check(
        rows.length === 1 &&
          r.owner === expectedOwner &&
          r.no_public === true &&
          r.execute_only === true &&
          Array.isArray(r.grantees) &&
          r.grantees.every((g) => allowed.includes(g)),
        'REPAIR_PRE_ACL',
      );
    }
    for (const edge of EXECUTE_EDGES) {
      checkTime();
      await sql.unsafe(
        'GRANT EXECUTE ON FUNCTION ' + edge.signature + ' TO ' + quote(edge.grantee),
      );
    }
    const rows = await assertFunctionAcls(sql, PREREQUISITE_FUNCTIONS),
      after = await graph(sql);
    check(same(before, after), 'GRAPH_CHANGED');
    await identity(sql, WEEK1_TARGET.dba);
    receipt = Object.freeze({
      file: '0019_prerequisite_execute_repair.DRAFT.sql',
      functions: rows,
      graphSha256: digest(JSON.stringify(after)),
      actorAuthorityUnchanged: true,
    });
    return receipt;
  });
  check(result === receipt, 'COMMIT_UNCERTAIN');
  checkTime();
  await journal({ ...receipt, state: 'commit_acknowledged' });
  return receipt;
}
export async function applyWeek1Draft(
  client,
  file,
  input,
  expectedSha256,
  checkTime,
  journal,
  readersAcls,
) {
  const bytes = Buffer.from(input),
    expected = INVITATION_AUTH_DRAFTS[file] ?? expectedSha256;
  check(
    client.options?.prepare === false &&
      WEEK1_SQL_ORDER.includes(file) &&
      HASH.test(expected ?? '') &&
      digest(bytes) === expected,
    'DRAFT_SOURCE',
  );
  check(
    file !== '0019_prerequisite_execute_repair.DRAFT.sql' && !REGISTERED_SOURCES[file],
    'DRAFT_SCOPE',
  );
  const text = bytes.toString('utf8'),
    start = text.indexOf('\nBEGIN;\n');
  check(start >= 0 && text.endsWith('COMMIT;\n'), 'DRAFT_ENVELOPE');
  const body = text.slice(start + 8, -8),
    ownerName =
      file.startsWith('0011_') || file.startsWith('0014_')
        ? 'nextera_checkpoint_owner'
        : 'nextera_invitation_owner';
  const specs = WEEK1_DRAFT_ACLS[file];
  check(
    Array.isArray(specs) &&
      specs.length > 0 &&
      (!readersAcls ||
        same(readersAcls, WEEK1_DRAFT_ACLS['0023_invitation_runtime_readers.DRAFT.sql'])),
    'DRAFT_ACL_SPEC',
  );
  await journal({ kind: 'migration', file, sha256: expected, state: 'intent' });
  let receipt;
  const result = await client.begin('isolation level read committed', async (sql) => {
    checkTime();
    await setIdentity(sql, WEEK1_TARGET.dba);
    const before = await graph(sql);
    await owner(sql, ownerName);
    await sql.unsafe(
      'GRANT ' +
        quote(ownerName) +
        ' TO ' +
        quote(WEEK1_TARGET.actor) +
        ' WITH ADMIN FALSE,INHERIT FALSE,SET TRUE',
    );
    await setIdentity(sql, WEEK1_TARGET.actor);
    checkTime();
    await sql.unsafe(body);
    await setIdentity(sql, WEEK1_TARGET.dba);
    await sql.unsafe(
      'REVOKE ' + quote(ownerName) + ' FROM ' + quote(WEEK1_TARGET.actor) + ' RESTRICT',
    );
    const functions = await assertFunctionAcls(sql, specs),
      tables = await tableAcls(sql, file),
      after = await graph(sql);
    check(same(before, after), 'AUTHORITY_NOT_RESTORED');
    await owner(sql, ownerName);
    await identity(sql, WEEK1_TARGET.dba);
    receipt = Object.freeze({
      file,
      sha256: expected,
      functions,
      tables,
      authorityRestored: true,
      graphSha256: digest(JSON.stringify(after)),
    });
    return receipt;
  });
  check(result === receipt, 'COMMIT_UNCERTAIN');
  checkTime();
  await journal({ ...receipt, state: 'commit_acknowledged' });
  return receipt;
}

/** Concrete parameterized seed for this new isolated DB. Values must already be
 * part of the exact approved configuration/scope; no numerical policy defaults. */
export async function seedWeek1AuthPolicies(
  client,
  { configuration: c, lease, maxLimiterReceipts, issuerAuthId },
  checkTime,
  journal,
) {
  check(
    client.options?.prepare === false &&
      c?.profile === WEEK1_TARGET.profile &&
      c.target?.database === WEEK1_TARGET.database &&
      UUID.test(issuerAuthId ?? '') &&
      Number.isSafeInteger(maxLimiterReceipts) &&
      maxLimiterReceipts > 0 &&
      maxLimiterReceipts <= 2147483647,
    'SEED_SCOPE',
  );
  check(
    [c.issuerId, c.cohortId, c.curriculumVersionId].every((v) => UUID.test(v)) &&
      lease.cleanupAt === lease.deadline - 180000,
    'SEED_BINDING',
  );
  const publicHash = digest(Buffer.from(JSON.stringify(c) + '\n'));
  await journal({ kind: 'policy_seed', publicPolicySha256: publicHash, state: 'intent' });
  let receipt;
  const result = await client.begin('isolation level read committed', async (sql) => {
    checkTime();
    await identity(sql, WEEK1_TARGET.dba);
    const before = await graph(sql);
    const authority = await sql.unsafe(
      'SELECT u.id::text AS issuer_id,u.auth_user_id::text AS auth_id,u.role::text,u.active,c.id::text AS cohort_id,c.curriculum_version_id::text AS version_id,c.status::text AS cohort_status,v.status::text AS version_status FROM app.users u CROSS JOIN app.cohorts c JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id WHERE u.id=$1::uuid AND c.id=$2::uuid FOR SHARE OF u,c,v',
      [c.issuerId, c.cohortId],
    );
    check(
      authority.length === 1 &&
        same(
          { ...authority[0] },
          {
            issuer_id: c.issuerId,
            auth_id: issuerAuthId,
            role: 'admin',
            active: true,
            cohort_id: c.cohortId,
            version_id: c.curriculumVersionId,
            cohort_status: 'active',
            version_status: 'published',
          },
        ),
      'SEED_AUTHORITY',
    );
    await sql.unsafe(
      'INSERT INTO app.invitation_issuance_policy(issuer_id,cohort_id,curriculum_version_id,issuer_login,enabled,max_lifetime_ms) VALUES($1::uuid,$2::uuid,$3::uuid,$4::name,true,$5::bigint)',
      [
        c.issuerId,
        c.cohortId,
        c.curriculumVersionId,
        WEEK1_TARGET.roles.issuer,
        c.policy.maxLifetimeMs,
      ],
    );
    await sql.unsafe(
      "INSERT INTO app.invitation_admission_policy(singleton,enabled,email_confirmation_required,authority_contract) VALUES(true,true,$1::boolean,'nextera-invitation-admission-v1')",
      [c.policy.emailConfirmed],
    );
    for (const action of ['ingress', 'inspect', 'activate']) {
      const r = c.policy.rates[action];
      checkTime();
      await sql.unsafe(
        'INSERT INTO app.invitation_rate_profiles(id,action,enabled,window_ms,max_requests,retention_ms) VALUES($1::text,$2::text,true,$3::integer,$4::integer,$5::bigint)',
        [r.profile, action, r.windowMs, r.maxRequests, r.retentionMs],
      );
    }
    await sql.unsafe(
      'INSERT INTO app.invitation_runtime_profiles(profile,database_name,public_policy_sha256,issuer_id,issuer_auth_user_id,cohort_id,curriculum_version_id,issuer_login,activation_login,web_login,max_lifetime_ms,starts_at,expires_at,max_limiter_receipts,enabled,sealed_at) VALUES($1::text,$2::name,$3::text,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::name,$9::name,$10::name,$11::bigint,to_timestamp($12::numeric/1000),to_timestamp($13::numeric/1000),$14::integer,false,NULL)',
      [
        WEEK1_TARGET.profile,
        WEEK1_TARGET.database,
        publicHash,
        c.issuerId,
        issuerAuthId,
        c.cohortId,
        c.curriculumVersionId,
        WEEK1_TARGET.roles.issuer,
        WEEK1_TARGET.roles.activation,
        WEEK1_TARGET.roles.web,
        c.policy.maxLifetimeMs,
        lease.started,
        lease.cleanupAt,
        maxLimiterReceipts,
      ],
    );
    for (const [key, action] of [
      ['ingress', 'ingress'],
      ['inspect', 'inspect'],
      ['activate', 'activate'],
      ['issuer', 'issuer'],
      ['issueIngress', 'issue_ingress'],
    ]) {
      const r = c.policy.rates[key];
      checkTime();
      await sql.unsafe(
        'INSERT INTO app.invitation_runtime_rate_bindings(runtime_profile,action,rate_profile_id,window_ms,max_requests,retention_ms) VALUES($1::text,$2::text,$3::text,$4::integer,$5::integer,$6::bigint)',
        [WEEK1_TARGET.profile, action, r.profile, r.windowMs, r.maxRequests, r.retentionMs],
      );
    }
    await sql.unsafe(
      'UPDATE app.invitation_runtime_profiles SET enabled=true,sealed_at=to_timestamp($2::numeric/1000) WHERE profile=$1::text AND NOT enabled AND sealed_at IS NULL',
      [WEEK1_TARGET.profile, lease.started],
    );
    const rows = await sql.unsafe(
      'SELECT profile,database_name::text,public_policy_sha256,issuer_id::text,issuer_auth_user_id::text,cohort_id::text,curriculum_version_id::text,issuer_login::text,activation_login::text,web_login::text,max_lifetime_ms::text,(extract(epoch FROM starts_at)*1000)::bigint::text AS starts_ms,(extract(epoch FROM expires_at)*1000)::bigint::text AS expires_ms,max_limiter_receipts,enabled,sealed_at IS NOT NULL AS sealed FROM app.invitation_runtime_profiles WHERE profile=$1',
      [WEEK1_TARGET.profile],
    );
    check(
      rows.length === 1 &&
        same(
          { ...rows[0] },
          {
            profile: WEEK1_TARGET.profile,
            database_name: WEEK1_TARGET.database,
            public_policy_sha256: publicHash,
            issuer_id: c.issuerId,
            issuer_auth_user_id: issuerAuthId,
            cohort_id: c.cohortId,
            curriculum_version_id: c.curriculumVersionId,
            issuer_login: WEEK1_TARGET.roles.issuer,
            activation_login: WEEK1_TARGET.roles.activation,
            web_login: WEEK1_TARGET.roles.web,
            max_lifetime_ms: String(c.policy.maxLifetimeMs),
            starts_ms: String(lease.started),
            expires_ms: String(lease.cleanupAt),
            max_limiter_receipts: maxLimiterReceipts,
            enabled: true,
            sealed: true,
          },
        ),
      'SEED_NATIVE_ROWS',
    );
    const rates = await sql.unsafe(
      'SELECT action,rate_profile_id,window_ms,max_requests,retention_ms::text FROM app.invitation_runtime_rate_bindings WHERE runtime_profile=$1 ORDER BY action',
      [WEEK1_TARGET.profile],
    );
    const expected = [
      ['ingress', 'ingress'],
      ['inspect', 'inspect'],
      ['activate', 'activate'],
      ['issuer', 'issuer'],
      ['issueIngress', 'issue_ingress'],
    ]
      .map(([key, action]) => ({
        action,
        rate_profile_id: c.policy.rates[key].profile,
        window_ms: c.policy.rates[key].windowMs,
        max_requests: c.policy.rates[key].maxRequests,
        retention_ms: String(c.policy.rates[key].retentionMs),
      }))
      .sort((a, b) => a.action.localeCompare(b.action));
    check(
      same(
        rates.map((r) => ({ ...r })),
        expected,
      ),
      'SEED_NATIVE_RATES',
    );
    check(same(before, await graph(sql)), 'SEED_AUTHORITY_CHANGED');
    await identity(sql, WEEK1_TARGET.dba);
    checkTime();
    receipt = Object.freeze({
      publicPolicySha256: publicHash,
      registryRows: rows.map((r) => ({ ...r })),
      rateRows: rates.map((r) => ({ ...r })),
      authorityRestored: true,
    });
    return receipt;
  });
  check(result === receipt, 'SEED_COMMIT_UNCERTAIN');
  await journal({
    kind: 'policy_seed',
    publicPolicySha256: publicHash,
    state: 'commit_acknowledged',
  });
  return receipt;
}

/** Uses ordinary Auth sign-in and real application endpoints. No direct learner
 * Auth creation or enrollment exists in this port. Its HTTP calls are injectable. */
export function createWeek1AuthHttpPort({
  config,
  admin,
  ordinary,
  fetch: request,
  issuerCookie,
  uuid,
  checkTime,
  journal,
  savePrivate,
}) {
  const target = WEEK1_TARGET;
  const post = async (endpoint, input, cookie) => {
    checkTime();
    const response = await request(target.origin + endpoint, {
      method: 'POST',
      headers: {
        origin: target.origin,
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(input),
      redirect: 'error',
      cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(config.policy.bodyTimeoutMs),
    });
    check(
      !response.redirected && response.headers.get('content-type')?.startsWith('application/json'),
      'HTTP_RESPONSE',
    );
    check(response.body, 'HTTP_RESPONSE_BODY');
    const reader = response.body.getReader(),
      parts = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        check(total <= config.policy.maxResponseBytes, 'HTTP_RESPONSE_BOUND');
        parts.push(Buffer.from(part.value));
      }
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const value = JSON.parse(
      new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(parts, total)),
    );
    checkTime();
    return { http: response.status, value };
  };
  async function inventory() {
    const users = [];
    for (let page = 1; page <= 10; page++) {
      checkTime();
      const reply = await admin.listUsers({ page, perPage: 1000 });
      check(!reply.error && Array.isArray(reply.data?.users), 'AUTH_INVENTORY');
      for (const u of reply.data.users) {
        check(UUID.test(u.id) && typeof u.email === 'string', 'AUTH_INVENTORY');
        users.push({ id: u.id, email: u.email });
      }
      if (reply.data.users.length < 1000) {
        check(new Set(users.map((u) => u.id)).size === users.length, 'AUTH_DUPLICATE_ID');
        return users.sort((a, b) => a.id.localeCompare(b.id));
      }
    }
    throw new Error('WEEK1_BROKER_AUTH_INVENTORY_BOUND');
  }
  return Object.freeze({
    inventory,
    async proveEmpty() {
      const first = await inventory(),
        second = await inventory();
      check(first.length === 0 && second.length === 0, 'AUTH_NOT_FRESH_EMPTY');
      await journal({ kind: 'auth_baseline', state: 'verified_empty', count: 0 });
      return { count: 0, inventorySha256: digest(JSON.stringify(first)) };
    },
    async createIssuer(person) {
      await journal({
        kind: 'auth_create',
        operation: 'bootstrap_issuer',
        email: person.email,
        state: 'intent',
      });
      let reply;
      try {
        reply = await admin.createUser({
          email: person.email,
          password: person.password,
          email_confirm: config.policy.emailConfirmed,
        });
      } catch {
        throw new Error('WEEK1_BROKER_AUTH_CREATE_UNKNOWN');
      }
      check(!reply.error && UUID.test(reply.data?.user?.id ?? ''), 'AUTH_CREATE_UNPROVEN');
      await savePrivate({ kind: 'issuer_auth', id: reply.data.user.id });
      await journal({
        kind: 'auth_create',
        operation: 'bootstrap_issuer',
        state: 'acknowledged',
        id: reply.data.user.id,
      });
      return reply.data.user.id;
    },
    async issueOperatorLearner(person, scope, { intent, acknowledge, emit }) {
      check(
        same({ email: person.email, displayName: person.displayName }, WEEK1_LEARNERS[1]),
        'OPERATOR_LEARNER_SCOPE',
      );
      check(
        scope.registrationDriver === 'operator-browser-learner-b' &&
          HASH.test(scope.scopeSha256 ?? '') &&
          HASH.test(scope.sourceLockSha256 ?? ''),
        'OPERATOR_SCOPE',
      );
      const expiresAt = Math.min(config.cleanupAt, config.now() + config.policy.maxLifetimeMs);
      const receipt = {
        version: 1,
        scopeSha256: scope.scopeSha256,
        sourceLockSha256: scope.sourceLockSha256,
        nonce: uuid(),
        issueRequestId: uuid(),
        origin: target.origin,
        cohortId: config.cohortId,
        email: person.email,
        displayName: person.displayName,
        expiresAt,
      };
      check(
        UUID.test(receipt.nonce) &&
          UUID.test(receipt.issueRequestId) &&
          receipt.nonce !== receipt.issueRequestId,
        'OPERATOR_NONCE',
      );
      // EXCLUSIVE durable intent seals this lease even when issuance has an unknown outcome.
      await intent(receipt);
      checkTime();
      const response = await post(
        '/api/invitations/issue',
        {
          requestId: receipt.issueRequestId,
          cohortId: receipt.cohortId,
          email: receipt.email,
          displayName: receipt.displayName,
          expiresAt,
        },
        await issuerCookie(),
      );
      check(
        response.http === 201 &&
          response.value.status === 'issued' &&
          response.value.expiresAt === expiresAt,
        'OPERATOR_ISSUE_UNPROVEN',
      );
      const link = new URL(response.value.link);
      const token = new URLSearchParams(link.hash.slice(1)).get('invitation');
      check(
        link.origin === target.origin &&
          link.pathname === '/signup' &&
          !link.search &&
          /^[A-Za-z0-9_-]{43}$/.test(token ?? '') &&
          link.hash === '#invitation=' + token,
        'OPERATOR_LINK',
      );
      const acknowledgement = {
        ...receipt,
        tokenSha256: digest(Buffer.from(token, 'ascii')),
        issuedAt: config.now(),
      };
      await acknowledge(acknowledgement);
      const inspected = await post('/api/invitations/inspect', { token });
      check(
        inspected.http === 200 &&
          inspected.value.status === 'valid' &&
          inspected.value.email === receipt.email &&
          inspected.value.displayName === receipt.displayName &&
          same(Object.keys(inspected.value).sort(), ['displayName', 'email', 'status']),
        'OPERATOR_INSPECTION_BINDING',
      );
      checkTime();
      // Only the dedicated CLI may supply this transient output callback. Never journal it.
      await emit({ ...acknowledgement, url: link.href, password: person.password });
      return acknowledgement;
    },
    async activateLearner(person) {
      check(
        WEEK1_LEARNERS.some(
          (p) => p.email === person.email && p.displayName === person.displayName,
        ),
        'LEARNER_SCOPE',
      );
      const issuanceRequestId = uuid();
      await journal({
        kind: 'invitation_issue',
        requestId: issuanceRequestId,
        email: person.email,
        state: 'intent',
      });
      const expiresAt = Math.min(config.cleanupAt, config.now() + config.policy.maxLifetimeMs);
      const issued = await post(
        '/api/invitations/issue',
        {
          requestId: issuanceRequestId,
          cohortId: config.cohortId,
          email: person.email,
          displayName: person.displayName,
          expiresAt,
        },
        await issuerCookie(),
      );
      check(
        issued.http === 201 &&
          issued.value.status === 'issued' &&
          issued.value.expiresAt === expiresAt,
        'INVITATION_ISSUE_UNPROVEN',
      );
      const link = new URL(issued.value.link);
      check(
        link.origin === target.origin && link.pathname === '/signup' && !link.search,
        'INVITATION_LINK',
      );
      const token = new URLSearchParams(link.hash.slice(1)).get('invitation');
      check(/^[A-Za-z0-9_-]{43}$/.test(token ?? ''), 'INVITATION_TOKEN');
      const inspected = await post('/api/invitations/inspect', { token });
      check(
        inspected.http === 200 &&
          inspected.value.status === 'valid' &&
          inspected.value.email === person.email &&
          inspected.value.displayName === person.displayName &&
          same(Object.keys(inspected.value).sort(), ['displayName', 'email', 'status']),
        'INVITATION_INSPECTION_BINDING',
      );
      const requestId = uuid();
      // Persist only a one-way receipt digest, never the raw capability/link.
      await savePrivate({
        kind: 'activation_operation',
        email: person.email,
        requestId,
        tokenSha256: digest(Buffer.from(token, 'utf8')),
      });
      // This durable intent precedes the API which may create Auth, even if the
      // HTTP response/returned Auth ID is lost. Never retry/rotate on ambiguity.
      await journal({
        kind: 'auth_create',
        operation: 'invitation_activation',
        requestId,
        email: person.email,
        state: 'intent',
      });
      const activated = await post('/api/invitations/activate', {
        token,
        requestId,
        password: person.password,
        confirmation: person.password,
      });
      check(
        activated.http === 200 && activated.value.status === 'activated',
        'AUTH_ACTIVATION_UNKNOWN',
      );
      const used = await post('/api/invitations/inspect', { token });
      check(
        used.http === 409 && same(used.value, { status: 'used' }),
        'INVITATION_USED_INSPECTION',
      );
      const replayRequestId = uuid();
      check(replayRequestId !== requestId, 'INVITATION_REPLAY_ID');
      await journal({
        kind: 'invitation_replay_check',
        state: 'intent',
        requestId: replayRequestId,
        email: person.email,
      });
      const replay = await post('/api/invitations/activate', {
        token,
        requestId: replayRequestId,
        password: person.password,
        confirmation: person.password,
      });
      check(
        replay.http === 409 && same(replay.value, { status: 'used' }),
        'INVITATION_REPLAY_DENIAL',
      );
      await journal({
        kind: 'invitation_replay_check',
        state: 'rejected_used',
        requestId: replayRequestId,
      });
      const signed = await ordinary(person).auth.signInWithPassword({
        email: person.email,
        password: person.password,
      });
      check(
        !signed.error &&
          UUID.test(signed.data?.user?.id ?? '') &&
          signed.data.session?.access_token,
        'ORDINARY_SIGNIN',
      );
      await savePrivate({
        kind: 'learner_session',
        email: person.email,
        authId: signed.data.user.id,
        session: signed.data.session,
      });
      await journal({
        kind: 'auth_create',
        operation: 'invitation_activation',
        state: 'acknowledged',
        id: signed.data.user.id,
      });
      return signed.data.user.id;
    },
    async revokeInventory(passwordFor) {
      const inventoryRows = await inventory(),
        failures = [];
      for (const person of inventoryRows) {
        await journal({ kind: 'auth_cleanup', id: person.id, state: 'intent' });
        const password = passwordFor(person.email);
        try {
          if (!password) throw new Error('UNKNOWN_OWNED_ACCOUNT_CREDENTIAL');
          const signed = await ordinary(person).auth.signInWithPassword({
            email: person.email,
            password,
          });
          check(
            !signed.error &&
              signed.data.user?.id === person.id &&
              signed.data.session?.access_token,
            'CLEANUP_SIGNIN',
          );
          const revoked = await admin.signOut(signed.data.session.access_token, 'global');
          check(!revoked.error, 'GLOBAL_SIGNOUT');
        } catch {
          failures.push({ id: person.id, reason: 'provider_sessions_unverified' });
        }
        try {
          const banned = await admin.updateUserById(person.id, { ban_duration: '876000h' });
          check(!banned.error, 'AUTH_BAN');
        } catch {
          failures.push({ id: person.id, reason: 'ban_unverified' });
        }
      }
      const after = await inventory();
      check(same(inventoryRows, after), 'CLEANUP_INVENTORY_CHANGED');
      return { users: inventoryRows, failures };
    },
  });
}

/** Existing synthetic four-question/90-minute fixture only. Its packs are deliberately
 * non-runnable; this rehearsal never submits, grades, or tests natural expiry. */
export function parseWeek1CheckpointSnapshot(bytes, binding, sources) {
  check(
    binding.snapshotFile === WEEK1_CHECKPOINT.snapshotFile &&
      digest(bytes) === binding.snapshotSha256 &&
      sources[binding.snapshotFile] === binding.snapshotSha256 &&
      sources[binding.fixtureFile] === binding.fixtureSha256,
    'CHECKPOINT_SNAPSHOT_SOURCE',
  );
  const value = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
  check(
    value?.version === 1 &&
      same(
        Object.keys(value).sort(),
        ['version', 'generator', 'gitCommitSha', 'curriculum', 'evaluations'].sort(),
      ) &&
      value.generator &&
      same(Object.keys(value.generator).sort(), ['file', 'sha256']) &&
      value.generator.file === WEEK1_CHECKPOINT.fixtureFile &&
      value.generator.sha256 === binding.fixtureSha256 &&
      /^[a-f0-9]{40}$/.test(value.gitCommitSha ?? '') &&
      Array.isArray(value.evaluations),
    'CHECKPOINT_SNAPSHOT',
  );
  validateWeek1CheckpointFixture(value, binding);
  return value;
}
export function validateWeek1CheckpointFixture(fixture, binding) {
  const node = fixture?.curriculum?.nodes?.find((n) => n.key === WEEK1_CHECKPOINT.nodeKey),
    projection = fixture?.evaluations?.find((e) => e.nodeKey === WEEK1_CHECKPOINT.nodeKey);
  check(
    fixture?.curriculum?.contentDigest === binding.contentDigest &&
      node?.kind === 'checkpoint' &&
      projection?.checkpoint?.policyVersion === 1 &&
      projection.checkpoint.durationSeconds === WEEK1_CHECKPOINT.durationSeconds &&
      projection.checkpoint.tasks?.length === 4 &&
      same(
        projection.checkpoint.tasks.map((t) => t.key),
        ['normalize-label', 'count-vowels', 'digit-sum', 'sign-label'],
      ) &&
      projection.checkpoint.tasks.every(
        (t) =>
          t.evaluationSpec?.test_only === true &&
          String(t.evaluationSpec?.test_pack_artifact).startsWith(
            'oci:///non-runnable-checkpoint-fixture/',
          ),
      ) &&
      HASH.test(projection.digest ?? ''),
    'CHECKPOINT_FIXTURE',
  );
  return projection;
}
export async function seedWeek1CheckpointDraftPolicy(
  client,
  { versionId, definitionDigest, rehearsalChecks },
  checkTime,
  journal,
) {
  check(
    rehearsalChecks === 'auth-invitation-checkpoint' &&
      UUID.test(versionId ?? '') &&
      HASH.test(definitionDigest ?? '') &&
      client.options?.prepare === false,
    'CHECKPOINT_POLICY_SCOPE',
  );
  const p = WEEK1_CHECKPOINT.draftPolicy;
  await journal({ kind: 'checkpoint_draft_policy', state: 'intent' });
  let receipt;
  const result = await client.begin('isolation level read committed', async (sql) => {
    checkTime();
    await identity(sql, WEEK1_TARGET.dba);
    const definitions = await sql.unsafe(
      'SELECT definition_digest,definition FROM app.checkpoint_definitions WHERE curriculum_version_id=$1::uuid AND node_key=$2 FOR SHARE',
      [versionId, WEEK1_CHECKPOINT.nodeKey],
    );
    check(
      definitions.length === 1 &&
        definitions[0].definition_digest === definitionDigest &&
        definitions[0].definition?.durationSeconds === 5400 &&
        definitions[0].definition?.tasks?.length === 4,
      'CHECKPOINT_POLICY_DEFINITION',
    );
    checkTime();
    await sql.unsafe(
      'INSERT INTO app.checkpoint_draft_policies(curriculum_version_id,node_key,definition_digest,enabled,max_source_bytes,max_receipts_per_task,max_bytes_per_task,retention_after_deadline_seconds) VALUES($1::uuid,$2,$3,true,$4::integer,$5::integer,$6::bigint,$7::integer)',
      [
        versionId,
        WEEK1_CHECKPOINT.nodeKey,
        definitionDigest,
        p.maxSourceBytes,
        p.maxReceiptsPerTask,
        p.maxBytesPerTask,
        p.retentionAfterDeadlineSeconds,
      ],
    );
    const rows = await sql.unsafe(
      'SELECT definition_digest,enabled,max_source_bytes,max_receipts_per_task,max_bytes_per_task::text,retention_after_deadline_seconds FROM app.checkpoint_draft_policies WHERE curriculum_version_id=$1::uuid AND node_key=$2',
      [versionId, WEEK1_CHECKPOINT.nodeKey],
    );
    check(
      rows.length === 1 &&
        same(
          { ...rows[0] },
          {
            definition_digest: definitionDigest,
            enabled: true,
            max_source_bytes: 1024,
            max_receipts_per_task: 64,
            max_bytes_per_task: '65536',
            retention_after_deadline_seconds: 600,
          },
        ),
      'CHECKPOINT_POLICY_READBACK',
    );
    checkTime();
    receipt = Object.freeze({ definitionDigest, sourceBytes: 1024, offlineRecovery: false });
    return receipt;
  });
  check(result === receipt, 'CHECKPOINT_POLICY_COMMIT_UNCERTAIN');
  await journal({ kind: 'checkpoint_draft_policy', state: 'commit_acknowledged' });
  return receipt;
}

/** Real future calls use ordinary learner cookies and the existing HTTP routes.
 * Unit tests inject the entire transport/native readbacks; they create no sessions. */
export async function verifyWeek1CheckpointHttp({
  rehearsalChecks,
  fetch: send,
  learners,
  secondSession,
  cohortId,
  definitionDigest,
  uuid,
  checkTime,
  revoke,
  counts,
  receiptCount,
  journal,
}) {
  check(
    rehearsalChecks === 'auth-invitation-checkpoint' &&
      learners?.length === 2 &&
      learners.every(
        (p) =>
          UUID.test(p.authId ?? '') &&
          UUID.test(p.userId ?? '') &&
          UUID.test(p.sessionId ?? '') &&
          typeof p.cookie === 'string' &&
          p.cookie,
      ) &&
      UUID.test(cohortId ?? '') &&
      HASH.test(definitionDigest ?? '') &&
      secondSession?.authId === learners[0].authId &&
      UUID.test(secondSession.sessionId ?? '') &&
      secondSession.sessionId !== learners[0].sessionId &&
      learners[0].authId !== learners[1].authId &&
      learners[0].userId !== learners[1].userId &&
      typeof secondSession.cookie === 'string' &&
      secondSession.cookie &&
      secondSession.cookie !== learners[0].cookie,
    'CHECKPOINT_HTTP_SCOPE',
  );
  const [a, b] = learners,
    source = '\uFEFFpackage piscine\r\n// café exact draft\n',
    task = WEEK1_CHECKPOINT.taskKey;
  const request = async (person, url, init = {}) => {
    checkTime();
    const response = await send(WEEK1_TARGET.origin + url, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
      headers: { ...(init.headers ?? {}), ...(person ? { cookie: person.cookie } : {}) },
      signal: globalThis.AbortSignal.timeout(10000),
    });
    check(
      !response.redirected && response.headers.get('content-type')?.startsWith('application/json'),
      'CHECKPOINT_HTTP_JSON',
    );
    check(
      /no-store/.test(response.headers.get('cache-control') ?? '') || url === '/api/checkpoints',
      'CHECKPOINT_HTTP_CACHE',
    );
    const reader = response.body?.getReader();
    check(reader, 'CHECKPOINT_HTTP_BODY');
    const parts = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        check(size <= 1024 * 6 + 8192, 'CHECKPOINT_HTTP_SIZE');
        parts.push(Buffer.from(part.value));
      }
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const body = JSON.parse(
      new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(parts, size)),
    );
    checkTime();
    return { status: response.status, body };
  };
  const initialCounts = await counts();
  checkTime();
  check(
    same(initialCounts, { submissions: '0', jobs: '0', outcomes: '0' }),
    'CHECKPOINT_OFFICIAL_BASELINE',
  );
  const attempts = [];
  for (const person of learners) {
    const requestId = uuid();
    check(UUID.test(requestId), 'CHECKPOINT_REQUEST_ID');
    await journal({ kind: 'checkpoint_start', state: 'intent', authId: person.authId, requestId });
    checkTime();
    const started = await request(person, '/api/checkpoints', {
      method: 'POST',
      headers: {
        origin: WEEK1_TARGET.origin,
        'x-action': 'start',
        'x-cohort-id': cohortId,
        'x-node-key': WEEK1_CHECKPOINT.nodeKey,
        'idempotency-key': requestId,
      },
    });
    check(started.status === 202 && UUID.test(started.body.id ?? ''), 'CHECKPOINT_START');
    attempts.push(started.body.id);
  }
  check(attempts[0] !== attempts[1], 'CHECKPOINT_ATTEMPT_ISOLATION');
  const editor = (person, attempt) =>
    request(person, '/api/checkpoints/editor?' + new URLSearchParams({ attempt, task }));
  const boot = await editor(a, attempts[0]),
    scope = boot.body?.window?.scope;
  check(
    boot.status === 200 &&
      boot.body.schema === 1 &&
      same(scope, {
        learnerId: a.userId,
        cohortId,
        attemptId: attempts[0],
        taskKey: task,
        definitionDigest,
      }) &&
      boot.body.window.access === 'confirmed' &&
      boot.body.window.attempt === 'active' &&
      Date.parse(boot.body.window.serverNow) < Date.parse(boot.body.window.deadline) &&
      boot.body.sourceBytes === 1024 &&
      boot.body.filename === 'normalize.go' &&
      boot.body.draft === null &&
      boot.body.offlineRecovery === null &&
      boot.body.window.capabilities.draftsV1 === true &&
      typeof boot.body.window.capabilities.officialSubmit === 'boolean' &&
      boot.body.window.capabilities.visibleRun === null,
    'CHECKPOINT_BOOTSTRAP',
  );
  check((await editor(null, attempts[0])).status === 401, 'CHECKPOINT_ANONYMOUS');
  check((await editor(b, attempts[0])).status === 403, 'CHECKPOINT_CROSS_LEARNER_READ');
  const secondBoot = await editor(secondSession, attempts[0]);
  check(
    secondBoot.status === 200 &&
      secondBoot.body.draft === null &&
      same(secondBoot.body.window.scope, scope),
    'CHECKPOINT_SECOND_SESSION',
  );
  const write = (person, base, text, requestId = uuid(), definition = definitionDigest) =>
    request(person, '/api/checkpoints/drafts', {
      method: 'POST',
      headers: {
        origin: WEEK1_TARGET.origin,
        'content-type': 'application/octet-stream',
        'x-attempt-id': attempts[0],
        'x-task-key': task,
        'x-definition-digest': definition,
        'idempotency-key': requestId,
        'x-base-version': String(base),
      },
      body: Buffer.from(text, 'utf8'),
    });
  const saveId = uuid();
  await journal({ kind: 'checkpoint_draft_save', state: 'intent', requestId: saveId });
  const saved = await write(a, 0, source, saveId);
  check(
    saved.status === 200 &&
      same(saved.body, { source, version: 1, requestId: saveId, definitionDigest }),
    'CHECKPOINT_SAVE',
  );
  const retry = await write(secondSession, 0, source, saveId);
  check(retry.status === 200 && same(retry.body, saved.body), 'CHECKPOINT_SAVE_RETRY');
  const reload = await request(
    secondSession,
    '/api/checkpoints/drafts?' + new URLSearchParams({ attempt: attempts[0], task }),
  );
  check(reload.status === 200 && same(reload.body, saved.body), 'CHECKPOINT_EXACT_RELOAD');
  const concurrent = await Promise.all([
    write(a, 1, 'session one'),
    write(secondSession, 1, 'session two'),
  ]);
  check(same(concurrent.map((r) => r.status).sort(), [200, 409]), 'CHECKPOINT_CAS');
  const winner = concurrent.find((r) => r.status === 200),
    loser = concurrent.find((r) => r.status === 409);
  check(
    winner.body.version === 2 &&
      loser.body.error === 'DRAFT_CONFLICT' &&
      same(loser.body.current, winner.body),
    'CHECKPOINT_CONFLICT_CURRENT',
  );
  const final = await editor(a, attempts[0]);
  check(
    final.status === 200 &&
      final.body.draft?.version === 2 &&
      final.body.draft?.source === winner.body.source,
    'CHECKPOINT_CONFLICT_RELOAD',
  );
  check((await write(b, 2, 'forbidden')).status === 403, 'CHECKPOINT_CROSS_LEARNER_WRITE');
  check(
    (await write(a, 2, 'stale', uuid(), '0'.repeat(64))).status === 412,
    'CHECKPOINT_STALE_DEFINITION',
  );
  check((await write(a, 2, 'x'.repeat(1025))).status === 413, 'CHECKPOINT_SOURCE_CEILING');
  checkTime();
  await journal({ kind: 'checkpoint_access_revoke', state: 'intent', userId: a.userId });
  await revoke(a);
  checkTime();
  check(
    (await editor(a, attempts[0])).status === 403 &&
      (await editor(secondSession, attempts[0])).status === 403,
    'CHECKPOINT_REVOKED_READ',
  );
  check(
    (await write(a, 2, 'revoked')).status === 403 &&
      (await write(secondSession, 2, 'revoked')).status === 403,
    'CHECKPOINT_REVOKED_WRITE',
  );
  check((await editor(b, attempts[1])).status === 200, 'CHECKPOINT_OTHER_LEARNER_UNCHANGED');
  const finalCounts = await counts();
  checkTime();
  check(same(finalCounts, initialCounts), 'CHECKPOINT_SAVE_NOT_SUBMIT');
  check((await receiptCount(attempts[0], task)) === 2, 'CHECKPOINT_RECEIPTS');
  checkTime();
  return {
    synthetic: true,
    browserVerified: false,
    naturalDeadlineTested: false,
    legacyDurationSeconds: 5400,
    checks: [
      'ordinary_authenticated_start',
      'authoritative_bootstrap',
      'two_independent_sessions',
      'exact_save_reload',
      'idempotent_save',
      'two_session_cas_conflict',
      'cross_learner_read_write_denied',
      'stale_definition',
      'source_ceiling',
      'revocation_read_write_denied',
      'other_learner_unchanged',
      'save_not_official_submit',
    ],
    nativeCounts: finalCounts,
  };
}

export async function exerciseWeek1AuthInjected(io, plan) {
  const p = prepareWeek1AuthBroker(plan);
  await io.admit(p);
  await io.preflight(p);
  await io.admit(p);
  const reservation = await io.reserve(p);
  let passed, cleanupVerified;
  try {
    await io.guard(reservation);
    for (const phase of week1AuthPhases(p)) {
      await io.checkLease();
      await io.journal({ phase, state: 'intent' });
      await io.phase(phase, reservation);
    }
    await io.checkLease();
    passed = true;
  } catch {
    passed = false;
  } finally {
    try {
      await io.journal({ phase: 'cleanup', state: 'intent' });
      const result = await io.cleanup(reservation);
      cleanupVerified =
        result?.providerRevoked === true &&
        result.appDisabled === true &&
        result.sqlDisabled === true &&
        result.stopped === true &&
        result.retained === true;
    } catch {
      cleanupVerified = false;
    }
  }
  return {
    status: 'injected_lifecycle_only',
    assertionsPassed: passed,
    cleanupVerified,
    runtimeReady: false,
  };
}

/** Cleanup's provider and SQL branches are independent. A failed/ambiguous
 * inventory never prevents disabling application access or restricted logins.
 * Every success flag still requires concrete native count rows from verify. */
export function week1PendingAuthCreations(
  ledgerPending,
  { intent, acknowledgement, scopeSha256, email },
) {
  check(Number.isSafeInteger(ledgerPending) && ledgerPending >= 0, 'PENDING_AUTH_COUNT');
  if (!intent) {
    check(!acknowledgement, 'ISSUER_CREATE_INTENT_MISSING');
    return ledgerPending;
  }
  check(intent.scopeSha256 === scopeSha256 && intent.email === email, 'ISSUER_CREATE_SCOPE');
  if (!acknowledgement) return ledgerPending + 1;
  check(
    acknowledgement.scopeSha256 === scopeSha256 &&
      acknowledgement.email === email &&
      UUID.test(acknowledgement.authId ?? ''),
    'ISSUER_CREATE_ACK',
  );
  return ledgerPending;
}

export async function cleanupWeek1AuthAccess(io) {
  const failures = [];
  let provider = null,
    owned = [],
    appAttempt = false,
    sqlAttempt = false,
    counts = null;
  try {
    provider = await io.revokeProviderInventory();
    for (const failure of provider.failures ?? [])
      failures.push({ id: failure.id, reason: failure.reason });
  } catch {
    failures.push({ reason: 'provider_inventory_or_revocation_unverified' });
  }
  try {
    owned = await io.readOwnedAuthRows();
    check(
      Array.isArray(owned) &&
        owned.every((p) => UUID.test(p.id) && typeof p.email === 'string') &&
        new Set(owned.map((p) => p.id)).size === owned.length,
      'CLEANUP_NATIVE_INVENTORY',
    );
    const providerIds = new Set((provider?.users ?? []).map((p) => p.id));
    if (provider && !same([...providerIds].sort(), owned.map((p) => p.id).sort()))
      failures.push({ reason: 'provider_native_inventory_mismatch' });
    for (const person of owned)
      if (!providerIds.has(person.id)) {
        try {
          await io.banOwnedId(person.id);
        } catch {
          failures.push({ id: person.id, reason: 'fallback_ban_unverified' });
        }
      }
  } catch {
    failures.push({ reason: 'native_owned_inventory_unverified' });
  }
  try {
    await io.journal({ kind: 'application_access_disable', state: 'intent' });
    await io.disableApplication();
    appAttempt = true;
  } catch {
    failures.push({ reason: 'application_disable_unverified' });
  } finally {
    try {
      await io.journal({ kind: 'restricted_sql_disable', state: 'intent' });
      await io.disableSqlLogins();
      sqlAttempt = true;
    } catch {
      failures.push({ reason: 'sql_disable_unverified' });
    }
  }
  try {
    counts = await io.verifyAccess();
  } catch {
    failures.push({ reason: 'native_cleanup_counts_unverified' });
  }
  if (counts?.pending_auth_operations !== 0)
    failures.push({ reason: 'provider_creation_quiescence_unverified' });
  const zero = (key) => counts?.[key] === 0;
  return {
    providerRevoked:
      provider !== null &&
      !failures.some((f) => /provider|inventory|ban|native_cleanup/.test(f.reason)) &&
      zero('sessions') &&
      zero('refresh_tokens') &&
      zero('unbanned_users') &&
      zero('pending_auth_operations'),
    appDisabled: appAttempt && zero('active_users') && zero('active_memberships'),
    sqlDisabled: sqlAttempt && zero('logins') && zero('login_memberships'),
    inventoryIds: owned.map((p) => p.id),
    nativeCounts: counts,
    retained: true,
    failures,
  };
}

export function writeWeek1Private(file, value, io = fs) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  const fd = io.openSync(
    file,
    io.constants.O_WRONLY | io.constants.O_CREAT | io.constants.O_EXCL | io.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    io.writeFileSync(fd, bytes);
    io.fsyncSync(fd);
  } finally {
    io.closeSync(fd);
  }
  const directory = io.openSync(
    path.dirname(file),
    io.constants.O_RDONLY | io.constants.O_DIRECTORY,
  );
  try {
    io.fsyncSync(directory);
  } finally {
    io.closeSync(directory);
  }
  return digest(bytes);
}
function writePrivateText(file, text, replace = false) {
  const temporary = replace ? file + '.next' : file,
    fd = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (replace) fs.renameSync(temporary, file);
  const dir = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
export function projectWeek1WebCredentials(control, broker, config) {
  return {
    version: 1,
    profile: WEEK1_TARGET.profile,
    scopeSha256: control.scopeSha256,
    configurationSha256: digest(Buffer.from(JSON.stringify(config) + '\n')),
    sourceLockSha256: control.sourceLockSha256,
    started: control.started,
    deadline: control.deadline,
    authOrigin: WEEK1_TARGET.authOrigin,
    connections: { ...broker.connections },
    anonKey: broker.ANON_KEY,
    serviceRoleKey: broker.SERVICE_ROLE_KEY,
    cookieName: control.spec.cookieName,
    maxCookieBytes: control.spec.maxCookieBytes,
  };
}
export function buildWeek1Compose(template, images, binding) {
  check(
    HASH.test(binding?.scopeSha256 ?? '') && HASH.test(binding?.sourceLockSha256 ?? ''),
    'COMPOSE_SCOPE_LABELS',
  );
  check(same(Object.keys(images).sort(), [...WEEK1_SERVICES].sort()), 'IMAGES');
  const c = clone(template);
  c.name = WEEK1_TARGET.project;
  c.services = Object.fromEntries(
    WEEK1_SERVICES.map((name) => {
      const s = c.services?.[name];
      check(s && /^.+@sha256:[a-f0-9]{64}$/.test(images[name]), 'TEMPLATE');
      s.image = images[name];
      s.container_name = WEEK1_TARGET.project + '-' + name;
      s.restart = 'no';
      delete s.profiles;
      s.ports =
        name === 'db'
          ? ['127.0.0.1:56532:5432']
          : name === 'api-gw'
            ? ['127.0.0.1:56531:8000']
            : [];
      if (s.depends_on)
        s.depends_on = Object.fromEntries(
          Object.entries(s.depends_on).filter(([k]) => WEEK1_SERVICES.includes(k)),
        );
      for (const [k, v] of Object.entries(s.environment ?? {}))
        if (typeof v === 'string')
          s.environment[k] = v.replace(/\/postgres(?=\?|$)/g, '/' + WEEK1_TARGET.database);
      return [name, s];
    }),
  );
  Object.assign(c.services.db.environment, {
    POSTGRES_DB: WEEK1_TARGET.database,
    PGDATABASE: WEEK1_TARGET.database,
    POSTGRES_USER: WEEK1_TARGET.dba,
    JWT_SECRET: '${JWT_SECRET}',
    JWT_EXP: '${JWT_EXPIRY}',
  });
  c.services.auth.environment.GOTRUE_DB_DATABASE_URL =
    'postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@db:5432/' + WEEK1_TARGET.database;
  c.services.auth.environment.GOTRUE_DISABLE_SIGNUP = 'true';
  c.services.auth.environment.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED = 'false';
  c.services.rest.environment.PGRST_DB_URI =
    'postgres://authenticator:${POSTGRES_PASSWORD}@db:5432/' + WEEK1_TARGET.database;
  c.services.storage.environment.DATABASE_URL =
    'postgres://supabase_storage_admin:${POSTGRES_PASSWORD}@db:5432/' + WEEK1_TARGET.database;
  c.services.meta.environment.PG_META_DB_NAME = WEEK1_TARGET.database;
  for (const service of Object.values(c.services))
    service.labels = {
      ...(service.labels ?? {}),
      'io.nextera.week1.profile': WEEK1_TARGET.profile,
      'io.nextera.week1.scope': binding.scopeSha256,
      'io.nextera.week1.source': binding.sourceLockSha256,
      'io.nextera.week1.root': WEEK1_TARGET.root,
    };
  for (const [name, value] of Object.entries(c.volumes ?? {}))
    c.volumes[name] = { ...(value ?? {}), name: WEEK1_TARGET.project + '-' + name };
  c.networks = { default: { name: WEEK1_TARGET.project + '_default' } };
  return c;
}
export function validateWeek1EffectiveCompose(c, images) {
  check(
    c.name === WEEK1_TARGET.project &&
      same(Object.keys(c.services ?? {}).sort(), [...WEEK1_SERVICES].sort()),
    'EFFECTIVE_PROJECT',
  );
  for (const [name, s] of Object.entries(c.services)) {
    check(
      s.image === images[name] &&
        s.container_name === WEEK1_TARGET.project + '-' + name &&
        s.restart === 'no' &&
        !s.privileged &&
        !s.network_mode,
      'EFFECTIVE_SERVICE',
    );
    const ports = s.ports ?? [];
    if (name === 'db' || name === 'api-gw') {
      check(
        ports.length === 1 &&
          ports[0].host_ip === '127.0.0.1' &&
          Number(ports[0].published) === (name === 'db' ? 56532 : 56531),
        'EFFECTIVE_PORT',
      );
    } else check(ports.length === 0, 'EFFECTIVE_PORT');
    for (const mount of s.volumes ?? [])
      if (mount.type === 'bind')
        check(
          typeof mount.source === 'string' &&
            path.resolve(mount.source).startsWith(WEEK1_TARGET.root + '/stack/') &&
            !mount.source.includes('docker.sock'),
          'EFFECTIVE_MOUNT',
        );
  }
  for (const [name, v] of Object.entries(c.volumes ?? {}))
    check(!v.external && v.name === WEEK1_TARGET.project + '-' + name, 'EFFECTIVE_VOLUME');
  for (const v of Object.values(c.networks ?? {}))
    check(!v.external && v.name === WEEK1_TARGET.project + '_default', 'EFFECTIVE_NETWORK');
  for (const name of ['auth', 'rest', 'storage'])
    check(
      JSON.stringify(c.services[name].environment).includes('/' + WEEK1_TARGET.database),
      'EFFECTIVE_DATABASE',
    );
  return true;
}

/* Native phase implementation intentionally has no automatically supplied approval.
 * Controller starts this only after protected source/lease/guard verification. */
export async function executePhase(phase, run, repo, operatorOutput) {
  check(phase !== 'operator_handoff' || typeof operatorOutput === 'function', 'OPERATOR_PIPE_ONLY');
  check(
    [
      'stage',
      'baseline',
      'migrate',
      'bootstrap',
      'invitations',
      'await_browser',
      'operator_handoff',
      'assert_http',
      'cleanup',
    ].includes(phase),
    'PHASE_ALLOWLIST',
  );
  check(run === WEEK1_TARGET.root, 'RUN');
  const rootStat = fs.lstatSync(run);
  check(
    rootStat.isDirectory() &&
      !rootStat.isSymbolicLink() &&
      rootStat.uid === process.getuid() &&
      (rootStat.mode & 0o777) === 0o700,
    'PRIVATE_ROOT',
  );
  const privateRead = (name) => {
    const fd = fs.openSync(path.join(run, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const before = fs.fstatSync(fd);
      check(
        before.isFile() &&
          before.uid === process.getuid() &&
          (before.mode & 0o777) === 0o600 &&
          before.size > 0 &&
          before.size <= 1048576,
        'PRIVATE_FILE',
      );
      const bytes = fs.readFileSync(fd);
      const after = fs.fstatSync(fd);
      check(
        before.dev === after.dev &&
          before.ino === after.ino &&
          before.size === after.size &&
          before.mtimeMs === after.mtimeMs &&
          before.ctimeMs === after.ctimeMs &&
          bytes.length === before.size,
        'PRIVATE_FILE_CHANGED',
      );
      return JSON.parse(bytes.toString('utf8'));
    } finally {
      fs.closeSync(fd);
    }
  };
  const control = privateRead('broker-control.private.json'),
    spec = prepareWeek1AuthBroker(control.spec);
  check(
    control.scopeSha256 === spec.scopeSha256 && control.sourceLockSha256 === spec.sourceLockSha256,
    'CONTROL_SCOPE_BINDING',
  );
  const proc = (pid) => ({
    pid,
    ticks: fs
      .readFileSync('/proc/' + pid + '/stat', 'utf8')
      .split(') ')
      .at(-1)
      .split(' ')[19],
  });
  const checkTime = () =>
    validateWeek1Lease(
      control,
      Date.now(),
      Number(process.hrtime.bigint() / 1000000n),
      phase === 'cleanup' ? null : proc(control.parentPid),
      proc(control.guardPid),
      phase === 'cleanup',
    );
  checkTime();
  const frozen = fs.readFileSync(run + '/adapter-code/week1-auth-source-lock.json');
  check(digest(frozen) === control.sourceLockSha256, 'SOURCE_LOCK');
  const lock = JSON.parse(frozen);
  check(
    digest(fs.readFileSync(fileURLToPath(import.meta.url))) ===
      lock.sources['scripts/week1-auth-live-broker.mjs'],
    'BROKER_SOURCE_LOCK',
  );
  const source = phase === 'stage' ? repo : run + '/app-source',
    req = createRequire(source + '/package.json');
  req('tsx/cjs');
  const journal = async (event) => {
    const fd = fs.openSync(
      run + '/operations.private.jsonl',
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_APPEND |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fs.writeSync(fd, JSON.stringify({ scopeSha256: control.scopeSha256, ...event }) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  };
  const save = (name, value) => writeWeek1Private(run + '/' + name, value);
  if (phase === 'stage') {
    const generic = await import('./checkpoint-auth-runtime.mjs');
    fs.mkdirSync(run + '/stack', { mode: 0o700 });
    generic.copyVerifiedPublicTemplates(control.template, run + '/stack', lock.templates);
    const dotenv = req('dotenv'),
      yaml = req('yaml'),
      values = dotenv.parse(fs.readFileSync(run + '/stack/.env.example'));
    Object.assign(values, {
      POSTGRES_DB: WEEK1_TARGET.database,
      POSTGRES_HOST: 'db',
      POSTGRES_PORT: '5432',
      SUPABASE_PUBLIC_URL: WEEK1_TARGET.authOrigin,
      API_EXTERNAL_URL: WEEK1_TARGET.authOrigin + '/auth/v1',
      SITE_URL: WEEK1_TARGET.origin,
      ADDITIONAL_REDIRECT_URLS: WEEK1_TARGET.origin,
      DISABLE_SIGNUP: 'true',
      ENABLE_ANONYMOUS_USERS: 'false',
      ENABLE_PHONE_SIGNUP: 'false',
      ENABLE_EMAIL_SIGNUP: 'true',
      ENABLE_EMAIL_AUTOCONFIRM: String(spec.policy.emailConfirmed),
      JWT_EXPIRY: String(spec.authJwtSeconds),
    });
    for (const k of [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'OPENAI_API_KEY',
      'LOGFLARE_PUBLIC_ACCESS_TOKEN',
      'LOGFLARE_PRIVATE_ACCESS_TOKEN',
    ])
      values[k] = '';
    const c = buildWeek1Compose(
      yaml.parse(fs.readFileSync(run + '/stack/docker-compose.yml', 'utf8')),
      spec.images,
      spec,
    );
    generic.writePrivateText(run + '/stack/docker-compose.yml', yaml.stringify(c));
    writeWeek1PublicJwtTemplate(run + '/stack/volumes/db/jwt.sql', generic.DB_JWT_INIT_SQL);
    generic.validateInitEnvironment([generic.DB_JWT_INIT_SQL], c.services.db.environment);
    for (const key of [
      'POSTGRES_PASSWORD',
      'JWT_SECRET',
      'PG_META_CRYPTO_KEY',
      'DASHBOARD_PASSWORD',
      'S3_PROTOCOL_ACCESS_KEY_SECRET',
      'SECRET_KEY_BASE',
      'REALTIME_DB_ENC_KEY',
      'VAULT_ENC_KEY',
      'S3_PROTOCOL_ACCESS_KEY_ID',
      'ANON_KEY',
      'SERVICE_ROLE_KEY',
    ])
      values[key] = 'SOURCE_REVIEW_PLACEHOLDER_NOT_FOR_START';
    writePrivateText(
      run + '/stack/.env',
      Object.entries(values)
        .map(([k, v]) => k + '=' + v + '\n')
        .join(''),
    );
    const effective = JSON.parse(
      execFileSync(
        'docker',
        [
          '--host',
          'unix:///var/run/docker.sock',
          'compose',
          '--project-name',
          WEEK1_TARGET.project,
          '--project-directory',
          run + '/stack',
          '--env-file',
          run + '/stack/.env',
          '-f',
          run + '/stack/docker-compose.yml',
          'config',
          '--format',
          'json',
        ],
        {
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            DOCKER_CONFIG: run + '/docker-client',
          },
          timeout: 20000,
          encoding: 'utf8',
        },
      ),
    );
    validateWeek1EffectiveCompose(effective, spec.images);
    save('effective-compose-before-keys.private.json', effective);
    // Guard is revalidated immediately before the first random/secret operation.
    checkTime();
    await journal({ kind: 'credentials', state: 'intent' });
    for (const k of [
      'POSTGRES_PASSWORD',
      'JWT_SECRET',
      'PG_META_CRYPTO_KEY',
      'DASHBOARD_PASSWORD',
      'S3_PROTOCOL_ACCESS_KEY_SECRET',
    ])
      values[k] = crypto.randomBytes(32).toString('hex');
    for (const [k, size] of [
      ['SECRET_KEY_BASE', 48],
      ['REALTIME_DB_ENC_KEY', 8],
      ['VAULT_ENC_KEY', 16],
      ['S3_PROTOCOL_ACCESS_KEY_ID', 16],
    ])
      values[k] = crypto.randomBytes(size).toString('hex');
    const jwt = (role) => {
      const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
      const unsigned =
        enc({ alg: 'HS256', typ: 'JWT' }) +
        '.' +
        enc({
          role,
          iss: 'supabase',
          iat: Math.floor(control.started / 1000),
          exp: Math.floor(control.deadline / 1000),
        });
      return (
        unsigned +
        '.' +
        crypto.createHmac('sha256', values.JWT_SECRET).update(unsigned).digest('base64url')
      );
    };
    values.ANON_KEY = jwt('anon');
    values.SERVICE_ROLE_KEY = jwt('service_role');
    const credentials = {
      ...values,
      issuer: {
        email: 'week1-issuer-20261030-invitation1@example.invalid',
        password: crypto.randomBytes(24).toString('hex'),
      },
      learners: WEEK1_LEARNERS.map((p) => ({
        ...p,
        password: crypto.randomBytes(24).toString('hex'),
      })),
      connections: {},
    };
    save('broker-credentials.private.json', credentials);
    writePrivateText(
      run + '/stack/.env',
      Object.entries(values)
        .map(([k, v]) => k + '=' + v + '\n')
        .join(''),
      true,
    );
    return;
  }
  const credentials = privateRead('broker-credentials.private.json'),
    postgres = req('postgres');
  const admin = postgres({
    host: WEEK1_TARGET.dbHost,
    port: WEEK1_TARGET.dbPort,
    database: WEEK1_TARGET.database,
    username: WEEK1_TARGET.dba,
    password: credentials.POSTGRES_PASSWORD,
    prepare: false,
    max: 1,
    connect_timeout: 3,
    idle_timeout: 3,
    onnotice: () => {},
  });
  const { createClient } = req('@supabase/supabase-js'),
    auth = createClient(WEEK1_TARGET.authOrigin, credentials.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.admin;
  const ordinary = () =>
    createClient(WEEK1_TARGET.authOrigin, credentials.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const config = {
    ...(fs.existsSync(run + '/server-configuration.json')
      ? privateRead('server-configuration.json')
      : {}),
    policy: spec.policy,
    cleanupAt: control.cleanupAt,
    now: () => Date.now(),
  };
  const secrets = [];
  const http = createWeek1AuthHttpPort({
    config,
    admin: auth,
    ordinary,
    fetch: globalThis.fetch,
    issuerCookie: async () => privateRead('issuer-session.private.json').cookie,
    uuid: () => crypto.randomUUID(),
    checkTime,
    journal,
    savePrivate: async (value) => {
      secrets.push(value);
      save('operation-' + crypto.randomUUID() + '.private.json', value);
    },
  });
  async function learnerCookieSessions(index, person, authId) {
    checkTime();
    const reqWeb = createRequire(source + '/apps/web/package.json');
    const { createServerClient } = reqWeb('@supabase/ssr');
    const users = await admin.unsafe(
      "SELECT u.id::text AS id FROM app.users u JOIN app.cohort_memberships m ON m.user_id=u.id WHERE u.auth_user_id=$1::uuid AND u.role='learner' AND u.active AND m.cohort_id=$2::uuid AND m.status='active'",
      [authId, config.cohortId],
    );
    check(users.length === 1 && UUID.test(users[0].id), 'CHECKPOINT_LEARNER_BINDING');
    // The second login creates a distinct provider session for learner A;
    // it is never a copied cookie pretending to be a second device.
    for (let session = 0; session < week1LearnerSessionCount(spec, index); session++) {
      const jar = [];
      const client = createServerClient(WEEK1_TARGET.authOrigin, credentials.ANON_KEY, {
        cookieOptions: { name: spec.cookieName },
        cookies: {
          getAll: () => jar,
          setAll: (items) => {
            for (const item of items) {
              const old = jar.find((v) => v.name === item.name);
              if (old) old.value = item.value;
              else jar.push({ name: item.name, value: item.value });
            }
          },
        },
      });
      const login = await client.auth.signInWithPassword({
        email: person.email,
        password: person.password,
      });
      check(
        !login.error && login.data.user?.id === authId && login.data.session,
        'LEARNER_COOKIE_SIGNIN',
      );
      const claims = JSON.parse(
        Buffer.from(login.data.session.access_token.split('.')[1] ?? '', 'base64url').toString(
          'utf8',
        ),
      );
      check(claims.sub === authId && UUID.test(claims.session_id ?? ''), 'LEARNER_SESSION_ID');
      save('learner-' + index + (session === 1 ? '-second' : '') + '-session.private.json', {
        sessionId: claims.session_id,
        authId,
        userId: users[0].id,
        cookie: jar.map((c) => c.name + '=' + c.value).join('; '),
      });
    }
  }
  const operatorScope = () => ({
    registrationDriver: spec.registrationDriver,
    scopeSha256: control.scopeSha256,
    sourceLockSha256: control.sourceLockSha256,
  });
  const readBrowserFacts = (ack) =>
    readWeek1BrowserFacts(
      admin,
      {
        acknowledgement: ack,
        issuerId: config.issuerId,
        curriculumVersionId: config.curriculumVersionId,
      },
      checkTime,
    );

  try {
    await identity(admin, WEEK1_TARGET.dba);
    if (phase === 'baseline') {
      await http.proveEmpty();
      save('auth-baseline.private.json', { scopeSha256: control.scopeSha256, empty: true });
      return;
    }
    if (phase === 'migrate') {
      const sqlSource = (file) => {
        const relative = REGISTERED_SOURCES[file]
            ? 'packages/db/migrations/'
            : 'packages/db/migration-drafts/',
          bytes = fs.readFileSync(source + '/' + relative + file);
        check(digest(bytes) === lock.sources[relative + file], 'SOURCE');
        return bytes;
      };
      // Roles are scoped to this fresh instance. No old target guard is widened.
      await journal({ kind: 'migration_roles', state: 'intent' });
      await admin.unsafe(
        'CREATE ROLE ' +
          quote(WEEK1_TARGET.actor) +
          ' NOLOGIN NOINHERIT CREATEROLE NOSUPERUSER NOCREATEDB NOBYPASSRLS NOREPLICATION',
      );
      await admin.unsafe(
        'ALTER DATABASE ' + quote(WEEK1_TARGET.database) + ' OWNER TO ' + quote(WEEK1_TARGET.actor),
      );
      for (const file of Object.keys(REGISTERED_SOURCES).sort())
        await applyWeek1Registered(admin, file, sqlSource(file), checkTime, journal);
      await admin.unsafe('ALTER ROLE ' + quote(WEEK1_TARGET.actor) + ' NOCREATEROLE');
      await applyWeek1ExecuteRepair(
        admin,
        sqlSource('0019_prerequisite_execute_repair.DRAFT.sql'),
        checkTime,
        journal,
      );
      for (const role of [
        'nextera_invitation_owner',
        'nextera_invitation_issuer',
        'nextera_invitation_runtime',
      ])
        await admin.unsafe(
          'CREATE ROLE ' +
            quote(role) +
            ' NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION',
        );
      const readers = WEEK1_DRAFT_ACLS['0023_invitation_runtime_readers.DRAFT.sql'];
      for (const file of WEEK1_SQL_ORDER.slice(12))
        await applyWeek1Draft(
          admin,
          file,
          sqlSource(file),
          spec.readersSha256,
          checkTime,
          journal,
          readers,
        );
      return;
    }
    if (phase === 'bootstrap') {
      // The separately scope-bound existing synthetic legacy fixture is the only
      // catalog here. It cannot be mistaken for the approved real Exam1 or grading.
      const { drizzle } = req('drizzle-orm/postgres-js'),
        schema = req(source + '/packages/db/schema/index.ts'),
        domain = drizzle(admin, { schema });
      const fixtureBytes = fs.readFileSync(source + '/' + WEEK1_CHECKPOINT.fixtureFile);
      check(
        digest(fixtureBytes) === spec.checkpoint.fixtureSha256 &&
          lock.sources[WEEK1_CHECKPOINT.fixtureFile] === spec.checkpoint.fixtureSha256,
        'CHECKPOINT_FIXTURE_SOURCE',
      );
      const loaded = parseWeek1CheckpointSnapshot(
          fs.readFileSync(source + '/' + WEEK1_CHECKPOINT.snapshotFile),
          spec.checkpoint,
          lock.sources,
        ),
        checkpointProjection = validateWeek1CheckpointFixture(loaded, spec.checkpoint);
      const version = await req(source + '/packages/db/operations/curriculum.ts').importCurriculum(
        domain,
        loaded.curriculum,
        loaded.gitCommitSha,
        loaded.evaluations,
      );
      const cohort = await req(source + '/packages/db/operations/cohorts.ts').createCohort(domain, {
        slug: WEEK1_TARGET.profile,
        name: 'Week 1 genuine invitation rehearsal',
        curriculumVersionId: version.id,
        startsAt: new Date(control.started),
      });
      await runWeek1SelectedCheckpoint(spec, () =>
        seedWeek1CheckpointDraftPolicy(
          admin,
          {
            versionId: String(version.id),
            definitionDigest: checkpointProjection.digest,
            rehearsalChecks: spec.rehearsalChecks,
          },
          checkTime,
          journal,
        ),
      );
      save('issuer-create-intent.private.json', {
        scopeSha256: control.scopeSha256,
        email: credentials.issuer.email,
      });
      const issuerAuthId = await http.createIssuer(credentials.issuer);
      save('issuer-create-ack.private.json', {
        scopeSha256: control.scopeSha256,
        email: credentials.issuer.email,
        authId: issuerAuthId,
      });
      const [issuer] = await admin.unsafe(
        "INSERT INTO app.users(auth_user_id,display_name,role,active) VALUES($1::uuid,'Week 1 Synthetic Issuer','admin',true) RETURNING id",
        [issuerAuthId],
      );
      const final = {
        version: 1,
        profile: WEEK1_TARGET.profile,
        scopeSha256: control.scopeSha256,
        sourceLockSha256: control.sourceLockSha256,
        reviewedHead: spec.reviewedHead,
        target: {
          root: WEEK1_TARGET.root,
          project: WEEK1_TARGET.project,
          database: WEEK1_TARGET.database,
          origin: WEEK1_TARGET.origin,
          authOrigin: WEEK1_TARGET.authOrigin,
          dbHost: WEEK1_TARGET.dbHost,
          dbPort: WEEK1_TARGET.dbPort,
          roles: WEEK1_TARGET.roles,
        },
        issuerId: String(issuer.id),
        cohortId: String(cohort.id),
        curriculumVersionId: String(version.id),
        learners: WEEK1_LEARNERS,
        policy: spec.policy,
      };
      save('server-configuration.json', final);
      save('fixture.private.json', {
        issuerAuthId,
        issuerId: String(issuer.id),
        cohortId: String(cohort.id),
        curriculumVersionId: String(version.id),
        checkpointDefinitionDigest: checkpointProjection.digest,
      });
      await seedWeek1AuthPolicies(
        admin,
        {
          configuration: final,
          lease: control,
          maxLimiterReceipts: spec.maxLimiterReceipts,
          issuerAuthId,
        },
        checkTime,
        journal,
      );
      for (const [key, role] of Object.entries(WEEK1_TARGET.roles)) {
        const password = crypto.randomBytes(32).toString('hex'),
          member = {
            issuer: 'nextera_invitation_issuer',
            activation: 'nextera_invitation_runtime',
            web: 'nextera_web',
          }[key];
        await journal({ kind: 'restricted_login', role, state: 'intent' });
        await admin.unsafe(
          'CREATE ROLE ' +
            quote(role) +
            ' LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION VALID UNTIL ' +
            literal(new Date(control.cleanupAt).toISOString()) +
            ' PASSWORD ' +
            literal(password),
        );
        await admin.unsafe(
          'GRANT ' +
            quote(member) +
            ' TO ' +
            quote(role) +
            ' WITH ADMIN FALSE,INHERIT TRUE,SET FALSE',
        );
        checkTime();
        await assertWeek1RestrictedLogin(admin, role, member, control.cleanupAt);
        checkTime();
        credentials.connections[key] =
          'postgres://' + role + ':' + password + '@127.0.0.1:56532/' + WEEK1_TARGET.database;
      }
      // Private broker material is rewritten atomically by the controller helper.
      const next = run + '/broker-credentials.next.private.json';
      writeWeek1Private(next, credentials);
      fs.renameSync(next, run + '/broker-credentials.private.json');
      const web = projectWeek1WebCredentials({ ...control, spec }, credentials, final),
        credentialsSha256 = save('credentials.json', web),
        configurationSha256 = digest(Buffer.from(JSON.stringify(final) + '\n'));
      const lease = Object.fromEntries(
        [
          'ownerMessageId',
          'ownerApprovedAt',
          'started',
          'deadline',
          'cleanupAt',
          'monotonicStarted',
          'monotonicDeadline',
          'parentPid',
          'parentTicks',
          'guardPid',
          'guardTicks',
        ].map((k) => [k, control[k]]),
      );
      save('control.json', {
        profile: WEEK1_TARGET.profile,
        scopeSha256: control.scopeSha256,
        configurationSha256,
        sourceLockSha256: control.sourceLockSha256,
        reviewedHead: spec.reviewedHead,
        state: 'active',
        phase: 'invitations_active',
        ...lease,
      });
      const anchor = {
        version: 1,
        profile: WEEK1_TARGET.profile,
        root: run,
        uid: process.getuid(),
        reviewed: {
          scopeSha256: control.scopeSha256,
          sourceLockSha256: control.sourceLockSha256,
          reviewedHead: spec.reviewedHead,
          configurationSha256,
          lease,
        },
        credentialsSha256,
      };
      save('startup-anchor.json', anchor);
      return;
    }
    if (phase === 'invitations') {
      const reqWeb = createRequire(source + '/apps/web/package.json'),
        { createServerClient } = reqWeb('@supabase/ssr'),
        cookies = [];
      const issuerClient = createServerClient(WEEK1_TARGET.authOrigin, credentials.ANON_KEY, {
        cookieOptions: { name: spec.cookieName },
        cookies: {
          getAll: () => cookies,
          setAll: (items) => {
            for (const item of items) {
              const old = cookies.find((v) => v.name === item.name);
              if (old) old.value = item.value;
              else cookies.push({ name: item.name, value: item.value });
            }
          },
        },
      });
      const signed = await issuerClient.auth.signInWithPassword(credentials.issuer);
      check(!signed.error && signed.data.session, 'ISSUER_ORDINARY_SIGNIN');
      save('issuer-session.private.json', {
        cookie: cookies.map((c) => c.name + '=' + c.value).join('; '),
      });
      for (const [index, person] of credentials.learners.entries()) {
        if (index === 1 && spec.registrationDriver === 'operator-browser-learner-b') continue;
        const authId = await http.activateLearner(person);
        await learnerCookieSessions(index, person, authId);
      }
      return;
    }
    if (phase === 'operator_handoff') {
      check(spec.registrationDriver === 'operator-browser-learner-b', 'OPERATOR_DRIVER');
      const active = privateRead('control.json');
      check(
        active.state === 'active' &&
          active.phase === 'invitations_active' &&
          active.scopeSha256 === control.scopeSha256,
        'OPERATOR_ACTIVE',
      );
      // Awaiting marker is controller-owned; an operator cannot race ahead of setup.
      const waiting = privateRead('browser-awaiting.private.json');
      check(
        waiting.scopeSha256 === control.scopeSha256 &&
          waiting.sourceLockSha256 === control.sourceLockSha256,
        'OPERATOR_AWAITING',
      );
      const baseline = privateRead('auth-baseline.private.json');
      const fixture = privateRead('fixture.private.json');
      const learnerA = privateRead('learner-0-session.private.json');
      check(
        baseline.scopeSha256 === control.scopeSha256 &&
          baseline.empty === true &&
          config.scopeSha256 === control.scopeSha256 &&
          config.sourceLockSha256 === control.sourceLockSha256 &&
          config.profile === WEEK1_TARGET.profile &&
          config.target?.origin === WEEK1_TARGET.origin &&
          fixture.cohortId === config.cohortId &&
          fixture.curriculumVersionId === config.curriculumVersionId,
        'OPERATOR_FRESH_BINDING',
      );
      const pre = await http.inventory();
      check(
        pre.length === 2 &&
          pre.some((u) => u.email === credentials.issuer.email && u.id === fixture.issuerAuthId) &&
          pre.some((u) => u.email === WEEK1_LEARNERS[0].email && u.id === learnerA.authId) &&
          !pre.some((u) => u.email === WEEK1_LEARNERS[1].email),
        'OPERATOR_FRESH_LEARNER',
      );
      await http.issueOperatorLearner(credentials.learners[1], operatorScope(), {
        intent: async (r) => save('browser-handoff-intent.private.json', r),
        acknowledge: async (r) => save('browser-handoff-ack.private.json', r),
        emit: operatorOutput,
      });
      return;
    }
    if (phase === 'await_browser') {
      check(spec.registrationDriver === 'operator-browser-learner-b', 'OPERATOR_DRIVER');
      save('browser-awaiting.private.json', { ...operatorScope(), startedAt: Date.now() });
      // Original controller phase timeout and independent guard still bound this wait.
      const cutoff = Math.min(Date.now() + 150000, control.cleanupAt);
      let ack;
      while (Date.now() < cutoff) {
        checkTime();
        if (fs.existsSync(run + '/browser-handoff-ack.private.json')) {
          ack = privateRead('browser-handoff-ack.private.json');
          break;
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
      }
      check(ack, 'OPERATOR_HANDOFF_WAIT_EXPIRED');
      const intent = privateRead('browser-handoff-intent.private.json');
      check(
        same(
          intent,
          Object.fromEntries(
            Object.entries(ack).filter(([k]) => !['tokenSha256', 'issuedAt'].includes(k)),
          ),
        ) &&
          ack.scopeSha256 === control.scopeSha256 &&
          ack.sourceLockSha256 === control.sourceLockSha256 &&
          ack.origin === WEEK1_TARGET.origin &&
          ack.cohortId === config.cohortId &&
          ack.email === WEEK1_LEARNERS[1].email &&
          ack.displayName === WEEK1_LEARNERS[1].displayName &&
          HASH.test(ack.tokenSha256 ?? ''),
        'OPERATOR_ACK_BINDING',
      );
      const facts = await awaitWeek1BrowserRegistration({
        acknowledgement: ack,
        readProof: async () =>
          fs.existsSync(run + '/browser-proof.private.json')
            ? privateRead('browser-proof.private.json')
            : null,
        readFacts: readBrowserFacts,
        signIn: async (f) => learnerCookieSessions(1, credentials.learners[1], f.authId),
        checkTime,
        now: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
        deadline: cutoff,
      });
      save('browser-verified.private.json', {
        scopeSha256: control.scopeSha256,
        nonce: ack.nonce,
        authId: facts.authId,
        userId: facts.userId,
        verifiedAt: Date.now(),
      });
      return;
    }
    if (phase === 'assert_http') {
      const body = {
        requestId: crypto.randomUUID(),
        cohortId: config.cohortId,
        email: WEEK1_LEARNERS[0].email,
        displayName: WEEK1_LEARNERS[0].displayName,
        expiresAt: Math.min(control.cleanupAt, Date.now() + spec.policy.maxLifetimeMs),
      };
      for (const cookie of [
        null,
        privateRead('learner-0-session.private.json').cookie,
        privateRead('learner-1-session.private.json').cookie,
      ]) {
        checkTime();
        const response = await globalThis.fetch(WEEK1_TARGET.origin + '/api/invitations/issue', {
          method: 'POST',
          headers: {
            origin: WEEK1_TARGET.origin,
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: globalThis.AbortSignal.timeout(spec.policy.bodyTimeoutMs),
        });
        check(response.status === 403, 'ISSUER_BOUNDARY');
      }
      const rows = await admin.unsafe(
        "SELECT (SELECT count(*)::integer FROM auth.users) AS auth_users,(SELECT count(*)::integer FROM app.users WHERE active AND role='admin') AS admins,(SELECT count(*)::integer FROM app.invitation_enrollment_receipts WHERE cohort_id=$1::uuid) AS receipts,(SELECT count(*)::integer FROM app.cohort_memberships WHERE cohort_id=$1::uuid AND status='active') AS memberships",
        [config.cohortId],
      );
      check(
        rows.length === 1 &&
          same({ ...rows[0] }, { auth_users: 3, admins: 1, receipts: 2, memberships: 2 }),
        'GENUINE_INVITATION_COUNTS',
      );
      const fixture = privateRead('fixture.private.json');
      const checkpointEvidence = await runWeek1SelectedCheckpoint(spec, () =>
        verifyWeek1CheckpointHttp({
          rehearsalChecks: spec.rehearsalChecks,
          fetch: globalThis.fetch,
          learners: [
            privateRead('learner-0-session.private.json'),
            privateRead('learner-1-session.private.json'),
          ],
          secondSession: privateRead('learner-0-second-session.private.json'),
          cohortId: config.cohortId,
          definitionDigest: fixture.checkpointDefinitionDigest,
          uuid: () => crypto.randomUUID(),
          checkTime,
          journal,
          revoke: async (person) => {
            await identity(admin, WEEK1_TARGET.dba);
            const revoked = await admin.unsafe(
              "UPDATE app.users SET active=false WHERE id=$1::uuid AND auth_user_id=$2::uuid AND role='learner' AND active RETURNING id::text",
              [person.userId, person.authId],
            );
            check(
              revoked.length === 1 && revoked[0].id === person.userId,
              'CHECKPOINT_REVOKE_BINDING',
            );
          },
          counts: async () => {
            const r = await admin.unsafe(
              'SELECT (SELECT count(*)::text FROM app.submissions) AS submissions,(SELECT count(*)::text FROM judge.jobs) AS jobs,(SELECT count(*)::text FROM app.checkpoint_outcomes) AS outcomes',
            );
            check(r.length === 1, 'CHECKPOINT_COUNTS');
            return { ...r[0] };
          },
          receiptCount: async (attempt, task) => {
            const r = await admin.unsafe(
              'SELECT count(*)::integer AS n FROM app.checkpoint_draft_revisions WHERE attempt_id=$1::uuid AND task_key=$2',
              [attempt, task],
            );
            check(r.length === 1 && Number.isSafeInteger(r[0].n), 'CHECKPOINT_RECEIPT_COUNT');
            return r[0].n;
          },
        }),
      );
      save('http-evidence.private.json', {
        ordinaryIssuerIssued: true,
        learnersActivatedThroughApi: spec.registrationDriver === 'http-only' ? 2 : 1,
        learnersActivatedThroughBrowser:
          spec.registrationDriver === 'operator-browser-learner-b' ? 1 : 0,
        learnerAndAnonymousIssuanceDenied: true,
        nativeCounts: rows.map((r) => ({ ...r })),
        browserVerificationScope:
          spec.registrationDriver === 'operator-browser-learner-b'
            ? ['learner-b-invitation-registration-login']
            : [],
        browserVerified:
          spec.registrationDriver === 'operator-browser-learner-b' &&
          privateRead('browser-verified.private.json').scopeSha256 === control.scopeSha256,
        rehearsalChecks: spec.rehearsalChecks,
        checkpoint: checkpointEvidence,
      });
      return;
    }
    if (phase === 'cleanup') {
      check(fs.existsSync(run + '/auth-baseline.private.json'), 'NO_EXCLUSIVE_AUTH_BASELINE');
      const existingTables = async () => {
        const rows = await admin.unsafe(
          "SELECT to_regclass('app.users') IS NOT NULL AS users,to_regclass('app.cohort_memberships') IS NOT NULL AS memberships,to_regclass('app.invitation_issuance_policy') IS NOT NULL AS issuance,to_regclass('app.invitation_admission_policy') IS NOT NULL AS admission,to_regclass('app.invitation_runtime_profiles') IS NOT NULL AS runtime,to_regclass('app.invitation_activations') IS NOT NULL AS activations",
        );
        check(rows.length === 1, 'CLEANUP_CATALOG');
        return rows[0];
      };
      const result = await cleanupWeek1AuthAccess({
        journal,
        revokeProviderInventory: () =>
          http.revokeInventory(
            (email) =>
              [credentials.issuer, ...credentials.learners].find((p) => p.email === email)
                ?.password,
          ),
        readOwnedAuthRows: () => admin.unsafe('SELECT id::text,email FROM auth.users ORDER BY id'),
        banOwnedId: async (id) => {
          const reply = await auth.updateUserById(id, { ban_duration: '876000h' });
          check(!reply.error, 'FALLBACK_BAN');
        },
        disableApplication: async () => {
          const tables = await existingTables();
          if (tables.users)
            await admin.unsafe(
              'UPDATE app.users SET active=false WHERE auth_user_id IN(SELECT id FROM auth.users)',
            );
          if (tables.memberships)
            await admin.unsafe(
              "UPDATE app.cohort_memberships SET status='inactive' WHERE user_id IN(SELECT id FROM app.users WHERE auth_user_id IN(SELECT id FROM auth.users))",
            );
          if (tables.issuance)
            await admin.unsafe('UPDATE app.invitation_issuance_policy SET enabled=false');
          if (tables.admission)
            await admin.unsafe('UPDATE app.invitation_admission_policy SET enabled=false');
          if (tables.runtime)
            await admin.unsafe(
              'UPDATE app.invitation_runtime_profiles SET enabled=false WHERE profile=$1',
              [WEEK1_TARGET.profile],
            );
        },
        disableSqlLogins: async () => {
          let failed = false;
          for (const [key, role] of Object.entries(WEEK1_TARGET.roles)) {
            try {
              const rows = await admin.unsafe(
                'SELECT rolname FROM pg_catalog.pg_roles WHERE rolname=$1',
                [role],
              );
              if (rows.length) {
                await admin.unsafe('ALTER ROLE ' + quote(role) + ' NOLOGIN');
                await admin.unsafe(
                  'REVOKE ' +
                    quote(
                      {
                        issuer: 'nextera_invitation_issuer',
                        activation: 'nextera_invitation_runtime',
                        web: 'nextera_web',
                      }[key],
                    ) +
                    ' FROM ' +
                    quote(role) +
                    ' RESTRICT',
                );
                await admin.unsafe(
                  'SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE usename=$1 AND pid<>pg_catalog.pg_backend_pid()',
                  [role],
                );
              }
            } catch {
              failed = true;
            }
          }
          check(!failed, 'SQL_DISABLE_PARTIAL');
        },
        verifyAccess: async () => {
          const tables = await existingTables(),
            rows = await admin.unsafe(
              'SELECT (SELECT count(*)::integer FROM auth.sessions WHERE user_id IN(SELECT id FROM auth.users)) AS sessions,(SELECT count(*)::integer FROM auth.refresh_tokens WHERE user_id IN(SELECT id::text FROM auth.users) AND NOT revoked) AS refresh_tokens,(SELECT count(*)::integer FROM auth.users WHERE banned_until IS NULL OR banned_until<=to_timestamp($1::numeric/1000)) AS unbanned_users,(SELECT count(*)::integer FROM pg_catalog.pg_roles WHERE rolname=ANY($2::text[]) AND rolcanlogin) AS logins,(SELECT count(*)::integer FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname=ANY($2::text[])) AS login_memberships',
              [control.deadline, Object.values(WEEK1_TARGET.roles)],
            );
          check(rows.length === 1, 'CLEANUP_COUNTS');
          const counts = { ...rows[0], active_users: 0, active_memberships: 0 };
          if (tables.users) {
            const r = await admin.unsafe(
              'SELECT count(*)::integer AS n FROM app.users WHERE active AND auth_user_id IN(SELECT id FROM auth.users)',
            );
            check(r.length === 1, 'CLEANUP_USERS_COUNT');
            counts.active_users = r[0].n;
          }
          if (tables.memberships) {
            const r = await admin.unsafe(
              "SELECT count(*)::integer AS n FROM app.cohort_memberships WHERE status='active' AND user_id IN(SELECT id FROM app.users WHERE auth_user_id IN(SELECT id FROM auth.users))",
            );
            check(r.length === 1, 'CLEANUP_MEMBERSHIP_COUNT');
            counts.active_memberships = r[0].n;
          }
          counts.pending_auth_operations = 0;
          if (tables.activations) {
            // A killed Next request may already have sent managed-Auth creation.
            // Its durable auth_pending fence makes that outcome unknown. Shutdown
            // still proceeds, but zero current users cannot prove no late creation.
            const pending = await admin.unsafe(
              "SELECT count(*)::integer AS n FROM app.invitation_activations WHERE phase='auth_pending'",
            );
            check(pending.length === 1, 'CLEANUP_PENDING_AUTH_COUNT');
            counts.pending_auth_operations = pending[0].n;
          }
          counts.pending_auth_operations = week1PendingAuthCreations(
            counts.pending_auth_operations,
            {
              intent: fs.existsSync(run + '/issuer-create-intent.private.json')
                ? privateRead('issuer-create-intent.private.json')
                : null,
              acknowledgement: fs.existsSync(run + '/issuer-create-ack.private.json')
                ? privateRead('issuer-create-ack.private.json')
                : null,
              scopeSha256: control.scopeSha256,
              email: credentials.issuer.email,
            },
          );
          return counts;
        },
      });
      save('access-disabled.private.json', result);
      check(
        result.providerRevoked && result.appDisabled && result.sqlDisabled,
        'CLEANUP_UNVERIFIED',
      );
      return;
    }
    throw new Error('WEEK1_BROKER_UNKNOWN_PHASE');
  } finally {
    await admin.end({ timeout: 3 });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--operator-handoff-stdout') {
    // Deliberately NOT exposed through Python Commands.run or generic --phase.
    // Caller must retain stdout only in its private in-memory operator pipe.
    try {
      check(!process.stdout.isTTY && fs.fstatSync(1).isFIFO(), 'OPERATOR_PIPE_ONLY');
    } catch {
      process.stderr.write('WEEK1_BROKER_OPERATOR_PIPE_REQUIRED\n');
      process.exit(1);
    }
    executePhase(
      'operator_handoff',
      process.argv[3],
      process.argv[4],
      (value) =>
        new Promise((resolve, reject) =>
          process.stdout.write(JSON.stringify(value) + '\n', (error) =>
            error ? reject(error) : resolve(),
          ),
        ),
    ).catch(() => {
      process.stderr.write('WEEK1_BROKER_OPERATOR_HANDOFF_FAILED; do not retry issuance.\n');
      process.exitCode = 1;
    });
  } else if (process.argv[2] === '--phase')
    executePhase(process.argv[3], process.argv[4], process.argv[5]).catch(() => {
      process.stderr.write('WEEK1_BROKER_PHASE_FAILED; protected evidence retained.\n');
      process.exitCode = 1;
    });
  else
    process.stdout.write(
      JSON.stringify({
        profile: WEEK1_TARGET.profile,
        target: WEEK1_TARGET,
        status: 'source_only_not_authorized',
        runtimeReady: false,
      }) + '\n',
    );
}
