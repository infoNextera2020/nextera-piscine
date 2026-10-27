-- REVIEW DRAFT ONLY: not registered, not applied, no principal/account/policy rows seeded.
-- Existing permission roles must be approved/provisioned separately. No graded tables are written.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['nextera_checkpoint_owner','nextera_visible_run_worker','nextera_visible_run_maintenance'] LOOP
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=role_name AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
  OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=role_name) THEN RAISE EXCEPTION 'Reviewed isolated NOLOGIN permission roles required'; END IF;
 END LOOP;
 IF NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET') THEN RAISE EXCEPTION 'Approved migration context required'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('visible_run_blob_digest','visible_run_deadline','visible_run_policy','guard_visible_run_history','visible_run_context','visible_run_record','reserve_visible_run','read_visible_run','lock_visible_run','visible_run_principal','claim_visible_run','pulse_visible_run','complete_visible_run','reconcile_visible_run','purge_visible_run_sources','list_queued_visible_runs','list_recoverable_visible_runs'))
 OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname IN('visible_run_profiles','visible_run_receipts','visible_run_sources','visible_run_outputs','visible_run_outbox','visible_run_principals')) THEN RAISE EXCEPTION 'Run namespace already occupied; review before migration'; END IF;
END $$;

CREATE FUNCTION app.visible_run_blob_digest(bytes bytea,domain text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(domain,'UTF8')||decode('00','hex')||convert_to('v1','UTF8')||decode('00','hex')||bytes),'hex')
$$;
CREATE FUNCTION app.visible_run_deadline(value timestamptz) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
CREATE FUNCTION app.visible_run_policy(bytes bytea) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE p jsonb; item text; group_name text; BEGIN
 p:=convert_from(bytes,'UTF8')::jsonb;
 IF jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'Run policy unavailable' USING ERRCODE='RV005'; END IF;
 IF NOT p?&ARRAY['version','key','enabled','visibility','graded','consumesGradedAttempts','limits','maxExamples','budgets','storage','isolation'] OR (SELECT count(*) FROM jsonb_object_keys(p))<>11
 OR p->'version'<>'1'::jsonb OR jsonb_typeof(p->'key') IS DISTINCT FROM 'string' OR (p->>'key' ~ '^[a-z0-9-]{1,100}$') IS NOT TRUE OR p->'enabled'<>'true'::jsonb OR p->>'visibility'<>'visible_examples' OR p->'graded'<>'false'::jsonb OR p->'consumesGradedAttempts'<>'false'::jsonb
 OR jsonb_typeof(p->'maxExamples') IS DISTINCT FROM 'number' OR p->>'maxExamples' !~ '^[0-9]+$' OR (p->>'maxExamples')::numeric NOT BETWEEN 1 AND 262144 THEN RAISE EXCEPTION 'Run policy unavailable' USING ERRCODE='RV005'; END IF;
 FOREACH group_name IN ARRAY ARRAY['limits','budgets','storage','isolation'] LOOP
 IF jsonb_typeof(p->group_name)<>'object' THEN RAISE EXCEPTION 'Run policy unavailable' USING ERRCODE='RV005'; END IF; END LOOP;
 IF NOT (p->'limits')?&ARRAY['timeoutMs','memoryMb','outputBytes','sourceBytes','requestsPerWindow','windowMs','concurrency'] OR (SELECT count(*) FROM jsonb_object_keys(p->'limits'))<>7
 OR NOT (p->'budgets')?&ARRAY['compilationMs','startupMs','leaseMs'] OR (SELECT count(*) FROM jsonb_object_keys(p->'budgets'))<>3
 OR NOT (p->'storage')?&ARRAY['maxRunsPerAttempt','maxSourceBytesPerAttempt','readAfterDeadlineSeconds'] OR (SELECT count(*) FROM jsonb_object_keys(p->'storage'))<>3
 OR NOT (p->'isolation')?&ARRAY['imageDigest','network','hostAccess','filesystem','processUser','resourceEnforcement'] OR (SELECT count(*) FROM jsonb_object_keys(p->'isolation'))<>6 THEN RAISE EXCEPTION 'Run policy unavailable' USING ERRCODE='RV005'; END IF;
 FOREACH item IN ARRAY ARRAY['timeoutMs','memoryMb','outputBytes','sourceBytes','requestsPerWindow','windowMs','concurrency'] LOOP
 IF jsonb_typeof(p->'limits'->item)<>'number' OR p->'limits'->>item !~ '^[0-9]+$' OR (p->'limits'->>item)::numeric NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'Run policy unavailable' USING ERRCODE='RV005'; END IF; END LOOP;
 FOREACH item IN ARRAY ARRAY['compilationMs','startupMs','leaseMs'] LOOP
 IF jsonb_typeof(p->'budgets'->item)<>'number' OR p->'budgets'->>item !~ '^[0-9]+$' OR (p->'budgets'->>item)::numeric NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'Run policy unavailable' USING ERRCODE='RV005'; END IF; END LOOP;
 IF (p->'limits'->>'sourceBytes')::integer>262144 OR (p->'limits'->>'outputBytes')::integer>262144
 OR jsonb_typeof(p->'storage'->'maxRunsPerAttempt')<>'number' OR p->'storage'->>'maxRunsPerAttempt' !~ '^[0-9]+$' OR (p->'storage'->>'maxRunsPerAttempt')::numeric NOT BETWEEN 1 AND 2147483647
 OR jsonb_typeof(p->'storage'->'maxSourceBytesPerAttempt')<>'number' OR p->'storage'->>'maxSourceBytesPerAttempt' !~ '^[0-9]+$' OR (p->'storage'->>'maxSourceBytesPerAttempt')::numeric NOT BETWEEN (p->'limits'->>'sourceBytes')::integer AND 9007199254740991
 OR jsonb_typeof(p->'storage'->'readAfterDeadlineSeconds')<>'number' OR p->'storage'->>'readAfterDeadlineSeconds' !~ '^[0-9]+$' OR (p->'storage'->>'readAfterDeadlineSeconds')::numeric NOT BETWEEN 0 AND 2147483647
 OR (p->'isolation'->>'imageDigest' ~ '^sha256:[0-9a-f]{64}$') IS NOT TRUE OR p->'isolation'->>'network' IS DISTINCT FROM 'none' OR p->'isolation'->>'hostAccess' IS DISTINCT FROM 'none' OR p->'isolation'->>'filesystem' IS DISTINCT FROM 'disposable' OR p->'isolation'->>'processUser' IS DISTINCT FROM 'unprivileged' OR p->'isolation'->>'resourceEnforcement' IS DISTINCT FROM 'external' THEN RAISE EXCEPTION 'Run policy unavailable' USING ERRCODE='RV005'; END IF;
 RETURN p;
END $$;

CREATE TABLE app.visible_run_profiles (
 curriculum_version_id uuid NOT NULL,node_key text NOT NULL,definition_digest text NOT NULL CHECK(definition_digest~'^[0-9a-f]{64}$'),task_key text NOT NULL CHECK(task_key~'^[a-z0-9-]{1,100}$'),
 enabled boolean NOT NULL DEFAULT false,
 manifest_bytes bytea NOT NULL CHECK(octet_length(manifest_bytes) BETWEEN 1 AND 262144),manifest_digest text NOT NULL CHECK(manifest_digest=app.visible_run_blob_digest(manifest_bytes,'nextera-visible-examples')),
 policy_bytes bytea NOT NULL CHECK(octet_length(policy_bytes) BETWEEN 1 AND 262144),policy_digest text NOT NULL CHECK(policy_digest=app.visible_run_blob_digest(policy_bytes,'nextera-visible-run-policy')),
 PRIMARY KEY(curriculum_version_id,node_key,definition_digest,task_key),FOREIGN KEY(curriculum_version_id,node_key) REFERENCES app.checkpoint_definitions(curriculum_version_id,node_key) ON DELETE RESTRICT
);
CREATE TABLE app.visible_run_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL,cohort_id uuid NOT NULL,user_id uuid NOT NULL,curriculum_version_id uuid NOT NULL,node_key text NOT NULL,task_key text NOT NULL,definition_digest text NOT NULL,
 request_id uuid NOT NULL,filename text NOT NULL CHECK(filename~'^[A-Za-z0-9_]+[.]go$'),source_digest text NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 262144),
 manifest_digest text NOT NULL,policy_digest text NOT NULL,intent_digest text NOT NULL CHECK(intent_digest~'^[0-9a-f]{64}$'),accepted_at timestamptz NOT NULL,deadline_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>=deadline_at),
 UNIQUE(user_id,request_id),FOREIGN KEY(attempt_id,cohort_id,user_id,curriculum_version_id,node_key) REFERENCES app.checkpoint_attempts(id,cohort_id,user_id,curriculum_version_id,node_key),
 FOREIGN KEY(curriculum_version_id,node_key,definition_digest,task_key) REFERENCES app.visible_run_profiles(curriculum_version_id,node_key,definition_digest,task_key)
);
CREATE INDEX visible_run_rate ON app.visible_run_receipts(user_id,accepted_at);
CREATE TABLE app.visible_run_sources(run_id uuid PRIMARY KEY REFERENCES app.visible_run_receipts(id),source_bytes bytea NOT NULL CHECK(octet_length(source_bytes) BETWEEN 1 AND 262144));
CREATE TABLE app.visible_run_outputs(run_id uuid PRIMARY KEY REFERENCES app.visible_run_receipts(id),output_bytes bytea NOT NULL CHECK(octet_length(output_bytes)<=262144));
CREATE TABLE app.visible_run_outbox (
 run_id uuid PRIMARY KEY REFERENCES app.visible_run_receipts(id),state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','claimed','running','recovery_required','terminal')),
 lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation BETWEEN 0 AND 9007199254740991),lease_token uuid,principal name,lease_expires_at timestamptz,
 public_state text NOT NULL DEFAULT 'queued' CHECK(public_state IN ('queued','running','completed','compile_error','runtime_error','timeout','output_limit','system_error')),
 finished_at timestamptz,stop_proof_digest text CHECK(stop_proof_digest~'^[0-9a-f]{64}$'),
 CHECK((state IN ('queued','claimed') AND public_state='queued' AND finished_at IS NULL) OR(state IN ('running','recovery_required') AND public_state='running' AND finished_at IS NULL) OR(state='terminal' AND public_state NOT IN ('queued','running') AND finished_at IS NOT NULL)),
 CHECK((state='queued' AND lease_generation=0 AND lease_token IS NULL AND principal IS NULL AND lease_expires_at IS NULL) OR state<>'queued')
);
CREATE TABLE app.visible_run_principals(principal name PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('worker','maintenance')),enabled boolean NOT NULL DEFAULT false,image_digest text CHECK(image_digest~'^sha256:[0-9a-f]{64}$'));

CREATE FUNCTION app.guard_visible_run_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_TABLE_NAME IN ('visible_run_receipts','visible_run_sources','visible_run_outputs') THEN RAISE EXCEPTION 'Run evidence immutable'; END IF;
 IF TG_TABLE_NAME='visible_run_profiles' THEN
 IF TG_OP='INSERT' THEN PERFORM pg_advisory_xact_lock(hashtextextended(NEW.curriculum_version_id::text||NEW.node_key||NEW.definition_digest,14));PERFORM app.visible_run_policy(NEW.policy_bytes);IF EXISTS(SELECT FROM app.visible_run_profiles v WHERE (v.curriculum_version_id,v.node_key,v.definition_digest)=(NEW.curriculum_version_id,NEW.node_key,NEW.definition_digest) AND v.policy_digest<>NEW.policy_digest) THEN RAISE EXCEPTION 'Run policy must be shared by exam tasks'; END IF;IF NOT EXISTS(SELECT FROM app.checkpoint_definitions d CROSS JOIN LATERAL jsonb_array_elements(d.definition->'tasks') t WHERE d.curriculum_version_id=NEW.curriculum_version_id AND d.node_key=NEW.node_key AND d.definition_digest=NEW.definition_digest AND t->>'key'=NEW.task_key) THEN RAISE EXCEPTION 'Run profile scope unavailable'; END IF;RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'enabled') IS DISTINCT FROM(to_jsonb(OLD)-'enabled') THEN RAISE EXCEPTION 'Run profile bindings immutable'; END IF;
 IF OLD.enabled OR EXISTS(SELECT FROM app.visible_run_receipts r WHERE (r.curriculum_version_id,r.node_key,r.definition_digest,r.task_key)=(OLD.curriculum_version_id,OLD.node_key,OLD.definition_digest,OLD.task_key)) THEN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'enabled') IS DISTINCT FROM(to_jsonb(OLD)-'enabled') THEN RAISE EXCEPTION 'Used Run profile immutable'; END IF; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;PERFORM app.visible_run_policy(NEW.policy_bytes);RETURN NEW;
 END IF;
 IF TG_OP='DELETE' OR NEW.run_id IS DISTINCT FROM OLD.run_id THEN RAISE EXCEPTION 'Run outbox identity immutable'; END IF;
 IF OLD.state='terminal' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal Run immutable'; END IF;
 IF (OLD.state='queued' AND NEW.state NOT IN ('queued','claimed','terminal')) OR(OLD.state='claimed' AND NEW.state NOT IN ('claimed','running','recovery_required','terminal')) OR(OLD.state='running' AND NEW.state NOT IN ('running','recovery_required','terminal')) OR(OLD.state='recovery_required' AND NEW.state NOT IN ('recovery_required','terminal')) THEN RAISE EXCEPTION 'Invalid Run transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER visible_run_profile_guard BEFORE INSERT OR UPDATE OR DELETE ON app.visible_run_profiles FOR EACH ROW EXECUTE FUNCTION app.guard_visible_run_history();
CREATE TRIGGER visible_run_receipt_guard BEFORE UPDATE OR DELETE ON app.visible_run_receipts FOR EACH ROW EXECUTE FUNCTION app.guard_visible_run_history();
CREATE TRIGGER visible_run_source_guard BEFORE UPDATE ON app.visible_run_sources FOR EACH ROW EXECUTE FUNCTION app.guard_visible_run_history();
CREATE TRIGGER visible_run_output_guard BEFORE UPDATE ON app.visible_run_outputs FOR EACH ROW EXECUTE FUNCTION app.guard_visible_run_history();
CREATE TRIGGER visible_run_outbox_guard BEFORE UPDATE OR DELETE ON app.visible_run_outbox FOR EACH ROW EXECUTE FUNCTION app.guard_visible_run_history();

CREATE FUNCTION app.visible_run_context(auth_id uuid,attempt uuid,task text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;p app.visible_run_profiles;policy jsonb;u uuid;item jsonb;now_at timestamptz; BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;IF NOT FOUND THEN RAISE EXCEPTION 'Run forbidden' USING ERRCODE='42501'; END IF;
 u:=app.checkpoint_lock_access(auth_id,a.cohort_id);IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Run forbidden' USING ERRCODE='42501'; END IF;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;
 IF item IS NULL OR jsonb_array_length(item->'submissionRules'->'required_files')<>1 OR (item->'submissionRules'->'required_files'->>0) IS NULL OR item->'submissionRules'->'required_files'->>0 !~ '^[A-Za-z0-9_]+[.]go$' OR item->'submissionRules'->>'max_size_kb' IS NULL OR item->'submissionRules'->>'max_size_kb' !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='RV005'; END IF;
 SELECT * INTO p FROM app.visible_run_profiles WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=a.definition_digest AND task_key=task AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='RV005'; END IF;policy:=app.visible_run_policy(p.policy_bytes);now_at:=clock_timestamp();
 RETURN jsonb_build_object('editor',jsonb_build_object('scope',jsonb_build_object('learnerId',u,'cohortId',a.cohort_id,'attemptId',a.id,'taskKey',task,'definitionDigest',a.definition_digest),
 'readAllowed',now_at<a.deadline_at+make_interval(secs=>(policy->'storage'->>'readAfterDeadlineSeconds')::integer),'status',CASE WHEN a.status='active' THEN 'active' ELSE 'closed' END,'serverNow',now_at,'deadline',app.visible_run_deadline(a.deadline_at),'sourceBytes',least((policy->'limits'->>'sourceBytes')::integer,(item->'submissionRules'->>'max_size_kb')::integer*1024,262144),'filename',item->'submissionRules'->'required_files'->>0),
 'manifestBase64',encode(p.manifest_bytes,'base64'),'manifestDigest',p.manifest_digest,'policyBase64',encode(p.policy_bytes,'base64'),'policyDigest',p.policy_digest);
END $$;
CREATE FUNCTION app.visible_run_record(run uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('intent',jsonb_build_object('scope',jsonb_build_object('learnerId',r.user_id,'cohortId',r.cohort_id,'attemptId',r.attempt_id,'taskKey',r.task_key,'definitionDigest',r.definition_digest),
 'requestId',r.request_id,'filename',r.filename,'sourceBase64',encode(s.source_bytes,'base64'),'sourceDigest',r.source_digest,'byteLength',r.byte_length,'manifestDigest',r.manifest_digest,'policyDigest',r.policy_digest,'deadline',app.visible_run_deadline(r.deadline_at)),
 'intentDigest',r.intent_digest,'record',jsonb_build_object('id',r.id,'requestId',r.request_id,'sourceDigest',r.source_digest,'state',o.public_state,'outputBase64',CASE WHEN result.output_bytes IS NULL THEN NULL ELSE encode(result.output_bytes,'base64') END))
 FROM app.visible_run_receipts r JOIN app.visible_run_sources s ON s.run_id=r.id JOIN app.visible_run_outbox o ON o.run_id=r.id LEFT JOIN app.visible_run_outputs result ON result.run_id=r.id WHERE r.id=run
$$;
CREATE FUNCTION app.reserve_visible_run(auth_id uuid,attempt uuid,task text,definition text,request uuid,manifest_hash text,policy_hash text,source bytea,source_hash text,intent_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;p app.visible_run_profiles;old app.visible_run_receipts;ctx jsonb;policy jsonb;u uuid;at_time timestamptz;amount bigint;active_count bigint;total_bytes bigint;rid uuid:=gen_random_uuid();filename text;expected text; BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;IF NOT FOUND THEN RAISE EXCEPTION 'Run forbidden' USING ERRCODE='42501'; END IF;
 u:=app.checkpoint_user(auth_id,a.cohort_id);IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Run forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||u::text,4));PERFORM pg_advisory_xact_lock(hashtextextended(u::text,13));
 u:=app.checkpoint_lock_access(auth_id,a.cohort_id);SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 ctx:=app.visible_run_context(auth_id,attempt,task);IF definition IS DISTINCT FROM a.definition_digest THEN RAISE EXCEPTION 'Definition mismatch' USING ERRCODE='RV002'; END IF;
 SELECT * INTO p FROM app.visible_run_profiles WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=definition AND task_key=task AND enabled FOR SHARE;
 IF NOT FOUND OR manifest_hash IS DISTINCT FROM p.manifest_digest OR policy_hash IS DISTINCT FROM p.policy_digest THEN RAISE EXCEPTION 'Run profile unavailable' USING ERRCODE='RV005'; END IF;
 policy:=app.visible_run_policy(p.policy_bytes);filename:=ctx->'editor'->>'filename';
 IF request IS NULL OR source IS NULL OR octet_length(source) NOT BETWEEN 1 AND (ctx->'editor'->>'sourceBytes')::integer OR source_hash IS DISTINCT FROM encode(sha256(source),'hex') THEN RAISE EXCEPTION 'Invalid Run source' USING ERRCODE='22023'; END IF;
 expected:=app.checkpoint_digest(jsonb_build_array(u::text,a.cohort_id::text,a.id::text,task,definition,request::text,filename,source_hash,octet_length(source),manifest_hash,policy_hash,app.visible_run_deadline(a.deadline_at)),'nextera-visible-run-intent');
 IF intent_hash IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Run intent mismatch' USING ERRCODE='RV003'; END IF;
 SELECT * INTO old FROM app.visible_run_receipts WHERE user_id=u AND request_id=request;
 IF FOUND THEN
 IF old.intent_digest IS DISTINCT FROM expected OR NOT EXISTS(SELECT FROM app.visible_run_sources s WHERE s.run_id=old.id AND s.source_bytes=source) THEN RAISE EXCEPTION 'Run idempotency conflict' USING ERRCODE='RV003'; END IF;
 IF old.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Run receipt expired' USING ERRCODE='RV001'; END IF;RETURN app.visible_run_record(old.id); END IF;
 at_time:=clock_timestamp();IF a.status<>'active' OR at_time>=a.deadline_at THEN RAISE EXCEPTION 'Run intake closed' USING ERRCODE='RV001'; END IF;
 SELECT count(*) INTO amount FROM app.visible_run_receipts WHERE user_id=u AND accepted_at>at_time-make_interval(secs=>(policy->'limits'->>'windowMs')::double precision/1000);
 IF amount>=(policy->'limits'->>'requestsPerWindow')::integer THEN RAISE EXCEPTION 'Run rate limited' USING ERRCODE='RV004'; END IF;
 SELECT count(*) INTO active_count FROM app.visible_run_receipts r JOIN app.visible_run_outbox o ON o.run_id=r.id WHERE r.user_id=u AND r.attempt_id=attempt AND o.state<>'terminal';
 IF active_count>=(policy->'limits'->>'concurrency')::integer THEN RAISE EXCEPTION 'Run concurrency limited' USING ERRCODE='RV004'; END IF;
 SELECT count(*),coalesce(sum(byte_length),0) INTO amount,total_bytes FROM app.visible_run_receipts WHERE user_id=u AND attempt_id=attempt;
 IF amount>=(policy->'storage'->>'maxRunsPerAttempt')::integer OR total_bytes+octet_length(source)>(policy->'storage'->>'maxSourceBytesPerAttempt')::bigint THEN RAISE EXCEPTION 'Run storage capacity' USING ERRCODE='RV007'; END IF;
 INSERT INTO app.visible_run_receipts(id,attempt_id,cohort_id,user_id,curriculum_version_id,node_key,task_key,definition_digest,request_id,filename,source_digest,byte_length,manifest_digest,policy_digest,intent_digest,accepted_at,deadline_at,expires_at)
 VALUES(rid,a.id,a.cohort_id,u,a.curriculum_version_id,a.node_key,task,definition,request,filename,source_hash,octet_length(source),manifest_hash,policy_hash,expected,at_time,a.deadline_at,a.deadline_at+make_interval(secs=>(policy->'storage'->>'readAfterDeadlineSeconds')::integer));
 INSERT INTO app.visible_run_sources(run_id,source_bytes) VALUES(rid,source);INSERT INTO app.visible_run_outbox(run_id) VALUES(rid);RETURN app.visible_run_record(rid);
END $$;
CREATE FUNCTION app.read_visible_run(auth_id uuid,attempt uuid,task text,definition text,run uuid,request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;r app.visible_run_receipts;u uuid;BEGIN
 ctx:=app.visible_run_context(auth_id,attempt,task);u:=(ctx->'editor'->'scope'->>'learnerId')::uuid;
 IF ctx->'editor'->'scope'->>'definitionDigest' IS DISTINCT FROM definition THEN RAISE EXCEPTION 'Definition mismatch' USING ERRCODE='RV002'; END IF;
 IF (run IS NULL)=(request IS NULL) THEN RAISE EXCEPTION 'Invalid lookup' USING ERRCODE='22023'; END IF;
 IF NOT (ctx->'editor'->>'readAllowed')::boolean THEN RAISE EXCEPTION 'Run read forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM app.visible_run_receipts WHERE user_id=u AND ((run IS NOT NULL AND id=run) OR(request IS NOT NULL AND request_id=request));
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF r.attempt_id<>attempt OR r.task_key<>task OR r.definition_digest<>definition THEN RAISE EXCEPTION 'Run scope forbidden' USING ERRCODE='42501'; END IF;
 IF r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Run expired' USING ERRCODE='42501'; END IF;RETURN app.visible_run_record(r.id);
END $$;

-- Internal lifecycle lock preserves the reserve/finish learner-lock order. No lease timeout releases a claimed slot.
CREATE FUNCTION app.lock_visible_run(run uuid) RETURNS app.visible_run_receipts LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE r app.visible_run_receipts;BEGIN
 SELECT * INTO r FROM app.visible_run_receipts WHERE id=run;IF NOT FOUND THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='RV005'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.cohort_id::text||r.user_id::text,4));PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,13));PERFORM 1 FROM app.visible_run_outbox WHERE run_id=run FOR UPDATE;RETURN r;
END $$;
CREATE FUNCTION app.visible_run_principal(expected_kind text) RETURNS app.visible_run_principals LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE p app.visible_run_principals;BEGIN
 SELECT * INTO p FROM app.visible_run_principals WHERE principal=session_user AND kind=expected_kind AND enabled;
 IF NOT FOUND OR NOT pg_has_role(session_user,CASE WHEN expected_kind='worker' THEN 'nextera_visible_run_worker' ELSE 'nextera_visible_run_maintenance' END,'USAGE') THEN RAISE EXCEPTION 'Run principal forbidden' USING ERRCODE='42501'; END IF;RETURN p;
END $$;
CREATE FUNCTION app.claim_visible_run(run uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE worker app.visible_run_principals;r app.visible_run_receipts;o app.visible_run_outbox;a app.checkpoint_attempts;p app.visible_run_profiles;policy jsonb;auth_id uuid;allowed boolean:=true;at_time timestamptz;BEGIN
 worker:=app.visible_run_principal('worker');r:=app.lock_visible_run(run);SELECT * INTO o FROM app.visible_run_outbox WHERE run_id=run;
 IF o.state<>'queued' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=r.attempt_id;SELECT * INTO p FROM app.visible_run_profiles WHERE (curriculum_version_id,node_key,definition_digest,task_key)=(r.curriculum_version_id,r.node_key,r.definition_digest,r.task_key) FOR SHARE;
 policy:=app.visible_run_policy(p.policy_bytes);SELECT auth_user_id INTO auth_id FROM app.users WHERE id=r.user_id;
 BEGIN PERFORM app.checkpoint_lock_access(auth_id,r.cohort_id);EXCEPTION WHEN insufficient_privilege THEN allowed:=false;END;at_time:=clock_timestamp();
 IF NOT allowed OR NOT p.enabled OR a.status<>'active' OR at_time>=r.deadline_at THEN
 INSERT INTO app.visible_run_outputs(run_id,output_bytes) VALUES(run,''::bytea);UPDATE app.visible_run_outbox SET state='terminal',public_state='system_error',finished_at=at_time WHERE run_id=run;RETURN NULL;END IF;
 IF worker.image_digest IS DISTINCT FROM policy->'isolation'->>'imageDigest' THEN RAISE EXCEPTION 'Run runtime unavailable' USING ERRCODE='RV005'; END IF;
 UPDATE app.visible_run_outbox SET state='claimed',lease_generation=lease_generation+1,lease_token=gen_random_uuid(),principal=session_user,lease_expires_at=least(r.deadline_at,at_time+make_interval(secs=>(policy->'budgets'->>'leaseMs')::double precision/1000)) WHERE run_id=run RETURNING * INTO o;
 RETURN jsonb_build_object('run',app.visible_run_record(run),'manifestBase64',encode(p.manifest_bytes,'base64'),'policyBase64',encode(p.policy_bytes,'base64'),'leaseGeneration',o.lease_generation,'leaseToken',o.lease_token,'leaseExpiresAt',o.lease_expires_at);
END $$;
CREATE FUNCTION app.pulse_visible_run(run uuid,generation bigint,token uuid,start_execution boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.visible_run_receipts;o app.visible_run_outbox;a app.checkpoint_attempts;p app.visible_run_profiles;policy jsonb;at_time timestamptz;auth_id uuid;allowed boolean:=true;BEGIN
 PERFORM app.visible_run_principal('worker');r:=app.lock_visible_run(run);SELECT * INTO o FROM app.visible_run_outbox WHERE run_id=run;
 IF o.principal IS DISTINCT FROM session_user OR o.lease_generation IS DISTINCT FROM generation OR o.lease_token IS DISTINCT FROM token OR o.state NOT IN ('claimed','running','recovery_required') THEN RAISE EXCEPTION 'Stale Run lease' USING ERRCODE='RV006'; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=r.attempt_id;SELECT * INTO p FROM app.visible_run_profiles WHERE (curriculum_version_id,node_key,definition_digest,task_key)=(r.curriculum_version_id,r.node_key,r.definition_digest,r.task_key) FOR SHARE;
 policy:=app.visible_run_policy(p.policy_bytes);SELECT auth_user_id INTO auth_id FROM app.users WHERE id=r.user_id;BEGIN PERFORM app.checkpoint_lock_access(auth_id,r.cohort_id);EXCEPTION WHEN insufficient_privilege THEN allowed:=false;END;at_time:=clock_timestamp();
 IF o.state='recovery_required' OR NOT allowed OR NOT p.enabled OR a.status<>'active' OR at_time>=r.deadline_at OR at_time>=o.lease_expires_at THEN
 UPDATE app.visible_run_outbox SET state='recovery_required',public_state='running' WHERE run_id=run;RETURN jsonb_build_object('kind','stop_required');END IF;
 IF start_execution IS NULL THEN RAISE EXCEPTION 'Invalid pulse' USING ERRCODE='22023'; END IF;
 UPDATE app.visible_run_outbox SET state=CASE WHEN start_execution THEN 'running' ELSE state END,public_state=CASE WHEN start_execution THEN 'running' ELSE public_state END,lease_expires_at=least(r.deadline_at,at_time+make_interval(secs=>(policy->'budgets'->>'leaseMs')::double precision/1000)) WHERE run_id=run RETURNING * INTO o;
 RETURN jsonb_build_object('kind','authorized','state',o.state,'leaseExpiresAt',o.lease_expires_at);
END $$;
CREATE FUNCTION app.complete_visible_run(run uuid,generation bigint,token uuid,result_state text,output bytea,stopped_proof text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.visible_run_receipts;o app.visible_run_outbox;p app.visible_run_profiles;policy jsonb;at_time timestamptz;safe_output bytea;BEGIN
 PERFORM app.visible_run_principal('worker');r:=app.lock_visible_run(run);SELECT * INTO o FROM app.visible_run_outbox WHERE run_id=run;
 IF o.principal IS DISTINCT FROM session_user OR o.lease_generation IS DISTINCT FROM generation OR o.lease_token IS DISTINCT FROM token OR o.state='queued' THEN RAISE EXCEPTION 'Stale Run lease' USING ERRCODE='RV006'; END IF;
 SELECT * INTO p FROM app.visible_run_profiles WHERE (curriculum_version_id,node_key,definition_digest,task_key)=(r.curriculum_version_id,r.node_key,r.definition_digest,r.task_key) FOR SHARE;policy:=app.visible_run_policy(p.policy_bytes);
 IF stopped_proof IS NULL OR stopped_proof !~ '^[0-9a-f]{64}$' OR result_state IS NULL OR result_state NOT IN ('completed','compile_error','runtime_error','timeout','output_limit','system_error') OR output IS NULL OR octet_length(output)>(policy->'limits'->>'outputBytes')::integer THEN RAISE EXCEPTION 'Invalid Run completion' USING ERRCODE='22023'; END IF;
 IF o.state='claimed' AND result_state<>'system_error' THEN RAISE EXCEPTION 'Execution start not acknowledged' USING ERRCODE='RV006'; END IF;
 safe_output:=CASE WHEN result_state='system_error' THEN ''::bytea ELSE output END;
 IF o.state='terminal' THEN
 IF o.public_state IS DISTINCT FROM result_state OR NOT EXISTS(SELECT FROM app.visible_run_outputs WHERE run_id=run AND output_bytes=safe_output) OR o.stop_proof_digest IS DISTINCT FROM stopped_proof THEN RAISE EXCEPTION 'Completion conflict' USING ERRCODE='RV003'; END IF;RETURN app.visible_run_record(run);END IF;
 at_time:=clock_timestamp();INSERT INTO app.visible_run_outputs(run_id,output_bytes) VALUES(run,safe_output);UPDATE app.visible_run_outbox SET state='terminal',public_state=result_state,finished_at=at_time,stop_proof_digest=stopped_proof WHERE run_id=run;RETURN app.visible_run_record(run);
END $$;
CREATE FUNCTION app.reconcile_visible_run(run uuid,generation bigint,stopped_proof text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.visible_run_receipts;o app.visible_run_outbox;at_time timestamptz;BEGIN
 PERFORM app.visible_run_principal('maintenance');r:=app.lock_visible_run(run);SELECT * INTO o FROM app.visible_run_outbox WHERE run_id=run;at_time:=clock_timestamp();
 IF o.lease_generation IS DISTINCT FROM generation THEN RAISE EXCEPTION 'Stale Run lease' USING ERRCODE='RV006'; END IF;IF o.state='terminal' THEN RETURN false; END IF;
 IF o.state='queued' THEN IF at_time<r.deadline_at THEN RAISE EXCEPTION 'Run not expired' USING ERRCODE='RV001'; END IF;
 ELSE
 IF o.state<>'recovery_required' AND at_time<o.lease_expires_at THEN RAISE EXCEPTION 'Run lease active' USING ERRCODE='RV001'; END IF;
 IF stopped_proof IS NULL THEN UPDATE app.visible_run_outbox SET state='recovery_required',public_state='running' WHERE run_id=run;RETURN false;END IF;
 IF stopped_proof !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Trusted stop evidence required' USING ERRCODE='22023'; END IF;
 END IF;
 INSERT INTO app.visible_run_outputs(run_id,output_bytes) VALUES(run,''::bytea);UPDATE app.visible_run_outbox SET state='terminal',public_state='system_error',finished_at=at_time,stop_proof_digest=stopped_proof WHERE run_id=run;RETURN true;
END $$;
CREATE FUNCTION app.purge_visible_run_sources(cutoff timestamptz,batch integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE removed integer;BEGIN
 PERFORM app.visible_run_principal('maintenance');IF cutoff IS NULL OR batch IS NULL OR batch NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid Run purge batch' USING ERRCODE='22023'; END IF;
 WITH expired AS MATERIALIZED(SELECT r.id FROM app.visible_run_receipts r JOIN app.visible_run_outbox o ON o.run_id=r.id WHERE r.expires_at<=least(cutoff,clock_timestamp()) AND o.state='terminal' AND (EXISTS(SELECT FROM app.visible_run_sources s WHERE s.run_id=r.id) OR EXISTS(SELECT FROM app.visible_run_outputs v WHERE v.run_id=r.id)) ORDER BY r.expires_at LIMIT batch FOR UPDATE OF o SKIP LOCKED),
 sources AS(DELETE FROM app.visible_run_sources s USING expired e WHERE s.run_id=e.id RETURNING s.run_id),
 outputs AS(DELETE FROM app.visible_run_outputs v USING expired e WHERE v.run_id=e.id RETURNING v.run_id)
 SELECT count(*) INTO removed FROM(SELECT run_id FROM sources UNION SELECT run_id FROM outputs) done;RETURN removed;
END $$;

-- Discovery is a bounded hint only. Claim/start must acquire the normal fencing locks again.
CREATE FUNCTION app.list_queued_visible_runs(batch integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE worker app.visible_run_principals;result jsonb;BEGIN
 worker:=app.visible_run_principal('worker');IF batch IS NULL OR batch NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid queue batch' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(row_data),'[]'::jsonb) INTO result FROM(SELECT jsonb_build_object('runId',r.id,'scope',jsonb_build_object('learnerId',r.user_id,'cohortId',r.cohort_id,'attemptId',r.attempt_id,'taskKey',r.task_key,'definitionDigest',r.definition_digest),'generation',o.lease_generation,'state',o.state) row_data FROM app.visible_run_receipts r JOIN app.visible_run_outbox o ON o.run_id=r.id JOIN app.visible_run_profiles p ON(p.curriculum_version_id,p.node_key,p.definition_digest,p.task_key)=(r.curriculum_version_id,r.node_key,r.definition_digest,r.task_key) WHERE o.state='queued' AND p.enabled AND app.visible_run_policy(p.policy_bytes)->'isolation'->>'imageDigest'=worker.image_digest ORDER BY r.accepted_at,r.id LIMIT batch) q;RETURN result;
END $$;
CREATE FUNCTION app.list_recoverable_visible_runs(batch integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE result jsonb;BEGIN
 PERFORM app.visible_run_principal('maintenance');IF batch IS NULL OR batch NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid recovery batch' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(row_data),'[]'::jsonb) INTO result FROM(SELECT jsonb_build_object('runId',r.id,'scope',jsonb_build_object('learnerId',r.user_id,'cohortId',r.cohort_id,'attemptId',r.attempt_id,'taskKey',r.task_key,'definitionDigest',r.definition_digest),'generation',o.lease_generation,'state',o.state) row_data FROM app.visible_run_receipts r JOIN app.visible_run_outbox o ON o.run_id=r.id WHERE (o.state='queued' AND r.deadline_at<=clock_timestamp()) OR o.state='recovery_required' OR(o.state IN('claimed','running') AND o.lease_expires_at<=clock_timestamp()) ORDER BY r.accepted_at,r.id LIMIT batch) q;RETURN result;
END $$;

-- No role, membership, principal mapping, enabled profile, scheduler or runtime is provisioned.
GRANT CREATE ON SCHEMA app TO nextera_checkpoint_owner;
DO $$ DECLARE obj record;grantee record;BEGIN
 FOR obj IN SELECT c.oid,c.oid::regclass AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname IN ('visible_run_profiles','visible_run_receipts','visible_run_sources','visible_run_outputs','visible_run_outbox','visible_run_principals') LOOP
 EXECUTE format('ALTER TABLE %s OWNER TO nextera_checkpoint_owner',obj.name);EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',obj.name);EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC',obj.name);
 FOR grantee IN SELECT DISTINCT r.rolname FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=obj.oid AND r.rolname<>'nextera_checkpoint_owner' LOOP EXECUTE format('REVOKE ALL ON TABLE %s FROM %I',obj.name,grantee.rolname); END LOOP;END LOOP;
 FOR obj IN SELECT p.oid,p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('visible_run_blob_digest','visible_run_deadline','visible_run_policy','guard_visible_run_history','visible_run_context','visible_run_record','reserve_visible_run','read_visible_run','lock_visible_run','visible_run_principal','claim_visible_run','pulse_visible_run','complete_visible_run','reconcile_visible_run','purge_visible_run_sources','list_queued_visible_runs','list_recoverable_visible_runs') LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO nextera_checkpoint_owner',obj.name);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',obj.name);
 FOR grantee IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=obj.oid AND r.rolname<>'nextera_checkpoint_owner' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',obj.name,grantee.rolname);END LOOP;END LOOP;
END $$;
REVOKE CREATE ON SCHEMA app FROM nextera_checkpoint_owner;
GRANT EXECUTE ON FUNCTION app.visible_run_context(uuid,uuid,text),app.reserve_visible_run(uuid,uuid,text,text,uuid,text,text,bytea,text,text),app.read_visible_run(uuid,uuid,text,text,uuid,uuid) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.list_queued_visible_runs(integer),app.claim_visible_run(uuid),app.pulse_visible_run(uuid,bigint,uuid,boolean),app.complete_visible_run(uuid,bigint,uuid,text,bytea,text) TO nextera_visible_run_worker;
GRANT EXECUTE ON FUNCTION app.list_recoverable_visible_runs(integer),app.reconcile_visible_run(uuid,bigint,text),app.purge_visible_run_sources(timestamptz,integer) TO nextera_visible_run_maintenance;
COMMIT;
