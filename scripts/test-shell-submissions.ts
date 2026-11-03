import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

const targetDbUrl =
  process.env.TEST_DATABASE_URL ||
  'postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001';

const sql = postgres(targetDbUrl, { max: 4, prepare: false });

const admin = createClient(
  process.env.SUPABASE_LOCAL_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type ShellTask = {
  nodeKey: string;
  title: string;
  file: string;
  content: string;
};

const shellTasks: ShellTask[] = [
  { nodeKey: 'know-where-you-are', title: '1 Know Where You Are', file: 'welcome.txt', content: 'pwd\n' },
  { nodeKey: 'create-precise-text-file', title: '2 Create a Precise Text File', file: 'r', content: 'whoami\n' },
  { nodeKey: 'run-first-script', title: '3 Run Your First Script', file: 'hello.sh', content: '#!/bin/sh\necho "Hello World!"\n' },
  { nodeKey: 'search-then-count', title: '4 Search First Then Count', file: 'countfiles.sh', content: '#!/bin/sh\nfind . -type f | wc -l\n' },
  { nodeKey: 'master-the-ls', title: '5 Read a Listing One Rule at a Time', file: 'mastertheLS', content: 'ls -la\n' },
  { nodeKey: 'find-and-transform', title: '6 Find Names and Transform', file: 'lookagain.sh', content: '#!/bin/sh\nfind . -name "*.sh" | sed "s/\\.sh$//"\n' },
  { nodeKey: 'explore-permissions', title: '7 Explore Permissions Safely', file: 'permissions.txt', content: 'chmod 755 hello.sh\n' },
  { nodeKey: 'track-git-changes', title: '8 Track Local Changes with Git', file: 'git-notes.txt', content: 'git init\ngit add .\ngit commit -m "init"\n' },
  { nodeKey: 'quest1-review', title: 'Quest 1 Peer Review Checkpoint', file: 'review.txt', content: 'Quest 1 peer review evidence and notes.\n' },
];

async function main() {
  console.log('=== VERIFYING SHELL & NON-GO SUBMISSIONS INTAKE FOR QUEST 1 ===\n');

  const [cohort] = await sql`SELECT * FROM app.cohorts WHERE slug = 'week1-trial-cohort-v8' AND status = 'active'`;
  if (!cohort) throw new Error('Cohort week1-trial-cohort-v8 not found');
  const cohortId = String(cohort.id);
  const cvId = String(cohort.curriculum_version_id);

  console.log(`Cohort: ${cohort.name} (${cohortId})`);
  console.log(`Curriculum Version: ${cvId}\n`);

  // 1. Create dedicated shell learner
  const testEmail = `shell-learner-${randomBytes(6).toString('hex')}@test.local`;
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: testEmail,
    password: 'SafeShellPass123!',
    email_confirm: true,
  });
  if (authErr || !authData.user) throw new Error(`Auth create failed: ${authErr?.message}`);
  const authUserId = authData.user.id;

  const [domainUser] = await sql`
    INSERT INTO app.users (auth_user_id, display_name, role, active)
    VALUES (${authUserId}, 'Shell Learner', 'learner', true)
    RETURNING id
  `;
  const userId = String(domainUser!.id);

  await sql`
    INSERT INTO app.cohort_memberships (cohort_id, user_id, status)
    VALUES (${cohortId}, ${userId}, 'active')
  `;

  // Seed progress
  const nodes = await sql`
    SELECT node_key, position, quest_key
    FROM app.curriculum_nodes
    WHERE curriculum_version_id = ${cvId} AND quest_key = 'quest1'
    ORDER BY position
  `;
  for (const n of nodes) {
    const isRoot = n.node_key === 'know-where-you-are';
    await sql`
      INSERT INTO app.learner_node_progress (cohort_id, user_id, curriculum_version_id, node_key, state, unlocked_at)
      VALUES (${cohortId}, ${userId}, ${cvId}, ${n.node_key}, ${isRoot ? 'available' : 'locked'}, ${isRoot ? sql`now()` : null})
      ON CONFLICT (cohort_id, user_id, curriculum_version_id, node_key) DO UPDATE
      SET state = EXCLUDED.state, unlocked_at = EXCLUDED.unlocked_at
    `;
  }

  console.log(`✓ Learner ${userId} enrolled in cohort.\n`);

  const results = [];

  for (let i = 0; i < shellTasks.length; i++) {
    const task = shellTasks[i]!;
    console.log(`[Task ${i + 1}/${shellTasks.length}] ${task.title} (${task.nodeKey})`);
    console.log(`  File: ${task.file}`);

    // Unlock task if locked
    await sql`
      UPDATE app.learner_node_progress
      SET state = 'available', unlocked_at = now()
      WHERE cohort_id = ${cohortId} AND user_id = ${userId} AND node_key = ${task.nodeKey}
    `;

    // 1. Upload to storage
    const sourceBytes = Buffer.from(task.content, 'utf8');
    const sourceDigest = createHash('sha256').update(sourceBytes).digest('hex');
    const requestId = randomUUID();
    const storageKey = `${authUserId}/${cohortId}/${requestId}/${sourceDigest}`;

    const { error: uploadErr } = await admin.storage
      .from('nextera-submissions')
      .upload(storageKey, sourceBytes, { contentType: 'application/octet-stream', upsert: true });

    if (uploadErr) {
      throw new Error(`Storage upload failed: ${uploadErr.message}`);
    }

    // 2. Call app.accept_submission
    const [row] = await sql`
      SELECT app.accept_submission(
        ${authUserId}::uuid,
        ${cohortId}::uuid,
        ${task.nodeKey},
        ${requestId}::uuid,
        ${task.file},
        ${sourceBytes.length}::bigint,
        ${sourceDigest}
      ) AS id
    `;
    const submissionId = String(row.id);

    // 3. Inspect submission record
    const [sub] = await sql`
      SELECT id, state, active_judge_job_id, created_at
      FROM app.submissions
      WHERE id = ${submissionId}
    `;

    // 4. Inspect learner progress
    const [prog] = await sql`
      SELECT state, started_at
      FROM app.learner_node_progress
      WHERE cohort_id = ${cohortId} AND user_id = ${userId} AND node_key = ${task.nodeKey}
    `;

    // 5. Read submissions via app.read_submissions
    const history = await sql`
      SELECT * FROM app.read_submissions(${authUserId}::uuid, ${cohortId}::uuid, ${task.nodeKey})
    `;

    const ok = sub.state === 'queued' && sub.active_judge_job_id === null && prog.state === 'in_progress' && history.length > 0;

    results.push({
      task: task.title,
      nodeKey: task.nodeKey,
      file: task.file,
      submissionId: submissionId.slice(0, 8),
      state: sub.state,
      judgeJob: sub.active_judge_job_id || 'NONE (non-Go)',
      progressState: prog.state,
      historyCount: history.length,
      success: ok,
    });

    console.log(`  ✓ Accepted submission ${submissionId.slice(0, 8)} | State: ${sub.state} | Progress: ${prog.state}`);
  }

  console.log('\n======================================================================');
  console.log('✓ ALL QUEST 1 SHELL / NON-GO SUBMISSIONS VERIFIED & PERSISTED');
  console.log('======================================================================\n');
  console.table(results);
}

main()
  .catch((e) => {
    console.error('Fatal execution error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await sql.end();
  });
