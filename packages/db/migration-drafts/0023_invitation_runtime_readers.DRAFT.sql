-- SOURCE REVIEW DRAFT ONLY. Unregistered, unapplied; no native proof or runtime enablement.
-- Requires reviewed0013/0020/0016/0018, their isolated owner, and an approved SET-capable DBA.
-- No roles, credentials, accounts, invitations, capability material, policy rows or numerical defaults.
-- public_policy_sha256 is the independently anchored exact protected server-configuration.json SHA.
-- The native boundary supplies a fresh CSPRNG operation UUID per incoming HTTP request,
-- never a browser requestId; internal same-operation reconciliation cannot debit twice.
-- An allowed limiter receipt is NOT invitation issuance authorization.
-- Security ceilings below bound this ephemeral rehearsal to one hour; they seed no policy.
-- The public configuration hash does not include lease timestamps. Before web activation,
-- the broker must read back the exact starts_at/immutable cleanupAt and role VALID UNTIL
-- against the independently anchored lease. This source draft/HTTP core is not that proof.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ DECLARE r text; BEGIN
 IF current_database() NOT LIKE 'foundation_test_%' OR current_user<>session_user
 OR current_setting('role')<>'none' OR NOT pg_has_role(current_user,'nextera_invitation_owner','SET')
 OR has_schema_privilege('nextera_invitation_owner','app','CREATE')
 OR to_regclass('app.invitation_issuance_policy') IS NULL OR to_regclass('app.invitation_rate_profiles') IS NULL
 OR to_regprocedure('app._invitation_admission_guard()') IS NULL OR to_regprocedure('app._invitation_issuer_guard()') IS NULL THEN
 RAISE EXCEPTION 'Reviewed isolated owner/DBA migration context and prior drafts required'; END IF;
 FOREACH r IN ARRAY ARRAY['nextera_invitation_owner','nextera_invitation_issuer','nextera_invitation_runtime','nextera_web'] LOOP
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member WHERE member_role.rolname=r) THEN
 RAISE EXCEPTION 'Reviewed isolated NOLOGIN permission roles required'; END IF;
 END LOOP;
 IF to_regclass('app.invitation_runtime_profiles') IS NOT NULL OR to_regclass('app.invitation_runtime_rate_bindings') IS NOT NULL
 OR to_regclass('app.invitation_runtime_limit_counters') IS NOT NULL OR to_regclass('app.invitation_runtime_limit_receipts') IS NOT NULL
 OR EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN
 ('_invitation_runtime_binding','invitation_runtime_policy_rows','invitation_runtime_authority_rows','invitation_runtime_limit_consume','guard_invitation_runtime_policy','guard_invitation_runtime_rate_binding','guard_invitation_runtime_limit_receipt')) THEN
 RAISE EXCEPTION 'Runtime reader namespace occupied; do not overwrite'; END IF;
END $$;

CREATE TABLE app.invitation_runtime_profiles (
 profile text PRIMARY KEY CHECK(profile ~ '^[a-z][a-z0-9-]{0,99}$'),
 database_name name NOT NULL,
 public_policy_sha256 text NOT NULL CHECK(public_policy_sha256 ~ '^[0-9a-f]{64}$'),
 issuer_id uuid NOT NULL REFERENCES app.users(id), issuer_auth_user_id uuid NOT NULL,
 cohort_id uuid NOT NULL, curriculum_version_id uuid NOT NULL,
 issuer_login name NOT NULL UNIQUE, activation_login name NOT NULL UNIQUE, web_login name NOT NULL UNIQUE,
 max_lifetime_ms bigint NOT NULL CHECK(max_lifetime_ms>0 AND max_lifetime_ms<=3600000),
 starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at>starts_at AND expires_at<=starts_at+interval '1 hour'),
 CHECK(isfinite(starts_at) AND isfinite(expires_at)),
 max_limiter_receipts integer NOT NULL CHECK(max_limiter_receipts>0),
 enabled boolean NOT NULL, sealed_at timestamptz,
 CHECK(NOT enabled OR sealed_at IS NOT NULL),
 CHECK(issuer_login<>activation_login AND issuer_login<>web_login AND activation_login<>web_login),
 FOREIGN KEY(cohort_id,curriculum_version_id) REFERENCES app.cohorts(id,curriculum_version_id),
 FOREIGN KEY(issuer_id,cohort_id) REFERENCES app.invitation_issuance_policy(issuer_id,cohort_id)
);
CREATE TABLE app.invitation_runtime_rate_bindings (
 runtime_profile text NOT NULL REFERENCES app.invitation_runtime_profiles(profile),
 action text NOT NULL CHECK(action IN ('ingress','inspect','activate','issuer','issue_ingress')),
 rate_profile_id text NOT NULL CHECK(rate_profile_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
 window_ms integer NOT NULL CHECK(window_ms>0), max_requests integer NOT NULL CHECK(max_requests>0),
 retention_ms bigint NOT NULL CHECK(retention_ms BETWEEN window_ms AND 2147483647),
 PRIMARY KEY(runtime_profile,action), UNIQUE(runtime_profile,rate_profile_id)
);
CREATE TABLE app.invitation_runtime_limit_counters (
 runtime_profile text NOT NULL, action text NOT NULL, window_number bigint NOT NULL,
 requests integer NOT NULL CHECK(requests>0), expires_at timestamptz NOT NULL,
 PRIMARY KEY(runtime_profile,action,window_number),
 FOREIGN KEY(runtime_profile,action) REFERENCES app.invitation_runtime_rate_bindings(runtime_profile,action),
 CHECK(action IN ('issuer','issue_ingress'))
);
CREATE TABLE app.invitation_runtime_limit_receipts (
 action text NOT NULL CHECK(action IN ('issuer','issue_ingress')), operation_id uuid NOT NULL,
 runtime_profile text NOT NULL, public_policy_sha256 text NOT NULL,
 issuer_id uuid NOT NULL, cohort_id uuid NOT NULL, curriculum_version_id uuid NOT NULL, caller_login name NOT NULL,
 rate_profile_id text NOT NULL, window_ms integer NOT NULL, max_requests integer NOT NULL, retention_ms bigint NOT NULL,
 window_number bigint NOT NULL, allowed boolean NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(action,operation_id),
 FOREIGN KEY(runtime_profile,action) REFERENCES app.invitation_runtime_rate_bindings(runtime_profile,action)
);
CREATE FUNCTION app.guard_invitation_runtime_policy() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.sealed_at IS NOT NULL THEN RAISE EXCEPTION 'Sealed runtime profile is retained'; END IF; RETURN OLD; END IF;
 IF OLD.sealed_at IS NOT NULL AND (to_jsonb(NEW)-'enabled') IS DISTINCT FROM (to_jsonb(OLD)-'enabled') THEN
 RAISE EXCEPTION 'Sealed runtime profile identity is immutable'; END IF;
 IF NEW.enabled AND (SELECT count(*) FROM app.invitation_runtime_rate_bindings WHERE runtime_profile=NEW.profile)<>5 THEN
 RAISE EXCEPTION 'All five explicit runtime rate bindings required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invitation_runtime_profile_immutable BEFORE UPDATE OR DELETE ON app.invitation_runtime_profiles FOR EACH ROW EXECUTE FUNCTION app.guard_invitation_runtime_policy();
CREATE FUNCTION app.guard_invitation_runtime_rate_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE parent text; sealed timestamptz; BEGIN
 parent:=CASE WHEN TG_OP='INSERT' THEN NEW.runtime_profile ELSE OLD.runtime_profile END;
 SELECT sealed_at INTO sealed FROM app.invitation_runtime_profiles WHERE profile=parent FOR SHARE;
 IF sealed IS NOT NULL THEN RAISE EXCEPTION 'Sealed runtime rate binding is immutable'; END IF;
 IF TG_OP='UPDATE' AND NEW.runtime_profile IS DISTINCT FROM OLD.runtime_profile THEN
 RAISE EXCEPTION 'Runtime rate binding cannot move profiles'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER invitation_runtime_rate_binding_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.invitation_runtime_rate_bindings FOR EACH ROW EXECUTE FUNCTION app.guard_invitation_runtime_rate_binding();
CREATE FUNCTION app.guard_invitation_runtime_limit_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Runtime limiter receipts are immutable'; END $$;
CREATE TRIGGER invitation_runtime_limit_receipt_immutable BEFORE UPDATE OR DELETE ON app.invitation_runtime_limit_receipts FOR EACH ROW EXECUTE FUNCTION app.guard_invitation_runtime_limit_receipt();

CREATE FUNCTION app._invitation_runtime_binding(selected_profile text,expected_hash text,issuer uuid,cohort uuid,version uuid,requested_role text)
RETURNS app.invitation_runtime_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.invitation_runtime_profiles; required_login name; permission_role text; role_row record; expected_role text; table_name text; matched_rates integer; BEGIN
 IF current_user<>'nextera_invitation_owner' OR current_database() NOT LIKE 'foundation_test_%'
 OR current_setting('role')<>'none' OR requested_role IS NULL OR requested_role NOT IN ('issuer','activation')
 OR selected_profile IS NULL OR expected_hash IS NULL OR expected_hash !~ '^[0-9a-f]{64}$'
 OR issuer IS NULL OR cohort IS NULL OR version IS NULL THEN RAISE EXCEPTION 'Runtime binding unavailable' USING ERRCODE='IR005'; END IF;
 SELECT * INTO p FROM app.invitation_runtime_profiles r WHERE r.profile=selected_profile AND r.enabled AND r.sealed_at IS NOT NULL FOR SHARE;
 IF NOT FOUND OR p.database_name<>current_database() OR p.public_policy_sha256 IS DISTINCT FROM expected_hash
 OR (p.issuer_id,p.cohort_id,p.curriculum_version_id) IS DISTINCT FROM (issuer,cohort,version)
 OR clock_timestamp()<p.starts_at OR clock_timestamp()>=p.expires_at THEN
 RAISE EXCEPTION 'Runtime profile unavailable' USING ERRCODE='IR005'; END IF;
 required_login:=CASE WHEN requested_role='issuer' THEN p.issuer_login ELSE p.activation_login END;
 permission_role:=CASE WHEN requested_role='issuer' THEN 'nextera_invitation_issuer' ELSE 'nextera_invitation_runtime' END;
 -- SECURITY DEFINER changes current_user to owner. An exact session login plus role=none
 -- proves the pre-entry current_user; SET ROLE and pooled impersonation are forbidden.
 IF session_user<>required_login OR NOT pg_has_role(session_user,permission_role,'USAGE')
 OR pg_has_role(session_user,'nextera_invitation_owner','MEMBER') THEN
 RAISE EXCEPTION 'Scoped runtime login unavailable' USING ERRCODE='IR005'; END IF;
 FOR role_row IN SELECT v.login,v.permission FROM (VALUES
 (p.issuer_login,'nextera_invitation_issuer'),(p.activation_login,'nextera_invitation_runtime'),(p.web_login,'nextera_web')) v(login,permission) LOOP
 IF NOT EXISTS(SELECT FROM pg_roles r WHERE r.rolname=role_row.login AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication)
 OR (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=role_row.login)<>1
 OR NOT EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member JOIN pg_roles granted_role ON granted_role.oid=m.roleid
 WHERE member_role.rolname=role_row.login AND granted_role.rolname=role_row.permission AND NOT m.admin_option)
 OR pg_has_role(role_row.login,'nextera_invitation_owner','MEMBER') THEN
 RAISE EXCEPTION 'Exact registered scoped login privileges required' USING ERRCODE='IR005'; END IF;
 END LOOP;
 FOREACH expected_role IN ARRAY ARRAY['nextera_invitation_owner','nextera_invitation_issuer','nextera_invitation_runtime','nextera_web'] LOOP
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=expected_role AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=expected_role) THEN
 RAISE EXCEPTION 'Runtime owner/permission roles changed' USING ERRCODE='IR005'; END IF;
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['invitation_runtime_profiles','invitation_runtime_rate_bindings','invitation_runtime_limit_counters','invitation_runtime_limit_receipts','invitation_issuance_policy','invitation_rate_profiles'] LOOP
 IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles o ON o.oid=c.relowner WHERE n.nspname='app' AND c.relname=table_name
 AND c.relrowsecurity AND c.relforcerowsecurity AND o.rolname='nextera_invitation_owner')
 OR has_table_privilege(session_user,'app.'||table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 OR has_any_column_privilege(session_user,'app.'||table_name,'SELECT,INSERT,UPDATE,REFERENCES') THEN
 RAISE EXCEPTION 'Runtime storage isolation unavailable' USING ERRCODE='IR005'; END IF;
 END LOOP;
 -- Existing authority remains current and locked. No email, token, digest or acceptance is read.
 PERFORM 1 FROM app.cohorts c JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id
 WHERE c.id=cohort AND c.curriculum_version_id=version AND c.status='active' AND v.status='published' FOR SHARE OF c;
 IF NOT FOUND THEN RAISE EXCEPTION 'Runtime cohort unavailable' USING ERRCODE='IR005'; END IF;
 PERFORM 1 FROM app.users u WHERE u.id=issuer AND u.auth_user_id=p.issuer_auth_user_id AND u.active AND u.role='admin' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Runtime issuer unavailable' USING ERRCODE='IR005'; END IF;
 PERFORM 1 FROM app.invitation_issuance_policy s WHERE s.issuer_id=issuer AND s.cohort_id=cohort AND s.curriculum_version_id=version
 AND s.issuer_login=p.issuer_login AND s.max_lifetime_ms=p.max_lifetime_ms AND s.enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Runtime issuance authority unavailable' USING ERRCODE='IR005'; END IF;
 IF (SELECT count(*) FROM app.invitation_runtime_rate_bindings WHERE runtime_profile=p.profile)<>5 THEN
 RAISE EXCEPTION 'All explicit runtime rate bindings required' USING ERRCODE='IR005'; END IF;
 PERFORM 1 FROM app.invitation_runtime_rate_bindings b JOIN app.invitation_rate_profiles r
 ON r.id=b.rate_profile_id AND r.action=b.action AND r.window_ms=b.window_ms AND r.max_requests=b.max_requests AND r.retention_ms=b.retention_ms AND r.enabled
 WHERE b.runtime_profile=p.profile AND b.action IN ('ingress','inspect','activate') FOR SHARE OF r;
 GET DIAGNOSTICS matched_rates=ROW_COUNT;
 IF matched_rates<>3 THEN RAISE EXCEPTION 'Runtime explicit rate policy unavailable' USING ERRCODE='IR005'; END IF;
 RETURN p;
END $$;

CREATE FUNCTION app.invitation_runtime_policy_rows(profile text,public_policy_sha256 text,issuer uuid,cohort uuid,version uuid)
RETURNS TABLE(id text,action text,window_ms integer,max_requests integer,retention_ms text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.invitation_runtime_profiles; BEGIN
 p:=app._invitation_runtime_binding(profile,public_policy_sha256,issuer,cohort,version,'activation');
 RETURN QUERY SELECT r.id,r.action,r.window_ms,r.max_requests,r.retention_ms::text
 FROM app.invitation_rate_profiles r JOIN app.invitation_runtime_rate_bindings b
 ON r.id=b.rate_profile_id AND r.action=b.action AND r.window_ms=b.window_ms AND r.max_requests=b.max_requests AND r.retention_ms=b.retention_ms
 WHERE b.runtime_profile=p.profile AND b.action IN ('ingress','inspect','activate') AND r.enabled ORDER BY r.id;
END $$;
CREATE FUNCTION app.invitation_runtime_authority_rows(profile text,public_policy_sha256 text,issuer uuid,cohort uuid,version uuid)
RETURNS TABLE(issuer_id uuid,cohort_id uuid,curriculum_version_id uuid,issuer_login text,max_lifetime_ms text,enabled boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.invitation_runtime_profiles; BEGIN
 p:=app._invitation_runtime_binding(profile,public_policy_sha256,issuer,cohort,version,'issuer');
 RETURN QUERY SELECT s.issuer_id,s.cohort_id,s.curriculum_version_id,s.issuer_login::text,s.max_lifetime_ms::text,s.enabled
 FROM app.invitation_issuance_policy s WHERE s.issuer_id=p.issuer_id AND s.cohort_id=p.cohort_id
 AND s.curriculum_version_id=p.curriculum_version_id AND s.issuer_login=p.issuer_login AND s.max_lifetime_ms=p.max_lifetime_ms AND s.enabled;
END $$;
CREATE FUNCTION app.invitation_runtime_limit_consume(profile text,public_policy_sha256 text,issuer uuid,cohort uuid,version uuid,operation uuid,requested_action text,rate_profile text,requested_window_ms integer,requested_max integer,requested_retention_ms bigint)
RETURNS TABLE(profile_id text,action text,operation_id uuid,allowed boolean,replayed boolean,window_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.invitation_runtime_profiles; rate app.invitation_runtime_rate_bindings; old app.invitation_runtime_limit_receipts;
 instant timestamptz; w bigint; expiry timestamptz; total integer; permitted boolean; BEGIN
 p:=app._invitation_runtime_binding(profile,public_policy_sha256,issuer,cohort,version,'issuer');
 IF operation IS NULL OR requested_action IS NULL OR requested_action NOT IN ('issuer','issue_ingress') THEN
 RAISE EXCEPTION 'Runtime limiter scope unavailable' USING ERRCODE='IR005'; END IF;
 SELECT * INTO rate FROM app.invitation_runtime_rate_bindings b WHERE b.runtime_profile=p.profile AND b.action=requested_action
 AND b.rate_profile_id=rate_profile AND b.window_ms=requested_window_ms AND b.max_requests=requested_max AND b.retention_ms=requested_retention_ms FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Exact runtime rate policy required' USING ERRCODE='IR005'; END IF;
 -- Serializes bounded storage and same-nonce reconciliation across instances and both actions.
 PERFORM pg_advisory_xact_lock(hashtextextended(p.profile,23));
 PERFORM pg_advisory_xact_lock(hashtextextended(requested_action||operation::text,24));
 -- Recheck lifecycle after lock waits; no replay renews an expired profile/window/receipt.
 IF clock_timestamp()>=p.expires_at THEN RAISE EXCEPTION 'Runtime limiter expired' USING ERRCODE='IR005'; END IF;
 instant:=clock_timestamp(); w:=floor(extract(epoch FROM instant)*1000/rate.window_ms)::bigint;
 expiry:=least(p.expires_at,to_timestamp((w::numeric*rate.window_ms+rate.retention_ms)/1000));
 SELECT * INTO old FROM app.invitation_runtime_limit_receipts r WHERE r.action=requested_action AND r.operation_id=operation;
 IF FOUND THEN
 IF (old.runtime_profile,old.public_policy_sha256,old.issuer_id,old.cohort_id,old.curriculum_version_id,old.caller_login,old.rate_profile_id,old.window_ms,old.max_requests,old.retention_ms)
 IS DISTINCT FROM (p.profile,public_policy_sha256,issuer,cohort,version,session_user::name,rate_profile,requested_window_ms,requested_max,requested_retention_ms) THEN
 RAISE EXCEPTION 'Runtime limiter request binding conflict' USING ERRCODE='IR005'; END IF;
 RETURN QUERY SELECT rate.rate_profile_id,requested_action,operation,
 old.allowed AND old.window_number=w AND old.expires_at>instant,true,old.window_number::text; RETURN;
 END IF;
 IF (SELECT count(*) FROM app.invitation_runtime_limit_receipts r WHERE r.runtime_profile=p.profile)>=p.max_limiter_receipts THEN
 RETURN QUERY SELECT rate.rate_profile_id,requested_action,operation,false,false,w::text; RETURN; END IF;
 INSERT INTO app.invitation_runtime_limit_counters(runtime_profile,action,window_number,requests,expires_at)
 VALUES(p.profile,requested_action,w,1,expiry)
 ON CONFLICT ON CONSTRAINT invitation_runtime_limit_counters_pkey DO UPDATE SET requests=app.invitation_runtime_limit_counters.requests+1
 WHERE app.invitation_runtime_limit_counters.requests<rate.max_requests RETURNING requests INTO total;
 permitted:=FOUND;
 INSERT INTO app.invitation_runtime_limit_receipts(action,operation_id,runtime_profile,public_policy_sha256,issuer_id,cohort_id,curriculum_version_id,caller_login,rate_profile_id,window_ms,max_requests,retention_ms,window_number,allowed,created_at,expires_at)
 VALUES(requested_action,operation,p.profile,public_policy_sha256,issuer,cohort,version,session_user,rate_profile,rate.window_ms,rate.max_requests,rate.retention_ms,w,permitted,instant,expiry);
 IF clock_timestamp()>=p.expires_at THEN RAISE EXCEPTION 'Runtime limiter expired before commit' USING ERRCODE='IR005'; END IF;
 RETURN QUERY SELECT rate.rate_profile_id,requested_action,operation,permitted,false,w::text;
END $$;

-- Private owner policies are installed before SET-only ownership transfer. No runtime table grants.
ALTER TABLE app.invitation_runtime_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_runtime_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_runtime_rate_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_runtime_rate_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_runtime_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_runtime_limit_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_runtime_limit_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_runtime_limit_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_runtime_profile_owner ON app.invitation_runtime_profiles TO nextera_invitation_owner USING(current_user='nextera_invitation_owner') WITH CHECK(current_user='nextera_invitation_owner');
CREATE POLICY invitation_runtime_rate_owner ON app.invitation_runtime_rate_bindings TO nextera_invitation_owner USING(current_user='nextera_invitation_owner') WITH CHECK(current_user='nextera_invitation_owner');
CREATE POLICY invitation_runtime_counter_owner ON app.invitation_runtime_limit_counters TO nextera_invitation_owner USING(current_user='nextera_invitation_owner') WITH CHECK(current_user='nextera_invitation_owner');
CREATE POLICY invitation_runtime_receipt_owner ON app.invitation_runtime_limit_receipts TO nextera_invitation_owner USING(current_user='nextera_invitation_owner') WITH CHECK(current_user='nextera_invitation_owner');
REVOKE ALL ON app.invitation_runtime_profiles,app.invitation_runtime_rate_bindings,app.invitation_runtime_limit_counters,app.invitation_runtime_limit_receipts FROM PUBLIC,nextera_invitation_issuer,nextera_invitation_runtime,nextera_web;
REVOKE ALL ON FUNCTION app.guard_invitation_runtime_policy(),app.guard_invitation_runtime_rate_binding(),app.guard_invitation_runtime_limit_receipt(),app._invitation_runtime_binding(text,text,uuid,uuid,uuid,text),app.invitation_runtime_policy_rows(text,text,uuid,uuid,uuid),app.invitation_runtime_authority_rows(text,text,uuid,uuid,uuid),app.invitation_runtime_limit_consume(text,text,uuid,uuid,uuid,uuid,text,text,integer,integer,bigint) FROM PUBLIC;
-- Strip unexpected default ACLs from only these NEW objects; never widen old object grants.
DO $$ DECLARE obj record; recipient record; BEGIN
 FOR obj IN SELECT c.oid,c.oid::regclass AS name,c.relowner AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname IN ('invitation_runtime_profiles','invitation_runtime_rate_bindings','invitation_runtime_limit_counters','invitation_runtime_limit_receipts') LOOP
 FOR recipient IN SELECT DISTINCT r.rolname FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=obj.oid AND a.grantee<>obj.owner LOOP EXECUTE format('REVOKE ALL ON TABLE %s FROM %I',obj.name,recipient.rolname); END LOOP; END LOOP;
 FOR obj IN SELECT p.oid,p.oid::regprocedure AS name,p.proowner AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('guard_invitation_runtime_policy','guard_invitation_runtime_rate_binding','guard_invitation_runtime_limit_receipt','_invitation_runtime_binding','invitation_runtime_policy_rows','invitation_runtime_authority_rows','invitation_runtime_limit_consume') LOOP
 FOR recipient IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=obj.oid AND a.grantee<>obj.owner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',obj.name,recipient.rolname); END LOOP; END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.invitation_runtime_policy_rows(text,text,uuid,uuid,uuid) TO nextera_invitation_runtime;
GRANT EXECUTE ON FUNCTION app.invitation_runtime_authority_rows(text,text,uuid,uuid,uuid),app.invitation_runtime_limit_consume(text,text,uuid,uuid,uuid,uuid,text,text,integer,integer,bigint) TO nextera_invitation_issuer;
GRANT CREATE ON SCHEMA app TO nextera_invitation_owner;
ALTER TABLE app.invitation_runtime_profiles OWNER TO nextera_invitation_owner;
ALTER TABLE app.invitation_runtime_rate_bindings OWNER TO nextera_invitation_owner;
ALTER TABLE app.invitation_runtime_limit_counters OWNER TO nextera_invitation_owner;
ALTER TABLE app.invitation_runtime_limit_receipts OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.guard_invitation_runtime_policy() OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.guard_invitation_runtime_rate_binding() OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.guard_invitation_runtime_limit_receipt() OWNER TO nextera_invitation_owner;
ALTER FUNCTION app._invitation_runtime_binding(text,text,uuid,uuid,uuid,text) OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_runtime_policy_rows(text,text,uuid,uuid,uuid) OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_runtime_authority_rows(text,text,uuid,uuid,uuid) OWNER TO nextera_invitation_owner;
ALTER FUNCTION app.invitation_runtime_limit_consume(text,text,uuid,uuid,uuid,uuid,text,text,integer,integer,bigint) OWNER TO nextera_invitation_owner;
REVOKE CREATE ON SCHEMA app FROM nextera_invitation_owner;
DO $$ BEGIN IF has_schema_privilege('nextera_invitation_owner','app','CREATE') THEN RAISE EXCEPTION 'Retained owner CREATE'; END IF; END $$;
-- Retention/expiry is bounded metadata, not a purge service. Receipts cannot be rewritten or
-- reused after expiry; an independently approved fresh-target cleanup remains mandatory.
COMMIT;
