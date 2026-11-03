import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { applyInvitationDrafts } from './apply-invitation-drafts';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    cohort: { type: 'string' },
    database: { type: 'string' },
    port: { type: 'string' },
  },
});

const email = values.email || `learner-${randomBytes(4).toString('hex')}@example.test`;
const displayName = values.name || 'New Learner';
const dbUrl =
  values.database ||
  process.env.TEST_DATABASE_URL ||
  'postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001';
const appPort = values.port || '3000';

async function main() {
  await applyInvitationDrafts(dbUrl);

  const sql = postgres(dbUrl, { max: 2, prepare: false });
  try {
    // 1. Get or pick active cohort
    let cohortId = values.cohort;
    if (!cohortId) {
      const cohorts = await sql`
        SELECT id FROM app.cohorts 
        WHERE status = 'active' 
        ORDER BY starts_at DESC 
        LIMIT 1
      `;
      if (cohorts.length === 0) {
        throw new Error('No active cohort found in target database. Please run test or create a cohort first.');
      }
      cohortId = String(cohorts[0]!.id);
    }

    // 2. Get or create an admin issuer user
    let adminUserId: string;
    const existingAdmins = await sql`
      SELECT id FROM app.users WHERE role = 'admin' AND active = true LIMIT 1
    `;
    if (existingAdmins.length > 0) {
      adminUserId = String(existingAdmins[0]!.id);
    } else {
      const authId = randomUUID();
      await sql`INSERT INTO auth.users (id, email) VALUES (${authId}, 'admin@nextera.local') ON CONFLICT DO NOTHING`;
      const [u] = await sql`
        INSERT INTO app.users (auth_user_id, display_name, role, active)
        VALUES (${authId}, 'Admin Operator', 'admin', true)
        RETURNING id
      `;
      adminUserId = String(u!.id);
    }

    // 3. Ensure issuer role and grant
    const issuerRole = 'nextera_invitation_test_issuer';
    const issuerPassword = 'TestIssuerSecret123!';
    await sql.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${issuerRole}') THEN
          CREATE ROLE ${issuerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${issuerPassword}';
        END IF;
      END $$;
      GRANT nextera_invitation_issuer TO ${issuerRole};
      GRANT USAGE ON SCHEMA app TO ${issuerRole};
    `);

    // 4. Configure issuance policy
    const [cohortRow] = await sql`SELECT curriculum_version_id FROM app.cohorts WHERE id = ${cohortId}`;

    // Check if email already has an invitation in this cohort (ledger enforces UNIQUE(cohort_id, email))
    const existingInvitation = await sql`
      SELECT id, phase, expires_at 
      FROM app.invitation_activations 
      WHERE email = ${email} AND cohort_id = ${cohortId}
      LIMIT 1
    `;
    if (existingInvitation.length > 0) {
      console.error('\n⚠️ Conflict: An invitation has already been issued for this email in this cohort.');
      console.error(`   Email : ${email}`);
      console.error(`   Cohort: ${cohortId}`);
      console.error(`   Status: Phase "${existingInvitation[0]!.phase}", Expires at ${existingInvitation[0]!.expires_at}`);
      console.error('\nUnder the Piscine security ledger, each email can only receive one invitation per cohort.');
      console.error('To invite this learner, either:');
      console.error('  1. Use a fresh email address (e.g. --email "ali.student2@test.local" or "ali+1@student.test")');
      console.error('  2. Omit the --email argument to automatically generate a unique test email address.\n');
      process.exit(1);
    }
    await sql`
      INSERT INTO app.invitation_issuance_policy (
        issuer_id, cohort_id, curriculum_version_id, issuer_login, enabled, max_lifetime_ms
      ) VALUES (
        ${adminUserId}, ${cohortId}, ${cohortRow!.curriculum_version_id}, ${issuerRole}, true, 86400000
      )
      ON CONFLICT (issuer_id, cohort_id) DO UPDATE SET issuer_login = ${issuerRole}, enabled = true;
    `;

    // 5. Connect as issuer role and issue token
    const targetDbName = new URL(dbUrl).pathname.replace(/^\//, '');
    const issuerSql = postgres({
      host: '127.0.0.1',
      port: 54322,
      database: targetDbName,
      username: issuerRole,
      password: issuerPassword,
      max: 1,
      prepare: false,
    });

    const token = randomBytes(32).toString('base64url');
    const tokenDigest = createHash('sha256').update(token, 'ascii').digest('hex');
    const invitationId = randomUUID();
    const requestId = randomUUID();
    const expiresAtMs = Date.now() + 86400000; // 24 hours

    try {
      const [res] = await issuerSql`
        SELECT app.invitation_issue(
          ${invitationId}::uuid,
          ${requestId}::uuid,
          ${adminUserId}::uuid,
          ${tokenDigest}::text,
          ${email}::text,
          ${displayName}::text,
          ${cohortId}::uuid,
          ${expiresAtMs}::bigint
        ) AS result
      `;

      if (res?.result?.kind !== 'issued') {
        throw new Error(`Invitation issue failed: ${JSON.stringify(res)}`);
      }

      const signupUrl = `http://localhost:${appPort}/signup#invitation=${token}`;
      console.log('\n======================================================');
      console.log('✓ Invitation issued successfully!');
      console.log(`  Student Name : ${displayName}`);
      console.log(`  Student Email: ${email}`);
      console.log(`  Cohort ID    : ${cohortId}`);
      console.log(`  Expires In   : 24 hours`);
      console.log('\n🔗 Open this link in your browser to activate account:');
      console.log(`   ${signupUrl}`);
      console.log('======================================================\n');
    } finally {
      await issuerSql.end();
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Error issuing invitation:', err);
  process.exit(1);
});
