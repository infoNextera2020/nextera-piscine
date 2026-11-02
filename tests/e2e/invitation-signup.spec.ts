import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@nextera/db/schema';
import { importCurriculum } from '@nextera/db/operations/curriculum';
import { testCurriculum } from '../fixtures/curriculum';
import { applyInvitationDrafts } from '../../scripts/apply-invitation-drafts';

const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 2, prepare: false });
const db = drizzle(sql, { schema });
const admin = createClient(
  process.env.SUPABASE_LOCAL_URL!,
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let cohortId: string;
let curriculumVersionId: string;
let adminUserId: string;
let adminAuthId: string;
let issuerRoleName: string;
let issuerSql: ReturnType<typeof postgres>;
const cleanupAuthUserIds: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(90000);

  // 1. Ensure invitation schema, functions, triggers and policies exist
  await applyInvitationDrafts(process.env.MIGRATION_DATABASE_URL);

  // 2. Set up published curriculum and active cohort
  const fixture = testCurriculum();
  const version = await importCurriculum(
    db,
    fixture.curriculum,
    fixture.gitCommitSha,
    fixture.evaluations,
  );
  curriculumVersionId = version.id;

  const slug = `invitation-e2e-cohort-${randomUUID()}`;
  const [cohort] = await sql`
    INSERT INTO app.cohorts (slug, name, curriculum_version_id, status, starts_at)
    VALUES (${slug}, 'Invitation E2E Cohort', ${curriculumVersionId}, 'active', '2026-11-20T00:00:00Z')
    RETURNING id
  `;
  cohortId = String(cohort!.id);

  // 3. Create an active admin user for issuing invitations
  const adminEmail = `admin-issuer-${randomBytes(6).toString('hex')}@example.test`;
  const { data: adminAuthData, error: adminAuthErr } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: randomBytes(24).toString('hex'),
    email_confirm: true,
    user_metadata: { role: 'admin' },
  });
  if (adminAuthErr || !adminAuthData.user) {
    throw new Error('Failed to create admin auth user.');
  }
  adminAuthId = adminAuthData.user.id;
  cleanupAuthUserIds.push(adminAuthId);

  const [adminDomainUser] = await sql`
    INSERT INTO app.users (auth_user_id, display_name, role, active)
    VALUES (${adminAuthId}, 'Admin Issuer', 'admin', true)
    RETURNING id
  `;
  adminUserId = String(adminDomainUser!.id);

  // 4. Create a dedicated non-superuser login role for issuance (enforcing least privilege & separation of duties)
  issuerRoleName = 'nextera_invitation_test_issuer';
  const issuerPassword = 'TestIssuerSecret123!';
  await sql.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${issuerRoleName}') THEN
        CREATE ROLE ${issuerRoleName} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${issuerPassword}';
      ELSE
        ALTER ROLE ${issuerRoleName} WITH PASSWORD '${issuerPassword}';
      END IF;
    END $$;
    GRANT nextera_invitation_issuer TO ${issuerRoleName};
    GRANT USAGE ON SCHEMA app TO ${issuerRoleName};
  `);

  issuerSql = postgres({
    host: '127.0.0.1',
    port: 54322,
    database: 'postgres',
    username: issuerRoleName,
    password: issuerPassword,
    max: 1,
    prepare: false,
  });

  // 5. Configure invitation issuance policy for admin, cohort, and dedicated issuer role
  await sql`
    INSERT INTO app.invitation_issuance_policy (
      issuer_id, cohort_id, curriculum_version_id, issuer_login, enabled, max_lifetime_ms
    ) VALUES (
      ${adminUserId}, ${cohortId}, ${curriculumVersionId}, ${issuerRoleName}, true, 86400000
    )
    ON CONFLICT (issuer_id, cohort_id) DO UPDATE SET issuer_login = ${issuerRoleName}, enabled = true;
  `;
});

test.afterAll(async () => {
  try {
    if (issuerSql) {
      await issuerSql.end();
    }
    for (const authId of cleanupAuthUserIds) {
      try {
        await admin.auth.admin.deleteUser(authId);
      } catch {
        // Ignore auth deletion errors during test cleanup
      }
    }
  } finally {
    await sql.end();
  }
});

async function issueInvitation(params: {
  email: string;
  displayName: string;
  expiresInMs?: number;
}) {
  const token = randomBytes(32).toString('base64url');
  const tokenDigest = createHash('sha256').update(token, 'ascii').digest('hex');
  const invitationId = randomUUID();
  const requestId = randomUUID();
  const expiresAtMs = Date.now() + (params.expiresInMs ?? 3600000);

  const [res] = await issuerSql`
    SELECT app.invitation_issue(
      ${invitationId}::uuid,
      ${requestId}::uuid,
      ${adminUserId}::uuid,
      ${tokenDigest}::text,
      ${params.email}::text,
      ${params.displayName}::text,
      ${cohortId}::uuid,
      ${expiresAtMs}::bigint
    ) AS result
  `;

  if (res?.result?.kind !== 'issued') {
    throw new Error(`Failed to issue invitation: ${JSON.stringify(res)}`);
  }

  return {
    invitationId,
    requestId,
    token,
    tokenDigest,
    email: params.email,
    displayName: params.displayName,
    expiresAtMs,
  };
}

test.describe('Real Invitation Journey', () => {
  test('issues new invitation -> accepts via browser UI -> logs in -> active cohort membership in /app', async ({
    page,
  }) => {
    test.setTimeout(60000);

    const email = `invited-learner-${randomBytes(6).toString('hex')}@example.test`;
    const displayName = 'Accepted Learner E2E';
    const password = 'SafePass1234!Secure';

    // 1. Issue invitation through authoritative PostgreSQL function
    const invitation = await issueInvitation({ email, displayName });
    cleanupAuthUserIds.push(invitation.invitationId);

    // 2. Open browser at /signup with the private token fragment
    await page.goto(`/signup#invitation=${invitation.token}`);

    // Verify token was inspected by the page and fragment was stripped for privacy
    await expect(page).toHaveURL(/\/signup$/);

    // Verify locked identity fields from accepted invitation
    const nameInput = page.locator('#signup-name');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue(displayName);
    await expect(nameInput).toHaveAttribute('readonly', '');

    const emailInput = page.locator('#signup-email');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveValue(email);
    await expect(emailInput).toHaveAttribute('readonly', '');

    // 3. Complete password setup in the browser UI
    await page.locator('#signup-password').fill(password);
    await page.locator('#signup-confirm').fill(password);

    // Click "Activate account" button
    const activateButton = page.getByRole('button', { name: /Activate account/i });
    await expect(activateButton).toBeEnabled();
    await activateButton.click();

    // 4. Verify successful account activation view in the browser
    await expect(page.getByRole('heading', { name: 'Your account is ready' })).toBeVisible();
    const continueLink = page.getByRole('link', { name: 'Continue to sign in' });
    await expect(continueLink).toBeVisible();

    // 5. Navigate to /login and sign in with the activated credentials
    await continueLink.click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // 6. Assert landing on /app with active enrollment and cohort membership
    await page.waitForURL(/\/(?:app)(?:\?|$)/);
    await expect(page).toHaveURL(/\/app$/);

    // Verify the learner command center surface and cohort
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Invitation E2E Cohort' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hello Go' })).toBeVisible();

    // Verify the learner display name in the user identity component
    const userHeading = page.locator('h2', { hasText: displayName });
    await expect(userHeading).toHaveText(displayName);

    // 7. Verify authoritative database records in PostgreSQL
    const domainUsers = await sql`
      SELECT id, auth_user_id, display_name, role, active
      FROM app.users
      WHERE auth_user_id = ${invitation.invitationId}
    `;
    expect(domainUsers).toHaveLength(1);
    const domainUser = domainUsers[0]!;
    expect(domainUser.display_name).toBe(displayName);
    expect(domainUser.role).toBe('learner');
    expect(domainUser.active).toBe(true);

    const memberships = await sql`
      SELECT cohort_id, user_id, status
      FROM app.cohort_memberships
      WHERE cohort_id = ${cohortId} AND user_id = ${domainUser.id}
    `;
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.status).toBe('active');

    const progressRows = await sql`
      SELECT node_key, state
      FROM app.learner_node_progress
      WHERE cohort_id = ${cohortId} AND user_id = ${domainUser.id}
    `;
    expect(progressRows.length).toBeGreaterThan(0);
    expect(progressRows.some((r) => r.state === 'available')).toBe(true);

    const invitationRow = await sql`
      SELECT phase, auth_user_id, completed_at
      FROM app.invitation_activations
      WHERE id = ${invitation.invitationId}
    `;
    expect(invitationRow).toHaveLength(1);
    expect(invitationRow[0]!.phase).toBe('complete');
    expect(invitationRow[0]!.auth_user_id).toBe(invitation.invitationId);
    expect(invitationRow[0]!.completed_at).not.toBeNull();

    const receipts = await sql`
      SELECT invitation_id, auth_user_id, domain_user_id, cohort_id
      FROM app.invitation_enrollment_receipts
      WHERE invitation_id = ${invitation.invitationId}
    `;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.domain_user_id).toBe(domainUser.id);
  });

  test('rejects expired invitation link in browser UI', async ({ page }) => {
    const email = `expired-invite-${randomBytes(6).toString('hex')}@example.test`;
    const displayName = 'Expired Learner';

    // Issue invitation with 200ms lifetime then wait for it to expire
    const invitation = await issueInvitation({ email, displayName, expiresInMs: 200 });
    cleanupAuthUserIds.push(invitation.invitationId);

    // Wait until the invitation has expired past its immutable expiry
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Navigate to /signup with expired token
    await page.goto(`/signup#invitation=${invitation.token}`);

    // Verify UI displays "Invitation expired" notice and hides activation form
    await expect(page.getByRole('heading', { name: 'Invitation expired' })).toBeVisible();
    await expect(
      page.getByText('This invitation can no longer be used to activate an account.'),
    ).toBeVisible();
    await expect(page.locator('#signup-password')).toHaveCount(0);
  });

  test('rejects already used / consumed invitation link in browser UI', async ({ page }) => {
    const email = `consumed-invite-${randomBytes(6).toString('hex')}@example.test`;
    const displayName = 'Consumed Learner';
    const password = 'SafePass1234!Secure';

    // Issue and activate invitation
    const invitation = await issueInvitation({ email, displayName });
    cleanupAuthUserIds.push(invitation.invitationId);

    await page.goto(`/signup#invitation=${invitation.token}`);
    await page.locator('#signup-password').fill(password);
    await page.locator('#signup-confirm').fill(password);
    await page.getByRole('button', { name: /Activate account/i }).click();
    await expect(page.getByRole('heading', { name: 'Your account is ready' })).toBeVisible();

    // Re-visit the signup page with the same consumed token in a fresh page context
    const freshPage = await page.context().newPage();
    await freshPage.goto(`/signup#invitation=${invitation.token}`);

    // Verify UI rejects with "Invitation already used" and hides activation form
    await expect(freshPage.getByRole('heading', { name: 'Invitation already used' })).toBeVisible();
    await expect(
      freshPage.getByText('This invitation has already been used to activate an account.'),
    ).toBeVisible();
    await expect(freshPage.locator('#signup-password')).toHaveCount(0);
    await freshPage.close();
  });

  test('rejects uninvited/unprovisioned account at login with NOT_PROVISIONED', async ({
    page,
  }) => {
    const email = `uninvited-user-${randomBytes(6).toString('hex')}@example.test`;
    const password = randomBytes(24).toString('hex');

    // Create user in Supabase Auth directly (no invitation, no app.users row)
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error('Failed to create uninvited auth user.');
    }
    cleanupAuthUserIds.push(data.user.id);

    // Attempt login via the real UI
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // Verify redirect to /access-denied?reason=NOT_PROVISIONED
    await page.waitForURL(/\/access-denied\?reason=NOT_PROVISIONED/);
    await expect(page.getByRole('heading', { name: 'This workspace is unavailable' })).toBeVisible();
    await expect(page.getByText('NOT_PROVISIONED')).toBeVisible();
    await expect(
      page.getByText(
        'Your identity is authenticated, but a 01 coding account has not been provisioned. Contact your operator.',
      ),
    ).toBeVisible();
  });
});
