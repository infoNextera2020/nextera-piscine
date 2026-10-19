/** Protected host only: real Auth, immutable Storage, PostgreSQL and sandboxed Judge. */
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { checkpointFixture, checkpointTasks } from '../fixtures/checkpoints';
import { importCurriculum } from '../../packages/db/operations/curriculum';
import { createCohort, enrollLearner } from '../../packages/db/operations/cohorts';
import { applyResult } from '../../packages/db/operations/results';
import { reconcileCheckpoints } from '../../packages/db/operations/checkpoints';
import * as schema from '../../packages/db/schema/index';
if (process.env.NEXTERA_JUDGE_E2E !== '1' || process.env.JUDGE_CHECKPOINT_E2E !== '1')
  throw new Error('Protected host opt-in required');
const artifacts = resolve(process.env.JUDGE_ARTIFACTS!);
const credentials = resolve(process.env.JUDGE_CREDENTIALS!);
const binary = resolve(process.env.JUDGE_RUNNER_BINARY!);
const candidate = JSON.parse(readFileSync(join(artifacts, 'candidate.json'), 'utf8'));
const worker = JSON.parse(readFileSync(join(credentials, 'worker.json'), 'utf8'));
const runnerEnv = parse(readFileSync(join(credentials, 'runner.env')));
const applicationEnv = parse(readFileSync(join(credentials, 'application.env')));
const admin = postgres(process.env.JUDGE_TEST_DATABASE_URL!, {
  max: 4,
  prepare: false,
  onnotice: () => {},
});
const product = postgres(applicationEnv.RESULT_APPLICATION_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const auth = createClient(
  process.env.SUPABASE_LOCAL_URL!,
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const fixture = checkpointFixture({ packs: candidate.catalog.test_packs, artifacts });
const password = randomBytes(24).toString('hex');
let version: string;
let person: { auth: string; user: string; email: string };
const cohorts: string[] = [];
const solutions = [
  'package main\nimport "strings"\nfunc NormalizeLabel(v string) string{return strings.ToLower(strings.TrimSpace(v))}',
  'package main\nimport("strings";"strconv")\nfunc CountVowels(v string) string{n:=0;for _,c:=range strings.ToLower(v){if strings.ContainsRune("aeiou",c){n++}};return strconv.Itoa(n)}',
  'package main\nimport "strconv"\nfunc DigitSum(v int64) string{var n uint64;if v<0{n=uint64(-(v+1))+1}else{n=uint64(v)};s:=0;for n>0{s+=int(n%10);n/=10};return strconv.Itoa(s)}',
  'package main\nfunc SignLabel(v int64) string{if v<0{return "negative"};if v>0{return "positive"};return "zero"}',
];
test.beforeAll(async () => {
  const target = new URL(process.env.JUDGE_TEST_DATABASE_URL!);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.startsWith('/foundation_test') ||
    candidate.status !== 'CANDIDATE'
  )
    throw new Error('Disposable candidate fixture required');
  version = (
    await importCurriculum(
      drizzle(admin, { schema }),
      fixture.curriculum,
      fixture.gitCommitSha,
      fixture.evaluations,
    )
  ).id;
  const email = `checkpoint-${randomBytes(8).toString('hex')}@example.test`;
  const { data, error } = await auth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error('Auth fixture unavailable');
  await admin`INSERT INTO auth.users VALUES(${data.user.id})`;
  const user = String(
    (
      await admin`INSERT INTO app.users(auth_user_id,display_name) VALUES(${data.user.id},'CHECKPOINT FIXTURE') RETURNING id`
    )[0]!.id,
  );
  person = { auth: data.user.id, user, email };
});
test.afterAll(async () => {
  try {
    if (person) {
      await admin`UPDATE app.users SET active=false WHERE id=${person.user}`;
      await admin`UPDATE app.cohort_memberships SET status='inactive' WHERE user_id=${person.user}`;
      const result = await auth.auth.admin.updateUserById(person.auth, { ban_duration: '876000h' });
      if (result.error) throw new Error('Fixture disable failed');
    }
    await admin`UPDATE judge.workers SET enabled=false WHERE id=${worker.worker_id}`;
    if (/^nextera_worker_[0-9a-f]+$/.test(worker.principal))
      await admin.unsafe(`ALTER ROLE ${worker.principal} NOLOGIN`);
    const runtime = JSON.parse(readFileSync(join(credentials, 'runtime.json'), 'utf8')) as Record<
      string,
      string
    >;
    for (const p of Object.values(runtime))
      if (/^f00[45]_(web|maintenance|application)_[0-9a-f]+$/.test(p))
        await admin.unsafe(`ALTER ROLE ${p} NOLOGIN`);
  } finally {
    await product.end();
    await admin.end();
  }
});
async function setup(page: Page) {
  const cohort = (
    await createCohort(drizzle(admin, { schema }), {
      slug: `foundation-test-cp-${randomUUID()}`,
      name: 'CHECKPOINT FIXTURE',
      curriculumVersionId: version,
      startsAt: new Date(),
    })
  ).id;
  cohorts.push(cohort);
  await enrollLearner(drizzle(admin, { schema }), cohort, person.user);
  await admin`UPDATE judge.workers SET capabilities=capabilities||${JSON.stringify({ fixture_cohort_ids: cohorts })}::jsonb WHERE id=${worker.worker_id}`;
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(`/app/cohorts/${cohort}/checkpoints/transfer-checkpoint`);
  return cohort;
}
async function start(page: Page) {
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/checkpoints',
  );
  await page.getByRole('button', { name: 'Start checkpoint', exact: true }).click();
  expect((await response).status()).toBe(202);
  await expect(
    page.getByRole('navigation', { name: 'Checkpoint tasks' }).getByRole('button'),
  ).toHaveCount(4);
}
function run(catalogPath = join(artifacts, 'candidate.json')) {
  const child = spawn(
    binary,
    [
      'work',
      '--candidate',
      catalogPath,
      '--layouts',
      artifacts,
      '--runner-image',
      worker.runner_image_digest,
      '--storage-url',
      process.env.SUPABASE_LOCAL_URL!,
      '--storage-token-file',
      worker.token_file,
      '--local-fixtures',
    ],
    {
      env: { PATH: process.env.PATH!, DOCKER_HOST: process.env.DOCKER_HOST ?? '', ...runnerEnv },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  const exit = new Promise<void>((done) => child.on('exit', () => done()));
  return { child, exit };
}
async function submit(page: Page, index: number, source = solutions[index]!, verdict = 'passed') {
  const t = checkpointTasks[index]!;
  await page
    .getByRole('navigation', { name: 'Checkpoint tasks' })
    .getByRole('button')
    .nth(index)
    .click();
  await page.getByLabel(`Solution file (${t.file})`).setInputFiles({
    name: t.file,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(source),
  });
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === '/api/checkpoints/submissions',
  );
  await page.getByRole('button', { name: 'Submit checkpoint task', exact: true }).click();
  const accepted = await response;
  expect(accepted.status()).toBe(202);
  const { id } = (await accepted.json()) as { id: string };
  let result: string | null = null;
  await expect
    .poll(
      async () => {
        const [row] =
          await admin`SELECT r.id,r.verdict FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id LEFT JOIN judge.results r ON r.id=j.terminal_result_id WHERE s.id=${id}`;
        result = row?.id as string | null;
        return row?.verdict ?? null;
      },
      { timeout: 120000, intervals: [250, 500, 1000] },
    )
    .toBe(verdict);
  await applyResult(drizzle(product), result!);
  await expect(page.locator('article li').filter({ hasText: verdict }).first()).toBeVisible();
  return id;
}
async function close(page: Page) {
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Finish checkpoint', exact: true }).click();
  await expect(page.getByText('evaluating', { exact: true })).toBeVisible();
  await reconcileCheckpoints(drizzle(product));
}
test('four private checkpoint evaluations pass, master once, unlock gate and retain immutable audit chain', async ({
  page,
}) => {
  const cohort = await setup(page);
  await start(page);
  const proc = run();
  try {
    for (let i = 0; i < 4; i++) await submit(page, i);
    await close(page);
    await expect(page.getByText('passed', { exact: true })).toBeVisible();
    await expect(page.getByText('normal attempt 1: passed · 4/4', { exact: true })).toBeVisible();
    const [p] =
      await admin`SELECT * FROM app.learner_node_progress WHERE cohort_id=${cohort} AND node_key='transfer-checkpoint'`;
    expect(p!.first_passing_checkpoint_outcome_id).toBeTruthy();
    expect(p!.first_passing_submission_id).toBeNull();
    expect(
      (
        await admin`SELECT state FROM app.learner_node_progress WHERE cohort_id=${cohort} AND node_key='after-checkpoint'`
      )[0]!.state,
    ).toBe('available');
    const chain =
      await admin`SELECT s.checkpoint_task_key,j.evaluation_snapshot,r.application_status FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id JOIN judge.results r ON r.id=j.terminal_result_id WHERE s.cohort_id=${cohort}`;
    expect(chain).toHaveLength(4);
    expect(
      chain.every(
        (r) =>
          r.application_status === 'applied' &&
          r.evaluation_snapshot.execution_contract.item_key === r.checkpoint_task_key,
      ),
    ).toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Start next checkpoint attempt' })).toHaveCount(
      0,
    );
  } finally {
    proc.child.kill('SIGTERM');
    await proc.exit;
  }
});
test('three passes plus learner failure pass at three points', async ({ page }) => {
  await setup(page);
  await start(page);
  const proc = run();
  try {
    for (let i = 0; i < 4; i++)
      await submit(
        page,
        i,
        i === 3 ? 'package main\nfunc SignLabel(v int64) string{return "wrong"}' : solutions[i],
        i === 3 ? 'failed' : 'passed',
      );
    await close(page);
    await expect(page.getByText('normal attempt 1: passed · 3/4', { exact: true })).toBeVisible();
  } finally {
    proc.child.kill('SIGTERM');
    await proc.exit;
  }
});
test('two passes and two failures preserve gate and cooldown', async ({ page }) => {
  const cohort = await setup(page);
  await start(page);
  const proc = run();
  try {
    for (let i = 0; i < 4; i++)
      await submit(
        page,
        i,
        i >= 2
          ? `package main\nfunc ${checkpointTasks[i]!.fn}(v int64) string{return "wrong"}`
          : solutions[i],
        i >= 2 ? 'failed' : 'passed',
      );
    await close(page);
    await expect(page.getByText('normal attempt 1: failed · 2/4', { exact: true })).toBeVisible();
    expect(
      (
        await admin`SELECT state FROM app.learner_node_progress WHERE cohort_id=${cohort} AND node_key='after-checkpoint'`
      )[0]!.state,
    ).toBe('locked');
    await expect(page.getByRole('button', { name: 'Start next checkpoint attempt' })).toHaveCount(
      0,
    );
  } finally {
    proc.child.kill('SIGTERM');
    await proc.exit;
  }
});
test('refresh, closed browser page and browser clock changes preserve server deadline', async ({
  page,
  context,
}) => {
  const cohort = await setup(page);
  await start(page);
  const [before] =
    await admin`SELECT id,started_at,deadline_at FROM app.checkpoint_attempts WHERE cohort_id=${cohort}`;
  await page.clock.install();
  await page.clock.setFixedTime(new Date('2099-01-01T00:00:00Z'));
  await page.reload();
  await expect(page.getByLabel('Time remaining')).not.toHaveText('0:00');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(`/app/cohorts/${cohort}/checkpoints/transfer-checkpoint`);
  await expect(reopened.getByRole('navigation', { name: 'Checkpoint tasks' })).toBeVisible();
  expect(
    (
      await admin`SELECT id,started_at,deadline_at FROM app.checkpoint_attempts WHERE cohort_id=${cohort}`
    )[0],
  ).toEqual(before);
  const denied = await context.request.post('/api/checkpoints', {
    headers: {
      origin: 'http://127.0.0.1:3100',
      'x-action': 'start',
      'x-cohort-id': cohort,
      'x-node-key': 'transfer-checkpoint',
      'idempotency-key': randomUUID(),
    },
    data: { score: 4, deadline: '2099-01-01' },
  });
  expect(denied.status()).toBe(400);
});
test('finish is confirmed and irreversible; unanswered tasks score zero without an open page', async ({
  page,
}) => {
  const cohort = await setup(page);
  await start(page);
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Finish checkpoint' }).click();
  await expect(page.getByRole('button', { name: 'Finish checkpoint' })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  const finished = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/checkpoints',
  );
  await page.getByRole('button', { name: 'Finish checkpoint' }).click();
  expect((await finished).status()).toBe(202);
  await page.close();
  await reconcileCheckpoints(drizzle(product));
  expect(
    (await admin`SELECT status,points FROM app.checkpoint_outcomes WHERE cohort_id=${cohort}`)[0],
  ).toMatchObject({ status: 'failed', points: 0 });
});

for (const [label, source, verdict] of [
  [
    'compile',
    'package main\nfunc NormalizeLabel(v string) string { syntax error }',
    'compile_error',
  ],
  [
    'runtime',
    'package main\nfunc NormalizeLabel(v string) string { panic("untrusted learner output") }',
    'runtime_error',
  ],
  ['timeout', 'package main\nfunc NormalizeLabel(v string) string { for {} }', 'timeout'],
] as const) {
  test(`checkpoint ${label} remains a distinct safe learner outcome`, async ({ page }) => {
    const cohort = await setup(page);
    await start(page);
    const proc = run();
    try {
      const id = await submit(page, 0, source, verdict);
      const [r] =
        await admin`SELECT r.learner_feedback FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id JOIN judge.results r ON r.id=j.terminal_result_id WHERE s.id=${id}`;
      expect(Object.keys(r!.learner_feedback).sort()).toEqual(['message', 'verdict']);
      expect(JSON.stringify(r!.learner_feedback)).not.toContain('untrusted learner output');
      await close(page);
      expect(
        (
          await admin`SELECT status,points FROM app.checkpoint_outcomes WHERE cohort_id=${cohort}`
        )[0],
      ).toMatchObject({ status: 'failed', points: 0 });
    } finally {
      proc.child.kill('SIGTERM');
      await proc.exit;
    }
  });
}
test('checkpoint pack unavailability retries boundedly and blocks a threshold-relevant outcome', async ({
  page,
}) => {
  const cohort = await setup(page);
  await start(page);
  const first = run();
  try {
    await submit(page, 0);
    await submit(page, 1);
  } finally {
    first.child.kill('SIGTERM');
    await first.exit;
  }
  const missing = structuredClone(candidate);
  delete missing.catalog.test_packs['checkpoint-digit-sum-v1'];
  const path = join(credentials, 'missing-checkpoint-pack.json');
  writeFileSync(path, JSON.stringify(missing), { mode: 0o600, flag: 'wx' });
  const proc = run(path);
  try {
    await submit(page, 2, solutions[2], 'system_error');
    await close(page);
    await expect(page.getByText('infrastructure_blocked', { exact: true })).toBeVisible();
    const [j] =
      await admin`SELECT j.retry_count FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id WHERE s.cohort_id=${cohort} AND s.checkpoint_task_key='digit-sum'`;
    expect(j!.retry_count).toBe(2);
    expect(
      (
        await admin`SELECT state FROM app.learner_node_progress WHERE cohort_id=${cohort} AND node_key='after-checkpoint'`
      )[0]!.state,
    ).toBe('locked');
  } finally {
    proc.child.kill('SIGTERM');
    await proc.exit;
  }
});
