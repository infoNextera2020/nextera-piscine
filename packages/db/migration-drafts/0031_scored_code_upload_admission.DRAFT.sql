-- SOURCE REVIEW DRAFT ONLY: unregistered, unapplied, no policy values seeded.
-- Marked Exam1 q1-q5 coding only. Requires reviewed0024-0026/0030.
-- Explicit resource policy: no numeric defaults and no inherited quota.
-- Unknown/orphan/pending uploads retain their durable reservation. No release,
-- refund, grade or score is inferred from infrastructure failure.
-- Every POST receipt/reserve/finalize freshly checks active access/deadline.
-- SQL does NOT independently prove blob presence/hash; authenticated server
-- readback plus Runner hashing protect acceptance/execution.
-- Preexisting unbounded LEGACY four-segment direct uploads remain OUTSIDE this
-- bounded new scored namespace. This is not global Storage budget protection.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'scored-code-upload-0031-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolcanlogin AND rolsuper)
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')
 OR NOT has_schema_privilege('nextera_checkpoint_owner','app','CREATE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner')
 OR to_regprocedure('app.scored_exam_intake_context(uuid,uuid,text)') IS NULL
 OR to_regclass('app.scored_exam_acceptance_intents') IS NULL
 OR to_regclass('app.exam_scoring_acceptances') IS NULL THEN
 RAISE EXCEPTION 'Reviewed fresh isolated scored upload prerequisites required';END IF;
END $$;
SET LOCAL ROLE nextera_checkpoint_owner;
CREATE TABLE app.scored_exam_code_upload_policies (
 curriculum_version_id uuid NOT NULL,node_key text NOT NULL,
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 enabled boolean NOT NULL DEFAULT false,policy jsonb NOT NULL,
 policy_digest text NOT NULL CHECK(policy_digest=app.checkpoint_digest(policy,'01coding-scored-code-upload-policy')),
 PRIMARY KEY(curriculum_version_id,node_key,definition_digest),
 CHECK(jsonb_typeof(policy)='object' AND policy->'version'='1'::jsonb
 AND policy ?& ARRAY['version','maxReservedObjects','maxReservedBytes','reservationWindowMs','maxReservationsPerWindow']
 AND policy-ARRAY['version','maxReservedObjects','maxReservedBytes','reservationWindowMs','maxReservationsPerWindow']='{}'::jsonb
 AND jsonb_typeof(policy->'maxReservedObjects')='number' AND policy->>'maxReservedObjects' ~ '^[1-9][0-9]*$' AND (policy->>'maxReservedObjects')::numeric<=2147483647
 AND jsonb_typeof(policy->'maxReservedBytes')='number' AND policy->>'maxReservedBytes' ~ '^[1-9][0-9]*$' AND (policy->>'maxReservedBytes')::numeric<=9007199254740991
 AND jsonb_typeof(policy->'reservationWindowMs')='number' AND policy->>'reservationWindowMs' ~ '^[1-9][0-9]*$' AND (policy->>'reservationWindowMs')::numeric<=2147483647
 AND jsonb_typeof(policy->'maxReservationsPerWindow')='number' AND policy->>'maxReservationsPerWindow' ~ '^[1-9][0-9]*$' AND (policy->>'maxReservationsPerWindow')::numeric<=2147483647)
);
CREATE TABLE app.scored_exam_code_upload_reservations (
 auth_user_id uuid NOT NULL,user_id uuid NOT NULL,cohort_id uuid NOT NULL,attempt_id uuid NOT NULL,
 curriculum_version_id uuid NOT NULL,node_key text NOT NULL,
 task_key text NOT NULL CHECK(task_key IN('q1','q2','q3','q4','q5')),request_id uuid NOT NULL,
 definition_digest text NOT NULL,snapshot_digest text NOT NULL,
 intake_policy_digest text NOT NULL CHECK(intake_policy_digest ~ '^[0-9a-f]{64}$'),
 upload_policy_digest text NOT NULL CHECK(upload_policy_digest ~ '^[0-9a-f]{64}$'),
 filename text NOT NULL CHECK(length(filename)<=100 AND filename ~ '^[A-Za-z0-9_][A-Za-z0-9_]*[.]go$'),
 byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 262144),
 answer_digest text NOT NULL CHECK(answer_digest ~ '^[0-9a-f]{64}$'),
 storage_key text NOT NULL UNIQUE,reserved_at timestamptz NOT NULL,
 PRIMARY KEY(cohort_id,user_id,request_id),
 FOREIGN KEY(curriculum_version_id,node_key,definition_digest) REFERENCES app.scored_exam_code_upload_policies(curriculum_version_id,node_key,definition_digest) ON DELETE RESTRICT,
 CHECK(storage_key=auth_user_id::text||'/'||cohort_id::text||'/scored-exam-v1/'||attempt_id::text||'/'||task_key||'/'||request_id::text||'/'||answer_digest)
);
CREATE FUNCTION app.guard_scored_exam_code_upload_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'Scored source resource reservations are immutable; reconciliation requires separate review';
END $$;
CREATE TRIGGER scored_code_upload_reservation_immutable BEFORE UPDATE OR DELETE ON app.scored_exam_code_upload_reservations FOR EACH ROW EXECUTE FUNCTION app.guard_scored_exam_code_upload_history();
CREATE FUNCTION app.guard_scored_exam_code_upload_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE used boolean;BEGIN
 SELECT EXISTS(SELECT FROM app.scored_exam_code_upload_reservations WHERE curriculum_version_id=OLD.curriculum_version_id AND node_key=OLD.node_key AND definition_digest=OLD.definition_digest) INTO used;
 IF TG_OP='DELETE' THEN IF OLD.enabled OR used THEN RAISE EXCEPTION 'Retained scored source policy';END IF;RETURN OLD;END IF;
 IF (OLD.enabled OR used) AND (to_jsonb(OLD)-'enabled') IS DISTINCT FROM (to_jsonb(NEW)-'enabled') THEN RAISE EXCEPTION 'Frozen scored source policy';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scored_code_upload_policy_immutable BEFORE UPDATE OR DELETE ON app.scored_exam_code_upload_policies FOR EACH ROW EXECUTE FUNCTION app.guard_scored_exam_code_upload_policy();

-- Internal exact identity predicate; never accepts caller roles or object keys.
CREATE FUNCTION app.scored_exam_code_reservation_matches(r app.scored_exam_code_upload_reservations,a app.checkpoint_attempts,ctx jsonb,auth_id uuid,task text,request uuid,filename text,bytes integer,content_hash text,moment timestamptz) RETURNS boolean
LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT coalesce(r.request_id=request AND r.auth_user_id=auth_id AND r.user_id=a.user_id AND r.cohort_id=a.cohort_id
 AND r.attempt_id=a.id AND r.curriculum_version_id=a.curriculum_version_id AND r.node_key=a.node_key AND r.task_key=task
 AND r.definition_digest=a.definition_digest AND r.snapshot_digest=a.snapshot_digest AND r.intake_policy_digest=ctx->>'policyDigest'
 AND r.filename=filename AND r.byte_length=bytes AND r.answer_digest=content_hash
 AND r.storage_key=auth_id::text||'/'||a.cohort_id::text||'/scored-exam-v1/'||a.id::text||'/'||task||'/'||request::text||'/'||content_hash
 AND r.reserved_at>=a.started_at AND r.reserved_at<=moment,false)
$$;

-- Exact accepted receipt lookup: no write/upload, including when allowance is full.
CREATE FUNCTION app.scored_exam_code_receipt(auth_id uuid,attempt uuid,task text,request uuid,filename text,bytes integer,content_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;a app.checkpoint_attempts;i app.scored_exam_acceptance_intents;c app.exam_scoring_acceptances;
 art app.submission_artifacts;s app.submissions;j judge.jobs;r app.scored_exam_code_upload_reservations;
 moment timestamptz;expected_key text;
BEGIN
 ctx:=app.scored_exam_intake_context(auth_id,attempt,task);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR SHARE;
 IF request IS NULL OR filename IS NULL OR filename IS DISTINCT FROM ctx->>'filename' OR bytes IS NULL OR bytes<1 OR bytes>(ctx->>'maxCodeBytes')::integer OR content_hash IS NULL OR content_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('kind','invalid_input');END IF;
 moment:=clock_timestamp();
 IF moment<a.started_at THEN RETURN jsonb_build_object('kind','unavailable');END IF;
 IF a.status<>'active' OR moment>=a.deadline_at THEN RETURN jsonb_build_object('kind','closed');END IF;
 SELECT * INTO i FROM app.scored_exam_acceptance_intents WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND request_id=request;
 IF NOT FOUND THEN
 IF EXISTS(SELECT FROM app.submissions WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND idempotency_key=request::text) THEN RETURN jsonb_build_object('kind','conflict');END IF;
 RETURN jsonb_build_object('kind','absent');END IF;
 IF i.auth_user_id IS DISTINCT FROM auth_id OR i.attempt_id IS DISTINCT FROM attempt OR i.task_key IS DISTINCT FROM task OR i.filename IS DISTINCT FROM filename OR i.byte_length IS DISTINCT FROM bytes OR i.answer_digest IS DISTINCT FROM content_hash OR i.policy_digest IS DISTINCT FROM ctx->>'policyDigest' OR i.curriculum_version_id IS DISTINCT FROM a.curriculum_version_id OR i.node_key IS DISTINCT FROM a.node_key OR i.definition_digest IS DISTINCT FROM a.definition_digest OR i.snapshot_digest IS DISTINCT FROM a.snapshot_digest THEN RETURN jsonb_build_object('kind','conflict');END IF;
 SELECT * INTO c FROM app.exam_scoring_acceptances WHERE submission_id=i.submission_id;
 SELECT * INTO s FROM app.submissions WHERE id=i.submission_id;
 SELECT * INTO art FROM app.submission_artifacts WHERE id=i.artifact_id;
 SELECT * INTO j FROM judge.jobs WHERE id=i.job_id;
 -- Original four-segment receipts remain readable without new reservations.
 expected_key:=auth_id::text||'/'||a.cohort_id::text||'/'||request::text||'/'||content_hash;
 IF art.storage_key IS DISTINCT FROM expected_key THEN
 SELECT * INTO r FROM app.scored_exam_code_upload_reservations WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND request_id=request;
 IF NOT app.scored_exam_code_reservation_matches(r,a,ctx,auth_id,task,request,filename,bytes,content_hash,i.accepted_at)
 OR NOT EXISTS(SELECT FROM app.scored_exam_code_upload_policies p WHERE p.curriculum_version_id=r.curriculum_version_id AND p.node_key=r.node_key AND p.definition_digest=r.definition_digest AND p.policy_digest=r.upload_policy_digest) THEN RETURN jsonb_build_object('kind','unavailable');END IF;
 expected_key:=r.storage_key;END IF;
 IF i.accepted_at<a.started_at OR i.accepted_at>=a.deadline_at OR i.accepted_at>moment
 OR c.submission_id IS NULL OR c.attempt_id IS DISTINCT FROM attempt OR c.question_key IS DISTINCT FROM task OR c.answer_kind IS DISTINCT FROM 'coding' OR c.source_kind IS DISTINCT FROM 'coding'
 OR c.answer_digest IS DISTINCT FROM content_hash OR c.snapshot_digest IS DISTINCT FROM a.snapshot_digest OR c.accepted_at IS DISTINCT FROM i.accepted_at
 OR s.id IS NULL OR s.active_judge_job_id IS DISTINCT FROM i.job_id OR s.artifact_id IS DISTINCT FROM i.artifact_id OR s.checkpoint_attempt_id IS DISTINCT FROM attempt OR s.checkpoint_task_key IS DISTINCT FROM task
 OR s.cohort_id IS DISTINCT FROM a.cohort_id OR s.user_id IS DISTINCT FROM a.user_id OR s.curriculum_version_id IS DISTINCT FROM a.curriculum_version_id OR s.node_key IS DISTINCT FROM a.node_key OR s.idempotency_key IS DISTINCT FROM request::text OR s.created_at IS DISTINCT FROM i.accepted_at
 OR art.id IS NULL OR art.owner_user_id IS DISTINCT FROM a.user_id OR art.storage_bucket IS DISTINCT FROM 'nextera-submissions' OR art.storage_key IS DISTINCT FROM expected_key OR art.original_filename IS DISTINCT FROM filename OR art.size_bytes IS DISTINCT FROM bytes OR art.sha256 IS DISTINCT FROM content_hash
 OR j.id IS NULL OR j.submission_id IS DISTINCT FROM s.id OR j.evaluation_digest IS DISTINCT FROM app.checkpoint_digest(j.evaluation_snapshot,'nextera-evaluation-snapshot')
 OR j.evaluation_snapshot->'artifact' IS DISTINCT FROM jsonb_build_object('id',art.id,'bucket',art.storage_bucket,'key',art.storage_key,'filename',filename,'size_bytes',bytes,'sha256',content_hash) THEN RETURN jsonb_build_object('kind','unavailable');END IF;
 RETURN jsonb_build_object('kind','accepted','attemptId',attempt,'taskKey',task,'definitionDigest',a.definition_digest,'snapshotDigest',a.snapshot_digest,'submissionId',i.submission_id,'jobId',i.job_id,'artifactId',i.artifact_id,'requestId',request,'answerSha256',content_hash,'byteLength',bytes,'filename',filename,'acceptedOrdinal',c.accepted_ordinal::text,'replayed',true);
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('kind','forbidden');WHEN SQLSTATE 'PS005' THEN RETURN jsonb_build_object('kind','unavailable');
END $$;

CREATE FUNCTION app.scored_exam_code_upload_ready() RETURNS boolean
LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT to_regclass('storage.objects') IS NOT NULL
 AND EXISTS(SELECT FROM pg_trigger WHERE tgrelid='app.submissions'::regclass AND tgname='scored_exam_code_upload_required' AND tgenabled='O' AND NOT tgisinternal)
 AND (SELECT count(*) FROM pg_policy WHERE polrelid=to_regclass('storage.objects') AND polname IN('nextera_source_insert_scope','nextera_scored_code_upload_insert','nextera_scored_code_upload_scope'))=3
$$;

CREATE FUNCTION app.reserve_scored_exam_code_upload(auth_id uuid,attempt uuid,task text,request uuid,filename text,bytes integer,content_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;receipt jsonb;a app.checkpoint_attempts;r app.scored_exam_code_upload_reservations;
 p app.scored_exam_code_upload_policies;used bigint;pending bigint;objects bigint;total_bytes numeric;recent bigint;
 moment timestamptz;window_start timestamptz;key text;resumed boolean:=false;
BEGIN
 receipt:=app.scored_exam_code_receipt(auth_id,attempt,task,request,filename,bytes,content_hash);
 IF receipt->>'kind'<>'absent' THEN RETURN receipt;END IF;
 ctx:=app.scored_exam_intake_context(auth_id,attempt,task);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 moment:=clock_timestamp();
 IF moment<a.started_at THEN RETURN jsonb_build_object('kind','unavailable');END IF;
 IF a.status<>'active' OR moment>=a.deadline_at THEN RETURN jsonb_build_object('kind','closed');END IF;
 IF NOT app.scored_exam_code_upload_ready() THEN RETURN jsonb_build_object('kind','unavailable');END IF;
 SELECT * INTO p FROM app.scored_exam_code_upload_policies WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=a.definition_digest AND enabled FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','unavailable');END IF;
 key:=auth_id::text||'/'||a.cohort_id::text||'/scored-exam-v1/'||attempt::text||'/'||task||'/'||request::text||'/'||content_hash;
 SELECT * INTO r FROM app.scored_exam_code_upload_reservations WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND request_id=request;
 IF FOUND THEN
 IF NOT app.scored_exam_code_reservation_matches(r,a,ctx,auth_id,task,request,filename,bytes,content_hash,moment) OR r.upload_policy_digest IS DISTINCT FROM p.policy_digest THEN RETURN jsonb_build_object('kind','conflict');END IF;
 resumed:=true;
 ELSE
 SELECT count(*) INTO used FROM app.scored_exam_acceptance_intents WHERE attempt_id=attempt AND task_key=task;
 SELECT count(*) INTO pending FROM app.scored_exam_code_upload_reservations x WHERE x.attempt_id=attempt AND x.task_key=task
 AND NOT EXISTS(SELECT FROM app.scored_exam_acceptance_intents i WHERE i.cohort_id=x.cohort_id AND i.user_id=x.user_id AND i.request_id=x.request_id);
 IF used>=(ctx->'policy'->>'gradedAcceptanceAllowance')::integer THEN RETURN jsonb_build_object('kind','allowance_exhausted');END IF;
 -- Pending capacity is infrastructure/resource availability, never a grade.
 IF used+pending>=(ctx->'policy'->>'gradedAcceptanceAllowance')::integer THEN RETURN jsonb_build_object('kind','resource_unavailable');END IF;
 IF NOT (ctx->>'canSubmit')::boolean THEN RETURN jsonb_build_object('kind','rate_limited');END IF;
 window_start:=to_timestamp(floor(extract(epoch FROM moment)*1000/(p.policy->>'reservationWindowMs')::integer)*(p.policy->>'reservationWindowMs')::integer/1000);
 SELECT count(*),coalesce(sum(byte_length),0),count(*) FILTER(WHERE reserved_at>=window_start)
 INTO objects,total_bytes,recent FROM app.scored_exam_code_upload_reservations WHERE attempt_id=attempt;
 IF objects>=(p.policy->>'maxReservedObjects')::integer OR total_bytes+bytes>(p.policy->>'maxReservedBytes')::numeric OR recent>=(p.policy->>'maxReservationsPerWindow')::integer THEN RETURN jsonb_build_object('kind','resource_unavailable');END IF;
 INSERT INTO app.scored_exam_code_upload_reservations VALUES(auth_id,a.user_id,a.cohort_id,a.id,a.curriculum_version_id,a.node_key,task,request,a.definition_digest,a.snapshot_digest,ctx->>'policyDigest',p.policy_digest,filename,bytes,content_hash,key,moment) RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('kind','reserved','authUserId',auth_id,'learnerId',a.user_id,'cohortId',a.cohort_id,'attemptId',attempt,'taskKey',task,'requestId',request,'definitionDigest',a.definition_digest,'snapshotDigest',a.snapshot_digest,'filename',filename,'byteLength',bytes,'answerSha256',content_hash,'intakePolicyDigest',r.intake_policy_digest,'uploadPolicyDigest',r.upload_policy_digest,'bucket','nextera-submissions','objectKey',r.storage_key,'reservedAt',r.reserved_at,'serverNow',moment,'deadline',a.deadline_at,'resumed',resumed);
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('kind','forbidden');WHEN SQLSTATE 'PS005' THEN RETURN jsonb_build_object('kind','unavailable');
END $$;

-- Native system metadata.size is required. No user x-metadata byte proof.
-- Actual Supabase metadata/privilege behavior remains UNTESTED before activation.
CREATE FUNCTION app.scored_exam_code_upload_allowed(bucket text,object_key text,object_metadata jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.scored_exam_code_upload_reservations;a app.checkpoint_attempts;p app.scored_exam_code_upload_policies;ctx jsonb;moment timestamptz;auth_id uuid;
BEGIN
 IF bucket IS DISTINCT FROM 'nextera-submissions' OR object_key IS NULL
 OR object_key !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/scored-exam-v1/[0-9a-f-]{36}/q[1-5]/[0-9a-f-]{36}/[0-9a-f]{64}$'
 OR auth.uid() IS NULL OR auth.jwt()->>'nextera_artifact_reader'='true'
 OR jsonb_typeof(object_metadata->'size') IS DISTINCT FROM 'number'
 OR object_metadata->>'size' !~ '^[1-9][0-9]*$' THEN RETURN false;END IF;
 auth_id:=auth.uid();
 SELECT * INTO r FROM app.scored_exam_code_upload_reservations WHERE storage_key=object_key AND auth_user_id=auth_id;
 IF NOT FOUND OR (object_metadata->>'size')::numeric<>r.byte_length THEN RETURN false;END IF;
 ctx:=app.scored_exam_intake_context(auth_id,r.attempt_id,r.task_key);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=r.attempt_id FOR SHARE;
 SELECT * INTO p FROM app.scored_exam_code_upload_policies WHERE curriculum_version_id=r.curriculum_version_id AND node_key=r.node_key AND definition_digest=r.definition_digest AND enabled FOR SHARE;
 moment:=clock_timestamp();
 RETURN coalesce(p.policy_digest=r.upload_policy_digest
 AND app.scored_exam_code_reservation_matches(r,a,ctx,auth_id,r.task_key,r.request_id,r.filename,r.byte_length,r.answer_digest,moment)
 AND r.filename=ctx->>'filename' AND r.byte_length<=(ctx->>'maxCodeBytes')::integer AND a.status='active' AND moment<a.deadline_at,false);
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION app.guard_scored_exam_code_upload_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;r app.scored_exam_code_upload_reservations;i app.scored_exam_acceptance_intents;art app.submission_artifacts;BEGIN
 IF NEW.checkpoint_attempt_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=NEW.checkpoint_attempt_id FOR UPDATE;
 IF NOT (a.snapshot->'definition' ? 'examScoring') THEN RETURN NEW;END IF;
 SELECT * INTO r FROM app.scored_exam_code_upload_reservations WHERE cohort_id=NEW.cohort_id AND user_id=NEW.user_id AND request_id::text=NEW.idempotency_key;
 SELECT * INTO i FROM app.scored_exam_acceptance_intents WHERE submission_id=NEW.id;
 SELECT * INTO art FROM app.submission_artifacts WHERE id=NEW.artifact_id;
 IF r.request_id IS NULL OR i.submission_id IS NULL OR art.id IS NULL
 OR NOT app.scored_exam_code_reservation_matches(r,a,jsonb_build_object('policyDigest',i.policy_digest),i.auth_user_id,NEW.checkpoint_task_key,r.request_id,art.original_filename,art.size_bytes::integer,art.sha256,NEW.created_at)
 OR r.curriculum_version_id IS DISTINCT FROM NEW.curriculum_version_id OR r.node_key IS DISTINCT FROM NEW.node_key
 OR art.storage_bucket IS DISTINCT FROM 'nextera-submissions' OR art.storage_key IS DISTINCT FROM r.storage_key
 OR a.status<>'active' OR clock_timestamp()>=a.deadline_at OR NEW.created_at>=a.deadline_at
 OR NOT EXISTS(SELECT FROM app.scored_exam_code_upload_policies p WHERE p.curriculum_version_id=r.curriculum_version_id AND p.node_key=r.node_key AND p.definition_digest=r.definition_digest AND p.policy_digest=r.upload_policy_digest AND p.enabled) THEN
 RAISE EXCEPTION 'Bounded scored upload reservation required; old acceptance cannot bypass admission' USING ERRCODE='PS005';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION app.accept_scored_exam_code_upload(auth_id uuid,attempt uuid,task text,request uuid,filename text,bytes integer,content_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;ctx jsonb;receipt jsonb;item jsonb;spec jsonb;r app.scored_exam_code_upload_reservations;
 art app.submission_artifacts;capture app.exam_scoring_acceptances;sid uuid:=gen_random_uuid();jid uuid:=gen_random_uuid();
 ordinal bigint;at_time timestamptz;snap jsonb;v app.curriculum_versions;used bigint;recent bigint;window_start timestamptz;
BEGIN
 receipt:=app.scored_exam_code_receipt(auth_id,attempt,task,request,filename,bytes,content_hash);
 IF receipt->>'kind'<>'absent' THEN RETURN receipt;END IF;
 ctx:=app.scored_exam_intake_context(auth_id,attempt,task);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 at_time:=clock_timestamp();IF at_time<a.started_at THEN RETURN jsonb_build_object('kind','unavailable');END IF;
 IF a.status<>'active' OR at_time>=a.deadline_at THEN RETURN jsonb_build_object('kind','closed');END IF;
 IF NOT app.scored_exam_code_upload_ready() THEN RETURN jsonb_build_object('kind','unavailable');END IF;
 SELECT * INTO r FROM app.scored_exam_code_upload_reservations WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND request_id=request;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','unavailable');END IF;
 IF NOT app.scored_exam_code_reservation_matches(r,a,ctx,auth_id,task,request,filename,bytes,content_hash,at_time) THEN RETURN jsonb_build_object('kind','conflict');END IF;
 IF NOT EXISTS(SELECT FROM app.scored_exam_code_upload_policies p WHERE p.curriculum_version_id=r.curriculum_version_id AND p.node_key=r.node_key AND p.definition_digest=r.definition_digest AND p.policy_digest=r.upload_policy_digest AND p.enabled FOR SHARE) THEN RETURN jsonb_build_object('kind','unavailable');END IF;
 window_start:=to_timestamp(floor(extract(epoch FROM at_time)*1000/(ctx->'policy'->>'rateWindowMs')::integer)*(ctx->'policy'->>'rateWindowMs')::integer/1000);
 SELECT count(*),count(*) FILTER(WHERE accepted_at>=window_start) INTO used,recent FROM app.scored_exam_acceptance_intents WHERE attempt_id=attempt AND task_key=task;
 IF used>=(ctx->'policy'->>'gradedAcceptanceAllowance')::integer THEN RETURN jsonb_build_object('kind','allowance_exhausted');END IF;
 IF recent>=(ctx->'policy'->>'maxAcceptancesPerWindow')::integer THEN RETURN jsonb_build_object('kind','rate_limited');END IF;
 -- Trust boundary unchanged: web authenticated byte readback, no SQL blob proof.
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;spec:=item->'evaluationSpec';
 SELECT * INTO v FROM app.curriculum_versions WHERE id=a.curriculum_version_id;
 INSERT INTO app.submission_artifacts(owner_user_id,storage_bucket,storage_key,original_filename,size_bytes,sha256) VALUES(a.user_id,'nextera-submissions',r.storage_key,filename,bytes,content_hash) RETURNING * INTO art;
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
 -- Acceptance inserts roll back together; the durable upload reservation is retained.
END $$;

ALTER TABLE app.scored_exam_code_upload_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.scored_exam_code_upload_reservations ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE o record;g record;BEGIN
 FOR o IN SELECT c.oid,c.oid::regclass AS name,c.relowner AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname IN('scored_exam_code_upload_policies','scored_exam_code_upload_reservations') LOOP
 FOR g IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS recipient FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=o.oid AND a.grantee<>o.owner LOOP EXECUTE format('REVOKE ALL ON TABLE %s FROM %s',o.name,g.recipient);END LOOP;END LOOP;
 FOR o IN SELECT p.oid,p.oid::regprocedure AS name,p.proowner AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN('guard_scored_exam_code_upload_history','guard_scored_exam_code_upload_policy','scored_exam_code_reservation_matches','scored_exam_code_receipt','scored_exam_code_upload_ready','reserve_scored_exam_code_upload','scored_exam_code_upload_allowed','guard_scored_exam_code_upload_submission','accept_scored_exam_code_upload') LOOP
 FOR g IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS recipient FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=o.oid AND a.grantee<>o.owner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',o.name,g.recipient);END LOOP;END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.scored_exam_code_receipt(uuid,uuid,text,uuid,text,integer,text),app.reserve_scored_exam_code_upload(uuid,uuid,text,uuid,text,integer,text),app.accept_scored_exam_code_upload(uuid,uuid,text,uuid,text,integer,text) TO nextera_web;
RESET ROLE;
-- Existing isolated bootstrap DBA installs external FKs/trigger and scoped repair.
ALTER TABLE app.scored_exam_code_upload_policies ADD CONSTRAINT scored_code_upload_definition_fk FOREIGN KEY(curriculum_version_id,node_key) REFERENCES app.checkpoint_definitions(curriculum_version_id,node_key) ON DELETE RESTRICT;
ALTER TABLE app.scored_exam_code_upload_reservations ADD CONSTRAINT scored_code_upload_attempt_fk FOREIGN KEY(attempt_id,cohort_id,user_id,curriculum_version_id,node_key) REFERENCES app.checkpoint_attempts(id,cohort_id,user_id,curriculum_version_id,node_key) ON DELETE RESTRICT;
CREATE TRIGGER scored_exam_code_upload_required BEFORE INSERT ON app.submissions FOR EACH ROW EXECUTE FUNCTION app.guard_scored_exam_code_upload_submission();
DO $$ BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
 -- No new auth privileges are invented: absent preheld API authority is a blocker.
 IF NOT has_schema_privilege('nextera_checkpoint_owner','auth','USAGE')
 OR NOT has_function_privilege('nextera_checkpoint_owner','auth.uid()','EXECUTE')
 OR NOT has_function_privilege('nextera_checkpoint_owner','auth.jwt()','EXECUTE')
 OR NOT EXISTS(SELECT FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='nextera_source_insert_scope' AND NOT polpermissive AND polcmd='a') THEN
 RAISE EXCEPTION 'Preheld auth API privileges and registered source INSERT scope required';END IF;
 -- Only a boolean identity/resource predicate, never a Storage proof reader.
 GRANT EXECUTE ON FUNCTION app.scored_exam_code_upload_allowed(text,text,jsonb) TO authenticated;
 -- Preserve the exact original0004 four-segment legacy branch.
 EXECUTE $policy$ALTER POLICY nextera_source_insert_scope ON storage.objects
 WITH CHECK (bucket_id<>'nextera-submissions' OR (
   (storage.foldername(name))[1]=(SELECT auth.uid())::text
   AND (SELECT auth.jwt())->>'nextera_artifact_reader' IS DISTINCT FROM 'true'
   AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}$')
   OR app.scored_exam_code_upload_allowed(bucket_id,name,metadata))$policy$;
 EXECUTE $policy$CREATE POLICY nextera_scored_code_upload_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(app.scored_exam_code_upload_allowed(bucket_id,name,metadata))$policy$;
 EXECUTE $policy$CREATE POLICY nextera_scored_code_upload_scope ON storage.objects AS RESTRICTIVE FOR INSERT TO PUBLIC
 WITH CHECK(bucket_id<>'nextera-submissions' OR name !~ '^[^/]+/[^/]+/scored-exam-v1/' OR app.scored_exam_code_upload_allowed(bucket_id,name,metadata))$policy$;
 END IF;
END $$;
DO $private_source_audit$ BEGIN
 IF EXISTS(SELECT FROM (VALUES('scored_exam_code_upload_policies'),('scored_exam_code_upload_reservations')) expected(name)
 WHERE NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles o ON o.oid=c.relowner
 WHERE n.nspname='app' AND c.relname=expected.name AND c.relrowsecurity AND o.rolname='nextera_checkpoint_owner'
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee<>c.relowner))) THEN
 RAISE EXCEPTION 'Scored source table owner/RLS/private ACL readback failed';END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='app.submissions'::regclass AND tgname='scored_exam_code_upload_required'
 AND tgfoid='app.guard_scored_exam_code_upload_submission()'::regprocedure AND tgenabled='O' AND NOT tgisinternal) THEN
 RAISE EXCEPTION 'Scored source insertion guard readback failed';END IF;
END $private_source_audit$;
-- No bucket creation, seeds, role/credential provisioning, blob read grants or cleanup.
COMMIT;
