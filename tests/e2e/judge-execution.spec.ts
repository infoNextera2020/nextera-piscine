/** Protected-host integration only. Metadata points to actual local OCI layouts,
 * never a registry placeholder or an approved publication catalog. */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { test, expect, type Page } from '@playwright/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { testCurriculum } from '../fixtures/curriculum';
import { evaluationDigest } from '../../scripts/curriculum/digest';
import { parseCurriculum } from '../../scripts/curriculum/load';
import { importCurriculum } from '../../packages/db/operations/curriculum';
import { createCohort, enrollLearner } from '../../packages/db/operations/cohorts';
import * as schema from '../../packages/db/schema/index';

if (process.env.NEXTERA_JUDGE_E2E !== '1') throw new Error('Protected host opt-in required.');
const artifacts = resolve(process.env.JUDGE_ARTIFACTS!);
const credentials = resolve(process.env.JUDGE_CREDENTIALS!);
const binary = resolve(process.env.JUDGE_RUNNER_BINARY!);
const candidate = JSON.parse(readFileSync(join(artifacts, 'candidate.json'), 'utf8')) as {
  status: string;
  catalog: { test_packs: Record<string, Record<string, unknown>> };
};
const worker = JSON.parse(readFileSync(join(credentials, 'worker.json'), 'utf8')) as {
  worker_id: string;
  principal: string;
  runner_image_digest: string;
  token_file: string;
};
const runnerEnv = parse(readFileSync(join(credentials, 'runner.env')));
const admin = postgres(process.env.JUDGE_TEST_DATABASE_URL!, {
  max: 4,
  prepare: false,
  onnotice: () => {},
});
const db = drizzle(admin, { schema });
const auth = createClient(
  process.env.SUPABASE_LOCAL_URL!,
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const password = randomBytes(24).toString('hex');
const people: { authId: string; userId: string; email: string }[] = [];
const cohorts: string[] = [];
let learner: (typeof people)[number];
let helloCohort: string, evenCohort: string;
let initialProgress: string;
const verdicts = JSON.parse(
  execFileSync(
    'python3',
    [
      '-c',
      "import sys,json;sys.path.insert(0,'infra/runner');from sandbox_test import fixtures;print(json.dumps({p:fixtures(p) for p in ['hello-go-v1','even-or-odd-v1']}))",
    ],
    { encoding: 'utf8' },
  ),
) as Record<string, Record<string, [string, string]>>;
const sha = (source: string | Buffer) => createHash('sha256').update(source).digest('hex');

test.beforeAll(async () => {
  if (candidate.status !== 'CANDIDATE') throw new Error('Expected unapproved candidate.');
  const target = new URL(process.env.JUDGE_TEST_DATABASE_URL!);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.startsWith('/foundation_test')
  )
    throw new Error('Disposable fixture database required.');
  for (const evenRoot of [false, true]) {
    const fixture = testCurriculum();
    if (evenRoot)
      fixture.curriculum = parseCurriculum(
        fixture.files.map((file) =>
          file.path.endsWith('/manifest.yaml')
            ? {
                ...file,
                bytes: Buffer.from(
                  Buffer.from(file.bytes)
                    .toString()
                    .replace(/edges:[\s\S]*$/, 'edges: []\n'),
                ),
              }
            : file,
        ),
      ); // Separate exact-byte root fixture; no progression/unlock writes.
    const evaluations = fixture.curriculum.nodes.map((node) => {
      const entry = candidate.catalog.test_packs[node.testPackId]!;
      const spec = {
        ...entry,
        test_only: true,
        curriculum_key: fixture.curriculum.key,
        curriculum_version: fixture.curriculum.version,
        content_digest: fixture.curriculum.contentDigest,
        node_key: node.key,
        subject_digest: node.subjectDigest,
        configuration_digest: node.configurationDigest,
        test_pack_id: node.testPackId,
        test_pack_artifact: `oci://${join(artifacts, node.testPackId)}@sha256:${entry.test_pack_digest}`,
      };
      return { nodeKey: node.key, spec, digest: evaluationDigest(spec) };
    });
    const version = await importCurriculum(
      db,
      fixture.curriculum,
      fixture.gitCommitSha,
      evaluations,
    );
    const cohort = await createCohort(db, {
      slug: `foundation-test-004-${randomUUID()}`,
      name: evenRoot ? '004 EVEN ROOT FIXTURE' : '004 HELLO FIXTURE',
      curriculumVersionId: version.id,
      startsAt: new Date(),
    });
    cohorts.push(cohort.id);
  }
  [helloCohort, evenCohort] = cohorts as [string, string];
  await admin`UPDATE judge.workers SET capabilities=capabilities||${JSON.stringify({ fixture_cohort_ids: cohorts })}::jsonb WHERE id=${worker.worker_id}`;
  for (const suffix of ['learner', 'foreign']) {
    const email = `foundation004-${suffix}-${randomBytes(6).toString('hex')}@example.test`;
    const { data, error } = await auth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error('Local Auth fixture unavailable.');
    await admin`INSERT INTO auth.users(id) VALUES(${data.user.id})`;
    const [user] =
      await admin`INSERT INTO app.users(auth_user_id,display_name) VALUES(${data.user.id},'ISOLATED 004') RETURNING id`;
    people.push({ authId: data.user.id, userId: String(user!.id), email });
  }
  learner = people[0]!;
  for (const id of cohorts) await enrollLearner(db, id, learner.userId);
  initialProgress = JSON.stringify(
    await admin`SELECT * FROM app.learner_node_progress WHERE user_id=${learner.userId} ORDER BY cohort_id,node_key`,
  );
});
test.afterAll(async () => {
  try {
    for (const person of people) {
      await admin`UPDATE app.users SET active=false WHERE id=${person.userId}`;
      await admin`UPDATE app.cohort_memberships SET status='inactive' WHERE user_id=${person.userId}`;
      const { error } = await auth.auth.admin.updateUserById(person.authId, {
        ban_duration: '876000h',
      });
      if (error) throw new Error('Unable to disable retained local Auth fixture.');
    }
    await admin`UPDATE judge.workers SET enabled=false WHERE id=${worker.worker_id}`;
    if (/^nextera_worker_[0-9a-f]+$/.test(worker.principal))
      await admin.unsafe(`ALTER ROLE ${worker.principal} NOLOGIN`);
    const runtime = JSON.parse(readFileSync(join(credentials, 'runtime.json'), 'utf8')) as Record<
      string,
      string
    >;
    for (const principal of Object.values(runtime))
      if (/^f004_(web|maintenance)_[0-9a-f]+$/.test(principal))
        await admin.unsafe(`ALTER ROLE ${principal} NOLOGIN`);
    // Assessment history and source objects remain retained in isolated development storage.
  } finally {
    await admin.end();
  }
});
async function login(page: Page, person = learner) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}
async function queued(page: Page, pack: string, source: string) {
  const cohort = pack === 'hello-go-v1' ? helloCohort : evenCohort;
  const node = pack === 'hello-go-v1' ? 'hello-go' : 'even-or-odd';
  const filename = pack === 'hello-go-v1' ? 'hello.go' : 'even_or_odd.go';
  await page.goto(`/app/cohorts/${cohort}/challenges/${node}`);
  await page.getByLabel(`Solution file (${filename})`).setInputFiles({
    name: filename,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(source),
  });
  const sent = page.waitForRequest(
    (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/submissions',
  );
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/submissions',
  );
  await page.getByRole('button', { name: 'Submit solution', exact: true }).click();
  const request = await sent;
  const accepted = await response;
  expect(accepted.status()).toBe(202);
  const body = (await accepted.json()) as { id: string };
  const [row] =
    await admin`SELECT s.id,s.state,s.artifact_id,j.id AS job_id,j.evaluation_snapshot FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id WHERE s.id=${body.id}`;
  expect(row!.state).toBe('queued');
  expect(row!.evaluation_snapshot.artifact.sha256).toBe(sha(source));
  return { id: body.id, job: String(row!.job_id), request, cohort, node, filename };
}
function runWorker(candidatePath = join(artifacts, 'candidate.json'), killAfterClaim = false) {
  let log = '';
  let killed = false;
  const child = spawn(
    binary,
    [
      'work',
      '--candidate',
      candidatePath,
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
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (data: Buffer) => {
    log += data.toString();
    if (log.length > 65536) {
      child.kill('SIGTERM');
      return;
    }
    if (killAfterClaim && !killed && log.includes('"event":"job_claimed"')) {
      killed = true;
      child.kill('SIGKILL');
    }
  });
  let stderr = '';
  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
    if (stderr.length > 4096) child.kill('SIGTERM');
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.on('exit', (code, signal) => resolve({ code, signal })),
  );
  return { child, exited, logs: () => log, errors: () => stderr };
}
async function execute(
  page: Page,
  pack: string,
  source: string,
  expected: string,
  catalogPath?: string,
) {
  const accepted = await queued(page, pack, source);
  const running = runWorker(catalogPath);
  try {
    let received: string | null = null;
    await expect
      .poll(
        async () => {
          const [row] =
            await admin`SELECT r.verdict FROM judge.jobs j LEFT JOIN judge.results r ON r.id=j.terminal_result_id WHERE j.id=${accepted.job}`;
          received = (row?.verdict as string | undefined) ?? null;
          return received;
        },
        { timeout: 120000, intervals: [250, 500, 1000] },
      )
      .not.toBeNull();
    expect(received).toBe(expected);
    await expect(page.getByText(expected.toUpperCase(), { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    await page.reload();
    await expect(page.getByText(expected.toUpperCase(), { exact: true }).first()).toBeVisible();
    const [result] =
      await admin`SELECT r.application_status,r.learner_feedback,r.safe_operator_diagnostics FROM judge.jobs j JOIN judge.results r ON r.id=j.terminal_result_id WHERE j.id=${accepted.job}`;
    expect(result!.application_status).toBe('pending');
    expect(Object.keys(result!.learner_feedback).sort()).toEqual(['message', 'verdict']);
    expect(
      JSON.stringify(
        await admin`SELECT * FROM app.learner_node_progress WHERE user_id=${learner.userId} ORDER BY cohort_id,node_key`,
      ),
    ).toBe(initialProgress);
    return accepted;
  } finally {
    running.child.kill('SIGTERM');
    await running.exited;
    expect(running.errors()).toBe('');
    for (const line of running.logs().trim().split('\n').filter(Boolean)) {
      const event = JSON.parse(line) as Record<string, unknown>;
      expect(
        Object.keys(event).every((k) =>
          ['event', 'job_id', 'attempt_id', 'evaluation_digest', 'verdict'].includes(k),
        ),
      ).toBe(true);
    }
  }
}
test('real browser upload, duplicate request, private immutable object, durable result, refresh', async ({
  page,
}) => {
  await login(page);
  const source = verdicts['hello-go-v1']!.correct![0];
  const accepted = await execute(page, 'hello-go-v1', source, 'passed');
  const duplicate = await page.request.post('/api/submissions', {
    data: Buffer.from(source),
    headers: {
      origin: 'http://127.0.0.1:3100',
      'x-cohort-id': accepted.cohort,
      'x-node-key': accepted.node,
      'x-filename': accepted.filename,
      'idempotency-key': accepted.request.headers()['idempotency-key']!,
    },
  });
  expect(duplicate.status()).toBe(202);
  expect(((await duplicate.json()) as { id: string }).id).toBe(accepted.id);
  const [artifact] =
    await admin`SELECT a.storage_key FROM app.submission_artifacts a JOIN app.submissions s ON s.artifact_id=a.id WHERE s.id=${accepted.id}`;
  const userClient = createClient(
    process.env.SUPABASE_LOCAL_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  expect(
    (await userClient.auth.signInWithPassword({ email: learner.email, password })).error,
  ).toBeNull();
  const bucket = userClient.storage.from('nextera-submissions');
  expect(
    (
      await bucket.upload(String(artifact!.storage_key), Buffer.from('changed'), {
        upsert: true,
        contentType: 'application/octet-stream',
      })
    ).error,
  ).toBeTruthy();
  const downloaded = await bucket.download(String(artifact!.storage_key));
  expect(downloaded.error).toBeNull();
  expect(sha(Buffer.from(await downloaded.data!.arrayBuffer()))).toBe(sha(source));
  await userClient.auth.signInWithPassword({ email: people[1]!.email, password });
  expect((await bucket.download(String(artifact!.storage_key))).error).toBeTruthy();
  const conflict = await page.request.post('/api/submissions', {
    data: Buffer.from('changed'),
    headers: {
      origin: 'http://127.0.0.1:3100',
      'x-cohort-id': accepted.cohort,
      'x-node-key': accepted.node,
      'x-filename': accepted.filename,
      'idempotency-key': accepted.request.headers()['idempotency-key']!,
    },
  });
  expect(conflict.status()).toBe(409);
  expect(await admin`SELECT id FROM app.submissions WHERE id=${accepted.id}`).toHaveLength(1);
});
test('locked, cross-cohort, unauthenticated and cross-origin intake are denied', async ({
  page,
  request,
}) => {
  const headers = {
    origin: 'http://127.0.0.1:3100',
    'x-cohort-id': helloCohort,
    'x-node-key': 'even-or-odd',
    'x-filename': 'even_or_odd.go',
    'idempotency-key': randomUUID(),
  };
  expect(
    (await request.post('/api/submissions', { headers, data: Buffer.from('public') })).status(),
  ).toBe(401);
  await login(page);
  expect(
    (
      await page.request.post('/api/submissions', { headers, data: Buffer.from('public') })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post('/api/submissions', {
        headers: { ...headers, 'x-cohort-id': randomUUID() },
        data: Buffer.from('public'),
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post('/api/submissions', {
        headers: { ...headers, origin: 'https://untrusted.invalid' },
        data: Buffer.from('public'),
      })
    ).status(),
  ).toBe(403);
});
for (const pack of ['hello-go-v1', 'even-or-odd-v1'])
  for (const [name, [source, expected]] of Object.entries(verdicts[pack]!)) {
    if (pack === 'hello-go-v1' && name === 'correct') continue;
    test(`Go Runner ${pack} / ${name} produces ${expected} with no progression writes`, async ({
      page,
    }) => {
      await login(page);
      await execute(page, pack, source, expected);
    });
  }
test('a changed candidate is system_error with three durable attempts and no learner failure', async ({
  page,
}) => {
  const bad = structuredClone(candidate);
  bad.catalog.test_packs['hello-go-v1']!.test_pack_digest = '0'.repeat(64);
  const directory = join(credentials, 'negative-catalog');
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const path = join(directory, 'candidate.json');
  writeFileSync(path, JSON.stringify(bad), { mode: 0o600 });
  await login(page);
  const accepted = await execute(
    page,
    'hello-go-v1',
    'package main\nfunc Hello(name string) string {return "unique negative fixture"}',
    'system_error',
    path,
  );
  expect(await admin`SELECT id FROM judge.attempts WHERE job_id=${accepted.job}`).toHaveLength(3);
});
test('killed Runner claim expires, maintenance recovers it, and a new fenced attempt completes', async ({
  page,
}) => {
  await login(page);
  const accepted = await queued(
    page,
    'hello-go-v1',
    'package main\nfunc Hello(name string) string {return "Hello, "+name+"!"} // crash fixture',
  );
  const dying = runWorker(undefined, true);
  const death = await dying.exited;
  expect(death.signal).toBe('SIGKILL');
  const [before] =
    await admin`SELECT current_attempt_id,state FROM judge.jobs WHERE id=${accepted.job}`;
  expect(['claimed', 'running']).toContain(before!.state);
  await admin`UPDATE judge.jobs SET lease_expires_at=clock_timestamp()-interval '1 millisecond' WHERE id=${accepted.job}`;
  // Independent product-maintenance process with its own restricted login.
  const maintenance = parse(readFileSync(join(credentials, 'maintenance.env')));
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/judge-maintenance.ts', '--once'], {
    env: { PATH: process.env.PATH!, ...maintenance },
    stdio: 'pipe',
    timeout: 30000,
  });
  const recovered = runWorker();
  try {
    await expect
      .poll(
        async () =>
          String((await admin`SELECT state FROM judge.jobs WHERE id=${accepted.job}`)[0]!.state),
        { timeout: 90000 },
      )
      .toBe('completed');
    const attempts =
      await admin`SELECT id,state FROM judge.attempts WHERE job_id=${accepted.job} ORDER BY attempt_number`;
    expect(attempts.map((x) => x.state)).toEqual(['system_error', 'completed']);
    expect(attempts[0]!.id).toBe(before!.current_attempt_id);
    const results =
      await admin`SELECT application_status FROM judge.results WHERE job_id=${accepted.job}`;
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.application_status === 'pending')).toBe(true);
    expect(
      JSON.stringify(
        await admin`SELECT * FROM app.learner_node_progress WHERE user_id=${learner.userId} ORDER BY cohort_id,node_key`,
      ),
    ).toBe(initialProgress);
  } finally {
    recovered.child.kill('SIGTERM');
    await recovered.exited;
  }
});
