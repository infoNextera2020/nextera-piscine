import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkpointFixture, checkpointTasks } from '../../../../tests/fixtures/checkpoints';
import { canonicalJson } from '../../../../scripts/curriculum/digest';
import { importCurriculum } from '../../operations/curriculum';
import { createCohort, enrollLearner } from '../../operations/cohorts';
import {
  readCheckpointDraftReadiness,
  readCheckpointDraftContext,
  saveCheckpointDraft,
  readCheckpointDraft,
  type DraftScope,
} from '../../queries/checkpoint-drafts';
import * as schema from '../../schema/index';

const socket = process.env.DRAFT_TEST_SOCKET ?? '',
  database = process.env.DRAFT_TEST_DB ?? '';
const isolated =
  /^\/tmp\/nextera-checkpoint-draft-test-[^/]+\/socket$/.test(socket) &&
  database === 'foundation_test_checkpoint_drafts_ephemeral';
const options = {
  host: socket,
  port: 55449,
  database,
  username: process.env.DRAFT_TEST_USER ?? '',
  max: 1,
  prepare: false,
  onnotice: () => {},
};
type Client = ReturnType<typeof postgres>;
let admin: Client, observer: Client, web: Client, web2: Client, version: string, definition: string;
const f = checkpointFixture(),
  task = checkpointTasks[0]!.key;
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const checks: string[] = [];
type Learner = { auth: string; user: string; cohort: string; attempt: string };
const proposalPath = fileURLToPath(
  new URL('../../migration-drafts/0011_checkpoint_drafts.DRAFT.sql', import.meta.url),
);
async function policy(enabled: boolean) {
  await admin`UPDATE app.checkpoint_draft_policies SET enabled=${enabled} WHERE curriculum_version_id=${version}`;
}
beforeAll(async () => {
  if (!isolated) return;
  admin = postgres(options);
  observer = postgres(options);
  const [target] =
    await admin`SELECT current_database() AS name,current_setting('data_directory') AS directory,current_setting('listen_addresses') AS listen`;
  expect(target!.name).toBe(database);
  expect(target!.listen).toBe('');
  expect(String(target!.directory)).toBe(socket.replace(/\/socket$/, '/data'));
  await admin.unsafe('CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY)');
  const folder = fileURLToPath(new URL('../../migrations/', import.meta.url));
  for (const name of (await readdir(folder))
    .filter((name) => /^(000[0-9]|0010)_.*\.sql$/.test(name))
    .sort())
    await admin.unsafe(await readFile(folder + '/' + name, 'utf8'));
  await admin.unsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='draft_untrusted') THEN CREATE ROLE draft_untrusted NOLOGIN; END IF; END $$;
    ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO draft_untrusted;
    ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO draft_untrusted;`);
  const proposal = await readFile(proposalPath, 'utf8');
  const rollback = proposal.replace(/\nCOMMIT;\s*$/, '\nROLLBACK;');
  expect(rollback).not.toBe(proposal);
  await admin.unsafe(rollback);
  expect(
    (await admin`SELECT to_regclass('app.checkpoint_draft_revisions') AS relation`)[0]!.relation,
  ).toBeNull();
  expect(
    (
      await admin`SELECT has_schema_privilege('nextera_checkpoint_owner','app','CREATE') AS privilege`
    )[0]!.privilege,
  ).toBe(false);
  checks.push('migration_parsed_and_rolled_back_without_retained_objects_or_create_grant');
  await admin.unsafe(proposal);
  version = (
    await importCurriculum(drizzle(admin, { schema }), f.curriculum, f.gitCommitSha, f.evaluations)
  ).id;
  definition = String(
    (
      await admin`SELECT definition_digest FROM app.checkpoint_definitions WHERE curriculum_version_id=${version} AND node_key='transfer-checkpoint'`
    )[0]!.definition_digest,
  );
  // Explicit synthetic test policy only; no production setting is chosen or seeded.
  await admin`INSERT INTO app.checkpoint_draft_policies(curriculum_version_id,node_key,definition_digest,enabled,max_source_bytes,max_receipts_per_task,max_bytes_per_task,retention_after_deadline_seconds) VALUES(${version},'transfer-checkpoint',${definition},true,128,3,160,60)`;
  web = postgres(options);
  web2 = postgres(options);
  await web.unsafe("SET SESSION AUTHORIZATION nextera_web;SET statement_timeout='4s'");
  await web2.unsafe("SET SESSION AUTHORIZATION nextera_web;SET statement_timeout='4s'");
});
beforeEach(async () => {
  if (!isolated) return;
  expect((await web`SELECT current_user AS role`)[0]!.role).toBe('nextera_web');
  expect((await web2`SELECT current_user AS role`)[0]!.role).toBe('nextera_web');
});
afterAll(async () => {
  if (!isolated) return;
  try {
    await admin?.unsafe('ROLLBACK');
    const counts =
      await admin`SELECT (SELECT count(*) FROM app.submissions) AS submissions,(SELECT count(*) FROM judge.jobs) AS jobs,(SELECT count(*) FROM app.checkpoint_outcomes) AS outcomes,(SELECT count(*) FROM pg_authid WHERE rolpassword IS NOT NULL) AS passwords,(SELECT count(*) FROM pg_roles WHERE rolcanlogin AND rolname<>session_user) AS extra_login_roles`;
    expect(counts[0]).toMatchObject({
      submissions: '0',
      jobs: '0',
      outcomes: '0',
      passwords: '0',
      extra_login_roles: '0',
    });
    await writeFile(
      process.env.DRAFT_TEST_OUTPUT + '/database-evidence.json',
      JSON.stringify(
        {
          database,
          listen_addresses: '',
          checks,
          counts: counts[0],
          test_policy_only: {
            source_bytes: 128,
            receipts_per_task: 3,
            total_bytes_per_task: 160,
            retention_seconds_after_deadline: 60,
          },
          production_enabled: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all([web?.end(), web2?.end(), observer?.end(), admin?.end()]);
  }
});

async function learner(person?: Pick<Learner, 'auth' | 'user'>, start = true): Promise<Learner> {
  let auth = person?.auth,
    user = person?.user;
  if (!auth || !user) {
    auth = randomUUID();
    await admin`INSERT INTO auth.users(id) VALUES(${auth})`;
    user = String(
      (
        await admin`INSERT INTO app.users(auth_user_id,display_name) VALUES(${auth},'DISPOSABLE DRAFT TEST') RETURNING id`
      )[0]!.id,
    );
  }
  const cohort = (
    await createCohort(drizzle(admin, { schema }), {
      slug: 'foundation-test-draft-' + randomUUID(),
      name: 'DISPOSABLE DRAFT TEST ONLY',
      curriculumVersionId: version,
      startsAt: new Date(),
    })
  ).id;
  await enrollLearner(drizzle(admin, { schema }), cohort, user);
  const attempt = start
    ? String(
        (
          await web`SELECT app.start_checkpoint(${auth},${cohort},'transfer-checkpoint',${randomUUID()}) AS id`
        )[0]!.id,
      )
    : randomUUID();
  return { auth, user, cohort, attempt };
}
const scope = (l: Learner, key: string = task): DraftScope => ({
  learnerId: l.user,
  cohortId: l.cohort,
  attemptId: l.attempt,
  taskKey: key,
  definitionDigest: definition,
});
async function save(
  l: Learner,
  source: string,
  base = 0,
  request = randomUUID(),
  key: string = task,
  client = web,
  def = definition,
) {
  const bytes = Buffer.from(source);
  return (
    await client`SELECT app.save_checkpoint_draft(${l.auth},${l.attempt},${key},${def},${request},${base}::bigint,decode(${bytes.toString('base64')},'base64'),${digest(bytes)}) AS data`
  )[0]!.data as {
    kind: string;
    record?: { version: number; requestId: string };
    current?: { version: number };
  };
}
const count = (l: Learner) =>
  admin`SELECT count(*) AS n FROM app.checkpoint_draft_revisions WHERE attempt_id=${l.attempt}`;
async function waitForLock(client: Client) {
  const pid = Number((await client`SELECT pg_backend_pid() AS pid`)[0]!.pid);
  return pid;
}
async function waitBlocked(pid: number) {
  await vi.waitFor(
    async () => {
      expect(
        (await observer`SELECT wait_event_type AS wait FROM pg_stat_activity WHERE pid=${pid}`)[0]!
          .wait,
      ).toBe('Lock');
    },
    { timeout: 2000, interval: 20 },
  );
}
async function pastAttempt(l: Learner, secondsPastDeadline: number) {
  await web`SELECT app.finish_checkpoint(${l.auth},${l.attempt})`;
  // Separate test cohort avoids altering any accepted attempt's immutable clock.
  const p = await learner({ auth: l.auth, user: l.user }, false);
  const id = randomUUID(),
    deadline = new Date(Date.now() - secondsPastDeadline * 1000),
    started = new Date(deadline.getTime() - 5400000);
  const [d] =
    await admin`SELECT definition FROM app.checkpoint_definitions WHERE curriculum_version_id=${version} AND node_key='transfer-checkpoint'`;
  const snap = {
    definition: d!.definition,
    definition_digest: definition,
    attempt_id: id,
    cohort_id: p.cohort,
    learner_id: p.user,
    curriculum_version_id: version,
    node_key: 'transfer-checkpoint',
    normal_slot: 2,
    kind: 'normal',
    started_at: started.toISOString(),
    deadline_at: deadline.toISOString(),
  };
  const snapshotDigest = digest('nextera-checkpoint-attempt\0v1\0' + canonicalJson(snap));
  await admin`INSERT INTO app.checkpoint_attempts(id,cohort_id,user_id,curriculum_version_id,node_key,request_id,definition_digest,snapshot,snapshot_digest,normal_slot,kind,started_at,deadline_at)
   VALUES(${id},${p.cohort},${p.user},${version},'transfer-checkpoint',${randomUUID()},${definition},${JSON.stringify(snap)}::jsonb,${snapshotDigest},2,'normal',${started.toISOString()},${deadline.toISOString()})`;
  return { ...p, attempt: id, deadline };
}
async function historicalReceipt(l: Awaited<ReturnType<typeof pastAttempt>>, source = 'history') {
  const bytes = Buffer.from(source),
    request = randomUUID(),
    created = new Date(l.deadline.getTime() - 1000),
    expires = new Date(l.deadline.getTime() + 60000);
  await admin`INSERT INTO app.checkpoint_draft_revisions(attempt_id,cohort_id,user_id,curriculum_version_id,node_key,task_key,definition_digest,request_id,base_version,version,source_bytes,source_digest,created_at,expires_at)
   VALUES(${l.attempt},${l.cohort},${l.user},${version},'transfer-checkpoint',${task},${definition},${request},0,1,decode(${bytes.toString('base64')},'base64'),${digest(bytes)},${created.toISOString()},${expires.toISOString()})`;
  return request;
}

describe.runIf(isolated)(
  'real PostgreSQL draft persistence / one credential-free private cluster',
  () => {
    it('verifies applied draft contract and scoped function privileges, including hostile defaults', async () => {
      expect(await readCheckpointDraftReadiness(drizzle(web, { schema }))).toEqual({
        ready: true,
        livePersistenceVerified: false,
      });
      const [acl] =
        await admin`SELECT has_table_privilege('nextera_web','app.checkpoint_draft_revisions','SELECT,INSERT,UPDATE,DELETE') AS direct_web,has_table_privilege('draft_untrusted','app.checkpoint_draft_revisions','SELECT') AS untrusted_table,has_function_privilege('draft_untrusted','app.save_checkpoint_draft(uuid,uuid,text,text,uuid,bigint,bytea,text)','EXECUTE') AS untrusted_execute,has_function_privilege('nextera_web','app.purge_expired_checkpoint_drafts(timestamptz,integer)','EXECUTE') AS web_purge`;
      expect(acl).toMatchObject({
        direct_web: false,
        untrusted_table: false,
        untrusted_execute: false,
        web_purge: false,
      });
      checks.push('real_catalog_acl_and_default_grant_cleanup');
    });
    it('saves/reads exact BOM, Unicode, NUL, CRLF and empty source through the real repository', async () => {
      const l = await learner(),
        source = '\uFEFFpackage main\r\n// café\u0000';
      const context = await readCheckpointDraftContext(
        drizzle(web, { schema }),
        l.auth,
        l.attempt,
        task,
      );
      expect(context.scope).toEqual(scope(l));
      const first = await saveCheckpointDraft(drizzle(web, { schema }), {
        authId: l.auth,
        scope: scope(l),
        requestId: randomUUID(),
        baseVersion: 0,
        source,
      });
      expect(first).toMatchObject({ kind: 'saved', record: { source, version: 1 } });
      expect(await readCheckpointDraft(drizzle(web, { schema }), l.auth, scope(l))).toMatchObject({
        source,
        version: 1,
      });
      expect(
        await saveCheckpointDraft(drizzle(web, { schema }), {
          authId: l.auth,
          scope: scope(l),
          requestId: randomUUID(),
          baseVersion: 1,
          source: '',
        }),
      ).toMatchObject({ kind: 'saved', record: { source: '', version: 2 } });
      checks.push('real_exact_byte_roundtrip_and_empty_clear');
    });
    it('deduplicates concurrent identical requests into one immutable receipt', async () => {
      const l = await learner(),
        request = randomUUID();
      const results = await Promise.all([
        save(l, 'one', 0, request),
        save(l, 'one', 0, request, task, web2),
      ]);
      expect(results.every((r) => r.kind === 'saved' && r.record?.version === 1)).toBe(true);
      expect((await count(l))[0]!.n).toBe('1');
      await expect(save(l, 'different', 0, request)).rejects.toMatchObject({ code: 'PD003' });
      checks.push('real_two_session_idempotency');
    });
    it('accepts exactly one of two different same-base writes and preserves the loser as conflict', async () => {
      const l = await learner();
      const results = await Promise.all([
        save(l, 'left'),
        save(l, 'right', 0, randomUUID(), task, web2),
      ]);
      expect(results.filter((r) => r.kind === 'saved')).toHaveLength(1);
      expect(results.filter((r) => r.kind === 'conflict')).toHaveLength(1);
      expect((await count(l))[0]!.n).toBe('1');
      checks.push('real_two_session_CAS_one_winner_no_overwrite');
    });
    it('keeps task heads independent and reconciles an older original receipt', async () => {
      const l = await learner(),
        request = randomUUID();
      await save(l, 'old', 0, request);
      await save(l, 'new', 1);
      await save(l, 'another task', 0, randomUUID(), checkpointTasks[1]!.key);
      expect(
        await readCheckpointDraft(drizzle(web, { schema }), l.auth, scope(l), request),
      ).toMatchObject({ source: 'old', version: 1 });
      expect(await readCheckpointDraft(drizzle(web, { schema }), l.auth, scope(l))).toMatchObject({
        source: 'new',
        version: 2,
      });
      await expect(save(l, 'old', 0, request, checkpointTasks[1]!.key)).rejects.toMatchObject({
        code: 'PD003',
      });
      checks.push('task_independence_and_original_receipt_reconciliation');
    });
    it('denies cross-user, unknown task, definition mismatch and cross-attempt request reuse', async () => {
      const a = await learner(),
        b = await learner(),
        request = randomUUID();
      await save(a, 'private', 0, request);
      await expect(
        web`SELECT app.read_checkpoint_draft(${b.auth},${a.attempt},${task},${definition},NULL)`,
      ).rejects.toMatchObject({ code: '42501' });
      await expect(save(a, 'x', 0, randomUUID(), 'unknown-task')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(save(a, 'x', 1, randomUUID(), task, web, 'f'.repeat(64))).rejects.toMatchObject({
        code: 'PD002',
      });
      const other = await learner(a);
      await expect(save(other, 'private', 0, request)).rejects.toMatchObject({ code: 'PD003' });
      checks.push('real_scope_definition_and_attempt_denial');
    });
    it('blocks reads and writes after enrollment or user access is removed', async () => {
      for (const mode of ['membership', 'user']) {
        const l = await learner();
        await save(l, 'retained');
        if (mode === 'membership')
          await admin`UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=${l.cohort} AND user_id=${l.user}`;
        else await admin`UPDATE app.users SET active=false WHERE id=${l.user}`;
        await expect(
          web`SELECT app.read_checkpoint_draft(${l.auth},${l.attempt},${task},${definition},NULL)`,
        ).rejects.toMatchObject({ code: '42501' });
        await expect(save(l, 'blocked', 1)).rejects.toMatchObject({ code: '42501' });
        expect((await count(l))[0]!.n).toBe('1');
      }
      checks.push('real_access_removal_hides_and_blocks_without_silent_delete');
    });
    it('rechecks a concurrent access removal after waiting for its row lock', async () => {
      const l = await learner(),
        pid = await waitForLock(web);
      let release!: () => void, updated!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve)),
        seen = new Promise<void>((resolve) => (updated = resolve));
      const removal = admin.begin(async (tx) => {
        await tx`UPDATE app.cohort_memberships SET status='inactive' WHERE cohort_id=${l.cohort} AND user_id=${l.user}`;
        updated();
        await gate;
      });
      await seen;
      const pending = save(l, 'must not save').then(
        (data) => ({ data }),
        (error) => ({ error }),
      );
      try {
        await waitBlocked(pid);
      } finally {
        release();
        await removal;
      }
      expect(await pending).toMatchObject({ error: { code: '42501' } });
      expect((await count(l))[0]!.n).toBe('0');
      checks.push('real_two_session_access_removal_race');
    });
    it('serializes finish before a waiting save and does not accept late intake', async () => {
      const l = await learner(),
        pid = await waitForLock(web2);
      let release!: () => void, closed!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve)),
        seen = new Promise<void>((resolve) => (closed = resolve));
      const finishing = web.begin(async (tx) => {
        await tx`SELECT app.finish_checkpoint(${l.auth},${l.attempt})`;
        closed();
        await gate;
      });
      await seen;
      const pending = save(l, 'late', 0, randomUUID(), task, web2).then(
        (data) => ({ data }),
        (error) => ({ error }),
      );
      try {
        await waitBlocked(pid);
      } finally {
        release();
        await finishing;
      }
      expect(await pending).toMatchObject({ error: { code: 'PD001' } });
      expect((await count(l))[0]!.n).toBe('0');
      checks.push('real_two_session_finish_deadline_ordering');
    });
    it('rolls back a successful save with its enclosing transaction', async () => {
      const l = await learner(),
        request = randomUUID();
      await expect(
        web.begin(async (tx) => {
          const bytes = Buffer.from('rollback');
          await tx`SELECT app.save_checkpoint_draft(${l.auth},${l.attempt},${task},${definition},${request},0::bigint,decode(${bytes.toString('base64')},'base64'),${digest(bytes)})`;
          throw new Error('intentional rollback');
        }),
      ).rejects.toThrow('intentional rollback');
      expect((await count(l))[0]!.n).toBe('0');
      expect((await save(l, 'rollback', 0, request)).record?.version).toBe(1);
      checks.push('real_save_transaction_rollback');
    });
    it('enforces explicit storage bounds without consuming graded quota', async () => {
      const l = await learner();
      await save(l, '1');
      await save(l, '2', 1);
      await save(l, '3', 2);
      await expect(save(l, '4', 3)).rejects.toMatchObject({ code: 'PD004' });
      const bytes = await learner();
      await save(bytes, 'a'.repeat(100));
      await expect(save(bytes, 'b'.repeat(100), 1)).rejects.toMatchObject({ code: 'PD004' });
      await expect(save(bytes, 'x'.repeat(129), 1)).rejects.toMatchObject({ code: '22023' });
      checks.push('real_storage_capacity_and_source_bounds');
    });
    it('fails closed on disabled policy and prevents used-policy/source mutation', async () => {
      const l = await learner();
      await save(l, 'immutable');
      await expect(
        admin`UPDATE app.checkpoint_draft_revisions SET source_bytes=decode('','base64') WHERE attempt_id=${l.attempt}`,
      ).rejects.toThrow('immutable');
      await expect(
        admin`UPDATE app.checkpoint_draft_policies SET retention_after_deadline_seconds=999 WHERE curriculum_version_id=${version}`,
      ).rejects.toThrow('immutable');
      await policy(false);
      try {
        await expect(save(l, 'blocked', 1)).rejects.toMatchObject({ code: 'PD005' });
      } finally {
        await policy(true);
      }
      checks.push('real_policy_hold_and_immutability');
    });
    it('enforces real expired intake and only purges already-expired source in bounded batches', async () => {
      const recent = await pastAttempt(await learner(), 1);
      const recentRequest = await historicalReceipt(recent);
      await expect(save(recent, 'late', 1)).rejects.toMatchObject({ code: 'PD001' });
      expect(
        await readCheckpointDraft(
          drizzle(web, { schema }),
          recent.auth,
          scope(recent),
          recentRequest,
        ),
      ).toMatchObject({ source: 'history', version: 1 });
      const expired = await pastAttempt(await learner(), 120);
      await historicalReceipt(expired);
      await expect(
        web`SELECT app.read_checkpoint_draft(${expired.auth},${expired.attempt},${task},${definition},NULL)`,
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        admin`SELECT app.purge_expired_checkpoint_drafts(clock_timestamp(),NULL)`,
      ).rejects.toThrow('Invalid cleanup batch');
      const purged = (
        await admin`SELECT app.purge_expired_checkpoint_drafts(clock_timestamp()+interval '1 year',1) AS n`
      )[0]!.n;
      expect(purged).toBe(1);
      expect((await count(expired))[0]!.n).toBe('0');
      expect((await count(recent))[0]!.n).toBe('1');
      checks.push('real_expiry_read_denial_and_bounded_purge');
    });
  },
);
