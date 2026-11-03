import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@nextera/db/schema';
import { enrollLearner } from '@nextera/db/operations/cohorts';

const targetDbUrl =
  process.env.TEST_DATABASE_URL ||
  'postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001';

const sql = postgres(targetDbUrl, { max: 1 });

async function main() {
  console.log('--- Cleaning Up Old Test Fixture Cohorts and Promoting Week 1 Cohort ---');

  // 1. Identify the canonical Week 1 cohort (v8)
  const [targetCohort] = await sql`
    SELECT c.id, c.slug, c.name, c.curriculum_version_id
    FROM app.cohorts c
    WHERE c.slug = 'week1-trial-cohort-v8'
    LIMIT 1
  `;

  if (!targetCohort) {
    throw new Error('week1-trial-cohort-v8 not found! Run setup-week1-curriculum.ts first.');
  }

  const targetCohortId = String(targetCohort.id);
  console.log(`[TARGET COHORT] ${targetCohort.name} (${targetCohort.slug}) -> ID: ${targetCohortId}`);

  // Ensure target cohort is active and starts in the past so tasks are unlocked
  await sql`
    UPDATE app.cohorts
    SET status = 'active', starts_at = '2026-11-01T00:00:00Z'
    WHERE id = ${targetCohortId}::uuid
  `;

  // 2. Archive all other cohorts containing hello-go / even-or-odd fixtures or test dummies
  const archived = await sql`
    UPDATE app.cohorts
    SET status = 'archived'
    WHERE id != ${targetCohortId}::uuid
      AND status = 'active'
    RETURNING id, name, slug
  `;
  console.log(`[ARCHIVED] Deactivated ${archived.length} non-canonical / test fixture cohorts.`);

  // 3. Move all real learners enrolled in archived cohorts into the canonical Week 1 cohort
  const learners = await sql`
    SELECT DISTINCT u.id, u.display_name, au.email
    FROM app.users u
    JOIN auth.users au ON au.id = u.auth_user_id
    WHERE u.role = 'learner' AND u.active = true
  `;

  console.log(`[ENROLLING] Enrolling ${learners.length} learners into ${targetCohort.name}...`);
  const db = drizzle(sql, { schema });

  for (const learner of learners) {
    const learnerId = String(learner.id);
    try {
      await enrollLearner(db, targetCohortId, learnerId);
      console.log(`  ✓ Enrolled ${learner.display_name} (${learner.email}) into Week 1 cohort`);
    } catch (e: any) {
      console.log(`  - Skipped ${learner.display_name} (${learner.email}): ${e?.message || e}`);
    }
  }

  // 4. Ensure invitation issuance policy for admin targets this Week 1 cohort
  const issuerRole = 'nextera_invitation_test_issuer';
  const admins = await sql`SELECT id FROM app.users WHERE role = 'admin' AND active = true`;
  for (const admin of admins) {
    await sql`
      INSERT INTO app.invitation_issuance_policy (
        issuer_id, cohort_id, curriculum_version_id, issuer_login, enabled, max_lifetime_ms
      ) VALUES (
        ${admin.id}, ${targetCohortId}, ${targetCohort.curriculum_version_id}, ${issuerRole}, true, 604800000
      )
      ON CONFLICT (issuer_id, cohort_id) DO UPDATE SET issuer_login = ${issuerRole}, enabled = true;
    `;
  }
  console.log(`[ISSUANCE POLICY] Configured invitation policy for admins on Week 1 cohort`);

  // 5. Update judge worker capabilities with Week 1 cohort ID
  await sql`
    UPDATE judge.workers 
    SET capabilities = jsonb_set(capabilities, '{fixture_cohort_ids}', 
      (SELECT jsonb_agg(DISTINCT elem) FROM (
        SELECT jsonb_array_elements_text(capabilities->'fixture_cohort_ids') AS elem
        UNION SELECT ${targetCohortId}::text
      ) s)
    )
  `;
  console.log(`[JUDGE CAPABILITIES] Bound cohort ${targetCohortId} to judge workers`);

  // 6. Verify active cohorts list
  const activeCohorts = await sql`
    SELECT c.id, c.slug, c.name, c.status, count(m.user_id) as member_count
    FROM app.cohorts c
    LEFT JOIN app.cohort_memberships m ON m.cohort_id = c.id
    WHERE c.status = 'active'
    GROUP BY c.id, c.slug, c.name, c.status
  `;
  console.log('\n=== CURRENT ACTIVE COHORTS ===');
  console.log(activeCohorts);

  await sql.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
