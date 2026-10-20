import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';

const admin = createClient(
  process.env.SUPABASE_LOCAL_URL!,
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, prepare: false });
const password = randomBytes(24).toString('hex');
const identities = new Map<string, { id: string; email: string }>();

test.beforeAll(async () => {
  for (const kind of ['unprovisioned', 'inactive', 'learner', 'operator', 'admin']) {
    const email = `foundation-${kind}-${randomBytes(6).toString('hex')}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'admin' },
    });
    if (error || !data.user) throw new Error('Unable to create a local Auth test identity.');
    identities.set(kind, { id: data.user.id, email });
    if (kind !== 'unprovisioned') {
      execFileSync(
        'pnpm',
        [
          'local:provision',
          '--auth-user-id',
          data.user.id,
          '--role',
          kind === 'inactive' ? 'learner' : kind,
          '--name',
          `Test ${kind}`,
        ],
        { stdio: 'pipe' },
      );
      if (kind === 'inactive')
        await sql`UPDATE app.users SET active = false, updated_at = now() WHERE auth_user_id = ${data.user.id}`;
    }
  }
});

test.afterAll(async () => {
  try {
    for (const identity of identities.values()) {
      await sql`DELETE FROM app.users WHERE auth_user_id = ${identity.id}`;
      await admin.auth.admin.deleteUser(identity.id);
    }
  } finally {
    await sql.end();
  }
});

async function signIn(page: Page, kind: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(identities.get(kind)!.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Server Actions finish asynchronously; wait for the login redirect before navigating again.
  await page.waitForURL(/\/(?:app|access-denied)(?:\?|$)/);
}

test('public routes work and protected routes require authentication', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'NextEra Piscine' })).toBeVisible();
  for (const route of ['/app', '/operator']) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('public email signup remains disabled while email login is enabled', async () => {
  const client = createClient(
    process.env.SUPABASE_LOCAL_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const email = `foundation-signup-${randomBytes(6).toString('hex')}@example.test`;
  const { data, error } = await client.auth.signUp({ email, password });
  try {
    expect(error?.code).toBe('signup_disabled');
    expect(await sql`SELECT id FROM auth.users WHERE email = ${email}`).toHaveLength(0);
  } finally {
    if (data.user) await admin.auth.admin.deleteUser(data.user.id);
  }
});

test('invalid credentials fail without creating a domain user', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(identities.get('unprovisioned')!.email);
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/error=invalid_credentials/);
});

test('authenticated unprovisioned identity is denied and never automatically enrolled', async ({
  page,
}) => {
  const id = identities.get('unprovisioned')!.id;
  await signIn(page, 'unprovisioned');
  await expect(page).toHaveURL(/reason=NOT_PROVISIONED/);
  await expect(page.getByText('NOT_PROVISIONED', { exact: true })).toBeVisible();
  await page.goto('/operator');
  await expect(page).toHaveURL(/reason=NOT_PROVISIONED/);
  expect(await sql`SELECT id FROM app.users WHERE auth_user_id = ${id}`).toHaveLength(0);
});

test('inactive domain user is denied', async ({ page }) => {
  await signIn(page, 'inactive');
  await expect(page).toHaveURL(/reason=INACTIVE/);
  await page.goto('/operator');
  await expect(page).toHaveURL(/reason=INACTIVE/);
});

test('learner access persists on refresh; metadata cannot grant operator access', async ({
  page,
}) => {
  await signIn(page, 'learner');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('Test learner', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('learner', { exact: true })).toBeVisible();
  await page.goto('/operator?role=admin');
  await expect(page).toHaveURL(/reason=FORBIDDEN/);
});

for (const role of ['operator', 'admin']) {
  test(`${role} can access operator route`, async ({ page }) => {
    await signIn(page, role);
    await page.goto('/operator');
    await expect(page).toHaveURL(/\/operator$/);
    await expect(page.getByText('Foundation 002A authorization verified.')).toBeVisible();
  });
}

test('database role and deactivation take effect on the next request', async ({ page }) => {
  const id = identities.get('learner')!.id;
  await signIn(page, 'learner');
  await expect(page).toHaveURL(/\/app$/);
  try {
    await sql`UPDATE app.users SET role = 'operator', updated_at = now() WHERE auth_user_id = ${id}`;
    await page.goto('/operator');
    await expect(page).toHaveURL(/\/operator$/);
    await sql`UPDATE app.users SET active = false, updated_at = now() WHERE auth_user_id = ${id}`;
    await page.reload();
    await expect(page).toHaveURL(/reason=INACTIVE/);
  } finally {
    await sql`UPDATE app.users SET role = 'learner', active = true, updated_at = now() WHERE auth_user_id = ${id}`;
  }
});

test('Proxy renews an expired session envelope through real Supabase Auth', async ({
  page,
  context,
}) => {
  await signIn(page, 'learner');
  await expect(page).toHaveURL(/\/app$/);
  const cookies = (await context.cookies())
    .filter((c) => /^sb-.*-auth-token(?:\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  expect(cookies.length).toBeGreaterThan(0);
  const encoded = cookies.map((c) => c.value).join('');
  expect(encoded.startsWith('base64-')).toBe(true);
  const session = JSON.parse(Buffer.from(encoded.slice(7), 'base64url').toString()) as {
    expires_at: number;
    refresh_token: string;
  };
  const previousToken = session.refresh_token;
  session.expires_at = 1;
  const expired = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  // Change storage expiry only; Auth must use the genuine refresh token to renew.
  let offset = 0;
  await context.addCookies(
    cookies.map((cookie, index) => {
      const value =
        index === cookies.length - 1
          ? expired.slice(offset)
          : expired.slice(offset, offset + cookie.value.length);
      offset += cookie.value.length;
      return { ...cookie, value };
    }),
  );
  await page.reload();
  await expect(page).toHaveURL(/\/app$/);
  const renewed = (await context.cookies())
    .filter((c) => /^sb-.*-auth-token(?:\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value)
    .join('');
  const refreshed = JSON.parse(Buffer.from(renewed.slice(7), 'base64url').toString()) as {
    expires_at: number;
    refresh_token: string;
  };
  expect(refreshed.expires_at).toBeGreaterThan(Date.now() / 1000);
  expect(refreshed.refresh_token).not.toBe(previousToken);
});

test('logout clears session cookies and protected access', async ({ page, context }) => {
  await signIn(page, 'learner');
  await expect(page).toHaveURL(/\/app$/);
  await page.getByLabel('Open account menu', { exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name))).toHaveLength(0);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
});

test('private schemas are absent from the Data API', async () => {
  const { error } = await admin.schema('app').from('users').select('id');
  expect(error?.code).toBe('PGRST106');
  const { error: judgeError } = await admin.schema('judge').from('jobs').select('id');
  expect(judgeError?.code).toBe('PGRST106');
});

test('all reviewed migrations and the real Supabase Auth foreign key are present', async () => {
  expect(await sql`SELECT id FROM drizzle.__drizzle_migrations`).toHaveLength(8);
  const references =
    await sql`SELECT 1 FROM pg_constraint WHERE conrelid = 'app.users'::regclass AND confrelid = 'auth.users'::regclass AND contype = 'f'`;
  expect(references).toHaveLength(1);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const schema of ['app', 'judge']) {
      const [row] = await sql`SELECT has_schema_privilege(${role}, ${schema}, 'USAGE') AS allowed`;
      expect(row?.allowed).toBe(false);
    }
  }
});
