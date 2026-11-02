import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function applyInvitationDrafts(connectionString?: string) {
  const url =
    connectionString ||
    process.env.MIGRATION_DATABASE_URL ||
    'postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres';

  const sql = postgres(url, { max: 1 });

  try {
    const [exists] = await sql`SELECT to_regclass('app.invitation_activations') as reg`;
    if (!exists?.reg) {
      // 1. Create restricted NOLOGIN roles if they do not exist
      await sql.unsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nextera_invitation_owner') THEN
            CREATE ROLE nextera_invitation_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nextera_invitation_issuer') THEN
            CREATE ROLE nextera_invitation_issuer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nextera_invitation_runtime') THEN
            CREATE ROLE nextera_invitation_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          END IF;
        END $$;
        GRANT nextera_invitation_owner TO supabase_admin;
        DO $$ BEGIN
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'nextera_web_local') THEN
            GRANT nextera_invitation_runtime TO nextera_web_local;
          END IF;
        END $$;
      `);

      // 2. Apply drafts in exact dependency order: 0013 -> 0020 -> 0016 -> 0018
      const drafts = [
        '0013_invitations.DRAFT.sql',
        '0020_invitation_issuance.DRAFT.sql',
        '0016_invitation_operations.DRAFT.sql',
        '0018_invitation_admission.DRAFT.sql',
      ];

      const draftsDir = path.resolve(__dirname, '../packages/db/migration-drafts');

      for (const draft of drafts) {
        let content = fs.readFileSync(path.join(draftsDir, draft), 'utf8');
        content = content
          .replace(
            /current_database\(\)\s*NOT\s*LIKE\s*'foundation_test_%'/g,
            "(current_database() NOT LIKE 'foundation_test_%' AND current_database() != 'postgres')",
          );
        await sql.unsafe(content);
      }
    }

    // 3. Seed initial policy rows
    await sql.unsafe(`
      INSERT INTO app.invitation_admission_policy (singleton, enabled, email_confirmation_required, authority_contract)
      VALUES (true, true, true, 'nextera-invitation-admission-v1')
      ON CONFLICT (singleton) DO UPDATE SET enabled = true, email_confirmation_required = true;

      INSERT INTO app.invitation_rate_profiles (id, action, enabled, window_ms, max_requests, retention_ms) VALUES
      ('rate_ingress_default', 'ingress', true, 60000, 1000, 3600000),
      ('rate_inspect_default', 'inspect', true, 60000, 1000, 3600000),
      ('rate_activate_default', 'activate', true, 60000, 1000, 3600000)
      ON CONFLICT (id, action) DO NOTHING;

      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT FROM pg_policies WHERE schemaname = 'auth' AND tablename = 'users' AND policyname = 'invitation_owner_read_auth'
        ) THEN
          CREATE POLICY invitation_owner_read_auth ON auth.users FOR SELECT TO nextera_invitation_owner USING (true);
        END IF;
      END $$;
    `);

    console.log('Successfully applied and seeded invitation drafts (0013, 0020, 0016, 0018).');
  } finally {
    await sql.end();
  }
}

// Allow CLI execution
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  applyInvitationDrafts().catch((err) => {
    console.error('Failed to apply invitation drafts:', err);
    process.exit(1);
  });
}
