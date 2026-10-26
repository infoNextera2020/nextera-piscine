-- REVIEW DRAFT ONLY. Not registered in migrations/meta; never applied by db:migrate.
-- No accounts, roles, tokens, policy values or learner records are provisioned here.
-- Requires an explicitly authorized migration principal and existing Foundation 006 roles.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
 OR EXISTS(SELECT FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner')
 OR NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='nextera_web')
 OR NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','SET') THEN
 RAISE EXCEPTION 'Approved checkpoint owner/migration context required'; END IF;
END $$;

CREATE TABLE app.checkpoint_draft_policies (
 curriculum_version_id uuid NOT NULL,
 node_key text NOT NULL,
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 enabled boolean NOT NULL DEFAULT false,
 max_source_bytes integer,
 max_receipts_per_task integer,
 max_bytes_per_task bigint,
 retention_after_deadline_seconds integer,
 PRIMARY KEY(curriculum_version_id,node_key,definition_digest),
 FOREIGN KEY(curriculum_version_id,node_key) REFERENCES app.checkpoint_definitions(curriculum_version_id,node_key) ON DELETE RESTRICT,
 CHECK(NOT enabled OR (max_source_bytes IS NOT NULL AND max_source_bytes BETWEEN 1 AND 262144
  AND max_receipts_per_task IS NOT NULL AND max_receipts_per_task>0
  AND max_bytes_per_task IS NOT NULL AND max_bytes_per_task>=max_source_bytes
  AND retention_after_deadline_seconds IS NOT NULL AND retention_after_deadline_seconds>=0))
);
CREATE TABLE app.checkpoint_draft_revisions (
 attempt_id uuid NOT NULL,
 cohort_id uuid NOT NULL,
 user_id uuid NOT NULL,
 curriculum_version_id uuid NOT NULL,
 node_key text NOT NULL,
 task_key text NOT NULL CHECK(task_key ~ '^[a-z0-9-]{1,100}$'),
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 request_id uuid NOT NULL,
 base_version bigint NOT NULL CHECK(base_version>=0),
 version bigint NOT NULL CHECK(version=base_version+1 AND version BETWEEN 1 AND 9007199254740991),
 source_bytes bytea NOT NULL CHECK(octet_length(source_bytes)<=262144),
 source_digest text NOT NULL CHECK(source_digest=encode(sha256(source_bytes),'hex')),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at>=created_at),
 PRIMARY KEY(attempt_id,task_key,version),
 UNIQUE(user_id,request_id),
 FOREIGN KEY(attempt_id,cohort_id,user_id,curriculum_version_id,node_key)
  REFERENCES app.checkpoint_attempts(id,cohort_id,user_id,curriculum_version_id,node_key) ON DELETE RESTRICT
);
CREATE INDEX checkpoint_draft_expiry ON app.checkpoint_draft_revisions(expires_at);
ALTER TABLE app.checkpoint_draft_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.checkpoint_draft_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.checkpoint_draft_policies,app.checkpoint_draft_revisions FROM PUBLIC,nextera_web;

CREATE FUNCTION app.checkpoint_draft_record(r app.checkpoint_draft_revisions) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('scope',jsonb_build_object('learnerId',r.user_id,'cohortId',r.cohort_id,'attemptId',r.attempt_id,'taskKey',r.task_key,'definitionDigest',r.definition_digest),
 'sourceBase64',encode(r.source_bytes,'base64'),'sourceDigest',r.source_digest,'byteLength',octet_length(r.source_bytes),
 'version',r.version,'requestId',r.request_id,'expiresAt',r.expires_at)
$$;
CREATE FUNCTION app.guard_checkpoint_draft_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'Draft revisions are immutable';
END $$;
CREATE TRIGGER checkpoint_draft_revision_immutable BEFORE UPDATE ON app.checkpoint_draft_revisions
FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_draft_revision();

CREATE FUNCTION app.guard_checkpoint_draft_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE used boolean; BEGIN
 SELECT EXISTS(SELECT FROM app.checkpoint_draft_revisions WHERE curriculum_version_id=OLD.curriculum_version_id AND node_key=OLD.node_key AND definition_digest=OLD.definition_digest) INTO used;
 IF TG_OP='DELETE' THEN
 IF used THEN RAISE EXCEPTION 'Disable retained draft policy instead of deleting it'; END IF; RETURN OLD;
 END IF;
 IF (OLD.enabled OR used) AND
 (NEW.curriculum_version_id,NEW.node_key,NEW.definition_digest,NEW.max_source_bytes,NEW.max_receipts_per_task,NEW.max_bytes_per_task,NEW.retention_after_deadline_seconds)
 IS DISTINCT FROM (OLD.curriculum_version_id,OLD.node_key,OLD.definition_digest,OLD.max_source_bytes,OLD.max_receipts_per_task,OLD.max_bytes_per_task,OLD.retention_after_deadline_seconds) THEN
 RAISE EXCEPTION 'Used draft policy configuration is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkpoint_draft_policy_immutable BEFORE UPDATE OR DELETE ON app.checkpoint_draft_policies
FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_draft_policy();

CREATE FUNCTION app.checkpoint_draft_context(auth_id uuid,attempt uuid,task text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;p app.checkpoint_draft_policies;u uuid;item jsonb;at_time timestamptz;source_limit integer;until_time timestamptz;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft forbidden' USING ERRCODE='42501'; END IF;
 u:=app.checkpoint_lock_access(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Draft forbidden' USING ERRCODE='42501'; END IF;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;
 IF item IS NULL THEN RAISE EXCEPTION 'Draft forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM app.checkpoint_draft_policies WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=a.definition_digest AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft policy unavailable' USING ERRCODE='PD005'; END IF;
 IF jsonb_array_length(item->'submissionRules'->'required_files')<>1 OR (item->'submissionRules'->'required_files'->>0) IS NULL OR (item->'submissionRules'->'required_files'->>0) !~ '^[A-Za-z0-9_][A-Za-z0-9_]*[.]go$'
 OR (item->'submissionRules'->>'max_size_kb') IS NULL OR (item->'submissionRules'->>'max_size_kb') !~ '^[0-9]+$' THEN
 RAISE EXCEPTION 'Draft source contract unavailable' USING ERRCODE='PD005'; END IF;
 source_limit:=least(p.max_source_bytes,(item->'submissionRules'->>'max_size_kb')::integer*1024,262144);
 IF source_limit IS NULL OR source_limit<1 THEN RAISE EXCEPTION 'Draft source contract unavailable' USING ERRCODE='PD005'; END IF;
 at_time:=clock_timestamp();until_time:=a.deadline_at+make_interval(secs=>p.retention_after_deadline_seconds);
 RETURN jsonb_build_object('scope',jsonb_build_object('learnerId',u,'cohortId',a.cohort_id,'attemptId',a.id,'taskKey',task,'definitionDigest',a.definition_digest),
 'readAllowed',at_time<until_time,'status',CASE WHEN a.status='active' THEN 'active' ELSE 'closed' END,
 'serverNow',at_time,'deadline',a.deadline_at,'sourceBytes',source_limit,'filename',item->'submissionRules'->'required_files'->>0);
END $$;

CREATE FUNCTION app.read_checkpoint_draft(auth_id uuid,attempt uuid,task text,definition text,request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;r app.checkpoint_draft_revisions;u uuid;
BEGIN
 ctx:=app.checkpoint_draft_context(auth_id,attempt,task);u:=(ctx->'scope'->>'learnerId')::uuid;
 IF ctx->'scope'->>'definitionDigest' IS DISTINCT FROM definition THEN RAISE EXCEPTION 'Definition mismatch' USING ERRCODE='PD002'; END IF;
 IF NOT (ctx->>'readAllowed')::boolean THEN RAISE EXCEPTION 'Draft expired' USING ERRCODE='42501'; END IF;
 IF request IS NOT NULL THEN
 SELECT * INTO r FROM app.checkpoint_draft_revisions WHERE user_id=u AND request_id=request;
 IF FOUND AND (r.attempt_id IS DISTINCT FROM attempt OR r.task_key IS DISTINCT FROM task OR r.definition_digest IS DISTINCT FROM definition) THEN
 RAISE EXCEPTION 'Request scope conflict' USING ERRCODE='PD003'; END IF;
 ELSE
 SELECT * INTO r FROM app.checkpoint_draft_revisions WHERE attempt_id=attempt AND task_key=task ORDER BY version DESC LIMIT 1;
 END IF;
 IF r.attempt_id IS NULL OR r.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 RETURN app.checkpoint_draft_record(r);
END $$;

CREATE FUNCTION app.save_checkpoint_draft(auth_id uuid,attempt uuid,task text,definition text,request uuid,base bigint,source bytea,source_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;p app.checkpoint_draft_policies;r app.checkpoint_draft_revisions;old app.checkpoint_draft_revisions;
 u uuid;ctx jsonb;head bigint;used_bytes bigint;used_receipts bigint;at_time timestamptz;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft forbidden' USING ERRCODE='42501'; END IF;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Draft forbidden' USING ERRCODE='42501'; END IF;
 -- Same learner/cohort lock order as start/finish/graded intake. No access-row lock is taken before it.
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||u::text,4));
 u:=app.checkpoint_lock_access(auth_id,a.cohort_id);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 -- A learner's duplicate request IDs also serialize across cohorts.
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||request::text,11));
 ctx:=app.checkpoint_draft_context(auth_id,attempt,task);
 IF definition IS DISTINCT FROM a.definition_digest THEN RAISE EXCEPTION 'Definition mismatch' USING ERRCODE='PD002'; END IF;
 SELECT * INTO p FROM app.checkpoint_draft_policies WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=definition AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft policy unavailable' USING ERRCODE='PD005'; END IF;
 IF request IS NULL OR base IS NULL OR base<0 OR base>=9007199254740991 OR source IS NULL OR source_hash IS NULL
 OR source_hash IS DISTINCT FROM encode(sha256(source),'hex') OR octet_length(source)>(ctx->>'sourceBytes')::integer THEN
 RAISE EXCEPTION 'Invalid draft input' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM app.checkpoint_draft_revisions WHERE user_id=u AND request_id=request;
 IF FOUND THEN
 IF old.attempt_id IS DISTINCT FROM attempt OR old.task_key IS DISTINCT FROM task OR old.definition_digest IS DISTINCT FROM definition
 OR old.base_version IS DISTINCT FROM base OR old.source_digest IS DISTINCT FROM source_hash OR old.source_bytes IS DISTINCT FROM source THEN
 RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='PD003'; END IF;
 IF old.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Draft expired' USING ERRCODE='PD001'; END IF;
 RETURN jsonb_build_object('kind','saved','record',app.checkpoint_draft_record(old));
 END IF;
 at_time:=clock_timestamp();
 IF a.status<>'active' OR at_time>=a.deadline_at THEN RAISE EXCEPTION 'Draft intake closed' USING ERRCODE='PD001'; END IF;
 SELECT * INTO r FROM app.checkpoint_draft_revisions WHERE attempt_id=attempt AND task_key=task ORDER BY version DESC LIMIT 1;
 head:=coalesce(r.version,0);
 IF base<>head THEN
 IF head=0 THEN RAISE EXCEPTION 'Future base version' USING ERRCODE='PD003'; END IF;
 RETURN jsonb_build_object('kind','conflict','current',app.checkpoint_draft_record(r));
 END IF;
 SELECT count(*),coalesce(sum(octet_length(source_bytes)),0) INTO used_receipts,used_bytes FROM app.checkpoint_draft_revisions WHERE attempt_id=attempt AND task_key=task;
 IF used_receipts>=p.max_receipts_per_task OR used_bytes+octet_length(source)>p.max_bytes_per_task THEN
 RAISE EXCEPTION 'Draft storage capacity reached' USING ERRCODE='PD004'; END IF;
 INSERT INTO app.checkpoint_draft_revisions(attempt_id,cohort_id,user_id,curriculum_version_id,node_key,task_key,definition_digest,request_id,base_version,version,source_bytes,source_digest,created_at,expires_at)
 VALUES(a.id,a.cohort_id,u,a.curriculum_version_id,a.node_key,task,definition,request,base,base+1,source,source_hash,at_time,a.deadline_at+make_interval(secs=>p.retention_after_deadline_seconds)) RETURNING * INTO r;
 RETURN jsonb_build_object('kind','saved','record',app.checkpoint_draft_record(r));
END $$;

-- Maintenance draft only. No web/PUBLIC execute grant and no scheduler is installed.
CREATE FUNCTION app.purge_expired_checkpoint_drafts(cutoff timestamptz,batch integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE removed integer; BEGIN
 IF cutoff IS NULL OR batch IS NULL OR batch NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid cleanup batch'; END IF;
 WITH expired AS (SELECT attempt_id,task_key,version FROM app.checkpoint_draft_revisions WHERE expires_at<=least(cutoff,clock_timestamp()) ORDER BY expires_at LIMIT batch FOR UPDATE SKIP LOCKED)
 DELETE FROM app.checkpoint_draft_revisions r USING expired e WHERE (r.attempt_id,r.task_key,r.version)=(e.attempt_id,e.task_key,e.version);
 GET DIAGNOSTICS removed=ROW_COUNT;RETURN removed;
END $$;

-- Owner is an existing isolated NOLOGIN role. No membership or login creation here.
GRANT CREATE ON SCHEMA app TO nextera_checkpoint_owner;
ALTER TABLE app.checkpoint_draft_policies OWNER TO nextera_checkpoint_owner;
ALTER TABLE app.checkpoint_draft_revisions OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_draft_record(app.checkpoint_draft_revisions) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.guard_checkpoint_draft_revision() OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.guard_checkpoint_draft_policy() OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_draft_context(uuid,uuid,text) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.read_checkpoint_draft(uuid,uuid,text,text,uuid) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.save_checkpoint_draft(uuid,uuid,text,text,uuid,bigint,bytea,text) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.purge_expired_checkpoint_drafts(timestamptz,integer) OWNER TO nextera_checkpoint_owner;
REVOKE CREATE ON SCHEMA app FROM nextera_checkpoint_owner;
REVOKE ALL ON FUNCTION app.checkpoint_draft_record(app.checkpoint_draft_revisions),app.guard_checkpoint_draft_revision(),app.guard_checkpoint_draft_policy(),app.checkpoint_draft_context(uuid,uuid,text),app.read_checkpoint_draft(uuid,uuid,text,text,uuid),app.save_checkpoint_draft(uuid,uuid,text,text,uuid,bigint,bytea,text),app.purge_expired_checkpoint_drafts(timestamptz,integer) FROM PUBLIC;
-- Remove unexpected deployment default privileges on these NEW objects only.
DO $$ DECLARE obj record; grantee record; BEGIN
 FOR obj IN SELECT c.oid,c.oid::regclass AS name,c.relowner AS owner FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='app' AND c.relname IN ('checkpoint_draft_policies','checkpoint_draft_revisions') LOOP
 FOR grantee IN SELECT DISTINCT r.rolname FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE c.oid=obj.oid AND a.grantee<>obj.owner LOOP
 EXECUTE format('REVOKE ALL ON TABLE %s FROM %I',obj.name,grantee.rolname); END LOOP; END LOOP;
 FOR obj IN SELECT p.oid,p.oid::regprocedure AS name,p.proowner AS owner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='app' AND p.proname IN ('checkpoint_draft_record','guard_checkpoint_draft_revision','guard_checkpoint_draft_policy','checkpoint_draft_context','read_checkpoint_draft','save_checkpoint_draft','purge_expired_checkpoint_drafts') LOOP
 FOR grantee IN SELECT DISTINCT r.rolname FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=obj.oid AND a.grantee<>obj.owner LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',obj.name,grantee.rolname); END LOOP; END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.checkpoint_draft_context(uuid,uuid,text),app.read_checkpoint_draft(uuid,uuid,text,text,uuid),app.save_checkpoint_draft(uuid,uuid,text,text,uuid,bigint,bytea,text) TO nextera_web;
COMMIT;
