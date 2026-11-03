import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../packages/db/schema';
import { applyResult } from '../packages/db/operations/results';

const targetDbUrl =
  process.env.TEST_DATABASE_URL ||
  'postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001';

const sql = postgres(targetDbUrl, { max: 4, prepare: false });
const db = drizzle(sql, { schema });

const admin = createClient(
  process.env.SUPABASE_LOCAL_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const artifacts = 'C:\\Users\\NEXTERA\\nextera-judge-artifacts';
const credentials = 'C:\\Users\\NEXTERA\\nextera-credentials-run003';
const candidate = JSON.parse(readFileSync(join(artifacts, 'candidate.json'), 'utf8'));
const worker = JSON.parse(readFileSync(join(credentials, 'worker.json'), 'utf8'));
const runnerEnv = parse(readFileSync(join(credentials, 'runner.env')));

const toWslPath = (p: string) =>
  p.replace(/^[a-zA-Z]:[\\/]/, (m) => `/mnt/host/${m[0]!.toLowerCase()}/`).replace(/\\/g, '/');

function runWorker() {
  const wslRunner = '/mnt/host/c/Users/NEXTERA/Desktop/nextera-piscine/.tools/runner';
  execFileSync('wsl', [
    'sh',
    '-c',
    `cp "${toWslPath(join(credentials, 'storage-reader.jwt'))}" /tmp/storage-reader.jwt && chmod 0600 /tmp/storage-reader.jwt`,
  ]);
  const args = [
    'env',
    `JUDGE_DATABASE_URL=${runnerEnv.JUDGE_DATABASE_URL}`,
    `JUDGE_STORAGE_PUBLISHABLE_KEY=${runnerEnv.JUDGE_STORAGE_PUBLISHABLE_KEY}`,
    'DOCKER_HOST=/var/run/docker.sock',
    wslRunner,
    'work',
    '--candidate',
    toWslPath(join(artifacts, 'candidate.json')),
    '--layouts',
    toWslPath(artifacts),
    '--runner-image',
    worker.runner_image_digest,
    '--storage-url',
    process.env.SUPABASE_LOCAL_URL || 'http://127.0.0.1:54321',
    '--storage-token-file',
    '/tmp/storage-reader.jwt',
    '--local-fixtures',
    '--once',
  ];
  const child = spawn('wsl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d) => { stdout += d.toString(); });
  child.stderr?.on('data', (d) => { stderr += d.toString(); });
  const exited = new Promise<{ code: number | null }>((resolve) => {
    child.on('exit', (code) => resolve({ code }));
  });
  return { child, exited, getLogs: () => stdout, getErrors: () => stderr };
}

type TaskSolution = {
  nodeKey: string;
  title: string;
  file: string;
  packId: string;
  wrongSource: string;
  correctSource: string;
};

const goTasks: TaskSolution[] = [
  // --- Quest 2 ---
  {
    nodeKey: 'greeting-card',
    title: 'F1 Greeting Card',
    file: 'main.go',
    packId: 'greeting-card-v2',
    wrongSource: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("wrong")\n}\n',
    correctSource: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, Go learner!")\n\tfmt.Println("I can run a program.")\n}\n',
  },
  {
    nodeKey: 'sign-label',
    title: 'F2 Sign Label',
    file: 'signlabel.go',
    packId: 'sign-label-v1',
    wrongSource: 'package main\n\nfunc SignLabel(n int64) string {\n\treturn "wrong"\n}\n',
    correctSource: 'package main\n\nfunc SignLabel(n int64) string {\n\tif n < 0 {\n\t\treturn "negative"\n\t}\n\tif n == 0 {\n\t\treturn "zero"\n\t}\n\treturn "positive"\n}\n',
  },
  {
    nodeKey: 'count-up-and-down',
    title: 'L1 Count Up and Down',
    file: 'main.go',
    packId: 'count-up-and-down-v2',
    wrongSource: 'package main\n\nfunc main() {}\n',
    correctSource: 'package main\n\nimport ("fmt"; "os")\n\nfunc main() {\n\tvar n int\n\tif _, err := fmt.Fscan(os.Stdin, &n); err != nil || n <= 0 {\n\t\treturn\n\t}\n\tfor i := 1; i <= n; i++ {\n\t\tfmt.Println(i)\n\t}\n\tfor i := n; i >= 1; i-- {\n\t\tfmt.Println(i)\n\t}\n}\n',
  },
  {
    nodeKey: 'even-range',
    title: 'L2 Even Range',
    file: 'main.go',
    packId: 'even-range-v2',
    wrongSource: 'package main\n\nfunc main() {}\n',
    correctSource: 'package main\n\nimport ("fmt"; "os")\n\nfunc main() {\n\tvar low, high int\n\tif _, err := fmt.Fscan(os.Stdin, &low, &high); err != nil || low > high {\n\t\treturn\n\t}\n\tfor i := low; i <= high; i++ {\n\t\tif i%2 == 0 {\n\t\t\tfmt.Println(i)\n\t\t}\n\t}\n}\n',
  },
  {
    nodeKey: 'sum-to-n',
    title: 'L3 Sum to N',
    file: 'main.go',
    packId: 'sum-to-n-v2',
    wrongSource: 'package main\n\nfunc main() {}\n',
    correctSource: 'package main\n\nimport ("fmt"; "os")\n\nfunc main() {\n\tvar n int\n\tif _, err := fmt.Fscan(os.Stdin, &n); err != nil || n <= 0 {\n\t\tfmt.Println(0)\n\t\treturn\n\t}\n\tsum := 0\n\tfor i := 1; i <= n; i++ {\n\t\tsum += i\n\t}\n\tfmt.Println(sum)\n}\n',
  },
  {
    nodeKey: 'star-rectangle',
    title: 'L4 Star Rectangle',
    file: 'main.go',
    packId: 'star-rectangle-v2',
    wrongSource: 'package main\n\nfunc main() {}\n',
    correctSource: 'package main\n\nimport ("fmt"; "os"; "strings")\n\nfunc main() {\n\tvar w, h int\n\tif _, err := fmt.Fscan(os.Stdin, &w, &h); err != nil || w <= 0 || h <= 0 {\n\t\treturn\n\t}\n\tfor i := 0; i < h; i++ {\n\t\tfmt.Println(strings.Repeat("*", w))\n\t}\n}\n',
  },
  {
    nodeKey: 'ordered-pairs',
    title: 'L5 Ordered Pairs',
    file: 'main.go',
    packId: 'ordered-pairs-v2',
    wrongSource: 'package main\n\nfunc main() {}\n',
    correctSource: 'package main\n\nimport ("fmt"; "os")\n\nfunc main() {\n\tvar limit int\n\tif _, err := fmt.Fscan(os.Stdin, &limit); err != nil || limit < 2 {\n\t\treturn\n\t}\n\tfor i := 1; i < limit; i++ {\n\t\tfor j := i + 1; j <= limit; j++ {\n\t\t\tfmt.Printf("%d %d\\n", i, j)\n\t\t}\n\t}\n}\n',
  },

  // --- Quest 3 ---
  {
    nodeKey: 'strlen',
    title: '1 StrLen',
    file: 'strlen.go',
    packId: 'strlen-v3',
    wrongSource: 'package piscine\n\nfunc StrLen(s string) int {\n\treturn -1\n}\n',
    correctSource: 'package piscine\n\nfunc StrLen(s string) int {\n\tcount := 0\n\tfor range s {\n\t\tcount++\n\t}\n\treturn count\n}\n',
  },
  {
    nodeKey: 'swap',
    title: '2 Swap',
    file: 'main.go',
    packId: 'swap-v2',
    wrongSource: 'package main\n\nfunc main() {}\n',
    correctSource: 'package main\n\nimport ("fmt"; "os")\n\nfunc main() {\n\tvar a, b int\n\tif _, err := fmt.Fscan(os.Stdin, &a, &b); err != nil {\n\t\treturn\n\t}\n\tfmt.Printf("%d %d\\n", b, a)\n}\n',
  },
  {
    nodeKey: 'div-mod',
    title: '3 DivMod',
    file: 'main.go',
    packId: 'div-mod-v2',
    wrongSource: 'package main\n\nfunc main() {}\n',
    correctSource: 'package main\n\nimport ("fmt"; "os")\n\nfunc main() {\n\tvar a, b int\n\tif _, err := fmt.Fscan(os.Stdin, &a, &b); err != nil || b == 0 {\n\t\treturn\n\t}\n\tfmt.Printf("%d %d\\n", a/b, a%b)\n}\n',
  },
  {
    nodeKey: 'basic-atoi',
    title: '4 BasicAtoi',
    file: 'basicatoi.go',
    packId: 'basic-atoi-v3',
    wrongSource: 'package piscine\n\nfunc BasicAtoi(s string) int {\n\treturn -1\n}\n',
    correctSource: 'package piscine\n\nfunc BasicAtoi(s string) int {\n\tres := 0\n\tfor _, c := range s {\n\t\tres = res*10 + int(c-\'0\')\n\t}\n\treturn res\n}\n',
  },
  {
    nodeKey: 'basic-atoi2',
    title: '5 BasicAtoi2',
    file: 'basicatoi2.go',
    packId: 'basic-atoi2-v3',
    wrongSource: 'package piscine\n\nfunc BasicAtoi2(s string) int {\n\treturn -1\n}\n',
    correctSource: 'package piscine\n\nfunc BasicAtoi2(s string) int {\n\tif len(s) == 0 {\n\t\treturn 0\n\t}\n\tres := 0\n\tfor _, c := range s {\n\t\tif c < \'0\' || c > \'9\' {\n\t\t\treturn 0\n\t\t}\n\t\tres = res*10 + int(c-\'0\')\n\t}\n\treturn res\n}\n',
  },
  {
    nodeKey: 'atoi',
    title: '6 Atoi',
    file: 'atoi.go',
    packId: 'atoi-v3',
    wrongSource: 'package piscine\n\nfunc Atoi(s string) int {\n\treturn -1\n}\n',
    correctSource: 'package piscine\n\nfunc Atoi(s string) int {\n\tif len(s) == 0 {\n\t\treturn 0\n\t}\n\tsign := 1\n\tidx := 0\n\tif s[0] == \'-\' {\n\t\tsign = -1\n\t\tidx = 1\n\t} else if s[0] == \'+\' {\n\t\tidx = 1\n\t}\n\tif idx >= len(s) {\n\t\treturn 0\n\t}\n\tres := 0\n\tfor _, c := range s[idx:] {\n\t\tif c < \'0\' || c > \'9\' {\n\t\t\treturn 0\n\t\t}\n\t\tres = res*10 + int(c-\'0\')\n\t}\n\treturn sign * res\n}\n',
  },
  {
    nodeKey: 'sum-slice',
    title: '7 SumSlice',
    file: 'sumslice.go',
    packId: 'sum-slice-v3',
    wrongSource: 'package piscine\n\nfunc SumSlice(numbers []int) int {\n\treturn -1\n}\n',
    correctSource: 'package piscine\n\nfunc SumSlice(numbers []int) int {\n\tsum := 0\n\tfor _, n := range numbers {\n\t\tsum += n\n\t}\n\treturn sum\n}\n',
  },
  {
    nodeKey: 'str-rev',
    title: '8 StrRev',
    file: 'strrev.go',
    packId: 'str-rev-v1',
    wrongSource: 'package main\n\nfunc StrRev(s string) string {\n\treturn "wrong"\n}\n',
    correctSource: 'package main\n\nfunc StrRev(s string) string {\n\trunes := []rune(s)\n\tfor i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {\n\t\trunes[i], runes[j] = runes[j], runes[i]\n\t}\n\treturn string(runes)\n}\n',
  },
];

async function submitAndGrade(params: {
  cohortId: string;
  curriculumVersionId: string;
  userId: string;
  authUserId: string;
  nodeKey: string;
  filename: string;
  sourceCode: string;
}) {
  const sourceBytes = Buffer.from(params.sourceCode, 'utf8');
  const sourceDigest = createHash('sha256').update(sourceBytes).digest('hex');
  const requestId = randomUUID();
  const storageKey = `${params.authUserId}/${params.cohortId}/${requestId}/${sourceDigest}`;

  // 1. Upload source to Supabase storage
  const { error: uploadErr } = await admin.storage
    .from('nextera-submissions')
    .upload(storageKey, sourceBytes, { contentType: 'application/octet-stream', upsert: true });

  if (uploadErr) {
    throw new Error(`Storage upload failed: ${uploadErr.message}`);
  }

  // 2. Accept submission via canonical DB function
  const [row] = await sql`
    SELECT app.accept_submission(
      ${params.authUserId}::uuid,
      ${params.cohortId}::uuid,
      ${params.nodeKey},
      ${requestId}::uuid,
      ${params.filename},
      ${sourceBytes.length}::bigint,
      ${sourceDigest}
    ) AS id
  `;
  const submissionId = String(row.id);

  const [sub] = await sql`
    SELECT active_judge_job_id FROM app.submissions WHERE id = ${submissionId}
  `;
  const jobId = String(sub.active_judge_job_id);

  // 3. Keep running real Judge worker until our specific job has a terminal result
  for (let attempt = 0; attempt < 30; attempt++) {
    const [job] = await sql`
      SELECT j.state, r.id as result_id, r.verdict
      FROM judge.jobs j
      LEFT JOIN judge.results r ON r.id = j.terminal_result_id
      WHERE j.id = ${jobId}
    `;
    if (job?.verdict) {
      return {
        submissionId,
        jobId,
        resultId: String(job.result_id),
        verdict: String(job.verdict),
        logs: '',
      };
    }

    const workerProc = runWorker();
    await workerProc.exited;
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`Job ${jobId} timed out.`);
}

async function main() {
  console.log('=== VERIFYING REAL VERTICAL EVALUATION FOR ALL WEEK 1 GO TASKS ===\n');

  // 1. Get active week1-trial-cohort-v4
  const [cohort] = await sql`SELECT * FROM app.cohorts WHERE slug = 'week1-trial-cohort-v4' AND status = 'active'`;
  if (!cohort) throw new Error('Cohort week1-trial-cohort-v4 not found');
  const cohortId = String(cohort.id);
  const cvId = String(cohort.curriculum_version_id);

  console.log(`Cohort: ${cohort.name} (${cohortId})`);
  console.log(`Curriculum: ${cvId}\n`);

  // 2. Create dedicated trial learner
  const testEmail = `go-verifier-${randomBytes(6).toString('hex')}@test.local`;
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: testEmail,
    password: 'SafeGoVerifierPass123!',
    email_confirm: true,
  });
  if (authErr || !authData.user) throw new Error(`Auth create failed: ${authErr?.message}`);
  const authUserId = authData.user.id;

  // Insert to app.users and enroll in cohort
  const [domainUser] = await sql`
    INSERT INTO app.users (auth_user_id, display_name, role, active)
    VALUES (${authUserId}, 'Go Task Verifier', 'learner', true)
    RETURNING id
  `;
  const userId = String(domainUser!.id);

  await sql`
    INSERT INTO app.cohort_memberships (cohort_id, user_id, status)
    VALUES (${cohortId}, ${userId}, 'active')
  `;

  // Grant result application role to session user if needed
  await sql.unsafe(`GRANT nextera_result_application TO supabase_admin`);

  // Seed initial progress rows
  const nodes = await sql`
    SELECT node_key, position, quest_key
    FROM app.curriculum_nodes
    WHERE curriculum_version_id = ${cvId}
  `;
  for (const n of nodes) {
    const isRoot = n.node_key === 'know-where-you-are' || n.node_key === 'greeting-card' || n.node_key === 'strlen';
    await sql`
      INSERT INTO app.learner_node_progress (cohort_id, user_id, curriculum_version_id, node_key, state, unlocked_at)
      VALUES (${cohortId}, ${userId}, ${cvId}, ${n.node_key}, ${isRoot ? 'available' : 'locked'}, ${isRoot ? sql`now()` : null})
      ON CONFLICT (cohort_id, user_id, curriculum_version_id, node_key) DO UPDATE
      SET state = EXCLUDED.state, unlocked_at = EXCLUDED.unlocked_at
    `;
  }
  // Restrict our active worker to this cohort so it claims only this test cohort's jobs
  await sql`
    UPDATE judge.workers 
    SET capabilities = jsonb_set(capabilities, '{fixture_cohort_ids}', ${JSON.stringify([cohortId])}::jsonb)
    WHERE db_principal = ${worker.principal}
  `;

  console.log(`✓ Test learner ${userId} enrolled in cohort with unlocked root nodes.\n`);

  type TestResult = {
    nodeKey: string;
    title: string;
    file: string;
    packId: string;
    failVerdict: string;
    failJobId: string;
    passVerdict: string;
    passJobId: string;
    passResultId: string;
    mastered: boolean;
  };

  const results: TestResult[] = [];

  for (let i = 0; i < goTasks.length; i++) {
    const task = goTasks[i]!;
    console.log(`----------------------------------------------------------------------`);
    console.log(`[Task ${i + 1}/${goTasks.length}] ${task.title} (${task.nodeKey})`);
    console.log(`  File: ${task.file} | Pack: ${task.packId}`);

    // Verify task is available
    const [progStart] = await sql`
      SELECT state FROM app.learner_node_progress
      WHERE cohort_id = ${cohortId} AND user_id = ${userId} AND node_key = ${task.nodeKey}
    `;
    if (progStart?.state !== 'available') {
      console.log(`  Unlocking task for test: was ${progStart?.state}`);
      await sql`
        UPDATE app.learner_node_progress
        SET state = 'available', unlocked_at = now()
        WHERE cohort_id = ${cohortId} AND user_id = ${userId} AND node_key = ${task.nodeKey}
      `;
    }

    // 1. Submit WRONG answer -> FAIL
    console.log(`  -> Submitting WRONG answer...`);
    const wrongRes = await submitAndGrade({
      cohortId,
      curriculumVersionId: cvId,
      userId,
      authUserId,
      nodeKey: task.nodeKey,
      filename: task.file,
      sourceCode: task.wrongSource,
    });
    console.log(`     Result: ${wrongRes.verdict.toUpperCase()} (Job: ${wrongRes.jobId.slice(0, 8)}...)`);
    if (wrongRes.verdict !== 'failed') {
      throw new Error(`Expected FAIL for wrong solution on ${task.nodeKey}, got ${wrongRes.verdict}`);
    }

    // 2. Submit CORRECT answer -> PASS
    console.log(`  -> Submitting CORRECT answer...`);
    const passRes = await submitAndGrade({
      cohortId,
      curriculumVersionId: cvId,
      userId,
      authUserId,
      nodeKey: task.nodeKey,
      filename: task.file,
      sourceCode: task.correctSource,
    });
    console.log(`     Result: ${passRes.verdict.toUpperCase()} (Result ID: ${passRes.resultId.slice(0, 8)}...)`);
    if (passRes.verdict !== 'passed') {
      throw new Error(`Expected PASS for correct solution on ${task.nodeKey}, got ${passRes.verdict}`);
    }

    // 3. Apply progression pass via authoritative operation
    const applicationReceipt = await applyResult(db, passRes.resultId);
    console.log(`     Progress Applied: ${applicationReceipt.application_status}`);

    const [progEnd] = await sql`
      SELECT state, mastered_at FROM app.learner_node_progress
      WHERE cohort_id = ${cohortId} AND user_id = ${userId} AND node_key = ${task.nodeKey}
    `;

    results.push({
      nodeKey: task.nodeKey,
      title: task.title,
      file: task.file,
      packId: task.packId,
      failVerdict: wrongRes.verdict,
      failJobId: wrongRes.jobId,
      passVerdict: passRes.verdict,
      passJobId: passRes.jobId,
      passResultId: passRes.resultId,
      mastered: progEnd?.state === 'mastered',
    });

    console.log(`  ✓ Proved FAIL -> PASS -> Mastered (${task.nodeKey})`);
  }

  // Verify progress survives across re-query
  const allProgress = await sql`
    SELECT node_key, state, mastered_at
    FROM app.learner_node_progress
    WHERE cohort_id = ${cohortId} AND user_id = ${userId} AND state = 'mastered'
  `;

  console.log('\n======================================================================');
  console.log('✓ ALL 15 GO TASKS PROVED: WRONG (FAIL) -> CORRECT (PASS) -> PERSISTED');
  console.log('======================================================================\n');

  console.table(
    results.map((r) => ({
      Task: r.title,
      Key: r.nodeKey,
      File: r.file,
      'Test Pack': r.packId,
      'FAIL Job': r.failJobId.slice(0, 8),
      'PASS Job': r.passJobId.slice(0, 8),
      'PASS Result ID': r.passResultId.slice(0, 8),
      Mastered: r.mastered ? 'YES' : 'NO',
    })),
  );

  console.log(`\nPersisted Mastered Nodes Count in PostgreSQL: ${allProgress.length}/${goTasks.length}`);
}

main()
  .catch((e) => {
    console.error('Fatal execution error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await sql.end();
  });
