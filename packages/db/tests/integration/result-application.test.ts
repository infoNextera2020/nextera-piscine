import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createServer, createConnection, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { testCurriculum } from '../../../../tests/fixtures/curriculum';
import { evaluationDigest } from '../../../../scripts/curriculum/digest';
import { parseCurriculum } from '../../../../scripts/curriculum/load';
import { importCurriculum } from '../../operations/curriculum';
import { createCohort, enrollLearner } from '../../operations/cohorts';
import { applyResult, reconcileResults } from '../../operations/results';
import * as schema from '../../schema/index';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
let admin: ReturnType<typeof postgres>;
let application: ReturnType<typeof postgres>;
let worker: ReturnType<typeof postgres>;
const logins: string[] = [];
const fixture = testCurriculum();
fixture.evaluations = fixture.evaluations.map((e) => {
  const spec = {
    ...e.spec,
    runner_image_digest: `sha256:${createHash('sha256').update(fixture.curriculum.key).digest('hex')}`,
    test_pack_artifact: `oci:///non-runnable-unit-fixture/${e.nodeKey}@sha256:${e.spec.test_pack_digest}`,
  };
  return { ...e, spec, digest: evaluationDigest(spec) };
});
let versionId: string;
let applicationURL: string;
async function login(role: string) {
  const name = `f005_${randomUUID().replaceAll('-', '')}`;
  logins.push(name);
  const password = randomBytes(24).toString('hex');
  await admin.unsafe(
    `CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
  );
  await admin.unsafe(`GRANT ${role} TO ${name}`);
  const target = new URL(process.env.TEST_DATABASE_URL!);
  target.username = name;
  target.password = password;
  return {
    name,
    url: target.toString(),
    client: postgres(target.toString(), { max: 8, prepare: false, onnotice: () => {} }),
  };
}
beforeAll(async () => {
  const target = new URL(process.env.TEST_DATABASE_URL!);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.startsWith('/foundation_test')
  )
    throw new Error('Disposable DB required');
  admin = postgres(target.toString(), { max: 12, prepare: false, onnotice: () => {} });
  await admin.unsafe(
    'CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY)',
  );
  await migrate(drizzle(admin), {
    migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
  });
  versionId = (
    await importCurriculum(
      drizzle(admin, { schema }),
      fixture.curriculum,
      fixture.gitCommitSha,
      fixture.evaluations,
    )
  ).id;
  const productLogin = await login('nextera_result_application');
  application = productLogin.client;
  applicationURL = productLogin.url;
  const w = await login('nextera_runner');
  worker = w.client;
  const spec = fixture.evaluations[0]!.spec;
  await admin`INSERT INTO judge.workers(db_principal,runner_image_digest,protocol_versions,platform,capabilities) VALUES(${w.name},${String(spec.runner_image_digest)},ARRAY[1],'linux/amd64',${JSON.stringify({ toolchain_version: spec.toolchain_version, resource_profile: spec.resource_profile, snapshot_format_version: 1, sandbox_image_digest: spec.sandbox_image_digest })}::jsonb)`;
});
afterAll(async () => {
  await application?.end();
  await worker?.end();
  for (const name of logins) await admin.unsafe(`ALTER ROLE ${name} NOLOGIN`);
  await admin?.end();
});
async function learner(version = versionId) {
  const auth = randomUUID();
  await admin`INSERT INTO auth.users(id) VALUES(${auth})`;
  const user = String(
    (
      await admin`INSERT INTO app.users(auth_user_id,display_name) VALUES(${auth},'Application fixture') RETURNING id`
    )[0]!.id,
  );
  const cohort = (
    await createCohort(drizzle(admin, { schema }), {
      slug: `foundation-test-${randomUUID()}`,
      name: 'NON-RUNNABLE RESULT APPLICATION',
      curriculumVersionId: version,
      startsAt: new Date(),
    })
  ).id;
  await enrollLearner(drizzle(admin, { schema }), cohort, user);
  return { auth, user, cohort };
}
type Learner = Awaited<ReturnType<typeof learner>>;
async function accept(l: Learner, node = 'hello-go') {
  return String(
    (
      await admin`SELECT app.accept_submission(${l.auth}::uuid,${l.cohort}::uuid,${node},${randomUUID()}::uuid,${node === 'even-or-odd' ? 'even_or_odd.go' : 'hello.go'},10::bigint,${'e'.repeat(64)}) AS id`
    )[0]!.id,
  );
}
async function outcome(l: Learner, verdict = 'passed', node = 'hello-go', deactivate?: string) {
  const submission = await accept(l, node);
  if (deactivate === 'user') await admin`UPDATE app.users SET active=false WHERE id=${l.user}`;
  if (deactivate === 'membership')
    await admin`UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=${l.cohort}`;
  if (deactivate === 'cohort')
    await admin`UPDATE app.cohorts SET status='inactive' WHERE id=${l.cohort}`;
  const job = String(
    (await admin`SELECT active_judge_job_id AS id FROM app.submissions WHERE id=${submission}`)[0]!
      .id,
  );
  // Restrict the real worker to this isolated cohort so test files can run independently.
  await admin`UPDATE judge.workers SET capabilities=capabilities||${JSON.stringify({ fixture_cohort_ids: [l.cohort] })}::jsonb WHERE db_principal=${logins[1]!}`;
  let result = '';
  for (let attempt = 0; attempt < (verdict === 'system_error' ? 3 : 1); attempt++) {
    await admin`UPDATE judge.jobs SET available_at=clock_timestamp() WHERE id=${job}`;
    const claimOne = async () => (await worker`SELECT judge.claim_job() AS claim`)[0]!.claim;
    let c = await claimOne();
    await expect
      .poll(async () => {
        if (!c) c = await claimOne();
        return c;
      })
      .not.toBeNull();
    expect(c.job_id).toBe(job);
    await worker`SELECT judge.record_execution_attempt(${c.job_id},${c.attempt_id},${c.token},${c.generation})`;
    result = String(
      (verdict === 'system_error'
        ? await worker`SELECT judge.record_infrastructure_failure(${c.job_id},${c.attempt_id},${c.token},${c.generation},'WORKER_FAILURE') AS id`
        : await worker`SELECT judge.record_result(${c.job_id},${c.attempt_id},${c.token},${c.generation},${verdict},'{}') AS id`)[0]!
        .id,
    );
  }
  return { submission, job, result };
}
const progress = async (l: Learner) =>
  await admin`SELECT * FROM app.learner_node_progress WHERE cohort_id=${l.cohort} AND user_id=${l.user} ORDER BY node_key`;
const apply = (id: string) => applyResult(drizzle(application), id);
describe('trusted result application / real PostgreSQL', () => {
  it.each(['passed', 'failed', 'compile_error', 'runtime_error', 'timeout', 'system_error'])(
    'applies %s with immutable safe evidence',
    async (verdict) => {
      const l = await learner();
      const before = await progress(l);
      expect(before.map((p) => p.state)).toEqual(['locked', 'available']);
      const r = await outcome(l, verdict);
      const pending = (
        await admin`SELECT application_status FROM judge.results WHERE id=${r.result}`
      )[0]!;
      expect(pending.application_status).toBe('pending');
      const receipt = await apply(r.result);
      expect(receipt.application_status).toBe('applied');
      expect(
        (await admin`SELECT state FROM app.submissions WHERE id=${r.submission}`)[0]!.state,
      ).toBe(verdict);
      const after = await progress(l);
      expect(after.map((p) => p.state)).toEqual(
        verdict === 'passed' ? ['available', 'mastered'] : ['locked', 'in_progress'],
      );
      if (verdict === 'passed') expect(after[1]!.first_passing_submission_id).toBe(r.submission);
      expect(await apply(r.result)).toEqual(receipt);
      expect(await progress(l)).toEqual(after);
      expect(
        (
          await admin`SELECT count(*) AS count FROM app.activity_events WHERE result_id=${r.result}`
        )[0]!.count,
      ).toBe(verdict === 'passed' ? '2' : '1');
      await expect(
        admin`UPDATE judge.results SET processed_at=clock_timestamp() WHERE id=${r.result}`,
      ).rejects.toThrow('receipt is immutable');
      const history = (
        await admin`SELECT app.read_submissions(${l.auth},${l.cohort},'hello-go') AS history`
      )[0]!.history;
      expect(history[0].state).toBe(verdict);
      expect(history[0].feedback.verdict).toBe(verdict);
      if (verdict === 'passed') {
        const even = await outcome(l, 'passed', 'even-or-odd');
        await apply(even.result);
        expect((await progress(l)).map((p) => p.state)).toEqual(['mastered', 'mastered']);
        const later = await outcome(l, 'failed');
        await apply(later.result);
        expect((await progress(l))[1]!.first_passing_submission_id).toBe(r.submission);
      }
    },
  );
  it('serializes simultaneous application and independent learners', async () => {
    const a = await learner(),
      b = await learner();
    const ra = await outcome(a),
      rb = await outcome(b);
    const receipts = await Promise.all([
      ...Array.from({ length: 8 }, () => apply(ra.result)),
      apply(rb.result),
    ]);
    expect(new Set(receipts.slice(0, 8).map((r) => String(r.processed_at))).size).toBe(1);
    expect(
      (
        await admin`SELECT count(*) AS count FROM app.activity_events WHERE result_id=${ra.result} AND event_type='node_unlocked'`
      )[0]!.count,
    ).toBe('1');
    expect((await progress(b)).map((p) => p.state)).toEqual(['available', 'mastered']);
  });
  it('serializes two relevant passing results without replacing first evidence', async () => {
    const l = await learner();
    const a = await outcome(l),
      b = await outcome(l);
    await Promise.all([apply(a.result), apply(b.result)]);
    const p = await progress(l);
    expect([a.submission, b.submission]).toContain(p[1]!.first_passing_submission_id);
    expect(
      (
        await admin`SELECT event_type FROM app.activity_events WHERE cohort_id=${l.cohort} ORDER BY event_type`
      ).map((e) => e.event_type),
    ).toEqual(['challenge_mastered', 'node_unlocked']);
  });
  it.each(['user', 'membership', 'cohort'])(
    'applies accepted work after %s deactivation without granting access',
    async (kind) => {
      const l = await learner();
      const r = await outcome(l, 'passed', 'hello-go', kind);
      await apply(r.result);
      expect((await progress(l)).map((p) => p.state)).toEqual(['available', 'mastered']);
      await expect(accept(l)).rejects.toMatchObject({ code: '42501' });
      await expect(
        admin`SELECT app.read_submissions(${l.auth},${l.cohort},'hello-go')`,
      ).rejects.toMatchObject({ code: '42501' });
      const first = await apply(r.result);
      expect(await apply(r.result)).toEqual(first);
    },
  );
  it('reconciles missed delivery concurrently and processes intermediate failures safely', async () => {
    const l = await learner();
    const r = await outcome(l, 'system_error');
    await Promise.all([
      reconcileResults(drizzle(application)),
      reconcileResults(drizzle(application)),
    ]);
    expect(
      (await admin`SELECT application_status FROM judge.results WHERE id=${r.result}`)[0]!
        .application_status,
    ).toBe('applied');
    const results = await admin`SELECT application_status FROM judge.results WHERE job_id=${r.job}`;
    expect(results.filter((r) => r.application_status === 'superseded')).toHaveLength(2);
    expect((await progress(l)).map((p) => p.state)).toEqual(['locked', 'in_progress']);
    await apply(r.result);
  });
  it('rolls back all product writes on a failure before commit and retries', async () => {
    const l = await learner();
    const r = await outcome(l);
    const fail = (await login('nextera_result_application')).client;
    try {
      // Real PostgreSQL permission failure at the event stage, after lifecycle/progress writes.
      await admin.unsafe(`REVOKE INSERT ON app.activity_events FROM nextera_result_application`);
      await expect(applyResult(drizzle(fail), r.result)).rejects.toMatchObject({
        cause: { code: '42501' },
      });
      expect(
        (await admin`SELECT application_status FROM judge.results WHERE id=${r.result}`)[0]!
          .application_status,
      ).toBe('pending');
      expect((await progress(l)).map((p) => p.state)).toEqual(['locked', 'in_progress']);
    } finally {
      await admin.unsafe('GRANT INSERT ON app.activity_events TO nextera_result_application');
      await fail.end();
    }
    await apply(r.result);
    expect((await progress(l)).map((p) => p.state)).toEqual(['available', 'mastered']);
  });
  it('denies Runner/web progression and receipt writes, and unauthorized service invocation', async () => {
    const web = (await login('nextera_web')).client;
    try {
      for (const client of [worker, web]) {
        await expect(
          client`UPDATE app.learner_node_progress SET state='mastered'`,
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          client`UPDATE judge.results SET application_status='applied'`,
        ).rejects.toMatchObject({ code: '42501' });
        await expect(client`INSERT INTO app.activity_events DEFAULT VALUES`).rejects.toMatchObject({
          code: '42501',
        });
        await expect(applyResult(drizzle(client), randomUUID())).rejects.toThrow(
          'RESULT_APPLICATION_UNAUTHORIZED',
        );
      }
    } finally {
      await web.end();
    }
  });
});

it('recovers after the actual application connection dies before commit', async () => {
  const l = await learner();
  const r = await outcome(l);
  const dying = postgres(applicationURL, { max: 1, prepare: false, onnotice: () => {} });
  const pid = Number((await dying`SELECT pg_backend_pid() AS pid`)[0]!.pid);
  let attempted: Promise<unknown> | undefined;
  try {
    await admin.begin(async (lock) => {
      await lock.unsafe('LOCK TABLE app.activity_events IN ACCESS EXCLUSIVE MODE');
      attempted = applyResult(drizzle(dying), r.result).catch((e) => e);
      await expect
        .poll(async () =>
          Number(
            (
              await admin`SELECT count(*) AS count FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock' AND query LIKE '%INSERT INTO app.activity_events%'`
            )[0]!.count,
          ),
        )
        .toBe(1);
      await admin`SELECT pg_terminate_backend(${pid})`;
      await attempted;
    });
    expect(
      (await admin`SELECT application_status FROM judge.results WHERE id=${r.result}`)[0]!
        .application_status,
    ).toBe('pending');
    expect((await progress(l)).map((p) => p.state)).toEqual(['locked', 'in_progress']);
    expect(
      await admin`SELECT id FROM app.activity_events WHERE result_id=${r.result}`,
    ).toHaveLength(0);
    await apply(r.result);
    expect((await progress(l)).map((p) => p.state)).toEqual(['available', 'mastered']);
  } finally {
    await dying.end({ timeout: 1 });
  }
});

it('replays application after a real committed acknowledgement is discarded', async () => {
  const l = await learner();
  const r = await outcome(l);
  const target = new URL(applicationURL);
  const sockets = new Set<Socket>();
  let dropped = false;
  const proxy = createServer((downstream) => {
    const upstream = createConnection({ host: target.hostname, port: Number(target.port || 5432) });
    sockets.add(upstream);
    sockets.add(downstream);
    let armed = false;
    let committed = false;
    let tail = Buffer.alloc(0);
    let pending = Buffer.alloc(0);
    downstream.on('data', (bytes) => {
      tail = Buffer.concat([tail, bytes]);
      if (tail.includes(Buffer.from('commit'))) armed = true;
      tail = tail.subarray(Math.max(0, tail.length - 64));
      upstream.write(bytes);
    });
    upstream.on('data', (bytes) => {
      pending = Buffer.concat([pending, bytes]);
      while (pending.length >= 5) {
        const size = pending.readInt32BE(1) + 1;
        if (size < 5 || size > 1 << 20) {
          downstream.destroy();
          upstream.destroy();
          return;
        }
        if (pending.length < size) return;
        const frame = pending.subarray(0, size);
        pending = pending.subarray(size);
        if (armed && frame[0] === 67 && frame.includes(Buffer.from('COMMIT'))) committed = true;
        if (committed && frame[0] === 90 && frame[5] === 73) {
          dropped = true;
          downstream.destroy();
          upstream.destroy();
          return;
        }
        if (!committed) downstream.write(frame);
      }
    });
    upstream.on('error', () => downstream.destroy());
    downstream.on('error', () => upstream.destroy());
    upstream.on('close', () => {
      sockets.delete(upstream);
      downstream.destroy();
    });
    downstream.on('close', () => {
      sockets.delete(downstream);
      upstream.destroy();
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Proxy unavailable');
  const through = new URL(target);
  through.hostname = '127.0.0.1';
  through.port = String(address.port);
  const interrupted = postgres(through.toString(), {
    max: 1,
    prepare: false,
    ssl: false,
    connect_timeout: 3,
    onnotice: () => {},
  });
  try {
    await expect(applyResult(drizzle(interrupted), r.result)).rejects.toThrow();
    expect(dropped).toBe(true);
    const [stored] =
      await admin`SELECT application_status,processed_at FROM judge.results WHERE id=${r.result}`;
    expect(stored!.application_status).toBe('applied');
    const replay = await apply(r.result);
    expect(replay.processed_at).toEqual(stored!.processed_at);
    expect(
      await admin`SELECT id FROM app.activity_events WHERE result_id=${r.result}`,
    ).toHaveLength(2);
  } finally {
    for (const socket of sockets) socket.destroy();
    await interrupted.end({ timeout: 1 });
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

it('rejects corrupt/conflicting receipt state without altering Judge evidence', async () => {
  const l = await learner();
  const r = await outcome(l);
  await admin`UPDATE judge.results SET application_status='applied',processed_at=clock_timestamp(),application_reason='conflicting_receipt' WHERE id=${r.result}`;
  await expect(apply(r.result)).rejects.toThrow('APPLICATION_RECEIPT_CONFLICT');
  expect((await progress(l)).map((p) => p.state)).toEqual(['locked', 'in_progress']);
  await expect(
    admin`UPDATE judge.results SET application_status='pending',processed_at=NULL,application_reason=NULL WHERE id=${r.result}`,
  ).rejects.toThrow('receipt is immutable');
});

it('uses persisted AND prerequisites and preserves an unrelated root unchanged', async () => {
  const graph = testCurriculum();
  const extra = ['other-root', 'unrelated'];
  const files = graph.files.map((f) =>
    f.path.endsWith('/manifest.yaml')
      ? {
          ...f,
          bytes: Buffer.from(
            Buffer.from(f.bytes)
              .toString()
              .replace(
                'edges:',
                extra
                  .map(
                    (key, i) =>
                      `  - id: ${key}\n    quest: foundations\n    type: challenge\n    title: ${key}\n    order: ${i + 3}\n    difficulty: 1\n\n`,
                  )
                  .join('') + 'edges:',
              ) + '\n  - from: other-root\n    to: even-or-odd\n    rule: requires_pass\n',
          ),
        }
      : f,
  );
  for (const key of extra)
    for (const file of graph.files.filter((f) => f.path.includes('/hello-go/')))
      files.push({
        ...file,
        path: file.path.replace('/hello-go/', `/${key}/`),
        bytes: Buffer.from(
          Buffer.from(file.bytes)
            .toString()
            .replace('id: hello-go', `id: ${key}`)
            .replace('title: Hello Go', `title: ${key}`),
        ),
      });
  const curriculum = parseCurriculum(files);
  const evaluations = curriculum.nodes.map((n) => {
    const base = fixture.evaluations.find((e) => e.nodeKey === n.key) ?? fixture.evaluations[0]!;
    const spec = {
      ...base.spec,
      curriculum_key: curriculum.key,
      curriculum_version: curriculum.version,
      content_digest: curriculum.contentDigest,
      node_key: n.key,
      subject_digest: n.subjectDigest,
      configuration_digest: n.configurationDigest,
    };
    return { nodeKey: n.key, spec, digest: evaluationDigest(spec) };
  });
  const v = await importCurriculum(
    drizzle(admin, { schema }),
    curriculum,
    graph.gitCommitSha,
    evaluations,
  );
  const l = await learner(v.id);
  const before = await progress(l);
  await expect(accept(l, 'even-or-odd')).rejects.toMatchObject({ code: '42501' });
  const hello = await outcome(l);
  await apply(hello.result);
  const partial = await progress(l);
  expect(partial.find((p) => p.node_key === 'even-or-odd')!.state).toBe('locked');
  expect(partial.find((p) => p.node_key === 'unrelated')).toEqual(
    before.find((p) => p.node_key === 'unrelated'),
  );
  const other = await outcome(l, 'passed', 'other-root');
  await apply(other.result);
  expect((await progress(l)).find((p) => p.node_key === 'even-or-odd')!.state).toBe('available');
  expect(
    await admin`SELECT id FROM app.activity_events WHERE cohort_id=${l.cohort} AND event_type='node_unlocked'`,
  ).toHaveLength(1);
});

it('two independent reconciler processes converge after missed delivery', async () => {
  const l = await learner();
  const r = await outcome(l);
  const run = () =>
    promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'scripts/result-reconciliation.ts', '--once'],
      {
        env: { PATH: process.env.PATH, RESULT_APPLICATION_DATABASE_URL: applicationURL },
        timeout: 10000,
      },
    );
  const runs = await Promise.all([
    run().catch((error: unknown) => {
      const failure = error as { code?: unknown; stdout?: string };
      if (failure.code === 1 && typeof failure.stdout === 'string')
        return { stdout: failure.stdout };
      throw error;
    }),
    run().catch((error: unknown) => {
      const failure = error as { code?: unknown; stdout?: string };
      if (failure.code === 1 && typeof failure.stdout === 'string')
        return { stdout: failure.stdout };
      throw error;
    }),
  ]);
  // Other integration files deliberately retain corrupt pending constraint fixtures.
  // They must surface attention while this valid result still applies exactly once.
  const own = runs
    .flatMap((run) =>
      run.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { result_id: string; status: string }),
    )
    .filter((row) => row.result_id === r.result);
  expect(own.length).toBeGreaterThan(0);
  expect(own.every((row) => row.status === 'applied')).toBe(true);
  expect(
    (await admin`SELECT application_status FROM judge.results WHERE id=${r.result}`)[0]!
      .application_status,
  ).toBe('applied');
  expect(await admin`SELECT id FROM app.activity_events WHERE result_id=${r.result}`).toHaveLength(
    2,
  );
}, 15000);
