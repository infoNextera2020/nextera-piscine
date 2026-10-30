-- SOURCE REVIEW DRAFT ONLY. NOT registered, executed or enabled. No roles, policy
-- rows, invitations, tokens, accounts or credentials are created by preparing this file.
-- Deliberate installation order:0000-0010 ->0013 ->0020 ->0016 ->0018.
-- Issuing an invitation IS acceptance; no second per-learner approval flag exists.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ DECLARE r text; BEGIN
 IF current_database() NOT LIKE 'foundation_test_%' OR to_regclass('app.invitation_activations') IS NULL
 OR NOT pg_has_role(current_user,'nextera_invitation_owner','SET')
 THEN RAISE EXCEPTION 'Reviewed isolated invitation prerequisite and migration authority required'; END IF;
 FOREACH r IN ARRAY ARRAY['nextera_invitation_owner','nextera_invitation_issuer','nextera_invitation_runtime'] LOOP
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
   OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member WHERE member_role.rolname=r)
  THEN RAISE EXCEPTION 'Reviewed restricted NOLOGIN roles required'; END IF;
 END LOOP;
 IF has_schema_privilege('nextera_invitation_owner','app','CREATE')
 OR to_regclass('app.invitation_issuance_policy') IS NOT NULL OR to_regclass('app.invitation_acceptances') IS NOT NULL
 OR EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app'
  AND p.proname IN ('invitation_admission_current','invitation_issue','_invitation_issuer_guard','guard_invitation_acceptance'))
 THEN RAISE EXCEPTION 'Occupied namespace or unexpected prior CREATE; review rather than overwrite'; END IF;
END $$;

-- Empty deployment policy, not a second admission decision. No email/name acceptance
-- rows or owner permissions are inferred from a public users table or browser claim.
CREATE TABLE app.invitation_issuance_policy (
 issuer_id uuid NOT NULL REFERENCES app.users(id),
 cohort_id uuid NOT NULL,
 curriculum_version_id uuid NOT NULL,
 issuer_login name NOT NULL,
 enabled boolean NOT NULL,
 max_lifetime_ms bigint NOT NULL CHECK(max_lifetime_ms>0 AND max_lifetime_ms<=9007199254740991),
 PRIMARY KEY(issuer_id,cohort_id),
 FOREIGN KEY(cohort_id,curriculum_version_id) REFERENCES app.cohorts(id,curriculum_version_id)
);
CREATE TABLE app.invitation_acceptances (
 id uuid PRIMARY KEY,
 invitation_id uuid NOT NULL UNIQUE REFERENCES app.invitation_activations(id),
 request_id uuid NOT NULL UNIQUE,
 expires_at_ms bigint NOT NULL,
 issuer_id uuid NOT NULL REFERENCES app.users(id),
 cohort_id uuid NOT NULL,
 curriculum_version_id uuid NOT NULL,
 email text NOT NULL CHECK(length(email) BETWEEN 1 AND 320),
 display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL,
 UNIQUE(cohort_id,email),
 FOREIGN KEY(cohort_id,curriculum_version_id) REFERENCES app.cohorts(id,curriculum_version_id)
);
CREATE FUNCTION app.guard_invitation_acceptance() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Invitation acceptance identity is immutable'; END $$;
CREATE TRIGGER invitation_acceptance_immutable BEFORE UPDATE OR DELETE ON app.invitation_acceptances
FOR EACH ROW EXECUTE FUNCTION app.guard_invitation_acceptance();

-- Private same-transaction hook required by0016. Callers already lock the ledger;
-- lock acceptance -> cohort -> issuer/policy. Take the cohort UPDATE lock from
-- the outset, avoiding SHARE-to-UPDATE upgrade deadlocks between two enrollments.
CREATE FUNCTION app.invitation_admission_current(admission uuid,invited_email text,accepted_name text,cohort uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.invitation_acceptances; BEGIN
 SELECT * INTO a FROM app.invitation_acceptances r WHERE r.id=admission FOR SHARE;
 IF NOT FOUND OR (a.email,a.display_name,a.cohort_id) IS DISTINCT FROM (invited_email,accepted_name,cohort)
 THEN RETURN false; END IF;
 PERFORM 1 FROM app.cohorts c JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id
 WHERE c.id=cohort AND c.curriculum_version_id=a.curriculum_version_id AND c.status='active' AND v.status='published'
 FOR UPDATE OF c;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM app.users u WHERE u.id=a.issuer_id AND u.active AND u.role='admin' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM app.invitation_issuance_policy p WHERE p.issuer_id=a.issuer_id AND p.cohort_id=cohort
 AND p.curriculum_version_id=a.curriculum_version_id AND p.enabled FOR SHARE;
 RETURN FOUND;
END $$;
COMMENT ON FUNCTION app.invitation_admission_current(uuid,text,text,uuid) IS 'nextera-invitation-admission-v1';

CREATE FUNCTION app._invitation_issuer_guard() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r text; t text; BEGIN
 IF current_database() NOT LIKE 'foundation_test_%' OR NOT pg_has_role(session_user,'nextera_invitation_issuer','MEMBER')
 OR pg_has_role(session_user,'nextera_invitation_owner','MEMBER')
 OR pg_has_role(session_user,'nextera_invitation_runtime','MEMBER')
 OR EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
 THEN RAISE EXCEPTION 'Invitation issuance unavailable'; END IF;
 FOREACH r IN ARRAY ARRAY['nextera_invitation_owner','nextera_invitation_issuer','nextera_invitation_runtime'] LOOP
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
   OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member WHERE member_role.rolname=r)
  THEN RAISE EXCEPTION 'Invitation permission roles changed'; END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['invitation_acceptances','invitation_issuance_policy','invitation_activations'] LOOP
  IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname=t
    AND c.relrowsecurity AND c.relforcerowsecurity)
  THEN RAISE EXCEPTION 'Private invitation storage unavailable'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION app.invitation_issue(invitation uuid,request uuid,issuer uuid,digest text,invited_email text,accepted_name text,cohort uuid,expires_ms bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy app.invitation_issuance_policy; version uuid; expiry timestamptz; instant timestamptz;
 existing app.invitation_acceptances; BEGIN
 PERFORM app._invitation_issuer_guard();
 IF invitation IS NULL OR request IS NULL OR issuer IS NULL OR cohort IS NULL OR digest IS NULL
 OR digest !~ '^[0-9a-f]{64}$' OR invited_email IS NULL OR length(invited_email) NOT BETWEEN 1 AND 320
 OR invited_email ~ '[[:space:][:cntrl:]]' OR accepted_name IS NULL OR length(trim(accepted_name)) NOT BETWEEN 1 AND 120
 OR accepted_name ~ '[[:cntrl:]]' OR expires_ms IS NULL OR expires_ms<=0 OR expires_ms>9007199254740991
 THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 -- Existing request IDs never mint/return a second raw token. No automatic reissue/adoption.
 SELECT * INTO existing FROM app.invitation_acceptances a WHERE a.request_id=request;
 IF FOUND THEN
  -- Authorization is still current; do not reveal an unrelated owner's request state.
  IF existing.issuer_id<>issuer THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 END IF;
 -- Serialize policy/cohort through row locks; unique constraints are the final race arbiter.
 -- Issuance never changes an existing invitation/admission, avoiding reverse ledger lock order.
 SELECT c.curriculum_version_id INTO version FROM app.cohorts c JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id
 WHERE c.id=cohort AND c.status='active' AND v.status='published' FOR SHARE OF c;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 PERFORM 1 FROM app.users u WHERE u.id=issuer AND u.active AND u.role='admin' FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 SELECT * INTO policy FROM app.invitation_issuance_policy p WHERE p.issuer_id=issuer AND p.cohort_id=cohort
 AND p.curriculum_version_id=version AND p.enabled AND p.issuer_login=session_user FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 IF existing.id IS NOT NULL THEN
  IF (existing.email,existing.display_name,existing.cohort_id,existing.curriculum_version_id,existing.expires_at_ms)
   IS DISTINCT FROM (invited_email,accepted_name,cohort,version,expires_ms)
  THEN RETURN jsonb_build_object('kind','conflict'); END IF;
  RETURN jsonb_build_object('kind','already_issued');
 END IF;
 instant:=clock_timestamp(); expiry:=to_timestamp(expires_ms::numeric/1000);
 IF expiry<=instant OR expiry>instant+policy.max_lifetime_ms*interval '1 millisecond'
 THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 INSERT INTO app.invitation_activations(id,token_digest,accepted_admission_id,email,display_name,cohort_id,expires_at,created_at)
 VALUES(invitation,digest,invitation,invited_email,accepted_name,cohort,expiry,instant);
 INSERT INTO app.invitation_acceptances(id,invitation_id,request_id,expires_at_ms,issuer_id,cohort_id,curriculum_version_id,email,display_name,created_at)
 VALUES(invitation,invitation,request,expires_ms,issuer,cohort,version,invited_email,accepted_name,instant);
 -- Recheck after lock waits/work; any exception rolls back acceptance AND ledger.
 IF expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Invitation expired before issuance commit'; END IF;
 RETURN jsonb_build_object('kind','issued','invitation_id',invitation,'request_id',request,'issuer_id',issuer,
  'token_digest',digest,'email',invited_email,'display_name',accepted_name,'cohort_id',cohort,
  'expires_at_ms',expires_ms::text,'curriculum_version_id',version);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('kind','conflict');
END $$;

-- Finish ACLs, FORCE RLS and policies while the migration actor still owns objects.
ALTER TABLE app.invitation_issuance_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_issuance_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_acceptances FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_issuance_policy_owner ON app.invitation_issuance_policy TO nextera_invitation_owner
 USING(current_user='nextera_invitation_owner') WITH CHECK(current_user='nextera_invitation_owner');
CREATE POLICY invitation_acceptance_owner ON app.invitation_acceptances TO nextera_invitation_owner
 USING(current_user='nextera_invitation_owner') WITH CHECK(current_user='nextera_invitation_owner');
CREATE POLICY invitation_issuance_insert ON app.invitation_activations FOR INSERT TO nextera_invitation_owner
 WITH CHECK(current_user='nextera_invitation_owner');
REVOKE ALL ON app.invitation_issuance_policy,app.invitation_acceptances FROM PUBLIC;
REVOKE ALL ON FUNCTION app.guard_invitation_acceptance(),app.invitation_admission_current(uuid,text,text,uuid),
 app._invitation_issuer_guard(),app.invitation_issue(uuid,uuid,uuid,text,text,text,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_issue(uuid,uuid,uuid,text,text,text,uuid,bigint) TO nextera_invitation_issuer;
GRANT USAGE ON SCHEMA app TO nextera_invitation_owner,nextera_invitation_issuer;
GRANT INSERT(id,token_digest,accepted_admission_id,email,display_name,cohort_id,expires_at,created_at)
 ON app.invitation_activations TO nextera_invitation_owner;
-- Columns needed for current authority checks/row locks; no role or user-active writes.
GRANT SELECT(id,role,active) ON app.users TO nextera_invitation_owner;
GRANT UPDATE(id) ON app.users,app.cohorts TO nextera_invitation_owner;
GRANT SELECT(id,curriculum_version_id,status) ON app.cohorts TO nextera_invitation_owner;
GRANT SELECT(id,status) ON app.curriculum_versions TO nextera_invitation_owner;
-- Transient schema privilege solely for exact ownership transfers; initially absent.
GRANT CREATE ON SCHEMA app TO nextera_invitation_owner;
ALTER TABLE app.invitation_issuance_policy OWNER TO nextera_invitation_owner;
ALTER TABLE app.invitation_acceptances OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.guard_invitation_acceptance() OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_admission_current(uuid,text,text,uuid) OWNER TO nextera_invitation_owner;
ALTER FUNCTION app._invitation_issuer_guard() OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_issue(uuid,uuid,uuid,text,text,text,uuid,bigint) OWNER TO nextera_invitation_owner;
REVOKE CREATE ON SCHEMA app FROM nextera_invitation_owner;
DO $$ BEGIN
 IF has_schema_privilege('nextera_invitation_owner','app','CREATE') THEN RAISE EXCEPTION 'Unexpected retained owner CREATE'; END IF;
END $$;
-- No LOGIN creation, raw capabilities, policy seeds, mail, web/service/browser grants,
-- acceptance override, reissue/revoke UI, identity repair, progression or student-number changes.
COMMIT;
