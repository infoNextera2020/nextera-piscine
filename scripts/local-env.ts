import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { assertLocalUrl, root } from './local-environment';

const files = [`${root}.env`, `${root}apps/web/.env.local`];
if (files.some(existsSync) && !process.argv.includes('--refresh')) {
  throw new Error(
    'Local env files exist. Review them, then use --refresh to explicitly replace them.',
  );
}
let status: Record<string, string>;
try {
  status = JSON.parse(
    execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ) as Record<string, string>;
} catch {
  // An exec error can contain captured status output, including local admin keys.
  throw new Error('Local Supabase status is unavailable. Start the local stack and retry.');
}
const databaseUrl = status.DB_URL;
const apiUrl = status.API_URL;
const publishable = status.PUBLISHABLE_KEY || status.ANON_KEY;
const serviceKey = status.SERVICE_ROLE_KEY;
if (!databaseUrl || !apiUrl || !publishable || !serviceKey)
  throw new Error('Local Supabase status is missing required fields.');
assertLocalUrl(databaseUrl, '54322');
assertLocalUrl(apiUrl, '54321');
const admin = postgres(databaseUrl, { max: 1, prepare: false });
const password = randomBytes(32).toString('hex');
try {
  const [auth] = await admin`SELECT to_regclass('auth.schema_migrations') AS managed`;
  if (!auth?.managed) throw new Error('Expected a real local Supabase Auth database.');
  const [role] =
    await admin`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = 'nextera_web_local'`;
  if (role && Object.values(role).some(Boolean))
    throw new Error('Existing local runtime login has unexpected elevated privileges.');
  if (!role)
    await admin.unsafe(
      'CREATE ROLE nextera_web_local LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    );
  await admin.unsafe(`ALTER ROLE nextera_web_local PASSWORD '${password}'`);
  await admin.unsafe('GRANT nextera_web TO nextera_web_local');
  await admin.unsafe('ALTER ROLE nextera_web_local SET search_path = pg_catalog, app');
} finally {
  await admin.end();
}
const runtime = new URL(databaseUrl);
runtime.username = 'nextera_web_local';
runtime.password = password;
const publicEnv = `NEXT_PUBLIC_SUPABASE_URL=${apiUrl}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable}\n`;
writeFileSync(
  files[0]!,
  `# Local tooling only; never deploy this file.\nMIGRATION_DATABASE_URL=${databaseUrl}\nDATABASE_URL=${runtime}\nSUPABASE_LOCAL_URL=${apiUrl}\nSUPABASE_LOCAL_SERVICE_ROLE_KEY=${serviceKey}\n`,
  { mode: 0o600 },
);
writeFileSync(files[1]!, `${publicEnv}DATABASE_URL=${runtime}\n`, { mode: 0o600 });
console.info(
  'Wrote ignored local environment files. Only the runtime connection and publishable Auth configuration enter apps/web.',
);
