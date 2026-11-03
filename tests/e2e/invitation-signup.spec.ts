import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@nextera/db/schema';
import { importCurriculum } from '@nextera/db/operations/curriculum';
import { applyResult } from '@nextera/db/operations/results';
import { evaluationDigest } from '../../scripts/curriculum/digest';
import { testCurriculum } from '../fixtures/curriculum';
import { applyInvitationDrafts } from '../../scripts/apply-invitation-drafts';

const targetDbUrl =
  process.env.TEST_DATABASE_URL ||
  (process.env.MIGRATION_DATABASE_URL?.includes('/foundation_test')
    ? process.env.MIGRATION_DATABASE_URL
    : 'postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001');
const targetDbName = new URL(targetDbUrl).pathname.replace(/^\//, '');

const sql = postgres(targetDbUrl, { max: 4, prepare: false });
const db = drizzle(sql, { schema });
const admin = createClient(
  process.env.SUPABASE_LOCAL_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const artifacts = 'C:\\Users\\NEXTERA\\nextera-judge-artifacts';
const credentials = process.env.NEXTERA_CREDENTIALS_DIR || 'C:\\Users\\NEXTERA\\nextera-credentials-run003';
const candidate = JSON.parse(readFileSync(join(artifacts, 'candidate.json'), 'utf8'));
const worker = JSON.parse(readFileSync(join(credentials, 'worker.json'), 'utf8'));
const runnerEnv = parse(readFileSync(join(credentials, 'runner.env')));

const toWslPath = (p: string) =>
  p.replace(/^[a-zA-Z]:[\\/]/, (m) => `/mnt/host/${m[0]!.toLowerCase()}/`).replace(/\\/g, '/');

function runWorker() {
  const wslRunner = '/mnt/host/c/Users/NEXTERA/Desktop/nextera-piscine/.tools/runner';
  // Ensure token file is in WSL /tmp with mode 0600
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
  child.stdout?.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr?.on('data', (d) => {
    stderr += d.toString();
  });
  const exited = new Promise<{ code: number | null }>((resolve) => {
    child.on('exit', (code) => resolve({ code }));
  });
  return { child, exited, getLogs: () => stdout, getErrors: () => stderr };
}

let cohortId: string;
let curriculumVersionId: string;
let adminUserId: string;
let adminAuthId: string;
let issuerRoleName: string;
let issuerSql: ReturnType<typeof postgres>;
const cleanupAuthUserIds: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(120000);

  // 1. Sync trigger from postgres.auth.users to slice database
  const pgSql = postgres('postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres');
  try {
    await pgSql.unsafe(`
      CREATE EXTENSION IF NOT EXISTS dblink;
      CREATE OR REPLACE FUNCTION auth.sync_user_to_slice() RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          PERFORM public.dblink_exec(
            'host=127.0.0.1 port=5432 dbname=${targetDbName} user=supabase_admin password=postgres',
            format('DELETE FROM auth.users WHERE id = %L;', OLD.id)
          );
          RETURN OLD;
        ELSE
          PERFORM public.dblink_exec(
            'host=127.0.0.1 port=5432 dbname=${targetDbName} user=supabase_admin password=postgres',
            format(
              'INSERT INTO auth.users (id, email, raw_app_meta_data, email_confirmed_at, banned_until, deleted_at) ' ||
              'VALUES (%L, %L, %L::jsonb, %L, %L, %L) ' ||
              'ON CONFLICT (id) DO UPDATE SET ' ||
              'email = EXCLUDED.email, ' ||
              'raw_app_meta_data = EXCLUDED.raw_app_meta_data, ' ||
              'email_confirmed_at = EXCLUDED.email_confirmed_at, ' ||
              'banned_until = EXCLUDED.banned_until, ' ||
              'deleted_at = EXCLUDED.deleted_at;',
              NEW.id, NEW.email, NEW.raw_app_meta_data, NEW.email_confirmed_at, NEW.banned_until, NEW.deleted_at
            )
          );
          RETURN NEW;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;

      DROP TRIGGER IF EXISTS tr_sync_user_to_slice ON auth.users;
      CREATE TRIGGER tr_sync_user_to_slice
      AFTER INSERT OR UPDATE OR DELETE ON auth.users
      FOR EACH ROW EXECUTE FUNCTION auth.sync_user_to_slice();
    `);
  } finally {
    await pgSql.end();
  }

  // 2. Ensure invitation schema, functions, triggers and policies exist
  await applyInvitationDrafts(targetDbUrl);

  // 3. Set up published curriculum with real candidate evaluations and active cohort
  const fixture = testCurriculum();
  const evaluations = fixture.curriculum.nodes.map((node) => {
    const entry = candidate.catalog.test_packs[node.testPackId]!;
    const layoutPath = toWslPath(join(artifacts, node.testPackId));
    const spec = {
      ...entry,
      test_only: true,
      curriculum_key: fixture.curriculum.key,
      curriculum_version: fixture.curriculum.version,
      content_digest: fixture.curriculum.contentDigest,
      node_key: node.key,
      subject_digest: node.subjectDigest,
      configuration_digest: node.configurationDigest,
      test_pack_id: node.testPackId,
      test_pack_artifact: `oci://${layoutPath.startsWith('/') ? '' : '/'}${layoutPath}@sha256:${entry.test_pack_digest}`,
    };
    return { nodeKey: node.key, spec, digest: evaluationDigest(spec) };
  });

  const version = await importCurriculum(
    db,
    fixture.curriculum,
    fixture.gitCommitSha,
    evaluations,
  );
  curriculumVersionId = version.id;

  const slug = `invitation-e2e-cohort-${randomUUID()}`;
  const [cohort] = await sql`
    INSERT INTO app.cohorts (slug, name, curriculum_version_id, status, starts_at)
    VALUES (${slug}, 'Invitation E2E Cohort', ${curriculumVersionId}, 'active', '2026-11-20T00:00:00Z')
    RETURNING id
  `;
  cohortId = String(cohort!.id);

  // 4. Update worker capabilities with cohortId
  await sql`
    UPDATE judge.workers 
    SET capabilities = jsonb_set(capabilities, '{fixture_cohort_ids}', 
      (SELECT jsonb_agg(DISTINCT elem) FROM (
        SELECT jsonb_array_elements_text(capabilities->'fixture_cohort_ids') AS elem
        UNION SELECT ${cohortId}::text
      ) s)
    )
    WHERE id = ${worker.worker_id}
  `;

  // 5. Create active admin user for issuing invitations
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

  // Sync to slice
  await sql`
    INSERT INTO auth.users (id, email) VALUES (${adminAuthId}, ${adminEmail})
    ON CONFLICT (id) DO NOTHING
  `;
  const [adminDomainUser] = await sql`
    INSERT INTO app.users (auth_user_id, display_name, role, active)
    VALUES (${adminAuthId}, 'Admin Issuer', 'admin', true)
    RETURNING id
  `;
  adminUserId = String(adminDomainUser!.id);

  // 6. Create a dedicated non-superuser login role for issuance
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
    database: targetDbName,
    username: issuerRoleName,
    password: issuerPassword,
    max: 1,
    prepare: false,
  });

  // 7. Configure invitation issuance policy for admin, cohort, and dedicated issuer role
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
  test('issues new invitation -> accepts via browser UI -> logs in -> active cohort membership -> wrong answer FAIL -> correct answer PASS -> progress survives logout/login', async ({
    page,
  }) => {
    test.setTimeout(180000);

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
    expect(progressRows.some((r) => r.node_key === 'hello-go' && r.state === 'available')).toBe(true);

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

    // 8. Navigate to supported Go challenge and verify initial unmastered state
    await page.goto(`/app/cohorts/${cohortId}/challenges/hello-go`);
    await expect(page.getByRole('heading', { name: 'Hello Go', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Submit your solution' })).toBeVisible();

    const [progBefore] = await sql`
      SELECT state FROM app.learner_node_progress
      WHERE cohort_id = ${cohortId} AND user_id = ${domainUser.id} AND node_key = 'hello-go'
    `;
    expect(progBefore!.state).toBe('available');

    // 9. Submit WRONG answer -> FAIL via real Runner
    const wrongSource = 'package main\n\nfunc Hello(name string) string {\n\treturn "wrong"\n}\n';
    await page.getByLabel('Solution file (hello.go)').setInputFiles({
      name: 'hello.go',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(wrongSource),
    });

    const submitResponse1 = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/submissions',
    );
    await page.getByRole('button', { name: 'Submit solution', exact: true }).click();
    const resp1 = await submitResponse1;
    expect(resp1.status()).toBe(202);
    const body1 = (await resp1.json()) as { id: string };

    const [sub1Row] = await sql`SELECT active_judge_job_id FROM app.submissions WHERE id = ${body1.id}`;
    const jobId1 = String(sub1Row!.active_judge_job_id);

    // Execute real Runner on protected host
    const runner1 = runWorker();
    const { code: rCode1 } = await runner1.exited;
    console.log('Runner 1 exit code:', rCode1, 'stdout:', runner1.getLogs(), 'stderr:', runner1.getErrors());

    // Verify terminal result in PostgreSQL
    await expect
      .poll(
        async () => {
          const [row] = await sql`
            SELECT r.verdict FROM judge.jobs j
            JOIN judge.results r ON r.id = j.terminal_result_id
            WHERE j.id = ${jobId1}
          `;
          return (row?.verdict as string | undefined) ?? null;
        },
        { timeout: 30000, intervals: [500, 1000] },
      )
      .toBe('failed');

    // Verify UI reflects failed verdict
    await expect(page.locator('[data-verdict="failed"]').first()).toBeVisible({ timeout: 10000 });

    // Verify progress in PostgreSQL transitions to in_progress (NOT mastered)
    const [progAfterFail] = await sql`
      SELECT state, mastered_at FROM app.learner_node_progress
      WHERE cohort_id = ${cohortId} AND user_id = ${domainUser.id} AND node_key = 'hello-go'
    `;
    expect(progAfterFail!.state).toBe('in_progress');
    expect(progAfterFail!.mastered_at).toBeNull();

    // 10. Submit CORRECT answer -> PASS via real Runner
    const passSource =
      'package main\n\nfunc Hello(name string) string {\n\treturn "Hello, " + name + "!"\n}\n';
    await page.getByLabel('Solution file (hello.go)').setInputFiles({
      name: 'hello.go',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(passSource),
    });

    const submitResponse2 = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/submissions',
    );
    await page.getByRole('button', { name: 'Submit solution', exact: true }).click();
    const resp2 = await submitResponse2;
    expect(resp2.status()).toBe(202);
    const body2 = (await resp2.json()) as { id: string };

    const [sub2Row] = await sql`SELECT active_judge_job_id FROM app.submissions WHERE id = ${body2.id}`;
    const jobId2 = String(sub2Row!.active_judge_job_id);

    // Execute real Runner on protected host
    const runner2 = runWorker();
    const { code: rCode2 } = await runner2.exited;
    console.log('Runner 2 exit code:', rCode2, 'stdout:', runner2.getLogs(), 'stderr:', runner2.getErrors());

    let passResultId: string | null = null;
    await expect
      .poll(
        async () => {
          const [row] = await sql`
            SELECT r.id, r.verdict FROM judge.jobs j
            JOIN judge.results r ON r.id = j.terminal_result_id
            WHERE j.id = ${jobId2}
          `;
          passResultId = (row?.id as string | undefined) ?? null;
          return (row?.verdict as string | undefined) ?? null;
        },
        { timeout: 30000, intervals: [500, 1000] },
      )
      .toBe('passed');

    // Verify UI reflects passed verdict
    await expect(page.locator('[data-verdict="passed"]').first()).toBeVisible({ timeout: 10000 });

    // Apply pass result to progression
    const applicationReceipt = await applyResult(db, passResultId!);
    expect(applicationReceipt.application_status).toBe('applied');

    // Verify PostgreSQL: learner_node_progress is now mastered
    const [progAfterPass] = await sql`
      SELECT state, mastered_at FROM app.learner_node_progress
      WHERE cohort_id = ${cohortId} AND user_id = ${domainUser.id} AND node_key = 'hello-go'
    `;
    expect(progAfterPass!.state).toBe('mastered');
    expect(progAfterPass!.mastered_at).not.toBeNull();

    // 11. Progress survives logout and login
    await page.context().clearCookies();
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login$/);

    // Log in again as the same invited learner
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await page.waitForURL(/\/(?:app)(?:\?|$)/);
    await expect(page).toHaveURL(/\/app$/);

    // Re-verify in PostgreSQL that progress survived across session lifecycle
    const [progAfterRelogin] = await sql`
      SELECT state, mastered_at FROM app.learner_node_progress
      WHERE cohort_id = ${cohortId} AND user_id = ${domainUser.id} AND node_key = 'hello-go'
    `;
    expect(progAfterRelogin!.state).toBe('mastered');
    expect(progAfterRelogin!.mastered_at).toEqual(progAfterPass!.mastered_at);

    // Visit challenge page again and verify passed status remains durable
    await page.goto(`/app/cohorts/${cohortId}/challenges/hello-go`);
    await expect(page.locator('[data-verdict="passed"]').first()).toBeVisible();
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
