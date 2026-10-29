/* Opt-in source adapter; imports perform no runtime I/O. */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { fetch, AbortSignal } = globalThis;
import profileRegistry from './checkpoint-auth-profiles.json' with { type: 'json' };
const PROFILE = process.env.CHECKPOINT_REHEARSAL_PROFILE || 'attempt001';
function profileFor(profile) {
  const stems = { attempt001: '20261028', attempt002: '20261029-attempt002' };
  if (
    !Object.hasOwn(stems, profile) ||
    Object.keys(profileRegistry).sort().join() !== Object.keys(stems).sort().join()
  )
    throw new Error('UNKNOWN_REHEARSAL_PROFILE');
  const stem = stems[profile],
    token = stem.replaceAll('-', '_');
  const expected = {
    project: '01coding-checkpoint-browser-' + stem,
    directory: '/home/anas/.local/share/nextera-judge/checkpoint-browser-' + stem + '/run-001',
    database: 'foundation_test_checkpoint_browser_' + token,
    learners: [
      'checkpoint-a-' + stem + '@example.invalid',
      'checkpoint-b-' + stem + '@example.invalid',
    ],
    login_role: 'checkpoint_browser_web_' + token,
  };
  const row = profileRegistry[profile];
  if (
    Object.keys(row).sort().join() !== Object.keys(expected).sort().join() ||
    Object.entries(expected).some(
      ([key, value]) => JSON.stringify(row[key]) !== JSON.stringify(value),
    )
  )
    throw new Error('REHEARSAL_PROFILE_IDENTITY');
  return Object.freeze({ ...expected, learners: Object.freeze([...expected.learners]) });
}
const ACTIVE = profileFor(PROFILE);
const RUN = ACTIVE.directory;
const PROJECT = ACTIVE.project;
const DB = ACTIVE.database;
const SERVICES = ['db', 'auth', 'rest', 'storage', 'imgproxy', 'meta', 'studio', 'api-gw'];
const check = (ok, code) => {
  if (!ok) throw new Error(code);
};
function privateWrite(file, value) {
  const tmp = file + '.next';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}
function validateConfig(c, run = RUN) {
  check(
    c.name === PROJECT && Object.keys(c.services).sort().join() === [...SERVICES].sort().join(),
    'SERVICE_SCOPE',
  );
  for (const [name, s] of Object.entries(c.services)) {
    check(
      s.container_name === PROJECT + '-' + name &&
        s.restart === 'no' &&
        !s.privileged &&
        !s.network_mode,
      'SERVICE_ISOLATION',
    );
    const ports = s.ports || [];
    if (name === 'db' || name === 'api-gw') {
      check(
        ports.length === 1 &&
          ports[0].host_ip === '127.0.0.1' &&
          Number(ports[0].published) === (name === 'db' ? 56532 : 56531),
        'LOOPBACK_PORT',
      );
    } else check(ports.length === 0, 'EXTRA_PORT');
    check(/@sha256:[0-9a-f]{64}$/.test(s.image), 'UNPINNED_IMAGE');
    for (const v of s.volumes || [])
      if (v.type === 'bind')
        check(
          path.resolve(v.source).startsWith(run + '/') && !v.source.includes('docker.sock'),
          'MOUNT_SCOPE',
        );
  }
  for (const [name, v] of Object.entries(c.volumes || {}))
    check(!v.external && v.name === PROJECT + '-' + name, 'VOLUME_SCOPE');
  for (const n of Object.values(c.networks || {}))
    check(!n.external && (!n.name || n.name === PROJECT + '_default'), 'NETWORK_SCOPE');
  for (const name of ['auth', 'rest', 'storage'])
    check(
      JSON.stringify(c.services[name].environment).includes('/' + DB),
      'CO_RESIDENT_PRODUCT_AUTH_STORAGE',
    );
  return true;
}
function validateOwnedEndpoints(containers, ids, baseline, run = RUN) {
  check(
    Array.isArray(ids) && ids.length === 8 && new Set(ids).size === 8,
    'OWNED_CONTAINER_RECEIPT',
  );
  for (const name of ['db', 'api-gw']) {
    const found = containers.filter(
      (c) => c.Config?.Labels?.['com.docker.compose.service'] === name,
    );
    check(found.length === 1, 'OWNED_ENDPOINT_MISSING');
    const c = found[0],
      labels = c.Config.Labels;
    check(
      ids.includes(c.Id) &&
        !baseline.includes(c.Id) &&
        c.State.Running &&
        labels['com.docker.compose.project'] === PROJECT &&
        path.resolve(labels['com.docker.compose.project.working_dir']) === run + '/stack',
      'ENDPOINT_OWNERSHIP',
    );
    const port = c.NetworkSettings.Ports[name === 'db' ? '5432/tcp' : '8000/tcp'];
    check(
      port?.length === 1 &&
        port[0].HostIp === '127.0.0.1' &&
        port[0].HostPort === (name === 'db' ? '56532' : '56531'),
      'ENDPOINT_BINDING',
    );
  }
  return true;
}
function browserReceipt(receipt, session) {
  check(
    receipt &&
      receipt.origin === 'http://127.0.0.1:3151' &&
      receipt.scope_sha256 === session.scope_sha256 &&
      receipt.run_issued === session.started,
    'BROWSER_RECEIPT_SCOPE',
  );
  check(
    receipt.observed_at >= session.started &&
      receipt.observed_at < session.deadline &&
      receipt.source === 'supported_browser_or_owner_manual',
    'BROWSER_RECEIPT_TIME',
  );
  for (const name of [
    'ordinary_learner_login',
    'draft_saved_indicator',
    'question_switch_preserves_source',
    'refresh_recovers_server_source',
    'explicit_conflict_preserves_losing_source',
  ])
    check(receipt.checks?.[name] === true, 'BROWSER_ASSERTIONS_PENDING');
  return true;
}
function publicTemplateMode(name, verifiedPublicSource = false) {
  check(
    verifiedPublicSource === true &&
      /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(name) &&
      !name.split('/').some((p) => p === '.' || p === '..'),
    'UNVERIFIED_PUBLIC_TEMPLATE',
  );
  check(
    name === '.env.example' || name === 'docker-compose.yml' || name.startsWith('volumes/'),
    'PRIVATE_FILE_NOT_PUBLIC_TEMPLATE',
  );
  return name.endsWith('.sh') ? 0o755 : 0o644;
}
function appEnvironment(repo, credentials) {
  return {
    PATH:
      repo +
      '/.tools/node-v24.19.0-linux-x64/bin:/mnt/c/Users/lap/AppData/Roaming/npm:/usr/bin:/bin',
    HOME: process.env.HOME,
    LANG: 'C.UTF-8',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: credentials.web_dsn,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56531',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: credentials.ANON_KEY,
    CHECKPOINT_DRAFT_STORAGE: 'postgres-v1',
  };
}
async function verifyDraftFlow(io) {
  check((await io.bootstrap(null)).status === 401, 'UNAUTHENTICATED_DENIAL');
  check((await io.bootstrap('b')).status === 403, 'CROSS_LEARNER_DENIAL');
  const boot = await io.bootstrap('a');
  check(boot.status === 200 && /no-store/.test(boot.headers.get('cache-control')), 'BOOTSTRAP');
  const body = await boot.json();
  check(
    body.sourceBytes === 1024 && body.offlineRecovery === null && body.window.capabilities.draftsV1,
    'AUTHORITATIVE_CAPABILITIES',
  );
  const firstBase = body.draft?.version ?? 0,
    source = '\uFEFFpackage main\r\n// café\u0000\n',
    id = crypto.randomUUID();
  const saved = await io.save(firstBase, source, id);
  check(saved.status === 200, 'SAVE');
  const record = await saved.json();
  const repeat = await io.save(firstBase, source, id);
  check(repeat.status === 200, 'IDEMPOTENT_RETRY');
  const repeated = await repeat.json();
  check(
    repeated.version === record.version &&
      repeated.source === record.source &&
      repeated.requestId === record.requestId,
    'IDEMPOTENT_RECEIPT',
  );
  const reload = await (await io.bootstrap('a')).json();
  check(reload.draft.source === source && reload.draft.version === record.version, 'EXACT_RELOAD');
  const simultaneous = await Promise.all([
    io.save(record.version, 'device one'),
    io.save(record.version, 'device two'),
  ]);
  check(
    simultaneous
      .map((x) => x.status)
      .sort()
      .join() === '200,409',
    'CAS_CONFLICT',
  );
  check(
    (await io.save(record.version, 'x', crypto.randomUUID(), '0'.repeat(64))).status === 412,
    'STALE_DEFINITION',
  );
  check((await io.save(record.version, 'x'.repeat(1025))).status === 413, 'SOURCE_CEILING');
  await io.revoke();
  check((await io.bootstrap('a')).status === 403, 'ACCESS_REMOVAL_READ');
  check((await io.save(record.version, 'denied')).status === 403, 'ACCESS_REMOVAL_WRITE');
  const counts = await io.counts();
  check(
    Object.keys(counts).sort().join() === 'jobs,outcomes,submissions' &&
      Object.values(counts).every((x) => String(x) === '0'),
    'DRAFT_CHANGED_OFFICIAL_STATE',
  );
  check((await io.receiptCount()) === firstBase + 2, 'DUPLICATE_OR_REJECTED_WRITE_PERSISTED');
  return {
    checks: [
      'managed_auth',
      'ordinary_role',
      'bootstrap',
      'exact_save_reload',
      'idempotency',
      'cas_conflict',
      'cross_learner',
      'stale_definition',
      'size_limit',
      'access_revocation',
      'zero_official_records',
    ],
    counts,
    synthetic: true,
    mocked: io.transport !== 'managed_auth_http',
    naturalDeadlineTested: false,
  };
}
function state(run, cleanup = false) {
  check(
    run === RUN &&
      !fs.lstatSync(run).isSymbolicLink() &&
      (fs.statSync(run).mode & 0o777) === 0o700 &&
      fs.statSync(run).uid === process.getuid(),
    'PRIVATE_TARGET',
  );
  const s = JSON.parse(fs.readFileSync(run + '/control.json', 'utf8'));
  check(
    s.project === PROJECT &&
      s.database === DB &&
      s.uid === process.getuid() &&
      (s.profile || 'attempt001') === PROFILE,
    'CONTROL_SCOPE',
  );
  if (!cleanup)
    check(
      Date.now() / 1000 < s.deadline && fs.existsSync(run + '/guard-ready.json'),
      'GUARD_OR_WINDOW',
    );
  if (!cleanup) check(!fs.existsSync(run + '/revoking.json'), 'CLEANUP_STARTED');
  return s;
}
async function execute(mode, run, repo) {
  const s = state(run, mode === 'disable' || mode === 'disable_sql_access');
  const req = createRequire(repo + '/package.json');
  req('tsx/cjs');
  const secrets = () => JSON.parse(fs.readFileSync(run + '/credentials.json', 'utf8'));
  const save = (name, v) => privateWrite(run + '/' + name, v);
  if (mode === 'stage') {
    check(!fs.existsSync(run + '/credentials.json'), 'UNCERTAIN_SECRET_ISSUANCE');
    const lock = JSON.parse(
      fs.readFileSync(repo + '/infra/checkpoint-auth-rehearsal/source-lock.json', 'utf8'),
    );
    const template = s.template;
    fs.mkdirSync(run + '/stack', { recursive: true, mode: 0o700 });
    for (const [p, hash] of Object.entries(lock.files)) {
      const source = path.join(template, p);
      check(
        !fs.lstatSync(source).isSymbolicLink() &&
          crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex') === hash,
        'TEMPLATE_HASH',
      );
      const dest = run + '/stack/' + p;
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o755 });
      fs.copyFileSync(source, dest);
      fs.chmodSync(dest, publicTemplateMode(p, true));
    }
    const vals = req('dotenv').parse(fs.readFileSync(run + '/stack/.env.example'));
    Object.assign(vals, {
      POSTGRES_DB: DB,
      POSTGRES_HOST: 'db',
      POSTGRES_PORT: '5432',
      SUPABASE_PUBLIC_URL: 'http://127.0.0.1:56531',
      API_EXTERNAL_URL: 'http://127.0.0.1:56531/auth/v1',
      SITE_URL: 'http://127.0.0.1:3151',
      ADDITIONAL_REDIRECT_URLS: 'http://127.0.0.1:3151',
      DISABLE_SIGNUP: 'true',
      ENABLE_EMAIL_SIGNUP: 'true',
      ENABLE_EMAIL_AUTOCONFIRM: 'true',
      ENABLE_ANONYMOUS_USERS: 'false',
      ENABLE_PHONE_SIGNUP: 'false',
      JWT_EXPIRY: '300',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '9',
      SMTP_USER: '',
      SMTP_PASS: '',
      OPENAI_API_KEY: '',
      LOGFLARE_PUBLIC_ACCESS_TOKEN: '',
      LOGFLARE_PRIVATE_ACCESS_TOKEN: '',
      STUDIO_DEFAULT_ORGANIZATION: 'ISOLATED TEST',
      STUDIO_DEFAULT_PROJECT: 'SYNTHETIC CHECKPOINT',
    });
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
      vals[key] = 'REHEARSAL_CONFIG_PLACEHOLDER_NOT_FOR_START';
    fs.writeFileSync(
      run + '/stack/.env',
      Object.entries(vals)
        .map(([k, v]) => k + '=' + v + '\n')
        .join(''),
      { mode: 0o600, flag: 'wx' },
    );
    const yaml = req('yaml'),
      c = yaml.parse(fs.readFileSync(run + '/stack/docker-compose.yml', 'utf8'));
    c.name = PROJECT;
    c.services = Object.fromEntries(SERVICES.map((name) => [name, c.services[name]]));
    for (const [name, service] of Object.entries(c.services)) {
      service.image = lock.images[name];
      service.container_name = PROJECT + '-' + name;
      service.restart = 'no';
      delete service.profiles;
      service.ports =
        name === 'db'
          ? ['127.0.0.1:56532:5432']
          : name === 'api-gw'
            ? ['127.0.0.1:56531:8000']
            : [];
      if (service.depends_on)
        service.depends_on = Object.fromEntries(
          Object.entries(service.depends_on).filter(([k]) => SERVICES.includes(k)),
        );
      for (const [k, v] of Object.entries(service.environment || {}))
        if (typeof v === 'string')
          service.environment[k] = v.replace(/\/postgres(?=\?|$)/g, '/' + DB);
    }
    c.services.db.environment.POSTGRES_DB = DB;
    c.services.db.environment.PGDATABASE = DB;
    c.services.auth.environment.GOTRUE_DB_DATABASE_URL =
      'postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@db:5432/' + DB;
    c.services.auth.environment.GOTRUE_DISABLE_SIGNUP = 'true';
    c.services.auth.environment.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED = 'false';
    c.services.rest.environment.PGRST_DB_URI =
      'postgres://authenticator:${POSTGRES_PASSWORD}@db:5432/' + DB;
    c.services.storage.environment.DATABASE_URL =
      'postgres://supabase_storage_admin:${POSTGRES_PASSWORD}@db:5432/' + DB;
    c.services.meta.environment.PG_META_DB_NAME = DB;
    for (const [name, v] of Object.entries(c.volumes || {}))
      c.volumes[name] = { ...(v || {}), name: PROJECT + '-' + name };
    c.networks = { default: { name: PROJECT + '_default' } };
    fs.writeFileSync(
      run + '/stack/volumes/db/jwt.sql',
      String.raw`\getenv db POSTGRES_DB
\getenv secret JWT_SECRET
\getenv expiry JWT_EXP
SELECT format('ALTER DATABASE %I SET "app.settings.jwt_secret" TO %L', :'db', :'secret') \gexec
SELECT format('ALTER DATABASE %I SET "app.settings.jwt_exp" TO %L', :'db', :'expiry') \gexec
`,
      { mode: publicTemplateMode('volumes/db/jwt.sql', true) },
    );
    fs.writeFileSync(run + '/stack/docker-compose.yml', yaml.stringify(c), { mode: 0o600 });
    const rendered = JSON.parse(
      execFileSync(
        'docker',
        [
          'compose',
          '--project-name',
          PROJECT,
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
          cwd: run + '/stack',
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
    validateConfig(rendered, run);
    save('configuration-before-keys.json', { verified: true, credentialMaterialIssued: false });
    const guard = JSON.parse(fs.readFileSync(run + '/guard-process.json', 'utf8'));
    const guardProc = '/proc/' + guard.pid;
    check(
      fs.statSync(guardProc).uid === process.getuid() &&
        fs
          .readFileSync(guardProc + '/stat', 'utf8')
          .split(') ')
          .at(-1)
          .split(' ')[19] === guard.ticks &&
        !fs.existsSync(run + '/revoking.json') &&
        Date.now() / 1000 < s.deadline - 180,
      'GUARD_BEFORE_KEYS',
    );
    for (const key of [
      'POSTGRES_PASSWORD',
      'JWT_SECRET',
      'PG_META_CRYPTO_KEY',
      'DASHBOARD_PASSWORD',
      'S3_PROTOCOL_ACCESS_KEY_SECRET',
    ])
      vals[key] = crypto.randomBytes(32).toString('hex');
    vals.SECRET_KEY_BASE = crypto.randomBytes(48).toString('hex');
    vals.REALTIME_DB_ENC_KEY = crypto.randomBytes(8).toString('hex');
    vals.VAULT_ENC_KEY = crypto.randomBytes(16).toString('hex');
    vals.S3_PROTOCOL_ACCESS_KEY_ID = crypto.randomBytes(16).toString('hex');
    const jwt = (role) => {
      const b = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
      const u =
        b({ alg: 'HS256', typ: 'JWT' }) +
        '.' +
        b({ role, iss: 'supabase', iat: Math.floor(s.started), exp: Math.floor(s.deadline) });
      return u + '.' + crypto.createHmac('sha256', vals.JWT_SECRET).update(u).digest('base64url');
    };
    vals.ANON_KEY = jwt('anon');
    vals.SERVICE_ROLE_KEY = jwt('service_role');
    save('credentials.json', vals);
    fs.writeFileSync(
      run + '/stack/.env',
      Object.entries(vals)
        .map(([k, v]) => k + '=' + v + '\n')
        .join(''),
      { mode: 0o600, flag: 'w' },
    );
    return;
  }
  if (mode === 'validate_browser') {
    browserReceipt(JSON.parse(fs.readFileSync(run + '/browser-evidence.json', 'utf8')), s);
    return;
  }
  if (mode === 'app_environment') {
    process.stdout.write(JSON.stringify(appEnvironment(repo, secrets())));
    return;
  }
  const ids = JSON.parse(fs.readFileSync(run + '/containers.json', 'utf8'));
  const owned = JSON.parse(
    execFileSync('docker', ['inspect', ...ids], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DOCKER_CONFIG: run + '/docker-client',
      },
      timeout: 10000,
      encoding: 'utf8',
    }),
  );
  validateOwnedEndpoints(owned, ids, s.baseline_containers, run);
  const v = secrets(),
    postgres = req('postgres');
  const admin = postgres({
    host: '127.0.0.1',
    port: 56532,
    database: DB,
    username: 'supabase_admin',
    password: v.POSTGRES_PASSWORD,
    max: 2,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 8,
  });
  const auth = req('@supabase/supabase-js').createClient(
    'http://127.0.0.1:56531',
    v.SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const [target] =
      await admin`SELECT current_database() AS name,to_regclass('auth.users') IS NOT NULL AS managed_auth,to_regclass('storage.objects') IS NOT NULL AS storage`;
    check(
      target.name === DB && target.managed_auth && target.storage,
      'GENUINE_CO_RESIDENT_SCHEMAS',
    );
    if (mode === 'apply_scoped_sql') {
      check(!fs.existsSync(run + '/sql-progress.json'), 'UNCERTAIN_SQL_INSPECT_FIRST');
      const folder = repo + '/packages/db/migrations';
      const files = fs
        .readdirSync(folder)
        .filter((x) => /^(000[0-9]|0010)_.*\.sql$/.test(x))
        .sort();
      check(files.length === 11, 'EXACT_REGISTERED_RANGE');
      const progress = [];
      for (const file of [
        ...files.map((x) => folder + '/' + x),
        repo + '/packages/db/migration-drafts/0011_checkpoint_drafts.DRAFT.sql',
        repo + '/packages/db/migration-drafts/0014_checkpoint_editor_context.DRAFT.sql',
      ]) {
        const bytes = fs.readFileSync(file);
        const lock = JSON.parse(
          fs.readFileSync(repo + '/infra/checkpoint-auth-rehearsal/source-lock.json', 'utf8'),
        );
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        check(lock.sql[path.relative(repo, file)] === digest, 'SQL_SOURCE_CHANGED');
        progress.push({ file: path.basename(file), sha256: digest, state: 'started' });
        save('sql-progress.json', progress);
        await admin.unsafe(bytes.toString('utf8'));
        progress.at(-1).state = 'applied';
        save('sql-progress.json', progress);
      }
      return;
    }
    if (mode === 'issue_restricted_access') {
      check(!fs.existsSync(run + '/fixture.json'), 'UNCERTAIN_FIXTURE_INSPECT_FIRST');
      const fixture = { learners: [], cohortId: null, versionId: null };
      save('fixture.json', fixture);
      const role = ACTIVE.login_role,
        password = crypto.randomBytes(32).toString('hex');
      await admin.unsafe(
        `CREATE ROLE ${role} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS VALID UNTIL '${new Date(s.deadline * 1000).toISOString()}' PASSWORD '${password}';GRANT nextera_web TO ${role}`,
      );
      v.web_dsn = 'postgres://' + role + ':' + password + '@127.0.0.1:56532/' + DB;
      save('credentials.json', v);
      const { drizzle } = req('drizzle-orm/postgres-js'),
        schema = req(repo + '/packages/db/schema/index.ts');
      const domain = drizzle(admin, { schema });
      const f = req(repo + '/tests/fixtures/checkpoints.ts').checkpointFixture();
      fixture.versionId = (
        await req(repo + '/packages/db/operations/curriculum.ts').importCurriculum(
          domain,
          f.curriculum,
          f.gitCommitSha,
          f.evaluations,
        )
      ).id;
      save('fixture.json', fixture);
      const cohorts = req(repo + '/packages/db/operations/cohorts.ts');
      fixture.cohortId = (
        await cohorts.createCohort(domain, {
          slug: 'foundation-test' + PROJECT.slice('01coding'.length),
          name: 'SYNTHETIC AUTHENTICATED DRAFT TEST',
          curriculumVersionId: fixture.versionId,
          startsAt: new Date(),
        })
      ).id;
      save('fixture.json', fixture);
      const [definition] =
        await admin`SELECT definition_digest FROM app.checkpoint_definitions WHERE curriculum_version_id=${fixture.versionId} AND node_key='transfer-checkpoint'`;
      fixture.definitionDigest = definition.definition_digest;
      await admin`INSERT INTO app.checkpoint_draft_policies(curriculum_version_id,node_key,definition_digest,enabled,max_source_bytes,max_receipts_per_task,max_bytes_per_task,retention_after_deadline_seconds) VALUES(${fixture.versionId},'transfer-checkpoint',${fixture.definitionDigest},true,1024,64,65536,600)`;
      for (const suffix of ['a', 'b']) {
        const person = {
          email: ACTIVE.learners[suffix === 'a' ? 0 : 1],
          password: crypto.randomBytes(24).toString('hex'),
          authId: null,
          userId: null,
          attemptId: null,
        };
        fixture.learners.push(person);
        save('fixture.json', fixture);
        person.authCreation = 'pending';
        save('fixture.json', fixture);
        const created = await auth.auth.admin.createUser({
          email: person.email,
          password: person.password,
          email_confirm: true,
        });
        if (created.error) {
          person.authCreation = 'rejected';
          save('fixture.json', fixture);
        }
        check(!created.error && created.data.user, 'AUTH_CREATE');
        person.authCreation = 'created';
        person.authId = created.data.user.id;
        save('fixture.json', fixture);
        const [managed] = await admin`SELECT id FROM auth.users WHERE id=${person.authId}`;
        check(managed?.id === person.authId, 'AUTH_NOT_CO_RESIDENT');
        const [user] =
          await admin`INSERT INTO app.users(auth_user_id,display_name,role) VALUES(${person.authId},'Synthetic checkpoint learner','learner') RETURNING id`;
        person.userId = String(user.id);
        save('fixture.json', fixture);
        await cohorts.enrollLearner(domain, fixture.cohortId, person.userId);
        const ordinary = req('@supabase/supabase-js').createClient(
          'http://127.0.0.1:56531',
          v.ANON_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const signed = await ordinary.auth.signInWithPassword({
          email: person.email,
          password: person.password,
        });
        check(!signed.error && signed.data.session, 'INITIAL_SESSION');
        person.accessToken = signed.data.session.access_token;
        person.refreshToken = signed.data.session.refresh_token;
        save('fixture.json', fixture);
        const web = postgres(v.web_dsn, { max: 1, prepare: false });
        try {
          person.attemptId = String(
            (
              await web`SELECT app.start_checkpoint(${person.authId},${fixture.cohortId},'transfer-checkpoint',${crypto.randomUUID()}) AS id`
            )[0].id,
          );
        } finally {
          await web.end();
        }
        save('fixture.json', fixture);
      }
      return;
    }
    if (mode === 'disable_sql_access') {
      await admin`UPDATE app.users SET active=false WHERE auth_user_id IN(SELECT id FROM auth.users WHERE email IN(${ACTIVE.learners[0]},${ACTIVE.learners[1]}))`;
      await admin`UPDATE app.cohort_memberships SET status='inactive' WHERE user_id IN(SELECT id FROM app.users WHERE auth_user_id IN(SELECT id FROM auth.users WHERE email IN(${ACTIVE.learners[0]},${ACTIVE.learners[1]})))`;
      const [role] = await admin`SELECT 1 FROM pg_roles WHERE rolname=${ACTIVE.login_role}`;
      if (role) {
        await admin.unsafe(
          `ALTER ROLE ${ACTIVE.login_role} NOLOGIN;REVOKE nextera_web FROM ${ACTIVE.login_role}`,
        );
        await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=${ACTIVE.login_role} AND pid<>pg_backend_pid()`;
      }
      save('sql-access-disabled.json', {
        attempted: true,
        providerCleanupStillRequiresVerification: true,
      });
      return;
    }
    if (mode === 'disable') {
      const fixture = fs.existsSync(run + '/fixture.json')
        ? JSON.parse(fs.readFileSync(run + '/fixture.json', 'utf8'))
        : { learners: [] };
      // A cleanup-only refresh is proposed explicitly for the fresh approval. It uses
      // the existing test session inside the original window; it never renews the lease.
      for (const person of fixture.learners)
        if (person.authId) {
          const [remainingSessions] =
            await admin`SELECT count(*) AS count FROM auth.sessions WHERE user_id=${person.authId}`;
          if (String(remainingSessions.count) === '0') continue;
          check(Date.now() / 1000 < s.deadline - 30, 'CLEANUP_REFRESH_WINDOW_EXPIRED');
          const ordinary = req('@supabase/supabase-js').createClient(
            'http://127.0.0.1:56531',
            v.ANON_KEY,
            { auth: { persistSession: false, autoRefreshToken: false } },
          );
          const refreshed = person.refreshToken
            ? await ordinary.auth.refreshSession({ refresh_token: person.refreshToken })
            : await ordinary.auth.signInWithPassword({
                email: person.email,
                password: person.password,
              });
          check(!refreshed.error && refreshed.data.session, 'CLEANUP_EXISTING_ACCOUNT_AUTH');
          const result = await auth.auth.admin.signOut(
            refreshed.data.session.access_token,
            'global',
          );
          check(!result.error, 'AUTH_GLOBAL_SIGNOUT');
        }
      // Recover a lost createUser response only by exact approved test email, never expand scope.
      let unresolvedCreate = false;
      for (const email of [ACTIVE.learners[0], ACTIVE.learners[1]]) {
        const [row] = await admin`SELECT id FROM auth.users WHERE email=${email}`;
        if (!row && fixture.learners.some((p) => p.email === email && p.authCreation === 'pending'))
          unresolvedCreate = true;
        if (row) {
          const result = await auth.auth.admin.updateUserById(row.id, { ban_duration: '876000h' });
          check(!result.error, 'AUTH_BAN');
          await admin`UPDATE app.users SET active=false WHERE auth_user_id=${row.id}`;
          await admin`UPDATE app.cohort_memberships SET status='inactive' WHERE user_id IN(SELECT id FROM app.users WHERE auth_user_id=${row.id})`;
        }
      }
      const [role] = await admin`SELECT 1 FROM pg_roles WHERE rolname=${ACTIVE.login_role}`;
      if (role) {
        await admin.unsafe(
          `ALTER ROLE ${ACTIVE.login_role} NOLOGIN;REVOKE nextera_web FROM ${ACTIVE.login_role}`,
        );
        await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=${ACTIVE.login_role} AND pid<>pg_backend_pid()`;
      }
      const [remaining] =
        await admin`SELECT (SELECT count(*) FROM app.users WHERE active AND auth_user_id IN(SELECT id FROM auth.users WHERE email IN(${ACTIVE.learners[0]},${ACTIVE.learners[1]}))) AS users,(SELECT count(*) FROM pg_roles WHERE rolname=${ACTIVE.login_role} AND rolcanlogin) AS roles`;
      const [sessions] =
        await admin`SELECT count(*) AS count FROM auth.sessions WHERE user_id IN(SELECT id FROM auth.users WHERE email IN(${ACTIVE.learners[0]},${ACTIVE.learners[1]}))`;
      check(
        String(remaining.users) === '0' &&
          String(remaining.roles) === '0' &&
          String(sessions.count) === '0',
        'ACCESS_OR_SESSIONS_STILL_ACTIVE',
      );
      check(!unresolvedCreate, 'AUTH_CREATE_OUTCOME_UNCERTAIN');
      save('access-disabled.json', {
        accessDisabled: true,
        providerSessionsRevoked: true,
        retained: true,
      });
      return;
    }
    check(mode === 'assert_http', 'UNKNOWN_PHASE');
    const fixture = JSON.parse(fs.readFileSync(run + '/fixture.json', 'utf8'));
    const appReq = createRequire(repo + '/apps/web/package.json');
    const { createServerClient } = appReq('@supabase/ssr');
    const base = 'http://127.0.0.1:3151';
    for (const person of fixture.learners) {
      const cookies = [];
      const client = createServerClient('http://127.0.0.1:56531', v.ANON_KEY, {
        cookies: {
          getAll: () => cookies,
          setAll: (items) => {
            for (const item of items) {
              const old = cookies.find((x) => x.name === item.name);
              if (old) old.value = item.value;
              else cookies.push(item);
            }
          },
        },
      });
      const signed = await client.auth.signInWithPassword({
        email: person.email,
        password: person.password,
      });
      check(!signed.error && signed.data.session, 'ORDINARY_SIGN_IN');
      person.cookie = cookies.map((x) => x.name + '=' + x.value).join('; ');
      person.accessToken = signed.data.session.access_token;
      person.refreshToken = signed.data.session.refresh_token;
      save('fixture.json', fixture);
    }
    const [a, b] = fixture.learners;
    const task = 'normalize-label';
    const url = '/api/checkpoints/editor?attempt=' + a.attemptId + '&task=' + task;
    const request = async (person, p, init = {}) =>
      fetch(base + p, {
        ...init,
        redirect: 'error',
        headers: { ...init.headers, ...(person ? { cookie: person.cookie } : {}) },
        signal: AbortSignal.timeout(10000),
      });
    const headers = {
      origin: base,
      'content-type': 'application/octet-stream',
      'x-attempt-id': a.attemptId,
      'x-task-key': task,
      'x-definition-digest': fixture.definitionDigest,
    };
    const write = (version, text, id = crypto.randomUUID(), digest = fixture.definitionDigest) =>
      request(a, '/api/checkpoints/drafts', {
        method: 'POST',
        headers: {
          ...headers,
          'idempotency-key': id,
          'x-base-version': String(version),
          'x-definition-digest': digest,
        },
        body: Buffer.from(text),
      });
    const evidence = await verifyDraftFlow({
      transport: 'managed_auth_http',
      bootstrap: (who) => request(who === 'a' ? a : who === 'b' ? b : null, url),
      save: write,
      revoke: () => admin`UPDATE app.users SET active=false WHERE id=${a.userId}`,
      counts: async () =>
        (
          await admin`SELECT (SELECT count(*) FROM app.submissions) AS submissions,(SELECT count(*) FROM judge.jobs) AS jobs,(SELECT count(*) FROM app.checkpoint_outcomes) AS outcomes`
        )[0],
      receiptCount: async () =>
        Number(
          (
            await admin`SELECT count(*) AS count FROM app.checkpoint_draft_revisions WHERE attempt_id=${a.attemptId} AND task_key=${task}`
          )[0].count,
        ),
    });
    save('http-evidence.json', evidence);
  } finally {
    await admin.end();
  }
}
export {
  profileFor,
  validateConfig,
  publicTemplateMode,
  validateOwnedEndpoints,
  browserReceipt,
  appEnvironment,
  verifyDraftFlow,
  execute,
};
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  execute(process.argv[2], process.argv[3], process.argv[4]).catch(() => {
    process.stderr.write(
      'CHECKPOINT_REHEARSAL_PHASE_FAILED; protected state retained; inspect before retry.\n',
    );
    process.exitCode = 1;
  });
