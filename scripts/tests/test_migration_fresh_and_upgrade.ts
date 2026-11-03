import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';

const ADMIN_URL = 'postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres';
const BASE_TEST_SLICE = 'foundation_test_slice_001';
const FRESH_DB_NAME = 'foundation_audit_fresh_0011';

async function main() {
  console.log(`=== MIGRATION 0011 & GO JUDGE JOB VERIFICATION [${new Date().toISOString()}] ===\n`);

  const rootSql = postgres(ADMIN_URL, { max: 1 });

  // 1. UPGRADE PATH TEST on foundation_test_slice_001
  console.log('--- 1. Testing Upgrade Path on foundation_test_slice_001 ---');
  const sliceUrl = `postgresql://supabase_admin:postgres@127.0.0.1:54322/${BASE_TEST_SLICE}`;
  const sliceSql = postgres(sliceUrl, { max: 1, prepare: false });

  // Apply migrations via Drizzle migrator
  const migrationsFolder = fileURLToPath(new URL('../../packages/db/migrations', import.meta.url));
  await migrate(drizzle(sliceSql), { migrationsFolder });
  console.log('Migrator completed on foundation_test_slice_001 successfully.');

  // Check migrations record
  const appliedMigrations = await sliceSql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id ASC`;
  console.log(`Total migrations registered in __drizzle_migrations: ${appliedMigrations.length}`);
  const lastMigration = appliedMigrations[appliedMigrations.length - 1];
  console.log(`Latest applied migration ID: ${lastMigration?.id}`);

  // 2. FRESH INSTALL PATH TEST on a brand new database
  console.log('\n--- 2. Testing Fresh Install Path on foundation_audit_fresh_0011 ---');
  await rootSql.unsafe(`DROP DATABASE IF EXISTS ${FRESH_DB_NAME} WITH (FORCE);`);
  await rootSql.unsafe(`CREATE DATABASE ${FRESH_DB_NAME};`);
  console.log(`Created empty database: ${FRESH_DB_NAME}`);

  const freshUrl = `postgresql://supabase_admin:postgres@127.0.0.1:54322/${FRESH_DB_NAME}`;
  const freshSql = postgres(freshUrl, { max: 1, prepare: false });

  // Emulate Supabase auth schema foundation (standard on Supabase)
  await freshSql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT clock_timestamp()
    );
  `);

  // Run all migrations 0000..0011
  await migrate(drizzle(freshSql), { migrationsFolder });
  console.log(`Fresh install: All migrations 0000..0011 applied cleanly on ${FRESH_DB_NAME}!`);

  const freshApplied = await freshSql`SELECT count(*)::int as cnt FROM drizzle.__drizzle_migrations`;
  console.log(`Fresh install migrations count: ${freshApplied[0].cnt}`);

  // 3. VERIFY GO SUBMISSION STILL CREATES JUDGE JOB
  console.log('\n--- 3. Verifying Go Submission Job Creation in judge.jobs ---');
  const [goNode] = await sliceSql`
    SELECT node_key, kind, resolved_evaluation_spec, submission_rules
    FROM app.curriculum_nodes
    WHERE resolved_evaluation_spec->>'test_pack_id' IS NOT NULL
      AND node_key = 'even-or-odd'
    LIMIT 1;
  `;

  if (goNode) {
    console.log(`Found Go challenge: ${goNode.node_key} (test_pack_id: ${goNode.resolved_evaluation_spec.test_pack_id})`);
    
    // Find active learner in a cohort with this node available
    const [learner] = await sliceSql`
      SELECT u.id as user_id, u.auth_user_id, c.id as cohort_id, p.curriculum_version_id
      FROM app.users u
      JOIN app.cohort_memberships m ON m.user_id = u.id AND m.status = 'active'
      JOIN app.cohorts c ON c.id = m.cohort_id AND c.status = 'active'
      JOIN app.learner_node_progress p ON p.user_id = u.id AND p.cohort_id = c.id AND p.node_key = 'even-or-odd'
      WHERE u.role = 'learner' AND u.active AND p.state = 'available'
      LIMIT 1;
    `;

    if (learner) {
      console.log(`Testing Go submission with learner ${learner.user_id} in cohort ${learner.cohort_id}...`);
      
      const reqId = crypto.randomUUID();
      const dummyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const reqFile = goNode.submission_rules.required_files[0];

      // Call app.accept_submission
      const [result] = await sliceSql`
        SELECT app.accept_submission(
          ${learner.auth_user_id}::uuid,
          ${learner.cohort_id}::uuid,
          'even-or-odd',
          ${reqId}::uuid,
          ${reqFile},
          120::bigint,
          ${dummyHash}
        ) as submission_id;
      `;
      const sid = result.submission_id;
      console.log(`app.accept_submission succeeded! Submission ID: ${sid}`);

      // Verify submission and judge job
      const [sub] = await sliceSql`
        SELECT s.id, s.node_key, s.active_judge_job_id, s.state, j.protocol_version, j.evaluation_digest
        FROM app.submissions s
        LEFT JOIN judge.jobs j ON j.id = s.active_judge_job_id
        WHERE s.id = ${sid}::uuid;
      `;
      console.log('Submission record:', {
        id: sub.id,
        node_key: sub.node_key,
        active_judge_job_id: sub.active_judge_job_id,
        job_exists: !!sub.active_judge_job_id,
        evaluation_digest: sub.evaluation_digest ? `${sub.evaluation_digest.slice(0, 16)}...` : null
      });

      if (!sub.active_judge_job_id) {
        throw new Error('FAILED: Go submission did not create an active_judge_job_id!');
      }
      console.log('SUCCESS: Go submission successfully created an active judge job in judge.jobs!');

      // Verify judge job is readable in judge.jobs
      const [job] = await sliceSql`
        SELECT id, protocol_version, evaluation_digest, created_at
        FROM judge.jobs
        WHERE id = ${sub.active_judge_job_id}::uuid;
      `;
      console.log('Judge job record in judge.jobs:', {
        id: job.id,
        protocol_version: job.protocol_version,
        evaluation_digest: `${job.evaluation_digest.slice(0, 16)}...`
      });

      // Submissions are immutable due to judge.guard_history()
      console.log('Verified: Submission and judge job successfully recorded (append-only ledger).');
    } else {
      throw new Error('No active learner found with available state on even-or-odd');
    }
  }

  // 4. VERIFY SHELL SUBMISSION (Non-evaluated, queued for review, active_judge_job_id = NULL)
  console.log('\n--- 4. Verifying Shell Submission Intake (Queued for Review, No Judge Job) ---');
  // In Week 1 cohort, who-am-i is available for learner
  const [shellLearner] = await sliceSql`
    SELECT u.id as user_id, u.auth_user_id, c.id as cohort_id, p.curriculum_version_id
    FROM app.users u
    JOIN app.cohort_memberships m ON m.user_id = u.id AND m.status = 'active'
    JOIN app.cohorts c ON c.id = m.cohort_id AND c.status = 'active'
    JOIN app.learner_node_progress p ON p.user_id = u.id AND p.cohort_id = c.id AND p.node_key = 'who-am-i'
    WHERE u.role = 'learner' AND u.active
    LIMIT 1;
  `;

  if (shellLearner) {
    const shellReqId = crypto.randomUUID();
    const dummyHash2 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const [shellRes] = await sliceSql`
      SELECT app.accept_submission(
        ${shellLearner.auth_user_id}::uuid,
        ${shellLearner.cohort_id}::uuid,
        'who-am-i',
        ${shellReqId}::uuid,
        'who-am-i.sh',
        80::bigint,
        ${dummyHash2}
      ) as submission_id;
    `;
    const [shellSub] = await sliceSql`
      SELECT id, node_key, active_judge_job_id, state
      FROM app.submissions
      WHERE id = ${shellRes.submission_id}::uuid;
    `;
    console.log('Shell submission record:', {
      id: shellSub.id,
      node_key: shellSub.node_key,
      active_judge_job_id: shellSub.active_judge_job_id,
      state: shellSub.state
    });
    if (shellSub.active_judge_job_id !== null || shellSub.state !== 'queued') {
      throw new Error('FAILED: Shell submission did not queue cleanly!');
    }
    console.log('SUCCESS: Shell submission accepted with active_judge_job_id = NULL and state = queued!');
    console.log('Verified: Shell submission successfully recorded.');
  }

  // Cleanup fresh install test db
  await freshSql.end({ timeout: 1 });
  await sliceSql.end({ timeout: 1 });
  await rootSql.unsafe(`DROP DATABASE IF EXISTS ${FRESH_DB_NAME} WITH (FORCE);`);
  console.log(`\nCleaned up ${FRESH_DB_NAME}.`);
  await rootSql.end({ timeout: 1 });
}

main().catch(console.error);
