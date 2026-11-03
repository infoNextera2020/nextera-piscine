import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { testCurriculum } from '../../../../tests/fixtures/curriculum';
import { evaluationDigest } from '../../../../scripts/curriculum/digest';
import { importCurriculum } from '../../operations/curriculum';
import { createCohort, enrollLearner } from '../../operations/cohorts';
import {
  prepareQuestReview,
  submitQuestReview,
  type QuestReviewRuntime,
  type QuestReviewSummary,
} from '../../operations/quest-reviews';
import {
  createQuestReviewPostgresRepository,
  nativeQuestReviewAuthority,
  nativeQuestReviewSelection,
} from '../../queries/quest-review-postgres';
import * as schema from '../../schema/index';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

let admin: ReturnType<typeof postgres>;
let webClient: ReturnType<typeof postgres>;
let webLoginPrincipal: string;
let webLoginPassword: string;
const logins: string[] = [];

let versionId: string;
let cohortId: string;
const questKey = 'foundations';

let learnerAuth: string;
let learnerUserId: string;
let peer1Auth: string;
let peer1UserId: string;
let peer2Auth: string;
let peer2UserId: string;
let mentorAuth: string;
let mentorUserId: string;
let assignedPeerId: string;
let assignedPeerAuth: string;
let assignedMentorId: string;
let assignedMentorAuth: string;

let cycleSummary: QuestReviewSummary;
let peerAssignmentId: string;
let mentorAssignmentId: string;
let peerReceiptId: string;
let mentorReceiptId: string;

let sequence = 1000;
let currentTimeMs = 10000;

function createRuntime(): QuestReviewRuntime {
  return {
    nowMs: () => (currentTimeMs += 1000),
    nextId: () => randomUUID(),
    sampler: {
      policyVersion: 'selection-1',
      select: async (bank) => bank.questionIds.slice(0, 5),
    },
  };
}

async function createPrincipal(
  role: string,
): Promise<{ name: string; password: string; client: ReturnType<typeof postgres> }> {
  const name = `f007_${randomUUID().replaceAll('-', '')}`;
  logins.push(name);
  const password = randomBytes(24).toString('hex');
  await admin.unsafe(
    `CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
  );
  await admin.unsafe(`GRANT ${role} TO ${name}`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.username = name;
  url.password = password;
  return {
    name,
    password,
    client: postgres(url.toString(), { max: 8, prepare: false, onnotice: () => {} }),
  };
}

beforeAll(async () => {
  const targetUrl = new URL(process.env.TEST_DATABASE_URL!);
  if (
    !['localhost', '127.0.0.1'].includes(targetUrl.hostname) ||
    !targetUrl.pathname.startsWith('/foundation_test')
  ) {
    throw new Error('Disposable foundation_test database required for quest-review integration tests.');
  }

  admin = postgres(targetUrl.toString(), { max: 12, prepare: false, onnotice: () => {} });

  // 1. Prepare Auth Schema
  await admin.unsafe(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
  `);

  for (const role of ['anon', 'authenticated', 'service_role']) {
    await admin.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE ${role} NOLOGIN;
        END IF;
      END $$;
    `);
  }

  // 2. Apply registered migrations 0000..0010
  await migrate(drizzle(admin), {
    migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
  });

  // 3. Apply unregistered DRAFT 0037 if not already applied
  const [alreadyApplied] = await admin`SELECT to_regclass('app.quest_review_cycles') as regclass`;
  if (!alreadyApplied?.regclass) {
    const draftSql = readFileSync(
      fileURLToPath(new URL('../../migration-drafts/0037_quest_review_persistence.DRAFT.sql', import.meta.url)),
      'utf8',
    );
    const migrationClient = postgres(targetUrl.toString(), { max: 1, prepare: false, onnotice: () => {} });
    try {
      await migrationClient.unsafe(draftSql);
    } finally {
      await migrationClient.end();
    }
  }

  // 4. Seed published curriculum with 'foundations' quest
  const fixture = testCurriculum();
  fixture.evaluations = fixture.evaluations.map((e) => {
    const spec = {
      ...e.spec,
      runner_image_digest: `sha256:${createHash('sha256').update(fixture.curriculum.key).digest('hex')}`,
      test_pack_artifact: `oci:///non-runnable-unit-fixture/${e.nodeKey}@sha256:${e.spec.test_pack_digest}`,
    };
    return { ...e, spec, digest: evaluationDigest(spec) };
  });

  const imported = await importCurriculum(
    drizzle(admin, { schema }),
    fixture.curriculum,
    fixture.gitCommitSha,
    fixture.evaluations,
  );
  versionId = imported.id;

  // 5. Create active cohort
  const cohort = await createCohort(drizzle(admin, { schema }), {
    slug: `quest-review-cohort-${randomUUID()}`,
    name: 'Quest Review Real Integration Cohort',
    curriculumVersionId: versionId,
    startsAt: new Date(),
  });
  cohortId = cohort.id;

  // 6. Provision users
  learnerAuth = randomUUID();
  await admin`INSERT INTO auth.users(id) VALUES(${learnerAuth})`;
  const [learnerRow] = await admin`
    INSERT INTO app.users(auth_user_id, display_name, role, active)
    VALUES(${learnerAuth}, 'Learner User', 'learner', true)
    RETURNING id
  `;
  learnerUserId = String(learnerRow!.id);
  await enrollLearner(drizzle(admin, { schema }), cohortId, learnerUserId);

  peer1Auth = randomUUID();
  await admin`INSERT INTO auth.users(id) VALUES(${peer1Auth})`;
  const [peer1Row] = await admin`
    INSERT INTO app.users(auth_user_id, display_name, role, active)
    VALUES(${peer1Auth}, 'Peer One', 'learner', true)
    RETURNING id
  `;
  peer1UserId = String(peer1Row!.id);
  await enrollLearner(drizzle(admin, { schema }), cohortId, peer1UserId);

  peer2Auth = randomUUID();
  await admin`INSERT INTO auth.users(id) VALUES(${peer2Auth})`;
  const [peer2Row] = await admin`
    INSERT INTO app.users(auth_user_id, display_name, role, active)
    VALUES(${peer2Auth}, 'Peer Two', 'learner', true)
    RETURNING id
  `;
  peer2UserId = String(peer2Row!.id);
  await enrollLearner(drizzle(admin, { schema }), cohortId, peer2UserId);

  mentorAuth = randomUUID();
  await admin`INSERT INTO auth.users(id) VALUES(${mentorAuth})`;
  const [mentorRow] = await admin`
    INSERT INTO app.users(auth_user_id, display_name, role, active)
    VALUES(${mentorAuth}, 'Mentor Operator', 'operator', true)
    RETURNING id
  `;
  mentorUserId = String(mentorRow!.id);

  // 7. Connect as unprivileged nextera_web principal
  const webPrincipal = await createPrincipal('nextera_web');
  webLoginPrincipal = webPrincipal.name;
  webLoginPassword = webPrincipal.password;
  webClient = webPrincipal.client;

  // 8. Bind real authority hooks in database, owned strictly by nextera_quest_review_owner
  await admin.unsafe(`
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

afterAll(async () => {
  await webClient?.end();
  for (const name of logins) {
    try {
      await admin.unsafe(`ALTER ROLE ${name} NOLOGIN`);
    } catch {
      // Best effort
    }
  }
  await admin?.end();
});

describe('Real PostgreSQL Quest Review Integration', () => {
  it('enforces least-privilege table isolation on nextera_web and isolates owner', async () => {
    // 1. Direct table access to quest review tables by nextera_web must be DENIED
    for (const table of ['quest_review_cycles', 'quest_review_assignments', 'quest_review_receipts']) {
      await expect(
        webClient.unsafe(`SELECT * FROM app.${table} LIMIT 1`),
      ).rejects.toThrow(/permission denied for table/);

      await expect(
        webClient.unsafe(`INSERT INTO app.${table} DEFAULT VALUES`),
      ).rejects.toThrow(/permission denied for table/);
    }

    // 2. nextera_quest_review_owner must be strictly isolated
    const [ownerRole] = await admin`
      SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = 'nextera_quest_review_owner'
    `;
    expect(ownerRole).toBeDefined();
    expect(ownerRole!.rolcanlogin).toBe(false);
    expect(ownerRole!.rolsuper).toBe(false);
    expect(ownerRole!.rolcreatedb).toBe(false);
    expect(ownerRole!.rolcreaterole).toBe(false);
    expect(ownerRole!.rolreplication).toBe(false);
    expect(ownerRole!.rolbypassrls).toBe(false);

    // 3. Owner role has 0 members and 0 memberships
    const memberRows = await admin`
      SELECT 1 FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.member OR r.oid = m.roleid
      WHERE r.rolname = 'nextera_quest_review_owner'
    `;
    expect(memberRows.length).toBe(0);
  });

  it('proves initial cycle preparation and automatic peer distribution with 5 frozen questions', async () => {
    const repository = createQuestReviewPostgresRepository({
      client: webClient,
      authority: nativeQuestReviewAuthority,
      selection: nativeQuestReviewSelection,
      limits: {
        transactionMs: 10000,
        statementMs: 5000,
        lockMs: 2000,
        maxGraphEdges: 100,
        maxMetadataBytes: 65536,
      },
    });

    const runtime = createRuntime();
    cycleSummary = await prepareQuestReview(repository, runtime, {
      scope: { cohortId, questKey, learnerId: learnerUserId },
      subjectId: learnerAuth,
    });

    expect(cycleSummary.assignmentState).toBe('assigned');
    expect(cycleSummary.eligibility.state).toBe('awaiting_peers');
    expect(cycleSummary.cycle.questionIds).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
    expect(cycleSummary.cycle.cohortId).toBe(cohortId);
    expect(cycleSummary.cycle.learnerId).toBe(learnerUserId);

    // Verify persisted rows in PostgreSQL via admin query
    const [persistedCycle] = await admin`
      SELECT * FROM app.quest_review_cycles WHERE id = ${cycleSummary.cycle.cycleId}::uuid
    `;
    expect(persistedCycle).toBeDefined();
    expect(persistedCycle!.question_ids).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
    expect(persistedCycle!.peer_count).toBe('1');
    expect(persistedCycle!.peer_gate).toBe('submitted');

    const assignments = await admin`
      SELECT * FROM app.quest_review_assignments WHERE cycle_id = ${cycleSummary.cycle.cycleId}::uuid
    `;
    expect(assignments.length).toBe(1);
    expect(assignments[0]!.kind).toBe('peer');
    assignedPeerId = String(assignments[0]!.reviewer_id);
    expect([peer1UserId, peer2UserId]).toContain(assignedPeerId);
    assignedPeerAuth = assignedPeerId === peer1UserId ? peer1Auth : peer2Auth;
    expect(assignments[0]!.learner_id).toBe(learnerUserId);
    peerAssignmentId = String(assignments[0]!.id);
  });

  it('rejects reciprocal peer assignment at the database trigger layer', async () => {
    // Attempting to assign learnerUserId as peer for assignedPeerId for the same quest
    // must be rejected by quest_review_assignment_graph trigger
    const invalidAssignmentId = randomUUID();
    const cycle2Id = randomUUID();

    // Insert a dummy cycle where learner is assignedPeerId
    await admin`
      INSERT INTO app.quest_review_cycles(
        id, cohort_id, quest_key, learner_id, curriculum_version_id,
        content_version, evidence_version, evidence_digest,
        question_bank_version, question_bank_digest, selection_policy_version, rubric_version,
        question_ids, policy_version, policy_revision, peer_count, peer_gate, ranking_policy_version
      ) VALUES (
        ${cycle2Id}::uuid, ${cohortId}::uuid, ${questKey}, ${assignedPeerId}::uuid, ${versionId}::uuid,
        'content-1', 'evidence-1', ${'e'.repeat(64)},
        'bank-1', ${'b'.repeat(64)}, 'selection-1', 'rubric-1',
        ARRAY['q1','q2','q3','q4','q5'], 1, 'policy-1', 1, 'submitted', 'rank-1'
      )
    `;

    // Attempt reciprocal assignment under graph lock: assignedPeerId is learner, reviewer is learnerUserId
    await expect(
      admin.begin(async (tx) => {
        await tx`SELECT app.quest_review_lock(${cohortId}::uuid, ${questKey}, NULL::uuid)`;
        await tx`
          INSERT INTO app.quest_review_assignments(
            id, cycle_id, cohort_id, quest_key, learner_id, policy_revision, reviewer_id, kind, assigned_at_ms
          ) VALUES (
            ${invalidAssignmentId}::uuid, ${cycle2Id}::uuid, ${cohortId}::uuid, ${questKey},
            ${assignedPeerId}::uuid, 'policy-1', ${learnerUserId}::uuid, 'peer', 1000
          )
        `;
      }),
    ).rejects.toThrow(/QUEST_REVIEW_RECORD_CONFLICT/);
  });

  it('records peer review receipt and automatically allocates mentor in one atomic transaction', async () => {
    const repository = createQuestReviewPostgresRepository({
      client: webClient,
      authority: nativeQuestReviewAuthority,
      selection: nativeQuestReviewSelection,
      limits: {
        transactionMs: 10000,
        statementMs: 5000,
        lockMs: 2000,
        maxGraphEdges: 100,
        maxMetadataBytes: 65536,
      },
    });

    const runtime = createRuntime();
    peerReceiptId = runtime.nextId();

    const result = await submitQuestReview(repository, runtime, {
      scope: { cohortId, questKey, learnerId: learnerUserId },
      subjectId: assignedPeerAuth,
      cycleId: cycleSummary.cycle.cycleId,
      assignmentId: peerAssignmentId,
      requestId: peerReceiptId,
      decision: 'submitted',
    });

    expect(result.replayed).toBe(false);
    expect(result.receipt.id).toBe(peerReceiptId);
    expect(result.receipt.decision).toBe('submitted');
    expect(result.eligibility.state).toBe('awaiting_mentor');

    // Verify PostgreSQL state: peer receipt stored, mentor assignment auto-created
    const [receiptRow] = await admin`
      SELECT * FROM app.quest_review_receipts WHERE id = ${peerReceiptId}::uuid
    `;
    expect(receiptRow).toBeDefined();
    expect(receiptRow!.decision).toBe('submitted');
    expect(receiptRow!.reviewer_id).toBe(assignedPeerId);

    const [mentorAssignment] = await admin`
      SELECT * FROM app.quest_review_assignments
      WHERE cycle_id = ${cycleSummary.cycle.cycleId}::uuid AND kind = 'mentor'
    `;
    expect(mentorAssignment).toBeDefined();
    assignedMentorId = String(mentorAssignment!.reviewer_id);
    const [mentorUserRow] = await admin`
      SELECT auth_user_id FROM app.users WHERE id = ${assignedMentorId}::uuid
    `;
    assignedMentorAuth = String(mentorUserRow!.auth_user_id);
    mentorAssignmentId = String(mentorAssignment!.id);
  });

  it('records mentor review approval and advances learner to mastered / XP-eligible', async () => {
    const repository = createQuestReviewPostgresRepository({
      client: webClient,
      authority: nativeQuestReviewAuthority,
      selection: nativeQuestReviewSelection,
      limits: {
        transactionMs: 10000,
        statementMs: 5000,
        lockMs: 2000,
        maxGraphEdges: 100,
        maxMetadataBytes: 65536,
      },
    });

    const runtime = createRuntime();
    mentorReceiptId = runtime.nextId();

    const result = await submitQuestReview(repository, runtime, {
      scope: { cohortId, questKey, learnerId: learnerUserId },
      subjectId: assignedMentorAuth,
      cycleId: cycleSummary.cycle.cycleId,
      assignmentId: mentorAssignmentId,
      requestId: mentorReceiptId,
      decision: 'approved',
    });

    expect(result.replayed).toBe(false);
    expect(result.receipt.id).toBe(mentorReceiptId);
    expect(result.receipt.decision).toBe('approved');
    expect(result.eligibility.state).toBe('completion_eligible');
    expect(result.eligibility.masteryEligible).toBe(true);
    expect(result.eligibility.xpEligible).toBe(true);

    // Verify PostgreSQL state: mentor receipt stored
    const [receiptRow] = await admin`
      SELECT * FROM app.quest_review_receipts WHERE id = ${mentorReceiptId}::uuid
    `;
    expect(receiptRow).toBeDefined();
    expect(receiptRow!.decision).toBe('approved');
    expect(receiptRow!.reviewer_id).toBe(assignedMentorId);
  });

  it('persists all review data across client disconnection and reconnection', async () => {
    // 1. Completely disconnect current webClient
    await webClient.end();

    // 2. Open brand new independent connection with separate connection pool
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.username = webLoginPrincipal;
    url.password = webLoginPassword;
    const reconnectedClient = postgres(url.toString(), { max: 4, prepare: false, onnotice: () => {} });

    try {
      // 3. Verify PostgreSQL records persist unchanged
      const cycles = await admin`
        SELECT * FROM app.quest_review_cycles WHERE cohort_id = ${cohortId}::uuid
      `;
      // Exactly 2 cycles in cohort (initial cycle + reciprocal test dummy)
      const primaryCycle = cycles.find((c) => c.id === cycleSummary.cycle.cycleId);
      expect(primaryCycle).toBeDefined();
      expect(primaryCycle!.question_ids).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);

      const assignments = await admin`
        SELECT * FROM app.quest_review_assignments
        WHERE cycle_id = ${cycleSummary.cycle.cycleId}::uuid
        ORDER BY assigned_at_ms
      `;
      expect(assignments.length).toBe(2);
      expect(assignments[0]!.kind).toBe('peer');
      expect(assignments[0]!.reviewer_id).toBe(assignedPeerId);
      expect(assignments[1]!.kind).toBe('mentor');
      expect(assignments[1]!.reviewer_id).toBe(assignedMentorId);

      const receipts = await admin`
        SELECT * FROM app.quest_review_receipts
        WHERE cycle_id = ${cycleSummary.cycle.cycleId}::uuid
        ORDER BY submitted_at_ms
      `;
      expect(receipts.length).toBe(2);
      expect(receipts[0]!.decision).toBe('submitted');
      expect(receipts[1]!.decision).toBe('approved');

      // 4. Reload quest review through the new repository connection
      const newRepository = createQuestReviewPostgresRepository({
        client: reconnectedClient,
        authority: nativeQuestReviewAuthority,
        selection: nativeQuestReviewSelection,
        limits: {
          transactionMs: 10000,
          statementMs: 5000,
          lockMs: 2000,
          maxGraphEdges: 100,
          maxMetadataBytes: 65536,
        },
      });

      let samplerCalled = false;
      const reconnectedRuntime: QuestReviewRuntime = {
        nowMs: () => Date.now(),
        nextId: () => randomUUID(),
        sampler: {
          policyVersion: 'selection-1',
          select: async () => {
            samplerCalled = true;
            return ['x1', 'x2', 'x3', 'x4', 'x5'];
          },
        },
      };

      const reloadedSummary = await prepareQuestReview(newRepository, reconnectedRuntime, {
        scope: { cohortId, questKey, learnerId: learnerUserId },
        subjectId: learnerAuth,
      });

      // It must return the durable existing cycle without re-running sampling!
      expect(samplerCalled).toBe(false);
      expect(reloadedSummary.cycle.cycleId).toBe(cycleSummary.cycle.cycleId);
      expect(reloadedSummary.cycle.questionIds).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
      expect(reloadedSummary.assignmentState).toBe('unchanged');
      expect(reloadedSummary.eligibility.state).toBe('completion_eligible');
      expect(reloadedSummary.eligibility.masteryEligible).toBe(true);
      expect(reloadedSummary.eligibility.xpEligible).toBe(true);
    } finally {
      await reconnectedClient.end();
    }
  });

  it('enforces immutable history triggers on cycles, assignments, and receipts', async () => {
    // Attempting UPDATE or DELETE on any quest review table must be blocked by trigger
    await expect(
      admin`UPDATE app.quest_review_cycles SET peer_count = 2 WHERE id = ${cycleSummary.cycle.cycleId}::uuid`,
    ).rejects.toThrow(/QUEST_REVIEW_HISTORY_IMMUTABLE/);

    await expect(
      admin`DELETE FROM app.quest_review_receipts WHERE id = ${peerReceiptId}::uuid`,
    ).rejects.toThrow(/QUEST_REVIEW_HISTORY_IMMUTABLE/);

    await expect(
      admin`DELETE FROM app.quest_review_assignments WHERE id = ${peerAssignmentId}::uuid`,
    ).rejects.toThrow(/QUEST_REVIEW_HISTORY_IMMUTABLE/);
  });
});
