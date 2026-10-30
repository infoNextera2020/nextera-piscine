-- REVIEW DRAFT ONLY: unregistered and unexecuted. Depends on reviewed0013 and a
-- separately implemented private admission authority. No credentials/accounts/tokens/roles created.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ DECLARE r text; h oid; p pg_proc; owner_oid oid; BEGIN
 IF current_database() NOT LIKE 'foundation_test_%' THEN RAISE EXCEPTION 'Approved isolated database required'; END IF;
 FOREACH r IN ARRAY ARRAY['nextera_invitation_owner','nextera_invitation_runtime'] LOOP
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
  OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles pr ON pr.oid=m.member WHERE pr.rolname=r)
  THEN RAISE EXCEPTION 'Reviewed restricted NOLOGIN invitation roles required'; END IF;
 END LOOP;
 IF NOT pg_has_role(current_user,'nextera_invitation_owner','SET') THEN RAISE EXCEPTION 'Reviewed migration authority required'; END IF;
 IF to_regclass('app.invitation_activations') IS NULL THEN RAISE EXCEPTION 'Reviewed invitation ledger draft required'; END IF;
 h:=to_regprocedure('app.invitation_admission_current(uuid,text,text,uuid)');
 IF h IS NULL THEN RAISE EXCEPTION 'Reviewed same-transaction admission authority is missing'; END IF;
 SELECT * INTO p FROM pg_proc WHERE oid=h; SELECT oid INTO owner_oid FROM pg_roles WHERE rolname='nextera_invitation_owner';
 IF p.proowner<>owner_oid OR NOT p.prosecdef OR p.prorettype<>'boolean'::regtype OR p.provolatile<>'v'
 OR p.proretset OR p.prokind<>'f' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
 OR EXISTS(SELECT FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)
 OR obj_description(h,'pg_proc') IS DISTINCT FROM 'nextera-invitation-admission-v1'
 THEN RAISE EXCEPTION 'Admission hook owner/signature/ACL/search-path/contract is not reviewed'; END IF;
 IF EXISTS(SELECT FROM pg_proc fn JOIN pg_namespace n ON n.oid=fn.pronamespace WHERE n.nspname='app' AND fn.proname IN
 ('invitation_operations_ready','_invitation_operations_guard','invitation_find','invitation_claim','invitation_advance','invitation_complete','invitation_release'))
 THEN RAISE EXCEPTION 'Invitation operation namespace occupied; do not replace blindly'; END IF;
END $$;

CREATE FUNCTION app._invitation_operations_guard() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p pg_proc; owner_oid oid; BEGIN
 IF current_database() NOT LIKE 'foundation_test_%' OR NOT pg_has_role(session_user,'nextera_invitation_runtime','MEMBER')
 OR pg_has_role(session_user,'nextera_invitation_owner','MEMBER')
 OR EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
 THEN RAISE EXCEPTION 'Invitation runtime unavailable' USING ERRCODE='IV005'; END IF;
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('app.invitation_admission_current(uuid,text,text,uuid)');
 SELECT oid INTO owner_oid FROM pg_roles WHERE rolname='nextera_invitation_owner';
 IF EXISTS(SELECT FROM pg_roles WHERE rolname IN ('nextera_invitation_owner','nextera_invitation_runtime')
 AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles pr ON pr.oid=m.member WHERE pr.rolname IN ('nextera_invitation_owner','nextera_invitation_runtime'))
 THEN RAISE EXCEPTION 'Invitation permission roles changed' USING ERRCODE='IV005'; END IF;
 IF p.oid IS NULL OR p.proowner<>owner_oid OR NOT p.prosecdef OR p.prorettype<>'boolean'::regtype OR p.provolatile<>'v'
 OR p.proretset OR p.prokind<>'f' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
 OR EXISTS(SELECT FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)
 OR obj_description(p.oid,'pg_proc') IS DISTINCT FROM 'nextera-invitation-admission-v1'
 OR NOT EXISTS(SELECT FROM pg_class WHERE oid='app.invitation_activations'::regclass AND relrowsecurity AND relforcerowsecurity)
 OR NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='app.invitation_activations'::regclass AND tgname='invitation_activation_scope_guard' AND tgenabled='O' AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'Invitation authority unavailable' USING ERRCODE='IV005'; END IF;
END $$;
CREATE FUNCTION app.invitation_operations_ready() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM app._invitation_operations_guard(); RETURN true; EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION app.invitation_find(digest text) RETURNS SETOF app.invitation_activations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app._invitation_operations_guard();
 IF digest !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid capability digest' USING ERRCODE='IV005'; END IF;
 RETURN QUERY SELECT i.* FROM app.invitation_activations i WHERE i.token_digest=digest;
END $$;
CREATE FUNCTION app.invitation_claim(digest text,request uuid,lease_ms integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i app.invitation_activations; instant timestamptz; BEGIN
 PERFORM app._invitation_operations_guard();
 IF digest !~ '^[0-9a-f]{64}$' OR request IS NULL OR lease_ms IS NULL OR lease_ms<=0 THEN RAISE EXCEPTION 'Invalid claim' USING ERRCODE='IV005'; END IF;
 SELECT * INTO i FROM app.invitation_activations r WHERE r.token_digest=digest FOR UPDATE;
 instant:=clock_timestamp();
 IF NOT FOUND OR i.revoked_at IS NOT NULL OR i.expires_at<=instant THEN RETURN jsonb_build_object('claim_state','missing'); END IF;
 IF i.phase IN ('complete','existing') OR (i.request_id IS NOT NULL AND i.request_id<>request) THEN RETURN jsonb_build_object('claim_state','conflict'); END IF;
 IF i.lease_until>instant THEN RETURN jsonb_build_object('claim_state','busy'); END IF;
 IF app.invitation_admission_current(i.accepted_admission_id,i.email,i.display_name,i.cohort_id) IS NOT TRUE THEN RETURN jsonb_build_object('claim_state','missing'); END IF;
 UPDATE app.invitation_activations r SET request_id=COALESCE(r.request_id,request),fence=r.fence+1,lease_until=clock_timestamp()+lease_ms*interval '1 millisecond' WHERE r.id=i.id AND r.revoked_at IS NULL AND r.expires_at>clock_timestamp() RETURNING r.* INTO i;
 IF NOT FOUND THEN RETURN jsonb_build_object('claim_state','missing'); END IF;
 RETURN jsonb_build_object('claim_state','acquired','record',to_jsonb(i),'fence',i.fence::text);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('claim_state','conflict');
END $$;
CREATE FUNCTION app.invitation_advance(invitation uuid,generation bigint,expected text,next_phase text,auth_id uuid) RETURNS SETOF app.invitation_activations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i app.invitation_activations; BEGIN
 PERFORM app._invitation_operations_guard();
 IF invitation IS NULL OR generation IS NULL OR generation<=0 OR expected IS NULL OR next_phase IS NULL OR NOT (
  (expected='issued' AND next_phase='auth_pending' AND auth_id IS NULL) OR
  (expected='auth_pending' AND next_phase='auth_ready' AND auth_id IS NOT NULL) OR
  (expected='auth_pending' AND next_phase='existing' AND auth_id IS NULL) OR
  (expected='auth_ready' AND next_phase='enrollment_pending' AND auth_id IS NULL))
 THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='IV005'; END IF;
 SELECT * INTO i FROM app.invitation_activations r WHERE r.id=invitation FOR UPDATE;
 IF NOT FOUND OR i.fence<>generation OR i.phase<>expected OR i.request_id IS NULL OR i.revoked_at IS NOT NULL
 OR i.expires_at<=clock_timestamp() OR i.lease_until IS NULL OR i.lease_until<=clock_timestamp()
 THEN RETURN; END IF;
 IF app.invitation_admission_current(i.accepted_admission_id,i.email,i.display_name,i.cohort_id) IS NOT TRUE THEN RETURN; END IF;
 RETURN QUERY UPDATE app.invitation_activations r SET phase=next_phase,auth_user_id=COALESCE(auth_id,r.auth_user_id) WHERE r.id=i.id AND r.revoked_at IS NULL AND r.expires_at>clock_timestamp() AND r.lease_until>clock_timestamp() RETURNING r.*;
END $$;
CREATE FUNCTION app.invitation_complete(invitation uuid,generation bigint,admission uuid,invited_email text,accepted_name text,cohort uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i app.invitation_activations; domain_user uuid; version uuid; BEGIN
 PERFORM app._invitation_operations_guard();
 SELECT * INTO i FROM app.invitation_activations r WHERE r.id=invitation FOR UPDATE;
 IF NOT FOUND OR generation IS NULL OR generation<=0 OR i.fence<>generation OR i.phase<>'enrollment_pending' OR i.request_id IS NULL OR i.auth_user_id IS NULL
 OR i.revoked_at IS NOT NULL OR i.expires_at<=clock_timestamp() OR i.lease_until IS NULL OR i.lease_until<=clock_timestamp()
 OR (i.accepted_admission_id,i.email,i.display_name,i.cohort_id) IS DISTINCT FROM (admission,invited_email,accepted_name,cohort)
 THEN RETURN false; END IF;
 -- The reviewed hook MUST lock authoritative acceptance/current access rows until transaction end.
 IF app.invitation_admission_current(admission,invited_email,accepted_name,cohort) IS NOT TRUE THEN RETURN false; END IF;
 SELECT u.id INTO domain_user FROM app.users u WHERE u.auth_user_id=i.auth_user_id AND u.active AND u.role='learner' AND u.display_name=i.display_name FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT c.curriculum_version_id INTO version FROM app.cohorts c JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id
 WHERE c.id=cohort AND c.status='active' AND v.status='published' FOR SHARE OF c;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM app.cohort_memberships m WHERE m.cohort_id=cohort AND m.user_id=domain_user AND m.status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Completion verifies existing exact enrollment; this function does not award, enroll or fill missing progress.
 IF NOT EXISTS(SELECT FROM app.curriculum_nodes n WHERE n.curriculum_version_id=version)
 OR EXISTS(SELECT FROM app.curriculum_nodes n WHERE n.curriculum_version_id=version AND NOT EXISTS(
  SELECT FROM app.learner_node_progress p WHERE p.cohort_id=cohort AND p.user_id=domain_user AND p.curriculum_version_id=version AND p.node_key=n.node_key))
 OR EXISTS(SELECT FROM app.learner_node_progress p WHERE p.cohort_id=cohort AND p.user_id=domain_user AND p.curriculum_version_id<>version)
 THEN RETURN false; END IF;
 UPDATE app.invitation_activations r SET phase='complete',completed_at=clock_timestamp(),lease_until=NULL WHERE r.id=i.id AND r.revoked_at IS NULL AND r.expires_at>clock_timestamp() AND r.lease_until>clock_timestamp();
 RETURN FOUND;
END $$;
CREATE FUNCTION app.invitation_release(invitation uuid,generation bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app._invitation_operations_guard();
 UPDATE app.invitation_activations r SET lease_until=NULL WHERE r.id=invitation AND r.fence=generation;
 RETURN FOUND;
END $$;

GRANT USAGE ON SCHEMA app TO nextera_invitation_owner,nextera_invitation_runtime;
GRANT SELECT,UPDATE ON app.invitation_activations TO nextera_invitation_owner;
GRANT SELECT(id,auth_user_id,display_name,role,active) ON app.users TO nextera_invitation_owner;
GRANT SELECT(id,curriculum_version_id,status) ON app.cohorts TO nextera_invitation_owner;
GRANT SELECT(id,status) ON app.curriculum_versions TO nextera_invitation_owner;
GRANT SELECT(cohort_id,user_id,status) ON app.cohort_memberships TO nextera_invitation_owner;
GRANT SELECT(curriculum_version_id,node_key) ON app.curriculum_nodes TO nextera_invitation_owner;
GRANT SELECT(cohort_id,user_id,curriculum_version_id,node_key) ON app.learner_node_progress TO nextera_invitation_owner;
-- PostgreSQL row locks require UPDATE permission on at least one column.
-- Private NOLOGIN owner only; runtime gets no table grants. No role/active/progress writes granted.
GRANT UPDATE(id) ON app.users,app.cohorts TO nextera_invitation_owner;
GRANT UPDATE(cohort_id) ON app.cohort_memberships TO nextera_invitation_owner;
CREATE POLICY invitation_private_owner ON app.invitation_activations FOR ALL TO nextera_invitation_owner USING(current_user='nextera_invitation_owner') WITH CHECK(current_user='nextera_invitation_owner');
REVOKE ALL ON FUNCTION app._invitation_operations_guard(),app.invitation_operations_ready(),app.invitation_find(text),app.invitation_claim(text,uuid,integer),app.invitation_advance(uuid,bigint,text,text,uuid),app.invitation_complete(uuid,bigint,uuid,text,text,uuid),app.invitation_release(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_operations_ready(),app.invitation_find(text),app.invitation_claim(text,uuid,integer),app.invitation_advance(uuid,bigint,text,text,uuid),app.invitation_complete(uuid,bigint,uuid,text,text,uuid),app.invitation_release(uuid,bigint) TO nextera_invitation_runtime;
-- No grants to nextera_web, anon, authenticated or service_role; no issuance or accepted-record stub.
-- All ACL/RLS setup above precedes SET-only ownership handoff. Temporary schema CREATE is restored.
DO $$ BEGIN IF has_schema_privilege('nextera_invitation_owner','app','CREATE') THEN RAISE EXCEPTION 'Unexpected prior owner CREATE'; END IF; END $$;
GRANT CREATE ON SCHEMA app TO nextera_invitation_owner;
ALTER FUNCTION app._invitation_operations_guard() OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_operations_ready() OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_find(text) OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_claim(text,uuid,integer) OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_advance(uuid,bigint,text,text,uuid) OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_complete(uuid,bigint,uuid,text,text,uuid) OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_release(uuid,bigint) OWNER TO nextera_invitation_owner;
REVOKE CREATE ON SCHEMA app FROM nextera_invitation_owner;
DO $$ BEGIN IF has_schema_privilege('nextera_invitation_owner','app','CREATE') THEN RAISE EXCEPTION 'Unexpected retained owner CREATE'; END IF; END $$;
COMMIT;
