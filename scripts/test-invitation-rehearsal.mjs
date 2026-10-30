/* Opt-in native SQL rehearsal only. Import creates no driver, files, credentials or services. */
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { REGISTERED_SOURCES } from './checkpoint-prerequisite-manifest.mjs';

export const TARGET =
  '/home/anas/.local/share/nextera-judge/invitation-sql-20261030-attempt002/run-001';
export const DATABASE = 'foundation_test_invitation_sql_20261030_attempt002';
export const PORT = 55461;
export const ACTOR = 'invitation_migration_actor_20261030',
  PROBE = 'invitation_probe_20261030';
export const ISSUER = 'invitation_issuer_client_20261030',
  ACTIVATOR = 'invitation_activation_client_20261030';
export const PERMISSION_ROLES = Object.freeze([
  'nextera_web',
  'nextera_judge_owner',
  'nextera_runner',
  'nextera_judge_maintenance',
  'nextera_result_application',
  'nextera_checkpoint_owner',
  'nextera_raid_owner',
  'nextera_invitation_owner',
  'nextera_invitation_issuer',
  'nextera_invitation_runtime',
]);
export const ROLES = Object.freeze([...PERMISSION_ROLES, ACTOR, PROBE, ISSUER, ACTIVATOR]);
export const DRAFT_ORDER = Object.freeze([
  '0013_invitations.DRAFT.sql',
  '0020_invitation_issuance.DRAFT.sql',
  '0016_invitation_operations.DRAFT.sql',
  '0018_invitation_admission.DRAFT.sql',
]);
export const CASE_ORDER = Object.freeze([
  'private_acl_and_identity',
  'issuer_policy_and_scope',
  'issuance_replay_and_digest',
  'concurrent_issuance',
  'atomic_unique_failure',
  'expiry_and_revocation',
  'claim_concurrency_and_fences',
  'wrong_scope_and_auth_proof',
  'enrollment_retry_and_completion',
  'concurrent_enrollment',
  'distinct_invitation_enrollment',
  'locked_authority_revocation',
  'outer_transaction_rollback',
  'no_awards_or_role_escalation',
]);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const quote = (value) => {
  assert.match(value, /^[a-z_][a-z0-9_]{0,62}$/);
  return '"' + value + '"';
};
const abort = () => {
  throw new Error('EXPECTED_INVITATION_ROLLBACK');
};
const u = (n) => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const H = '1'.repeat(64),
  OWNER = u(1),
  OTHER = u(2),
  COHORT = u(10),
  SECOND = u(11),
  VERSION = u(20),
  VERSION2 = u(21);
const proof = (i) =>
  hash(
    JSON.stringify([
      'nextera-invitation-v1',
      i.id,
      i.id,
      i.email,
      'Synthetic learner',
      COHORT,
      'learner',
    ]),
  );

export function validateControl(r, now = Date.now()) {
  assert.equal(r.target, TARGET);
  assert.equal(r.database, DATABASE);
  assert.equal(String(r.port), String(PORT));
  assert.equal(r.bootstrap, 'anas');
  assert.equal(r.actor, ACTOR);
  assert.equal(r.probe, PROBE);
  assert.equal(r.issuer, ISSUER);
  assert.equal(r.activator, ACTIVATOR);
  assert.ok(
    [r.created, r.deadline, r.cleanup_at].every((n) => typeof n === 'number' && Number.isFinite(n)),
  );
  assert.equal(r.uid, process.getuid());
  assert.match(r.scope_sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.approval?.scope_sha256, r.scope_sha256);
  assert.match(r.approval?.owner_message_id ?? '', /^Sentinel_[A-Za-z0-9]+$/);
  const approved = Date.parse(r.approval.owner_approved_at) / 1000;
  assert.ok(Number.isFinite(approved) && r.created >= approved && r.created - approved <= 600);
  assert.equal(r.deadline, r.created + 1800);
  assert.equal(r.cleanup_at, r.deadline - 180);
  assert.ok(now / 1000 >= r.created && now / 1000 < r.cleanup_at);
  assert.ok(r.sources && Object.keys(r.sources).length > 10);
}
function privateFile(file, directory = false) {
  const s = fs.lstatSync(file);
  assert.equal(s.uid, process.getuid());
  assert.equal(s.isSymbolicLink(), false);
  assert.equal(directory ? s.isDirectory() : s.isFile(), true);
  assert.equal(s.mode & 0o777, directory ? 0o700 : 0o600);
}
function sourceBytes(r, name) {
  assert.match(r.sources[name] ?? '', /^[0-9a-f]{64}$/);
  assert.equal(path.isAbsolute(name), false);
  assert.equal(name.split('/').includes('..'), false);
  const file = path.join(TARGET, 'snapshot', name);
  privateFile(file);
  const b = fs.readFileSync(file);
  assert.equal(hash(b), r.sources[name]);
  return b;
}
function receipt(r, name, value) {
  fs.writeFileSync(
    path.join(TARGET, 'evidence', name),
    JSON.stringify({ ...value, scope_sha256: r.scope_sha256 }) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
}
export function draftBody(file, bytes) {
  assert.ok(DRAFT_ORDER.includes(file));
  assert.ok(Buffer.isBuffer(bytes));
  const text = bytes.toString('utf8');
  const start = text.indexOf('\nBEGIN;\n');
  assert.ok(start >= 0 && text.endsWith('COMMIT;\n'));
  return text.slice(start + 8, -8);
}
export function bindSession(client, role) {
  assert.ok([ACTOR, PROBE, ISSUER, ACTIVATOR, 'nextera_web'].includes(role));
  assert.equal(client.options?.prepare, false);
  const begin = async (work) =>
    client.begin('isolation level read committed', async (sql) => {
      await sql.unsafe('SET LOCAL SESSION AUTHORIZATION ' + quote(role));
      const rows = await sql.unsafe(
        'SELECT current_user::text AS actor,session_user::text AS session_actor',
      );
      assert.deepEqual(
        rows.map((r) => ({ ...r })),
        [{ actor: role, session_actor: role }],
      );
      await sql.unsafe(
        "SET LOCAL statement_timeout='10000ms';SET LOCAL lock_timeout='2000ms';SET LOCAL idle_in_transaction_session_timeout='15000ms'",
      );
      return work(sql);
    });
  return Object.freeze({
    begin,
    unsafe: (text, values = []) => {
      assert.ok(!/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(text));
      return begin((q) => q.unsafe(text, values));
    },
  });
}
// Deliberate NEW fixed target binding. The existing checkpoint helper's closed target is not broadened.
export async function applyPrerequisite(client, file, bytes, checkTime) {
  assert.equal(client.options?.prepare, false);
  const m = REGISTERED_SOURCES[file];
  assert.ok(m && Buffer.isBuffer(bytes));
  bytes = Buffer.from(bytes);
  assert.equal(hash(bytes), m.sha256);
  const chunks = [
    bytes.subarray(0, m.start),
    bytes.subarray(m.start, m.end),
    bytes.subarray(m.end),
  ];
  assert.deepEqual(chunks.map(hash), [m.prefixSha256, m.dbaSha256, m.suffixSha256]);
  let finished = false,
    value;
  const result = await client.begin('isolation level read committed', async (q) => {
    checkTime();
    await q.unsafe(
      "SET LOCAL statement_timeout='15000ms';SET LOCAL lock_timeout='2000ms';SET LOCAL idle_in_transaction_session_timeout='20000ms'",
    );
    const identity = async (role) => {
      checkTime();
      await q.unsafe('SET LOCAL SESSION AUTHORIZATION ' + quote(role));
      const [r] = await q.unsafe(
        'SELECT current_user::text AS actor,session_user::text AS session_actor,current_database()::text AS database',
      );
      assert.deepEqual({ ...r }, { actor: role, session_actor: role, database: DATABASE });
    };
    await identity(ACTOR);
    if (chunks[0].length) await q.unsafe(chunks[0].toString('utf8'));
    if (chunks[1].length) {
      await identity('anas');
      await q.unsafe(chunks[1].toString('utf8'));
      await identity(ACTOR);
    }
    if (chunks[2].length) await q.unsafe(chunks[2].toString('utf8'));
    checkTime();
    const [last] = await q.unsafe(
      'SELECT current_user::text AS actor,session_user::text AS session_actor,current_database()::text AS database',
    );
    assert.deepEqual({ ...last }, { actor: ACTOR, session_actor: ACTOR, database: DATABASE });
    finished = true;
    value = {
      file,
      sha256: m.sha256,
      dbaSha256: chunks[1].length ? m.dbaSha256 : null,
      actorRestoredBeforeCommit: true,
    };
    return value;
  });
  assert.ok(finished && result === value, 'PREREQUISITE_COMMIT_UNCERTAIN');
  checkTime();
  return value;
}
export async function runCases(operations, timeoutMs = 20000) {
  assert.deepEqual(Object.keys(operations).sort(), [...CASE_ORDER].sort());
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 20000);
  const done = [];
  for (const name of CASE_ORDER) {
    let timer;
    try {
      await Promise.race([
        operations[name](),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('INVITATION_CASE_TIMEOUT')), timeoutMs);
        }),
      ]);
      done.push({ name, passed: true });
    } finally {
      clearTimeout(timer);
    }
  }
  return done;
}
export function fixtureSpec(node) {
  const limits = Object.fromEntries(
    [
      'cpu_limit',
      'memory_bytes',
      'pid_limit',
      'timeout_ms',
      'output_bytes',
      'temporary_filesystem_bytes',
      'temporary_filesystem_inodes',
    ].map((k) => [k, 1]),
  );
  return {
    content_digest: H,
    curriculum_version: 'synthetic-1',
    curriculum_key: 'invitation-sql-only',
    node_key: node,
    subject_digest: H,
    configuration_digest: H,
    test_pack_id: 'synthetic-unexecuted',
    test_pack_digest: H,
    test_pack_artifact: 'oci://fixture.invalid/unexecuted@sha256:' + H,
    runner_image_digest: 'sha256:' + H,
    sandbox_image_digest: 'sha256:' + H,
    toolchain_version: 'go1.24.0',
    target_platform: 'linux/amd64',
    dependency_policy: 'offline',
    build_flags: [],
    resource_profile: 'synthetic-not-executed',
    protocol_version: 1,
    snapshot_format_version: 1,
    case_generation: { mode: 'static' },
    resource_limits: { compilation: { ...limits }, execution: { ...limits } },
  };
}

function jsonObject(client, value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.equal(typeof client?.json, 'function');
  return client.json(value);
}
export function fixtureSpecParameter(client, node, versionName) {
  assert.ok(['synthetic-1', 'synthetic-2'].includes(versionName));
  return jsonObject(client, { ...fixtureSpec(node), curriculum_version: versionName });
}
export function authProofParameter(client, invitation, good = true) {
  return jsonObject(client, {
    nextera_invitation_activation: {
      version: 1,
      operation_reference: invitation.id,
      scope_digest: good ? proof(invitation) : H,
    },
  });
}

export async function executePreparedRunner(record, postgres) {
  validateControl(record);
  privateFile(TARGET, true);
  privateFile(path.join(TARGET, 's'), true);
  assert.equal(fs.existsSync(path.join(TARGET, 'evidence/cleanup.json')), false);
  for (const name of Object.keys(record.sources)) sourceBytes(record, name);
  const clients = [];
  const connect = () => {
    const c = postgres({
      host: path.join(TARGET, 's'),
      port: PORT,
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
    clients.push(c);
    return c;
  };
  const admin = connect(),
    observer = connect(),
    issuer = bindSession(connect(), ISSUER),
    activator = bindSession(connect(), ACTIVATOR),
    probe = bindSession(connect(), PROBE);
  let phase = 'target',
    result,
    cleanup = { roles_disabled: false, policy_disabled: false, test_memberships_removed: false };
  const checkTime = () =>
    assert.ok(Date.now() / 1000 < record.cleanup_at, 'INVITATION_CLEANUP_WINDOW');
  const synthetic = (n) => ({
    id: u(1000 + n),
    request: u(2000 + n),
    email: `synthetic-${n}@example.test`,
    digest: hash('synthetic-nonsecret-digest-' + n),
    expires: Date.now() + 60000,
  });
  const issue = async (i, client = issuer, patch = {}) => {
    const v = { ...i, ...patch };
    const [r] = await client.unsafe(
      'SELECT app.invitation_issue($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::uuid,$8::bigint) AS result',
      [
        v.id,
        v.request,
        v.owner ?? OWNER,
        v.digest,
        v.email,
        'Synthetic learner',
        v.cohort ?? COHORT,
        String(v.expires),
      ],
    );
    return r.result;
  };
  const claim = async (
    i,
    request = u(3000 + Number.parseInt(i.id.slice(-6), 16)),
    client = activator,
  ) => {
    const [r] = await client.unsafe(
      'SELECT app.invitation_claim($1::text,$2::uuid,10000) AS result',
      [i.digest, request],
    );
    return r.result;
  };
  const release = async (i, fence) =>
    activator.unsafe('SELECT app.invitation_release($1::uuid,$2::bigint)', [i.id, fence]);
  const advance = async (i, fence, expected, next, authId = null) =>
    activator.unsafe(
      'SELECT * FROM app.invitation_advance($1::uuid,$2::bigint,$3::text,$4::text,$5::uuid)',
      [i.id, fence, expected, next, authId],
    );
  const enroll = async (i, fence, client = activator, patch = {}) => {
    const v = { ...i, ...patch };
    const [r] = await client.unsafe(
      'SELECT app.invitation_enroll($1::uuid,$2::bigint,$3::uuid,$4::text,$5::text,$6::uuid,$7::uuid) AS outcome',
      [i.id, fence, i.id, v.email, 'Synthetic learner', v.cohort ?? COHORT, i.id],
    );
    return r.outcome;
  };
  const complete = async (i, fence) => {
    const [r] = await activator.unsafe(
      'SELECT app.invitation_complete($1::uuid,$2::bigint,$3::uuid,$4::text,$5::text,$6::uuid) AS allowed',
      [i.id, fence, i.id, i.email, 'Synthetic learner', COHORT],
    );
    return r.allowed;
  };
  const authStub = async (i, good = true) =>
    admin.unsafe(
      'INSERT INTO auth.users(id,email,raw_app_meta_data,email_confirmed_at) VALUES($1::uuid,$2::text,$3::jsonb,clock_timestamp())',
      [i.id, i.email, authProofParameter(admin, i, good)],
    );
  const readyEnrollment = async (i) => {
    assert.equal((await issue(i)).kind, 'issued');
    const c = await claim(i);
    assert.equal(c.claim_state, 'acquired');
    const f = c.fence;
    assert.equal((await advance(i, f, 'issued', 'auth_pending')).length, 1);
    await authStub(i);
    assert.equal((await advance(i, f, 'auth_pending', 'auth_ready', i.id)).length, 1);
    assert.equal((await advance(i, f, 'auth_ready', 'enrollment_pending')).length, 1);
    return f;
  };
  try {
    const [target] = await admin.unsafe(
      "SELECT current_database()::text AS database,current_setting('data_directory') AS directory,current_setting('listen_addresses') AS listen,current_user::text AS actor,session_user::text AS session,floor(current_setting('server_version_num')::integer/10000)::integer AS major",
    );
    assert.deepEqual(
      { ...target },
      {
        database: DATABASE,
        directory: path.join(TARGET, 'data'),
        listen: '',
        actor: 'anas',
        session: 'anas',
        major: 16,
      },
    );
    phase = 'prerequisites';
    checkTime();
    await admin.unsafe(
      `CREATE ROLE ${quote(ACTOR)} NOLOGIN NOINHERIT CREATEROLE NOSUPERUSER NOCREATEDB NOBYPASSRLS NOREPLICATION;CREATE ROLE ${quote(PROBE)} NOLOGIN NOINHERIT NOCREATEROLE NOSUPERUSER NOCREATEDB NOBYPASSRLS NOREPLICATION;ALTER DATABASE ${quote(DATABASE)} OWNER TO ${quote(ACTOR)};CREATE SCHEMA auth AUTHORIZATION ${quote(ACTOR)};CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);ALTER TABLE auth.users OWNER TO ${quote(ACTOR)};`,
    );
    const journal = JSON.parse(sourceBytes(record, 'packages/db/migrations/meta/_journal.json'));
    assert.deepEqual(
      journal.entries.map((e) => e.idx),
      Array.from({ length: 11 }, (_, i) => i),
    );
    for (const e of journal.entries) {
      checkTime();
      phase = 'prerequisite_' + e.idx;
      const file = e.tag + '.sql';
      receipt(record, 'prerequisite-' + e.idx + '-started.json', {
        file,
        sourceSha256: hash(sourceBytes(record, 'packages/db/migrations/' + file)),
      });
      const acknowledged = await applyPrerequisite(
        admin,
        file,
        sourceBytes(record, 'packages/db/migrations/' + file),
        checkTime,
      );
      receipt(record, 'prerequisite-' + e.idx + '.json', acknowledged);
    }
    await admin.unsafe('ALTER ROLE ' + quote(ACTOR) + ' NOCREATEROLE');
    for (const role of [
      'nextera_invitation_owner',
      'nextera_invitation_issuer',
      'nextera_invitation_runtime',
      ISSUER,
      ACTIVATOR,
    ])
      await admin.unsafe(
        'CREATE ROLE ' +
          quote(role) +
          ' NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS NOREPLICATION',
      );
    await admin.unsafe(
      'GRANT nextera_invitation_owner TO ' +
        quote(ACTOR) +
        ' WITH ADMIN FALSE,INHERIT FALSE,SET TRUE',
    );
    const migration = bindSession(connect(), ACTOR);
    for (const file of DRAFT_ORDER) {
      checkTime();
      phase = 'draft_' + file.slice(0, 4);
      const bytes = sourceBytes(record, 'packages/db/migration-drafts/' + file);
      receipt(record, file + '.started.json', { file, sourceSha256: hash(bytes) });
      await migration.unsafe(draftBody(file, bytes));
      receipt(record, file + '.acknowledged.json', {
        file,
        sourceSha256: hash(bytes),
        commitAcknowledged: true,
      });
    }
    await admin.unsafe('REVOKE nextera_invitation_owner FROM ' + quote(ACTOR) + ' RESTRICT');
    await admin.unsafe(
      'GRANT nextera_invitation_issuer TO ' +
        quote(ISSUER) +
        ' WITH ADMIN FALSE,INHERIT TRUE,SET FALSE;GRANT nextera_invitation_runtime TO ' +
        quote(ACTIVATOR) +
        ' WITH ADMIN FALSE,INHERIT TRUE,SET FALSE',
    );
    const roles = await observer.unsafe(
      "SELECT rolname,rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,rolreplication FROM pg_roles WHERE rolname !~ '^pg_' AND rolname<>'anas' ORDER BY rolname",
    );
    assert.deepEqual(
      roles.map((r) => r.rolname),
      [...ROLES].sort(),
    );
    assert.ok(
      roles.every(
        (r) =>
          !r.rolcanlogin &&
          !r.rolsuper &&
          !r.rolcreaterole &&
          !r.rolcreatedb &&
          !r.rolbypassrls &&
          !r.rolreplication,
      ),
    );
    assert.equal(
      (
        await observer.unsafe(
          'SELECT count(*)::integer AS n FROM pg_authid WHERE rolpassword IS NOT NULL',
        )
      )[0].n,
      0,
    );
    phase = 'synthetic_fixtures';
    checkTime();
    for (const [id, authId, role] of [
      [OWNER, u(101), 'admin'],
      [OTHER, u(102), 'admin'],
    ]) {
      await admin.unsafe('INSERT INTO auth.users(id,email) VALUES($1::uuid,$2::text)', [
        authId,
        `owner-${id.slice(-1)}@example.test`,
      ]);
      await admin.unsafe(
        'INSERT INTO app.users(id,auth_user_id,display_name,role,active) VALUES($1::uuid,$2::uuid,$3::text,$4::app.user_role,true)',
        [id, authId, 'Synthetic owner', role],
      );
    }
    for (const v of [VERSION, VERSION2]) {
      await admin.unsafe(
        "INSERT INTO app.curriculum_versions(id,curriculum_key,version,git_commit_sha,content_digest,digest_format_version) VALUES($1::uuid,'invitation-sql-only',$2::text,$3::text,$4::text,1)",
        [v, v === VERSION ? 'synthetic-1' : 'synthetic-2', '1'.repeat(40), H],
      );
      await admin.unsafe(
        "INSERT INTO app.quests(curriculum_version_id,quest_key,title,position) VALUES($1::uuid,'q','Synthetic SQL fixture',1)",
        [v],
      );
      for (const [key, pos] of [
        ['root', 1],
        ['dependent', 2],
      ]) {
        const spec = fixtureSpecParameter(
          admin,
          key,
          v === VERSION ? 'synthetic-1' : 'synthetic-2',
        );
        await admin.unsafe(
          "INSERT INTO app.curriculum_nodes(curriculum_version_id,node_key,quest_key,kind,title,position,difficulty,subject_markdown,subject_digest,skills,submission_rules,resolved_evaluation_spec,evaluation_spec_digest) VALUES($1::uuid,$2::text,'q','challenge','Synthetic SQL-only node',$3::integer,1,'Not learner curriculum',$4::text,ARRAY[]::text[],'{}'::jsonb,$5::jsonb,$4::text)",
          [v, key, pos, H, spec],
        );
      }
      await admin.unsafe(
        "INSERT INTO app.node_prerequisites VALUES($1::uuid,'root','dependent','requires_pass')",
        [v],
      );
      await admin.unsafe(
        "UPDATE app.curriculum_versions SET status='published',published_at=clock_timestamp() WHERE id=$1::uuid",
        [v],
      );
    }
    for (const c of [COHORT, SECOND]) {
      await admin.unsafe(
        "INSERT INTO app.cohorts(id,slug,name,curriculum_version_id,status,starts_at) VALUES($1::uuid,$2::text,'Synthetic invitation cohort',$3::uuid,'active',clock_timestamp())",
        [c, 'invitation-sql-' + c.slice(-2), VERSION],
      );
    }
    await admin.unsafe(
      'INSERT INTO app.invitation_issuance_policy(issuer_id,cohort_id,curriculum_version_id,issuer_login,enabled,max_lifetime_ms) VALUES($1::uuid,$2::uuid,$3::uuid,$4::name,true,120000)',
      [OWNER, COHORT, VERSION, ISSUER],
    );
    await admin.unsafe(
      "INSERT INTO app.invitation_admission_policy VALUES(true,true,true,'nextera-invitation-admission-v1')",
    );
    const operations = {
      private_acl_and_identity: async () => {
        await assert.rejects(issue(synthetic(1), probe), (e) => e.code === '42501');
        await assert.rejects(issue(synthetic(1), activator), (e) => e.code === '42501');
        await assert.rejects(
          issuer.unsafe('SELECT * FROM app.invitation_find($1::text)', [H]),
          (e) => e.code === '42501',
        );
        for (const role of ['nextera_web', ISSUER, ACTIVATOR, PROBE]) {
          const [r] = await observer.unsafe(
            "SELECT count(*)::integer AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname IN ('invitation_activations','invitation_acceptances','invitation_issuance_policy','invitation_enrollment_receipts') AND has_table_privilege($1::text,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
            [role],
          );
          assert.equal(r.n, 0);
        }
        const [p] = await observer.unsafe(
          "SELECT count(*)::integer AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='app' AND p.proname LIKE '%invitation%' AND a.grantee=0",
        );
        assert.equal(p.n, 0);
      },
      issuer_policy_and_scope: async () => {
        const i = synthetic(2);
        assert.equal((await issue(i, issuer, { owner: OTHER })).kind, 'forbidden');
        assert.equal((await issue(i, issuer, { cohort: SECOND })).kind, 'forbidden');
        await admin.unsafe('UPDATE app.users SET active=false WHERE id=$1::uuid', [OWNER]);
        try {
          assert.equal((await issue(i)).kind, 'forbidden');
        } finally {
          await admin.unsafe('UPDATE app.users SET active=true WHERE id=$1::uuid', [OWNER]);
        }
        await assert.rejects(
          admin.unsafe('UPDATE app.cohorts SET curriculum_version_id=$1::uuid WHERE id=$2::uuid', [
            VERSION2,
            COHORT,
          ]),
          (e) => e.code === '23503',
        );
      },
      issuance_replay_and_digest: async () => {
        const i = synthetic(3);
        assert.equal((await issue(i)).kind, 'issued');
        assert.equal((await issue(i, issuer, { id: u(9003), digest: H })).kind, 'already_issued');
        const [r] = await observer.unsafe(
          'SELECT count(*)::integer AS n,min(token_digest) AS digest FROM app.invitation_activations WHERE id=$1::uuid',
          [i.id],
        );
        assert.deepEqual({ ...r }, { n: 1, digest: i.digest });
        const forbidden = await observer.unsafe(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name IN ('invitation_activations','invitation_acceptances') AND (column_name LIKE '%password%' OR column_name IN ('token','raw_token','link'))",
        );
        assert.equal(forbidden.length, 0);
      },
      concurrent_issuance: async () => {
        const i = synthetic(4),
          second = bindSession(connect(), ISSUER);
        const outcomes = await Promise.all([
          issue(i),
          issue(i, second, { id: u(9004), digest: H }),
        ]);
        assert.equal(outcomes.filter((r) => r.kind === 'issued').length, 1);
        assert.ok(outcomes.every((r) => ['issued', 'conflict', 'already_issued'].includes(r.kind)));
        const [r] = await observer.unsafe(
          'SELECT count(*)::integer AS n FROM app.invitation_acceptances WHERE request_id=$1::uuid',
          [i.request],
        );
        assert.equal(r.n, 1);
      },
      atomic_unique_failure: async () => {
        const i = synthetic(5);
        assert.equal((await issue(i)).kind, 'issued');
        const other = { ...synthetic(6), email: i.email };
        assert.equal((await issue(other)).kind, 'conflict');
        assert.equal(
          (
            await observer.unsafe('SELECT 1 FROM app.invitation_activations WHERE id=$1::uuid', [
              other.id,
            ])
          ).length,
          0,
        );
      },
      expiry_and_revocation: async () => {
        const i = synthetic(7);
        assert.equal((await issue(i)).kind, 'issued');
        await admin.unsafe(
          'UPDATE app.invitation_activations SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
          [i.id],
        );
        assert.equal((await claim(i)).claim_state, 'missing');
        const expired = { ...synthetic(8), expires: Date.now() + 5000 };
        assert.equal((await issue(expired)).kind, 'issued');
        await admin.unsafe('SELECT pg_sleep(5.1)');
        assert.equal((await claim(expired)).claim_state, 'missing');
        assert.equal(
          (await activator.unsafe('SELECT * FROM app.invitation_find($1::text)', ['f'.repeat(64)]))
            .length,
          0,
        );
      },
      claim_concurrency_and_fences: async () => {
        const i = synthetic(9);
        assert.equal((await issue(i)).kind, 'issued');
        const other = bindSession(connect(), ACTIVATOR),
          req = u(7009);
        const replies = await Promise.all([claim(i, req), claim(i, req, other)]);
        assert.equal(replies.filter((r) => r.claim_state === 'acquired').length, 1);
        assert.equal(replies.filter((r) => r.claim_state === 'busy').length, 1);
        const first = replies.find((r) => r.claim_state === 'acquired');
        await release(i, first.fence);
        const newer = await claim(i, req);
        assert.equal(newer.claim_state, 'acquired');
        assert.ok(BigInt(newer.fence) > BigInt(first.fence));
        assert.equal((await advance(i, first.fence, 'issued', 'auth_pending')).length, 0);
        assert.equal((await claim(i, u(7999))).claim_state, 'conflict');
        await release(i, newer.fence);
      },
      wrong_scope_and_auth_proof: async () => {
        const i = synthetic(10);
        const f = await readyEnrollment(i);
        assert.equal(await enroll(i, f, activator, { email: 'wrong@example.test' }), 'blocked');
        assert.equal(await enroll(i, f, activator, { cohort: SECOND }), 'blocked');
        await admin.unsafe('UPDATE auth.users SET raw_app_meta_data=$1::jsonb WHERE id=$2::uuid', [
          authProofParameter(admin, i, false),
          i.id,
        ]);
        assert.equal(await enroll(i, f), 'blocked');
        assert.equal(
          (await observer.unsafe('SELECT 1 FROM app.users WHERE auth_user_id=$1::uuid', [i.id]))
            .length,
          0,
        );
      },
      enrollment_retry_and_completion: async () => {
        const i = synthetic(11);
        let f = await readyEnrollment(i);
        assert.equal(await enroll(i, f), 'complete');
        await release(i, f);
        const c = await claim(i);
        assert.equal(c.claim_state, 'acquired');
        assert.equal(await enroll(i, f), 'blocked');
        f = c.fence;
        assert.equal(await enroll(i, f), 'complete');
        assert.equal(await complete(i, f), true);
        assert.equal((await claim(i, u(7998))).claim_state, 'conflict');
        const rows = await observer.unsafe(
          'SELECT p.node_key,p.state::text FROM app.learner_node_progress p JOIN app.users u ON u.id=p.user_id WHERE u.auth_user_id=$1::uuid ORDER BY p.node_key',
          [i.id],
        );
        assert.deepEqual(
          rows.map((r) => ({ ...r })),
          [
            { node_key: 'dependent', state: 'locked' },
            { node_key: 'root', state: 'available' },
          ],
        );
        assert.equal(
          (
            await observer.unsafe(
              'SELECT count(*)::integer AS n FROM app.invitation_enrollment_receipts WHERE invitation_id=$1::uuid',
              [i.id],
            )
          )[0].n,
          1,
        );
      },
      concurrent_enrollment: async () => {
        const i = synthetic(12),
          f = await readyEnrollment(i);
        const other = bindSession(connect(), ACTIVATOR);
        assert.deepEqual(await Promise.all([enroll(i, f), enroll(i, f, other)]), [
          'complete',
          'complete',
        ]);
        assert.equal(
          (
            await observer.unsafe(
              'SELECT count(*)::integer AS n FROM app.users WHERE auth_user_id=$1::uuid',
              [i.id],
            )
          )[0].n,
          1,
        );
        assert.equal(
          (
            await observer.unsafe(
              'SELECT count(*)::integer AS n FROM app.invitation_enrollment_receipts WHERE invitation_id=$1::uuid',
              [i.id],
            )
          )[0].n,
          1,
        );
      },
      distinct_invitation_enrollment: async () => {
        const a = synthetic(16),
          b = synthetic(17),
          fa = await readyEnrollment(a),
          fb = await readyEnrollment(b),
          other = bindSession(connect(), ACTIVATOR);
        assert.deepEqual(await Promise.all([enroll(a, fa), enroll(b, fb, other)]), [
          'complete',
          'complete',
        ]);
        const [r] = await observer.unsafe(
          'SELECT count(*)::integer AS n FROM app.invitation_enrollment_receipts WHERE invitation_id IN ($1::uuid,$2::uuid)',
          [a.id, b.id],
        );
        assert.equal(r.n, 2);
      },
      locked_authority_revocation: async () => {
        const i = synthetic(13);
        assert.equal((await issue(i)).kind, 'issued');
        await assert.rejects(
          activator.begin(async (q) => {
            const [r] = await q.unsafe(
              'SELECT app.invitation_scope_current($1::uuid,$1::uuid,$2::text,$3::text,$4::uuid) AS allowed',
              [i.id, i.email, 'Synthetic learner', COHORT],
            );
            assert.equal(r.allowed, true);
            await assert.rejects(
              admin.begin('isolation level read committed', async (a) => {
                await a.unsafe(
                  "SET LOCAL lock_timeout='150ms';SET LOCAL statement_timeout='1000ms'",
                );
                await a.unsafe('UPDATE app.users SET active=false WHERE id=$1::uuid', [OWNER]);
              }),
              (e) => e.code === '55P03',
            );
            abort();
          }),
          /EXPECTED_INVITATION_ROLLBACK/,
        );
        await admin.unsafe('UPDATE app.users SET active=false WHERE id=$1::uuid', [OWNER]);
        try {
          assert.equal((await claim(i)).claim_state, 'missing');
        } finally {
          await admin.unsafe('UPDATE app.users SET active=true WHERE id=$1::uuid', [OWNER]);
        }
      },
      outer_transaction_rollback: async () => {
        const i = synthetic(14);
        await assert.rejects(
          issuer.begin(async (q) => {
            assert.equal((await issue(i, q)).kind, 'issued');
            abort();
          }),
          /EXPECTED_INVITATION_ROLLBACK/,
        );
        assert.equal(
          (
            await observer.unsafe('SELECT 1 FROM app.invitation_activations WHERE id=$1::uuid', [
              i.id,
            ])
          ).length,
          0,
        );
        assert.equal(
          (
            await observer.unsafe('SELECT 1 FROM app.invitation_acceptances WHERE id=$1::uuid', [
              i.id,
            ])
          ).length,
          0,
        );
        const j = synthetic(15),
          f = await readyEnrollment(j);
        await assert.rejects(
          activator.begin(async (q) => {
            assert.equal(await enroll(j, f, q), 'complete');
            abort();
          }),
          /EXPECTED_INVITATION_ROLLBACK/,
        );
        assert.equal(
          (await observer.unsafe('SELECT 1 FROM app.users WHERE auth_user_id=$1::uuid', [j.id]))
            .length,
          0,
        );
        assert.equal(await enroll(j, f), 'complete');
      },
      no_awards_or_role_escalation: async () => {
        const [r] = await observer.unsafe(
          "SELECT (SELECT count(*)::integer FROM app.submissions) AS submissions,(SELECT count(*)::integer FROM judge.jobs) AS jobs,(SELECT count(*)::integer FROM app.learner_node_progress WHERE state='mastered') AS mastered,(SELECT count(*)::integer FROM app.users WHERE auth_user_id NOT IN ($1::uuid,$2::uuid) AND role<>'learner') AS elevated",
          [u(101), u(102)],
        );
        assert.deepEqual({ ...r }, { submissions: 0, jobs: 0, mastered: 0, elevated: 0 });
      },
    };
    const cases = await runCases(
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
      real_postgres: true,
      real_auth_provider: false,
      real_tokens: false,
      retained_database_touched: false,
      lost_ack_wire_fault: false,
      synthetic_policy_only: true,
    };
  } catch (e) {
    result = {
      state: 'failed',
      scope_sha256: record.scope_sha256,
      phase,
      sqlstate: /^[0-9A-Z]{5}$/.test(e?.code ?? '') ? e.code : null,
      assertion_failure: e?.code === 'ERR_ASSERTION',
      raw_diagnostics_retained: false,
      migration_commit_status: /^(prerequisite_|draft_)/.test(phase)
        ? 'unacknowledged_unknown'
        : 'not_migration_failure',
    };
  } finally {
    for (const c of clients.filter((c) => c !== admin)) await c.end({ timeout: 1 }).catch(() => {});
    try {
      if (
        (
          await admin.unsafe("SELECT to_regclass('app.invitation_issuance_policy') AS table_name")
        )[0].table_name
      )
        await admin.unsafe('UPDATE app.invitation_issuance_policy SET enabled=false');
      if (
        (
          await admin.unsafe("SELECT to_regclass('app.invitation_admission_policy') AS table_name")
        )[0].table_name
      )
        await admin.unsafe('UPDATE app.invitation_admission_policy SET enabled=false');
      cleanup.policy_disabled = true;
      for (const [role, member] of [
        ['nextera_invitation_issuer', ISSUER],
        ['nextera_invitation_runtime', ACTIVATOR],
        ['nextera_invitation_owner', ACTOR],
      ]) {
        const exists = await admin.unsafe(
          'SELECT 1 FROM pg_roles WHERE rolname IN ($1::text,$2::text)',
          [role, member],
        );
        if (exists.length === 2)
          await admin.unsafe('REVOKE ' + quote(role) + ' FROM ' + quote(member) + ' RESTRICT');
      }
      cleanup.test_memberships_removed =
        (
          await admin.unsafe(
            'SELECT count(*)::integer AS n FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname IN ($1::text,$2::text,$3::text)',
            ['nextera_invitation_owner', 'nextera_invitation_issuer', 'nextera_invitation_runtime'],
          )
        )[0].n === 0;
      for (const role of ROLES)
        if ((await admin.unsafe('SELECT 1 FROM pg_roles WHERE rolname=$1::text', [role])).length)
          await admin.unsafe('ALTER ROLE ' + quote(role) + ' NOLOGIN NOCREATEROLE');
      cleanup.roles_disabled =
        (
          await admin.unsafe(
            "SELECT count(*)::integer AS n FROM pg_roles WHERE rolname !~ '^pg_' AND rolname<>'anas' AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)",
          )
        )[0].n === 0;
    } catch {
      cleanup.policy_disabled = false;
    }
    await admin.end({ timeout: 1 }).catch(() => {});
  }
  result.cleanup = cleanup;
  if (!Object.values(cleanup).every(Boolean)) result.state = 'failed';
  return result;
}
async function main() {
  assert.equal(process.argv[2], '--execute-approved-private-rehearsal');
  assert.equal(process.argv[3], path.join(TARGET, 'control.json'));
  privateFile(process.argv[3]);
  const r = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  validateControl(r);
  const { default: postgres } = await import('postgres');
  const result = await executePreparedRunner(r, postgres);
  receipt(r, 'assertions.json', result);
  process.exitCode = result.state === 'passed' ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(
      'Private invitation rehearsal failed; inspect protected status receipts.\n',
    );
    process.exitCode = 1;
  });
}
