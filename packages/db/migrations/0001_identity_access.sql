-- Reviewed privilege migration. Foundation 001 and Supabase-managed schemas are unchanged.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nextera_web') THEN
    CREATE ROLE nextera_web NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'nextera_web'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
      WHERE r.rolname = 'nextera_web') THEN
    RAISE EXCEPTION 'nextera_web must be a restricted, unprivileged NOLOGIN role';
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app, judge FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app, judge FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, judge FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA app, judge FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app, judge FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, judge FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA judge FROM nextera_web;
REVOKE ALL ON ALL TABLES IN SCHEMA app, judge FROM nextera_web;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, judge FROM nextera_web;
GRANT USAGE ON SCHEMA app TO nextera_web;
GRANT SELECT (id, auth_user_id, display_name, role, active) ON app.users TO nextera_web;
--> statement-breakpoint
-- Applies to objects subsequently created by this migration owner. Future migrations
-- from a different owner must explicitly maintain these defaults and private grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA app, judge REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app, judge REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app, judge REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
