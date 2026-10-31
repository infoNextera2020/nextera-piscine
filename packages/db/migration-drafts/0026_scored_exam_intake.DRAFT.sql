-- SOURCE DRAFT ONLY; unregistered, unapplied, no policies seeded.
-- Scored Exam1 ONLY. Registered legacy functions/constraints remain unchanged.
-- Requires reviewed0024 acceptance capture and0025 legacy-finalizer guard.
-- This does not provide a180-minute start/catalog publisher: existing90-minute
-- constraints/start must be separately extended before a marked exam can start.
-- Exact graded-acceptance allowance/rate/resource limits require explicit frozen
-- configuration. Missing values mean unavailable, never three or unlimited.
-- No passing-result lock, automatic retake, replacement grant, refund, grade or
-- progression write. Accepted infrastructure failures keep their reservation
-- until a separately reviewed reconciliation policy says otherwise.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'scored-exam-0026-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolcanlogin AND rolsuper)
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')
 OR NOT has_schema_privilege('nextera_checkpoint_owner','app','CREATE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner')
 OR to_regclass('app.exam_scoring_acceptances') IS NULL
 OR to_regclass('app.exam_scoring_assignments') IS NULL
 OR to_regprocedure('app.capture_exam_scoring_acceptance()') IS NULL THEN
 RAISE EXCEPTION 'Fresh reviewed scored-exam DBA/source prerequisites required'; END IF;
END $$;
SET LOCAL ROLE nextera_checkpoint_owner;

CREATE TABLE app.scored_exam_intake_policies (
 curriculum_version_id uuid NOT NULL, node_key text NOT NULL,
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 task_key text NOT NULL CHECK(task_key IN ('q1','q2','q3','q4','q5')),
 enabled boolean NOT NULL DEFAULT false,
 graded_acceptance_allowance integer NOT NULL CHECK(graded_acceptance_allowance>0),
 rate_window_ms integer NOT NULL CHECK(rate_window_ms>0),
 max_acceptances_per_window integer NOT NULL CHECK(max_acceptances_per_window>0),
 max_code_bytes integer NOT NULL CHECK(max_code_bytes BETWEEN 1 AND 262144),
 resource_policy_digest text NOT NULL CHECK(resource_policy_digest ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(curriculum_version_id,node_key,definition_digest,task_key)
);
CREATE TABLE app.scored_exam_acceptance_intents (
 submission_id uuid PRIMARY KEY, job_id uuid NOT NULL UNIQUE, artifact_id uuid NOT NULL,
 auth_user_id uuid NOT NULL, user_id uuid NOT NULL, cohort_id uuid NOT NULL, attempt_id uuid NOT NULL,
 curriculum_version_id uuid NOT NULL,node_key text NOT NULL,task_key text NOT NULL,
 request_id uuid NOT NULL,definition_digest text NOT NULL,snapshot_digest text NOT NULL,
 policy_digest text NOT NULL CHECK(policy_digest ~ '^[0-9a-f]{64}$'),
 filename text NOT NULL,byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 262144),
 answer_digest text NOT NULL CHECK(answer_digest ~ '^[0-9a-f]{64}$'),accepted_at timestamptz NOT NULL,
 UNIQUE(cohort_id,user_id,request_id),
 FOREIGN KEY(curriculum_version_id,node_key,definition_digest,task_key)
 REFERENCES app.scored_exam_intake_policies(curriculum_version_id,node_key,definition_digest,task_key) ON DELETE RESTRICT
);
CREATE FUNCTION app.guard_scored_exam_intent_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'Scored acceptance reservations are immutable';
END $$;
CREATE TRIGGER scored_exam_intent_immutable BEFORE UPDATE OR DELETE ON app.scored_exam_acceptance_intents FOR EACH ROW EXECUTE FUNCTION app.guard_scored_exam_intent_history();
CREATE FUNCTION app.guard_scored_exam_intake_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE used boolean; BEGIN
 SELECT EXISTS(SELECT FROM app.scored_exam_acceptance_intents WHERE curriculum_version_id=OLD.curriculum_version_id AND node_key=OLD.node_key AND definition_digest=OLD.definition_digest AND task_key=OLD.task_key) INTO used;
 IF TG_OP='DELETE' THEN IF OLD.enabled OR used THEN RAISE EXCEPTION 'Retained scored intake policy'; END IF;RETURN OLD;END IF;
 IF (OLD.enabled OR used) AND (to_jsonb(OLD)-'enabled') IS DISTINCT FROM (to_jsonb(NEW)-'enabled') THEN RAISE EXCEPTION 'Frozen scored intake policy';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scored_exam_policy_immutable BEFORE UPDATE OR DELETE ON app.scored_exam_intake_policies FOR EACH ROW EXECUTE FUNCTION app.guard_scored_exam_intake_policy();

CREATE FUNCTION app.scored_exam_intake_context(auth_id uuid,attempt uuid,task text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;u uuid;p app.scored_exam_intake_policies;item jsonb;rules jsonb;spec jsonb;configured jsonb;phase jsonb;limits jsonb;k text;n text;at_time timestamptz;used bigint;recent bigint;window_start timestamptz;
BEGIN
 IF auth_id IS NULL OR attempt IS NULL OR task IS NULL OR task NOT IN ('q1','q2','q3','q4','q5') THEN RAISE EXCEPTION 'Scored intake forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Scored intake forbidden' USING ERRCODE='42501';END IF;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||u::text,4));
 u:=app.checkpoint_lock_access(auth_id,a.cohort_id);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR SHARE;
 IF u IS DISTINCT FROM a.user_id OR NOT EXISTS(SELECT FROM app.users WHERE id=u AND auth_user_id=auth_id AND active AND role='learner')
 OR NOT EXISTS(SELECT FROM app.cohorts WHERE id=a.cohort_id AND curriculum_version_id=a.curriculum_version_id AND status='active') THEN RAISE EXCEPTION 'Scored intake forbidden' USING ERRCODE='42501';END IF;
 IF a.normal_slot<>1 OR a.kind<>'normal' OR a.replacement_for IS NOT NULL OR a.deadline_at<>a.started_at+interval '180 minutes'
 OR EXISTS(SELECT FROM app.checkpoint_attempts x WHERE x.cohort_id=a.cohort_id AND x.user_id=a.user_id AND x.node_key=a.node_key AND x.id<>a.id)
 OR a.snapshot->>'attempt_id' IS DISTINCT FROM a.id::text OR a.snapshot->>'learner_id' IS DISTINCT FROM u::text
 OR a.snapshot->>'cohort_id' IS DISTINCT FROM a.cohort_id::text OR a.snapshot->>'curriculum_version_id' IS DISTINCT FROM a.curriculum_version_id::text
 OR a.snapshot->>'node_key' IS DISTINCT FROM a.node_key OR a.snapshot->>'definition_digest' IS DISTINCT FROM a.definition_digest
 OR a.snapshot->>'normal_slot' IS DISTINCT FROM '1' OR a.snapshot->>'kind' IS DISTINCT FROM 'normal'
 OR (a.snapshot->>'started_at')::timestamptz IS DISTINCT FROM a.started_at OR (a.snapshot->>'deadline_at')::timestamptz IS DISTINCT FROM a.deadline_at
 OR a.snapshot_digest IS DISTINCT FROM app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt')
 OR jsonb_typeof(a.snapshot->'definition'->'examScoring') IS DISTINCT FROM 'object'
 OR jsonb_typeof(a.snapshot->'definition'->'tasks') IS DISTINCT FROM 'array'
 OR NOT EXISTS(SELECT FROM app.exam_scoring_assignments x JOIN app.exam_scoring_rubrics r ON r.rubric_digest=x.rubric_digest WHERE x.attempt_id=a.id AND r.definition_digest=a.definition_digest AND a.snapshot->'definition'->'examScoring'=jsonb_build_object('version',1,'form',r.form,'rubricDigest',r.rubric_digest)) THEN
 RAISE EXCEPTION 'Frozen scored intake unavailable' USING ERRCODE='PS005'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') x WHERE x->>'key'=task)<>1 THEN RAISE EXCEPTION 'Scored task forbidden' USING ERRCODE='42501';END IF;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;
 rules:=item->'submissionRules';spec:=item->'evaluationSpec';configured:=item->'scoredSubmissionPolicy';
 SELECT * INTO p FROM app.scored_exam_intake_policies WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=a.definition_digest AND task_key=task AND enabled FOR SHARE;
 IF NOT FOUND OR configured IS DISTINCT FROM jsonb_build_object('version',1,'gradedAcceptanceAllowance',p.graded_acceptance_allowance,'rateWindowMs',p.rate_window_ms,'maxAcceptancesPerWindow',p.max_acceptances_per_window,'maxCodeBytes',p.max_code_bytes,'resourcePolicyDigest',p.resource_policy_digest)
 OR jsonb_typeof(rules) IS DISTINCT FROM 'object' OR jsonb_typeof(rules->'required_files') IS DISTINCT FROM 'array'
 OR jsonb_array_length(rules->'required_files')<>1 OR jsonb_typeof(rules->'required_files'->0) IS DISTINCT FROM 'string'
 OR length(rules->'required_files'->>0)>100 OR rules->'required_files'->>0 !~ '^[A-Za-z0-9_][A-Za-z0-9_]*[.]go$'
 OR jsonb_typeof(rules->'max_size_kb') IS DISTINCT FROM 'number' OR rules->>'max_size_kb' !~ '^[1-9][0-9]*$'
 OR jsonb_typeof(rules->'allowed_extensions') IS DISTINCT FROM 'array'
 OR (rules->>'max_size_kb')::numeric*1024<p.max_code_bytes OR NOT coalesce(rules->'allowed_extensions' ? '.go',false)
 OR jsonb_typeof(spec) IS DISTINCT FROM 'object' OR item->>'evaluationDigest' IS DISTINCT FROM app.checkpoint_digest(spec,'nextera-evaluation-spec')
 OR spec->>'dependency_policy' IS DISTINCT FROM 'offline' OR jsonb_typeof(spec->'protocol_version') IS DISTINCT FROM 'number'
 OR spec->>'protocol_version' !~ '^[1-9][0-9]*$' OR (spec->>'protocol_version')::numeric>2147483647
 OR spec->'execution_contract'->'version' IS DISTINCT FROM '3'::jsonb
 OR spec->'execution_contract'->>'item_key' IS DISTINCT FROM task
 OR spec->'execution_contract'->>'learner_file' IS DISTINCT FROM rules->'required_files'->>0
 OR jsonb_typeof(spec->'test_pack_digest') IS DISTINCT FROM 'string' OR jsonb_typeof(spec->'test_pack_artifact') IS DISTINCT FROM 'string'
 OR spec->>'test_pack_digest' IS NULL OR spec->>'test_pack_digest' !~ '^[0-9a-f]{64}$'
 OR NOT coalesce(spec->>'test_pack_artifact' ~ ('^oci://[A-Za-z0-9][A-Za-z0-9./_:-]*@sha256:'||(spec->>'test_pack_digest')||'$'),false)
 OR jsonb_typeof(spec->'resource_limits') IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM jsonb_object_keys(spec->'resource_limits'))<>2
 OR NOT (spec->'resource_limits' ?& ARRAY['compilation','execution'])
 OR p.resource_policy_digest IS DISTINCT FROM app.checkpoint_digest(spec->'resource_limits','01coding-exam-resource-limits') THEN RAISE EXCEPTION 'Explicit scored intake/resource policy unavailable' USING ERRCODE='PS005';END IF;
 FOREACH n IN ARRAY ARRAY['compilation','execution'] LOOP
 limits:=spec->'resource_limits'->n;
 IF jsonb_typeof(limits) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(limits))<>7
 OR NOT (limits ?& ARRAY['cpu_limit','memory_bytes','pid_limit','timeout_ms','output_bytes','temporary_filesystem_bytes','temporary_filesystem_inodes']) THEN RAISE EXCEPTION 'Separate phase limits required' USING ERRCODE='PS005';END IF;
 FOREACH k IN ARRAY ARRAY['cpu_limit','memory_bytes','pid_limit','timeout_ms','output_bytes','temporary_filesystem_bytes','temporary_filesystem_inodes'] LOOP
 IF jsonb_typeof(limits->k) IS DISTINCT FROM 'number' OR (limits->>k)::numeric<=0
 OR (k<>'cpu_limit' AND limits->>k !~ '^[1-9][0-9]*$') THEN RAISE EXCEPTION 'Explicit phase limits required' USING ERRCODE='PS005';END IF;
 END LOOP;END LOOP;
 -- Required0024 AFTER capture: no scored acceptance may become a legacy-only receipt.
 IF NOT EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid='app.submissions'::regclass AND t.tgname='exam_scoring_capture_coding' AND t.tgfoid='app.capture_exam_scoring_acceptance()'::regprocedure AND t.tgenabled='O' AND NOT t.tgisinternal)
 OR NOT EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid='app.submissions'::regclass AND t.tgname='scored_exam_acceptance_intent' AND t.tgfoid='app.guard_scored_exam_acceptance_intent()'::regprocedure AND t.tgenabled='O' AND NOT t.tgisinternal)
 OR NOT EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid='app.checkpoint_attempts'::regclass AND t.tgname='scored_exam_first_attempt' AND t.tgfoid='app.guard_scored_exam_first_attempt()'::regprocedure AND t.tgenabled='O' AND NOT t.tgisinternal) THEN RAISE EXCEPTION 'Scored capture unavailable' USING ERRCODE='PS005';END IF;
 at_time:=clock_timestamp();IF at_time<a.started_at THEN RAISE EXCEPTION 'Scored clock unavailable' USING ERRCODE='PS005';END IF;window_start:=to_timestamp(floor(extract(epoch FROM at_time)*1000/p.rate_window_ms)*p.rate_window_ms/1000);
 SELECT count(*),count(*) FILTER(WHERE accepted_at>=window_start) INTO used,recent FROM app.scored_exam_acceptance_intents WHERE attempt_id=a.id AND task_key=task;
 RETURN jsonb_build_object('authUserId',auth_id,'learnerId',u,'cohortId',a.cohort_id,'attemptId',a.id,'taskKey',task,'definitionDigest',a.definition_digest,'snapshotDigest',a.snapshot_digest,
 'filename',rules->'required_files'->>0,'maxCodeBytes',p.max_code_bytes,'policy',configured,'policyDigest',app.checkpoint_digest(configured,'01coding-scored-exam-intake'),'serverNow',at_time,'deadline',a.deadline_at,
 'status',CASE WHEN a.status='active' AND at_time<a.deadline_at THEN 'open' ELSE 'closed' END,'canSubmit',a.status='active' AND at_time<a.deadline_at AND used<p.graded_acceptance_allowance AND recent<p.max_acceptances_per_window);
END $$;

CREATE FUNCTION app.guard_scored_exam_first_attempt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT (NEW.snapshot->'definition' ? 'examScoring') THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.cohort_id::text||NEW.user_id::text,4));
 IF NEW.normal_slot<>1 OR NEW.kind<>'normal' OR NEW.replacement_for IS NOT NULL OR NEW.deadline_at<>NEW.started_at+interval '180 minutes'
 OR EXISTS(SELECT FROM app.checkpoint_attempts WHERE cohort_id=NEW.cohort_id AND user_id=NEW.user_id AND node_key=NEW.node_key) THEN
 RAISE EXCEPTION 'One assigned scored exam attempt only' USING ERRCODE='PS005';END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app.guard_scored_exam_acceptance_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;i app.scored_exam_acceptance_intents;art app.submission_artifacts;BEGIN
 IF NEW.checkpoint_attempt_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=NEW.checkpoint_attempt_id FOR UPDATE;
 IF NOT (a.snapshot->'definition' ? 'examScoring') THEN RETURN NEW;END IF;
 SELECT * INTO i FROM app.scored_exam_acceptance_intents WHERE submission_id=NEW.id;
 SELECT * INTO art FROM app.submission_artifacts WHERE id=NEW.artifact_id;
 IF i.submission_id IS NULL OR i.job_id IS DISTINCT FROM NEW.active_judge_job_id OR i.artifact_id IS DISTINCT FROM NEW.artifact_id
 OR i.user_id IS DISTINCT FROM NEW.user_id OR i.cohort_id IS DISTINCT FROM NEW.cohort_id OR i.attempt_id IS DISTINCT FROM NEW.checkpoint_attempt_id
 OR i.task_key IS DISTINCT FROM NEW.checkpoint_task_key OR i.request_id::text IS DISTINCT FROM NEW.idempotency_key
 OR i.curriculum_version_id IS DISTINCT FROM NEW.curriculum_version_id OR i.node_key IS DISTINCT FROM NEW.node_key
 OR i.definition_digest IS DISTINCT FROM a.definition_digest OR i.snapshot_digest IS DISTINCT FROM a.snapshot_digest
 OR i.answer_digest IS DISTINCT FROM art.sha256 OR i.filename IS DISTINCT FROM art.original_filename OR i.byte_length IS DISTINCT FROM art.size_bytes
 OR i.accepted_at IS DISTINCT FROM NEW.created_at OR i.user_id IS DISTINCT FROM art.owner_user_id THEN
 RAISE EXCEPTION 'Scored intake intent required; legacy acceptance cannot bypass it' USING ERRCODE='PS005';END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app.accept_scored_exam_submission(auth_id uuid,attempt uuid,task text,request uuid,filename text,bytes integer,content_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;ctx jsonb;item jsonb;spec jsonb;old app.scored_exam_acceptance_intents;art app.submission_artifacts;capture app.exam_scoring_acceptances;
 sid uuid:=gen_random_uuid();jid uuid:=gen_random_uuid();ordinal bigint;at_time timestamptz;snap jsonb;v app.curriculum_versions;used bigint;recent bigint;p app.scored_exam_intake_policies;window_start timestamptz;
BEGIN
 ctx:=app.scored_exam_intake_context(auth_id,attempt,task);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 IF request IS NULL OR filename IS NULL OR filename IS DISTINCT FROM ctx->>'filename' OR bytes IS NULL OR bytes<1 OR bytes>(ctx->>'maxCodeBytes')::integer OR content_hash IS NULL OR content_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('kind','invalid_input');END IF;
 -- Both a new acceptance and a replay require current access and an open exam.
 at_time:=clock_timestamp();IF at_time<a.started_at THEN RETURN jsonb_build_object('kind','unavailable');END IF;IF a.status<>'active' OR at_time>=a.deadline_at THEN RETURN jsonb_build_object('kind','closed');END IF;
 SELECT * INTO old FROM app.scored_exam_acceptance_intents WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND request_id=request;
 IF FOUND THEN
 IF old.auth_user_id IS DISTINCT FROM auth_id OR old.attempt_id IS DISTINCT FROM attempt OR old.task_key IS DISTINCT FROM task OR old.filename IS DISTINCT FROM filename OR old.byte_length IS DISTINCT FROM bytes OR old.answer_digest IS DISTINCT FROM content_hash OR old.policy_digest IS DISTINCT FROM ctx->>'policyDigest' OR old.snapshot_digest IS DISTINCT FROM a.snapshot_digest THEN RETURN jsonb_build_object('kind','conflict');END IF;
 SELECT * INTO capture FROM app.exam_scoring_acceptances WHERE submission_id=old.submission_id;
 IF capture.submission_id IS NULL THEN RETURN jsonb_build_object('kind','unavailable');END IF;
 RETURN jsonb_build_object('kind','accepted','attemptId',attempt,'taskKey',task,'definitionDigest',a.definition_digest,'snapshotDigest',a.snapshot_digest,'submissionId',old.submission_id,'jobId',old.job_id,'artifactId',old.artifact_id,'requestId',request,'answerSha256',content_hash,'byteLength',bytes,'filename',filename,'acceptedOrdinal',capture.accepted_ordinal::text,'replayed',true);
 END IF;
 IF EXISTS(SELECT FROM app.submissions WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND idempotency_key=request::text) THEN RETURN jsonb_build_object('kind','conflict');END IF;
 SELECT * INTO p FROM app.scored_exam_intake_policies WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=a.definition_digest AND task_key=task AND enabled FOR SHARE;
 window_start:=to_timestamp(floor(extract(epoch FROM at_time)*1000/p.rate_window_ms)*p.rate_window_ms/1000);
 SELECT count(*),count(*) FILTER(WHERE accepted_at>=window_start) INTO used,recent FROM app.scored_exam_acceptance_intents WHERE attempt_id=attempt AND task_key=task;
 IF used>=p.graded_acceptance_allowance THEN RETURN jsonb_build_object('kind','allowance_exhausted');END IF;
 IF recent>=p.max_acceptances_per_window THEN RETURN jsonb_build_object('kind','rate_limited');END IF;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;spec:=item->'evaluationSpec';
 SELECT * INTO v FROM app.curriculum_versions WHERE id=a.curriculum_version_id;
 INSERT INTO app.submission_artifacts(owner_user_id,storage_bucket,storage_key,original_filename,size_bytes,sha256) VALUES(a.user_id,'nextera-submissions',auth_id::text||'/'||a.cohort_id::text||'/'||request::text||'/'||content_hash,filename,bytes,content_hash) RETURNING * INTO art;
 INSERT INTO app.scored_exam_acceptance_intents VALUES(sid,jid,art.id,auth_id,a.user_id,a.cohort_id,a.id,a.curriculum_version_id,a.node_key,task,request,a.definition_digest,a.snapshot_digest,ctx->>'policyDigest',filename,bytes,content_hash,at_time);
 ordinal:=used+1;
 snap:=spec||jsonb_build_object('curriculum_version_id',v.id,'git_commit_sha',v.git_commit_sha,'evaluation_spec_digest',item->>'evaluationDigest','learner_id',a.user_id,'cohort_id',a.cohort_id,'submission_id',sid,'learner_attempt_ordinal',ordinal,'accepted_at',to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'artifact',jsonb_build_object('id',art.id,'bucket',art.storage_bucket,'key',art.storage_key,'filename',filename,'size_bytes',bytes,'sha256',content_hash));
 INSERT INTO app.submissions(id,cohort_id,user_id,curriculum_version_id,node_key,artifact_id,idempotency_key,evaluation_spec_digest,active_judge_job_id,created_at,checkpoint_attempt_id,checkpoint_task_key) VALUES(sid,a.cohort_id,a.user_id,v.id,a.node_key,art.id,request::text,item->>'evaluationDigest',jid,at_time,attempt,task);
 INSERT INTO judge.jobs(id,submission_id,protocol_version,evaluation_snapshot,evaluation_digest,created_at) VALUES(jid,sid,(spec->>'protocol_version')::integer,snap,app.checkpoint_digest(snap,'nextera-evaluation-snapshot'),at_time);
 SELECT * INTO capture FROM app.exam_scoring_acceptances WHERE submission_id=sid;
 IF capture.submission_id IS NULL OR capture.attempt_id IS DISTINCT FROM attempt OR capture.question_key IS DISTINCT FROM task OR capture.answer_digest IS DISTINCT FROM content_hash OR capture.snapshot_digest IS DISTINCT FROM a.snapshot_digest THEN RAISE EXCEPTION 'Atomic scored capture unavailable' USING ERRCODE='PS005';END IF;
 INSERT INTO app.state_events(submission_id,job_id,entity_type,next_state,actor_type,reason,correlation_id) VALUES(sid,jid,'submission','queued','system','submission_accepted',jid),(sid,jid,'job','queued','system','job_queued',jid);
 RETURN jsonb_build_object('kind','accepted','attemptId',attempt,'taskKey',task,'definitionDigest',a.definition_digest,'snapshotDigest',a.snapshot_digest,'submissionId',sid,'jobId',jid,'artifactId',art.id,'requestId',request,'answerSha256',content_hash,'byteLength',bytes,'filename',filename,'acceptedOrdinal',capture.accepted_ordinal::text,'replayed',false);
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('kind','forbidden');WHEN SQLSTATE 'PS005' THEN RETURN jsonb_build_object('kind','unavailable');
 -- The exception block rolls back ALL inserts before either proved denial.
END $$;

ALTER TABLE app.scored_exam_intake_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.scored_exam_acceptance_intents ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE o record;g record;BEGIN
 FOR o IN SELECT c.oid,c.oid::regclass AS name,c.relowner AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname IN ('scored_exam_intake_policies','scored_exam_acceptance_intents') LOOP
 FOR g IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS recipient FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=o.oid AND a.grantee<>o.owner LOOP EXECUTE format('REVOKE ALL ON TABLE %s FROM %s',o.name,g.recipient);END LOOP;END LOOP;
 FOR o IN SELECT p.oid,p.oid::regprocedure AS name,p.proowner AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('guard_scored_exam_intent_history','guard_scored_exam_intake_policy','scored_exam_intake_context','guard_scored_exam_first_attempt','guard_scored_exam_acceptance_intent','accept_scored_exam_submission') LOOP
 FOR g IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS recipient FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=o.oid AND a.grantee<>o.owner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',o.name,g.recipient);END LOOP;END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.scored_exam_intake_context(uuid,uuid,text),app.accept_scored_exam_submission(uuid,uuid,text,uuid,text,integer,text) TO nextera_web;
RESET ROLE;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'scored-exam-0026-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolcanlogin AND rolsuper) THEN RAISE EXCEPTION 'Existing isolated bootstrap DBA span required';END IF;
END $$;
-- Five external-existing-table FKs installed by the already-held bootstrap DBA.
ALTER TABLE app.scored_exam_intake_policies ADD CONSTRAINT scored_exam_policy_definition_fk FOREIGN KEY(curriculum_version_id,node_key) REFERENCES app.checkpoint_definitions(curriculum_version_id,node_key) ON DELETE RESTRICT;
ALTER TABLE app.scored_exam_acceptance_intents ADD CONSTRAINT scored_exam_intent_attempt_fk FOREIGN KEY(attempt_id,cohort_id,user_id,curriculum_version_id,node_key) REFERENCES app.checkpoint_attempts(id,cohort_id,user_id,curriculum_version_id,node_key) ON DELETE RESTRICT;
ALTER TABLE app.scored_exam_acceptance_intents ADD CONSTRAINT scored_exam_intent_submission_fk FOREIGN KEY(submission_id) REFERENCES app.submissions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.scored_exam_acceptance_intents ADD CONSTRAINT scored_exam_intent_job_fk FOREIGN KEY(job_id) REFERENCES judge.jobs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.scored_exam_acceptance_intents ADD CONSTRAINT scored_exam_intent_artifact_fk FOREIGN KEY(artifact_id) REFERENCES app.submission_artifacts(id) ON DELETE RESTRICT;
CREATE TRIGGER scored_exam_first_attempt BEFORE INSERT ON app.checkpoint_attempts FOR EACH ROW EXECUTE FUNCTION app.guard_scored_exam_first_attempt();
CREATE TRIGGER scored_exam_acceptance_intent BEFORE INSERT ON app.submissions FOR EACH ROW EXECUTE FUNCTION app.guard_scored_exam_acceptance_intent();
-- Read back exact ownership/private table ACLs and named external FKs before
-- commit. Bootstrap authority installs constraints; it is never granted to the
-- checkpoint-owner, web, evaluator or migration actor by this draft.
DO $external_fk_audit$ BEGIN
 IF EXISTS(SELECT FROM (VALUES ('scored_exam_intake_policies'),('scored_exam_acceptance_intents')) expected(name)
 WHERE NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_roles o ON o.oid=c.relowner WHERE n.nspname='app' AND c.relname=expected.name
 AND c.relkind='r' AND c.relrowsecurity AND o.rolname='nextera_checkpoint_owner'
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner))) THEN
 RAISE EXCEPTION 'New scoring table owner/RLS/private ACL readback failed'; END IF;
 IF EXISTS(SELECT FROM (VALUES
 ('scored_exam_policy_definition_fk','app.scored_exam_intake_policies','app.checkpoint_definitions',ARRAY['curriculum_version_id','node_key']::text[],ARRAY['curriculum_version_id','node_key']::text[],false),
 ('scored_exam_intent_attempt_fk','app.scored_exam_acceptance_intents','app.checkpoint_attempts',ARRAY['attempt_id','cohort_id','user_id','curriculum_version_id','node_key']::text[],ARRAY['id','cohort_id','user_id','curriculum_version_id','node_key']::text[],false),
 ('scored_exam_intent_submission_fk','app.scored_exam_acceptance_intents','app.submissions',ARRAY['submission_id']::text[],ARRAY['id']::text[],true),
 ('scored_exam_intent_job_fk','app.scored_exam_acceptance_intents','judge.jobs',ARRAY['job_id']::text[],ARRAY['id']::text[],true),
 ('scored_exam_intent_artifact_fk','app.scored_exam_acceptance_intents','app.submission_artifacts',ARRAY['artifact_id']::text[],ARRAY['id']::text[],false)
 ) required(name,source,target,source_columns,target_columns,deferred)
 WHERE NOT EXISTS(SELECT FROM pg_constraint c WHERE c.conname=required.name
 AND c.conrelid=to_regclass(required.source) AND c.confrelid=to_regclass(required.target)
 AND c.contype='f' AND c.convalidated AND c.confdeltype='r' AND c.confupdtype='a'
 AND c.condeferrable=required.deferred AND c.condeferred=required.deferred
 AND (SELECT array_agg(att.attname::text ORDER BY x.ord) FROM unnest(c.conkey) WITH ORDINALITY x(num,ord) JOIN pg_attribute att ON att.attrelid=c.conrelid AND att.attnum=x.num)=required.source_columns
 AND (SELECT array_agg(att.attname::text ORDER BY x.ord) FROM unnest(c.confkey) WITH ORDINALITY x(num,ord) JOIN pg_attribute att ON att.attrelid=c.confrelid AND att.attnum=x.num)=required.target_columns)) THEN
 RAISE EXCEPTION 'Exact external scoring FK readback failed'; END IF;
END $external_fk_audit$;

COMMIT;
