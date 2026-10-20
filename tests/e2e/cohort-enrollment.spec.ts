import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { test, expect, type Page } from '@playwright/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@nextera/db/schema';
import { importCurriculum } from '@nextera/db/operations/curriculum';
import { testCurriculum } from '../fixtures/curriculum';

// Real local Auth/web/PostgreSQL, isolated non-runnable test projections. No Judge identities are approved here.
const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 2, prepare: false });
const db = drizzle(sql, { schema });
const auth = createClient(
  process.env.SUPABASE_LOCAL_URL!,
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const password = randomBytes(24).toString('hex');
const people = new Map<string, { authId: string; email: string; userId: string }>();
const cohortIds: string[] = [];
let own: string;
let other: string;
const name = `ISOLATED 002B COHORT ${randomUUID()}`;
const run = (args: string[]) =>
  execFileSync('pnpm', args, {
    stdio: 'pipe',
    env: { ...process.env, OPERATIONS_DATABASE_URL: process.env.MIGRATION_DATABASE_URL! },
  });

test.beforeAll(async () => {
  test.setTimeout(90000);
  const fixture = testCurriculum();
  const version = await importCurriculum(
    db,
    fixture.curriculum,
    fixture.gitCommitSha,
    fixture.evaluations,
  );
  for (const suffix of ['own', 'other']) {
    const slug = `foundation-test-browser-${suffix}-${randomUUID()}`;
    run([
      'cohort:create',
      '--slug',
      slug,
      '--name',
      suffix === 'own' ? name : `${name} OTHER`,
      '--version-id',
      version.id,
      '--starts-at',
      '2026-11-20T00:00:00Z',
    ]);
    const [row] = await sql`SELECT id FROM app.cohorts WHERE slug=${slug}`;
    cohortIds.push(String(row!.id));
  }
  [own, other] = cohortIds as [string, string];
  for (const role of ['learner', 'unassigned', 'operator', 'admin']) {
    const email = `foundation-002b-${role}-${randomBytes(6).toString('hex')}@example.test`;
    const { data, error } = await auth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'admin' },
    });
    if (error || !data.user) throw new Error('Unable to create isolated local Auth fixture.');
    people.set(role, { authId: data.user.id, email, userId: '' });
    run([
      'local:provision',
      '--auth-user-id',
      data.user.id,
      '--role',
      role === 'unassigned' ? 'learner' : role,
      '--name',
      `002B ${role}`,
    ]);
    const [user] = await sql`SELECT id FROM app.users WHERE auth_user_id=${data.user.id}`;
    people.get(role)!.userId = String(user!.id);
  }
  run(['cohort:enroll', '--cohort-id', own, '--user-id', people.get('learner')!.userId]);
  run(['cohort:enroll', '--cohort-id', own, '--user-id', people.get('learner')!.userId]);
});

test.afterAll(async () => {
  try {
    for (const id of cohortIds) {
      await sql`DELETE FROM app.learner_node_progress WHERE cohort_id=${id}`;
      await sql`DELETE FROM app.cohort_memberships WHERE cohort_id=${id}`;
      await sql`DELETE FROM app.cohorts WHERE id=${id}`;
    }
    for (const person of people.values()) {
      await sql`DELETE FROM app.users WHERE auth_user_id=${person.authId}`;
      await auth.auth.admin.deleteUser(person.authId);
    }
    // Immutable test-only curriculum rows are retained; no learner/cohort or execution data remains.
  } finally {
    await sql.end();
  }
});

async function login(page: Page, role: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(people.get(role)!.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test('enrolled learner sees real cohort and persistent available/locked state', async ({
  page,
}) => {
  await login(page, 'learner');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/cohorts/${own}$`));
  const hello = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Hello Go', exact: true }) });
  const even = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Even or Odd', exact: true }) });
  await expect(hello.getByText('AVAILABLE', { exact: true })).toBeVisible();
  await expect(even.getByText('LOCKED', { exact: true })).toBeVisible();
  await expect(even.getByText('Requires passing all prerequisites: Hello Go.')).toBeVisible();
  await expect(even.getByRole('link')).toHaveCount(0);
  await page.reload();
  await expect(hello.getByText('AVAILABLE', { exact: true })).toBeVisible();
  await expect(even.getByText('LOCKED', { exact: true })).toBeVisible();
  await hello.getByRole('link', { name: 'Read Hello Go' }).click();
  await expect(page.getByText('func Hello(name string) string', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Tasks', exact: true })
      .getByText('hello.go', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /submit/i })).toHaveCount(0);
  const rows =
    await sql`SELECT node_key,state FROM app.learner_node_progress WHERE cohort_id=${own} AND user_id=${people.get('learner')!.userId} ORDER BY node_key`;
  expect(rows.map((row) => [row.node_key, row.state])).toEqual([
    ['even-or-odd', 'locked'],
    ['hello-go', 'available'],
  ]);
});

test('locked subject is hidden even with a direct URL', async ({ page }) => {
  await login(page, 'learner');
  const response = await page.goto(`/app/cohorts/${own}/challenges/even-or-odd`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText('func EvenOrOdd(n int) string', { exact: true })).toHaveCount(0);
});

test('learner cannot read another cohort or its subjects using forged browser role input', async ({
  page,
}) => {
  await login(page, 'learner');
  for (const path of [
    `/app/cohorts/${other}?role=admin`,
    `/app/cohorts/${other}/challenges/hello-go`,
  ]) {
    expect((await page.goto(path))?.status()).toBe(404);
    await expect(page.getByText('func Hello(name string) string', { exact: true })).toHaveCount(0);
  }
});

test('inactive membership denies map and subject access on the next request', async ({ page }) => {
  await login(page, 'learner');
  const id = people.get('learner')!.userId;
  await sql`UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=${own} AND user_id=${id}`;
  try {
    expect((await page.goto(`/app/cohorts/${own}`))?.status()).toBe(404);
    expect((await page.goto(`/app/cohorts/${own}/challenges/hello-go`))?.status()).toBe(404);
    await page.goto('/app');
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
  } finally {
    await sql`UPDATE app.cohort_memberships SET status='active' WHERE cohort_id=${own} AND user_id=${id}`;
  }
});

test('operators need explicit membership and then have a labeled read-only preview', async ({
  page,
}) => {
  await login(page, 'operator');
  expect((await page.goto(`/app/cohorts/${own}`))?.status()).toBe(404);
  const id = people.get('operator')!.userId;
  await sql`INSERT INTO app.cohort_memberships(cohort_id,user_id) VALUES (${own},${id})`;
  try {
    await page.goto(`/app/cohorts/${own}`);
    await expect(
      page.getByText('Read-only curriculum preview. No learner progress is implied.'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Read Even or Odd', exact: true }).click();
    await expect(page.getByText('func EvenOrOdd(n int) string', { exact: true })).toBeVisible();
    expect((await page.goto(`/app/cohorts/${other}`))?.status()).toBe(404);
  } finally {
    await sql`DELETE FROM app.cohort_memberships WHERE cohort_id=${own} AND user_id=${id}`;
  }
});

test('admins have explicit read-only cohort and locked-subject preview access', async ({
  page,
}) => {
  await login(page, 'admin');
  await expect(page.getByRole('link', { name: `${name} OTHER`, exact: true })).toBeVisible();
  await page.goto(`/app/cohorts/${other}/challenges/even-or-odd`);
  await expect(page.getByText('Administrative read-only subject preview.')).toBeVisible();
  await expect(page.getByText('func EvenOrOdd(n int) string', { exact: true })).toBeVisible();
});

test('login does not enroll an unassigned provisioned learner', async ({ page }) => {
  await login(page, 'unassigned');
  await expect(
    page.getByText('No active cohorts assigned. Enrollment is controlled by your operator.'),
  ).toBeVisible();
  expect(
    await sql`SELECT cohort_id FROM app.cohort_memberships WHERE user_id=${people.get('unassigned')!.userId}`,
  ).toHaveLength(0);
});
