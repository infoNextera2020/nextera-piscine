/** Local, disposable UI verification only. No real curriculum or executable pack publication. */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { parse, stringify } from 'yaml';
import { checkpointFixture, checkpointTasks } from './checkpoints';
import { parseCurriculum } from '../../scripts/curriculum/load';
import { evaluationDigest } from '../../scripts/curriculum/digest';
import { importCurriculum } from '../../packages/db/operations/curriculum';
import { createCohort, enrollLearner } from '../../packages/db/operations/cohorts';
import { applyResult } from '../../packages/db/operations/results';
import * as schema from '../../packages/db/schema/index';

export type LearningFixture = {
  database: string;
  webDatabase: string;
  supabaseUrl: string;
  publishableKey: string;
  cohort: string;
  foreignCohort: string;
  learner: string;
  authId: string;
  password: string;
  emptyLearner: string;
  emptyAuthId: string;
  roles: string[];
  authIds: string[];
  assessments?: Record<string, { email: string; authId: string; attempt: string }>;
};
function curriculum() {
  const f = checkpointFixture({ prerequisites: true });
  const files = f.files.map((file) => {
    if (!file.path.endsWith('/manifest.yaml')) return file;
    const value = parse(Buffer.from(file.bytes).toString()) as {
      quests: { id: string; title: string; order: number }[];
      nodes: { id: string; quest: string }[];
      edges: { from: string; to: string; rule: string }[];
    };
    value.quests = [
      { id: 'first-steps', title: 'First Steps in Go', order: 1 },
      { id: 'control-flow', title: 'Conditions & Functions', order: 2 },
      { id: 'next-chapter', title: 'Problem Solving', order: 3 },
      { id: 'practice-lab', title: 'Practice Lab', order: 4 },
    ];
    for (const n of value.nodes)
      n.quest =
        n.id === 'hello-go'
          ? 'first-steps'
          : n.id === 'even-or-odd' || n.id === 'transfer-checkpoint'
            ? 'control-flow'
            : n.id === 'after-checkpoint'
              ? 'next-chapter'
              : 'practice-lab';
    value.edges.push({ from: 'hello-go', to: 'even-or-odd', rule: 'requires_pass' });
    return { ...file, bytes: Buffer.from(stringify(value)) };
  });
  const c = parseCurriculum(files);
  const context = {
    curriculum_key: c.key,
    curriculum_version: c.version,
    content_digest: c.contentDigest,
  };
  const evaluations = f.evaluations.map((e) => {
    let spec: Record<string, unknown> = { ...e.spec, ...context };
    if ('checkpoint' in e && e.checkpoint) {
      const definition = {
        ...e.checkpoint,
        tasks: e.checkpoint.tasks.map((t) => {
          const evaluationSpec = { ...t.evaluationSpec, ...context };
          return { ...t, evaluationSpec, evaluationDigest: evaluationDigest(evaluationSpec) };
        }),
      };
      spec = { ...spec, checkpoint_definition: definition };
      return { ...e, spec, digest: evaluationDigest(spec), checkpoint: definition };
    }
    return { ...e, spec, digest: evaluationDigest(spec) };
  });
  return { curriculum: c, evaluations, gitCommitSha: f.gitCommitSha };
}
export async function prepareLearningFixture(options: { assessments?: boolean } = {}) {
  const owner = new URL(process.env.MIGRATION_DATABASE_URL!);
  if (owner.hostname !== '127.0.0.1' || owner.port !== '54322' || owner.pathname !== '/postgres')
    throw new Error('Local Supabase owner required for isolated UI verification.');
  const supabaseUrl = process.env.SUPABASE_LOCAL_URL!;
  if (new URL(supabaseUrl).hostname !== '127.0.0.1') throw new Error('Local Auth required.');
  const auth = createClient(supabaseUrl, process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const root = postgres(owner.toString(), { max: 1, prepare: false, onnotice: () => {} });
  const target = new URL(owner);
  target.pathname = '/foundation_test_ui001_' + randomBytes(6).toString('hex');
  await root.unsafe('CREATE DATABASE ' + target.pathname.slice(1));
  await root.end();
  const admin = postgres(target.toString(), { max: 2, prepare: false, onnotice: () => {} });
  const roles: string[] = [],
    authIds: string[] = [];
  const clients: ReturnType<typeof postgres>[] = [];
  const password = randomBytes(24).toString('hex');
  try {
    await admin.unsafe('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)');
    await migrate(drizzle(admin), { migrationsFolder: resolve('packages/db/migrations') });
    const f = curriculum();
    const version = await importCurriculum(
      drizzle(admin, { schema }),
      f.curriculum,
      f.gitCommitSha,
      f.evaluations,
    );
    const cohort = await createCohort(drizzle(admin, { schema }), {
      slug: 'foundation-test-ui-' + randomUUID(),
      name: 'Piscine · UI review fixture',
      curriculumVersionId: version.id,
      startsAt: new Date('2026-11-20T00:00:00Z'),
    });
    const foreign = await createCohort(drizzle(admin, { schema }), {
      slug: 'foundation-test-ui-foreign-' + randomUUID(),
      name: 'Other cohort · isolated fixture',
      curriculumVersionId: version.id,
      startsAt: new Date('2026-11-20T00:00:00Z'),
    });
    async function person(name: string) {
      const email = 'ui-review-' + randomBytes(6).toString('hex') + '@example.test';
      const { data, error } = await auth.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: 'admin' },
      });
      if (error || !data.user) throw new Error('Local UI Auth fixture creation failed.');
      const id = data.user.id;
      authIds.push(id);
      await admin.unsafe('INSERT INTO auth.users(id) VALUES($1)', [id]);
      const [row] = await admin.unsafe(
        'INSERT INTO app.users(auth_user_id,display_name) VALUES($1,$2) RETURNING id',
        [id, name],
      );
      return { email, authId: id, id: String(row!.id) };
    }
    const learner = await person('Review Learner'),
      empty = await person('New Learner');
    await enrollLearner(drizzle(admin, { schema }), cohort.id, learner.id);
    async function login(role: string) {
      const name = 'ui001_' + randomBytes(10).toString('hex'),
        secret = randomBytes(24).toString('hex');
      roles.push(name);
      await admin.unsafe(
        'CREATE ROLE ' +
          name +
          " LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '" +
          secret +
          "'",
      );
      await admin.unsafe('GRANT ' + role + ' TO ' + name);
      const url = new URL(target);
      url.username = name;
      url.password = secret;
      const client = postgres(url.toString(), { max: 2, prepare: false, onnotice: () => {} });
      clients.push(client);
      return { name, url: url.toString(), client };
    }
    const web = await login('nextera_web'),
      product = await login('nextera_result_application'),
      runner = await login('nextera_runner');
    const spec = f.evaluations[0]!.spec;
    await admin.unsafe(
      "INSERT INTO judge.workers(db_principal,runner_image_digest,protocol_versions,platform,capabilities) VALUES($1,$2,ARRAY[1],'linux/amd64',$3::jsonb)",
      [
        runner.name,
        String(spec.runner_image_digest),
        JSON.stringify({
          toolchain_version: spec.toolchain_version,
          resource_profile: spec.resource_profile,
          snapshot_format_version: 1,
          sandbox_image_digest: spec.sandbox_image_digest,
          fixture_cohort_ids: [cohort.id],
        }),
      ],
    );
    async function submit(node: string, authId = learner.authId) {
      const filename = f.curriculum.nodes.find((n) => n.key === node)!.submissionRules
        .required_files[0]!;
      const bytes = Buffer.from('package main\n');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const [row] = await web.client.unsafe(
        'SELECT app.accept_submission($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::bigint,$7) AS id',
        [authId, cohort.id, node, randomUUID(), filename, bytes.length, hash],
      );
      return String(row!.id);
    }
    async function result(
      id: string,
      verdict: 'passed' | 'failed' | 'system_error' | 'compile_error' | 'runtime_error' | 'timeout',
    ) {
      const [submission] = await admin.unsafe(
        'SELECT active_judge_job_id AS job FROM app.submissions WHERE id=$1',
        [id],
      );
      let resultId = '';
      for (let i = 0; i < (verdict === 'system_error' ? 3 : 1); i++) {
        await admin.unsafe(
          "UPDATE judge.jobs SET available_at=clock_timestamp()-interval '1 day' WHERE id=$1",
          [submission!.job],
        );
        const [row] = await runner.client.unsafe('SELECT judge.claim_job() AS claim');
        const claim = row!.claim as {
          job_id: string;
          attempt_id: string;
          token: string;
          generation: number;
        };
        if (claim?.job_id !== submission!.job) throw new Error('UI fixture worker claim mismatch.');
        const args = [claim.job_id, claim.attempt_id, claim.token, claim.generation];
        await recordExecution(args);
        const [record] = await runner.client.unsafe(
          verdict === 'system_error'
            ? "SELECT judge.record_infrastructure_failure($1::uuid,$2::uuid,$3::uuid,$4::bigint,'WORKER_FAILURE') AS id"
            : "SELECT judge.record_result($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5,'{}'::jsonb) AS id",
          verdict === 'system_error' ? args : [...args, verdict],
        );
        resultId = String(record!.id);
      }
      await applyResult(drizzle(product.client), resultId);
    }
    async function recordExecution(args: (string | number)[]) {
      // A local host clock correction can briefly precede the accepted timestamp.
      // Preserve the production guard; retry only its rolled-back fixture call.
      for (let retry = 0; ; retry++) {
        try {
          await runner.client.unsafe(
            'SELECT judge.record_execution_attempt($1::uuid,$2::uuid,$3::uuid,$4::bigint)',
            args,
          );
          return;
        } catch (error) {
          if (
            retry >= 20 ||
            (error as { constraint_name?: string }).constraint_name !==
              'submissions_timestamps_check'
          )
            throw error;
          await admin.unsafe('SELECT pg_sleep(0.1)');
        }
      }
    }
    await result(await submit('hello-go'), 'passed');
    await result(await submit('even-or-odd'), 'failed');
    await result(await submit('even-or-odd'), 'system_error');
    const pendingId = await submit('even-or-odd');
    const assessments: NonNullable<LearningFixture['assessments']> = {};
    if (options.assessments) {
      await result(pendingId, 'compile_error');
      await result(await submit('even-or-odd'), 'runtime_error');
      await result(await submit('even-or-odd'), 'timeout');
      for (const scenario of ['pass', 'fail', 'infra', 'active', 'ready']) {
        const personRow = await person('Assessment ' + scenario);
        await enrollLearner(drizzle(admin, { schema }), cohort.id, personRow.id);
        await result(await submit('hello-go', personRow.authId), 'passed');
        await result(await submit('even-or-odd', personRow.authId), 'passed');
        if (scenario === 'ready') {
          assessments[scenario] = { email: personRow.email, authId: personRow.authId, attempt: '' };
          continue;
        }
        const [started] = await web.client.unsafe(
          'SELECT app.start_checkpoint($1::uuid,$2::uuid,$3,$4::uuid) AS id',
          [personRow.authId, cohort.id, 'transfer-checkpoint', randomUUID()],
        );
        const attempt = String(started!.id);
        assessments[scenario] = { email: personRow.email, authId: personRow.authId, attempt };
        for (const [index, task] of checkpointTasks.entries()) {
          const bytes = Buffer.from('package main\n');
          const [accepted] = await web.client.unsafe(
            'SELECT app.accept_checkpoint_submission($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::bigint,$7) AS id',
            [
              personRow.authId,
              attempt,
              task.key,
              randomUUID(),
              task.file,
              bytes.length,
              createHash('sha256').update(bytes).digest('hex'),
            ],
          );
          const verdict =
            index < 2 || (scenario === 'pass' && index === 2)
              ? 'passed'
              : index === 3 && (scenario === 'infra' || scenario === 'active')
                ? 'system_error'
                : 'failed';
          await result(String(accepted!.id), verdict);
        }
        if (scenario !== 'active') {
          await web.client.unsafe('SELECT app.finish_checkpoint($1::uuid,$2::uuid)', [
            personRow.authId,
            attempt,
          ]);
          await product.client.unsafe('SELECT app.finalize_checkpoint($1::uuid)', [attempt]);
        }
      }
      await submit('even-or-odd');
      const [running] = await runner.client.unsafe('SELECT judge.claim_job() AS claim');
      const claim = running!.claim as {
        job_id: string;
        attempt_id: string;
        token: string;
        generation: number;
      };
      await recordExecution([claim.job_id, claim.attempt_id, claim.token, claim.generation]);
      await submit('even-or-odd');
    }
    const fixture: LearningFixture = {
      database: target.toString(),
      webDatabase: web.url,
      supabaseUrl,
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      cohort: cohort.id,
      foreignCohort: foreign.id,
      learner: learner.email,
      authId: learner.authId,
      password,
      emptyLearner: empty.email,
      emptyAuthId: empty.authId,
      roles,
      authIds,
      ...(options.assessments ? { assessments } : {}),
    };
    const directory = await mkdtemp(join(tmpdir(), 'nextera-ui001-'));
    await chmod(directory, 0o700);
    const path = join(directory, 'fixture.json');
    await writeFile(path, JSON.stringify(fixture), { mode: 0o600, flag: 'wx' });
    return { path, fixture };
  } catch (error) {
    for (const id of authIds) await auth.auth.admin.deleteUser(id);
    for (const role of roles) await admin.unsafe('ALTER ROLE ' + role + ' NOLOGIN');
    throw error;
  } finally {
    for (const c of clients) await c.end();
    await admin.end();
  }
}
export async function cleanupLearningFixture(fixture: LearningFixture) {
  const target = new URL(fixture.database);
  if (target.hostname !== '127.0.0.1' || !target.pathname.startsWith('/foundation_test_ui001_'))
    throw new Error('UI fixture cleanup scope mismatch.');
  const admin = postgres(target.toString(), { max: 1, prepare: false, onnotice: () => {} });
  const auth = createClient(fixture.supabaseUrl, process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    for (const role of fixture.roles) {
      if (!/^ui001_[a-f0-9]+$/.test(role)) throw new Error('Fixture role mismatch.');
      await admin.unsafe('ALTER ROLE ' + role + ' NOLOGIN');
    }
    for (const id of fixture.authIds) await auth.auth.admin.deleteUser(id);
  } finally {
    await admin.end();
  }
}
