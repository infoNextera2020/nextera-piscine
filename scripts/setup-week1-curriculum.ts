import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { applyInvitationDrafts } from './apply-invitation-drafts';
import { evaluationDigest } from './curriculum/digest';

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

const targetDbUrl =
  process.env.TEST_DATABASE_URL ||
  'postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001';

const sql = postgres(targetDbUrl, { max: 2, prepare: false });

const artifacts = 'C:\\Users\\NEXTERA\\nextera-judge-artifacts';
const toWslPath = (p: string) =>
  p.replace(/^[a-zA-Z]:[\\/]/, (m) => `/mnt/host/${m[0]!.toLowerCase()}/`).replace(/\\/g, '/');

const candidate = JSON.parse(fs.readFileSync(path.join(artifacts, 'candidate.json'), 'utf8'));

// Read source markdown files
const q1Md = fs.readFileSync('content/source-baselines/quest1-beginner-v1/q1-learner-en.md', 'utf8');
const q2Md = fs.readFileSync('content/source-baselines/quest2-standard-go-v3/q2-learner-en.md', 'utf8');
const q3Md = fs.readFileSync('content/source-baselines/quest3-standard-go-v1/q3-learner-en.md', 'utf8');

function extractSection(content: string, startHeader: string, endHeader?: string): string {
  const startIndex = content.indexOf(startHeader);
  if (startIndex === -1) return content.slice(0, 500);
  if (!endHeader) return content.slice(startIndex);
  const endIndex = content.indexOf(endHeader, startIndex + startHeader.length);
  return endIndex === -1 ? content.slice(startIndex) : content.slice(startIndex, endIndex).trim();
}

async function main() {
  console.log('--- Setting up Week 1 Quests (Q1–Q3) Approved Curriculum & Test Cohort ---');
  await applyInvitationDrafts(targetDbUrl);

  const curriculumKey = `foundation-test-only-week1-${randomUUID().slice(0, 8)}`;
  const curriculumVersion = '0.1.0-week1-trial';
  const gitCommitSha = '3762f4697262831c19583e1d8586c0a9f3243f6a';
  const contentDigest = sha256(`week1-curriculum-trial-${curriculumKey}`);

  // 1. Create curriculum version in 'draft' status first (as required by guard_curriculum_version trigger)
  const [versionRow] = await sql`
    INSERT INTO app.curriculum_versions (
      curriculum_key, version, status, git_commit_sha, content_digest, digest_format_version
    ) VALUES (
      ${curriculumKey}, ${curriculumVersion}, 'draft', ${gitCommitSha}, ${contentDigest}, 1
    )
    RETURNING id
  `;
  const cvId = String(versionRow!.id);
  console.log(`[OK] Created draft curriculum version: ${cvId} (${curriculumKey})`);

  // 2. Define Quests 1, 2, 3
  const questsData = [
    { key: 'quest1', title: 'Quest 1: Terminal, Shell & Git', position: 1 },
    { key: 'quest2', title: 'Quest 2: First Programs & Gentle Loops in Go', position: 2 },
    { key: 'quest3', title: 'Quest 3: Working with Values, Text and Slices', position: 3 },
  ];

  for (const q of questsData) {
    await sql`
      INSERT INTO app.quests (curriculum_version_id, quest_key, title, position)
      VALUES (${cvId}, ${q.key}, ${q.title}, ${q.position})
    `;
  }
  console.log(`[OK] Inserted ${questsData.length} quests`);

  // 3. Define Nodes
  type NodeDef = {
    key: string;
    questKey: string;
    kind: 'challenge' | 'checkpoint' | 'project';
    title: string;
    position: number;
    difficulty: number;
    subjectMarkdown: string;
    skills: string[];
    submissionRules: Record<string, unknown>;
    runnableTestPackId?: string;
  };

  const nodes: NodeDef[] = [
    // --- Quest 1 (8 Shell tasks + 1 review) ---
    // Non-evaluable tasks do NOT trap the student behind blocking requires_pass prerequisites!
    {
      key: 'know-where-you-are',
      questKey: 'quest1',
      kind: 'challenge',
      title: 'Know Where You Are',
      position: 1,
      difficulty: 1,
      subjectMarkdown: extractSection(q1Md, '## 1 Know where you are', '## 2 Create a precise text file'),
      skills: ['terminal-basics', 'navigation'],
      submissionRules: { required_files: ['welcome.txt'], allowed_extensions: ['.txt'], max_size_kb: 64 },
    },
    {
      key: 'create-precise-text-file',
      questKey: 'quest1',
      kind: 'challenge',
      title: 'Create a Precise Text File',
      position: 2,
      difficulty: 1,
      subjectMarkdown: extractSection(q1Md, '## 2 Create a precise text file', '## 3 Run your first script'),
      skills: ['text-editing', 'line-endings'],
      submissionRules: { required_files: ['r'], allowed_extensions: [''], max_size_kb: 64 },
    },
    {
      key: 'run-first-script',
      questKey: 'quest1',
      kind: 'challenge',
      title: 'Run Your First Script',
      position: 3,
      difficulty: 1,
      subjectMarkdown: extractSection(q1Md, '## 3 Run your first script', '## 4 Search first then count'),
      skills: ['shell-scripting', 'execution'],
      submissionRules: { required_files: ['hello.sh'], allowed_extensions: ['.sh'], max_size_kb: 64 },
    },
    {
      key: 'search-then-count',
      questKey: 'quest1',
      kind: 'challenge',
      title: 'Search First Then Count',
      position: 4,
      difficulty: 1,
      subjectMarkdown: extractSection(q1Md, '## 4 Search first then count', '## 5 Read a listing one rule at a time'),
      skills: ['find', 'wc', 'pipes'],
      submissionRules: { required_files: ['countfiles.sh'], allowed_extensions: ['.sh'], max_size_kb: 64 },
    },
    {
      key: 'master-the-ls',
      questKey: 'quest1',
      kind: 'challenge',
      title: 'Read a Listing One Rule at a Time',
      position: 5,
      difficulty: 1,
      subjectMarkdown: extractSection(q1Md, '## 5 Read a listing one rule at a time', '## 6 Find names and transform output'),
      skills: ['ls-flags', 'sorting'],
      submissionRules: { required_files: ['mastertheLS'], allowed_extensions: [''], max_size_kb: 64 },
    },
    {
      key: 'find-and-transform',
      questKey: 'quest1',
      kind: 'challenge',
      title: 'Find Names and Transform Output',
      position: 6,
      difficulty: 1,
      subjectMarkdown: extractSection(q1Md, '## 6 Find names and transform output', '## 7 Explore permissions safely'),
      skills: ['find-patterns', 'pipes', 'sed'],
      submissionRules: { required_files: ['lookagain.sh'], allowed_extensions: ['.sh'], max_size_kb: 64 },
    },
    {
      key: 'explore-permissions',
      questKey: 'quest1',
      kind: 'challenge',
      title: 'Explore Permissions Safely',
      position: 7,
      difficulty: 1,
      subjectMarkdown: extractSection(q1Md, '## 7 Explore permissions safely', '## 8 Track local changes with Git'),
      skills: ['chmod', 'permissions'],
      submissionRules: { required_files: ['permissions.txt'], allowed_extensions: ['.txt'], max_size_kb: 64 },
    },
    {
      key: 'track-git-changes',
      questKey: 'quest1',
      kind: 'challenge',
      title: 'Track Local Changes with Git',
      position: 8,
      difficulty: 1,
      subjectMarkdown: extractSection(q1Md, '## 8 Track local changes with Git', '## Review with a peer'),
      skills: ['git-init', 'git-commit', 'git-status'],
      submissionRules: { required_files: ['git-notes.txt'], allowed_extensions: ['.txt'], max_size_kb: 64 },
    },
    {
      key: 'quest1-review',
      questKey: 'quest1',
      kind: 'challenge',
      title: 'Quest 1 Peer Review Checkpoint',
      position: 9,
      difficulty: 1,
      subjectMarkdown: extractSection(q1Md, '## Review with a peer', '## Later not removed'),
      skills: ['peer-review', 'terminal-reasoning'],
      submissionRules: { required_files: ['review.txt'], allowed_extensions: ['.txt'], max_size_kb: 64 },
    },

    // --- Quest 2 (7 Go tasks + 1 review) ---
    // All Go tasks have 100% exact matching subjects, files, signatures, and runnable test packs!
    {
      key: 'greeting-card',
      questKey: 'quest2',
      kind: 'challenge',
      title: 'F1 Greeting Card',
      position: 1,
      difficulty: 1,
      subjectMarkdown: extractSection(q2Md, '## F1 Greeting card', '## F2 Sign label'),
      skills: ['go-first-program', 'fmt'],
      submissionRules: { required_files: ['main.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'greeting-card-v2',
    },
    {
      key: 'sign-label',
      questKey: 'quest2',
      kind: 'challenge',
      title: 'F2 Sign Label',
      position: 2,
      difficulty: 1,
      subjectMarkdown: extractSection(q2Md, '## F2 Sign label', '## Five approved gentle-loop tasks'),
      skills: ['conditions', 'functions', 'returns'],
      submissionRules: { required_files: ['signlabel.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'sign-label-v1',
    },
    {
      key: 'count-up-and-down',
      questKey: 'quest2',
      kind: 'challenge',
      title: 'L1 Count Up and Down',
      position: 3,
      difficulty: 1,
      subjectMarkdown: extractSection(q2Md, '### L1 Count up then count down', '### L2 Print even values in a range'),
      skills: ['loops', 'counting'],
      submissionRules: { required_files: ['main.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'count-up-and-down-v2',
    },
    {
      key: 'even-range',
      questKey: 'quest2',
      kind: 'challenge',
      title: 'L2 Even Range',
      position: 4,
      difficulty: 1,
      subjectMarkdown: extractSection(q2Md, '### L2 Print even values in a range', '### L3 Sum to N'),
      skills: ['loops', 'modulo', 'even-numbers'],
      submissionRules: { required_files: ['main.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'even-range-v2',
    },
    {
      key: 'sum-to-n',
      questKey: 'quest2',
      kind: 'challenge',
      title: 'L3 Sum to N',
      position: 5,
      difficulty: 1,
      subjectMarkdown: extractSection(q2Md, '### L3 Sum to N', '### L4 Star rectangle'),
      skills: ['loops', 'accumulation'],
      submissionRules: { required_files: ['main.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'sum-to-n-v2',
    },
    {
      key: 'star-rectangle',
      questKey: 'quest2',
      kind: 'challenge',
      title: 'L4 Star Rectangle',
      position: 6,
      difficulty: 1,
      subjectMarkdown: extractSection(q2Md, '### L4 Star rectangle', '### L5 Ordered pairs'),
      skills: ['nested-loops', 'formatting'],
      submissionRules: { required_files: ['main.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'star-rectangle-v2',
    },
    {
      key: 'ordered-pairs',
      questKey: 'quest2',
      kind: 'challenge',
      title: 'L5 Ordered Pairs',
      position: 7,
      difficulty: 1,
      subjectMarkdown: extractSection(q2Md, '### L5 Ordered pairs', '## Review and evidence'),
      skills: ['nested-loops', 'ordered-pairs'],
      submissionRules: { required_files: ['main.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'ordered-pairs-v2',
    },
    {
      key: 'quest2-review',
      questKey: 'quest2',
      kind: 'challenge',
      title: 'Quest 2 Peer Review Checkpoint',
      position: 8,
      difficulty: 1,
      subjectMarkdown: extractSection(q2Md, '## Review and evidence', '## Short optional resources'),
      skills: ['peer-review', 'go-reasoning'],
      submissionRules: { required_files: ['review.txt'], allowed_extensions: ['.txt'], max_size_kb: 64 },
    },

    // --- Quest 3 (9 Go tasks + 1 review) ---
    {
      key: 'strlen',
      questKey: 'quest3',
      kind: 'challenge',
      title: '1 Count the Runes in Text (StrLen)',
      position: 1,
      difficulty: 1,
      subjectMarkdown: extractSection(q3Md, '## 1 Count the runes in text', '## 2 Change one caller value'),
      skills: ['strings', 'runes', 'iteration'],
      submissionRules: { required_files: ['strlen.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'strlen-v3',
    },
    {
      key: 'pointone',
      questKey: 'quest3',
      kind: 'challenge',
      title: '2 Change One Caller Value (PointOne)',
      position: 2,
      difficulty: 1,
      subjectMarkdown: extractSection(q3Md, '## 2 Change one caller value', '## 3 Swap two caller values'),
      skills: ['pointers', 'dereference', 'mutation'],
      submissionRules: { required_files: ['pointone.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
    },
    {
      key: 'swap',
      questKey: 'quest3',
      kind: 'challenge',
      title: '3 Swap Two Caller Values (Swap)',
      position: 3,
      difficulty: 1,
      subjectMarkdown: extractSection(q3Md, '## 3 Swap two caller values', '## 4 Store a quotient and remainder'),
      skills: ['pointers', 'swap'],
      submissionRules: { required_files: ['swap.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
    },
    {
      key: 'div-mod',
      questKey: 'quest3',
      kind: 'challenge',
      title: '4 Store a Quotient and Remainder (DivMod)',
      position: 4,
      difficulty: 1,
      subjectMarkdown: extractSection(q3Md, '## 4 Store a quotient and remainder', '## 5 Turn valid digit text into a number'),
      skills: ['pointers', 'division', 'modulo'],
      submissionRules: { required_files: ['divmod.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
    },
    {
      key: 'basic-atoi',
      questKey: 'quest3',
      kind: 'challenge',
      title: '5 Turn Valid Digit Text into a Number (BasicAtoi)',
      position: 5,
      difficulty: 1,
      subjectMarkdown: extractSection(q3Md, '## 5 Turn valid digit text into a number', '## 6 Reject invalid unsigned text'),
      skills: ['strings', 'ascii-conversion', 'integers'],
      submissionRules: { required_files: ['basicatoi.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'basic-atoi-v3',
    },
    {
      key: 'basic-atoi2',
      questKey: 'quest3',
      kind: 'challenge',
      title: '6 Reject Invalid Unsigned Text (BasicAtoi2)',
      position: 6,
      difficulty: 1,
      subjectMarkdown: extractSection(q3Md, '## 6 Reject invalid unsigned text', '## 7 Add one optional sign'),
      skills: ['strings', 'validation', 'error-handling'],
      submissionRules: { required_files: ['basicatoi2.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'basic-atoi2-v3',
    },
    {
      key: 'atoi',
      questKey: 'quest3',
      kind: 'challenge',
      title: '7 Add One Optional Sign (Atoi)',
      position: 7,
      difficulty: 1,
      subjectMarkdown: extractSection(q3Md, '## 7 Add one optional sign', '## 8 Add the values in a slice'),
      skills: ['strings', 'signed-numbers', 'parsing'],
      submissionRules: { required_files: ['atoi.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'atoi-v3',
    },
    {
      key: 'sum-slice',
      questKey: 'quest3',
      kind: 'challenge',
      title: '8 Add the Values in a Slice (SumSlice)',
      position: 8,
      difficulty: 1,
      subjectMarkdown: extractSection(q3Md, '## 8 Add the values in a slice', '## 9 Reverse rune order'),
      skills: ['slices', 'iteration', 'accumulation'],
      submissionRules: { required_files: ['sumslice.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'sum-slice-v3',
    },
    {
      key: 'str-rev',
      questKey: 'quest3',
      kind: 'challenge',
      title: '9 Reverse Rune Order (StrRev)',
      position: 9,
      difficulty: 1,
      subjectMarkdown: extractSection(q3Md, '## 9 Reverse rune order', '## Review and next steps'),
      skills: ['strings', 'runes', 'reversal'],
      submissionRules: { required_files: ['strrev.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      runnableTestPackId: 'str-rev-v1',
    },
    {
      key: 'quest3-review',
      questKey: 'quest3',
      kind: 'challenge',
      title: 'Quest 3 Peer Review Checkpoint',
      position: 10,
      difficulty: 1,
      subjectMarkdown: extractSection(q3Md, '## Review and next steps', '## Small official references'),
      skills: ['peer-review', 'pointers-and-slices'],
      submissionRules: { required_files: ['review.txt'], allowed_extensions: ['.txt'], max_size_kb: 64 },
    },
  ];

  for (const n of nodes) {
    const subjectDigest = sha256(n.subjectMarkdown);
    const configDigest = sha256(`config-${n.key}`);
    const testPackId = n.runnableTestPackId || `testpack-${n.key}`;
    const entry = candidate.catalog.test_packs[testPackId];
    
    let testPackDigest: string;
    let artifactUri: string;
    let resolvedLimits = entry?.resource_limits || {
      compilation: { cpu_limit: 1, memory_bytes: 536870912, pid_limit: 64, timeout_ms: 20000, output_bytes: 65536, temporary_filesystem_bytes: 268435456, temporary_filesystem_inodes: 16384 },
      execution: { cpu_limit: 1, memory_bytes: 67108864, pid_limit: 32, timeout_ms: 2000, output_bytes: 65536, temporary_filesystem_bytes: 16777216, temporary_filesystem_inodes: 1024 }
    };

    if (entry) {
      testPackDigest = entry.test_pack_digest;
      const layoutPath = toWslPath(path.join(artifacts, testPackId));
      artifactUri = `oci://${layoutPath.startsWith('/') ? '' : '/'}${layoutPath}@sha256:${testPackDigest}`;
    } else {
      testPackDigest = sha256(`testpack-${n.key}`);
      const layoutPath = `/mnt/host/c/Users/NEXTERA/nextera-judge-artifacts/${n.key}`;
      artifactUri = `oci://${layoutPath.startsWith('/') ? '' : '/'}${layoutPath}@sha256:${testPackDigest}`;
    }

    const resolvedSpec = {
      ...(entry || {}),
      test_only: true,
      curriculum_key: curriculumKey,
      curriculum_version: curriculumVersion,
      content_digest: contentDigest,
      node_key: n.key,
      subject_digest: subjectDigest,
      configuration_digest: configDigest,
      test_pack_id: testPackId,
      test_pack_digest: testPackDigest,
      test_pack_artifact: artifactUri,
      runner_image_digest: entry?.runner_image_digest || 'sha256:d72033e846afeeae5f14e0970bc54f60c55b34a90f785c77546d270e6cfe80b6',
      sandbox_image_digest: entry?.sandbox_image_digest || 'sha256:af6eb48c1375d073398b9358c1685bd1bf01bf4632aab3fb89945f021bb0980b',
      toolchain_version: entry?.toolchain_version || 'go1.27.2',
      target_platform: entry?.target_platform || 'linux/amd64',
      dependency_policy: entry?.dependency_policy || 'offline',
      build_flags: entry?.build_flags || ['-trimpath', '-buildvcs=false', '-p=1', '-ldflags=-buildid='],
      resource_profile: entry?.resource_profile || 'go-functions-pilot-v1',
      protocol_version: 1,
      snapshot_format_version: 1,
      case_generation: { mode: 'static' },
      resource_limits: resolvedLimits,
    };

    const evaluationSpecDigest = evaluationDigest(resolvedSpec);

    await sql`
      INSERT INTO app.curriculum_nodes (
        curriculum_version_id, node_key, quest_key, kind, title, position, difficulty,
        subject_markdown, subject_digest, skills, submission_rules, resolved_evaluation_spec, evaluation_spec_digest
      ) VALUES (
        ${cvId}, ${n.key}, ${n.questKey}, ${n.kind}, ${n.title}, ${n.position}, ${n.difficulty},
        ${n.subjectMarkdown}, ${subjectDigest}, ${sql.array(n.skills)}, ${sql.json(n.submissionRules)},
        ${sql.json(resolvedSpec)}, ${evaluationSpecDigest}
      )
    `;
  }
  console.log(`[OK] Inserted ${nodes.length} curriculum nodes across 3 quests`);

  // 4. Prerequisite rules:
  // - Non-evaluable Shell tasks do NOT have blocking requires_pass prerequisites (avoids trapping students).
  // - Quest 1, Quest 2, and Quest 3 root nodes are independently available from day 1!
  // - Peer review completion does not block next Quest unlock.
  const prerequisites: [string, string][] = [
    // Quest 2 sequential within quest (root 'greeting-card' has no prerequisite!):
    ['greeting-card', 'sign-label'],
    ['sign-label', 'count-up-and-down'],
    ['count-up-and-down', 'even-range'],
    ['even-range', 'sum-to-n'],
    ['sum-to-n', 'star-rectangle'],
    ['star-rectangle', 'ordered-pairs'],
    ['ordered-pairs', 'quest2-review'],

    // Quest 3 sequential within quest (root 'strlen' has no prerequisite!):
    ['strlen', 'pointone'],
    ['pointone', 'swap'],
    ['swap', 'div-mod'],
    ['div-mod', 'basic-atoi'],
    ['basic-atoi', 'basic-atoi2'],
    ['basic-atoi2', 'atoi'],
    ['atoi', 'sum-slice'],
    ['sum-slice', 'str-rev'],
    ['str-rev', 'quest3-review'],
  ];

  for (const [from, to] of prerequisites) {
    await sql`
      INSERT INTO app.node_prerequisites (curriculum_version_id, prerequisite_node_key, dependent_node_key, rule)
      VALUES (${cvId}, ${from}, ${to}, 'requires_pass')
    `;
  }
  console.log(`[OK] Inserted ${prerequisites.length} prerequisite edges without traps or cross-quest gates`);

  // 5. Publish the curriculum version now that nodes & prerequisites are complete!
  await sql`
    UPDATE app.curriculum_versions
    SET status = 'published', published_at = now()
    WHERE id = ${cvId}
  `;
  console.log('[OK] Successfully published curriculum version!');

  // 6. Create Dedicated Test Cohort for Week 1
  const cohortSlug = `week1-trial-cohort-v5`;
  const cohortName = 'Week 1 Trial Cohort (Quests 1–3)';
  const startsAt = '2026-11-01T14:00:00Z';

  const [cohortRow] = await sql`
    INSERT INTO app.cohorts (slug, name, curriculum_version_id, status, starts_at)
    VALUES (${cohortSlug}, ${cohortName}, ${cvId}, 'active', ${startsAt})
    ON CONFLICT (slug) DO UPDATE SET status = 'active', name = ${cohortName}
    RETURNING id
  `;
  const cohortId = String(cohortRow!.id);
  console.log(`[OK] Created active test cohort: ${cohortId} (${cohortSlug})`);

  // 7. Update judge worker capabilities with new cohortId across all workers
  await sql`
    UPDATE judge.workers 
    SET capabilities = jsonb_set(capabilities, '{fixture_cohort_ids}', 
      (SELECT jsonb_agg(DISTINCT elem) FROM (
        SELECT jsonb_array_elements_text(capabilities->'fixture_cohort_ids') AS elem
        UNION SELECT ${cohortId}::text
      ) s)
    )
  `;
  console.log(`[OK] Updated all judge workers capabilities with cohort ${cohortId}`);

  // 8. Ensure test issuer role and issuance policy
  const issuerRole = 'nextera_invitation_test_issuer';
  const [adminRow] = await sql`SELECT id FROM app.users WHERE role = 'admin' AND active = true LIMIT 1`;
  const adminId = adminRow?.id;
  if (adminId) {
    await sql`
      INSERT INTO app.invitation_issuance_policy (
        issuer_id, cohort_id, curriculum_version_id, issuer_login, enabled, max_lifetime_ms
      ) VALUES (
        ${adminId}, ${cohortId}, ${cvId}, ${issuerRole}, true, 604800000
      )
      ON CONFLICT (issuer_id, cohort_id) DO UPDATE SET issuer_login = ${issuerRole}, enabled = true;
    `;
    console.log(`[OK] Configured invitation issuance policy for admin ${adminId} on cohort ${cohortId}`);
  }

  console.log('\n======================================================');
  console.log('[OK] Week 1 Trial Setup Complete!');
  console.log(`  Cohort ID: ${cohortId}`);
  console.log(`  Cohort Slug: ${cohortSlug}`);
  console.log(`  Curriculum Version: ${cvId}`);
  console.log('======================================================\n');
}

main()
  .catch((e) => {
    console.error('Failed to setup Week 1 curriculum:', e);
    process.exit(1);
  })
  .finally(() => sql.end());
