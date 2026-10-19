import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createConnection, createServer, type Socket } from 'node:net';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testCurriculum } from '../../../../tests/fixtures/curriculum';
import { canonicalJson, evaluationDigest } from '../../../../scripts/curriculum/digest';
import { importCurriculum } from '../../operations/curriculum';
import { createCohort, enrollLearner } from '../../operations/cohorts';
import * as schema from '../../schema/index';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
let admin: ReturnType<typeof postgres>;
const connections: ReturnType<typeof postgres>[] = [];
const principals: string[] = [];
const passwords = new Map<string, string>();
let authId: string, learnerId: string, cohort: string;
type Claim = {
  job_id: string;
  attempt_id: string;
  worker_id: string;
  token: string;
  generation: number;
  evaluation_snapshot: Record<string, unknown>;
  evaluation_digest: string;
};
const fixture = testCurriculum();
// Public protocol fixtures have no executable artifacts. Private E2E supplies actual local digests.
fixture.evaluations = fixture.evaluations.map((e) => {
  const spec = {
    ...e.spec,
    runner_image_digest: `sha256:${createHash('sha256').update(fixture.curriculum.key).digest('hex')}`,
    test_pack_artifact: `oci:///non-runnable-unit-fixture/${e.nodeKey}@sha256:${e.spec.test_pack_digest}`,
  };
  return { ...e, spec, digest: evaluationDigest(spec) };
});
const spec = fixture.evaluations[0]!.spec;
const digest = 'e'.repeat(64);
async function connectWorker() {
  const name = `f004_${randomUUID().replaceAll('-', '')}`;
  principals.push(name);
  const password = randomBytes(24).toString('hex');
  passwords.set(name, password);
  await admin.unsafe(
    `CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
  );
  await admin.unsafe(`GRANT nextera_runner TO ${name}`);
  await admin`INSERT INTO judge.workers(db_principal,runner_image_digest,protocol_versions,platform,capabilities)
    VALUES(${name},${String(spec.runner_image_digest)},ARRAY[1],'linux/amd64',${JSON.stringify({ toolchain_version: spec.toolchain_version, resource_profile: spec.resource_profile, snapshot_format_version: 1, sandbox_image_digest: spec.sandbox_image_digest })}::jsonb)`;
  const target = new URL(process.env.TEST_DATABASE_URL!);
  target.username = name;
  target.password = password;
  const sql = postgres(target.toString(), { max: 1, prepare: false, onnotice: () => {} });
  connections.push(sql);
  return sql;
}
const claim = async (worker: ReturnType<typeof postgres>) =>
  (await worker`SELECT judge.claim_job() AS claim`)[0]!.claim as Claim | null;
const accept = async (requestId = randomUUID(), node = 'hello-go', hash = digest, who = authId) => {
  const [row] =
    await admin`SELECT app.accept_submission(${who}::uuid,${cohort}::uuid,${node},${requestId}::uuid,'hello.go',10::bigint,${hash}) AS id`;
  return String(row!.id);
};
async function start(w: ReturnType<typeof postgres>, c: Claim) {
  await w`SELECT judge.record_execution_attempt(${c.job_id},${c.attempt_id},${c.token},${c.generation})`;
}
async function finish(w: ReturnType<typeof postgres>, c: Claim, verdict = 'passed', metrics = {}) {
  return (
    await w`SELECT judge.record_result(${c.job_id},${c.attempt_id},${c.token},${c.generation},${verdict},${w.json(metrics)}) AS id`
  )[0]!.id;
}
async function failure(w: ReturnType<typeof postgres>, c: Claim, code = 'WORKER_FAILURE') {
  return (
    await w`SELECT judge.record_infrastructure_failure(${c.job_id},${c.attempt_id},${c.token},${c.generation},${code}) AS id`
  )[0]!.id;
}
async function ready(job: string) {
  await admin`UPDATE judge.jobs SET available_at=clock_timestamp() WHERE id=${job}`;
}
beforeAll(async () => {
  const target = new URL(process.env.TEST_DATABASE_URL!);
  if (
    !['127.0.0.1', 'localhost'].includes(target.hostname) ||
    !target.pathname.startsWith('/foundation_test')
  )
    throw new Error('Disposable database required');
  admin = postgres(target.toString(), { max: 8, prepare: false, onnotice: () => {} });
  await admin.unsafe(
    'CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY)',
  );
  const db = drizzle(admin, { schema });
  const options = { migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)) };
  await migrate(db, options);
  await migrate(db, options);
  const version = await importCurriculum(
    db,
    fixture.curriculum,
    fixture.gitCommitSha,
    fixture.evaluations,
  );
  cohort = (
    await createCohort(db, {
      slug: `foundation-test-${randomUUID()}`,
      name: 'NON-RUNNABLE QUEUE FIXTURE',
      curriculumVersionId: version.id,
      startsAt: new Date(),
    })
  ).id;
  authId = randomUUID();
  await admin`INSERT INTO auth.users(id) VALUES(${authId})`;
  learnerId = String(
    (
      await admin`INSERT INTO app.users(auth_user_id,display_name) VALUES(${authId},'Queue test') RETURNING id`
    )[0]!.id,
  );
  await enrollLearner(db, cohort, learnerId);
});
afterAll(async () => {
  await Promise.all(connections.map((c) => c.end()));
  // Immutable assessment history remains in the disposable database; disable its logins.
  for (const name of principals) await admin.unsafe(`ALTER ROLE ${name} NOLOGIN`);
  await admin?.end();
});
describe('durable Judge protocol on real concurrent PostgreSQL connections', () => {
  it('rejects locked nodes and inactive/foreign/preview identities', async () => {
    await expect(accept(randomUUID(), 'even-or-odd')).rejects.toMatchObject({ code: '42501' });
    await expect(accept(randomUUID(), 'hello-go', digest, randomUUID())).rejects.toMatchObject({
      code: '42501',
    });
    for (const role of ['operator', 'admin']) {
      await admin`UPDATE app.users SET role=${role} WHERE id=${learnerId}`;
      await expect(accept()).rejects.toMatchObject({ code: '42501' });
    }
    await admin`UPDATE app.users SET role='learner',active=false WHERE id=${learnerId}`;
    await expect(accept()).rejects.toMatchObject({ code: '42501' });
    await admin`UPDATE app.users SET active=true WHERE id=${learnerId}`;
    await admin`UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=${cohort}`;
    await expect(accept()).rejects.toMatchObject({ code: '42501' });
    await admin`UPDATE app.cohort_memberships SET status='active' WHERE cohort_id=${cohort}`;
  });
  it('accepts exactly one immutable artifact/submission/job for concurrent identical requests', async () => {
    const request = randomUUID();
    const ids = await Promise.all(Array.from({ length: 8 }, () => accept(request)));
    expect(new Set(ids).size).toBe(1);
    await expect(accept(request, 'hello-go', 'f'.repeat(64))).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
    const [row] =
      await admin`SELECT s.artifact_id,j.id,j.evaluation_snapshot,j.evaluation_digest FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id WHERE s.id=${ids[0]!}`;
    expect(row!.evaluation_digest).toBe(
      createHash('sha256')
        .update(`nextera-evaluation-snapshot\0v1\0${canonicalJson(row!.evaluation_snapshot)}`)
        .digest('hex'),
    );
    await expect(
      admin`UPDATE app.submission_artifacts SET sha256=${'f'.repeat(64)} WHERE id=${String(row!.artifact_id)}`,
    ).rejects.toThrow('immutable');
    await expect(
      admin`UPDATE judge.jobs SET evaluation_snapshot='{}' WHERE id=${String(row!.id)}`,
    ).rejects.toThrow('immutable');
    const p =
      await admin`SELECT state,started_at FROM app.learner_node_progress WHERE cohort_id=${cohort} ORDER BY node_key`;
    expect(p.map((x) => x.state)).toEqual(['locked', 'in_progress']);
    expect(p[0]!.started_at).toBeNull();
    expect(p[1]!.started_at).not.toBeNull();
  });
  it('gives one job to exactly one of eight simultaneous worker logins', async () => {
    const workers = await Promise.all(Array.from({ length: 8 }, () => connectWorker()));
    const claims = await Promise.all(workers.map((w) => claim(w)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const index = claims.findIndex(Boolean),
      c = claims[index]!;
    expect(await claim(workers[index]!)).toBeNull();
    await expect(
      workers[
        (index + 1) % 8
      ]!`SELECT judge.renew_lease(${c.job_id},${c.attempt_id},${c.token},${c.generation})`,
    ).rejects.toThrow('LEASE_LOST');
    await start(workers[index]!, c);
    await finish(workers[index]!, c);
  });
  it('requires running attempts and returns a durable identical completion receipt after reconnect', async () => {
    await accept();
    const w = await connectWorker();
    const c = (await claim(w))!;
    await expect(finish(w, c)).rejects.toThrow('ATTEMPT_NOT_RUNNING');
    await start(w, c);
    const id = await finish(w, c);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.username = principals.at(-1)!;
    url.password = passwords.get(principals.at(-1)!)!;
    const replay = postgres(url.toString(), { max: 1 });
    try {
      expect(await finish(replay, c)).toBe(id);
    } finally {
      await replay.end();
    }
    expect(await finish(w, c)).toBe(id);
    await expect(
      w`SELECT judge.record_result(${c.job_id},${c.attempt_id},NULL,${c.generation},'passed','{}'::jsonb)`,
    ).rejects.toThrow('LEASE_LOST');
    await expect(
      w`SELECT judge.record_result(${c.job_id},${c.attempt_id},${c.token},NULL,'passed','{}'::jsonb)`,
    ).rejects.toThrow('LEASE_LOST');
    await expect(finish(w, c, 'failed')).rejects.toThrow('RESULT_CONFLICT');
    expect(await claim(w)).toBeNull();
    const [row] =
      await admin`SELECT application_status,learner_feedback FROM judge.results WHERE id=${String(id)}`;
    expect(row!.application_status).toBe('pending');
    expect(Object.keys(row!.learner_feedback)).toEqual(['message', 'verdict']);
  });
  it('recovers a dead claimed worker, fences expired renewal/completion, and keeps two retries bounded', async () => {
    await accept();
    const a = await connectWorker(),
      b = await connectWorker();
    let c = (await claim(a))!;
    const original = c;
    await admin`UPDATE judge.jobs SET lease_expires_at=clock_timestamp()-interval '1 millisecond' WHERE id=${c.job_id}`;
    await expect(
      a`SELECT judge.renew_lease(${c.job_id},${c.attempt_id},${c.token},${c.generation})`,
    ).rejects.toThrow('LEASE_LOST');
    expect(
      Number((await admin`SELECT judge.recover_expired() AS count`)[0]!.count),
    ).toBeGreaterThanOrEqual(1);
    expect(await claim(b)).toBeNull();
    await ready(c.job_id);
    c = (await claim(b))!;
    expect(Number(c.generation)).toBeGreaterThan(Number(original.generation));
    await expect(finish(a, original)).rejects.toThrow('RESULT_CONFLICT');
    const firstFailure = await failure(b, c);
    expect(await failure(b, c)).toBe(firstFailure);
    const [retry] =
      await admin`SELECT retry_count,available_at>clock_timestamp()+interval '9 seconds' AS delayed FROM judge.jobs WHERE id=${c.job_id}`;
    expect(retry!.retry_count).toBe(2);
    expect(retry!.delayed).toBe(true);
    await ready(c.job_id);
    c = (await claim(b))!;
    await failure(b, c);
    const [terminal] =
      await admin`SELECT state,terminal_result_id FROM judge.jobs WHERE id=${c.job_id}`;
    expect(terminal!.state).toBe('system_error');
    expect(terminal!.terminal_result_id).toBeTruthy();
    expect(await claim(b)).toBeNull();
    await admin`SELECT judge.recover_expired()`;
    expect(
      (await admin`SELECT terminal_result_id FROM judge.jobs WHERE id=${c.job_id}`)[0]!
        .terminal_result_id,
    ).toBe(terminal!.terminal_result_id);
    expect(await admin`SELECT id FROM judge.attempts WHERE job_id=${c.job_id}`).toHaveLength(3);
  });
  it('does not resurrect a revoked token when the provisioner re-enables a worker', async () => {
    await accept();
    const w = await connectWorker();
    const c = (await claim(w))!;
    await admin`UPDATE judge.workers SET enabled=false WHERE id=${c.worker_id}`;
    await admin`UPDATE judge.workers SET enabled=true WHERE id=${c.worker_id}`;
    await expect(
      w`SELECT judge.renew_lease(${c.job_id},${c.attempt_id},${c.token},${c.generation})`,
    ).rejects.toThrow('LEASE_LOST');
    await expect(finish(w, c)).rejects.toThrow('RESULT_CONFLICT');
    await ready(c.job_id);
    const reclaimed = (await claim(w))!;
    expect(Number(reclaimed.generation)).toBeGreaterThan(Number(c.generation));
    await start(w, reclaimed);
    await finish(w, reclaimed);
    expect(
      await admin`SELECT id FROM judge.results WHERE attempt_id=${c.attempt_id} AND verdict='system_error'`,
    ).toHaveLength(1);
  });
  it('replays a real completion whose committed acknowledgement was lost on the TCP connection', async () => {
    await accept();
    const w = await connectWorker();
    const c = (await claim(w))!;
    await start(w, c);
    const target = new URL(process.env.TEST_DATABASE_URL!);
    const upstreamHost = target.hostname,
      upstreamPort = Number(target.port || 5432);
    const sockets = new Set<Socket>();
    let dropped = false;
    let committedReceipt = '';
    const proxy = createServer((downstream) => {
      const upstream = createConnection({ host: upstreamHost, port: upstreamPort });
      sockets.add(upstream);
      sockets.add(downstream);
      let armed = false;
      let resultWithheld = false;
      let clientTail = Buffer.alloc(0);
      let pending = Buffer.alloc(0);
      downstream.on('data', (bytes) => {
        clientTail = Buffer.concat([clientTail, bytes]);
        if (clientTail.includes(Buffer.from('judge.record_result'))) armed = true;
        clientTail = clientTail.subarray(Math.max(0, clientTail.length - 64));
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
          if (
            armed &&
            frame[0] === 68 &&
            frame.length === 47 &&
            frame.readInt16BE(5) === 1 &&
            frame.readInt32BE(7) === 36
          ) {
            committedReceipt = frame.subarray(11, 47).toString('utf8');
            resultWithheld = true; // Withhold the UUID row/command acknowledgement until commit.
          }
          if (resultWithheld && frame[0] === 90 && frame[5] === 73) {
            dropped = true;
            downstream.destroy();
            upstream.destroy();
            return;
          } // ReadyForQuery/Idle after the result row: autocommit is durable.
          if (!resultWithheld) downstream.write(frame);
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
    target.hostname = '127.0.0.1';
    target.port = String(address.port);
    target.username = principals.at(-1)!;
    target.password = passwords.get(target.username)!;
    const interrupted = postgres(target.toString(), {
      max: 1,
      prepare: false,
      ssl: false,
      connect_timeout: 3,
    });
    try {
      await expect(finish(interrupted, c)).rejects.toThrow();
      expect(dropped).toBe(true);
      const persisted = await admin`SELECT id FROM judge.results WHERE attempt_id=${c.attempt_id}`;
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.id).toBe(committedReceipt); // Prove commit happened before replay.
      const receipt = await finish(w, c);
      expect(receipt).toBe(committedReceipt);
      expect(
        await admin`SELECT id FROM judge.results WHERE attempt_id=${c.attempt_id}`,
      ).toHaveLength(1);
      expect(
        (await admin`SELECT terminal_result_id FROM judge.jobs WHERE id=${c.job_id}`)[0]!
          .terminal_result_id,
      ).toBe(receipt);
    } finally {
      for (const socket of sockets) socket.destroy();
      await interrupted.end({ timeout: 1 });
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
  it.each(['passed', 'failed', 'compile_error', 'runtime_error', 'timeout'])(
    'persists allowlisted %s without applying progression',
    async (verdict) => {
      await accept();
      const w = await connectWorker();
      let c: Claim | null = null;
      await expect
        .poll(async () => {
          c = await claim(w);
          return c;
        })
        .not.toBeNull();
      await start(w, c!);
      await finish(w, c!, verdict);
      const [row] =
        await admin`SELECT app.read_submissions(${authId}::uuid,${cohort}::uuid,'hello-go') AS history`;
      expect(row!.history.some((x: { state: string }) => x.state === verdict)).toBe(true);
      await expect(finish(w, c!, verdict, { secret: 42 })).rejects.toThrow('INVALID_RESULT');
    },
  );
  it('enforces Runner operation-only grants, maintenance separation, and restricted definer owners', async () => {
    const w = await connectWorker();
    for (const statement of [
      'SELECT * FROM app.users',
      'SELECT * FROM judge.jobs',
      "UPDATE app.learner_node_progress SET state='locked'",
      'SELECT judge.recover_expired()',
      "SELECT judge.finish_attempt(NULL,NULL,'passed','{}',NULL,NULL)",
    ])
      await expect(w.unsafe(statement)).rejects.toMatchObject({ code: '42501' });
    await w`SELECT judge.heartbeat()`;
    const functions =
      await admin`SELECT p.proname,p.proconfig,r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='judge' AND p.prosecdef`;
    expect(
      functions.every(
        (f) =>
          f.rolname === 'nextera_judge_owner' && f.proconfig.includes('search_path=pg_catalog'),
      ),
    ).toBe(true);
    expect(
      (
        await admin`SELECT has_table_privilege('nextera_judge_owner','app.learner_node_progress','UPDATE') AS writes`
      )[0]!.writes,
    ).toBe(false);
  });
});
