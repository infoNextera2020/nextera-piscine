import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import {
  WEEK1_TARGET,
  WEEK1_SERVICES,
  WEEK1_LEARNERS,
  WEEK1_SQL_ORDER,
  WEEK1_DRAFT_ACLS,
  prepareWeek1AuthBroker,
  week1ScopeSha256,
  validateWeek1Lease,
  createWeek1AuthHttpPort,
  exerciseWeek1AuthInjected,
  applyWeek1Registered,
  applyWeek1Draft,
  projectWeek1WebCredentials,
  buildWeek1Compose,
  validateWeek1EffectiveCompose,
  writeWeek1Private,
  cleanupWeek1AuthAccess,
} from '../week1-auth-live-broker.mjs';

const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const spec = () => {
  const value = {
    version: 1,
    target: WEEK1_TARGET,
    sourceLockSha256: 'a'.repeat(64),
    reviewedHead: 'b'.repeat(40),
    learners: WEEK1_LEARNERS,
    bounds: { ownerApprovalStartSeconds: 600, maximumSeconds: 3600, cleanupReserveSeconds: 180 },
    policy: {
      emailConfirmed: true,
      passwordContract: 'ascii-synthetic-v1',
      minPasswordBytes: 1,
      maxPasswordBytes: 64,
      maxTokenBytes: 43,
      claimLeaseMs: 1000,
      maxLifetimeMs: 60000,
      maxBodyBytes: 4096,
      bodyTimeoutMs: 1000,
      publicTimeoutMs: 1000,
      maxResponseBytes: 4096,
      publicMaxPasswordBytes: 64,
      rates: Object.fromEntries(
        ['ingress', 'inspect', 'activate', 'issueIngress', 'issuer'].map((profile) => [
          profile,
          {
            profile: 'fake_' + profile.toLowerCase(),
            windowMs: 1000,
            maxRequests: 5,
            retentionMs: 2000,
          },
        ]),
      ),
    },
    maxLimiterReceipts: 17,
    authJwtSeconds: 120,
    cookieName: 'sb-127-auth-token',
    maxCookieBytes: 4096,
    images: Object.fromEntries(
      WEEK1_SERVICES.map((s) => [s, 'fixture.invalid/' + s + '@sha256:' + 'c'.repeat(64)]),
    ),
    sqlOrder: WEEK1_SQL_ORDER,
    readersSha256: 'd'.repeat(64),
  };
  return { ...value, scopeSha256: week1ScopeSha256(value) };
};
const resign = (value) => ({ ...value, scopeSha256: week1ScopeSha256(value) });
const lease = () => ({
  profile: WEEK1_TARGET.profile,
  scopeSha256: 'a'.repeat(64),
  sourceLockSha256: 'b'.repeat(64),
  started: 1000000,
  deadline: 4600000,
  cleanupAt: 4420000,
  monotonicStarted: 2000000,
  monotonicDeadline: 5600000,
  parentPid: 10,
  parentTicks: '123',
  guardPid: 11,
  guardTicks: '124',
});

test('pure preparation freezes exact source scope and never authorizes runtime', () => {
  const input = spec(),
    out = prepareWeek1AuthBroker(input);
  assert.equal(out.runtimeReady, false);
  assert.ok(Object.isFrozen(out.policy.rates));
  input.policy.rates.ingress.maxRequests = 999;
  assert.equal(out.policy.rates.ingress.maxRequests, 5);
  assert.throws(() => prepareWeek1AuthBroker(input), /SCOPE_CONTENT/);
  for (const patch of [
    { cookieName: 'unbound-cookie' },
    { maxCookieBytes: 65537 },
    { maxLimiterReceipts: undefined },
    { authJwtSeconds: undefined },
    {
      target: {
        ...WEEK1_TARGET,
        database: 'foundation_test_checkpoint_browser_20261029_attempt003',
      },
    },
    { sqlOrder: [...WEEK1_SQL_ORDER, '0021_checkpoint_answer_drafts.DRAFT.sql'] },
    { bounds: { ...spec().bounds, maximumSeconds: 3601 } },
  ])
    assert.throws(() => prepareWeek1AuthBroker(resign({ ...spec(), ...patch })));
});
test('original immutable lease enforces parent ticks, wall/monotonic cutoff and cleanup reserve', () => {
  const l = lease(),
    parent = { pid: 10, ticks: '123' },
    guard = { pid: 11, ticks: '124' };
  validateWeek1Lease(l, 1000001, 2000001, parent, guard);
  for (const args of [
    [l, l.cleanupAt, 2000001, parent, guard],
    [l, 1000001, l.monotonicDeadline - 180000, parent, guard],
    [l, 1000001, 2000001, { pid: 10, ticks: 'reused' }, guard],
  ])
    assert.throws(() => validateWeek1Lease(...args));
  validateWeek1Lease(l, l.cleanupAt, 5420000, null, guard, true);
  assert.throws(() => validateWeek1Lease(l, l.deadline - 30000, 5500000, null, guard, true));
});
function lifecycle(fail) {
  const events = [];
  const io = {
    admit: async () => events.push('admit'),
    preflight: async () => events.push('preflight'),
    reserve: async () => {
      events.push('reserve');
      return 'fake';
    },
    guard: async () => events.push('guard'),
    checkLease: async () => {
      if (fail === 'parentloss') throw Error('fake parentlost');
    },
    journal: async (v) => events.push(v),
    phase: async (phase) => {
      events.push(phase);
      if (phase === fail) throw Error('fake sensitive provider details');
    },
    cleanup: async () => {
      events.push('cleanup');
      return {
        providerRevoked: true,
        appDisabled: true,
        sqlDisabled: true,
        stopped: true,
        retained: true,
      };
    },
  };
  return { io, events };
}
test('fully injected lifecycle succeeds, cleanup follows every started phase, and no native readiness is claimed', async () => {
  const f = lifecycle(),
    result = await exerciseWeek1AuthInjected(f.io, spec());
  assert.equal(result.assertionsPassed, true);
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.runtimeReady, false);
  assert.deepEqual(f.events.slice(0, 5), ['admit', 'preflight', 'admit', 'reserve', 'guard']);
  assert.equal(f.events.at(-1), 'cleanup');
});
for (const phase of [
  'stage',
  'stack',
  'migrations',
  'bootstrap',
  'web',
  'invitations',
  'assert_http',
  'parentloss',
])
  test('injected ' + phase + ' failure/parentloss always cleans uncertain state', async () => {
    const f = lifecycle(phase),
      r = await exerciseWeek1AuthInjected(f.io, spec());
    assert.equal(r.assertionsPassed, false);
    assert.equal(r.cleanupVerified, true);
    assert.equal(f.events.at(-1), 'cleanup');
  });
test('failed preflight/admission cannot reserve or create Auth/resources', async () => {
  for (const gate of ['admit', 'preflight']) {
    const f = lifecycle();
    f.io[gate] = async () => {
      throw Error('fake denied');
    };
    await assert.rejects(exerciseWeek1AuthInjected(f.io, spec()));
    assert.ok(!f.events.includes('reserve'));
  }
});

function authFake({ ambiguous = false, unknown = false } = {}) {
  const events = [],
    users = [];
  let serial = 10,
    creates = 0;
  const sessions = [];
  const admin = {
    listUsers: async () => ({ data: { users: [...users] }, error: null }),
    createUser: async (input) => {
      assert.equal(events.at(-1).kind, 'auth_create');
      creates++;
      const user = { id: id(++serial), email: input.email };
      users.push(user);
      if (ambiguous) throw Error('fake lost create acknowledgement');
      return { data: { user }, error: null };
    },
    signOut: async () => ({ error: null }),
    updateUserById: async (userId) => {
      events.push({ ban: userId });
      return { error: null };
    },
  };
  const ordinary = (person) => ({
    auth: {
      signInWithPassword: async () => {
        const user = users.find((u) => u.email === person.email);
        return user
          ? {
              data: { user, session: { access_token: 'fake-never-a-real-access-token' } },
              error: null,
            }
          : { data: {}, error: { code: 'fake' } };
      },
    },
  });
  const config = { cohortId: id(2), cleanupAt: 9000000, now: () => 1000000, policy: spec().policy };
  const request = async (url, init) => {
    events.push({ url, input: JSON.parse(init.body) });
    if (url.endsWith('/issue'))
      return globalThis.Response.json(
        { status: 'issued', link: WEEK1_TARGET.origin + '/signup#invitation=' + 'a'.repeat(43) },
        { status: 201 },
      );
    assert.equal(events.at(-2).kind, 'auth_create');
    assert.equal(events.at(-2).state, 'intent');
    const user = { id: id(++serial), email: WEEK1_LEARNERS[0].email };
    users.push(user);
    if (ambiguous) throw Error('fake ambiguous activation');
    return globalThis.Response.json({ status: 'activated' });
  };
  const port = createWeek1AuthHttpPort({
    config,
    admin,
    ordinary,
    fetch: request,
    issuerCookie: async () => 'fake-local-cookie',
    uuid: () => id(++serial),
    checkTime: () => {},
    journal: async (value) => events.push(value),
    savePrivate: async (value) => sessions.push(value),
  });
  if (unknown) users.push({ id: id(999), email: 'unknown-but-exclusively-owned@example.invalid' });
  return { port, events, users, sessions, creates: () => creates };
}
test('fresh-empty Auth inventory is concrete, scanned twice, and occupied Auth cannot be adopted', async () => {
  const f = authFake();
  assert.equal((await f.port.proveEmpty()).count, 0);
  f.users.push({ id: id(99), email: 'fake@example.invalid' });
  await assert.rejects(f.port.proveEmpty(), /AUTH_NOT_FRESH_EMPTY/);
});
test('bootstrap issuer creation is journalled durably before its only direct Auth create call', async () => {
  const f = authFake();
  await f.port.createIssuer({ email: 'issuer@example.invalid', password: 'fake-password' });
  assert.equal(f.creates(), 1);
  assert.equal(f.events[0].state, 'intent');
  assert.equal(f.events.at(-1).state, 'acknowledged');
});
test('learners use genuine issue+activate HTTP boundary with pre-create intent and ordinary sign-in', async () => {
  const f = authFake();
  const authId = await f.port.activateLearner({ ...WEEK1_LEARNERS[0], password: 'fake-password' });
  assert.match(authId, /^10000000-/);
  assert.equal(f.creates(), 0);
  assert.ok(f.events.some((v) => v.url?.endsWith('/api/invitations/activate')));
  assert.ok(f.sessions.some((v) => v.kind === 'activation_operation'));
});
test('ambiguous activation preserves intent and cleanup inventory accounts for unknown IDs without retrying create', async () => {
  const f = authFake({ ambiguous: true });
  await assert.rejects(f.port.activateLearner({ ...WEEK1_LEARNERS[0], password: 'fake-password' }));
  const before = f.events.filter((v) => v.url?.endsWith('/activate')).length;
  const cleanup = await f.port.revokeInventory(() => 'fake-password');
  assert.equal(cleanup.users.length, 1);
  assert.equal(cleanup.failures.length, 0);
  assert.equal(before, 1);
  assert.equal(f.creates(), 0);
});
test('unknown exclusively-owned inventory IDs are banned but cannot be called revoked without provider proof', async () => {
  const f = authFake({ unknown: true });
  const r = await f.port.revokeInventory(() => null);
  assert.equal(r.users.length, 1);
  assert.equal(r.failures[0].reason, 'provider_sessions_unverified');
  assert.equal(f.events.at(-1).ban, id(999));
});
test('unknown bootstrap create acknowledgement is not retried or treated as absent', async () => {
  const f = authFake({ ambiguous: true });
  await assert.rejects(
    f.port.createIssuer({ email: 'issuer@example.invalid', password: 'fake-password' }),
    /AUTH_CREATE_UNKNOWN/,
  );
  assert.equal(f.users.length, 1);
  assert.equal(f.creates(), 1);
  assert.equal(f.events[0].state, 'intent');
});
test('provider inventory failure still bans native-owned IDs and disables app and SQL independently', async () => {
  const events = [];
  const result = await cleanupWeek1AuthAccess({
    revokeProviderInventory: async () => {
      throw Error('fake provider outage');
    },
    readOwnedAuthRows: async () => [{ id: id(700), email: 'owned@example.invalid' }],
    banOwnedId: async (value) => events.push(['ban', value]),
    journal: async (value) => events.push(value.kind),
    disableApplication: async () => events.push('app'),
    disableSqlLogins: async () => events.push('sql'),
    verifyAccess: async () => ({
      sessions: 0,
      refresh_tokens: 0,
      unbanned_users: 0,
      active_users: 0,
      active_memberships: 0,
      logins: 0,
      login_memberships: 0,
    }),
  });
  assert.equal(result.providerRevoked, false);
  assert.equal(result.appDisabled, true);
  assert.equal(result.sqlDisabled, true);
  assert.ok(events.includes('sql'));
  assert.deepEqual(result.inventoryIds, [id(700)]);
});
test('application disable failure cannot skip SQL disable or manufacture cleanup verification', async () => {
  const events = [];
  const result = await cleanupWeek1AuthAccess({
    revokeProviderInventory: async () => ({ users: [], failures: [] }),
    readOwnedAuthRows: async () => [],
    banOwnedId: async () => {},
    journal: async () => {},
    disableApplication: async () => {
      events.push('app');
      throw Error('fake SQL app failure');
    },
    disableSqlLogins: async () => events.push('sql'),
    verifyAccess: async () => ({
      sessions: 0,
      refresh_tokens: 0,
      unbanned_users: 0,
      active_users: 1,
      active_memberships: 1,
      logins: 0,
      login_memberships: 0,
    }),
  });
  assert.deepEqual(events, ['app', 'sql']);
  assert.equal(result.appDisabled, false);
  assert.equal(result.sqlDisabled, true);
});

function sqlFake({ lostAck = false, wrongDatabase = false, badRestore = false } = {}) {
  const calls = [];
  let role = WEEK1_TARGET.dba,
    member = false;
  const graph = () => ({ roles: [], memberships: member ? [{ fake: 'temporary' }] : [] });
  const client = {
    options: { prepare: false },
    begin: async (_isolation, work) => {
      const sql = {
        unsafe: async (text, args = []) => {
          calls.push([text, args]);
          if (text.startsWith('SET LOCAL SESSION AUTHORIZATION')) {
            role = text.split('"')[1];
            return [];
          }
          if (text.startsWith('SELECT current_database()'))
            return [
              {
                database: wrongDatabase ? 'old_closed' : WEEK1_TARGET.database,
                actor: role,
                session_actor: role,
                super: role === WEEK1_TARGET.dba,
              },
            ];
          if (text === WEEK1_OWNER_GRAPH_SQL) return [{ graph: graph() }];
          if (text.startsWith('SELECT rolname,rolcanlogin'))
            return [
              {
                rolname: args[0],
                rolcanlogin: false,
                rolsuper: false,
                rolbypassrls: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolreplication: false,
                member: false,
              },
            ];
          if (text.startsWith('GRANT "nextera_')) {
            member = true;
            return [];
          }
          if (text.startsWith('REVOKE "nextera_')) {
            if (!badRestore) member = false;
            return [];
          }
          if (text.includes('AS no_public')) {
            const found = Object.values(WEEK1_DRAFT_ACLS)
              .flat()
              .find((v) => v[0] === args[0]);
            const grantees = [...(found?.[2] ? ['nextera_web'] : []), ...(found?.[3] ?? [])].sort();
            return [
              {
                owner: found?.[1],
                no_public: true,
                web_execute: found?.[2],
                execute_only: true,
                grantees,
              },
            ];
          }
          return [];
        },
      };
      const value = await work(sql);
      if (lostAck) throw Error('fake lost commitack');
      return value;
    },
  };
  return { client, calls };
}
import { WEEK1_OWNER_GRAPH_SQL } from '../week1-auth-live-broker.mjs';
test('registered file preserves exact bytes/DBA spans in one acknowledged transaction on NEW target', async () => {
  const f = sqlFake(),
    file = '0003_judge_protocol.sql',
    bytes = fs.readFileSync(new URL('../../packages/db/migrations/' + file, import.meta.url));
  const r = await applyWeek1Registered(
    f.client,
    file,
    bytes,
    () => {},
    async () => {},
  );
  assert.equal(r.actorRestoredBeforeCommit, true);
  const roles = f.calls
    .filter(([s]) => s.startsWith('SET LOCAL SESSION AUTHORIZATION'))
    .map(([s]) => s.split('"')[1]);
  assert.deepEqual(roles, [WEEK1_TARGET.actor, WEEK1_TARGET.dba, WEEK1_TARGET.actor]);
});
test('registered old target identity/tampered bytes/lost acknowledgement cannot pass as applied', async () => {
  const file = '0000_foundation_001.sql',
    bytes = fs.readFileSync(new URL('../../packages/db/migrations/' + file, import.meta.url));
  await assert.rejects(
    applyWeek1Registered(
      sqlFake({ wrongDatabase: true }).client,
      file,
      bytes,
      () => {},
      async () => {},
    ),
  );
  await assert.rejects(
    applyWeek1Registered(
      sqlFake({ lostAck: true }).client,
      file,
      bytes,
      () => {},
      async () => {},
    ),
  );
  await assert.rejects(
    applyWeek1Registered(
      sqlFake().client,
      file,
      Buffer.concat([bytes, Buffer.from(' ')]),
      () => {},
      async () => {},
    ),
  );
});
test('checkpoint owner context is scoped and restored before real catalog ACL acknowledgement', async () => {
  const f = sqlFake(),
    file = '0014_checkpoint_editor_context.DRAFT.sql',
    bytes = fs.readFileSync(new URL('../../packages/db/migration-drafts/' + file, import.meta.url));
  const r = await applyWeek1Draft(
    f.client,
    file,
    bytes,
    null,
    () => {},
    async () => {},
  );
  assert.equal(r.authorityRestored, true);
  assert.ok(f.calls.some(([s]) => s.startsWith('REVOKE "nextera_checkpoint_owner"')));
  await assert.rejects(
    applyWeek1Draft(
      sqlFake({ badRestore: true }).client,
      file,
      bytes,
      null,
      () => {},
      async () => {},
    ),
    /AUTHORITY_NOT_RESTORED/,
  );
});
test('web projection cannot expose bootstrap passwords, JWT signing keys, or account passwords', () => {
  const c = { version: 1 },
    control = { ...lease(), spec: spec() },
    broker = {
      POSTGRES_PASSWORD: 'fake-dba',
      JWT_SECRET: 'fake-signing',
      issuer: { password: 'fake-issuer' },
      learners: [{ password: 'fake-learner' }],
      ANON_KEY: 'fake-anon',
      SERVICE_ROLE_KEY: 'fake-service',
      connections: {
        issuer: 'fake-issuer-dsn',
        activation: 'fake-activation-dsn',
        web: 'fake-web-dsn',
      },
    };
  const projected = projectWeek1WebCredentials(control, broker, c),
    serialized = JSON.stringify(projected);
  for (const secret of ['fake-dba', 'fake-signing', 'fake-issuer"', 'fake-learner'])
    assert.ok(!serialized.includes(secret));
  assert.equal(projected.cookieName, 'sb-127-auth-token');
});
test('private writes use exclusive NOFOLLOW descriptors,0600,fsyncfile+directory with injected FS only', () => {
  const calls = [],
    io = {
      constants: {
        O_WRONLY: 1,
        O_CREAT: 2,
        O_EXCL: 4,
        O_NOFOLLOW: 8,
        O_RDONLY: 16,
        O_DIRECTORY: 32,
      },
      openSync: (...v) => {
        calls.push(['open', ...v]);
        return calls.length;
      },
      writeFileSync: (...v) => calls.push(['write', ...v]),
      fsyncSync: (fd) => calls.push(['fsync', fd]),
      closeSync: (fd) => calls.push(['close', fd]),
    };
  writeWeek1Private('/fake-owned/evidence.json', { fake: true }, io);
  assert.equal(calls[0][2], 15);
  assert.equal(calls[0][3], 0o600);
  assert.equal(calls.filter((v) => v[0] === 'fsync').length, 2);
});
test('pure compose transformation pins images,no restart,exactloopbackports and freshvolumes', () => {
  const s = spec(),
    template = {
      services: Object.fromEntries(
        WEEK1_SERVICES.map((name) => [
          name,
          {
            environment: { DATABASE_URL: 'postgres://fake@db/postgres' },
            volumes: [],
            image: 'old',
            ports: [],
          },
        ]),
      ),
    },
    out = buildWeek1Compose(template, s.images, s);
  assert.equal(out.name, WEEK1_TARGET.project);
  assert.equal(out.services.db.restart, 'no');
  assert.deepEqual(out.services.db.ports, ['127.0.0.1:56532:5432']);
  assert.equal(out.services.auth.labels['io.nextera.week1.scope'], s.scopeSha256);
  assert.equal(template.services.db.image, 'old');
  const effective = globalThis.structuredClone(out);
  effective.services.db.ports = [{ host_ip: '127.0.0.1', published: '56532' }];
  effective.services['api-gw'].ports = [{ host_ip: '127.0.0.1', published: '56531' }];
  assert.equal(validateWeek1EffectiveCompose(effective, s.images), true);
  effective.services.db.ports[0].host_ip = '0.0.0.0';
  assert.throws(() => validateWeek1EffectiveCompose(effective, s.images));
});

import { assertWeek1RestrictedLogin } from '../week1-auth-live-broker.mjs';
test('restricted SQL login requires exact native flags, sole membership and cleanup expiry', async () => {
  const role = WEEK1_TARGET.roles.activation,
    member = 'nextera_invitation_runtime',
    cutoff = 1793318400000;
  const good = {
    rolname: role,
    rolcanlogin: true,
    rolinherit: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolbypassrls: false,
    rolreplication: false,
    rolconfig: null,
    valid_until_ms: String(cutoff),
    memberships: [{ role: member, admin: false, inherit: true, set: false }],
  };
  const calls = [];
  const fake = (rows) => ({
    unsafe: async (...args) => {
      calls.push(args);
      return rows;
    },
  });
  assert.equal(await assertWeek1RestrictedLogin(fake([good]), role, member, cutoff), true);
  assert.deepEqual(calls[0][1], [role]);
  for (const change of [
    { rolsuper: true },
    { rolcreaterole: true },
    { rolbypassrls: true },
    { rolcanlogin: false },
    { rolconfig: ['role=nextera_invitation_owner'] },
    { valid_until_ms: String(cutoff + 180000) },
    { memberships: [{ role: member, admin: true, inherit: true, set: false }] },
    { memberships: [{ role: member, admin: false, inherit: true, set: true }] },
    {
      memberships: [
        ...good.memberships,
        { role: 'unexpected', admin: false, inherit: true, set: false },
      ],
    },
  ]) {
    await assert.rejects(
      assertWeek1RestrictedLogin(fake([{ ...good, ...change }]), role, member, cutoff),
      /LOGIN_CATALOG/,
    );
  }
  await assert.rejects(assertWeek1RestrictedLogin(fake([]), role, member, cutoff), /LOGIN_CATALOG/);
  await assert.rejects(
    assertWeek1RestrictedLogin(fake([good, good]), role, member, cutoff),
    /LOGIN_CATALOG/,
  );
  await assert.rejects(
    assertWeek1RestrictedLogin(fake([good]), WEEK1_TARGET.dba, member, cutoff),
    /LOGIN_SCOPE/,
  );
});
test('controller startup digest key matches the server-only native resolver', () => {
  const controller = fs.readFileSync(
    new URL('../week1-auth-rehearsal.py', import.meta.url),
    'utf8',
  );
  const resolver = fs.readFileSync(
    new URL('../../apps/web/lib/invitations/runtime-native-binding.ts', import.meta.url),
    'utf8',
  );
  const key = 'NEXTERA_WEEK1_INVITATION_STARTUP_SHA256';
  assert.ok(controller.includes(key));
  assert.ok(resolver.includes(key));
  assert.ok(!controller.includes('NEXTERA_WEEK1_AUTH_STARTUP_ANCHOR_SHA256'));
});

import { writeWeek1PublicJwtTemplate } from '../week1-auth-live-broker.mjs';
test('only public JWT SQL keeps container-readable mode; secrets cannot use this writer', () => {
  const file = WEEK1_TARGET.root + '/stack/volumes/db/jwt.sql',
    events = [];
  let bytes = '',
    mode = 0o644;
  const stat = () => ({
    isFile: () => true,
    uid: 1000,
    nlink: 1,
    dev: 1,
    ino: 2,
    mode,
    size: Buffer.byteLength(bytes),
  });
  const io = {
    constants: { O_RDWR: 2, O_NOFOLLOW: 8 },
    openSync: (p, flags) => {
      events.push(['open', p, flags]);
      return 7;
    },
    fstatSync: () => stat(),
    ftruncateSync: () => {
      bytes = '';
    },
    writeFileSync: (_, v) => {
      bytes = v;
    },
    fchmodSync: (_, v) => {
      mode = v;
      events.push(['mode', v]);
    },
    fsyncSync: () => events.push('sync'),
    readSync: (_, buffer, offset, length, position) => {
      events.push(['read', position]);
      return Buffer.from(bytes).copy(buffer, offset, position, position + length);
    },
    closeSync: () => events.push('close'),
  };
  writeWeek1PublicJwtTemplate(file, "SELECT current_setting('app.settings.jwt_secret');", io, 1000);
  assert.equal(mode, 0o644);
  assert.deepEqual(events[0], ['open', file, 10]);
  assert.equal(events.at(-1), 'close');
  for (const denied of [WEEK1_TARGET.root + '/credentials.json', WEEK1_TARGET.root + '/stack/.env'])
    assert.throws(
      () => writeWeek1PublicJwtTemplate(denied, 'fake-secret', io, 1000),
      /PUBLIC_SQL_SCOPE/,
    );
  assert.throws(
    () =>
      writeWeek1PublicJwtTemplate(
        file,
        'fake-public',
        { ...io, fstatSync: () => ({ ...stat(), nlink: 2 }) },
        1000,
      ),
    /PUBLIC_SQL_METADATA/,
  );
  assert.throws(
    () =>
      writeWeek1PublicJwtTemplate(
        file,
        'fake-public',
        {
          ...io,
          readSync: (_, buffer, offset, length) => {
            buffer.fill(0, offset, offset + length);
            return length;
          },
        },
        1000,
      ),
    /PUBLIC_SQL_READBACK/,
  );
});
