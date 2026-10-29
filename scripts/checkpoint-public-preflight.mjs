/* Public fake-config validation only. Never calls runtime stage or generates keys. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  DB_JWT_INIT_SQL,
  buildPublicEnvironment,
  buildPublicCompose,
  copyVerifiedPublicTemplates,
  requiredInitEnvironment,
  validateInitEnvironment,
  validateConfig,
  writePrivateText,
  profileFor,
} from './checkpoint-auth-runtime.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = (ok, label) => {
  if (!ok) throw new Error(label);
};
function verifyPublic(template, destination) {
  const base = path.join(repo, '.tools');
  check(
    path.dirname(destination) === base &&
      path.basename(destination).startsWith('source-public-preflight-') &&
      !fs.existsSync(destination),
    'FRESH_SOURCE_FIXTURE_ONLY',
  );
  const lockBytes = fs.readFileSync(
      path.join(repo, 'infra/checkpoint-auth-rehearsal/source-lock.json'),
    ),
    lock = JSON.parse(lockBytes),
    profile = profileFor(process.env.CHECKPOINT_REHEARSAL_PROFILE || 'attempt001');
  fs.mkdirSync(destination, { mode: 0o700 });
  const modes = copyVerifiedPublicTemplates(template, destination, lock.files),
    require = createRequire(path.join(repo, 'package.json')),
    yaml = require('yaml');
  const vars = buildPublicEnvironment(
    require('dotenv').parse(fs.readFileSync(path.join(destination, '.env.example'))),
  );
  for (const name of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY'])
    check(vars[name] === 'REHEARSAL_CONFIG_PLACEHOLDER_NOT_FOR_START', 'PLACEHOLDER_ONLY');
  const compose = buildPublicCompose(
    yaml.parse(fs.readFileSync(path.join(destination, 'docker-compose.yml'), 'utf8')),
    lock.images,
  );
  const sqlSources = [
    DB_JWT_INIT_SQL,
    ...Object.keys(lock.files)
      .filter(
        (name) =>
          name.startsWith('volumes/db/') && name.endsWith('.sql') && name !== 'volumes/db/jwt.sql',
      )
      .map((name) => fs.readFileSync(path.join(destination, name), 'utf8')),
  ];
  validateInitEnvironment(sqlSources, compose.services.db.environment);
  writePrivateText(
    path.join(destination, '.env'),
    Object.entries(vars)
      .map(([key, value]) => key + '=' + value)
      .join('\n') + '\n',
  );
  writePrivateText(path.join(destination, 'docker-compose.yml'), yaml.stringify(compose));
  fs.writeFileSync(path.join(destination, 'volumes/db/jwt.sql'), DB_JWT_INIT_SQL);
  fs.chmodSync(path.join(destination, 'volumes/db/jwt.sql'), 0o644);
  const dockerClient = path.join(destination, 'docker-client');
  fs.mkdirSync(dockerClient, { mode: 0o700 });
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: 'C.UTF-8',
    DOCKER_CONFIG: dockerClient,
  };
  const rendered = JSON.parse(
    execFileSync(
      'docker',
      [
        'compose',
        '--project-name',
        profile.project,
        '--project-directory',
        destination,
        '--env-file',
        path.join(destination, '.env'),
        '-f',
        path.join(destination, 'docker-compose.yml'),
        'config',
        '--format',
        'json',
      ],
      { env, timeout: 20000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
  validateConfig(rendered, destination, lock.images);
  writePrivateText(
    path.join(destination, 'rendered-compose.fake.json'),
    JSON.stringify(rendered, null, 2),
  );
  const image = JSON.parse(
    execFileSync('docker', ['image', 'inspect', lock.images.db], {
      env,
      timeout: 10000,
      encoding: 'utf8',
    }),
  )[0];
  const inherited = Object.fromEntries(
    image.Config.Env.map((row) => {
      const index = row.indexOf('=');
      return [row.slice(0, index), row.slice(index + 1)];
    }),
  );
  check(
    inherited.POSTGRES_USER === compose.services.db.environment.POSTGRES_USER,
    'PUBLIC_IMAGE_USER_DEFAULT',
  );
  const sqlNames = Object.keys(lock.sql),
    registered = sqlNames.filter((name) =>
      /^packages\/db\/migrations\/(000[0-9]|0010)_/.test(name),
    );
  check(
    sqlNames.length === 13 &&
      registered.length === 11 &&
      sqlNames.includes('packages/db/migration-drafts/0011_checkpoint_drafts.DRAFT.sql') &&
      sqlNames.includes('packages/db/migration-drafts/0014_checkpoint_editor_context.DRAFT.sql'),
    'EXACT_SQL_SCOPE',
  );
  for (const [name, digest] of Object.entries(lock.sql))
    check(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(repo, name)))
        .digest('hex') === digest,
      'SQL_HASH',
    );
  const privateModes = Object.fromEntries(
    ['.env', 'docker-compose.yml', 'rendered-compose.fake.json'].map((name) => [
      name,
      fs.statSync(path.join(destination, name)).mode & 0o777,
    ]),
  );
  check(
    Object.values(privateModes).every((mode) => mode === 0o600),
    'PRIVATE_CONFIG_MODE',
  );
  check(!fs.existsSync(path.join(destination, 'volumes/db/data')), 'NO_DATABASE_DATA_DIRECTORY');
  return {
    status: 'public_placeholder_config_verified_not_runtime',
    observedAt: new Date().toISOString(),
    publicTemplates: modes.filter((row) => row.kind === 'file').length,
    pinnedServices: Object.keys(rendered.services),
    exactImagePins: true,
    requiredDbInitEnvironment: requiredInitEnvironment(sqlSources),
    inheritedDbUser: inherited.POSTGRES_USER,
    privateConfigModes: privateModes,
    sqlSourcesVerified: sqlNames.length,
    dbDataDirectoryCreated: false,
    keysGenerated: false,
    approvalCreated: false,
    servicesCreatedOrStarted: false,
    commands: ['docker compose config', 'docker image inspect'],
    publicLockSha256: crypto.createHash('sha256').update(lockBytes).digest('hex'),
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  check(
    args[0] === '--verify-public' &&
      args[1] === '--template' &&
      args[3] === '--destination' &&
      args.length === 5,
    'EXPLICIT_PUBLIC_PREFLIGHT_ARGUMENTS',
  );
  const result = verifyPublic(path.resolve(args[2]), path.resolve(args[4]));
  writePrivateText(
    path.join(path.resolve(args[4]), 'receipt.json'),
    JSON.stringify(result, null, 2),
  );
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
export { verifyPublic };
