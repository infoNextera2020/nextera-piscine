import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { test, expect, type Page } from '@playwright/test';
import type { LearningFixture } from '../fixtures/learning';
const f = JSON.parse(readFileSync(process.env.LEARNING_UI_FIXTURE!, 'utf8')) as LearningFixture;
const db = postgres(f.database, { max: 1, prepare: false, onnotice: () => {} });
let before = '';
async function actualFingerprint() {
  const [user] = await db.unsafe('SELECT id FROM app.users WHERE auth_user_id=$1', [f.authId]);
  const rows = await db.unsafe(
    "SELECT jsonb_build_object('progress',(SELECT jsonb_agg(to_jsonb(t) ORDER BY node_key) FROM app.learner_node_progress t WHERE user_id=$1),'submissions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.submissions t WHERE user_id=$1),'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM judge.jobs j JOIN app.submissions s ON s.id=j.submission_id WHERE s.user_id=$1),'attempts',(SELECT count(*) FROM app.checkpoint_attempts WHERE user_id=$1),'outcomes',(SELECT count(*) FROM app.checkpoint_outcomes WHERE user_id=$1),'events',(SELECT count(*) FROM app.activity_events WHERE user_id=$1)) AS evidence",
    [user!.id],
  );
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
test.beforeAll(async () => {
  before = await actualFingerprint();
  await mkdir('.tools/ui001-review', { recursive: true });
});
test.afterAll(async () => {
  await db.end();
});
async function login(page: Page, email = f.learner) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(f.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 15000 });
  await expect(page.locator('h1')).toBeVisible();
}
test('Home renders authorized next work and the latest receipt without sample progress', async ({
  page,
}) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Your Piscine', exact: true })).toBeVisible();
  await expect(page.getByLabel('1 of 5 curriculum nodes mastered')).toBeVisible();
  await expect(
    page.locator('[data-home-next]').getByRole('heading', { name: 'Even or Odd', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue challenge', exact: true })).toHaveAttribute(
    'href',
    '/app/cohorts/' + f.cohort + '/challenges/even-or-odd',
  );
  const latest = page.getByRole('region', { name: 'Latest submission', exact: true });
  await expect(latest).toBeVisible();
  await expect(latest.getByRole('link', { name: 'View history', exact: true })).toHaveAttribute(
    'href',
    /tab=submissions/,
  );
  await expect(page.getByText('Current Streak', { exact: true })).toHaveCount(0);
  await expect(page.getByText('146h', { exact: true })).toHaveCount(0);
  expect(await page.content()).not.toMatch(
    /test_pack_digest|evaluation_snapshot|runner_image_digest/,
  );
});
test('Home feedback links reveal and focus history at desktop, tablet and mobile widths', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/app');
    const latest = page.getByRole('region', { name: 'Latest submission', exact: true });
    await latest.getByRole('link', { name: 'View history', exact: true }).click();
    const history = page.getByRole('region', { name: 'Submission history', exact: true });
    await expect(history).toBeFocused();
    const heading = history.getByRole('heading', { name: 'Submission history', exact: true });
    await expect(heading).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test('Heart Journey uses published order and locked metadata without exposing restricted subjects', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Piscine · UI review fixture', exact: true }).click();
  await expect(page).toHaveURL('/app/cohorts/' + f.cohort);
  const map = page.getByRole('region', { name: 'Piscine journey map', exact: true });
  await expect(
    map.getByRole('link', { name: /Quest 1: First Steps in Go.*Mastered/ }),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'Journey view' })).toHaveCount(0);
  await map.getByRole('link', { name: /Quest 3: Problem Solving.*Locked/ }).click();
  const details = page.getByRole('complementary', {
    name: 'Selected roadmap details',
    exact: true,
  });
  await expect(
    details.getByRole('heading', { name: 'After checkpoint', exact: true }),
  ).toBeVisible();
  await expect(
    details.getByText('Requires passing all prerequisites: Transfer checkpoint.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('a[href*="challenges/after-checkpoint"]')).toHaveCount(0);
  expect(
    (await page.goto('/app/cohorts/' + f.cohort + '/challenges/after-checkpoint'))?.status(),
  ).toBe(404);
  await expect(page.getByText('Gate test fixture.', { exact: true })).toHaveCount(0);
});
test('keyboard search and filters navigate authorized metadata; dialogs restore usable focus', async ({
  page,
}) => {
  await login(page);
  const search = page.getByRole('dialog', { name: 'Search your journey', exact: true });
  // Establish an interactive shell before testing the global keyboard shortcut.
  await page.getByRole('button', { name: 'Search journey Ctrl K', exact: true }).click();
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).not.toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(search).toBeVisible();
  await expect(search.getByRole('searchbox')).toBeFocused();
  await search.getByRole('searchbox').fill('Even');
  await search.getByRole('link', { name: /Even or Odd/ }).click();
  await expect(page).toHaveURL(new RegExp('node=even-or-odd'));
  await expect(search).not.toBeVisible();
  const details = page.getByRole('complementary', { name: 'Selected roadmap details' });
  await expect(details.getByRole('heading', { name: 'Even or Odd', exact: true })).toBeVisible();
  const map = page.getByRole('region', { name: 'Piscine journey map', exact: true });
  const quest = map.getByRole('link', { name: /Quest 2: Conditions/ });
  await quest.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/quest=control-flow/);
  await page.goBack();
  await expect(details.getByRole('heading', { name: 'Even or Odd', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Search journey Ctrl K', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(search).not.toBeVisible();
});
test('forged role and foreign cohort selection remain denied, with current membership restrictions', async ({
  page,
}) => {
  await login(page);
  expect((await page.goto('/app/cohorts/' + f.foreignCohort + '?role=admin'))?.status()).toBe(404);
  expect((await page.goto('/app?cohort=' + f.foreignCohort + '&role=admin'))?.status()).toBe(404);
  const [user] = await db.unsafe('SELECT id FROM app.users WHERE auth_user_id=$1', [f.authId]);
  await db.unsafe(
    "UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=$1 AND user_id=$2",
    [f.cohort, user!.id],
  );
  try {
    expect((await page.goto('/app/cohorts/' + f.cohort))?.status()).toBe(404);
    await page.goto('/app');
    await expect(
      page.getByText('No active cohorts assigned. Enrollment is controlled by your operator.', {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await db.unsafe(
      "UPDATE app.cohort_memberships SET status='active' WHERE cohort_id=$1 AND user_id=$2",
      [f.cohort, user!.id],
    );
  }
});
test('unassigned learner sees genuine empty states instead of sample metrics', async ({ page }) => {
  await login(page, f.emptyLearner);
  await expect(
    page.getByText('No active cohorts assigned. Enrollment is controlled by your operator.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Piscine progress' })).toHaveCount(0);
  await page.goto('/app/roadmap');
  await expect(page.getByText('No active cohort assigned', { exact: true })).toBeVisible();
});
test('desktop, tablet and mobile preserve a legible heart map and equivalent ordered navigation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page);
  await page.goto('/app/cohorts/' + f.cohort);
  const map = page.getByRole('region', { name: 'Piscine journey map', exact: true });
  await expect(map).toBeVisible();
  await expect(map.locator('svg>polyline')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tools/ui001-review/heart-desktop.png', fullPage: true });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByText('Ordered journey', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Center map', exact: true })).toBeVisible();
    await page.screenshot({ path: '.tools/ui001-review/heart-' + width + '.png', fullPage: true });
  }
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
  await expect(drawer).toBeVisible();
  for (let i = 0; i < 14; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]')))).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
});
test('all dashboard, search, filter and selection reads leave assessment and progression unchanged', async () => {
  expect(await actualFingerprint()).toBe(before);
});
