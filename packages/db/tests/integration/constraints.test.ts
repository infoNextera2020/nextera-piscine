import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

let client: ReturnType<typeof postgres>;
type Queryable = Pick<ReturnType<typeof postgres>, 'unsafe'>;
const ids = {
  user: randomUUID(),
  authUser: randomUUID(),
  version: randomUUID(),
  otherVersion: randomUUID(),
  cohort: randomUUID(),
  worker: randomUUID(),
  artifact: randomUUID(),
  passingSubmission: randomUUID(),
  otherNodeSubmission: randomUUID(),
};
const hash = 'a'.repeat(64);
const now = new Date(Date.now() - 5000).toISOString();
const later = new Date(Date.now() - 4000).toISOString();
const limits = {
  cpu_limit: 1,
  memory_bytes: 67108864,
  pid_limit: 32,
  timeout_ms: 2000,
  output_bytes: 65536,
  temporary_filesystem_bytes: 16777216,
  temporary_filesystem_inodes: 1024,
};
const snapshot = {
  curriculum_version_id: ids.version,
  curriculum_version: '0.1.0',
  git_commit_sha: 'b'.repeat(40),
  node_key: 'hello-go',
  content_digest: hash,
  subject_digest: hash,
  learner_artifact_digest: hash,
  test_pack_id: 'fixture-only',
  test_pack_digest: hash,
  runner_image_digest: `sha256:${hash}`,
  sandbox_image_digest: `sha256:${hash}`,
  toolchain_version: 'fixture-only',
  target_platform: 'linux/amd64',
  protocol_version: 1,
  snapshot_format_version: 1,
  resource_profile: 'go-functions-pilot-v1',
  resource_limits: {
    compilation: {
      ...limits,
      memory_bytes: 536870912,
      pid_limit: 64,
      timeout_ms: 20000,
      temporary_filesystem_bytes: 268435456,
      temporary_filesystem_inodes: 16384,
    },
    execution: limits,
  },
};

async function makeSubmission(
  tx: Queryable,
  submissionId: string,
  nodeKey: string,
  passed: boolean,
) {
  const jobId = randomUUID();
  await tx.unsafe(
    `INSERT INTO app.submissions
    (id, cohort_id, user_id, curriculum_version_id, node_key, artifact_id, idempotency_key,
     evaluation_spec_digest, active_judge_job_id, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$10,$7,$8,$9)`,
    [
      submissionId,
      ids.cohort,
      ids.user,
      ids.version,
      nodeKey,
      ids.artifact,
      hash,
      jobId,
      now,
      submissionId,
    ],
  );
  await tx.unsafe(
    `INSERT INTO judge.jobs
    (id, submission_id, protocol_version, evaluation_snapshot, evaluation_digest, created_at)
    VALUES ($1,$2,1,$3,$4,$5)`,
    [jobId, submissionId, JSON.stringify(snapshot), hash, now],
  );
  if (passed) {
    const attemptId = randomUUID();
    const resultId = randomUUID();
    await tx.unsafe(
      `INSERT INTO judge.attempts
      (id,job_id,attempt_number,worker_id,lease_generation,claim_token,state,claimed_at,started_at,finished_at)
      VALUES ($1,$2,1,$3,1,$4,'completed',$5,$5,$6)`,
      [attemptId, jobId, ids.worker, randomUUID(), now, later],
    );
    await tx.unsafe(
      `INSERT INTO judge.results
      (id,job_id,attempt_id,evaluation_digest,verdict,measurements,learner_feedback,safe_operator_diagnostics)
      VALUES ($1,$2,$3,$4,'passed','{}','{}','{}')`,
      [resultId, jobId, attemptId, hash],
    );
    await tx.unsafe(
      `UPDATE judge.jobs SET state='completed', current_worker_id=$1,
      current_attempt_id=$2, terminal_result_id=$3, finished_at=$4 WHERE id=$5`,
      [ids.worker, attemptId, resultId, later, jobId],
    );
    await tx.unsafe(
      `UPDATE app.submissions SET state='passed', started_at=$1, finished_at=$2 WHERE id=$3`,
      [now, later, submissionId],
    );
  }
  return jobId;
}

beforeAll(async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error('TEST_DATABASE_URL must identify a local disposable foundation_test database.');
  const target = new URL(connectionString);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !target.pathname.startsWith('/foundation_test')
  ) {
    throw new Error(
      'Integration tests only accept a local database whose name starts with foundation_test.',
    );
  }
  client = postgres(connectionString, { max: 1, prepare: false, onnotice: () => {} });
  // External FK fixture only, in this local test database; no authentication is simulated.
  await client.unsafe('CREATE SCHEMA IF NOT EXISTS auth');
  await client.unsafe('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await client.unsafe(
      `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`,
    );
  }
  const options = { migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)) };
  await migrate(drizzle(client), options);
  await migrate(drizzle(client), options);

  await client.begin(async (tx) => {
    await tx.unsafe('INSERT INTO auth.users(id) VALUES ($1)', [ids.authUser]);
    await tx.unsafe('INSERT INTO app.users(id,auth_user_id,display_name) VALUES ($1,$2,$3)', [
      ids.user,
      ids.authUser,
      'Test learner',
    ]);
    for (const versionId of [ids.version, ids.otherVersion]) {
      await tx.unsafe(
        `INSERT INTO app.curriculum_versions
        (id,curriculum_key,version,git_commit_sha,content_digest,digest_format_version)
        VALUES ($1,$4,'0.1.0',$2,$3,1)`,
        [versionId, 'b'.repeat(40), hash, versionId],
      );
      await tx.unsafe("INSERT INTO app.quests VALUES ($1,'foundations','Foundations',1)", [
        versionId,
      ]);
      for (const [nodeKey, position] of [
        ['hello-go', 1],
        ['even-or-odd', 2],
      ] as const) {
        await tx.unsafe(
          `INSERT INTO app.curriculum_nodes
          (curriculum_version_id,node_key,quest_key,kind,title,position,difficulty,subject_markdown,
           subject_digest,skills,submission_rules,resolved_evaluation_spec,evaluation_spec_digest)
          VALUES ($1,$2,'foundations','challenge',$2,$3,1,'Test subject',$4,'{}','{}',$5,$4)`,
          [versionId, nodeKey, String(position), hash, JSON.stringify(snapshot)],
        );
      }
    }
    await tx.unsafe(
      `INSERT INTO app.cohorts(id,slug,name,curriculum_version_id,status,starts_at)
      VALUES ($1,$4,'Test cohort',$2,'test',$3)`,
      [ids.cohort, ids.version, now, ids.cohort],
    );
    await tx.unsafe('INSERT INTO app.cohort_memberships(cohort_id,user_id) VALUES ($1,$2)', [
      ids.cohort,
      ids.user,
    ]);
    await tx.unsafe(
      `INSERT INTO app.submission_artifacts
      (id,owner_user_id,storage_bucket,storage_key,original_filename,size_bytes,sha256)
      VALUES ($1,$2,'test',$4,'hello.go',1,$3)`,
      [ids.artifact, ids.user, hash, ids.artifact],
    );
    await tx.unsafe(
      `INSERT INTO judge.workers
      (id,db_principal,runner_image_digest,protocol_versions,platform,capabilities)
      VALUES ($1,$3,$2,'{1}','linux/amd64','{}')`,
      [ids.worker, `sha256:${hash}`, ids.worker],
    );
    await makeSubmission(tx, ids.passingSubmission, 'hello-go', true);
    await makeSubmission(tx, ids.otherNodeSubmission, 'even-or-odd', true);
  });
}, 30000);

afterAll(async () => {
  if (client) await client.end();
});

async function insertProgress(
  state: string,
  unlocked: string | null,
  started: string | null,
  mastered: string | null,
  submission: string | null = null,
  version = ids.version,
) {
  return client.unsafe(
    `INSERT INTO app.learner_node_progress
    (cohort_id,user_id,curriculum_version_id,node_key,state,unlocked_at,started_at,mastered_at,first_passing_submission_id)
    VALUES ($1,$2,$3,'hello-go',$4,$5,$6,$7,$8)`,
    [ids.cohort, ids.user, version, state, unlocked, started, mastered, submission],
  );
}

describe('migrated PostgreSQL constraints', () => {
  it('creates exactly sixteen domain tables and a repeatable migration history', async () => {
    const rows = await client<
      { count: string }[]
    >`SELECT count(*)::text AS count FROM information_schema.tables
      WHERE table_schema IN ('app','judge') AND table_type='BASE TABLE'`;
    expect(rows[0]?.count).toBe('16');
    const history = await client`SELECT * FROM drizzle.__drizzle_migrations`;
    expect(history).toHaveLength(2);
  });

  it.each(['locked', 'available', 'in_progress', 'mastered'])(
    'accepts valid %s progress',
    async (state) => {
      await insertProgress(
        state,
        state === 'locked' ? null : now,
        ['in_progress', 'mastered'].includes(state) ? now : null,
        state === 'mastered' ? later : null,
        state === 'mastered' ? ids.passingSubmission : null,
      );
      await client`DELETE FROM app.learner_node_progress WHERE cohort_id=${ids.cohort} AND user_id=${ids.user}`;
    },
  );

  it.each([
    ['locked', now, null, null, null],
    ['available', null, null, null, null],
    ['available', now, now, null, null],
    ['in_progress', now, null, null, null],
    ['in_progress', now, now, later, null],
    ['mastered', now, now, later, null],
    ['mastered', now, now, null, ids.passingSubmission],
    ['in_progress', later, now, null, null],
    ['mastered', now, later, now, ids.passingSubmission],
  ])(
    'rejects invalid progress combination %#',
    async (state, unlocked, started, mastered, submission) => {
      await expect(
        insertProgress(state!, unlocked!, started!, mastered!, submission!),
      ).rejects.toMatchObject({ code: '23514' });
    },
  );

  it('rejects unknown progress states', async () => {
    await expect(insertProgress('complete', null, null, null)).rejects.toMatchObject({
      code: '22P02',
    });
  });

  it('rejects cross-node passing evidence and cross-version cohort progress', async () => {
    await expect(
      insertProgress('mastered', now, now, later, ids.otherNodeSubmission),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      insertProgress('available', now, null, null, null, ids.otherVersion),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('requires the real external identity reference', async () => {
    await expect(
      client`INSERT INTO app.users(auth_user_id,display_name) VALUES (${randomUUID()},'Missing identity')`,
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects a self-edge and a missing version-scoped endpoint', async () => {
    await expect(
      client`INSERT INTO app.node_prerequisites VALUES (${ids.version},'hello-go','hello-go','requires_pass')`,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      client`INSERT INTO app.node_prerequisites VALUES (${ids.version},'hello-go','missing','requires_pass')`,
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('enforces a single active job per submission', async () => {
    await expect(
      client.begin(async (tx) => {
        for (const evaluation of [2, 3])
          await tx`INSERT INTO judge.jobs
        (submission_id,evaluation_number,protocol_version,evaluation_snapshot,evaluation_digest)
        VALUES (${ids.passingSubmission},${evaluation},1,${JSON.stringify(snapshot)},${hash})`;
      }),
    ).rejects.toMatchObject({ code: '23505', constraint_name: 'jobs_one_active_submission_idx' });
  });

  it.each([
    ['retry_count', '3'],
    ['lease_generation', '0'],
    ['protocol_version', '0'],
  ])('rejects invalid job %s', async (column, value) => {
    await expect(
      client.unsafe(
        `INSERT INTO judge.jobs
      (submission_id,evaluation_number,protocol_version,evaluation_snapshot,evaluation_digest,${column === 'protocol_version' ? 'retry_count' : column})
      VALUES ($1,2,${column === 'protocol_version' ? value : '1'},$2,$3,${column === 'protocol_version' ? '0' : value})`,
        [ids.passingSubmission, JSON.stringify(snapshot), hash],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects missing/negative resource budgets and incomplete live leases', async () => {
    for (const bad of [
      {},
      { resource_limits: { compilation: limits, execution: { ...limits, timeout_ms: -1 } } },
    ]) {
      await expect(client`INSERT INTO judge.jobs
        (submission_id,evaluation_number,protocol_version,evaluation_snapshot,evaluation_digest)
        VALUES (${ids.passingSubmission},2,1,${JSON.stringify(bad)},${hash})`).rejects.toMatchObject(
        { code: '23514' },
      );
    }
    await expect(client`INSERT INTO judge.jobs
      (submission_id,evaluation_number,state,protocol_version,evaluation_snapshot,evaluation_digest)
      VALUES (${ids.passingSubmission},2,'claimed',1,${JSON.stringify(snapshot)},${hash})`).rejects.toMatchObject(
      { code: '23514' },
    );
  });

  it('rejects a fourth infrastructure attempt', async () => {
    const [job] =
      await client`SELECT id FROM judge.jobs WHERE submission_id=${ids.passingSubmission}`;
    await expect(client`INSERT INTO judge.attempts(job_id,attempt_number,worker_id,lease_generation,claim_token)
      VALUES (${String(job?.id)},4,${ids.worker},1,${randomUUID()})`).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('rejects processed receipts without a timestamp and negative measurements', async () => {
    await expect(client`UPDATE judge.results SET application_status='applied' WHERE job_id IN
      (SELECT id FROM judge.jobs WHERE submission_id=${ids.passingSubmission})`).rejects.toMatchObject(
      { code: '23514' },
    );
    await expect(client`UPDATE judge.results SET measurements='{"duration_ms":-1}' WHERE job_id IN
      (SELECT id FROM judge.jobs WHERE submission_id=${ids.passingSubmission})`).rejects.toMatchObject(
      { code: '23514' },
    );
  });

  it('defers the circular submission/job reference without allowing an orphan commit', async () => {
    await expect(
      client.begin(async (tx) => {
        const id = randomUUID();
        await tx`INSERT INTO app.submissions
        (id,cohort_id,user_id,curriculum_version_id,node_key,artifact_id,idempotency_key,evaluation_spec_digest,active_judge_job_id)
        VALUES (${id},${ids.cohort},${ids.user},${ids.version},'hello-go',${ids.artifact},${id},${hash},${randomUUID()})`;
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
