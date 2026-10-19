import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, createConnection, type Socket } from 'node:net';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { checkpointFixture, checkpointTasks } from '../../../../tests/fixtures/checkpoints';
import { importCurriculum } from '../../operations/curriculum';
import { createCohort, enrollLearner } from '../../operations/cohorts';
import { applyResult } from '../../operations/results';
import { reconcileCheckpoints } from '../../operations/checkpoints';
import * as schema from '../../schema/index';
import { canonicalJson } from '../../../../scripts/curriculum/digest';
const checksum = (value: unknown, domain: string) =>
  createHash('sha256')
    .update(domain + '\0v1\0')
    .update(canonicalJson(value))
    .digest('hex');
let admin: ReturnType<typeof postgres>,
  web: ReturnType<typeof postgres>,
  product: ReturnType<typeof postgres>,
  worker: ReturnType<typeof postgres>;
let productURL: string;
let webURL: string;
let workerName: string;
let version: string;
let gatedVersion: string;
const principals: string[] = [];
const f = checkpointFixture();
const gated = checkpointFixture({ prerequisites: true });
async function login(role: string) {
  const name = `f006_${randomUUID().replaceAll('-', '')}`;
  principals.push(name);
  const password = randomBytes(24).toString('hex');
  await admin.unsafe(
    `CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
  );
  await admin.unsafe(`GRANT ${role} TO ${name}`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.username = name;
  url.password = password;
  return {
    name,
    url: url.toString(),
    client: postgres(url.toString(), { max: 12, prepare: false, onnotice: () => {} }),
  };
}
beforeAll(async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !url.pathname.startsWith('/foundation_test')
  )
    throw new Error('Disposable DB required');
  admin = postgres(url.toString(), { max: 16, prepare: false, onnotice: () => {} });
  await admin.unsafe(
    'CREATE SCHEMA IF NOT EXISTS auth;CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY)',
  );
  await migrate(drizzle(admin), {
    migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
  });
  version = (
    await importCurriculum(drizzle(admin, { schema }), f.curriculum, f.gitCommitSha, f.evaluations)
  ).id;
  gatedVersion = (
    await importCurriculum(
      drizzle(admin, { schema }),
      gated.curriculum,
      gated.gitCommitSha,
      gated.evaluations,
    )
  ).id;
  const runtime = await login('nextera_web');
  web = runtime.client;
  webURL = runtime.url;
  const p = await login('nextera_result_application');
  product = p.client;
  productURL = p.url;
  const w = await login('nextera_runner');
  worker = w.client;
  workerName = w.name;
  const spec = f.evaluations[0]!.spec;
  await admin`INSERT INTO judge.workers(db_principal,runner_image_digest,protocol_versions,platform,capabilities) VALUES(${w.name},${String(spec.runner_image_digest)},ARRAY[1],'linux/amd64',${JSON.stringify({ toolchain_version: spec.toolchain_version, resource_profile: spec.resource_profile, snapshot_format_version: 1, sandbox_image_digest: spec.sandbox_image_digest })}::jsonb)`;
});
afterAll(async () => {
  await web?.end();
  await worker?.end();
  await product?.end();
  for (const p of principals) await admin.unsafe(`ALTER ROLE ${p} NOLOGIN`);
  await admin?.end();
});
async function learner(v = version, existingCohort?: string) {
  const auth = randomUUID();
  await admin`INSERT INTO auth.users(id) VALUES(${auth})`;
  const user = String(
    (
      await admin`INSERT INTO app.users(auth_user_id,display_name) VALUES(${auth},'Checkpoint test') RETURNING id`
    )[0]!.id,
  );
  const cohort =
    existingCohort ??
    (
      await createCohort(drizzle(admin, { schema }), {
        slug: `foundation-test-${randomUUID()}`,
        name: 'DISPOSABLE CHECKPOINT',
        curriculumVersionId: v,
        startsAt: new Date(),
      })
    ).id;
  await enrollLearner(drizzle(admin, { schema }), cohort, user);
  return { auth, user, cohort, version: v };
}
type Learner = Awaited<ReturnType<typeof learner>>;
const start = async (l: Learner, request = randomUUID()) =>
  String(
    (
      await web`SELECT app.start_checkpoint(${l.auth},${l.cohort},'transfer-checkpoint',${request}) AS id`
    )[0]!.id,
  );
const finish = async (l: Learner, a: string) => {
  await web`SELECT app.finish_checkpoint(${l.auth},${a})`;
};
const finalize = async (a: string) =>
  String((await product`SELECT app.finalize_checkpoint(${a}) AS id`)[0]!.id);
const read = async (l: Learner) =>
  (await web`SELECT app.read_checkpoint(${l.auth},${l.cohort},'transfer-checkpoint') AS data`)[0]!
    .data;
const accept = async (l: Learner, a: string, index = 0, request = randomUUID()) =>
  String(
    (
      await web`SELECT app.accept_checkpoint_submission(${l.auth},${a},${checkpointTasks[index]!.key},${request},${checkpointTasks[index]!.file},10::bigint,${'e'.repeat(64)}) AS id`
    )[0]!.id,
  );
async function record(sid: string, verdict = 'passed') {
  const [s] = await admin`SELECT * FROM app.submissions WHERE id=${sid}`;
  const job = String(s!.active_judge_job_id);
  await admin`UPDATE judge.workers SET capabilities=capabilities||${JSON.stringify({ fixture_cohort_ids: [s!.cohort_id] })}::jsonb WHERE db_principal=${workerName}`;
  let id = '';
  for (let n = 0; n < (verdict === 'system_error' ? 3 : 1); n++) {
    await admin`UPDATE judge.jobs SET available_at=clock_timestamp()-interval '1 day' WHERE id=${job}`;
    const c = (await worker`SELECT judge.claim_job() AS c`)[0]!.c;
    expect(c?.job_id).toBe(job);
    await worker`SELECT judge.record_execution_attempt(${c.job_id},${c.attempt_id},${c.token},${c.generation})`;
    id = String(
      (verdict === 'system_error'
        ? await worker`SELECT judge.record_infrastructure_failure(${c.job_id},${c.attempt_id},${c.token},${c.generation},'WORKER_FAILURE') AS id`
        : await worker`SELECT judge.record_result(${c.job_id},${c.attempt_id},${c.token},${c.generation},${verdict},'{}') AS id`)[0]!
        .id,
    );
  }
  return id;
}
const apply = async (id: string) => applyResult(drizzle(product), id);
async function task(l: Learner, a: string, index: number, verdict = 'passed') {
  const sid = await accept(l, a, index);
  const rid = await record(sid, verdict);
  await apply(rid);
  return { sid, rid };
}
const progress = async (l: Learner) =>
  await admin`SELECT * FROM app.learner_node_progress WHERE cohort_id=${l.cohort} AND user_id=${l.user} ORDER BY node_key`;
/** Trusted fixture construction at INSERT time; never changes an accepted timer/history.
 * Only the disposable DB administrator can construct past records. No clock override is shipped.
 */
async function pastAttempt(l: Learner, ageMinutes: number, status = 'active', slot = 1) {
  const [d] =
    await admin`SELECT * FROM app.checkpoint_definitions WHERE curriculum_version_id=${l.version} AND node_key='transfer-checkpoint'`;
  const id = randomUUID();
  const at = new Date(Date.now() - ageMinutes * 60000);
  const deadline = new Date(at.getTime() + 5400000);
  const completed = new Date(deadline.getTime() + 1000);
  const snap = {
    definition: d!.definition,
    definition_digest: d!.definition_digest,
    attempt_id: id,
    cohort_id: l.cohort,
    learner_id: l.user,
    curriculum_version_id: l.version,
    node_key: 'transfer-checkpoint',
    normal_slot: slot,
    kind: 'normal',
    started_at: at.toISOString(),
    deadline_at: deadline.toISOString(),
  };
  await admin`INSERT INTO app.checkpoint_attempts(id,cohort_id,user_id,curriculum_version_id,node_key,request_id,definition_digest,snapshot,snapshot_digest,normal_slot,kind,started_at,deadline_at,status,closed_at,closure_reason,completed_at)
 VALUES(${id},${l.cohort},${l.user},${l.version},'transfer-checkpoint',${randomUUID()},${String(d!.definition_digest)},${JSON.stringify(snap)}::jsonb,${checksum(snap, 'nextera-checkpoint-attempt')},${slot},'normal',${at.toISOString()},${deadline.toISOString()},${status},${status === 'active' ? null : deadline.toISOString()},${status === 'active' ? null : 'expired'},${status === 'active' ? null : completed.toISOString()})`;
  await admin`UPDATE app.learner_node_progress SET state='in_progress',unlocked_at=${new Date(at.getTime() - 1000).toISOString()},started_at=${at.toISOString()} WHERE cohort_id=${l.cohort} AND user_id=${l.user} AND node_key='transfer-checkpoint'`;
  if (status !== 'active') {
    const proof = {
      snapshot_digest: checksum(snap, 'nextera-checkpoint-attempt'),
      policy_version: 1,
      points: 0,
      status,
      results: [],
    };
    await admin`INSERT INTO app.checkpoint_outcomes(attempt_id,cohort_id,user_id,curriculum_version_id,node_key,status,points,evidence,evidence_digest,applied_at) VALUES(${id},${l.cohort},${l.user},${l.version},'transfer-checkpoint',${status},0,${JSON.stringify(proof)}::jsonb,${checksum(proof, 'nextera-checkpoint-outcome')},${completed.toISOString()})`;
  }
  return id;
}
async function pastSubmission(l: Learner, a: string, index: number) {
  const [attempt] = await admin`SELECT * FROM app.checkpoint_attempts WHERE id=${a}`;
  const item = attempt!.snapshot.definition.tasks[index];
  const sid = randomUUID(),
    jid = randomUUID(),
    artifact = randomUUID();
  const accepted = new Date(new Date(attempt!.deadline_at).getTime() - 1000);
  const key = `${l.auth}/${l.cohort}/${randomUUID()}/${'e'.repeat(64)}`;
  const snap = {
    ...item.evaluationSpec,
    curriculum_version_id: l.version,
    git_commit_sha: f.gitCommitSha,
    evaluation_spec_digest: item.evaluationDigest,
    learner_id: l.user,
    cohort_id: l.cohort,
    submission_id: sid,
    learner_attempt_ordinal: 1,
    accepted_at: accepted.toISOString(),
    artifact: {
      id: artifact,
      bucket: 'nextera-submissions',
      key,
      filename: item.submissionRules.required_files[0],
      size_bytes: 10,
      sha256: 'e'.repeat(64),
    },
  };
  await admin.begin(async (tx) => {
    await tx`INSERT INTO app.submission_artifacts(id,owner_user_id,storage_bucket,storage_key,original_filename,size_bytes,sha256,created_at) VALUES(${artifact},${l.user},'nextera-submissions',${key},${item.submissionRules.required_files[0]},10,${'e'.repeat(64)},${accepted.toISOString()})`;
    await tx`INSERT INTO app.submissions(id,cohort_id,user_id,curriculum_version_id,node_key,artifact_id,idempotency_key,evaluation_spec_digest,active_judge_job_id,created_at,checkpoint_attempt_id,checkpoint_task_key) VALUES(${sid},${l.cohort},${l.user},${l.version},'transfer-checkpoint',${artifact},${randomUUID()},${item.evaluationDigest},${jid},${accepted.toISOString()},${a},${item.key})`;
    await tx`INSERT INTO judge.jobs(id,submission_id,protocol_version,evaluation_snapshot,evaluation_digest,created_at) VALUES(${jid},${sid},1,${JSON.stringify(snap)}::jsonb,${checksum(snap, 'nextera-evaluation-snapshot')},${accepted.toISOString()})`;
  });
  return sid;
}
describe('Foundation 006 / real PostgreSQL', () => {
  it('serializes repeated starts and same-cohort learners; trusted timer survives server-process restart', async () => {
    const l = await learner();
    const other = await learner(version, l.cohort);
    const request = randomUUID();
    const both = await Promise.all([
      ...Array.from({ length: 8 }, () => start(l, request)),
      start(other),
    ]);
    const ids = both.slice(0, 8);
    expect(both[8]).not.toBe(ids[0]);
    expect(new Set(ids).size).toBe(1);
    const a = ids[0]!;
    const before = await read(l);
    expect(before.tasks).toHaveLength(4);
    expect(Date.parse(before.attempt.deadline_at) - Date.parse(before.attempt.started_at)).toBe(
      5400000,
    );
    expect((await read(l)).attempt.deadline_at).toBe(before.attempt.deadline_at);
    const freshServerRead = async () =>
      JSON.parse(
        (
          await promisify(execFile)(
            process.execPath,
            ['--import', 'tsx', 'tests/fixtures/checkpoint-read-probe.ts'],
            {
              env: {
                PATH: process.env.PATH,
                CHECKPOINT_PROBE_DATABASE_URL: webURL,
                CHECKPOINT_PROBE_AUTH: l.auth,
                CHECKPOINT_PROBE_COHORT: l.cohort,
              },
              timeout: 10000,
            },
          )
        ).stdout,
      );
    for (let processNumber = 0; processNumber < 2; processNumber++)
      expect(await freshServerRead()).toEqual({
        id: a,
        started_at: before.attempt.started_at,
        deadline_at: before.attempt.deadline_at,
      });

    await expect(
      admin`UPDATE app.checkpoint_attempts SET deadline_at=deadline_at+interval '1 minute' WHERE id=${a}`,
    ).rejects.toThrow('identity is immutable');
    await expect(start(l)).rejects.toThrow('CHECKPOINT_OPEN');
    await finish(l, a);
    await finish(l, a);
    await expect(accept(l, a)).rejects.toThrow('CHECKPOINT_CLOSED');
    expect(
      (
        await admin`SELECT count(*) AS n FROM app.activity_events WHERE checkpoint_attempt_id=${a} AND event_type='checkpoint_finished'`
      )[0]!.n,
    ).toBe('1');
  }, 15000);
  it.each([
    [4, 0, 'passed'],
    [3, 0, 'passed'],
    [2, 0, 'failed'],
    [2, 1, 'infrastructure_blocked'],
    [3, 1, 'passed'],
    [0, 0, 'failed'],
  ])(
    'scores %s passes, %s infrastructure as %s without task mastery',
    async (passes, infra, status) => {
      const l = await learner(),
        a = await start(l);
      for (let i = 0; i < 4; i++) {
        if (Number(passes) === 0 && Number(infra) === 0) continue;
        await task(
          l,
          a,
          i,
          i < Number(passes)
            ? 'passed'
            : i < Number(passes) + Number(infra)
              ? 'system_error'
              : 'failed',
        );
      }
      expect((await progress(l)).find((p) => p.node_key === 'transfer-checkpoint')!.state).toBe(
        'in_progress',
      );
      expect(await finalize(a)).toBe('null');
      await finish(l, a);
      const oid = await finalize(a);
      const [receipt] = await admin`SELECT * FROM app.checkpoint_outcomes WHERE id=${oid}`;
      expect(receipt).toMatchObject({ points: passes, status });
      expect(await finalize(a)).toBe(oid);
      const p = await progress(l);
      expect(p.find((x) => x.node_key === 'transfer-checkpoint')!.state).toBe(
        status === 'passed' ? 'mastered' : 'in_progress',
      );
      expect(p.find((x) => x.node_key === 'after-checkpoint')!.state).toBe(
        status === 'passed' ? 'available' : 'locked',
      );
      if (status === 'passed') {
        expect(
          p.find((x) => x.node_key === 'transfer-checkpoint')!.first_passing_checkpoint_outcome_id,
        ).toBe(oid);
        await expect(start(l)).rejects.toThrow();
      }
      await expect(
        admin`UPDATE app.checkpoint_outcomes SET points=0 WHERE id=${oid}`,
      ).rejects.toThrow('immutable');
    },
  );
  it('requires all committed prerequisites; unrelated mastery does not grant eligibility', async () => {
    const l = await learner(gatedVersion);
    await expect(start(l)).rejects.toThrow('CHECKPOINT_INELIGIBLE');
    for (const node of ['unrelated-root', 'hello-go', 'even-or-odd']) {
      const sid = String(
        (
          await web`SELECT app.accept_submission(${l.auth},${l.cohort},${node},${randomUUID()},${node === 'even-or-odd' ? 'even_or_odd.go' : 'hello.go'},10::bigint,${'e'.repeat(64)}) AS id`
        )[0]!.id,
      );
      await apply(await record(sid));
      if (node !== 'even-or-odd') await expect(start(l)).rejects.toThrow('CHECKPOINT_INELIGIBLE');
    }
    expect(await start(l)).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('reserves pending slots concurrently, preserves accepted replay and caps three learner outcomes', async () => {
    const l = await learner(),
      a = await start(l),
      request = randomUUID();
    const first = await accept(l, a, 0, request);
    expect(await accept(l, a, 0, request)).toBe(first);
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => accept(l, a)));
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(2);
    expect((await read(l)).tasks[0]).toMatchObject({ passed: false, reserved: 3 });
    const s =
      await admin`SELECT id FROM app.submissions WHERE checkpoint_attempt_id=${a} ORDER BY created_at,id`;
    for (const row of s) await apply(await record(String(row.id), 'failed'));
    await expect(accept(l, a)).rejects.toThrow('CHECKPOINT_TASK_QUOTA');
    await expect(accept(l, a, 1, request)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('system_error frees quota and a passed task cannot regress or accept another solution', async () => {
    const l = await learner(),
      a = await start(l);
    for (let n = 0; n < 3; n++) await task(l, a, 0, 'system_error');
    await task(l, a, 0, 'passed');
    await expect(accept(l, a)).rejects.toThrow('CHECKPOINT_TASK_QUOTA');
    expect((await read(l)).tasks[0]).toMatchObject({ passed: true, reserved: 1 });
    expect(
      (await read(l)).submissions.filter((s: { state: string }) => s.state === 'passed'),
    ).toHaveLength(1);
  });
  it('expires without browser activity, denies late intake and counts 89:59 accepted results arriving later', async () => {
    const l = await learner(),
      a = await pastAttempt(l, 91);
    const accepted = [];
    for (let i = 0; i < 3; i++) accepted.push(await pastSubmission(l, a, i));
    await expect(accept(l, a, 3)).rejects.toThrow('CHECKPOINT_CLOSED');
    await reconcileCheckpoints(drizzle(product));
    expect((await read(l)).attempt.status).toBe('evaluating');
    expect(await admin`SELECT id FROM app.checkpoint_outcomes WHERE attempt_id=${a}`).toHaveLength(
      0,
    );
    for (const sid of accepted) await apply(await record(sid));
    expect((await read(l)).attempt.status).toBe('passed');
    expect((await read(l)).history[0].points).toBe(3);
  });
  it.each(['user', 'membership', 'cohort'])(
    'applies historical accepted results after %s deactivation; access stays denied',
    async (kind) => {
      const l = await learner(),
        a = await start(l);
      const ids = [];
      for (let i = 0; i < 3; i++) ids.push(await accept(l, a, i));
      await finish(l, a);
      if (kind === 'user') await admin`UPDATE app.users SET active=false WHERE id=${l.user}`;
      if (kind === 'membership')
        await admin`UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=${l.cohort} AND user_id=${l.user}`;
      if (kind === 'cohort')
        await admin`UPDATE app.cohorts SET status='inactive' WHERE id=${l.cohort}`;
      for (const sid of ids) await apply(await record(sid));
      const before = await progress(l);
      expect(before.find((p) => p.node_key === 'transfer-checkpoint')!.state).toBe('mastered');
      await expect(accept(l, a, 3)).rejects.toThrow('CHECKPOINT_FORBIDDEN');
      await expect(start(l)).rejects.toThrow('CHECKPOINT_FORBIDDEN');
      await expect(read(l)).rejects.toThrow('CHECKPOINT_FORBIDDEN');
      await finalize(a);
      expect(await progress(l)).toEqual(before);
    },
  );
  it('enforces normal cooldown and two slots; replacement recovers only authoritative infrastructure blocks', async () => {
    const l = await learner(),
      a = await start(l);
    await finish(l, a);
    await finalize(a);
    await expect(start(l)).rejects.toThrow('CHECKPOINT_RETAKE_UNAVAILABLE');
    const old = await learner();
    await pastAttempt(old, 1600, 'failed');
    await reconcileCheckpoints(drizzle(product));
    const second = await start(old);
    expect((await read(old)).attempt.normal_slot).toBe(2);
    await finish(old, second);
    await finalize(second);
    await expect(start(old)).rejects.toThrow('CHECKPOINT_RETAKE_UNAVAILABLE');
    const blocked = await learner(),
      b = await start(blocked);
    await task(blocked, b, 0);
    await task(blocked, b, 1);
    await task(blocked, b, 2, 'system_error');
    await finish(blocked, b);
    await finalize(b);
    await expect(start(blocked)).rejects.toThrow('CHECKPOINT_RECOVERY_REQUIRED');
    await expect(
      web`SELECT app.grant_checkpoint_replacement(${blocked.auth},${b})`,
    ).rejects.toThrow('CHECKPOINT_FORBIDDEN');
    const auth = randomUUID();
    await admin`INSERT INTO auth.users VALUES(${auth})`;
    await admin`INSERT INTO app.users(auth_user_id,display_name,role) VALUES(${auth},'Recovery operator','admin')`;
    await expect(web`SELECT app.grant_checkpoint_replacement(${auth},${a})`).rejects.toThrow(
      'CHECKPOINT_NOT_INFRASTRUCTURE_BLOCKED',
    );
    const operatorAuth = randomUUID();
    await admin`INSERT INTO auth.users VALUES(${operatorAuth})`;
    const operatorId = String(
      (
        await admin`INSERT INTO app.users(auth_user_id,display_name,role) VALUES(${operatorAuth},'Scoped recovery operator','operator') RETURNING id`
      )[0]!.id,
    );
    await expect(
      web`SELECT app.grant_checkpoint_replacement(${operatorAuth},${b})`,
    ).rejects.toThrow('CHECKPOINT_FORBIDDEN');
    await admin`INSERT INTO app.cohort_memberships(cohort_id,user_id,status) VALUES(${blocked.cohort},${operatorId},'active')`;
    const grant = (
      await web`SELECT app.grant_checkpoint_replacement(${operatorAuth},${b}) AS id`
    )[0]!.id;
    expect(
      (
        await admin`SELECT actor_user_id,reason FROM app.checkpoint_replacement_grants WHERE id=${grant}`
      )[0],
    ).toMatchObject({ actor_user_id: operatorId, reason: 'trusted_infrastructure_failure' });
    expect((await web`SELECT app.grant_checkpoint_replacement(${auth},${b}) AS id`)[0]!.id).toBe(
      grant,
    );
    const replacement = await start(blocked);
    expect(replacement).not.toBe(b);
    expect((await read(blocked)).attempt).toMatchObject({ normal_slot: 1, kind: 'replacement' });
    const replacementView = (await read(blocked)).attempt;
    expect(Date.parse(replacementView.deadline_at) - Date.parse(replacementView.started_at)).toBe(
      5400000,
    );
  });
  it('denies foreign ownership, arbitrary identities, score writes and Runner finalization', async () => {
    const l = await learner();
    const foreign = await learner(version, l.cohort);
    const a = await start(l);
    await expect(accept(foreign, a)).rejects.toThrow('CHECKPOINT_FORBIDDEN');
    await expect(finish(foreign, a)).rejects.toThrow('CHECKPOINT_FORBIDDEN');
    await expect(
      web`SELECT app.accept_checkpoint_submission(${l.auth},${a},'foreign-task',${randomUUID()},'fake.go',10::bigint,${'e'.repeat(64)})`,
    ).rejects.toThrow('CHECKPOINT_TASK_UNKNOWN');
    for (const client of [web, worker]) {
      for (const query of [
        "UPDATE app.checkpoint_attempts SET status='passed'",
        'INSERT INTO app.checkpoint_outcomes DEFAULT VALUES',
        "UPDATE app.learner_node_progress SET state='mastered'",
        "SELECT app.finalize_checkpoint('00000000-0000-0000-0000-000000000000')",
      ])
        await expect(client.unsafe(query)).rejects.toMatchObject({ code: '42501' });
    }
    const funcs =
      await admin`SELECT p.proconfig,r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='app' AND p.prosecdef AND p.proname LIKE '%checkpoint%'`;
    expect(
      funcs.every(
        (x) =>
          x.rolname === 'nextera_checkpoint_owner' &&
          x.proconfig.includes('search_path=pg_catalog'),
      ),
    ).toBe(true);
  });
  it('converges concurrent finalizers and reconcilers to one outcome and unlock', async () => {
    const l = await learner(),
      a = await start(l);
    const other = await learner(version, l.cohort),
      b = await start(other);
    for (let i = 0; i < 3; i++) {
      await task(l, a, i);
      await task(other, b, i);
    }
    await finish(l, a);
    await finish(other, b);
    const both = await Promise.all([finalize(b), ...Array.from({ length: 12 }, () => finalize(a))]);
    const ids = both.slice(1);
    expect(both[0]).not.toBe(ids[0]);
    expect((await read(other)).attempt.status).toBe('passed');
    expect(new Set(ids).size).toBe(1);
    await Promise.all([
      reconcileCheckpoints(drizzle(product)),
      reconcileCheckpoints(drizzle(product)),
    ]);
    expect(await admin`SELECT id FROM app.checkpoint_outcomes WHERE attempt_id=${a}`).toHaveLength(
      1,
    );
    expect(
      await admin`SELECT id FROM app.activity_events WHERE checkpoint_attempt_id=${a} AND event_type='node_unlocked'`,
    ).toHaveLength(1);
  });
});

it('recovers checkpoint finalization after the product connection dies before commit', async () => {
  const l = await learner();
  const a = await start(l);
  for (let i = 0; i < 3; i++) await task(l, a, i);
  await finish(l, a);
  const dying = postgres(productURL, { max: 1, prepare: false, onnotice: () => {} });
  const pid = Number((await dying`SELECT pg_backend_pid() AS pid`)[0]!.pid);
  let attempted: Promise<unknown> | undefined;
  try {
    await admin.begin(async (lock) => {
      await lock.unsafe('LOCK TABLE app.activity_events IN ACCESS EXCLUSIVE MODE');
      attempted = dying`SELECT app.finalize_checkpoint(${a})`.catch((e) => e);
      await expect
        .poll(async () =>
          Number(
            (
              await admin`SELECT count(*) AS count FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock' AND query LIKE '%finalize_checkpoint%'`
            )[0]!.count,
          ),
        )
        .toBe(1);
      await admin`SELECT pg_terminate_backend(${pid})`;
      await attempted;
    });
    expect(await admin`SELECT id FROM app.checkpoint_outcomes WHERE attempt_id=${a}`).toHaveLength(
      0,
    );
    expect((await read(l)).attempt.status).toBe('evaluating');
    await finalize(a);
    expect((await read(l)).attempt.status).toBe('passed');
  } finally {
    await dying.end({ timeout: 1 });
  }
});

it('replays checkpoint finalization after the actual COMMIT acknowledgement is discarded', async () => {
  const l = await learner();
  const a = await start(l);
  for (let i = 0; i < 3; i++) await task(l, a, i);
  await finish(l, a);
  const target = new URL(productURL);
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
    await expect(
      interrupted.begin(async (tx) => tx`SELECT app.finalize_checkpoint(${a})`),
    ).rejects.toThrow();
    expect(dropped).toBe(true);
    const [stored] = await admin`SELECT * FROM app.checkpoint_outcomes WHERE attempt_id=${a}`;
    expect(stored!.status).toBe('passed');
    expect(await finalize(a)).toBe(stored!.id);
    expect(
      await admin`SELECT id FROM app.activity_events WHERE checkpoint_attempt_id=${a} AND event_type='node_unlocked'`,
    ).toHaveLength(1);
  } finally {
    for (const socket of sockets) socket.destroy();
    await interrupted.end({ timeout: 1 });
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

it('rejects a queued intake after its trusted deadline, including a request delayed by the learner lock', async () => {
  const l = await learner(),
    a = await pastAttempt(l, 89.97);
  let attempted: Promise<unknown> | undefined;
  await admin.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${l.cohort}||${l.user},4))`;
    attempted = accept(l, a).catch((e) => e);
    await tx`SELECT pg_sleep(2.2)`;
  });
  const error = await attempted;
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain('CHECKPOINT_CLOSED');
  expect(await admin`SELECT id FROM app.submissions WHERE checkpoint_attempt_id=${a}`).toHaveLength(
    0,
  );
});
it('does not regress task credit when a later accepted result fails', async () => {
  const l = await learner(),
    a = await start(l);
  const first = await accept(l, a),
    later = await accept(l, a);
  await apply(await record(first));
  await apply(await record(later, 'failed'));
  await task(l, a, 1);
  await task(l, a, 2);
  await finish(l, a);
  await finalize(a);
  expect((await read(l)).history[0]).toMatchObject({ status: 'passed', points: 3 });
});
it('withholds new replacement start under current deactivation and keeps the original timer', async () => {
  const l = await learner(),
    a = await start(l);
  await task(l, a, 0);
  await task(l, a, 1);
  await task(l, a, 2, 'system_error');
  await finish(l, a);
  await finalize(a);
  const auth = randomUUID();
  await admin`INSERT INTO auth.users VALUES(${auth})`;
  await admin`INSERT INTO app.users(auth_user_id,display_name,role) VALUES(${auth},'Recovery admin','admin')`;
  const before = (
    await admin`SELECT snapshot_digest,started_at,deadline_at FROM app.checkpoint_attempts WHERE id=${a}`
  )[0];
  await web`SELECT app.grant_checkpoint_replacement(${auth},${a})`;
  await admin`UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=${l.cohort} AND user_id=${l.user}`;
  await expect(start(l)).rejects.toThrow('CHECKPOINT_FORBIDDEN');
  expect(
    (
      await admin`SELECT snapshot_digest,started_at,deadline_at FROM app.checkpoint_attempts WHERE id=${a}`
    )[0],
  ).toEqual(before);
});

it.each([1, 2, 3])(
  'resolves historical infrastructure at expiry after %i fair learner outcomes',
  async (fair) => {
    const l = await learner(),
      a = await pastAttempt(l, 89.8);
    await task(l, a, 0, 'system_error');
    const queued: { id: string; verdict: string }[] = [];
    for (let i = 0; i < fair; i++) queued.push({ id: await accept(l, a, 0), verdict: 'failed' });
    queued.push(
      { id: await accept(l, a, 1), verdict: 'passed' },
      { id: await accept(l, a, 2), verdict: 'passed' },
      { id: await accept(l, a, 3), verdict: 'failed' },
    );
    // Accepted work is pending when the trusted timer expires; no browser drives it.
    await admin`SELECT pg_sleep(greatest(0,extract(epoch FROM (deadline_at-clock_timestamp())))::double precision+0.02) FROM app.checkpoint_attempts WHERE id=${a}`;
    for (const job of queued) await apply(await record(job.id, job.verdict));
    const [outcome] = await admin`SELECT * FROM app.checkpoint_outcomes WHERE attempt_id=${a}`;
    expect(outcome).toMatchObject({
      points: 2,
      status: fair === 3 ? 'failed' : 'infrastructure_blocked',
    });
    expect(
      await admin`SELECT id FROM app.submissions WHERE checkpoint_attempt_id=${a} AND state='system_error'`,
    ).toHaveLength(1);
    if (fair === 3) {
      const auth = randomUUID();
      await admin`INSERT INTO auth.users VALUES(${auth})`;
      await admin`INSERT INTO app.users(auth_user_id,display_name,role) VALUES(${auth},'Recovery admin','admin')`;
      await expect(web`SELECT app.grant_checkpoint_replacement(${auth},${a})`).rejects.toThrow(
        'CHECKPOINT_NOT_INFRASTRUCTURE_BLOCKED',
      );
    }
  },
  20000,
);
