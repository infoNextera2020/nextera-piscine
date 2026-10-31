import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import {
  week1PendingAuthCreations,
  readWeek1BrowserFacts,
  week1RegistrationDriver,
  week1AuthPhases,
  validateWeek1BrowserProof,
  awaitWeek1BrowserRegistration,
  WEEK1_TARGET,
  WEEK1_SERVICES,
  WEEK1_LEARNERS,
  WEEK1_SQL_ORDER,
  WEEK1_DRAFT_ACLS,
  WEEK1_CHECKPOINT,
  runWeek1SelectedCheckpoint,
  week1LearnerSessionCount,
  validateWeek1CheckpointFixture,
  parseWeek1CheckpointSnapshot,
  seedWeek1CheckpointDraftPolicy,
  verifyWeek1CheckpointHttp,
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
  executePhase,
} from '../week1-auth-live-broker.mjs';

const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const spec = () => {
  const value = {
    version: 1,
    buildBundler: 'webpack',
    rehearsalChecks: 'auth-invitation-checkpoint',
    registrationDriver: 'http-only',
    hostGuardExecutionPolicy: 'process-RemoteSigned',
    target: WEEK1_TARGET,
    sourceLockSha256: 'a'.repeat(64),
    reviewedHead: 'b'.repeat(40),
    learners: WEEK1_LEARNERS,
    checkpoint: {
      ...WEEK1_CHECKPOINT,
      fixtureSha256: 'e'.repeat(64),
      snapshotSha256: '8'.repeat(64),
      contentDigest: 'f'.repeat(64),
    },
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
test('checkpoint scope retains only the fixed existing synthetic fixture and explicit draft limits', () => {
  const s = spec();
  for (const checkpoint of [
    undefined,
    { ...s.checkpoint, durationSeconds: 180 * 60 },
    { ...s.checkpoint, fixtureFile: 'content/real-exam.ts' },
    { ...s.checkpoint, draftPolicy: { ...WEEK1_CHECKPOINT.draftPolicy, offlineRecovery: true } },
  ])
    assert.throws(
      () => prepareWeek1AuthBroker(resign({ ...s, checkpoint })),
      /CHECKPOINT_FIXTURE_SCOPE/,
    );
});

function checkpointHttpFake(fault) {
  const events = [],
    a = { authId: id(21), userId: id(31), sessionId: id(51), cookie: 'a-session-one' },
    b = { authId: id(22), userId: id(32), sessionId: id(52), cookie: 'b-session-one' },
    second = { ...a, sessionId: id(53), cookie: 'a-session-two' },
    attempts = [id(41), id(42)],
    definitionDigest = '9'.repeat(64),
    cohortId = id(4),
    receipts = new Map();
  let serial = 100,
    record = null,
    revoked = false,
    official = 0;
  const reply = (body, status = 200) =>
    globalThis.Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
  const fetch = async (url, init) => {
    const u = new URL(url),
      cookie = init.headers.cookie,
      who =
        cookie === a.cookie || cookie === second.cookie ? 'a' : cookie === b.cookie ? 'b' : null;
    events.push({ url: u.pathname, cookie, headers: init.headers, body: init.body });
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    if (u.pathname === '/api/checkpoints') {
      assert.equal(init.method, 'POST');
      assert.equal(init.body, undefined);
      assert.equal(init.headers['x-action'], 'start');
      assert.equal(init.headers['x-node-key'], WEEK1_CHECKPOINT.nodeKey);
      return reply({ id: attempts[who === 'a' ? 0 : 1] }, 202);
    }
    const attempt = init.headers['x-attempt-id'] ?? u.searchParams.get('attempt'),
      task = init.headers['x-task-key'] ?? u.searchParams.get('task');
    assert.equal(task, WEEK1_CHECKPOINT.taskKey);
    if (!who) return reply({ error: 'UNAUTHENTICATED' }, 401);
    if (revoked && who === 'a' && fault !== 'revocation') return reply({ error: 'FORBIDDEN' }, 403);
    if ((who === 'b' && attempt === attempts[0]) || (who === 'a' && attempt === attempts[1])) {
      if (fault !== 'cross-learner') return reply({ error: 'FORBIDDEN' }, 403);
    }
    if (u.pathname === '/api/checkpoints/editor')
      return reply({
        schema: 1,
        window: {
          scope: {
            learnerId: who === 'a' ? a.userId : b.userId,
            cohortId,
            attemptId: attempt,
            taskKey: task,
            definitionDigest,
          },
          access: 'confirmed',
          attempt: 'active',
          serverNow: '2026-10-30T12:00:00Z',
          deadline: fault === 'deadline' ? '2026-10-30T12:00:00Z' : '2026-10-30T13:30:00Z',
          capabilities: { draftsV1: true, officialSubmit: true, visibleRun: null },
        },
        filename: 'normalize.go',
        sourceBytes: 1024,
        draft: who === 'a' ? record : null,
        offlineRecovery: null,
      });
    assert.equal(u.pathname, '/api/checkpoints/drafts');
    if (init.method !== 'POST')
      return record ? reply(record) : reply({ error: 'DRAFT_NOT_FOUND' }, 404);
    assert.equal(init.headers.origin, WEEK1_TARGET.origin);
    assert.equal(init.headers['content-type'], 'application/octet-stream');
    if (init.headers['x-definition-digest'] !== definitionDigest)
      return reply({ error: 'DEFINITION_MISMATCH' }, 412);
    if (init.body.byteLength > 1024) return reply({ error: 'SOURCE_TOO_LARGE' }, 413);
    const requestId = init.headers['idempotency-key'];
    if (receipts.has(requestId)) return reply(receipts.get(requestId));
    const base = Number(init.headers['x-base-version']);
    if (base !== (record?.version ?? 0) && fault !== 'cas')
      return reply({ error: 'DRAFT_CONFLICT', current: record }, 409);
    record = {
      source: Buffer.from(init.body).toString('utf8'),
      version: (record?.version ?? 0) + 1,
      requestId,
      definitionDigest,
    };
    if (fault === 'bytes') record.source += 'changed';
    receipts.set(requestId, record);
    if (fault === 'official') official++;
    return reply(record);
  };
  return {
    events,
    port: {
      fetch,
      learners: [a, b],
      rehearsalChecks: 'auth-invitation-checkpoint',
      secondSession: second,
      cohortId,
      definitionDigest,
      uuid: () => id(++serial),
      checkTime: () => {},
      journal: async (value) => events.push(value),
      revoke: async () => {
        revoked = true;
      },
      counts: async () => ({ submissions: String(official), jobs: '0', outcomes: '0' }),
      receiptCount: async () => (fault === 'receipts' ? 3 : receipts.size),
    },
  };
}
test('actual future Checkpoint HTTP calls cover two-session save/reload/CAS, isolation, revocation and Save != Submit using only fake transport', async () => {
  const f = checkpointHttpFake(),
    result = await verifyWeek1CheckpointHttp(f.port);
  assert.equal(result.naturalDeadlineTested, false);
  assert.equal(result.browserVerified, false);
  assert.equal(result.legacyDurationSeconds, 5400);
  assert.deepEqual(result.nativeCounts, { submissions: '0', jobs: '0', outcomes: '0' });
  assert.ok(
    f.events.some((e) => e.cookie === 'a-session-two' && e.url === '/api/checkpoints/drafts'),
  );
  assert.equal(f.events.filter((e) => e.url === '/api/checkpoints').length, 2);
  assert.ok(f.events.every((e) => !e.url?.includes('/submissions') && !e.url?.includes('/runs')));
});
for (const fault of [
  'deadline',
  'cross-learner',
  'revocation',
  'cas',
  'bytes',
  'official',
  'receipts',
])
  test(
    'Checkpoint protocol rejects ' + fault + ' failure without claiming conformance',
    async () => {
      await assert.rejects(verifyWeek1CheckpointHttp(checkpointHttpFake(fault).port));
    },
  );
test('Checkpoint refuses copied sessions and expired local lease before HTTP', async () => {
  let f = checkpointHttpFake();
  f.port.secondSession.cookie = f.port.learners[0].cookie;
  await assert.rejects(verifyWeek1CheckpointHttp(f.port), /CHECKPOINT_HTTP_SCOPE/);
  assert.equal(f.events.length, 0);
  f = checkpointHttpFake();
  f.port.checkTime = () => {
    throw Error('fake original deadline');
  };
  await assert.rejects(verifyWeek1CheckpointHttp(f.port), /fake original deadline/);
  assert.equal(f.events.length, 0);
});
test('source fixture validation cannot substitute real exam content or runnable evaluation packs', () => {
  const projection = {
      nodeKey: 'transfer-checkpoint',
      digest: '9'.repeat(64),
      checkpoint: {
        policyVersion: 1,
        durationSeconds: 5400,
        tasks: ['normalize-label', 'count-vowels', 'digit-sum', 'sign-label'].map((key) => ({
          key,
          evaluationSpec: {
            test_only: true,
            test_pack_artifact: 'oci:///non-runnable-checkpoint-fixture/' + key,
          },
        })),
      },
    },
    f = {
      curriculum: {
        contentDigest: 'f'.repeat(64),
        nodes: [{ key: 'transfer-checkpoint', kind: 'checkpoint' }],
      },
      evaluations: [projection],
    };
  assert.equal(validateWeek1CheckpointFixture(f, spec().checkpoint), projection);
  projection.checkpoint.tasks[0].evaluationSpec.test_only = false;
  assert.throws(() => validateWeek1CheckpointFixture(f, spec().checkpoint), /CHECKPOINT_FIXTURE/);
});
test('draft policy concrete SQL is parameterized, read back before commit, and rollback/ack failures never attest success', async () => {
  for (const fault of [null, 'readback', 'ack']) {
    const events = [],
      sql = {
        unsafe: async (text, args) => {
          events.push([text, args]);
          if (text.startsWith('SELECT current_database'))
            return [
              {
                database: WEEK1_TARGET.database,
                actor: WEEK1_TARGET.dba,
                session_actor: WEEK1_TARGET.dba,
                super: true,
              },
            ];
          if (text.startsWith('SELECT definition_digest,definition'))
            return [
              {
                definition_digest: '9'.repeat(64),
                definition: { durationSeconds: 5400, tasks: [1, 2, 3, 4] },
              },
            ];
          if (text.startsWith('SELECT definition_digest,enabled'))
            return [
              {
                definition_digest: '9'.repeat(64),
                enabled: true,
                max_source_bytes: fault === 'readback' ? 1025 : 1024,
                max_receipts_per_task: 64,
                max_bytes_per_task: '65536',
                retention_after_deadline_seconds: 600,
              },
            ];
          assert.ok(text.startsWith('INSERT INTO app.checkpoint_draft_policies'));
          assert.deepEqual(args, [
            id(7),
            'transfer-checkpoint',
            '9'.repeat(64),
            1024,
            64,
            65536,
            600,
          ]);
          return [];
        },
      },
      client = {
        options: { prepare: false },
        begin: async (_, fn) => {
          try {
            const result = await fn(sql);
            events.push(['commit']);
            return fault === 'ack' ? globalThis.structuredClone(result) : result;
          } catch (error) {
            events.push(['rollback']);
            throw error;
          }
        },
      },
      invoke = () =>
        seedWeek1CheckpointDraftPolicy(
          client,
          {
            versionId: id(7),
            definitionDigest: '9'.repeat(64),
            rehearsalChecks: 'auth-invitation-checkpoint',
          },
          () => {},
          async (value) => events.push([value.state]),
        );
    if (!fault) {
      assert.equal((await invoke()).sourceBytes, 1024);
      assert.ok(events.some((e) => e[0] === 'commit_acknowledged'));
    } else {
      await assert.rejects(invoke());
      assert.ok(!events.some((e) => e[0] === 'commit_acknowledged'));
      if (fault === 'readback') assert.ok(events.some((e) => e[0] === 'rollback'));
    }
  }
});
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
    { buildBundler: undefined },
    { buildBundler: 'turbopack' },
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

function authFake({
  ambiguous = false,
  unknown = false,
  badInspect = false,
  badReplay = false,
} = {}) {
  const events = [],
    users = [];
  let serial = 10,
    creates = 0,
    activated = false;
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
        {
          status: 'issued',
          link: WEEK1_TARGET.origin + '/signup#invitation=' + 'a'.repeat(43),
          expiresAt: JSON.parse(init.body).expiresAt,
        },
        { status: 201 },
      );
    if (url.endsWith('/inspect'))
      return globalThis.Response.json(
        activated
          ? { status: 'used' }
          : {
              status: 'valid',
              email: badInspect ? 'wrong@example.invalid' : WEEK1_LEARNERS[0].email,
              displayName: WEEK1_LEARNERS[0].displayName,
            },
        { status: activated ? 409 : 200 },
      );
    if (activated)
      return globalThis.Response.json(
        { status: badReplay ? 'activated' : 'used' },
        { status: badReplay ? 200 : 409 },
      );
    assert.equal(events.at(-2).kind, 'auth_create');
    assert.equal(events.at(-2).state, 'intent');
    const user = { id: id(++serial), email: WEEK1_LEARNERS[0].email };
    activated = true;
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
      pending_auth_operations: 0,
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
      pending_auth_operations: 0,
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

test('frozen Checkpoint snapshot binds source hashes and strict provenance without rerunning Git/random fixture creation', () => {
  const fixture = {
    version: 1,
    generator: { file: WEEK1_CHECKPOINT.fixtureFile, sha256: 'e'.repeat(64) },
    gitCommitSha: 'b'.repeat(40),
    curriculum: {
      contentDigest: 'f'.repeat(64),
      nodes: [{ key: 'transfer-checkpoint', kind: 'checkpoint' }],
    },
    evaluations: [
      {
        nodeKey: 'transfer-checkpoint',
        digest: '9'.repeat(64),
        checkpoint: {
          policyVersion: 1,
          durationSeconds: 5400,
          tasks: ['normalize-label', 'count-vowels', 'digit-sum', 'sign-label'].map((key) => ({
            key,
            evaluationSpec: {
              test_only: true,
              test_pack_artifact: 'oci:///non-runnable-checkpoint-fixture/' + key,
            },
          })),
        },
      },
    ],
  };
  const check = (value) => {
    const bytes = Buffer.from(JSON.stringify(value)),
      h = crypto.createHash('sha256').update(bytes).digest('hex'),
      binding = { ...spec().checkpoint, snapshotSha256: h },
      sources = {
        [WEEK1_CHECKPOINT.snapshotFile]: h,
        [WEEK1_CHECKPOINT.fixtureFile]: binding.fixtureSha256,
      };
    return { bytes, binding, sources };
  };
  const good = check(fixture);
  assert.equal(
    parseWeek1CheckpointSnapshot(good.bytes, good.binding, good.sources).curriculum.contentDigest,
    'f'.repeat(64),
  );
  assert.throws(
    () => parseWeek1CheckpointSnapshot(good.bytes, good.binding, {}),
    /CHECKPOINT_SNAPSHOT_SOURCE/,
  );
  for (const change of [
    (v) => {
      v.extra = 'unreviewed';
    },
    (v) => {
      v.generator.sha256 = '1'.repeat(64);
    },
    (v) => {
      v.curriculum.contentDigest = '1'.repeat(64);
    },
    (v) => {
      v.evaluations[0].checkpoint.durationSeconds = 10800;
    },
  ]) {
    const changed = globalThis.structuredClone(fixture);
    change(changed);
    const bad = check(changed);
    assert.throws(() => parseWeek1CheckpointSnapshot(bad.bytes, bad.binding, bad.sources));
  }
});
test('a different cookie cannot masquerade as a distinct provider session', async () => {
  const f = checkpointHttpFake();
  f.port.secondSession.sessionId = f.port.learners[0].sessionId;
  await assert.rejects(verifyWeek1CheckpointHttp(f.port), /CHECKPOINT_HTTP_SCOPE/);
  assert.equal(f.events.length, 0);
});

test('required scope-bound rehearsal mode and host guard policy cannot be absent or silently changed', () => {
  for (const patch of [
    { rehearsalChecks: undefined },
    { rehearsalChecks: 'checkpoint-only' },
    { hostGuardExecutionPolicy: undefined },
    { hostGuardExecutionPolicy: 'Bypass' },
  ])
    assert.throws(() => prepareWeek1AuthBroker(resign({ ...spec(), ...patch })));
  const original = spec(),
    changed = { ...original, rehearsalChecks: 'auth-invitation-only' };
  assert.throws(() => prepareWeek1AuthBroker(changed), /SCOPE_CONTENT/);
  assert.equal(prepareWeek1AuthBroker(resign(changed)).rehearsalChecks, 'auth-invitation-only');
});
test('Auth-only mode invokes zero Checkpoint seed/start/save/revoke/assertion operations and no second test session', async () => {
  const authOnly = resign({ ...spec(), rehearsalChecks: 'auth-invitation-only' }),
    events = [];
  prepareWeek1AuthBroker(authOnly);
  const forbidden = async () => {
    events.push('checkpoint');
    throw Error('Checkpoint must not run in auth-only mode');
  };
  assert.equal(await runWeek1SelectedCheckpoint(authOnly, forbidden), null);
  assert.equal(await runWeek1SelectedCheckpoint(authOnly, forbidden), null);
  assert.deepEqual(
    [0, 1].map((index) => week1LearnerSessionCount(authOnly, index)),
    [1, 1],
  );
  const f = checkpointHttpFake();
  f.port.rehearsalChecks = 'auth-invitation-only';
  await assert.rejects(verifyWeek1CheckpointHttp(f.port), /CHECKPOINT_HTTP_SCOPE/);
  await assert.rejects(
    seedWeek1CheckpointDraftPolicy(
      { options: { prepare: false } },
      {
        versionId: id(7),
        definitionDigest: '9'.repeat(64),
        rehearsalChecks: 'auth-invitation-only',
      },
      () => {},
      forbidden,
    ),
    /CHECKPOINT_POLICY_SCOPE/,
  );
  assert.deepEqual(events, []);
  assert.equal(f.events.length, 0);
});
test('combined mode keeps the full Checkpoint HTTP coverage and two distinct learner-A sessions', async () => {
  const combined = spec(),
    f = checkpointHttpFake();
  let calls = 0;
  const result = await runWeek1SelectedCheckpoint(combined, async () => {
    calls++;
    return verifyWeek1CheckpointHttp(f.port);
  });
  assert.equal(calls, 1);
  assert.ok(result.checks.includes('two_session_cas_conflict'));
  assert.deepEqual(
    [0, 1].map((index) => week1LearnerSessionCount(combined, index)),
    [2, 1],
  );
  await assert.rejects(
    runWeek1SelectedCheckpoint({ rehearsalChecks: 'unknown' }, async () => calls++),
    /REHEARSAL_CHECKS/,
  );
  assert.equal(calls, 1);
});

test('future invitation flow inspects exact identity, activates once, then rejects distinct-operation replay without creating another account', async () => {
  const f = authFake();
  await f.port.activateLearner({ ...WEEK1_LEARNERS[0], password: 'fake-password' });
  const sent = f.events.filter((e) => e.url);
  assert.deepEqual(
    sent.map((e) => new URL(e.url).pathname),
    [
      '/api/invitations/issue',
      '/api/invitations/inspect',
      '/api/invitations/activate',
      '/api/invitations/inspect',
      '/api/invitations/activate',
    ],
  );
  assert.deepEqual(sent[1].input, { token: 'a'.repeat(43) });
  assert.deepEqual(sent[3].input, { token: 'a'.repeat(43) });
  assert.notEqual(sent[2].input.requestId, sent[4].input.requestId);
  assert.ok(sent.every((e) => !new URL(e.url).search));
  assert.equal(f.users.length, 1);
  assert.equal(f.creates(), 0);
  assert.ok(
    f.events.some((e) => e.kind === 'invitation_replay_check' && e.state === 'rejected_used'),
  );
  const operation = f.sessions.find((e) => e.kind === 'activation_operation');
  assert.equal(operation.token, undefined);
  assert.equal(
    operation.tokenSha256,
    crypto.createHash('sha256').update('a'.repeat(43)).digest('hex'),
  );
  assert.ok(
    f.events
      .filter((e) => e.kind)
      .every(
        (e) =>
          !Object.hasOwn(e, 'token') && !Object.hasOwn(e, 'password') && !Object.hasOwn(e, 'link'),
      ),
  );
});
test('an inspection identity mismatch cannot reach activation, while successful used-token replay is a failed rehearsal', async () => {
  let f = authFake({ badInspect: true });
  await assert.rejects(
    f.port.activateLearner({ ...WEEK1_LEARNERS[0], password: 'fake-password' }),
    /INVITATION_INSPECTION_BINDING/,
  );
  assert.equal(f.users.length, 0);
  assert.ok(!f.events.some((e) => e.url?.endsWith('/activate')));
  f = authFake({ badReplay: true });
  await assert.rejects(
    f.port.activateLearner({ ...WEEK1_LEARNERS[0], password: 'fake-password' }),
    /INVITATION_REPLAY_DENIAL/,
  );
  assert.equal(f.users.length, 1);
  assert.equal(f.creates(), 0);
});

test('registration driver is explicit and browser mode adds one bounded wait before assertions', () => {
  for (const driver of [undefined, 'browser', 'auto']) {
    assert.throws(
      () => prepareWeek1AuthBroker(resign({ ...spec(), registrationDriver: driver })),
      /REGISTRATION_DRIVER/,
    );
  }
  const s = resign({ ...spec(), registrationDriver: 'operator-browser-learner-b' });
  prepareWeek1AuthBroker(s);
  assert.equal(week1RegistrationDriver(s), 'operator-browser-learner-b');
  assert.deepEqual(week1AuthPhases(s, true).slice(-3), [
    'invitations',
    'await_browser',
    'assert_http',
  ]);
  assert.ok(!week1AuthPhases(spec()).includes('await_browser'));
});
test('generic phase never admits secret handoff and unknown phase is rejected before any filesystem or provider access', async () => {
  await assert.rejects(
    executePhase('operator_handoff', 'not-a-runtime', 'not-a-repo'),
    /OPERATOR_PIPE_ONLY/,
  );
  await assert.rejects(executePhase('unknown', 'not-a-runtime', 'not-a-repo'), /PHASE_ALLOWLIST/);
});

function browserIssueFake({
  ambiguous = false,
  ackFailure = false,
  mismatch = false,
  emitFailure = false,
} = {}) {
  const durable = new Map(),
    events = [],
    transient = [];
  let serial = 900;
  const person = { ...WEEK1_LEARNERS[1], password: 'fake-never-real-browser-password' };
  const config = { cohortId: id(2), cleanupAt: 1500000, now: () => 1000000, policy: spec().policy };
  const port = createWeek1AuthHttpPort({
    config,
    admin: {},
    ordinary: () => {
      throw Error('no HTTP sign in');
    },
    issuerCookie: async () => 'fake-cookie',
    uuid: () => id(++serial),
    checkTime: () => {},
    journal: async (e) => events.push(e),
    savePrivate: async () => {
      throw Error('unexpected secret retention');
    },
    fetch: async (url, input) => {
      assert.ok(durable.has('intent'));
      events.push(url);
      if (url.endsWith('/issue')) {
        assert.equal(JSON.parse(input.body).requestId, durable.get('intent').issueRequestId);
        if (ambiguous) throw Error('fake lost issuance acknowledgement');
        return globalThis.Response.json(
          {
            status: 'issued',
            expiresAt: 1060000,
            link: WEEK1_TARGET.origin + '/signup#invitation=' + 'z'.repeat(43),
          },
          { status: 201 },
        );
      }
      assert.ok(durable.has('ack'));
      assert.ok(url.endsWith('/inspect'), 'operator port must never activate');
      return globalThis.Response.json({
        status: 'valid',
        email: mismatch ? 'wrong@example.invalid' : person.email,
        displayName: person.displayName,
      });
    },
  });
  const callbacks = {
    intent: async (r) => {
      assert.ok(!durable.has('intent'));
      durable.set('intent', r);
      events.push('intent');
    },
    acknowledge: async (r) => {
      if (ackFailure) throw Error('fake durable ack failed');
      durable.set('ack', r);
      events.push('ack');
    },
    emit: async (r) => {
      assert.ok(durable.has('ack'));
      if (emitFailure) throw Error('fake broken pipe');
      transient.push(r);
      events.push('emit');
    },
  };
  const scope = { ...spec(), registrationDriver: 'operator-browser-learner-b' };
  return { port, person, callbacks, scope, durable, events, transient };
}
test('browser issuance seals intent then acknowledges real token digest before emitting, with no activation or stored capability', async () => {
  const f = browserIssueFake();
  const ack = await f.port.issueOperatorLearner(f.person, f.scope, f.callbacks);
  assert.deepEqual(
    f.events.map((e) => (typeof e === 'string' && e.startsWith('http') ? new URL(e).pathname : e)),
    ['intent', '/api/invitations/issue', 'ack', '/api/invitations/inspect', 'emit'],
  );
  assert.equal(ack.tokenSha256, crypto.createHash('sha256').update('z'.repeat(43)).digest('hex'));
  assert.equal(f.transient[0].password, f.person.password);
  assert.match(f.transient[0].url, /#invitation=/);
  for (const receipt of f.durable.values())
    for (const key of ['token', 'password', 'url', 'link']) assert.equal(receipt[key], undefined);
  await assert.rejects(f.port.issueOperatorLearner(f.person, f.scope, f.callbacks));
  assert.equal(f.events.filter((e) => String(e).endsWith('/issue')).length, 1);
});
for (const failure of ['ambiguous', 'ackFailure', 'mismatch', 'emitFailure']) {
  test(
    'browser issue failure seals capability and never retries or emits: ' + failure,
    async () => {
      const f = browserIssueFake({ [failure]: true });
      await assert.rejects(f.port.issueOperatorLearner(f.person, f.scope, f.callbacks));
      assert.ok(f.durable.has('intent'));
      assert.equal(f.transient.length, 0);
      await assert.rejects(f.port.issueOperatorLearner(f.person, f.scope, f.callbacks));
      assert.equal(f.events.filter((e) => String(e).endsWith('/issue')).length, 1);
    },
  );
}
test('operator issuance rejects learner A and HTTP-only mode before an issuance intent', async () => {
  const f = browserIssueFake();
  await assert.rejects(
    f.port.issueOperatorLearner({ ...f.person, ...WEEK1_LEARNERS[0] }, f.scope, f.callbacks),
    /OPERATOR_LEARNER_SCOPE/,
  );
  await assert.rejects(
    f.port.issueOperatorLearner(
      f.person,
      { ...f.scope, registrationDriver: 'http-only' },
      f.callbacks,
    ),
    /OPERATOR_SCOPE/,
  );
  assert.equal(f.events.length, 0);
});
function proofFixture() {
  const ack = {
    version: 1,
    scopeSha256: 'a'.repeat(64),
    sourceLockSha256: 'b'.repeat(64),
    nonce: id(4),
    issueRequestId: id(5),
    tokenSha256: 'c'.repeat(64),
    origin: WEEK1_TARGET.origin,
    email: WEEK1_LEARNERS[1].email,
    cohortId: id(2),
    displayName: WEEK1_LEARNERS[1].displayName,
    issuedAt: 1000000,
    expiresAt: 1060000,
  };
  const identity = Object.fromEntries(
    Object.entries(ack).filter(([key]) => !['displayName', 'issuedAt', 'expiresAt'].includes(key)),
  );
  const proof = {
    ...identity,
    browser: 'chrome',
    observedAt: 1000001,
    checks: {
      fragmentRemoved: true,
      inviteEmailFixed: true,
      activationSucceeded: true,
      ordinaryLoginSucceeded: true,
    },
  };
  return { ack, proof };
}
test('browser proof rejects secret-bearing/stale/foreign identity and incomplete UI assertions', () => {
  const { ack, proof } = proofFixture();
  assert.equal(validateWeek1BrowserProof(proof, ack, 1000002), true);
  for (const changed of [
    { ...proof, url: 'forbidden' },
    { ...proof, nonce: id(99) },
    { ...proof, email: WEEK1_LEARNERS[0].email },
    { ...proof, origin: 'http://localhost:3151' },
    { ...proof, observedAt: 999999 },
    { ...proof, observedAt: 1000003 },
    { ...proof, checks: { ...proof.checks, ordinaryLoginSucceeded: false } },
  ])
    assert.throws(() => validateWeek1BrowserProof(changed, ack, 1000002), /BROWSER_PROOF/);
  assert.throws(() => validateWeek1BrowserProof(proof, ack, 1060000), /BROWSER_PROOF_TIME/);
});
test('browser proof alone cannot complete: native identity must exist and remain exact through ordinary signin', async () => {
  const { ack, proof } = proofFixture();
  let clock = 1000002,
    probes = 0,
    signs = 0;
  const facts = { authId: id(10), userId: id(11) };
  const result = await awaitWeek1BrowserRegistration({
    acknowledgement: ack,
    readProof: async () => proof,
    readFacts: async () => (++probes === 1 ? null : facts),
    signIn: async (f) => {
      assert.deepEqual(f, facts);
      signs++;
    },
    checkTime: () => {},
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  assert.deepEqual(result, facts);
  assert.equal(signs, 1);
  assert.equal(probes, 3);
  await assert.rejects(
    awaitWeek1BrowserRegistration({
      acknowledgement: ack,
      readProof: async () => proof,
      readFacts: async () => (++probes === 4 ? facts : { ...facts, authId: id(12) }),
      signIn: async () => {},
      checkTime: () => {},
      now: () => clock,
      sleep: async () => {},
    }),
    /BROWSER_NATIVE_FACTS_CHANGED/,
  );
});
test('absent browser proof and lost original lease cannot fall back to HTTP activation or extend wait', async () => {
  const { ack } = proofFixture();
  let clock = 1000002,
    signs = 0;
  await assert.rejects(
    awaitWeek1BrowserRegistration({
      acknowledgement: ack,
      deadline: clock + 500,
      readProof: async () => null,
      readFacts: async () => {
        throw Error('no proof');
      },
      signIn: async () => signs++,
      checkTime: () => {},
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    }),
    /BROWSER_WAIT_EXPIRED/,
  );
  assert.equal(signs, 0);
  await assert.rejects(
    awaitWeek1BrowserRegistration({
      acknowledgement: ack,
      readProof: async () => {
        throw Error('must not read');
      },
      readFacts: async () => null,
      signIn: async () => signs++,
      checkTime: () => {
        throw Error('original lease lost');
      },
      now: () => clock,
      sleep: async () => {},
    }),
    /original lease lost/,
  );
});

test('native browser reader binds digest, issuance request, issuer, cohort and exact active learner receipt without adopting by email', async () => {
  const { ack } = proofFixture();
  const result = { authId: id(10), userId: id(11) };
  let calls = 0;
  const scope = { acknowledgement: ack, issuerId: id(12), curriculumVersionId: id(13) };
  const client = {
    unsafe: async (query, values) => {
      calls++;
      assert.deepEqual(values, [
        ack.issueRequestId,
        ack.tokenSha256,
        id(12),
        ack.cohortId,
        id(13),
        ack.email,
        ack.displayName,
        ack.expiresAt,
      ]);
      for (const authority of [
        'app.invitation_acceptances',
        'app.invitation_activations',
        'app.invitation_enrollment_receipts',
        'auth.users',
        'app.users',
        'app.cohort_memberships',
        "u.role='learner'",
        "m.status='active'",
        "i.phase='complete'",
        'i.revoked_at IS NULL',
      ])
        assert.ok(query.includes(authority), authority);
      assert.ok(!query.includes(ack.email));
      return [result];
    },
  };
  assert.deepEqual(await readWeek1BrowserFacts(client, scope, () => {}), result);
  assert.equal(calls, 1);
  await assert.rejects(
    readWeek1BrowserFacts(
      client,
      { ...scope, acknowledgement: { ...ack, email: WEEK1_LEARNERS[0].email } },
      () => {},
    ),
    /BROWSER_NATIVE_SCOPE/,
  );
  assert.equal(calls, 1);
  assert.equal(await readWeek1BrowserFacts({ unsafe: async () => [] }, scope, () => {}), null);
  await assert.rejects(
    readWeek1BrowserFacts({ unsafe: async () => [result, result] }, scope, () => {}),
    /BROWSER_NATIVE_DUPLICATE/,
  );
  await assert.rejects(
    readWeek1BrowserFacts(
      { unsafe: async () => [{ ...result, authId: 'unproven' }] },
      scope,
      () => {},
    ),
    /BROWSER_NATIVE_IDENTITY/,
  );
});

test('pending managed-Auth creation prevents a successful cleanup receipt even when current inventory and session counts are zero', async () => {
  const result = await cleanupWeek1AuthAccess({
    journal: async () => {},
    revokeProviderInventory: async () => ({ users: [], failures: [] }),
    readOwnedAuthRows: async () => [],
    banOwnedId: async () => {},
    disableApplication: async () => {},
    disableSqlLogins: async () => {},
    verifyAccess: async () => ({
      sessions: 0,
      refresh_tokens: 0,
      unbanned_users: 0,
      pending_auth_operations: 1,
      active_users: 0,
      active_memberships: 0,
      logins: 0,
      login_memberships: 0,
    }),
  });
  assert.equal(result.providerRevoked, false);
  assert.equal(result.appDisabled, true);
  assert.equal(result.sqlDisabled, true);
  assert.equal(result.nativeCounts.pending_auth_operations, 1);
});

test('an already-sent bootstrap issuer creation also stays unverified until its exact durable acknowledgement exists', () => {
  const scope = { scopeSha256: 'a'.repeat(64), email: 'synthetic-issuer@example.invalid' };
  assert.equal(week1PendingAuthCreations(0, { ...scope, intent: null, acknowledgement: null }), 0);
  assert.equal(week1PendingAuthCreations(0, { ...scope, intent: scope, acknowledgement: null }), 1);
  assert.equal(week1PendingAuthCreations(1, { ...scope, intent: scope, acknowledgement: null }), 2);
  assert.equal(
    week1PendingAuthCreations(0, {
      ...scope,
      intent: scope,
      acknowledgement: { ...scope, authId: id(88) },
    }),
    0,
  );
  assert.throws(
    () =>
      week1PendingAuthCreations(0, {
        ...scope,
        intent: null,
        acknowledgement: { ...scope, authId: id(88) },
      }),
    /ISSUER_CREATE_INTENT_MISSING/,
  );
  assert.throws(
    () =>
      week1PendingAuthCreations(0, {
        ...scope,
        intent: scope,
        acknowledgement: { ...scope, scopeSha256: 'b'.repeat(64), authId: id(88) },
      }),
    /ISSUER_CREATE_ACK/,
  );
});
