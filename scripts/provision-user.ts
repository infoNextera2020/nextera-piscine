import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { USER_ROLES } from '@nextera/domain';
import { assertLocalUrl, required } from './local-environment';

const { values } = parseArgs({
  options: {
    'auth-user-id': { type: 'string' },
    role: { type: 'string' },
    name: { type: 'string' },
  },
});
const authId = values['auth-user-id'];
if (
  !authId ||
  !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(authId) ||
  !values.role ||
  !USER_ROLES.some((role) => role === values.role) ||
  !values.name?.trim() ||
  values.name.length > 120
) {
  throw new Error(
    'Usage: pnpm local:provision --auth-user-id <uuid> --role learner|operator|admin --name <display-name>',
  );
}
const connection = required('MIGRATION_DATABASE_URL');
assertLocalUrl(connection, '54322');
const sql = postgres(connection, { max: 1, prepare: false });
try {
  const rows = await sql`INSERT INTO app.users (auth_user_id, display_name, role)
    VALUES (${authId}, ${values.name.trim()}, ${values.role})
    ON CONFLICT (auth_user_id) DO UPDATE SET display_name = EXCLUDED.display_name,
      role = EXCLUDED.role, active = true, updated_at = now() RETURNING id, role`;
  console.info(
    `Provisioned local domain user ${rows[0]!.id} with role ${rows[0]!.role}. No cohort enrollment performed.`,
  );
} finally {
  await sql.end();
}
