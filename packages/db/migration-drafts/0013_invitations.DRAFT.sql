-- REVIEW DRAFT ONLY. NOT registered, NOT applied. No identity, credential, invitation,
-- accepted-learner row, principal or policy value is created. No runtime adapter exists.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_database() NOT LIKE 'foundation_test_%' THEN
  RAISE EXCEPTION 'Draft rehearsal requires an explicitly approved foundation_test database';
 END IF;
 IF to_regclass('app.invitation_activations') IS NOT NULL THEN
  RAISE EXCEPTION 'Invitation namespace occupied; review rather than overwrite';
 END IF;
END $$;
CREATE TABLE app.invitation_activations (
 id uuid PRIMARY KEY,
 token_digest text NOT NULL UNIQUE CHECK(token_digest ~ '^[0-9a-f]{64}$'),
 -- Admission identity is owned by the future reviewed accepted-learner source, NOT browser metadata.
 accepted_admission_id uuid NOT NULL,
 email text NOT NULL CHECK(length(email) BETWEEN 1 AND 320),
 display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 120),
 cohort_id uuid NOT NULL REFERENCES app.cohorts(id) ON DELETE RESTRICT,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 phase text NOT NULL DEFAULT 'issued' CHECK(phase IN ('issued','auth_pending','auth_ready','enrollment_pending','complete','existing')),
 request_id uuid,
 -- id is the deterministic managed-Auth operation reference. Never retry create from auth_pending.
 auth_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 fence bigint NOT NULL DEFAULT 0 CHECK(fence >= 0),
 lease_until timestamptz,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at > created_at),
 CHECK((phase='issued' AND auth_user_id IS NULL AND completed_at IS NULL)
   OR (phase='auth_pending' AND request_id IS NOT NULL AND auth_user_id IS NULL AND completed_at IS NULL)
   OR (phase IN ('auth_ready','enrollment_pending') AND request_id IS NOT NULL AND auth_user_id IS NOT NULL AND completed_at IS NULL)
   OR (phase='complete' AND request_id IS NOT NULL AND auth_user_id IS NOT NULL AND completed_at IS NOT NULL)
   OR (phase='existing' AND request_id IS NOT NULL AND auth_user_id IS NULL AND completed_at IS NULL)),
 CHECK(completed_at IS NULL OR completed_at >= created_at),
 UNIQUE(id, request_id)
);
-- Ledger pins and remote-operation ownership cannot be edited during a retry.
CREATE FUNCTION app.guard_invitation_activation() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$ BEGIN
 IF (NEW.id,NEW.token_digest,NEW.accepted_admission_id,NEW.email,NEW.display_name,NEW.cohort_id,NEW.expires_at,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.token_digest,OLD.accepted_admission_id,OLD.email,OLD.display_name,OLD.cohort_id,OLD.expires_at,OLD.created_at)
 OR (OLD.request_id IS NOT NULL AND NEW.request_id IS DISTINCT FROM OLD.request_id)
 OR (OLD.auth_user_id IS NOT NULL AND NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id)
 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
 OR NEW.fence < OLD.fence THEN RAISE EXCEPTION 'Immutable invitation activation scope'; END IF;
 IF NEW.phase<>OLD.phase AND NOT (
   (OLD.phase='issued' AND NEW.phase='auth_pending') OR
   (OLD.phase='auth_pending' AND NEW.phase IN ('auth_ready','existing')) OR
   (OLD.phase='auth_ready' AND NEW.phase='enrollment_pending') OR
   (OLD.phase='enrollment_pending' AND NEW.phase='complete')
 ) THEN RAISE EXCEPTION 'Invalid invitation activation transition'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_invitation_activation() FROM PUBLIC;
CREATE TRIGGER invitation_activation_scope_guard BEFORE UPDATE ON app.invitation_activations
FOR EACH ROW EXECUTE FUNCTION app.guard_invitation_activation();
CREATE UNIQUE INDEX invitation_activation_request_unique ON app.invitation_activations(request_id) WHERE request_id IS NOT NULL;
-- No generic web, browser, operational or service-role grants. A future narrow service
-- adapter must implement fenced CAS + eligibility rechecks with reviewed permissions.
ALTER TABLE app.invitation_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_activations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.invitation_activations FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','nextera_web'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON app.invitation_activations FROM %I',r);
  END IF;
 END LOOP;
END $$;
COMMENT ON TABLE app.invitation_activations IS
 'UNREGISTERED REVIEW DRAFT: no raw token or password columns; no issuance/redemption adapter; no runtime grants';
COMMIT;
