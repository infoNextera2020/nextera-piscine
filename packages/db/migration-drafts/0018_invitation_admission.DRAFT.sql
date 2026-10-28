-- REVIEW DRAFT ONLY. NOT registered, executed, or enabled.
-- Depends on reviewed0013/0016, a REAL private admission authority, restricted existing
-- NOLOGIN owner/runtime roles and explicit operator policy. NO accepted records or policy defaults.
-- This is NOT invitation issuance/reissue or a public registration facility.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_database() NOT LIKE 'foundation_test_%' THEN RAISE EXCEPTION 'Approved isolated database required'; END IF;
 IF to_regprocedure('app._invitation_operations_guard()') IS NULL
 OR to_regprocedure('app.invitation_admission_current(uuid,text,text,uuid)') IS NULL
 OR NOT pg_has_role(current_user,'nextera_invitation_owner','SET')
 THEN RAISE EXCEPTION 'Reviewed invitation operations and admission authority required'; END IF;
 IF to_regclass('app.invitation_enrollment_receipts') IS NOT NULL
 OR to_regclass('app.invitation_admission_policy') IS NOT NULL
 OR to_regclass('app.invitation_rate_profiles') IS NOT NULL
 OR to_regclass('app.invitation_rate_counters') IS NOT NULL
 OR EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='app' AND p.proname IN ('_invitation_admission_guard','invitation_admission_ready',
 'invitation_scope_current','invitation_enroll','invitation_rate_consume','invitation_receipt_immutable'))
 THEN RAISE EXCEPTION 'Admission namespace occupied; do not replace blindly'; END IF;
END $$;

CREATE TABLE app.invitation_admission_policy (
 singleton boolean PRIMARY KEY CHECK(singleton),
 enabled boolean NOT NULL,
 email_confirmation_required boolean NOT NULL,
 authority_contract text NOT NULL CHECK(authority_contract='nextera-invitation-admission-v1')
);
-- Explicit profiles must be reviewed and inserted separately. There are intentionally NO rows/defaults.
CREATE TABLE app.invitation_rate_profiles (
 id text PRIMARY KEY CHECK(id ~ '^[a-z][a-z0-9_-]{0,63}$'),
 action text NOT NULL CHECK(action IN ('ingress','inspect','activate')),
 enabled boolean NOT NULL,
 window_ms integer NOT NULL CHECK(window_ms>0),
 max_requests integer NOT NULL CHECK(max_requests>0),
 retention_ms bigint NOT NULL CHECK(retention_ms>=window_ms),
 UNIQUE(id,action)
);
CREATE TABLE app.invitation_rate_counters (
 profile_id text NOT NULL REFERENCES app.invitation_rate_profiles(id),
 axis text NOT NULL CHECK(axis IN ('caller','token')),
 key_digest text NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'),
 window_number bigint NOT NULL,
 requests integer NOT NULL CHECK(requests>0),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(profile_id,axis,key_digest,window_number)
);
CREATE TABLE app.invitation_enrollment_receipts (
 invitation_id uuid PRIMARY KEY REFERENCES app.invitation_activations(id),
 request_id uuid NOT NULL,
 admission_id uuid NOT NULL,
 auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
 domain_user_id uuid NOT NULL UNIQUE REFERENCES app.users(id),
 cohort_id uuid NOT NULL,
 curriculum_version_id uuid NOT NULL,
 created_at timestamptz NOT NULL,
 FOREIGN KEY(cohort_id,domain_user_id) REFERENCES app.cohort_memberships(cohort_id,user_id),
 FOREIGN KEY(cohort_id,curriculum_version_id) REFERENCES app.cohorts(id,curriculum_version_id)
);
CREATE FUNCTION app.invitation_receipt_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Invitation enrollment receipts are immutable'; END $$;
CREATE TRIGGER invitation_receipt_immutable BEFORE UPDATE OR DELETE ON app.invitation_enrollment_receipts
FOR EACH ROW EXECUTE FUNCTION app.invitation_receipt_immutable();

CREATE FUNCTION app._invitation_admission_guard() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t text; BEGIN
 -- Rechecks isolated target, session/role boundaries and exact secure hook owner/signature/ACL.
 PERFORM app._invitation_operations_guard();
 IF NOT EXISTS(SELECT FROM app.invitation_admission_policy WHERE singleton AND enabled
 AND authority_contract='nextera-invitation-admission-v1') THEN RAISE EXCEPTION 'Admission policy unavailable'; END IF;
 FOREACH t IN ARRAY ARRAY['invitation_admission_policy','invitation_rate_profiles','invitation_rate_counters','invitation_enrollment_receipts'] LOOP
  IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='app' AND c.relname=t AND c.relrowsecurity AND c.relforcerowsecurity
   AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='nextera_invitation_owner'))
  THEN RAISE EXCEPTION 'Admission private storage unavailable'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION app.invitation_admission_ready(expected_confirmation boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app._invitation_admission_guard();
 RETURN EXISTS(SELECT FROM app.invitation_admission_policy WHERE singleton AND enabled
 AND email_confirmation_required=expected_confirmation);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION app.invitation_scope_current(invitation uuid,admission uuid,invited_email text,accepted_name text,cohort uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i app.invitation_activations; BEGIN
 PERFORM app._invitation_admission_guard();
 SELECT * INTO i FROM app.invitation_activations r WHERE r.id=invitation FOR SHARE;
 IF NOT FOUND OR i.revoked_at IS NOT NULL OR i.expires_at<=clock_timestamp() OR i.phase IN ('existing','complete')
 OR (i.accepted_admission_id,i.email,i.display_name,i.cohort_id) IS DISTINCT FROM (admission,invited_email,accepted_name,cohort)
 THEN RETURN false; END IF;
 -- The real hook MUST lock authoritative acceptance/access rows for this transaction.
 IF app.invitation_admission_current(admission,invited_email,accepted_name,cohort) IS NOT TRUE THEN RETURN false; END IF;
 PERFORM 1 FROM app.cohorts c JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id
 WHERE c.id=cohort AND c.status='active' AND v.status='published' FOR SHARE OF c;
 IF NOT FOUND THEN RETURN false; END IF;
 IF EXISTS(SELECT FROM app.users u WHERE u.auth_user_id=invitation AND (NOT u.active OR u.role<>'learner'))
 OR EXISTS(SELECT FROM app.users u JOIN app.cohort_memberships m ON m.user_id=u.id
 WHERE u.auth_user_id=invitation AND m.cohort_id=cohort AND m.status<>'active') THEN RETURN false; END IF;
 RETURN i.expires_at>clock_timestamp();
END $$;

CREATE FUNCTION app.invitation_enroll(invitation uuid,generation bigint,admission uuid,invited_email text,accepted_name text,cohort uuid,auth_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i app.invitation_activations; receipt app.invitation_enrollment_receipts; version uuid; learner uuid;
 instant timestamptz; expected_proof text; confirmed boolean; meta jsonb; actual_email text;
 confirmation timestamptz; banned timestamptz; deleted timestamptz;
BEGIN
 PERFORM app._invitation_admission_guard();
 SELECT * INTO i FROM app.invitation_activations r WHERE r.id=invitation FOR UPDATE;
 IF NOT FOUND OR generation IS NULL OR generation<=0 OR i.fence<>generation OR i.phase<>'enrollment_pending'
 OR i.request_id IS NULL OR i.auth_user_id IS DISTINCT FROM auth_id OR auth_id IS DISTINCT FROM invitation
 OR i.revoked_at IS NOT NULL OR i.expires_at<=clock_timestamp() OR i.lease_until IS NULL OR i.lease_until<=clock_timestamp()
 OR (i.accepted_admission_id,i.email,i.display_name,i.cohort_id) IS DISTINCT FROM (admission,invited_email,accepted_name,cohort)
 THEN RETURN 'blocked'; END IF;
 IF app.invitation_admission_current(admission,invited_email,accepted_name,cohort) IS NOT TRUE THEN RETURN 'blocked'; END IF;
 SELECT p.email_confirmation_required INTO confirmed FROM app.invitation_admission_policy p WHERE p.singleton AND p.enabled FOR SHARE;
 IF NOT FOUND THEN RETURN 'unknown'; END IF;
 -- JSON text elements joined WITHOUT spaces match managed-auth.ts JSON.stringify bytes.
 -- This private app_metadata proof is provider-owned, never user_metadata or browser claims.
 expected_proof:=encode(sha256(convert_to('['||array_to_string(ARRAY[
 to_json('nextera-invitation-v1'::text)::text,to_json(i.id::text)::text,to_json(i.accepted_admission_id::text)::text,
 to_json(i.email)::text,to_json(i.display_name)::text,to_json(i.cohort_id::text)::text,to_json('learner'::text)::text],',')||']','UTF8')),'hex');
 SELECT u.email,u.raw_app_meta_data,u.email_confirmed_at,u.banned_until,u.deleted_at
 INTO actual_email,meta,confirmation,banned,deleted FROM auth.users u WHERE u.id=auth_id;
 IF NOT FOUND OR actual_email IS DISTINCT FROM invited_email OR deleted IS NOT NULL OR banned>clock_timestamp()
 OR (confirmed AND confirmation IS NULL)
 OR meta->'nextera_invitation_activation'->'version' IS DISTINCT FROM '1'::jsonb
 OR meta->'nextera_invitation_activation'->>'operation_reference' IS DISTINCT FROM invitation::text
 OR meta->'nextera_invitation_activation'->>'scope_digest' IS DISTINCT FROM expected_proof
 THEN RETURN 'blocked'; END IF;
 SELECT c.curriculum_version_id INTO version FROM app.cohorts c JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id
 WHERE c.id=cohort AND c.status='active' AND v.status='published' FOR UPDATE OF c;
 IF NOT FOUND OR NOT EXISTS(SELECT FROM app.curriculum_nodes n WHERE n.curriculum_version_id=version)
 OR EXISTS(SELECT FROM app.node_prerequisites e WHERE e.curriculum_version_id=version AND e.rule<>'requires_pass')
 THEN RETURN 'blocked'; END IF;
 SELECT * INTO receipt FROM app.invitation_enrollment_receipts r WHERE r.invitation_id=invitation;
 IF FOUND THEN
  IF (receipt.request_id,receipt.admission_id,receipt.auth_user_id,receipt.cohort_id,receipt.curriculum_version_id)
   IS DISTINCT FROM (i.request_id,admission,auth_id,cohort,version) THEN RETURN 'blocked'; END IF;
  learner:=receipt.domain_user_id;
  PERFORM 1 FROM app.users u WHERE u.id=learner AND u.auth_user_id=auth_id AND u.display_name=accepted_name
   AND u.active AND u.role='learner' FOR SHARE;
  IF NOT FOUND THEN RETURN 'blocked'; END IF;
  PERFORM 1 FROM app.cohort_memberships m WHERE m.cohort_id=cohort AND m.user_id=learner AND m.status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN 'blocked'; END IF;
  IF EXISTS(SELECT FROM app.curriculum_nodes n WHERE n.curriculum_version_id=version AND NOT EXISTS(
   SELECT FROM app.learner_node_progress p WHERE p.cohort_id=cohort AND p.user_id=learner AND p.curriculum_version_id=version AND p.node_key=n.node_key))
  OR EXISTS(SELECT FROM app.learner_node_progress p WHERE p.cohort_id=cohort AND p.user_id=learner AND p.curriculum_version_id<>version)
  THEN RETURN 'blocked'; END IF;
 ELSE
  -- Never adopt, upgrade, reactivate or repair an unrelated provisioned identity/membership.
  IF EXISTS(SELECT FROM app.users u WHERE u.auth_user_id=auth_id) THEN RETURN 'blocked'; END IF;
  instant:=clock_timestamp();
  INSERT INTO app.users(auth_user_id,display_name,role,active) VALUES(auth_id,accepted_name,'learner',true) RETURNING id INTO learner;
  INSERT INTO app.cohort_memberships(cohort_id,user_id,status,joined_at) VALUES(cohort,learner,'active',instant);
  -- Same initial roots as initialNodeProgress/enrollLearner: no incoming prerequisite => available.
  -- No mastery, result, attempt, activity award or curriculum record is manufactured.
  INSERT INTO app.learner_node_progress(cohort_id,user_id,curriculum_version_id,node_key,state,unlocked_at)
  SELECT cohort,learner,version,n.node_key,
   CASE WHEN EXISTS(SELECT FROM app.node_prerequisites e WHERE e.curriculum_version_id=version AND e.dependent_node_key=n.node_key)
    THEN 'locked'::app.progress_state ELSE 'available'::app.progress_state END,
   CASE WHEN NOT EXISTS(SELECT FROM app.node_prerequisites e WHERE e.curriculum_version_id=version AND e.dependent_node_key=n.node_key) THEN instant ELSE NULL END
  FROM app.curriculum_nodes n WHERE n.curriculum_version_id=version;
  INSERT INTO app.invitation_enrollment_receipts(invitation_id,request_id,admission_id,auth_user_id,domain_user_id,cohort_id,curriculum_version_id,created_at)
  VALUES(invitation,i.request_id,admission,auth_id,learner,cohort,version,instant);
 END IF;
 -- Raising rolls back ALL new rows if the lease/deadline expired while locks/work were pending.
 IF i.expires_at<=clock_timestamp() OR i.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Invitation enrollment expired'; END IF;
 RETURN 'complete';
END $$;

CREATE FUNCTION app.invitation_rate_consume(profile text,requested_action text,caller_digest text,token_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.invitation_rate_profiles; w bigint; instant timestamptz; total integer; key_value text; axis_value text;
BEGIN
 PERFORM app._invitation_admission_guard();
 IF caller_digest IS NULL OR caller_digest !~ '^[0-9a-f]{64}$'
 OR requested_action IS NULL OR requested_action NOT IN ('ingress','inspect','activate')
 OR (requested_action='ingress' AND token_digest IS NOT NULL)
 OR (requested_action<>'ingress' AND (token_digest IS NULL OR token_digest !~ '^[0-9a-f]{64}$'))
 THEN RAISE EXCEPTION 'Invalid rate scope'; END IF;
 SELECT * INTO p FROM app.invitation_rate_profiles r WHERE r.id=profile AND r.action=requested_action AND r.enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rate policy unavailable'; END IF;
 instant:=clock_timestamp(); w:=floor(extract(epoch FROM instant)*1000/p.window_ms)::bigint;
 -- Caller budget is independent of token rotation. Token budget is shared across callers.
 FOREACH axis_value IN ARRAY CASE WHEN token_digest IS NULL THEN ARRAY['caller'] ELSE ARRAY['caller','token'] END LOOP
  key_value:=CASE WHEN axis_value='caller' THEN caller_digest ELSE token_digest END;
  INSERT INTO app.invitation_rate_counters(profile_id,axis,key_digest,window_number,requests,expires_at)
  VALUES(profile,axis_value,key_value,w,1,instant+p.retention_ms*interval '1 millisecond')
  ON CONFLICT(profile_id,axis,key_digest,window_number) DO UPDATE SET requests=app.invitation_rate_counters.requests+1
   WHERE app.invitation_rate_counters.requests<p.max_requests
  RETURNING requests INTO total;
  IF NOT FOUND THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

ALTER TABLE app.invitation_admission_policy OWNER TO nextera_invitation_owner;
ALTER TABLE app.invitation_rate_profiles OWNER TO nextera_invitation_owner;
ALTER TABLE app.invitation_rate_counters OWNER TO nextera_invitation_owner;
ALTER TABLE app.invitation_enrollment_receipts OWNER TO nextera_invitation_owner;
ALTER TABLE app.invitation_admission_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_admission_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_rate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_rate_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_rate_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_rate_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_enrollment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_enrollment_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_policy_owner ON app.invitation_admission_policy TO nextera_invitation_owner
 USING(current_user='nextera_invitation_owner') WITH CHECK(current_user='nextera_invitation_owner');
CREATE POLICY invitation_rate_profile_owner ON app.invitation_rate_profiles TO nextera_invitation_owner
 USING(current_user='nextera_invitation_owner') WITH CHECK(current_user='nextera_invitation_owner');
CREATE POLICY invitation_rate_counter_owner ON app.invitation_rate_counters TO nextera_invitation_owner
 USING(current_user='nextera_invitation_owner') WITH CHECK(current_user='nextera_invitation_owner');
CREATE POLICY invitation_enrollment_owner ON app.invitation_enrollment_receipts TO nextera_invitation_owner
 USING(current_user='nextera_invitation_owner') WITH CHECK(current_user='nextera_invitation_owner');
ALTER FUNCTION app.invitation_receipt_immutable() OWNER TO nextera_invitation_owner;
ALTER FUNCTION app._invitation_admission_guard() OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_admission_ready(boolean) OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_scope_current(uuid,uuid,text,text,uuid) OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_enroll(uuid,bigint,uuid,text,text,uuid,uuid) OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_rate_consume(text,text,text,text) OWNER TO nextera_invitation_owner;
-- Only the private NOLOGIN owner obtains narrowly bounded insertion privileges. No generic runtime table writes.
GRANT INSERT(auth_user_id,display_name,role,active) ON app.users TO nextera_invitation_owner;
GRANT INSERT(cohort_id,user_id,status,joined_at) ON app.cohort_memberships TO nextera_invitation_owner;
GRANT INSERT(cohort_id,user_id,curriculum_version_id,node_key,state,unlocked_at) ON app.learner_node_progress TO nextera_invitation_owner;
GRANT SELECT(curriculum_version_id,dependent_node_key,rule) ON app.node_prerequisites TO nextera_invitation_owner;
GRANT USAGE ON SCHEMA auth TO nextera_invitation_owner;
GRANT SELECT(id,email,raw_app_meta_data,email_confirmed_at,banned_until,deleted_at) ON auth.users TO nextera_invitation_owner;
REVOKE ALL ON app.invitation_admission_policy,app.invitation_rate_profiles,app.invitation_rate_counters,app.invitation_enrollment_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION app.invitation_receipt_immutable(),app._invitation_admission_guard(),app.invitation_admission_ready(boolean),
 app.invitation_scope_current(uuid,uuid,text,text,uuid),app.invitation_enroll(uuid,bigint,uuid,text,text,uuid,uuid),
 app.invitation_rate_consume(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_admission_ready(boolean),app.invitation_scope_current(uuid,uuid,text,text,uuid),
 app.invitation_enroll(uuid,bigint,uuid,text,text,uuid,uuid),app.invitation_rate_consume(text,text,text,text) TO nextera_invitation_runtime;
-- No CREATE ROLE, issuance, policy inserts, self-enrollment, mail, registered migration or web/anon grants.
-- Rate-counter expiry is metadata; an explicit reviewed purge/retention operation is still required before enablement.
COMMIT;
