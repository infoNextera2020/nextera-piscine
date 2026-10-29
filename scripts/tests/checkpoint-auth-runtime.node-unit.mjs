import process from 'node:process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  databaseBootstrapEnvironment,
  validateConfig,
  publicTemplateMode,
  validateOwnedEndpoints,
  browserReceipt,
  appEnvironment,
  verifyDraftFlow,
} from '../checkpoint-auth-runtime.mjs';
const { Response, structuredClone } = globalThis;
const PROJECT = '01coding-checkpoint-browser-20261028';
function config() {
  const names = ['db', 'auth', 'rest', 'storage', 'imgproxy', 'meta', 'studio', 'api-gw'];
  return {
    name: PROJECT,
    services: Object.fromEntries(
      names.map((name) => [
        name,
        {
          container_name: PROJECT + '-' + name,
          restart: 'no',
          image: 'example/image@sha256:' + 'a'.repeat(64),
          environment: {
            connection: 'postgres://internal@db:5432/foundation_test_checkpoint_browser_20261028',
          },
          ports:
            name === 'db'
              ? [{ host_ip: '127.0.0.1', published: '56532' }]
              : name === 'api-gw'
                ? [{ host_ip: '127.0.0.1', published: '56531' }]
                : [],
        },
      ]),
    ),
    volumes: { data: { name: PROJECT + '-data' } },
    networks: { default: { name: PROJECT + '_default' } },
  };
}
test('effective scoped configuration is accepted without executing a process', () =>
  assert.equal(validateConfig(config()), true));
for (const [name, mutate] of [
  ['public port', (c) => (c.services.db.ports[0].host_ip = '0.0.0.0')],
  ['extra service', (c) => (c.services.runner = c.services.db)],
  ['extra port', (c) => (c.services.meta.ports = [{ published: 9999 }])],
  [
    'retained bind',
    (c) => (c.services.db.volumes = [{ type: 'bind', source: '/home/anas/retained/data' }]),
  ],
  ['external volume', (c) => (c.volumes.data.external = true)],
  ['external network', (c) => (c.networks.default.external = true)],
  ['unresolved image', (c) => (c.services.auth.image = 'supabase/gotrue:latest')],
  [
    'split database',
    (c) => (c.services.storage.environment.connection = 'postgres://other/retained'),
  ],
  ['privileged service', (c) => (c.services.db.privileged = true)],
])
  test('rejects ' + name, () => {
    const c = config();
    mutate(c);
    assert.throws(() => validateConfig(c));
  });
test('browser receipt cannot reuse fixture acceptance or another run', () => {
  const session = { scope_sha256: 'scope', started: 1000, deadline: 4600 };
  const receipt = {
    origin: 'http://127.0.0.1:3151',
    scope_sha256: 'scope',
    run_issued: 1000,
    observed_at: 1100,
    source: 'supported_browser_or_owner_manual',
    checks: Object.fromEntries(
      [
        'ordinary_learner_login',
        'draft_saved_indicator',
        'question_switch_preserves_source',
        'refresh_recovers_server_source',
        'explicit_conflict_preserves_losing_source',
      ].map((k) => [k, true]),
    ),
  };
  assert.equal(browserReceipt(receipt, session), true);
  for (const patch of [
    { origin: 'http://127.0.0.1:3118' },
    { run_issued: 999 },
    { observed_at: 4700 },
    { checks: {} },
    { source: 'mock' },
  ])
    assert.throws(() => browserReceipt({ ...receipt, ...patch }, session));
});
test('web environment excludes privileged keys and grading services', () => {
  const env = appEnvironment('/repo', {
    web_dsn: 'web',
    ANON_KEY: 'public',
    SERVICE_ROLE_KEY: 'NEVER',
    POSTGRES_PASSWORD: 'NEVER',
  });
  assert.equal(env.CHECKPOINT_DRAFT_STORAGE, 'postgres-v1');
  assert.ok(!JSON.stringify(env).includes('NEVER'));
  assert.equal(env.RESULT_APPLICATION_DATABASE_URL, undefined);
});
function fakeHttp() {
  let draft = null,
    revoked = false;
  const receipts = new Map();
  const json = (data, status = 200) =>
    Response.json(data, { status, headers: { 'cache-control': 'private, no-store' } });
  return {
    transport: 'mocked_unit',
    bootstrap: async (who) =>
      !who
        ? json({}, 401)
        : who === 'b' || revoked
          ? json({}, 403)
          : json({
              sourceBytes: 1024,
              offlineRecovery: null,
              window: { capabilities: { draftsV1: true } },
              draft,
            }),
    save: async (base, source, id = 'id-' + receipts.size, digest) => {
      if (revoked) return json({}, 403);
      if (digest === '0'.repeat(64)) return json({}, 412);
      if (source.length > 1024) return json({}, 413);
      if (receipts.has(id)) return json(receipts.get(id));
      if (base !== (draft?.version ?? 0)) return json({ current: draft }, 409);
      draft = { source, version: base + 1, requestId: id };
      receipts.set(id, draft);
      return json(draft);
    },
    revoke: async () => {
      revoked = true;
    },
    counts: async () => ({ jobs: '0', submissions: '0', outcomes: '0' }),
    receiptCount: async () => receipts.size,
  };
}
test('same genuine-flow assertion code covers mocked save/reload/CAS/retry/revocation without live claims', async () => {
  const result = await verifyDraftFlow(fakeHttp());
  assert.equal(result.mocked, true);
  assert.equal(result.naturalDeadlineTested, false);
  assert.equal(result.checks.length, 11);
});
test('does not turn a discarded conflict or unintended official record into a pass', async () => {
  const f = fakeHttp();
  f.counts = async () => ({ jobs: '1', submissions: '0', outcomes: '0' });
  await assert.rejects(verifyDraftFlow(f), /DRAFT_CHANGED_OFFICIAL_STATE/);
});
test('rejects incomplete durable evidence', async () => {
  const f = fakeHttp();
  f.receiptCount = async () => 99;
  await assert.rejects(verifyDraftFlow(f), /DUPLICATE_OR_REJECTED_WRITE_PERSISTED/);
});

test('privileged endpoint checks require recorded new container IDs and exact loopback bindings', () => {
  const ids = Array.from({ length: 8 }, (_, i) => 'new-' + i),
    base = '/home/anas/.local/share/nextera-judge/checkpoint-browser-20261028/run-001';
  const rows = ['db', 'api-gw'].map((name, i) => ({
    Id: ids[i],
    State: { Running: true },
    Config: {
      Labels: {
        'com.docker.compose.project': PROJECT,
        'com.docker.compose.service': name,
        'com.docker.compose.project.working_dir': base + '/stack',
      },
    },
    NetworkSettings: {
      Ports: {
        [name === 'db' ? '5432/tcp' : '8000/tcp']: [
          { HostIp: '127.0.0.1', HostPort: name === 'db' ? '56532' : '56531' },
        ],
      },
    },
  }));
  assert.equal(validateOwnedEndpoints(rows, ids, []), true);
  assert.throws(() => validateOwnedEndpoints(rows, ids, [ids[0]]));
  assert.throws(() => validateOwnedEndpoints(rows, ids.slice(1), []));
  const other = structuredClone(rows);
  other[0].NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0';
  assert.throws(() => validateOwnedEndpoints(other, ids, []));
  const reused = structuredClone(rows);
  reused[0].Id = 'unrecorded';
  assert.throws(() => validateOwnedEndpoints(reused, ids, []));
});

test('verified public init SQL is readable and entry scripts executable without classifying secret files as public', () => {
  assert.equal(publicTemplateMode('volumes/db/roles.sql', true), 0o644);
  assert.equal(publicTemplateMode('volumes/api/kong-entrypoint.sh', true), 0o755);
  for (const name of ['.env', 'credentials.json', '../.env', 'volumes/../.env'])
    assert.throws(() => publicTemplateMode(name, true));
  assert.throws(() => publicTemplateMode('volumes/db/roles.sql', false));
});

test('attempt002 validates only its own target and identities without executing adapters', async () => {
  const before = process.env.CHECKPOINT_REHEARSAL_PROFILE;
  try {
    process.env.CHECKPOINT_REHEARSAL_PROFILE = 'attempt002';
    const isolated = await import('../checkpoint-auth-runtime.mjs?test-attempt002');
    const profile = isolated.profileFor('attempt002');
    assert.equal(profile.project, '01coding-checkpoint-browser-20261029-attempt002');
    assert.equal(profile.database, 'foundation_test_checkpoint_browser_20261029_attempt002');
    assert.equal(profile.login_role, 'checkpoint_browser_web_20261029_attempt002');
    assert.equal(profile.learners.length, 2);
    assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.learners));
    for (const name of ['attempt003', '../attempt001', '/tmp/run', ''])
      assert.throws(() => isolated.profileFor(name));
    assert.throws(() => isolated.validateConfig(config()));
    const current = config();
    current.name = profile.project;
    for (const [name, service] of Object.entries(current.services)) {
      service.container_name = profile.project + '-' + name;
      service.environment.connection = 'postgres://internal@db:5432/' + profile.database;
      service.volumes = [{ type: 'bind', source: profile.directory + '/stack/volumes/' + name }];
    }
    current.volumes.data.name = profile.project + '-data';
    current.networks.default.name = profile.project + '_default';
    assert.equal(isolated.validateConfig(current), true);
    current.services.db.volumes[0].source =
      isolated.profileFor('attempt001').directory + '/stack/volumes/db';
    assert.throws(() => isolated.validateConfig(current), /MOUNT_SCOPE/);
  } finally {
    if (before === undefined) delete process.env.CHECKPOINT_REHEARSAL_PROFILE;
    else process.env.CHECKPOINT_REHEARSAL_PROFILE = before;
  }
});

test('public JWT init script receives all required instance-local environment placeholders', () => {
  const env = databaseBootstrapEnvironment({ PUBLIC_TEMPLATE_SETTING: 'unchanged' });
  assert.equal(env.POSTGRES_DB, 'foundation_test_checkpoint_browser_20261028');
  assert.equal(env.PGDATABASE, env.POSTGRES_DB);
  assert.equal(env.JWT_SECRET, '${JWT_SECRET}');
  assert.equal(env.JWT_EXP, '${JWT_EXPIRY}');
  assert.equal(env.PUBLIC_TEMPLATE_SETTING, 'unchanged');
});
