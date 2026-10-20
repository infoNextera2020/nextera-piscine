import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { test, expect, type Page } from '@playwright/test';
import type { LearningFixture } from '../fixtures/learning';
const f = JSON.parse(readFileSync(process.env.LEARNING_UI_FIXTURE!, 'utf8')) as LearningFixture;
if (!f.assessments) throw new Error('Assessment fixtures required.');
const db = postgres(f.database, { max: 1, prepare: false, onnotice: () => {} });
const base = '/app/cohorts/' + f.cohort;
const cp = base + '/checkpoints/transfer-checkpoint';
let before: string;
async function fingerprint() {
  const rows = await db.unsafe(
    "SELECT jsonb_build_object('progress',(SELECT jsonb_agg(to_jsonb(p) ORDER BY user_id,node_key) FROM app.learner_node_progress p),'submissions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM app.submissions s),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM app.checkpoint_attempts a),'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM app.checkpoint_outcomes o),'events',(SELECT count(*) FROM app.activity_events)) AS data",
  );
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function login(page: Page, scenario?: string) {
  await page.goto('/login');
  await page
    .getByLabel('Email', { exact: true })
    .fill(scenario ? f.assessments![scenario]!.email : f.learner);
  await page.getByLabel('Password', { exact: true }).fill(f.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });
  for (const figure of await page.locator('iframe[title^="Decorative"]').all())
    await expect(figure).toHaveAttribute('data-ready', 'true');
  await page.screenshot({
    path: 'docs/design/review/ui002/' + name + '.png',
    fullPage: true,
    animations: 'disabled',
  });
}
test.beforeAll(async () => {
  before = await fingerprint();
  await mkdir('docs/design/review/ui002', { recursive: true });
});
test.afterAll(async () => {
  await db.end();
});
const browserErrors = new Map<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource'))
      errors.push(message.text());
  });
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test('Challenge preserves all safe verdicts, metadata, five keyboard tabs and responsive layout', async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(base + '/challenges/even-or-odd');
  await expect(
    page.getByRole('heading', { name: 'Even or Odd', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(5);
  await shot(page, 'challenge-desktop');
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Tasks', exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Submission requirements' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('heading', { name: 'Safe submission history' })).toBeVisible();
  for (const state of [
    'failed',
    'compile_error',
    'runtime_error',
    'timeout',
    'system_error',
    'running',
    'queued',
  ])
    await expect(page.locator(`[data-verdict="${state}"]`)).toBeVisible();
  expect(await page.content()).not.toMatch(
    /evaluation_snapshot|test_pack_digest|runner_image_digest/,
  );
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Submissions', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await shot(page, 'challenge-history-desktop');
  for (const [device, width, height] of [
    ['tablet', 1024, 900],
    ['mobile', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await shot(page, 'challenge-' + device);
  }
});
test('Checkpoint renders four trusted tasks and a display-only timer without figure decisions', async ({
  page,
}) => {
  await login(page, 'active');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(cp);
  const nav = page.getByRole('navigation', { name: 'Checkpoint tasks' });
  await expect(nav.getByRole('button')).toHaveCount(4);
  await expect(page.getByLabel('Time remaining')).not.toHaveText('Syncing…');
  await expect(nav.getByRole('button').nth(3)).toContainText('System retry');
  await nav.getByRole('button').nth(3).click();
  await expect(
    page.getByRole('button', { name: 'Submit checkpoint task', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('0 of 3 submission slots used or pending', { exact: true }),
  ).toHaveCount(2);
  await shot(page, 'checkpoint-desktop');
  await page.getByRole('button', { name: 'Finish checkpoint', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Finish checkpoint now?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep working' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Confirm finish' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish checkpoint', exact: true })).toBeFocused();
  for (const [device, width, height] of [
    ['tablet', 1024, 900],
    ['mobile', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await shot(page, 'checkpoint-' + device);
  }
});
test('PASS, LEARNER FAIL and INFRASTRUCTURE BLOCKED use actual stored outcomes and progression', async ({
  page,
}) => {
  for (const [scenario, label] of [
    ['pass', 'PASS'],
    ['fail', 'LEARNER FAIL'],
    ['infra', 'INFRASTRUCTURE BLOCKED'],
  ] as const) {
    await login(page, scenario);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(cp + '/result');
    const region = page.getByRole('region', { name: 'Authoritative checkpoint result' });
    await expect(region.getByText(label, { exact: true })).toBeVisible();
    if (scenario === 'pass')
      await expect(page.getByRole('link', { name: 'After checkpoint', exact: true })).toBeVisible();
    else
      await expect(
        page.getByRole('link', { name: 'Review server-authorized next attempt' }),
      ).toHaveCount(0);
    if (scenario === 'infra') {
      await expect(
        region.getByRole('heading', { name: 'A fair result needs recovery.' }),
      ).toBeVisible();
      await expect(page.getByText(/No replacement grant is shown/)).toBeVisible();
    }
    await shot(page, 'result-' + scenario + '-desktop');
    for (const [device, width, height] of [
      ['tablet', 1024, 900],
      ['mobile', 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await shot(page, 'result-' + scenario + '-' + device);
    }
  }
});
test('Evidence separates stored mastery, checkpoint, learner, unlock and system records', async ({
  page,
}) => {
  await login(page, 'infra');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(base + '/evidence');
  const filter = page.getByRole('combobox');
  for (const value of ['mastery', 'checkpoint', 'learner', 'unlock', 'system']) {
    await filter.selectOption(value);
    const records = page.locator('[data-category]');
    expect(await records.count()).toBeGreaterThan(0);
    for (const el of await records.all()) await expect(el).toHaveAttribute('data-category', value);
  }
  await filter.selectOption('all');
  await shot(page, 'evidence-desktop');
  for (const [device, width, height] of [
    ['tablet', 1024, 900],
    ['mobile', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await shot(page, 'evidence-' + device);
  }
  expect(await page.content()).not.toMatch(
    /evaluation_snapshot|test_pack_digest|runner_image_digest/,
  );
});
test('Gate, pending result and empty evidence are honest; foreign and locked routes remain denied', async ({
  page,
}) => {
  await login(page, 'ready');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(cp);
  await expect(page.getByRole('button', { name: 'Start checkpoint', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Checkpoint tasks' })).toHaveCount(0);
  await shot(page, 'checkpoint-gate-desktop');
  await page.goto(cp + '/result');
  await expect(page.getByRole('heading', { name: 'No checkpoint result yet' })).toBeVisible();
  await page.goto(base + '/evidence?filter=system');
  await expect(page.getByRole('heading', { name: 'No records in this category' })).toBeVisible();
  expect((await page.goto('/app/cohorts/' + f.foreignCohort + '/evidence'))?.status()).toBe(404);
  expect(
    (
      await page.goto('/app/cohorts/' + f.foreignCohort + '/checkpoints/transfer-checkpoint/result')
    )?.status(),
  ).toBe(404);
  await login(page);
  expect((await page.goto(base + '/challenges/after-checkpoint'))?.status()).toBe(404);
  expect(
    (await page.goto(cp + '/result?attempt=00000000-0000-0000-0000-000000000000'))?.status(),
  ).toBe(404);
});
test('read errors retain safe UI and pause checkpoint actions; browser time cannot finalize', async ({
  page,
}) => {
  await login(page, 'active');
  await page.goto(cp);
  await page.route('**/api/checkpoints?*', (route) => route.fulfill({ status: 403 }));
  await expect(page.getByText(/Checkpoint could not be refreshed/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Finish checkpoint', exact: true })).toBeDisabled();
  await page.unroute('**/api/checkpoints?*');
  await page.getByRole('button', { name: 'Retry checkpoint read' }).click();
  await expect(page.getByRole('button', { name: 'Finish checkpoint', exact: true })).toBeEnabled();
  await page.clock.setSystemTime(new Date('2099-01-01T00:00:00Z'));
  await expect(page.getByLabel('Time remaining')).not.toHaveText('0:00');
  await page.goto(cp + '/result');
  await expect(
    page.getByRole('heading', { name: 'The result is still being evaluated' }),
  ).toBeVisible();
});
test('navigation and figures never mutate assessment or progression records', async () => {
  expect(await fingerprint()).toBe(before);
});
test('submission forms validate local files and await receipts without inventing a verdict', async ({
  page,
}) => {
  await login(page);
  await page.goto(base + '/challenges/even-or-odd');
  const input = page.getByLabel(/Solution file/);
  const expected = (await input.getAttribute('accept')) ?? '.go';
  expect(expected).toBe('.go');
  const label = await input.evaluate((el) => el.closest('label')?.textContent ?? '');
  const filename = /Solution file \(([^)]+)\)/.exec(label)![1]!;
  await input.setInputFiles({
    name: 'wrong.go',
    mimeType: 'text/plain',
    buffer: Buffer.from('package main'),
  });
  await page.getByRole('button', { name: 'Submit solution', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Submission', exact: true }).getByRole('alert'),
  ).toContainText('Choose ' + filename);
  await input.setInputFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from('package main'),
  });
  let calls = 0;
  await page.route('**/api/submissions', (route) => {
    calls++;
    expect(route.request().headers()['x-node-key']).toBe('even-or-odd');
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000001' }),
    });
  });
  await page.getByRole('button', { name: 'Submit solution', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'Submission accepted. Evaluation is pending.',
  );
  expect(calls).toBe(1);
  await expect(page.getByRole('tab', { name: 'Submissions', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
test('current membership revocation denies each new protected surface', async ({ page }) => {
  await login(page, 'infra');
  const authId = f.assessments!.infra!.authId;
  await db.unsafe(
    "UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=$1 AND user_id=(SELECT id FROM app.users WHERE auth_user_id=$2)",
    [f.cohort, authId],
  );
  try {
    for (const path of [base + '/challenges/even-or-odd', cp, cp + '/result', base + '/evidence'])
      expect((await page.goto(path))?.status()).toBe(404);
    expect(
      (
        await page.request.get('/api/checkpoints?cohort=' + f.cohort + '&node=transfer-checkpoint')
      ).status(),
    ).toBe(403);
  } finally {
    await db.unsafe(
      "UPDATE app.cohort_memberships SET status='active' WHERE cohort_id=$1 AND user_id=(SELECT id FROM app.users WHERE auth_user_id=$2)",
      [f.cohort, authId],
    );
  }
});
test('early finish requires explicit confirmation and closes trusted intake irreversibly', async ({
  page,
}) => {
  await login(page, 'active');
  await page.goto(cp);
  await page.getByRole('button', { name: 'Finish checkpoint', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm finish', exact: true }).click();
  await expect(page.getByText('evaluating', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Submit checkpoint task', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Finish checkpoint', exact: true })).toHaveCount(0);
});
