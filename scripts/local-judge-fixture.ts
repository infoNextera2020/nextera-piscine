/** Explicit disposable-database setup. This is never a startup hook or production provisioner. */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const { values } = parseArgs({
  options: { database: { type: 'string' }, output: { type: 'string' } },
});
if (!values.database || !values.output) throw new Error('--database and --output required.');
const target = new URL(values.database);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.startsWith('/foundation_test')
)
  throw new Error('Disposable loopback fixture database required.');
mkdirSync(resolve(values.output), { recursive: true, mode: 0o700 });
const output = realpathSync(resolve(values.output));
const rel = relative(realpathSync(process.cwd()), output);
if (
  !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) ||
  statSync(output).mode & 0o077
)
  throw new Error('Private directory outside checkout required.');
for (const name of ['web.env', 'maintenance.env', 'application.env', 'runtime.json'])
  if (existsSync(join(output, name)))
    throw new Error('Use a fresh credential directory; existing files are never replaced.');
const admin = postgres(target.toString(), { max: 1, prepare: false, onnotice: () => {} });
const web = 'f004_web_' + randomBytes(8).toString('hex'),
  maintenance = 'f004_maintenance_' + randomBytes(8).toString('hex');
const product = 'f005_application_' + randomBytes(8).toString('hex');
const productPassword = randomBytes(24).toString('hex');
const serviceToken = randomBytes(32).toString('hex');
const webPassword = randomBytes(24).toString('hex'),
  maintenancePassword = randomBytes(24).toString('hex');
try {
  // Minimal external FK fixture, only in this disposable database. Sessions still use real Supabase Auth.
  await admin.unsafe(
    'CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY)',
  );
  await migrate(drizzle(admin), { migrationsFolder: resolve('packages/db/migrations') });
  await migrate(drizzle(admin), { migrationsFolder: resolve('packages/db/migrations') });
  await admin.begin(async (tx) => {
    await tx.unsafe(
      `CREATE ROLE ${web} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${webPassword}'`,
    );
    await tx.unsafe(`GRANT nextera_web TO ${web}`);
    await tx.unsafe(
      `CREATE ROLE ${maintenance} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${maintenancePassword}'`,
    );
    await tx.unsafe(`GRANT nextera_judge_maintenance TO ${maintenance}`);
    await tx.unsafe(
      `CREATE ROLE ${product} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${productPassword}'`,
    );
    await tx.unsafe(`GRANT nextera_result_application TO ${product}`);
  });
  const productURL = new URL(target);
  productURL.username = product;
  productURL.password = productPassword;
  writeFileSync(
    join(output, 'application.env'),
    `RESULT_APPLICATION_DATABASE_URL=${productURL}\nRESULT_APPLICATION_SERVICE_TOKEN=${serviceToken}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  const webURL = new URL(target);
  webURL.username = web;
  webURL.password = webPassword;
  const maintenanceURL = new URL(target);
  maintenanceURL.username = maintenance;
  maintenanceURL.password = maintenancePassword;
  writeFileSync(
    join(output, 'web.env'),
    `JUDGE_TEST_DATABASE_URL=${target}\nJUDGE_WEB_DATABASE_URL=${webURL}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  writeFileSync(join(output, 'maintenance.env'), `MAINTENANCE_DATABASE_URL=${maintenanceURL}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  writeFileSync(
    join(output, 'runtime.json'),
    JSON.stringify({
      web_principal: web,
      maintenance_principal: maintenance,
      application_principal: product,
    }) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  console.info(
    'Disposable fixture database migrated; restricted web/maintenance credentials stored privately. No users or cohorts created.',
  );
} finally {
  await admin.end();
}
