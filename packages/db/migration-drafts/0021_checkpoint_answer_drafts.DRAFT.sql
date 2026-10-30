-- REVIEW DRAFT ONLY. Not registered, applied, provisioned or enabled by this source file.
-- Structured draft storage ONLY. No official acceptance, graded budget, evaluator, Run or awards.
-- Requires a reviewed frozen task answerContract and a separately approved explicit storage policy.
-- Does not extend the registered four-task/90-minute assessment policy or alter DRAFT0011/0014.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF getdatabaseencoding()<>'UTF8' THEN RAISE EXCEPTION 'Structured answers require UTF8'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_web')
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET') THEN
 RAISE EXCEPTION 'Approved isolated checkpoint migration context required'; END IF;
END $$;

CREATE TABLE app.checkpoint_answer_draft_policies (
 curriculum_version_id uuid NOT NULL,
 node_key text NOT NULL,
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 enabled boolean NOT NULL DEFAULT false,
 max_answer_bytes integer,
 max_receipts_per_task integer,
 max_bytes_per_task bigint,
 retention_after_deadline_seconds integer,
 PRIMARY KEY(curriculum_version_id,node_key,definition_digest),
 FOREIGN KEY(curriculum_version_id,node_key) REFERENCES app.checkpoint_definitions(curriculum_version_id,node_key) ON DELETE RESTRICT,
 CHECK(NOT enabled OR (max_answer_bytes BETWEEN 1 AND 262144
  AND max_receipts_per_task>0 AND max_bytes_per_task>=max_answer_bytes
  AND retention_after_deadline_seconds>=0
  AND max_answer_bytes IS NOT NULL AND max_receipts_per_task IS NOT NULL
  AND max_bytes_per_task IS NOT NULL AND retention_after_deadline_seconds IS NOT NULL))
);
CREATE TABLE app.checkpoint_answer_draft_revisions (
 attempt_id uuid NOT NULL, cohort_id uuid NOT NULL, user_id uuid NOT NULL,
 curriculum_version_id uuid NOT NULL, node_key text NOT NULL,
 task_key text NOT NULL CHECK(task_key ~ '^[a-z0-9-]{1,100}$'),
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 answer_contract_digest text NOT NULL CHECK(answer_contract_digest ~ '^[0-9a-f]{64}$'),
 answer_version integer NOT NULL CHECK(answer_version=1),
 answer_kind text NOT NULL CHECK(answer_kind IN ('trace_with_reason','debug_with_reason')),
 request_id uuid NOT NULL,
 base_version bigint NOT NULL CHECK(base_version>=0),
 version bigint NOT NULL CHECK(version=base_version+1 AND version BETWEEN 1 AND 9007199254740991),
 answer_bytes bytea NOT NULL CHECK(octet_length(answer_bytes) BETWEEN 1 AND 262144),
 answer_digest text NOT NULL CHECK(answer_digest=encode(sha256(answer_bytes),'hex')),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at>=created_at),
 PRIMARY KEY(attempt_id,task_key,version), UNIQUE(user_id,request_id),
 FOREIGN KEY(attempt_id,cohort_id,user_id,curriculum_version_id,node_key)
 REFERENCES app.checkpoint_attempts(id,cohort_id,user_id,curriculum_version_id,node_key) ON DELETE RESTRICT
);
CREATE INDEX checkpoint_answer_draft_expiry ON app.checkpoint_answer_draft_revisions(expires_at);
ALTER TABLE app.checkpoint_answer_draft_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.checkpoint_answer_draft_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.checkpoint_answer_draft_policies,app.checkpoint_answer_draft_revisions FROM PUBLIC,nextera_web;

CREATE FUNCTION app.guard_checkpoint_answer_draft_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'Structured draft revisions are immutable';
END $$;
CREATE TRIGGER checkpoint_answer_draft_revision_immutable BEFORE UPDATE ON app.checkpoint_answer_draft_revisions
FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_answer_draft_revision();
CREATE FUNCTION app.guard_checkpoint_answer_draft_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE used boolean; BEGIN
 SELECT EXISTS(SELECT FROM app.checkpoint_answer_draft_revisions WHERE curriculum_version_id=OLD.curriculum_version_id AND node_key=OLD.node_key AND definition_digest=OLD.definition_digest) INTO used;
 IF TG_OP='DELETE' THEN IF used THEN RAISE EXCEPTION 'Retained structured draft policy'; END IF; RETURN OLD; END IF;
 IF (OLD.enabled OR used) AND
 (NEW.curriculum_version_id,NEW.node_key,NEW.definition_digest,NEW.max_answer_bytes,NEW.max_receipts_per_task,NEW.max_bytes_per_task,NEW.retention_after_deadline_seconds)
 IS DISTINCT FROM
 (OLD.curriculum_version_id,OLD.node_key,OLD.definition_digest,OLD.max_answer_bytes,OLD.max_receipts_per_task,OLD.max_bytes_per_task,OLD.retention_after_deadline_seconds) THEN
 RAISE EXCEPTION 'Used structured draft policy is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkpoint_answer_draft_policy_immutable BEFORE UPDATE OR DELETE ON app.checkpoint_answer_draft_policies
FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_answer_draft_policy();

CREATE FUNCTION app.checkpoint_answer_contract_digest(learner uuid,cohort uuid,attempt uuid,task text,definition text,kind text,maximum integer) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(concat_ws(E'\n','01coding-checkpoint-answer-contract-v1',learner::text,cohort::text,attempt::text,task,definition,'1',kind,maximum::text),'UTF8')),'hex')
$$;
CREATE FUNCTION app.checkpoint_answer_draft_context(auth_id uuid,attempt uuid,task text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; p app.checkpoint_answer_draft_policies; u uuid; item jsonb; contract jsonb;
 at_time timestamptz; kind text; maximum integer; contract_hash text;
BEGIN
 IF attempt IS NULL OR task IS NULL OR task !~ '^[a-z0-9-]{1,100}$' THEN RAISE EXCEPTION 'Structured draft forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'Structured draft forbidden' USING ERRCODE='42501'; END IF;
 u:=app.checkpoint_lock_access(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Structured draft forbidden' USING ERRCODE='42501'; END IF;
 -- All authority comes from the immutable attempt; never infer kind from a .go filename or browser body.
 IF a.snapshot->>'attempt_id' IS DISTINCT FROM a.id::text
 OR a.snapshot->>'cohort_id' IS DISTINCT FROM a.cohort_id::text
 OR a.snapshot->>'learner_id' IS DISTINCT FROM a.user_id::text
 OR a.snapshot->>'node_key' IS DISTINCT FROM a.node_key
 OR a.snapshot->>'curriculum_version_id' IS DISTINCT FROM a.curriculum_version_id::text
 OR (a.snapshot->>'deadline_at')::timestamptz IS DISTINCT FROM a.deadline_at
 OR a.snapshot->>'definition_digest' IS DISTINCT FROM a.definition_digest
 OR a.snapshot_digest IS DISTINCT FROM app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt')
 OR jsonb_typeof(a.snapshot->'definition'->'tasks') IS DISTINCT FROM 'array' THEN
 RAISE EXCEPTION 'Frozen structured answer context unavailable' USING ERRCODE='PA005'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task)<>1 THEN
 RAISE EXCEPTION 'Structured draft forbidden' USING ERRCODE='42501'; END IF;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;
 contract:=item->'answerContract';
 IF jsonb_typeof(contract) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Explicit answer contract unavailable' USING ERRCODE='PA005'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(contract))<>3 OR contract->'version' IS DISTINCT FROM '1'::jsonb
 OR jsonb_typeof(contract->'kind') IS DISTINCT FROM 'string'
 OR contract->>'kind' NOT IN ('trace_with_reason','debug_with_reason')
 OR jsonb_typeof(contract->'maxBytes') IS DISTINCT FROM 'number'
 OR (contract->>'maxBytes') IS NULL OR (contract->>'maxBytes') !~ '^[1-9][0-9]*$'
 OR (contract->>'maxBytes')::numeric>262144 THEN RAISE EXCEPTION 'Explicit answer contract unavailable' USING ERRCODE='PA005'; END IF;
 kind:=contract->>'kind'; maximum:=(contract->>'maxBytes')::integer;
 SELECT * INTO p FROM app.checkpoint_answer_draft_policies WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=a.definition_digest AND enabled;
 IF NOT FOUND OR p.max_answer_bytes<maximum THEN RAISE EXCEPTION 'Structured draft policy unavailable' USING ERRCODE='PA005'; END IF;
 contract_hash:=app.checkpoint_answer_contract_digest(u,a.cohort_id,a.id,task,a.definition_digest,kind,maximum);
 at_time:=clock_timestamp();
 RETURN jsonb_build_object('scope',jsonb_build_object('learnerId',u,'cohortId',a.cohort_id,'attemptId',a.id,'taskKey',task,'definitionDigest',a.definition_digest),
 'readAllowed',at_time<a.deadline_at+make_interval(secs=>p.retention_after_deadline_seconds),
 'status',CASE WHEN a.status='active' THEN 'active' ELSE 'closed' END,'serverNow',at_time,'deadline',a.deadline_at,
 'answerContract',jsonb_build_object('version',1,'kind',kind,'maxBytes',maximum,'digest',contract_hash));
END $$;

-- Validate typed canonical JSON, retain the original bytes, never trim or rewrite answer fields.
-- UNRESOLVED: jsonb rejects escaped U+0000. This validator rejects such drafts instead of rewriting bytes.
-- This DRAFT is not complete exact-text persistence support and must not be activated while this remains unresolved.
-- A json-only replacement must prove shape and canonical escape handling without decoding NUL or using a custom parser.
-- PostgreSQL canonical/escape parity requires a later authorized review/rehearsal; no database proof is claimed here.
CREATE FUNCTION app.checkpoint_answer_payload_valid(payload bytea,kind text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE body jsonb; canonical text; BEGIN
 body:=convert_from(payload,'UTF8')::jsonb;
 IF jsonb_typeof(body) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF body->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(body->'kind') IS DISTINCT FROM 'string' OR body->>'kind' IS DISTINCT FROM kind THEN RETURN false; END IF;
 IF kind='trace_with_reason' THEN
 IF (SELECT count(*) FROM jsonb_object_keys(body))<>4 OR jsonb_typeof(body->'output') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 canonical:='{"version":1,"kind":"trace_with_reason","output":'||(body->'output')::text||',"reason":'||(body->'reason')::text||'}';
 ELSIF kind='debug_with_reason' THEN
 IF (SELECT count(*) FROM jsonb_object_keys(body))<>5 OR jsonb_typeof(body->'source') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'explanation') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'counterexample') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 canonical:='{"version":1,"kind":"debug_with_reason","source":'||(body->'source')::text||',"explanation":'||(body->'explanation')::text||',"counterexample":'||(body->'counterexample')::text||'}';
 ELSE RETURN false; END IF;
 RETURN convert_to(canonical,'UTF8')=payload;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION app.checkpoint_answer_draft_record(r app.checkpoint_answer_draft_revisions) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('scope',jsonb_build_object('learnerId',r.user_id,'cohortId',r.cohort_id,'attemptId',r.attempt_id,'taskKey',r.task_key,'definitionDigest',r.definition_digest),
 'answerContractDigest',r.answer_contract_digest,'payloadBase64',encode(r.answer_bytes,'base64'),'sha256',r.answer_digest,'byteLength',octet_length(r.answer_bytes),
 'version',r.version,'requestId',r.request_id,'expiresAt',r.expires_at)
$$;
CREATE FUNCTION app.read_checkpoint_answer_draft(auth_id uuid,attempt uuid,task text,definition text,contract text,request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; r app.checkpoint_answer_draft_revisions; u uuid; BEGIN
 ctx:=app.checkpoint_answer_draft_context(auth_id,attempt,task); u:=(ctx->'scope'->>'learnerId')::uuid;
 IF ctx->'scope'->>'definitionDigest' IS DISTINCT FROM definition OR ctx->'answerContract'->>'digest' IS DISTINCT FROM contract THEN RAISE EXCEPTION 'Structured definition mismatch' USING ERRCODE='PA002'; END IF;
 IF NOT (ctx->>'readAllowed')::boolean THEN RAISE EXCEPTION 'Structured draft expired' USING ERRCODE='42501'; END IF;
 IF request IS NOT NULL THEN
 SELECT * INTO r FROM app.checkpoint_answer_draft_revisions WHERE user_id=u AND request_id=request;
 IF FOUND AND (r.attempt_id IS DISTINCT FROM attempt OR r.task_key IS DISTINCT FROM task OR r.definition_digest IS DISTINCT FROM definition OR r.answer_contract_digest IS DISTINCT FROM contract) THEN RAISE EXCEPTION 'Structured request scope conflict' USING ERRCODE='PA003'; END IF;
 ELSE SELECT * INTO r FROM app.checkpoint_answer_draft_revisions WHERE attempt_id=attempt AND task_key=task ORDER BY version DESC LIMIT 1; END IF;
 IF r.attempt_id IS NULL OR r.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 RETURN app.checkpoint_answer_draft_record(r);
END $$;
CREATE FUNCTION app.save_checkpoint_answer_draft(auth_id uuid,attempt uuid,task text,definition text,contract text,request uuid,base bigint,payload bytea,payload_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; p app.checkpoint_answer_draft_policies; r app.checkpoint_answer_draft_revisions; old app.checkpoint_answer_draft_revisions;
 u uuid; ctx jsonb; head bigint; used_bytes bigint; used_receipts bigint; at_time timestamptz;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'Structured draft forbidden' USING ERRCODE='42501'; END IF;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Structured draft forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||u::text,4));
 u:=app.checkpoint_lock_access(auth_id,a.cohort_id);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||request::text,21));
 ctx:=app.checkpoint_answer_draft_context(auth_id,attempt,task);
 IF definition IS DISTINCT FROM a.definition_digest OR contract IS DISTINCT FROM ctx->'answerContract'->>'digest' THEN RAISE EXCEPTION 'Structured definition mismatch' USING ERRCODE='PA002'; END IF;
 SELECT * INTO p FROM app.checkpoint_answer_draft_policies WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=definition AND enabled FOR SHARE;
 IF NOT FOUND OR p.max_answer_bytes<(ctx->'answerContract'->>'maxBytes')::integer THEN RAISE EXCEPTION 'Structured draft policy unavailable' USING ERRCODE='PA005'; END IF;
 IF request IS NULL OR base IS NULL OR base<0 OR base>=9007199254740991 OR payload IS NULL OR payload_hash IS NULL
 OR octet_length(payload)>(ctx->'answerContract'->>'maxBytes')::integer
 OR payload_hash IS DISTINCT FROM encode(sha256(payload),'hex')
 OR NOT app.checkpoint_answer_payload_valid(payload,ctx->'answerContract'->>'kind') THEN RAISE EXCEPTION 'Invalid structured draft' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM app.checkpoint_answer_draft_revisions WHERE user_id=u AND request_id=request;
 IF FOUND THEN
 IF old.attempt_id IS DISTINCT FROM attempt OR old.task_key IS DISTINCT FROM task OR old.definition_digest IS DISTINCT FROM definition OR old.answer_contract_digest IS DISTINCT FROM contract
 OR old.base_version IS DISTINCT FROM base OR old.answer_digest IS DISTINCT FROM payload_hash OR old.answer_bytes IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Structured idempotency conflict' USING ERRCODE='PA003'; END IF;
 IF old.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Structured draft expired' USING ERRCODE='PA001'; END IF;
 RETURN jsonb_build_object('kind','saved','record',app.checkpoint_answer_draft_record(old));
 END IF;
 at_time:=clock_timestamp();
 IF a.status<>'active' OR at_time>=a.deadline_at THEN RAISE EXCEPTION 'Structured draft closed' USING ERRCODE='PA001'; END IF;
 SELECT * INTO r FROM app.checkpoint_answer_draft_revisions WHERE attempt_id=attempt AND task_key=task ORDER BY version DESC LIMIT 1;
 head:=coalesce(r.version,0);
 IF base<>head THEN
 IF head=0 THEN RAISE EXCEPTION 'Structured future base' USING ERRCODE='PA003'; END IF;
 RETURN jsonb_build_object('kind','conflict','current',app.checkpoint_answer_draft_record(r)); END IF;
 SELECT count(*),coalesce(sum(octet_length(answer_bytes)),0) INTO used_receipts,used_bytes FROM app.checkpoint_answer_draft_revisions WHERE attempt_id=attempt AND task_key=task;
 IF used_receipts>=p.max_receipts_per_task OR used_bytes+octet_length(payload)>p.max_bytes_per_task THEN RAISE EXCEPTION 'Structured draft storage limit' USING ERRCODE='PA004'; END IF;
 INSERT INTO app.checkpoint_answer_draft_revisions(attempt_id,cohort_id,user_id,curriculum_version_id,node_key,task_key,definition_digest,answer_contract_digest,answer_version,answer_kind,request_id,base_version,version,answer_bytes,answer_digest,created_at,expires_at)
 VALUES(a.id,a.cohort_id,u,a.curriculum_version_id,a.node_key,task,definition,contract,1,ctx->'answerContract'->>'kind',request,base,base+1,payload,payload_hash,at_time,a.deadline_at+make_interval(secs=>p.retention_after_deadline_seconds)) RETURNING * INTO r;
 RETURN jsonb_build_object('kind','saved','record',app.checkpoint_answer_draft_record(r));
END $$;

-- This DRAFT proposes no cleanup scheduler or retention defaults. Policies cannot be seeded here.
REVOKE ALL ON FUNCTION app.guard_checkpoint_answer_draft_revision(),app.guard_checkpoint_answer_draft_policy(),
 app.checkpoint_answer_contract_digest(uuid,uuid,uuid,text,text,text,integer),app.checkpoint_answer_draft_context(uuid,uuid,text),
 app.checkpoint_answer_payload_valid(bytea,text),app.checkpoint_answer_draft_record(app.checkpoint_answer_draft_revisions),
 app.read_checkpoint_answer_draft(uuid,uuid,text,text,text,uuid),app.save_checkpoint_answer_draft(uuid,uuid,text,text,text,uuid,bigint,bytea,text) FROM PUBLIC;
-- Remove unexpected default ACLs from these NEW objects before owner transfer.
DO $$ DECLARE obj record; recipient record; BEGIN
 FOR obj IN SELECT c.oid,c.oid::regclass AS name,c.relowner AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='app' AND c.relname IN ('checkpoint_answer_draft_policies','checkpoint_answer_draft_revisions') LOOP
 FOR recipient IN SELECT DISTINCT r.rolname FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=obj.oid AND a.grantee<>obj.owner LOOP
 EXECUTE format('REVOKE ALL ON TABLE %s FROM %I',obj.name,recipient.rolname); END LOOP; END LOOP;
 FOR obj IN SELECT p.oid,p.oid::regprocedure AS name,p.proowner AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.oid IN ('app.guard_checkpoint_answer_draft_revision()'::regprocedure,'app.guard_checkpoint_answer_draft_policy()'::regprocedure,
 'app.checkpoint_answer_contract_digest(uuid,uuid,uuid,text,text,text,integer)'::regprocedure,'app.checkpoint_answer_draft_context(uuid,uuid,text)'::regprocedure,
 'app.checkpoint_answer_payload_valid(bytea,text)'::regprocedure,'app.checkpoint_answer_draft_record(app.checkpoint_answer_draft_revisions)'::regprocedure,
 'app.read_checkpoint_answer_draft(uuid,uuid,text,text,text,uuid)'::regprocedure,'app.save_checkpoint_answer_draft(uuid,uuid,text,text,text,uuid,bigint,bytea,text)'::regprocedure) LOOP
 FOR recipient IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=obj.oid AND a.grantee<>p.proowner LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',obj.name,recipient.rolname); END LOOP; END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.checkpoint_answer_draft_context(uuid,uuid,text),app.read_checkpoint_answer_draft(uuid,uuid,text,text,text,uuid),app.save_checkpoint_answer_draft(uuid,uuid,text,text,text,uuid,bigint,bytea,text) TO nextera_web;
GRANT CREATE ON SCHEMA app TO nextera_checkpoint_owner;
ALTER TABLE app.checkpoint_answer_draft_policies OWNER TO nextera_checkpoint_owner;
ALTER TABLE app.checkpoint_answer_draft_revisions OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.guard_checkpoint_answer_draft_revision() OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.guard_checkpoint_answer_draft_policy() OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_answer_contract_digest(uuid,uuid,uuid,text,text,text,integer) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_answer_draft_context(uuid,uuid,text) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_answer_payload_valid(bytea,text) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_answer_draft_record(app.checkpoint_answer_draft_revisions) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.read_checkpoint_answer_draft(uuid,uuid,text,text,text,uuid) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.save_checkpoint_answer_draft(uuid,uuid,text,text,text,uuid,bigint,bytea,text) OWNER TO nextera_checkpoint_owner;
REVOKE CREATE ON SCHEMA app FROM nextera_checkpoint_owner;
COMMIT;
