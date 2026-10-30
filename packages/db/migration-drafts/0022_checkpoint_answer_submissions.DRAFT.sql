-- REVIEW DRAFT ONLY. Unregistered, unapplied and disabled source preparation.
-- Requires reviewed DRAFT0021 byte-preserving canonical validator; native parity is UNVERIFIED.
-- No frozen mixed definition, allowance, evaluator route or policy is seeded here.
-- officialAnswerPolicy is a PROPOSED frozen task contract: {version:1,gradedAllowance:<explicit>}.
-- answerEvaluator is the exact reviewed seven-field route, never executable source or a hidden grader.
-- This is acceptance/reservation ONLY. Real typed result application, passed-task eligibility,
-- infrastructure reconciliation and outbox delivery MUST be reviewed before activation.
-- No retry, refund, partial-credit, score, duration, attempt-count or legacy Go policy is introduced.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF getdatabaseencoding()<>'UTF8'
 OR NOT (EXISTS(
 SELECT FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
 JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE n.nspname='app' AND p.proname='checkpoint_answer_payload_valid'
 AND pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')='bytea,text'
 AND p.prorettype='pg_catalog.bool'::pg_catalog.regtype AND p.prokind='f'
 AND l.lanname='plpgsql' AND p.provolatile='i' AND p.proisstrict AND NOT p.prosecdef
 AND p.proconfig=ARRAY['search_path=pg_catalog']
 AND o.rolname='nextera_checkpoint_owner' AND NOT o.rolcanlogin AND NOT o.rolsuper
 AND NOT o.rolbypassrls AND NOT o.rolcreatedb AND NOT o.rolcreaterole AND NOT o.rolreplication
 AND pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8'))=pg_catalog.decode('dfaeffc7bdcee0bee7d28a0182ba5184ee72bcb9d5763db7b9a15e88f9b20816','hex')
 AND NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 WHERE a.grantee<>p.proowner AND a.privilege_type='EXECUTE')))
 OR to_regprocedure('app.checkpoint_answer_contract_digest(uuid,uuid,uuid,text,text,text,integer)') IS NULL
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_web')
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET') THEN
 RAISE EXCEPTION 'Reviewed isolated checkpoint source prerequisites required'; END IF;
END $$;

CREATE TABLE app.checkpoint_answer_submit_policies (
 curriculum_version_id uuid NOT NULL, node_key text NOT NULL,
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 task_key text NOT NULL CHECK(task_key ~ '^[a-z0-9-]{1,100}$'),
 enabled boolean NOT NULL DEFAULT false,
 answer_kind text NOT NULL CHECK(answer_kind IN ('trace_with_reason','debug_with_reason')),
 max_answer_bytes integer NOT NULL CHECK(max_answer_bytes BETWEEN 1 AND 262144),
 graded_allowance integer NOT NULL CHECK(graded_allowance>0),
 evaluator_key text NOT NULL CHECK(evaluator_key ~ '^[a-z0-9-]{1,100}$'),
 evaluator_digest text NOT NULL CHECK(evaluator_digest ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(curriculum_version_id,node_key,definition_digest,task_key),
 FOREIGN KEY(curriculum_version_id,node_key) REFERENCES app.checkpoint_definitions(curriculum_version_id,node_key) ON DELETE RESTRICT
);
CREATE TABLE app.checkpoint_answer_receipts (
 id uuid PRIMARY KEY,
 auth_user_id uuid NOT NULL, user_id uuid NOT NULL, cohort_id uuid NOT NULL, attempt_id uuid NOT NULL,
 curriculum_version_id uuid NOT NULL, node_key text NOT NULL, task_key text NOT NULL,
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 snapshot_digest text NOT NULL CHECK(snapshot_digest ~ '^[0-9a-f]{64}$'),
 answer_contract_digest text NOT NULL CHECK(answer_contract_digest ~ '^[0-9a-f]{64}$'),
 answer_version integer NOT NULL CHECK(answer_version=1),
 answer_kind text NOT NULL CHECK(answer_kind IN ('trace_with_reason','debug_with_reason')),
 request_id uuid NOT NULL,
 answer_bytes bytea NOT NULL CHECK(octet_length(answer_bytes) BETWEEN 1 AND 262144),
 answer_digest text NOT NULL CHECK(answer_digest=encode(sha256(answer_bytes),'hex')),
 evaluator_key text NOT NULL, evaluator_digest text NOT NULL CHECK(evaluator_digest ~ '^[0-9a-f]{64}$'),
 accepted_at timestamptz NOT NULL,
 outbox_receipt_id uuid NOT NULL CHECK(outbox_receipt_id=id),
 debit_receipt_id uuid NOT NULL CHECK(debit_receipt_id=id),
 UNIQUE(user_id,request_id),
 UNIQUE(id,attempt_id,task_key),
 UNIQUE(id,answer_digest,snapshot_digest,evaluator_key,evaluator_digest),
 FOREIGN KEY(attempt_id,cohort_id,user_id,curriculum_version_id,node_key)
 REFERENCES app.checkpoint_attempts(id,cohort_id,user_id,curriculum_version_id,node_key) ON DELETE RESTRICT,
 FOREIGN KEY(curriculum_version_id,node_key,definition_digest,task_key)
 REFERENCES app.checkpoint_answer_submit_policies(curriculum_version_id,node_key,definition_digest,task_key) ON DELETE RESTRICT
);
-- Immutable outbox intent only; a future dispatcher has its own delivery receipts/leases.
-- Payload and hidden grading material are absent: follow the immutable receipt reference.
CREATE TABLE app.checkpoint_answer_outbox (
 receipt_id uuid PRIMARY KEY,
 answer_digest text NOT NULL, snapshot_digest text NOT NULL,
 evaluator_key text NOT NULL, evaluator_digest text NOT NULL,
 evaluation text NOT NULL CHECK(evaluation='pending'),
 created_at timestamptz NOT NULL,
 FOREIGN KEY(receipt_id,answer_digest,snapshot_digest,evaluator_key,evaluator_digest)
 REFERENCES app.checkpoint_answer_receipts(id,answer_digest,snapshot_digest,evaluator_key,evaluator_digest) ON DELETE RESTRICT
);
-- One pending allowance reservation per immutable receipt. No invented release/refund result.
CREATE TABLE app.checkpoint_answer_allowance_debits (
 receipt_id uuid PRIMARY KEY, attempt_id uuid NOT NULL, task_key text NOT NULL,
 units integer NOT NULL CHECK(units=1), created_at timestamptz NOT NULL,
 FOREIGN KEY(receipt_id,attempt_id,task_key) REFERENCES app.checkpoint_answer_receipts(id,attempt_id,task_key) ON DELETE RESTRICT
);
-- Deferred reverse FKs reject any committed partial receipt/outbox/debit triple.
ALTER TABLE app.checkpoint_answer_receipts ADD CONSTRAINT checkpoint_answer_receipt_has_outbox
 FOREIGN KEY(outbox_receipt_id) REFERENCES app.checkpoint_answer_outbox(receipt_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.checkpoint_answer_receipts ADD CONSTRAINT checkpoint_answer_receipt_has_debit
 FOREIGN KEY(debit_receipt_id) REFERENCES app.checkpoint_answer_allowance_debits(receipt_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.checkpoint_answer_submit_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.checkpoint_answer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.checkpoint_answer_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.checkpoint_answer_allowance_debits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.checkpoint_answer_submit_policies,app.checkpoint_answer_receipts,app.checkpoint_answer_outbox,app.checkpoint_answer_allowance_debits FROM PUBLIC,nextera_web;

CREATE FUNCTION app.guard_checkpoint_answer_submission_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'Structured acceptance, pending intent and debit are immutable';
END $$;
CREATE TRIGGER checkpoint_answer_receipt_immutable BEFORE UPDATE OR DELETE ON app.checkpoint_answer_receipts FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_answer_submission_history();
CREATE TRIGGER checkpoint_answer_outbox_immutable BEFORE UPDATE OR DELETE ON app.checkpoint_answer_outbox FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_answer_submission_history();
CREATE TRIGGER checkpoint_answer_debit_immutable BEFORE UPDATE OR DELETE ON app.checkpoint_answer_allowance_debits FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_answer_submission_history();
CREATE FUNCTION app.guard_checkpoint_answer_submit_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE used boolean; BEGIN
 SELECT EXISTS(SELECT FROM app.checkpoint_answer_receipts WHERE curriculum_version_id=OLD.curriculum_version_id AND node_key=OLD.node_key AND definition_digest=OLD.definition_digest AND task_key=OLD.task_key) INTO used;
 IF TG_OP='DELETE' THEN IF OLD.enabled OR used THEN RAISE EXCEPTION 'Retained structured submit policy'; END IF; RETURN OLD; END IF;
 IF (OLD.enabled OR used) AND (to_jsonb(OLD)-'enabled') IS DISTINCT FROM (to_jsonb(NEW)-'enabled') THEN
 RAISE EXCEPTION 'Used structured submit policy is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkpoint_answer_submit_policy_immutable BEFORE UPDATE OR DELETE ON app.checkpoint_answer_submit_policies FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_answer_submit_policy();

-- Canonical validation runs FIRST. json_each retains JSON string tokens without ->> decoding.
-- Recognize only a whole ECMAScript-whitespace token; never sequential escape replacement.
-- Literal backslashes must not be consumed into new whitespace escapes. NUL remains opaque.
-- All answer bytes are stored unchanged. This lexical completeness proposal has no native proof.
CREATE FUNCTION app.checkpoint_answer_payload_complete(payload bytea,kind text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE field record; whitespace text; blank_pattern text;
BEGIN
 IF NOT app.checkpoint_answer_payload_valid(payload,kind) THEN RETURN false; END IF;
 whitespace:=chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
 blank_pattern:=replace($json_whitespace$\A"(?:[@WHITESPACE@]|\\(?:[tnrf]|u000b))*"\Z$json_whitespace$,'@WHITESPACE@',whitespace);
 FOR field IN SELECT key,value FROM json_each(convert_from(payload,'UTF8')::json)
 WHERE (kind='trace_with_reason' AND key='reason') OR (kind='debug_with_reason' AND key IN ('source','explanation','counterexample')) LOOP
 IF field.value::text COLLATE pg_catalog."C" ~ blank_pattern THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION app.checkpoint_answer_submission_context(auth_id uuid,learner uuid,attempt uuid,task text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; p app.checkpoint_answer_submit_policies;
 u uuid; item jsonb; contract jsonb; allowance jsonb; route jsonb; at_time timestamptz; used bigint; maximum integer; kind text;
BEGIN
 IF auth_id IS NULL OR learner IS NULL OR attempt IS NULL OR task IS NULL OR task !~ '^[a-z0-9-]{1,100}$' THEN
 RAISE EXCEPTION 'Structured submit forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'Structured submit forbidden' USING ERRCODE='42501'; END IF;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM learner OR u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Structured provider/application identity mismatch' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||u::text,4));
 u:=app.checkpoint_lock_access(auth_id,a.cohort_id);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR SHARE;
 IF u IS DISTINCT FROM learner OR u IS DISTINCT FROM a.user_id OR NOT EXISTS(SELECT FROM app.users WHERE id=learner AND auth_user_id=auth_id AND active AND role='learner')
 OR NOT EXISTS(SELECT FROM app.cohorts WHERE id=a.cohort_id AND curriculum_version_id=a.curriculum_version_id AND status='active') THEN
 RAISE EXCEPTION 'Structured submit forbidden' USING ERRCODE='42501'; END IF;
 IF a.snapshot->>'attempt_id' IS DISTINCT FROM a.id::text OR a.snapshot->>'cohort_id' IS DISTINCT FROM a.cohort_id::text
 OR a.snapshot->>'learner_id' IS DISTINCT FROM a.user_id::text OR a.snapshot->>'node_key' IS DISTINCT FROM a.node_key
 OR a.snapshot->>'curriculum_version_id' IS DISTINCT FROM a.curriculum_version_id::text
 OR a.snapshot->>'definition_digest' IS DISTINCT FROM a.definition_digest
 OR a.snapshot->>'normal_slot' IS DISTINCT FROM a.normal_slot::text OR a.snapshot->>'kind' IS DISTINCT FROM a.kind
 OR (a.snapshot->>'started_at')::timestamptz IS DISTINCT FROM a.started_at
 OR (a.snapshot->>'deadline_at')::timestamptz IS DISTINCT FROM a.deadline_at
 OR a.snapshot_digest IS DISTINCT FROM app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt')
 OR jsonb_typeof(a.snapshot->'definition'->'tasks') IS DISTINCT FROM 'array' THEN
 RAISE EXCEPTION 'Frozen structured submit unavailable' USING ERRCODE='PS005'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task)<>1 THEN
 RAISE EXCEPTION 'Structured task forbidden' USING ERRCODE='42501'; END IF;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;
 contract:=item->'answerContract'; allowance:=item->'officialAnswerPolicy'; route:=item->'answerEvaluator';
 IF jsonb_typeof(contract) IS DISTINCT FROM 'object' OR jsonb_typeof(allowance) IS DISTINCT FROM 'object' OR jsonb_typeof(route) IS DISTINCT FROM 'object' THEN
 RAISE EXCEPTION 'Explicit typed policy/route unavailable' USING ERRCODE='PS005'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(contract))<>3 OR contract->'version' IS DISTINCT FROM '1'::jsonb
 OR contract->>'kind' IS NULL OR contract->>'kind' NOT IN ('trace_with_reason','debug_with_reason')
 OR jsonb_typeof(contract->'kind') IS DISTINCT FROM 'string'
 OR jsonb_typeof(contract->'maxBytes') IS DISTINCT FROM 'number' OR (contract->>'maxBytes') IS NULL
 OR (contract->>'maxBytes') !~ '^[1-9][0-9]*$'
 OR (SELECT count(*) FROM jsonb_object_keys(allowance))<>2 OR allowance->'version' IS DISTINCT FROM '1'::jsonb
 OR jsonb_typeof(allowance->'gradedAllowance') IS DISTINCT FROM 'number' OR allowance->>'gradedAllowance' IS NULL
 OR (allowance->>'gradedAllowance') !~ '^[1-9][0-9]*$' THEN
 RAISE EXCEPTION 'Explicit typed policy unavailable' USING ERRCODE='PS005'; END IF;
 IF (contract->>'maxBytes')::numeric>262144 OR (allowance->>'gradedAllowance')::numeric>2147483647 THEN
 RAISE EXCEPTION 'Explicit typed bounds unavailable' USING ERRCODE='PS005'; END IF;
 kind:=contract->>'kind'; maximum:=(contract->>'maxBytes')::integer;
 SELECT * INTO p FROM app.checkpoint_answer_submit_policies WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=a.definition_digest AND task_key=task AND enabled FOR SHARE;
 IF NOT FOUND OR p.answer_kind IS DISTINCT FROM kind OR p.max_answer_bytes IS DISTINCT FROM maximum
 OR p.graded_allowance IS DISTINCT FROM (allowance->>'gradedAllowance')::integer
 OR route IS DISTINCT FROM jsonb_build_object('family','checkpoint_structured_answer','version',1,'kind',kind,'definitionDigest',a.definition_digest,'taskKey',task,'evaluatorKey',p.evaluator_key,'evaluatorDigest',p.evaluator_digest) THEN
 RAISE EXCEPTION 'Reviewed frozen typed policy/route unavailable' USING ERRCODE='PS005'; END IF;
 SELECT count(*) INTO used FROM app.checkpoint_answer_allowance_debits WHERE attempt_id=attempt AND task_key=task;
 at_time:=clock_timestamp();
 RETURN jsonb_build_object('actor',jsonb_build_object('id',learner,'authUserId',auth_id),
 'scope',jsonb_build_object('learnerId',u,'cohortId',a.cohort_id,'attemptId',a.id,'taskKey',task,'definitionDigest',a.definition_digest),
 'readAllowed',true,'status',CASE WHEN a.status='active' THEN 'active' ELSE 'closed' END,
 'serverNow',at_time,'deadline',a.deadline_at,
 'answerContract',jsonb_build_object('version',1,'kind',kind,'maxBytes',maximum,'digest',app.checkpoint_answer_contract_digest(u,a.cohort_id,a.id,task,a.definition_digest,kind,maximum)),
 'submitAllowed',a.status='active' AND at_time<a.deadline_at AND used<p.graded_allowance);
END $$;

CREATE FUNCTION app.checkpoint_answer_receipt_record(r app.checkpoint_answer_receipts) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id,'actor',jsonb_build_object('id',r.user_id,'authUserId',r.auth_user_id),
 'scope',jsonb_build_object('learnerId',r.user_id,'cohortId',r.cohort_id,'attemptId',r.attempt_id,'taskKey',r.task_key,'definitionDigest',r.definition_digest),
 'requestId',r.request_id,'answerContractDigest',r.answer_contract_digest,'answerVersion',r.answer_version,'answerKind',r.answer_kind,
 'sha256',r.answer_digest,'byteLength',octet_length(r.answer_bytes),'payloadBase64',replace(encode(r.answer_bytes,'base64'),E'\n',''),
 'evaluator',jsonb_build_object('family','checkpoint_structured_answer','version',1,'kind',r.answer_kind,'definitionDigest',r.definition_digest,'taskKey',r.task_key,'evaluatorKey',r.evaluator_key,'evaluatorDigest',r.evaluator_digest),'evaluation','pending')
$$;
CREATE FUNCTION app.accept_checkpoint_answer(auth_id uuid,learner uuid,cohort uuid,attempt uuid,task text,definition text,contract text,request uuid,payload bytea,payload_hash text,evaluator text,evaluator_hash text,allow_new boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; p app.checkpoint_answer_submit_policies; old app.checkpoint_answer_receipts; r app.checkpoint_answer_receipts;
 ctx jsonb; u uuid; used bigint; at_time timestamptz; sid uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM learner OR u IS DISTINCT FROM a.user_id OR cohort IS DISTINCT FROM a.cohort_id THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||u::text,4));
 PERFORM app.checkpoint_lock_access(auth_id,a.cohort_id);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||request::text,22));
 ctx:=app.checkpoint_answer_submission_context(auth_id,learner,attempt,task);
 IF definition IS DISTINCT FROM a.definition_digest THEN RETURN jsonb_build_object('kind','definition_mismatch'); END IF;
 IF contract IS DISTINCT FROM ctx->'answerContract'->>'digest' THEN RETURN jsonb_build_object('kind','contract_mismatch'); END IF;
 SELECT * INTO p FROM app.checkpoint_answer_submit_policies WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=definition AND task_key=task AND enabled FOR SHARE;
 IF NOT FOUND OR evaluator IS DISTINCT FROM p.evaluator_key OR evaluator_hash IS DISTINCT FROM p.evaluator_digest THEN RETURN jsonb_build_object('kind','unavailable'); END IF;
 IF request IS NULL OR allow_new IS NULL OR payload IS NULL OR payload_hash IS NULL
 OR octet_length(payload)>(ctx->'answerContract'->>'maxBytes')::integer
 OR payload_hash IS DISTINCT FROM encode(sha256(payload),'hex')
 OR NOT app.checkpoint_answer_payload_complete(payload,ctx->'answerContract'->>'kind') THEN RETURN jsonb_build_object('kind','invalid_input'); END IF;
 -- Even replay rechecks live access, frozen policy/route and the server deadline.
 at_time:=clock_timestamp();
 IF a.status<>'active' OR at_time>=a.deadline_at THEN RETURN jsonb_build_object('kind','closed'); END IF;
 SELECT * INTO old FROM app.checkpoint_answer_receipts WHERE user_id=u AND request_id=request;
 IF FOUND THEN
 IF old.auth_user_id IS DISTINCT FROM auth_id OR old.cohort_id IS DISTINCT FROM cohort OR old.attempt_id IS DISTINCT FROM attempt
 OR old.task_key IS DISTINCT FROM task OR old.definition_digest IS DISTINCT FROM definition OR old.snapshot_digest IS DISTINCT FROM a.snapshot_digest
 OR old.answer_contract_digest IS DISTINCT FROM contract OR old.answer_version<>1 OR old.answer_kind IS DISTINCT FROM ctx->'answerContract'->>'kind'
 OR old.answer_digest IS DISTINCT FROM payload_hash OR old.answer_bytes IS DISTINCT FROM payload
 OR old.evaluator_key IS DISTINCT FROM evaluator OR old.evaluator_digest IS DISTINCT FROM evaluator_hash THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 RETURN jsonb_build_object('kind','accepted','receipt',app.checkpoint_answer_receipt_record(old),'replayed',true);
 END IF;
 SELECT count(*) INTO used FROM app.checkpoint_answer_allowance_debits WHERE attempt_id=attempt AND task_key=task;
 IF NOT allow_new OR used>=p.graded_allowance THEN RETURN jsonb_build_object('kind','budget_exhausted'); END IF;
 -- The receipt, exact outbox reference and one allowance reservation commit together.
 INSERT INTO app.checkpoint_answer_receipts(id,auth_user_id,user_id,cohort_id,attempt_id,curriculum_version_id,node_key,task_key,definition_digest,snapshot_digest,answer_contract_digest,answer_version,answer_kind,request_id,answer_bytes,answer_digest,evaluator_key,evaluator_digest,accepted_at,outbox_receipt_id,debit_receipt_id)
 VALUES(sid,auth_id,u,a.cohort_id,a.id,a.curriculum_version_id,a.node_key,task,definition,a.snapshot_digest,contract,1,ctx->'answerContract'->>'kind',request,payload,payload_hash,evaluator,evaluator_hash,at_time,sid,sid) RETURNING * INTO r;
 INSERT INTO app.checkpoint_answer_outbox(receipt_id,answer_digest,snapshot_digest,evaluator_key,evaluator_digest,evaluation,created_at)
 VALUES(sid,payload_hash,a.snapshot_digest,evaluator,evaluator_hash,'pending',at_time);
 INSERT INTO app.checkpoint_answer_allowance_debits(receipt_id,attempt_id,task_key,units,created_at) VALUES(sid,attempt,task,1,at_time);
 RETURN jsonb_build_object('kind','accepted','receipt',app.checkpoint_answer_receipt_record(r),'replayed',false);
 -- PL/pgSQL exception blocks roll back their writes before these proved denials.
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('kind','forbidden');
 WHEN SQLSTATE 'PS005' THEN RETURN jsonb_build_object('kind','unavailable');
END $$;

-- Remove unexpected inherited default ACLs on only these NEW objects.
REVOKE ALL ON FUNCTION app.guard_checkpoint_answer_submission_history(),app.guard_checkpoint_answer_submit_policy(),app.checkpoint_answer_payload_complete(bytea,text),app.checkpoint_answer_submission_context(uuid,uuid,uuid,text),app.checkpoint_answer_receipt_record(app.checkpoint_answer_receipts),app.accept_checkpoint_answer(uuid,uuid,uuid,uuid,text,text,text,uuid,bytea,text,text,text,boolean) FROM PUBLIC;
DO $$ DECLARE obj record; recipient record; BEGIN
 FOR obj IN SELECT c.oid,c.oid::regclass AS name,c.relowner AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='app' AND c.relname IN ('checkpoint_answer_submit_policies','checkpoint_answer_receipts','checkpoint_answer_outbox','checkpoint_answer_allowance_debits') LOOP
 FOR recipient IN SELECT DISTINCT r.rolname FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=obj.oid AND a.grantee<>obj.owner LOOP
 EXECUTE format('REVOKE ALL ON TABLE %s FROM %I',obj.name,recipient.rolname); END LOOP; END LOOP;
 FOR obj IN SELECT p.oid,p.oid::regprocedure AS name,p.proowner AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.oid IN ('app.guard_checkpoint_answer_submission_history()'::regprocedure,'app.guard_checkpoint_answer_submit_policy()'::regprocedure,'app.checkpoint_answer_payload_complete(bytea,text)'::regprocedure,'app.checkpoint_answer_submission_context(uuid,uuid,uuid,text)'::regprocedure,'app.checkpoint_answer_receipt_record(app.checkpoint_answer_receipts)'::regprocedure,'app.accept_checkpoint_answer(uuid,uuid,uuid,uuid,text,text,text,uuid,bytea,text,text,text,boolean)'::regprocedure) LOOP
 FOR recipient IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=obj.oid AND a.grantee<>obj.owner LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',obj.name,recipient.rolname); END LOOP; END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.checkpoint_answer_submission_context(uuid,uuid,uuid,text),app.accept_checkpoint_answer(uuid,uuid,uuid,uuid,text,text,text,uuid,bytea,text,text,text,boolean) TO nextera_web;
GRANT CREATE ON SCHEMA app TO nextera_checkpoint_owner;
ALTER TABLE app.checkpoint_answer_submit_policies OWNER TO nextera_checkpoint_owner;
ALTER TABLE app.checkpoint_answer_receipts OWNER TO nextera_checkpoint_owner;
ALTER TABLE app.checkpoint_answer_outbox OWNER TO nextera_checkpoint_owner;
ALTER TABLE app.checkpoint_answer_allowance_debits OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.guard_checkpoint_answer_submission_history() OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.guard_checkpoint_answer_submit_policy() OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_answer_payload_complete(bytea,text) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_answer_submission_context(uuid,uuid,uuid,text) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_answer_receipt_record(app.checkpoint_answer_receipts) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.accept_checkpoint_answer(uuid,uuid,uuid,uuid,text,text,text,uuid,bytea,text,text,text,boolean) OWNER TO nextera_checkpoint_owner;
REVOKE CREATE ON SCHEMA app FROM nextera_checkpoint_owner;
COMMIT;
