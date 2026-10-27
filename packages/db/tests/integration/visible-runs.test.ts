/** Prepared only. Requires a fresh explicit approval; never uses URLs/passwords/Auth services. */
import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { checkpointFixture, checkpointTasks } from '../../../../tests/fixtures/checkpoints';
import { visibleRunStorageFixture } from '../../../../tests/fixtures/visible-runs';
import { importCurriculum } from '../../operations/curriculum';
import { createCohort, enrollLearner } from '../../operations/cohorts';
import {
  readVisibleRunReadiness,
  readVisibleRunAuthority,
  reserveVisibleRun,
  readVisibleRun,
  claimVisibleRun,
  pulseVisibleRun,
  completeVisibleRun,
  reconcileVisibleRun,
  listQueuedVisibleRuns,
  listRecoverableVisibleRuns,
  storedRunIntentDigest,
  type StoredRunIntent,
} from '../../queries/visible-runs';
import {
  serializeVisibleExampleManifest,
  serializeVisibleRunPolicy,
  visibleManifestDigest,
  visiblePolicyDigest,
  runSourceDigest,
} from '../../../../apps/web/lib/checkpoints/visible-run-spec';
import * as schema from '../../schema/index';

const socket = process.env.VISIBLE_RUN_TEST_SOCKET ?? '',
  database = process.env.VISIBLE_RUN_TEST_DB ?? '';
const isolated =
  /^\/tmp\/nextera-visible-run-test-[^/]+\/socket$/.test(socket) &&
  database === 'foundation_test_visible_runs_ephemeral';
const options = {
  host: socket,
  port: 55451,
  database,
  username: process.env.VISIBLE_RUN_TEST_USER ?? '',
  max: 1,
  prepare: false,
  onnotice: () => {},
};
type Client = ReturnType<typeof postgres>;
let admin: Client,
  web: Client,
  other: Client,
  worker: Client,
  worker2: Client,
  maintenance: Client,
  version: string,
  definition: string;
const f = checkpointFixture(),
  sample = visibleRunStorageFixture(),
  checks: string[] = [];
const db = (client: Client) => drizzle(client, { schema });
beforeAll(async () => {
  if (!isolated) return;
  admin = postgres(options);
  const [target] =
    await admin`SELECT current_database() AS name,current_setting('data_directory') AS dir,current_setting('listen_addresses') AS listen`;
  expect(target!.name).toBe(database);
  expect(target!.listen).toBe('');
  expect(target!.dir).toBe(socket.replace(/\/socket$/, '/data'));
  await admin.unsafe('CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY)');
  const folder = fileURLToPath(new URL('../../migrations/', import.meta.url));
  for (const name of (await readdir(folder))
    .filter((n) => /^(000[0-9]|0010)_.*\.sql$/.test(n))
    .sort())
    await admin.unsafe(await readFile(folder + '/' + name, 'utf8'));
  // All additional roles are NOLOGIN and disappear with this synthetic cluster. No passwords/tokens.
  await admin.unsafe(`DO $$ DECLARE n text;BEGIN FOREACH n IN ARRAY ARRAY['nextera_visible_run_worker','nextera_visible_run_maintenance','foundation_test_visible_web','foundation_test_visible_worker','foundation_test_visible_maintenance','foundation_test_visible_untrusted'] LOOP IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=n) THEN EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',n);END IF;END LOOP;END $$;
 GRANT nextera_web TO foundation_test_visible_web;GRANT nextera_visible_run_worker TO foundation_test_visible_worker;GRANT nextera_visible_run_maintenance TO foundation_test_visible_maintenance;
 ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO foundation_test_visible_untrusted;ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO foundation_test_visible_untrusted;`);
  const draft = await readFile(
    fileURLToPath(new URL('../../migration-drafts/0012_visible_runs.DRAFT.sql', import.meta.url)),
    'utf8',
  );
  const rollback = draft.replace(/\nCOMMIT;\s*$/, '\nROLLBACK;');
  expect(rollback).not.toBe(draft);
  await admin.unsafe(rollback);
  expect((await admin`SELECT to_regclass('app.visible_run_receipts') AS name`)[0]!.name).toBeNull();
  checks.push('migration_transaction_rollback');
  await admin.unsafe(draft);
  version = (await importCurriculum(db(admin), f.curriculum, f.gitCommitSha, f.evaluations)).id;
  definition = String(
    (
      await admin`SELECT definition_digest FROM app.checkpoint_definitions WHERE curriculum_version_id=${version} AND node_key='transfer-checkpoint'`
    )[0]!.definition_digest,
  );
  for (const task of checkpointTasks) {
    const manifest = {
      ...sample.manifest,
      taskKey: task.key,
      definitionDigest: definition,
      filename: task.file,
      harness: { ...sample.manifest.harness, functionName: task.fn, argument: task.input },
      examples: [
        {
          key: 'synthetic-example',
          input: task.input === 'int64' ? '1' : 'a',
          expectedOutput: 'demo-only',
        },
      ],
    };
    await admin`INSERT INTO app.visible_run_profiles(curriculum_version_id,node_key,definition_digest,task_key,enabled,manifest_bytes,manifest_digest,policy_bytes,policy_digest) VALUES(${version},'transfer-checkpoint',${definition},${task.key},true,decode(${Buffer.from(serializeVisibleExampleManifest(manifest)).toString('base64')},'base64'),${visibleManifestDigest(manifest)},decode(${Buffer.from(serializeVisibleRunPolicy(sample.policy)).toString('base64')},'base64'),${visiblePolicyDigest(sample.policy)})`;
  }
  await admin`INSERT INTO app.visible_run_principals(principal,kind,enabled,image_digest) VALUES('foundation_test_visible_worker','worker',true,${sample.policy.isolation.imageDigest}),('foundation_test_visible_maintenance','maintenance',true,NULL)`;
  web = postgres(options);
  other = postgres(options);
  worker = postgres(options);
  worker2 = postgres(options);
  maintenance = postgres(options);
  for (const [client, principal] of [
    [web, 'foundation_test_visible_web'],
    [other, 'foundation_test_visible_web'],
    [worker, 'foundation_test_visible_worker'],
    [worker2, 'foundation_test_visible_worker'],
    [maintenance, 'foundation_test_visible_maintenance'],
  ] as const) {
    await client.unsafe('SET SESSION AUTHORIZATION ' + principal);
    await client.unsafe("SET statement_timeout='4s'");
  }
});
afterAll(async () => {
  if (!isolated) return;
  try {
    const [counts] =
      await admin`SELECT (SELECT count(*) FROM app.submissions) AS graded,(SELECT count(*) FROM judge.jobs) AS jobs,(SELECT count(*) FROM app.checkpoint_outcomes) AS outcomes,(SELECT count(*) FROM pg_authid WHERE rolpassword IS NOT NULL) AS passwords,(SELECT count(*) FROM pg_roles WHERE rolcanlogin AND rolname<>session_user) AS extra_logins`;
    expect(counts).toMatchObject({
      graded: '0',
      jobs: '0',
      outcomes: '0',
      passwords: '0',
      extra_logins: '0',
    });
    await writeFile(
      process.env.VISIBLE_RUN_TEST_OUTPUT + '/database-evidence.json',
      JSON.stringify(
        {
          database,
          checks,
          counts,
          synthetic_roles_only: true,
          actual_executor_launched: false,
          production_enabled: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all([
      web?.end(),
      other?.end(),
      worker?.end(),
      worker2?.end(),
      maintenance?.end(),
      admin?.end(),
    ]);
  }
});
async function learner() {
  const auth = randomUUID();
  await admin`INSERT INTO auth.users(id) VALUES(${auth})`;
  const user = String(
    (
      await admin`INSERT INTO app.users(auth_user_id,display_name) VALUES(${auth},'SYNTHETIC RUN SQL ONLY') RETURNING id`
    )[0]!.id,
  );
  const cohort = (
    await createCohort(db(admin), {
      slug: 'foundation-test-run-' + randomUUID(),
      name: 'SYNTHETIC RUN SQL ONLY',
      curriculumVersionId: version,
      startsAt: new Date(),
    })
  ).id;
  await enrollLearner(db(admin), cohort, user);
  const attempt = String(
    (
      await web`SELECT app.start_checkpoint(${auth},${cohort},'transfer-checkpoint',${randomUUID()}) AS id`
    )[0]!.id,
  );
  return { auth, user, cohort, attempt };
}
type Learner = Awaited<ReturnType<typeof learner>>;
async function intent(
  l: Learner,
  request = randomUUID(),
  task = checkpointTasks[0]!.key as string,
) {
  const c = await readVisibleRunAuthority(db(web), l.auth, l.attempt, task);
  const source = 'package piscine\r\n';
  return {
    scope: c.editor.scope,
    requestId: request,
    filename: c.editor.filename,
    source,
    sourceDigest: runSourceDigest(source),
    byteLength: Buffer.byteLength(source),
    manifestDigest: c.manifestDigest,
    policyDigest: c.policyDigest,
    deadline: c.editor.deadline,
  } satisfies StoredRunIntent;
}
const save = (l: Learner, i: StoredRunIntent, client = web) =>
  reserveVisibleRun(db(client), {
    authId: l.auth,
    intent: i,
    intentDigest: storedRunIntentDigest(i),
  });
async function finishRun(l: Learner, record: Awaited<ReturnType<typeof reserveVisibleRun>>) {
  const lease = await claimVisibleRun(db(worker), record.record.id, record.intent.scope);
  expect(lease).not.toBeNull();
  await pulseVisibleRun(db(worker), lease!.lease, true);
  return completeVisibleRun(
    db(worker),
    lease!.lease,
    record.intent.scope,
    'system_error',
    '',
    'c'.repeat(64),
  );
}
describe.runIf(isolated)(
  'real private-socket Run SQL rehearsal - synthetic worker protocol, no execution',
  () => {
    it('verifies restricted catalog readiness and cleans hostile defaults', async () => {
      for (const [client, kind] of [
        [web, 'web'],
        [worker, 'worker'],
        [maintenance, 'maintenance'],
      ] as const)
        expect(await readVisibleRunReadiness(db(client), kind)).toEqual({
          ready: true,
          liveRunVerified: false,
        });
      expect(
        (
          await admin`SELECT has_table_privilege('foundation_test_visible_web','app.visible_run_receipts','SELECT,INSERT,UPDATE,DELETE') AS web,has_function_privilege('foundation_test_visible_untrusted','app.reserve_visible_run(uuid,uuid,text,text,uuid,text,text,bytea,text,text)','EXECUTE') AS hostile`
        )[0],
      ).toMatchObject({ web: false, hostile: false });
      checks.push('actual_catalog_acl_and_namespace_usage');
    });
    it('deduplicates two simultaneous identical admissions without double charging', async () => {
      const l = await learner(),
        i = await intent(l);
      const [a, b] = await Promise.all([save(l, i), save(l, i, other)]);
      expect(a.record.id).toBe(b.record.id);
      expect(
        (
          await admin`SELECT count(*) AS n FROM app.visible_run_receipts WHERE attempt_id=${l.attempt}`
        )[0]!.n,
      ).toBe('1');
      checks.push('two_session_duplicate_admission');
    });
    it('admits one competing request for one slot and keeps quotas separate from grading', async () => {
      const l = await learner(),
        a = await intent(l),
        b = await intent(l);
      const results = await Promise.allSettled([save(l, a), save(l, b, other)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      checks.push('two_session_one_slot');
    });
    it('rejects changed-source request reuse and foreign access', async () => {
      const l = await learner(),
        i = await intent(l);
      await save(l, i);
      const changed = {
        ...i,
        source: 'different',
        sourceDigest: runSourceDigest('different'),
        byteLength: 9,
      };
      await expect(save(l, changed)).rejects.toMatchObject({ code: 'idempotency_conflict' });
      const foreign = await learner();
      await expect(
        readVisibleRun(db(web), foreign.auth, i.scope, { requestId: i.requestId }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      checks.push('scope_and_idempotency_denial');
    });
    it('fences claim/start and permits exact terminal replay without a new admission', async () => {
      const l = await learner(),
        i = await intent(l),
        record = await save(l, i);
      const claims = await Promise.all([
        claimVisibleRun(db(worker), record.record.id, i.scope),
        claimVisibleRun(db(worker2), record.record.id, i.scope),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const claimed = claims.find(Boolean)!;
      await pulseVisibleRun(db(worker), claimed.lease, true);
      const result = await completeVisibleRun(
        db(worker),
        claimed.lease,
        i.scope,
        'completed',
        'a',
        'c'.repeat(64),
      );
      expect(result.record.state).toBe('completed');
      expect(
        await completeVisibleRun(
          db(worker),
          claimed.lease,
          i.scope,
          'completed',
          'a',
          'c'.repeat(64),
        ),
      ).toEqual(result);
      await expect(
        pulseVisibleRun(db(worker), { ...claimed.lease, token: randomUUID() }, true),
      ).rejects.toMatchObject({ code: 'stale_lease' });
      checks.push('claim_start_completion_fencing');
    });
    it('holds an expired uncertain lease until maintenance confirms a synthetic stop reference', async () => {
      const l = await learner(),
        i = await intent(l),
        record = await save(l, i),
        claimed = await claimVisibleRun(db(worker), record.record.id, i.scope);
      await pulseVisibleRun(db(worker), claimed!.lease, true);
      await admin`UPDATE app.visible_run_outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE run_id=${record.record.id}`;
      expect(
        await reconcileVisibleRun(
          db(maintenance),
          record.record.id,
          claimed!.lease.generation,
          null,
        ),
      ).toBe(false);
      await expect(save(l, await intent(l))).rejects.toMatchObject({ code: 'rate_limited' });
      expect(
        (await listRecoverableVisibleRuns(db(maintenance), 100)).some(
          (h) => h.runId === record.record.id,
        ),
      ).toBe(true);
      expect(
        await reconcileVisibleRun(
          db(maintenance),
          record.record.id,
          claimed!.lease.generation,
          'd'.repeat(64),
        ),
      ).toBe(true);
      checks.push('expired_claim_held_until_synthetic_stop_evidence');
    });
    it('shares the rolling Run allowance across freely selected questions', async () => {
      const l = await learner();
      const first = await save(l, await intent(l));
      await finishRun(l, first);
      const second = await save(l, await intent(l, randomUUID(), checkpointTasks[1]!.key));
      await finishRun(l, second);
      await expect(
        save(l, await intent(l, randomUUID(), checkpointTasks[2]!.key)),
      ).rejects.toMatchObject({ code: 'rate_limited' });
      checks.push('cross_question_separate_run_allowance');
    });
    it('rechecks access and trusted finish before accepting new work', async () => {
      const l = await learner(),
        i = await intent(l);
      await admin`UPDATE app.cohort_memberships SET status='inactive' WHERE user_id=${l.user} AND cohort_id=${l.cohort}`;
      await expect(save(l, i)).rejects.toMatchObject({ code: 'forbidden' });
      const closed = await learner(),
        j = await intent(closed);
      await web`SELECT app.finish_checkpoint(${closed.auth},${closed.attempt})`;
      await expect(save(closed, j)).rejects.toMatchObject({ code: 'closed' });
      checks.push('removed_access_and_finish');
    });
    it('lists only queue hints and denies web lifecycle operations', async () => {
      const l = await learner(),
        i = await intent(l),
        record = await save(l, i);
      expect(
        (await listQueuedVisibleRuns(db(worker), 100)).some((h) => h.runId === record.record.id),
      ).toBe(true);
      await expect(web`SELECT app.claim_visible_run(${record.record.id})`).rejects.toMatchObject({
        code: '42501',
      });
      checks.push('queue_discovery_and_worker_boundary');
    });
  },
);
