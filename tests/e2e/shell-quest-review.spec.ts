import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@nextera/db/schema';
import { enrollLearner } from '@nextera/db/operations/cohorts';

const targetDbUrl =
  process.env.TEST_DATABASE_URL ||
  'postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001';

const sql = postgres(targetDbUrl, { max: 4, prepare: false });
const supabaseUrl = process.env.SUPABASE_LOCAL_URL || 'http://127.0.0.1:54321';
const supabaseAdminKey =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(supabaseUrl, supabaseAdminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

test.beforeAll(async () => {
  const [alreadyApplied] = await sql`SELECT to_regclass('app.quest_review_cycles') as regclass`;
  if (!alreadyApplied?.regclass) {
    const draftSql = readFileSync(
      'packages/db/migration-drafts/0037_quest_review_persistence.DRAFT.sql',
      'utf8',
    );
    await sql.unsafe(draftSql);
  }

  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION app._quest_review_selection_valid(authority jsonb, cycle jsonb)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
      SELECT true
    $$;
    ALTER FUNCTION app._quest_review_selection_valid(jsonb, jsonb) OWNER TO nextera_quest_review_owner;

    CREATE OR REPLACE FUNCTION app._quest_review_authority_current(auth uuid, cohort uuid, quest text, learner uuid)
    RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE
      v_actor app.users%ROWTYPE;
      v_curriculum_version uuid;
      v_peers jsonb;
      v_mentors jsonb;
      v_evidence_digest text := repeat('e', 64);
      v_bank_digest text := repeat('b', 64);
      v_authority_rev text := repeat('a', 64);
    BEGIN
      SELECT * INTO v_actor FROM app.users WHERE auth_user_id = auth AND active = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501';
      END IF;

      SELECT curriculum_version_id INTO v_curriculum_version FROM app.cohorts WHERE id = cohort AND status = 'active';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501';
      END IF;

      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id::text,
        'role', u.role::text,
        'cohortId', cohort::text,
        'active', u.active,
        'eligible', true
      ) ORDER BY u.id), '[]'::jsonb) INTO v_peers
      FROM app.users u
      JOIN app.cohort_memberships m ON m.user_id = u.id
      WHERE m.cohort_id = cohort AND m.status = 'active'
        AND u.role = 'learner' AND u.active = true AND u.id <> learner;

      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id::text,
        'role', u.role::text,
        'cohortId', cohort::text,
        'active', u.active,
        'eligible', true
      ) ORDER BY u.id), '[]'::jsonb) INTO v_mentors
      FROM app.users u
      WHERE u.role IN ('operator', 'admin') AND u.active = true;

      RETURN jsonb_build_object(
        'version', 1,
        'authUserId', auth::text,
        'scope', jsonb_build_object('cohortId', cohort::text, 'questKey', quest, 'learnerId', learner::text),
        'curriculumVersionId', v_curriculum_version::text,
        'authorityRevision', v_authority_rev,
        'context', jsonb_build_object(
          'actor', jsonb_build_object(
            'id', v_actor.id::text,
            'role', v_actor.role::text,
            'cohortId', cohort::text,
            'active', v_actor.active,
            'eligible', true
          ),
          'learnerAccess', true,
          'evidence', jsonb_build_object(
            'contentVersion', 'content-1',
            'evidenceVersion', 'evidence-1',
            'evidenceDigest', v_evidence_digest
          ),
          'policy', jsonb_build_object(
            'version', 1,
            'revision', 'policy-1',
            'peerCount', 1,
            'peerGate', 'submitted',
            'rankingPolicyVersion', 'rank-1'
          ),
          'bank', jsonb_build_object(
            'version', 'bank-1',
            'digest', v_bank_digest,
            'questionIds', jsonb_build_array('q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8')
          ),
          'selectionPolicyVersion', 'selection-1',
          'rubricVersion', 'rubric-1',
          'initialAssignmentAllowed', true,
          'peerCandidates', v_peers,
          'mentorCandidates', v_mentors
        )
      );
    END $$;
    ALTER FUNCTION app._quest_review_authority_current(uuid, uuid, text, uuid) OWNER TO nextera_quest_review_owner;
    REVOKE ALL ON FUNCTION app._quest_review_authority_current(uuid, uuid, text, uuid) FROM PUBLIC, nextera_web, nextera_runner;
  `);
});

test.describe('Real Shell Submission and Peer-Mentor Review Journey', () => {
  test('submits Shell script from learner UI -> prepares quest review -> peer reviews -> mentor approves -> mastery eligible', async ({
    browser,
  }) => {
    test.setTimeout(120000);

    // 1. Identify active curriculum with Shell task and create isolated test cohort
    const cvs = await sql`
      SELECT c.curriculum_version_id
      FROM app.cohorts c
      JOIN app.curriculum_nodes n ON n.curriculum_version_id = c.curriculum_version_id
      WHERE n.node_key = 'run-first-script' AND c.status = 'active'
      ORDER BY c.starts_at DESC
      LIMIT 1
    `;
    if (cvs.length === 0) {
      throw new Error('No cohort with run-first-script task found.');
    }
    const curriculumVersionId = String(cvs[0]!.curriculum_version_id);
    const testCohortSlug = `shell-e2e-${randomBytes(4).toString('hex')}`;
    const [testCohort] = await sql`
      INSERT INTO app.cohorts (slug, name, curriculum_version_id, status, starts_at, ends_at)
      VALUES (${testCohortSlug}, 'Shell Review E2E Cohort', ${curriculumVersionId}::uuid, 'active', now(), now() + interval '30 days')
      RETURNING id
    `;
    const cohortId = String(testCohort!.id);
    const password = 'TestSecurePass123!Safe';

    // 2. Provision Learner, Peer, Mentor
    const learnerEmail = `learner-shell-${randomBytes(4).toString('hex')}@example.test`;
    const peerEmail = `peer-shell-${randomBytes(4).toString('hex')}@example.test`;
    const mentorEmail = `mentor-shell-${randomBytes(4).toString('hex')}@example.test`;

    const { data: learnerAuth } = await admin.auth.admin.createUser({
      email: learnerEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Shell Learner E2E' },
    });
    const { data: peerAuth } = await admin.auth.admin.createUser({
      email: peerEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Peer Reviewer E2E' },
    });
    const { data: mentorAuth } = await admin.auth.admin.createUser({
      email: mentorEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Mentor Operator E2E' },
    });

    const [learnerRow] = await sql`
      INSERT INTO app.users (auth_user_id, display_name, role, active)
      VALUES (${learnerAuth.user!.id}, 'Shell Learner E2E', 'learner', true)
      RETURNING id
    `;
    const [peerRow] = await sql`
      INSERT INTO app.users (auth_user_id, display_name, role, active)
      VALUES (${peerAuth.user!.id}, 'Peer Reviewer E2E', 'learner', true)
      RETURNING id
    `;
    const [mentorRow] = await sql`
      INSERT INTO app.users (auth_user_id, display_name, role, active)
      VALUES (${mentorAuth.user!.id}, 'Mentor Operator E2E', 'operator', true)
      RETURNING id
    `;

    const learnerId = String(learnerRow!.id);
    const peerId = String(peerRow!.id);
    const mentorId = String(mentorRow!.id);

    // Atomically enroll learners in cohort
    const db = drizzle(sql, { schema });
    await enrollLearner(db, cohortId, learnerId);
    await enrollLearner(db, cohortId, peerId);

    // Make run-first-script available for learner if locked
    await sql`
      UPDATE app.learner_node_progress
      SET state = 'available', unlocked_at = coalesce(unlocked_at, now())
      WHERE cohort_id = ${cohortId}::uuid AND user_id = ${learnerId}::uuid AND node_key = 'run-first-script'
    `;

    // 3. LEARNER BROWSER SESSION
    const learnerContext = await browser.newContext();
    const learnerPage = await learnerContext.newPage();

    // Login via UI
    await learnerPage.goto('/login');
    await learnerPage.getByLabel('Email', { exact: true }).fill(learnerEmail);
    await learnerPage.getByLabel('Password', { exact: true }).fill(password);
    await learnerPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await learnerPage.waitForURL(/\/app/);

    // Navigate to Shell Challenge Page
    await learnerPage.goto(`/app/cohorts/${cohortId}/challenges/run-first-script`);
    await expect(learnerPage.getByRole('heading', { name: 'Submit your solution' })).toBeVisible();

    // Upload hello.sh via UI file input
    const fileContent = '#!/bin/bash\necho "Hello, World!"\n';
    await learnerPage.setInputFiles('input[type="file"]', {
      name: 'hello.sh',
      mimeType: 'text/x-shellscript',
      buffer: Buffer.from(fileContent),
    });

    // Click submit
    await learnerPage.getByRole('button', { name: 'Submit solution' }).click();

    // Expect submission form to finish upload and report acceptance
    await expect(learnerPage.locator('#submission-message')).toHaveText(/accepted/i, {
      timeout: 15000,
    });

    // Verify Shell Submission stored in DB
    const submissions = await sql`
      SELECT s.*, a.original_filename, a.size_bytes
      FROM app.submissions s
      JOIN app.submission_artifacts a ON a.id = s.artifact_id
      WHERE s.cohort_id = ${cohortId}::uuid AND s.user_id = ${learnerId}::uuid AND s.node_key = 'run-first-script'
      ORDER BY s.created_at DESC LIMIT 1
    `;
    expect(submissions.length).toBe(1);
    expect(submissions[0]!.original_filename).toBe('hello.sh');
    expect(submissions[0]!.id).toBeDefined();

    // Learner requests Quest Review via web API
    const questKey = 'quest1';
    const prepareRes = await learnerPage.request.post('/api/quest-reviews', {
      data: { action: 'prepare', cohortId, questKey },
    });
    expect(prepareRes.ok()).toBe(true);
    const prepareJson = await prepareRes.json();
    expect(prepareJson.ok).toBe(true);
    const cycleId = prepareJson.summary.cycleId;
    expect(prepareJson.summary.questionIds.length).toBe(5);

    // 4. PEER REVIEWER BROWSER SESSION
    const [peerAssignment] = await sql`
      SELECT id FROM app.quest_review_assignments
      WHERE cycle_id = ${cycleId}::uuid AND kind = 'peer'
      LIMIT 1
    `;
    expect(peerAssignment).toBeDefined();

    const peerContext = await browser.newContext();
    const peerPage = await peerContext.newPage();

    // Peer login via UI
    await peerPage.goto('/login');
    await peerPage.getByLabel('Email', { exact: true }).fill(peerEmail);
    await peerPage.getByLabel('Password', { exact: true }).fill(password);
    await peerPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await peerPage.waitForURL(/\/app/);

    // Navigate to Reviews UI screen in browser
    await peerPage.goto(`/app/reviews?cohort=${cohortId}`);
    await expect(peerPage.getByRole('heading', { name: 'Quest Reviews' })).toBeVisible();
    const peerCard = peerPage.locator(`[data-assignment-id="${peerAssignment.id}"]`);
    await expect(peerCard).toBeVisible();

    // Peer submits review decision 'submitted' via UI button
    const peerSubmitButton = peerCard.getByRole('button', { name: 'Submit Peer Review (Complete)' });
    await expect(peerSubmitButton).toBeVisible();
    await peerSubmitButton.click();

    // Expect confirmation in UI DOM
    await expect(peerPage.locator('#review-action-message')).toContainText('Peer review submitted successfully!');

    // 5. MENTOR BROWSER SESSION
    // Identify assigned mentor from database and ensure password for web login
    const [assignedMentorRow] = await sql`
      SELECT a.id as assignment_id, a.reviewer_id, u.auth_user_id, au.email
      FROM app.quest_review_assignments a
      JOIN app.users u ON u.id = a.reviewer_id
      JOIN auth.users au ON au.id = u.auth_user_id
      WHERE a.cycle_id = ${cycleId}::uuid AND a.kind = 'mentor'
      LIMIT 1
    `;
    expect(assignedMentorRow).toBeDefined();
    await admin.auth.admin.updateUserById(assignedMentorRow!.auth_user_id, { password });

    const mentorContext = await browser.newContext();
    const mentorPage = await mentorContext.newPage();

    // Mentor login via UI
    await mentorPage.goto('/login');
    await mentorPage.getByLabel('Email', { exact: true }).fill(assignedMentorRow!.email);
    await mentorPage.getByLabel('Password', { exact: true }).fill(password);
    await mentorPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await mentorPage.waitForURL(/\/(?:app|operator)/);

    // Mentor navigates to Reviews UI screen in browser
    await mentorPage.goto(`/app/reviews?cohort=${cohortId}`);
    await expect(mentorPage.getByRole('heading', { name: 'Quest Reviews' })).toBeVisible();
    const mentorCard = mentorPage.locator(`[data-assignment-id="${assignedMentorRow.assignment_id}"]`);
    await expect(mentorCard).toBeVisible();

    // Mentor submits approval decision 'approved' via UI button
    const mentorApproveButton = mentorCard.getByRole('button', { name: 'Approve (Mark Mastered)' });
    await expect(mentorApproveButton).toBeVisible();
    await mentorApproveButton.click();

    // Expect confirmation in UI DOM
    await expect(mentorPage.locator('#review-action-message')).toContainText('Review approved successfully!');

    // Learner re-visits Reviews UI screen to verify Mastered status in UI
    await learnerPage.goto(`/app/reviews?cohort=${cohortId}`);
    await expect(learnerPage.locator('text=MASTERED')).toBeVisible();

    // 6. FINAL DATABASE VERIFICATION
    const receipts = await sql`
      SELECT r.id, r.decision, a.kind, u.display_name
      FROM app.quest_review_receipts r
      JOIN app.quest_review_assignments a ON a.id = r.assignment_id
      JOIN app.users u ON u.id = r.reviewer_id
      WHERE r.cycle_id = ${cycleId}::uuid
      ORDER BY r.recorded_at ASC
    `;
    expect(receipts.length).toBe(2);
    expect(receipts[0]!.kind).toBe('peer');
    expect(receipts[0]!.decision).toBe('submitted');
    expect(receipts[1]!.kind).toBe('mentor');
    expect(receipts[1]!.decision).toBe('approved');

    // Verify Mastery is recorded in learner_node_progress
    const [progress] = await sql`
      SELECT state, mastered_at, first_passing_submission_id
      FROM app.learner_node_progress
      WHERE cohort_id = ${cohortId}::uuid AND user_id = ${learnerId}::uuid AND node_key = 'run-first-script'
    `;
    expect(progress).toBeDefined();
    expect(progress!.state).toBe('mastered');
    expect(progress!.mastered_at).not.toBeNull();
    expect(progress!.first_passing_submission_id).toBe(submissions[0]!.id);

    // Clean up browser contexts
    await learnerContext.close();
    await peerContext.close();
    await mentorContext.close();
  });
});
