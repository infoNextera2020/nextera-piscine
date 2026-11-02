import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import postgres from 'postgres';
import { USER_ROLES } from '@nextera/domain';
import { assertLocalUrl, required } from './local-environment';

config({ path: '.env', quiet: true });

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
  },
});

const email = values.email?.trim();
const password = values.password;
const name = values.name?.trim() || 'Demo Learner';
const role = values.role?.trim() || 'learner';

if (!email || !password) {
  console.log(`
Usage:
  pnpm local:create-user --email <email> --password <password> [--name <name>] [--role learner|operator|admin]

Example:
  pnpm local:create-user --email learner@example.test --password MyPassword123! --name "Demo Learner"
`);
  process.exit(1);
}

if (!USER_ROLES.some((r) => r === role)) {
  throw new Error(`Role must be one of: ${USER_ROLES.join(', ')}`);
}

const authUrl = required('SUPABASE_LOCAL_URL');
const serviceKey = required('SUPABASE_LOCAL_SERVICE_ROLE_KEY');
assertLocalUrl(authUrl, '54321');

const authClient = createClient(authUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Create user in Supabase Auth
const { data, error } = await authClient.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: name },
});

if (error || !data.user) {
  throw new Error(`Failed to create Auth user: ${error?.message || 'unknown error'}`);
}

const authUserId = data.user.id;
console.info(`✓ Created Supabase Auth user:`);
console.info(`  Email:        ${email}`);
console.info(`  Auth UUID:    ${authUserId}`);

// Provision in app.users domain table
const connection = required('MIGRATION_DATABASE_URL');
assertLocalUrl(connection, '54322');
const sql = postgres(connection, { max: 1, prepare: false });

try {
  const rows = await sql`INSERT INTO app.users (auth_user_id, display_name, role)
    VALUES (${authUserId}, ${name}, ${role})
    ON CONFLICT (auth_user_id) DO UPDATE SET display_name = EXCLUDED.display_name,
      role = EXCLUDED.role, active = true, updated_at = now() RETURNING id, role`;

  console.info(`✓ Provisioned domain user:`);
  console.info(`  Domain ID:    ${rows[0]!.id}`);
  console.info(`  Display Name: ${name}`);
  console.info(`  Role:         ${rows[0]!.role}`);
  console.info(`\nNext step to run local demo:`);
  console.info(`  pnpm local:demo:prepare --auth-user-id ${authUserId}`);
  console.info(`  pnpm local:demo\n`);
} finally {
  await sql.end();
}
