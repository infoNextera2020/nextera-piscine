import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSourceLock,
  brokerSourceRoot,
  writePrivateText,
  buildPublicEnvironment,
  DB_JWT_INIT_SQL,
  buildPublicCompose,
  copyVerifiedPublicTemplates,
  requiredInitEnvironment,
  validateInitEnvironment,
  validatePublicTemplateModes,
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
function imageMap() {
  return Object.fromEntries(
    Object.entries(config().services).map(([name, service]) => [name, service.image]),
  );
}
test('effective scoped configuration is accepted without executing a process', () =>
  assert.equal(validateConfig(config(), undefined, imageMap()), true));
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
    assert.throws(() => validateConfig(c, undefined, imageMap()));
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
    for (const name of ['attempt004', '../attempt001', '/tmp/run', ''])
      assert.throws(() => isolated.profileFor(name));
    assert.throws(() => isolated.validateConfig(config(), undefined, imageMap()));
    const current = config();
    current.name = profile.project;
    for (const [name, service] of Object.entries(current.services)) {
      service.container_name = profile.project + '-' + name;
      service.environment.connection = 'postgres://internal@db:5432/' + profile.database;
      service.volumes = [{ type: 'bind', source: profile.directory + '/stack/volumes/' + name }];
    }
    current.volumes.data.name = profile.project + '-data';
    current.networks.default.name = profile.project + '_default';
    assert.equal(isolated.validateConfig(current, undefined, imageMap()), true);
    current.services.db.volumes[0].source =
      isolated.profileFor('attempt001').directory + '/stack/volumes/db';
    assert.throws(() => isolated.validateConfig(current, undefined, imageMap()), /MOUNT_SCOPE/);
  } finally {
    if (before === undefined) delete process.env.CHECKPOINT_REHEARSAL_PROFILE;
    else process.env.CHECKPOINT_REHEARSAL_PROFILE = before;
  }
});

test('attempt003 source profile accepts only its identities and rejects both closed mounts', async () => {
  const before = process.env.CHECKPOINT_REHEARSAL_PROFILE;
  try {
    process.env.CHECKPOINT_REHEARSAL_PROFILE = 'attempt003';
    const isolated = await import('../checkpoint-auth-runtime.mjs?test-attempt003');
    const profile = isolated.profileFor('attempt003');
    assert.deepEqual(profile, {
      project: '01coding-checkpoint-browser-20261029-attempt003',
      directory:
        '/home/anas/.local/share/nextera-judge/checkpoint-browser-20261029-attempt003/run-001',
      database: 'foundation_test_checkpoint_browser_20261029_attempt003',
      learners: [
        'checkpoint-a-20261029-attempt003@example.invalid',
        'checkpoint-b-20261029-attempt003@example.invalid',
      ],
      login_role: 'checkpoint_browser_web_20261029_attempt003',
    });
    assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.learners));
    const current = config();
    current.name = profile.project;
    for (const [name, service] of Object.entries(current.services)) {
      service.container_name = profile.project + '-' + name;
      service.environment.connection = 'postgres://internal@db:5432/' + profile.database;
      service.volumes = [{ type: 'bind', source: profile.directory + '/stack/volumes/' + name }];
    }
    current.volumes.data.name = profile.project + '-data';
    current.networks.default.name = profile.project + '_default';
    assert.equal(isolated.validateConfig(current, undefined, imageMap()), true);
    for (const closed of ['attempt001', 'attempt002']) {
      const previous = isolated.profileFor(closed);
      for (const name of ['project', 'directory', 'database', 'login_role', 'learners'])
        assert.notDeepEqual(profile[name], previous[name]);
      current.services.db.volumes[0].source = previous.directory + '/stack/volumes/db';
      assert.throws(() => isolated.validateConfig(current, undefined, imageMap()), /MOUNT_SCOPE/);
    }
    for (const name of ['attempt004', '../attempt003', '/tmp/run', ''])
      assert.throws(() => isolated.profileFor(name), /UNKNOWN_REHEARSAL_PROFILE/);
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

test('requires exact pinned image map, not merely digest-shaped image names', () => {
  assert.throws(() => validateConfig(config()), /PINNED_IMAGE_MAP/);
  const c = config();
  c.services.auth.image = 'other/vendor@sha256:' + 'b'.repeat(64);
  assert.throws(() => validateConfig(c, undefined, imageMap()), /UNPINNED_IMAGE/);
});
test('pure public Compose renderer retains isolation and explicit inherited DB defaults', () => {
  const original = config(),
    before = structuredClone(original),
    c = buildPublicCompose(original, imageMap());
  assert.deepEqual(original, before);
  assert.equal(c.services.db.environment.POSTGRES_USER, 'supabase_admin');
  assert.equal(c.services.db.environment.JWT_SECRET, '${JWT_SECRET}');
  assert.deepEqual(c.services.db.ports, ['127.0.0.1:56532:5432']);
  assert.deepEqual(c.services['api-gw'].ports, ['127.0.0.1:56531:8000']);
  for (const [name, service] of Object.entries(c.services)) {
    assert.equal(service.image, imageMap()[name]);
    assert.equal(service.restart, 'no');
  }
  const missing = imageMap();
  delete missing.auth;
  assert.throws(() => buildPublicCompose(original, missing), /PINNED_IMAGE_MAP/);
});
test('every generated init substitution is configured and missing JWT_SECRET fails preflight', () => {
  assert.deepEqual(requiredInitEnvironment([DB_JWT_INIT_SQL]), [
    'JWT_EXP',
    'JWT_SECRET',
    'POSTGRES_DB',
  ]);
  const slash = String.fromCharCode(92);
  const other = [
    slash + 'set pgpass `echo "$POSTGRES_PASSWORD"`',
    slash + 'set pguser `echo "$POSTGRES_USER"`',
  ].join(String.fromCharCode(10));
  assert.deepEqual(requiredInitEnvironment([other]), ['POSTGRES_PASSWORD', 'POSTGRES_USER']);
  const env = databaseBootstrapEnvironment({ POSTGRES_PASSWORD: '${POSTGRES_PASSWORD}' });
  assert.equal(validateInitEnvironment([DB_JWT_INIT_SQL, other], env), true);
  delete env.JWT_SECRET;
  assert.throws(
    () => validateInitEnvironment([DB_JWT_INIT_SQL], env),
    /MISSING_INIT_ENVIRONMENT_JWT_SECRET/,
  );
});
test('original public permission failures are rejected before credentials or startup', () => {
  for (const item of [
    { name: 'volumes/db/init.sql', kind: 'file', mode: 0o600, symlink: false },
    { name: 'volumes/api/entry.sh', kind: 'file', mode: 0o644, symlink: false },
    { name: 'volumes/db', kind: 'directory', mode: 0o700, symlink: false },
    { name: 'volumes/db/init.sql', kind: 'file', mode: 0o644, symlink: true },
  ])
    assert.throws(() => validatePublicTemplateModes([item]));
});
test('actual verified public copy remains readable under private umask with private root', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), '01coding-public-'));
  const source = path.join(base, 'source'),
    destination = path.join(base, 'destination');
  fs.mkdirSync(source, { mode: 0o700 });
  fs.mkdirSync(destination, { mode: 0o700 });
  const contents = {
    '.env.example': 'DUMMY_NOT_FOR_START=1\n',
    'volumes/db/init.sql': 'SELECT 1;\n',
    'volumes/api/entry.sh': '#!/bin/sh\ntrue\n',
  };
  const hashes = {};
  try {
    for (const [name, text] of Object.entries(contents)) {
      const target = path.join(source, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
      hashes[name] = crypto.createHash('sha256').update(text).digest('hex');
    }
    const previous = process.umask(0o077);
    let records;
    try {
      records = copyVerifiedPublicTemplates(source, destination, hashes);
    } finally {
      process.umask(previous);
    }
    assert.equal(validatePublicTemplateModes(records), true);
    const configPath = path.join(destination, '.env.example');
    writePrivateText(configPath, 'DUMMY_PRIVATE_CONFIG=1');
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(destination).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(destination, 'volumes/db')).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(destination, 'volumes/db/init.sql')).mode & 0o777, 0o644);
    assert.equal(fs.statSync(path.join(destination, 'volumes/api/entry.sh')).mode & 0o777, 0o755);
  } finally {
    assert.ok(
      path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep + '01coding-public-'),
    );
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('public environment preparation replaces all key material with placeholders without generating credentials', () => {
  const env = buildPublicEnvironment({
    POSTGRES_PASSWORD: 'NEVER',
    JWT_SECRET: 'NEVER',
    ANON_KEY: 'NEVER',
    SERVICE_ROLE_KEY: 'NEVER',
    SMTP_PASS: 'NEVER',
  });
  assert.ok(!JSON.stringify(env).includes('NEVER'));
  for (const name of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY'])
    assert.equal(env[name], 'REHEARSAL_CONFIG_PLACEHOLDER_NOT_FOR_START');
  assert.equal(env.JWT_EXPIRY, '300');
  assert.equal(env.SMTP_PASS, '');
});

test('post-stage broker reads only private source snapshot, not mutable checkout', () => {
  const stat = {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: process.getuid(),
    mode: 0o40700,
  };
  const io = {
    lstatSync: (target) => {
      assert.equal(target, '/approved/app-source');
      return stat;
    },
  };
  assert.equal(
    brokerSourceRoot('stage', '/approved', '/checkout', {
      lstatSync: () => {
        throw new Error('stage must not require later snapshot');
      },
    }),
    '/checkout',
  );
  for (const mode of [
    'apply_scoped_sql',
    'issue_restricted_access',
    'assert_http',
    'disable',
    'disable_sql_access',
    'app_environment',
  ])
    assert.equal(brokerSourceRoot(mode, '/approved', '/checkout', io), '/approved/app-source');
  for (const bad of [
    { ...stat, mode: 0o40755 },
    { ...stat, uid: stat.uid + 1 },
    { ...stat, isSymbolicLink: () => true },
    { ...stat, isDirectory: () => false },
  ])
    assert.throws(
      () => brokerSourceRoot('assert_http', '/approved', '/checkout', { lstatSync: () => bad }),
      /IMMUTABLE_APP_SOURCE/,
    );
  const code = fs.readFileSync(new URL('../checkpoint-auth-runtime.mjs', import.meta.url), 'utf8');
  assert.ok(!code.includes("req(repo + '/packages/"));
  assert.ok(code.includes('lock.sql[path.relative(sourceRepo, file)]'));
});

test('runtime lock requires the adjacent immutable copy, with no repository fallback', () => {
  const bytes = Buffer.from(JSON.stringify({ sql: { exact: 'digest' } }));
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const io = {
    readFileSync: (target) => {
      assert.ok(target.endsWith('/scripts/checkpoint-auth-source-lock.json'));
      return bytes;
    },
  };
  assert.deepEqual(readSourceLock(digest, io), { sql: { exact: 'digest' } });
  assert.throws(() => readSourceLock('0'.repeat(64), io), /IMMUTABLE_SOURCE_LOCK/);
  assert.throws(
    () =>
      readSourceLock(digest, {
        readFileSync: () => {
          throw new Error('missing private lock');
        },
      }),
    /missing private lock/,
  );
});
