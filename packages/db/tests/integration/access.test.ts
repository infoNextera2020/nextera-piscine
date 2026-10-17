import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required.');
  const url = new URL(value);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.startsWith('/foundation_test')
  )
    throw new Error('Only a local disposable foundation_test database is allowed.');
  sql = postgres(value, { max: 1, prepare: false, onnotice: () => {} });
  await sql.unsafe('CREATE SCHEMA IF NOT EXISTS auth');
  await sql.unsafe('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await sql.unsafe(
      `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`,
    );
  }
  await migrate(drizzle(sql), {
    migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
  });
});
afterAll(async () => {
  if (sql) await sql.end();
});

describe('identity runtime privileges', () => {
  it('grants the runtime only the needed user columns', async () => {
    const rows =
      await sql`SELECT column_name, privilege_type FROM information_schema.column_privileges WHERE grantee = 'nextera_web' AND table_schema='app' AND table_name='users' ORDER BY column_name`;
    expect(rows.map((r) => r.column_name)).toEqual([
      'active',
      'auth_user_id',
      'display_name',
      'id',
      'role',
    ]);
    expect(rows.every((r) => r.privilege_type === 'SELECT')).toBe(true);
  });
  it('reads identity mapping with the restricted role', async () => {
    await sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE nextera_web');
      await expect(
        tx`SELECT id, auth_user_id, display_name, role, active FROM app.users LIMIT 1`,
      ).resolves.toBeDefined();
    });
  });
  it.each([
    'SELECT created_at FROM app.users',
    "UPDATE app.users SET role = 'admin'",
    "INSERT INTO app.users (auth_user_id, display_name) VALUES (gen_random_uuid(), 'Forbidden')",
    'SELECT * FROM app.curriculum_nodes',
    'SELECT * FROM app.submissions',
    'SELECT * FROM judge.jobs',
    'SELECT * FROM auth.users',
  ])('denies runtime operation: %s', async (statement) => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE nextera_web');
        await tx.unsafe(statement);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it.each(['anon', 'authenticated', 'service_role'])(
    'keeps private schemas inaccessible to %s',
    async (role) => {
      for (const schema of ['app', 'judge']) {
        const [row] =
          await sql`SELECT has_schema_privilege(${role}, ${schema}, 'USAGE') AS allowed`;
        expect(row?.allowed).toBe(false);
      }
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx.unsafe('SELECT id FROM app.users');
        }),
      ).rejects.toMatchObject({ code: '42501' });
    },
  );
});
