import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { testCurriculum } from '../../../../tests/fixtures/curriculum';
import { evaluationDigest } from '../../../../scripts/curriculum/digest';
import { importCurriculum } from '../../operations/curriculum';
import { createCohort, enrollLearner } from '../../operations/cohorts';
import { applyResult } from '../../operations/results';
import * as schema from '../../schema/index';
// This suite never reads .env, creates LOGIN roles, passwords, tokens or a TCP listener.
const isolated = !!process.env.RAID_TEST_SOCKET;
const options = {
  host: process.env.RAID_TEST_SOCKET ?? '',
  port: 55447,
  database: process.env.RAID_TEST_DB ?? '',
  username: process.env.RAID_TEST_USER ?? '',
  max: 1,
  prepare: false,
  onnotice: () => {},
};
let admin: ReturnType<typeof postgres>,
  web: ReturnType<typeof postgres>,
  worker: ReturnType<typeof postgres>,
  product: ReturnType<typeof postgres>;
const fixture = testCurriculum();
fixture.curriculum.nodes[0]!.kind = 'project';
fixture.evaluations = fixture.evaluations.map((e) => {
  const spec = {
    ...e.spec,
    test_pack_artifact: `oci:///NON-RUNNABLE-RAID-TRANSACTION-FIXTURE/${e.nodeKey}@sha256:${e.spec.test_pack_digest}`,
  };
  return { ...e, spec, digest: evaluationDigest(spec) };
});
let version: string;
let web2: ReturnType<typeof postgres>, browser: ReturnType<typeof postgres>;
beforeAll(async () => {
  if (!isolated) return;
  if (
    !process.env.RAID_TEST_SOCKET?.startsWith('/tmp/nextera-raid-test-') ||
    process.env.RAID_TEST_DB !== 'foundation_test_raid_ephemeral'
  )
    throw new Error('Private ephemeral Raid cluster required');
  admin = postgres(options);
  const [database] =
    await admin`SELECT current_database() AS name,current_setting('listen_addresses') AS listen,current_setting('data_directory') AS directory`;
  expect(database!.name).toBe('foundation_test_raid_ephemeral');
  expect(database!.listen).toBe('');
  expect(String(database!.directory)).toMatch(/^\/tmp\/nextera-raid-test-[^/]+\/data$/);
  await admin.unsafe(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;`);
  await admin.unsafe(`CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
 CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text NOT NULL,name text NOT NULL); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 GRANT USAGE ON SCHEMA auth,storage TO authenticated; GRANT SELECT ON storage.objects TO authenticated;`);
  const folder = fileURLToPath(new URL('../../migrations/', import.meta.url));
  for (const name of (await readdir(folder)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await admin.unsafe(await readFile(folder + '/' + name, 'utf8'));
  version = (
    await importCurriculum(
      drizzle(admin, { schema }),
      fixture.curriculum,
      fixture.gitCommitSha,
      fixture.evaluations,
    )
  ).id;
  web = postgres(options);
  web2 = postgres(options);
  browser = postgres(options);
  worker = postgres(options);
  product = postgres(options);
  await web.unsafe('SET SESSION AUTHORIZATION nextera_web');
  await web2.unsafe('SET SESSION AUTHORIZATION nextera_web');
  await browser.unsafe('SET SESSION AUTHORIZATION authenticated');
  await worker.unsafe('SET SESSION AUTHORIZATION nextera_runner');
  await product.unsafe('SET SESSION AUTHORIZATION nextera_result_application');
  const spec = fixture.evaluations[0]!.spec;
  await admin`INSERT INTO judge.workers(db_principal,runner_image_digest,protocol_versions,platform,capabilities) VALUES('nextera_runner',${spec.runner_image_digest},ARRAY[1],'linux/amd64',${JSON.stringify({ toolchain_version: spec.toolchain_version, resource_profile: spec.resource_profile, snapshot_format_version: 1, sandbox_image_digest: spec.sandbox_image_digest })}::jsonb)`;
});
afterAll(async () => {
  await Promise.all([
    web?.end(),
    web2?.end(),
    browser?.end(),
    worker?.end(),
    product?.end(),
    admin?.end(),
  ]);
});
type Person = { auth: string; id: string };
type Team = { cohort: string; owner: Person; mentor: Person; members: Person[]; id: string };
async function person(role = 'learner'): Promise<Person> {
  const auth = randomUUID();
  await admin`INSERT INTO auth.users(id) VALUES(${auth})`;
  const [u] =
    await admin`INSERT INTO app.users(auth_user_id,display_name,role) VALUES(${auth},'NON-RUNNABLE RAID TEST',${role}::app.user_role) RETURNING id`;
  return { auth, id: String(u!.id) };
}
async function team(): Promise<Team> {
  const cohort = (
    await createCohort(drizzle(admin, { schema }), {
      slug: 'foundation-test-raid-' + randomUUID(),
      name: 'NON-RUNNABLE RAID TRANSACTION FIXTURE',
      curriculumVersionId: version,
      startsAt: new Date(),
    })
  ).id;
  const owner = await person('admin'),
    mentor = await person('operator'),
    members = await Promise.all([person(), person(), person()]);
  for (const p of members) await enrollLearner(drizzle(admin, { schema }), cohort, p.id);
  await admin`INSERT INTO app.cohort_memberships(cohort_id,user_id) VALUES(${cohort},${mentor.id})`;
  const [t] =
    await web`SELECT app.assign_raid_team(${owner.auth},${cohort},'hello-go',${randomUUID()},'Fixture team',${mentor.id},${members.map((p) => p.id)}::uuid[]) AS id`;
  return { cohort, owner, mentor, members, id: String(t!.id) };
}
async function accept(t: Team, index = 0, key = randomUUID(), hash = 'a'.repeat(64)) {
  const [s] =
    await web`SELECT app.accept_raid_submission(${t.members[index]!.auth},${t.cohort},'hello-go',${key},'hello.go',10,${hash}) AS id`;
  const [a] = await admin`SELECT id FROM app.raid_attempts WHERE submission_id=${String(s!.id)}`;
  return { submission: String(s!.id), attempt: String(a!.id), key };
}
async function run(t: Team, s: { submission: string }, verdict = 'passed') {
  await admin`UPDATE judge.workers SET capabilities=capabilities||${JSON.stringify({ fixture_cohort_ids: [t.cohort] })}::jsonb WHERE db_principal='nextera_runner'`;
  const [row] = await worker`SELECT judge.claim_job() AS c`;
  const c = row!.c;
  expect(c).not.toBeNull();
  const [job] = await admin`SELECT submission_id FROM judge.jobs WHERE id=${c.job_id}`;
  expect(job!.submission_id).toBe(s.submission);
  await worker`SELECT judge.record_execution_attempt(${c.job_id},${c.attempt_id},${c.token},${c.generation})`;
  const [result] =
    await worker`SELECT judge.record_result(${c.job_id},${c.attempt_id},${c.token},${c.generation},${verdict},'{}') AS id`;
  await applyResult(drizzle(product, { schema }), String(result!.id));
  return String(result!.id);
}
const review = (
  t: Team,
  attempt: string,
  key = randomUUID(),
  decision = 'approved',
  actor = t.mentor,
) =>
  web`SELECT app.review_raid(${actor.auth},${attempt},${key},${decision},'Fixture feedback') AS data`;
describe.runIf(isolated)('shared Raid contract / credential-free real PostgreSQL', () => {
  it('allows any of exactly three members, freezes recipients and deduplicates uncertain intake', async () => {
    const t = await team();
    const a = await accept(t, 1);
    expect(await accept(t, 1, a.key)).toEqual(a);
    expect(
      (await admin`SELECT user_id FROM app.raid_attempt_members WHERE attempt_id=${a.attempt}`)
        .map((r) => r.user_id)
        .sort(),
    ).toEqual(t.members.map((p) => p.id).sort());
    await expect(accept(t, 1, a.key, 'b'.repeat(64))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('denies wrong owner, wrong roster size, nonmembers and unassigned reviewers', async () => {
    const t = await team();
    await expect(
      web`SELECT app.assign_raid_team(${t.mentor.auth},${t.cohort},'hello-go',${randomUUID()},'Invalid',${t.mentor.id},${t.members.map((p) => p.id)}::uuid[])`,
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      web`SELECT app.assign_raid_team(${t.owner.auth},${t.cohort},'hello-go',${randomUUID()},'Invalid',${t.mentor.id},${t.members.slice(0, 2).map((p) => p.id)}::uuid[])`,
    ).rejects.toThrow('THREE_MEMBERS');
    const other = await person();
    await enrollLearner(drizzle(admin, { schema }), t.cohort, other.id);
    await expect(
      web`SELECT app.accept_raid_submission(${other.auth},${t.cohort},'hello-go',${randomUUID()},'hello.go',10,${'a'.repeat(64)})`,
    ).rejects.toThrow('TEAM_REQUIRED');
    const a = await accept(t);
    await run(t, a);
    await expect(review(t, a.attempt, randomUUID(), 'approved', t.owner)).rejects.toThrow(
      'FORBIDDEN',
    );
  });
  it('records automatic PASS without mastery, then one outcome and exactly three immutable member receipts', async () => {
    const t = await team(),
      a = await accept(t);
    const rid = await run(t, a);
    expect(
      (
        await admin`SELECT state FROM app.learner_node_progress WHERE cohort_id=${t.cohort} AND node_key='hello-go'`
      ).map((p) => p.state),
    ).toEqual(['in_progress', 'in_progress', 'in_progress']);
    const key = randomUUID();
    const [first] = await review(t, a.attempt, key);
    expect(first!.data.outcome_id).toBeTruthy();
    expect((await review(t, a.attempt, key))[0]!.data).toEqual(first!.data);
    await applyResult(drizzle(product, { schema }), rid);
    expect(
      (
        await admin`SELECT count(*) AS n FROM app.raid_member_receipts WHERE outcome_id=${first!.data.outcome_id}`
      )[0]!.n,
    ).toBe('3');
    const p =
      await admin`SELECT * FROM app.learner_node_progress WHERE cohort_id=${t.cohort} AND node_key='hello-go'`;
    expect(
      p.every(
        (row) =>
          row.state === 'mastered' &&
          row.first_passing_raid_outcome_id === first!.data.outcome_id &&
          row.first_passing_submission_id === null,
      ),
    ).toBe(true);
    await expect(
      admin`UPDATE app.raid_outcomes SET created_at=clock_timestamp() WHERE id=${first!.data.outcome_id}`,
    ).rejects.toThrow('immutable');
  });
  it('serializes duplicate approvals and returns the same receipt after a discarded response', async () => {
    const t = await team(),
      a = await accept(t);
    await run(t, a);
    const key = randomUUID();
    const rows = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        i % 2
          ? web2`SELECT app.review_raid(${t.mentor.auth},${a.attempt},${key},'approved','Fixture feedback') AS data`
          : review(t, a.attempt, key),
      ),
    );
    expect(new Set(rows.map((row) => row[0]!.data.outcome_id)).size).toBe(1);
    expect(
      (
        await admin`SELECT count(*) AS n FROM app.activity_events WHERE cohort_id=${t.cohort} AND event_type='raid_completed'`
      )[0]!.n,
    ).toBe('3');
  });
  it('requires fresh automation and review on revision, and rejects stale approval', async () => {
    const t = await team(),
      a = await accept(t);
    await run(t, a);
    const b = await accept(t, 2);
    await expect(review(t, a.attempt)).rejects.toThrow('SUPERSEDED');
    await expect(review(t, b.attempt)).rejects.toThrow('NOT_PASSED');
    await run(t, b);
    await review(t, b.attempt, randomUUID(), 'changes_requested');
    expect(
      (await admin`SELECT count(*) AS n FROM app.raid_outcomes WHERE attempt_id=${b.attempt}`)[0]!
        .n,
    ).toBe('0');
  });
  it.each(['user', 'membership', 'cohort'])(
    'blocks all awards after %s access removal and keeps a sticky owner hold',
    async (kind) => {
      const t = await team(),
        a = await accept(t);
      await run(t, a);
      if (kind === 'user')
        await admin`UPDATE app.users SET active=false WHERE id=${t.members[1]!.id}`;
      if (kind === 'membership')
        await admin`UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=${t.cohort} AND user_id=${t.members[1]!.id}`;
      if (kind === 'cohort')
        await admin`UPDATE app.cohorts SET status='inactive' WHERE id=${t.cohort}`;
      expect((await review(t, a.attempt))[0]!.data.status).toBe('owner_decision_required');
      expect(
        (
          await admin`SELECT count(*) AS n FROM app.raid_member_receipts WHERE attempt_id=${a.attempt}`
        )[0]!.n,
      ).toBe('0');
      if (kind === 'user')
        await admin`UPDATE app.users SET active=true WHERE id=${t.members[1]!.id}`;
      if (kind === 'membership')
        await admin`UPDATE app.cohort_memberships SET status='active' WHERE cohort_id=${t.cohort} AND user_id=${t.members[1]!.id}`;
      if (kind === 'cohort')
        await admin`UPDATE app.cohorts SET status='active' WHERE id=${t.cohort}`;
      expect((await review(t, a.attempt))[0]!.data.status).toBe('owner_decision_required');
    },
  );
  it('rolls back review/outcome/all member effects on a mid-transaction failure and safely retries', async () => {
    const t = await team(),
      a = await accept(t);
    await run(t, a);
    await admin.unsafe(
      `CREATE FUNCTION app.raid_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${t.members[1]!.id}'::uuid THEN RAISE EXCEPTION 'TEST_ROLLBACK'; END IF; RETURN NEW; END $$; CREATE TRIGGER raid_test_fail BEFORE INSERT ON app.raid_member_receipts FOR EACH ROW EXECUTE FUNCTION app.raid_test_fail()`,
    );
    const key = randomUUID();
    await expect(review(t, a.attempt, key)).rejects.toThrow('TEST_ROLLBACK');
    expect(
      (await admin`SELECT count(*) AS n FROM app.raid_reviews WHERE attempt_id=${a.attempt}`)[0]!.n,
    ).toBe('0');
    expect(
      (
        await admin`SELECT count(*) AS n FROM app.raid_member_receipts WHERE attempt_id=${a.attempt}`
      )[0]!.n,
    ).toBe('0');
    await admin.unsafe(
      'DROP TRIGGER raid_test_fail ON app.raid_member_receipts; DROP FUNCTION app.raid_test_fail()',
    );
    expect((await review(t, a.attempt, key))[0]!.data.outcome_id).toBeTruthy();
  });
  it('preserves guard on an unlinked project PASS and denies direct web/Runner evidence writes', async () => {
    const t = await team();
    const [row] =
      await web`SELECT app.accept_submission(${t.members[0]!.auth},${t.cohort},'hello-go',${randomUUID()},'hello.go',10,${'a'.repeat(64)}) AS id`;
    const sid = String(row!.id);
    await admin`UPDATE judge.workers SET capabilities=capabilities||${JSON.stringify({ fixture_cohort_ids: [t.cohort] })}::jsonb WHERE db_principal='nextera_runner'`;
    const [c0] = await worker`SELECT judge.claim_job() AS c`;
    const c = c0!.c;
    await worker`SELECT judge.record_execution_attempt(${c.job_id},${c.attempt_id},${c.token},${c.generation})`;
    const [rr] =
      await worker`SELECT judge.record_result(${c.job_id},${c.attempt_id},${c.token},${c.generation},'passed','{}') AS id`;
    await expect(applyResult(drizzle(product, { schema }), String(rr!.id))).rejects.toThrow(
      'UNSUPPORTED_MASTERY_KIND',
    );
    expect((await admin`SELECT state FROM app.submissions WHERE id=${sid}`)[0]!.state).toBe(
      'running',
    );
    await expect(
      web`INSERT INTO app.raid_outcomes(attempt_id,review_id) VALUES(${randomUUID()},${randomUUID()})`,
    ).rejects.toThrow('permission denied');
    await expect(
      worker`SELECT app.review_raid(${t.mentor.auth},${randomUUID()},${randomUUID()},'approved','Invalid')`,
    ).rejects.toThrow('permission denied');
  });
  it('denies cross-team reads and rejects foreign mastery evidence', async () => {
    const t = await team(),
      other = await team(),
      a = await accept(t);
    await run(t, a);
    await expect(
      web`SELECT app.read_raid(${other.members[0]!.auth},${t.cohort},'hello-go',NULL)`,
    ).rejects.toThrow('FORBIDDEN');
    const [o] = await review(t, a.attempt);
    await expect(
      admin`UPDATE app.learner_node_progress SET state='mastered',started_at=clock_timestamp(),mastered_at=clock_timestamp(),first_passing_raid_outcome_id=${o!.data.outcome_id} WHERE cohort_id=${other.cohort} AND user_id=${other.members[0]!.id} AND node_key='hello-go'`,
    ).rejects.toThrow();
  });
  it('keeps each learner prerequisite graph authoritative for downstream unlocks', async () => {
    const f = testCurriculum();
    f.curriculum.nodes[0]!.kind = 'project';
    // Fixture-only extra prerequisite; this is not authored/published course content.
    const extra = {
      ...f.curriculum.nodes[0]!,
      key: 'personal-gate',
      kind: 'challenge' as const,
      position: 3,
    };
    f.curriculum.nodes.push(extra);
    f.curriculum.prerequisites.push({
      from: 'personal-gate',
      to: 'even-or-odd',
      rule: 'requires_pass',
    });
    f.evaluations.push({ ...f.evaluations[0]!, nodeKey: 'personal-gate' });
    f.evaluations = f.evaluations.map((e) => {
      const spec = {
        ...e.spec,
        node_key: e.nodeKey,
        test_pack_artifact: `oci:///NON-RUNNABLE-RAID-TRANSACTION-FIXTURE/${e.nodeKey}@sha256:${e.spec.test_pack_digest}`,
      };
      return { ...e, spec, digest: evaluationDigest(spec) };
    });
    const custom = (
      await importCurriculum(
        drizzle(admin, { schema }),
        f.curriculum,
        f.gitCommitSha,
        f.evaluations,
      )
    ).id;
    const saved = version;
    version = custom;
    let t: Team;
    try {
      t = await team();
    } finally {
      version = saved;
    }
    const a = await accept(t!);
    await run(t!, a);
    // A separate legitimate passing individual submission supplies this member's other prerequisite.
    const who = t!.members[0]!;
    const [s] =
      await web`SELECT app.accept_submission(${who.auth},${t!.cohort},'personal-gate',${randomUUID()},'hello.go',10,${'a'.repeat(64)}) AS id`;
    await run(t!, { submission: String(s!.id) });
    await review(t!, a.attempt);
    const progress =
      await admin`SELECT user_id,state FROM app.learner_node_progress WHERE cohort_id=${t!.cohort} AND node_key='even-or-odd'`;
    expect(progress.find((p) => p.user_id === who.id)!.state).toBe('available');
    expect(progress.filter((p) => p.user_id !== who.id).every((p) => p.state === 'locked')).toBe(
      true,
    );
  });
  it('preserves accepted history and frozen recipients after owner changes team assignment', async () => {
    const t = await team(),
      a = await accept(t);
    await run(t, a);
    const replacement = await person();
    await enrollLearner(drizzle(admin, { schema }), t.cohort, replacement.id);
    await web`SELECT app.assign_raid_team(${t.owner.auth},${t.cohort},'hello-go',${randomUUID()},'Replacement fixture',${t.mentor.id},${[t.members[0]!.id, t.members[1]!.id, replacement.id]}::uuid[])`;
    await expect(review(t, a.attempt)).rejects.toThrow('SUPERSEDED');
    expect(
      (await admin`SELECT user_id FROM app.raid_attempt_members WHERE attempt_id=${a.attempt}`)
        .map((m) => m.user_id)
        .sort(),
    ).toEqual(t.members.map((m) => m.id).sort());
    const [old] =
      await web`SELECT app.read_raid(${t.members[2]!.auth},${t.cohort},'hello-go',NULL) AS data`;
    expect(old!.data.team).toBeNull();
    expect(old!.data.attempts[0].status).toBe('superseded');
  });
  it('limits mentor Storage reads to the exact accepted source after PASS using current Auth identity', async () => {
    const t = await team(),
      a = await accept(t);
    const [artifact] =
      await admin`SELECT ar.* FROM app.submission_artifacts ar JOIN app.submissions s ON s.artifact_id=ar.id WHERE s.id=${a.submission}`;
    await admin`INSERT INTO storage.objects(bucket_id,name) VALUES(${artifact!.storage_bucket},${artifact!.storage_key})`;
    await browser`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub: t.mentor.auth })},false)`;
    expect((await browser`SELECT * FROM storage.objects`).length).toBe(0);
    await run(t, a);
    expect((await browser`SELECT * FROM storage.objects`).map((o) => o.name)).toEqual([
      artifact!.storage_key,
    ]);
    await browser`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub: t.owner.auth })},false)`;
    expect((await browser`SELECT * FROM storage.objects`).length).toBe(0);
    await expect(browser`SELECT * FROM app.raid_reviews`).rejects.toThrow('permission denied');
    await browser`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub: t.mentor.auth })},false)`;
    await web`SELECT app.assign_raid_team(${t.owner.auth},${t.cohort},'hello-go',${randomUUID()},'Reassigned fixture',${t.mentor.id},${t.members.map((p) => p.id)}::uuid[])`;
    expect((await browser`SELECT * FROM storage.objects`).length).toBe(0);
    await admin`UPDATE app.users SET active=false WHERE id=${t.mentor.id}`;
    expect((await browser`SELECT * FROM storage.objects`).length).toBe(0);
  });
  it('holds a simultaneous deactivation after intake commits and blocks review', async () => {
    const t = await team();
    let pending: Promise<unknown> | undefined;
    await web.unsafe('BEGIN');
    try {
      const [accepted] =
        await web`SELECT app.accept_raid_submission(${t.members[0]!.auth},${t.cohort},'hello-go',${randomUUID()},'hello.go',10,${'a'.repeat(64)}) AS id`;
      // Read our uncommitted attempt through the same transaction's authorized view.
      // A second connection must not see this row until intake commits.
      const [view] =
        await web`SELECT app.read_raid(${t.members[0]!.auth},${t.cohort},'hello-go',NULL) AS data`;
      expect(view!.data.attempts).toHaveLength(1);
      const attempt = String(view!.data.attempts[0].id);
      let settled = false;
      pending = admin`UPDATE app.users SET active=false WHERE id=${t.members[1]!.id}`.then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(settled).toBe(false);
      await web.unsafe('COMMIT');
      await pending;
      expect(
        (
          await admin`SELECT id FROM app.raid_attempts WHERE submission_id=${String(accepted!.id)}`
        )[0]!.id,
      ).toBe(attempt);
      expect(
        (await admin`SELECT reason FROM app.raid_owner_holds WHERE attempt_id=${attempt}`)[0]!
          .reason,
      ).toBe('member_access_removed');
      await admin`UPDATE app.users SET active=true WHERE id=${t.members[1]!.id}`;
      expect((await review(t, attempt))[0]!.data.status).toBe('owner_decision_required');
    } finally {
      // Never leave the intake transaction holding locks after a failed assertion.
      await web.unsafe('ROLLBACK');
      await pending;
    }
  });
});
