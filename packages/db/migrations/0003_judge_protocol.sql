-- Reviewed ADR-008 protocol. No progression writes or result application.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['nextera_judge_owner','nextera_runner','nextera_judge_maintenance'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',r);
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname=r AND
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
      OR EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.member WHERE p.rolname=r) THEN
      RAISE EXCEPTION 'Protocol permission roles must be unprivileged NOLOGIN roles';
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app,judge TO nextera_judge_owner;
GRANT USAGE ON SCHEMA judge TO nextera_runner,nextera_judge_maintenance;
GRANT SELECT ON app.users,app.cohorts,app.cohort_memberships,app.curriculum_versions,
  app.curriculum_nodes,app.learner_node_progress TO nextera_judge_owner;
GRANT SELECT,INSERT ON app.submission_artifacts,app.state_events,judge.results TO nextera_judge_owner;
GRANT SELECT,INSERT,UPDATE ON app.submissions,judge.jobs,judge.attempts TO nextera_judge_owner;
GRANT SELECT ON judge.workers TO nextera_judge_owner;
GRANT UPDATE(last_heartbeat_at) ON judge.workers TO nextera_judge_owner;
-- PostgreSQL row locking requires an UPDATE privilege, even for FOR SHARE.
-- These columns are never updated by the intake functions.
GRANT UPDATE(id) ON app.users,app.cohorts TO nextera_judge_owner;
GRANT UPDATE(joined_at) ON app.cohort_memberships TO nextera_judge_owner;
--> statement-breakpoint
CREATE FUNCTION judge.canonical_json(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT
SET search_path=pg_catalog AS $$
 SELECT CASE jsonb_typeof(v)
 WHEN 'object' THEN '{'||coalesce((SELECT string_agg(to_jsonb(key)::text||':'||judge.canonical_json(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(v)),'')||'}'
 WHEN 'array' THEN '['||coalesce((SELECT string_agg(judge.canonical_json(value),',' ORDER BY ord) FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ord)),'')||']'
 ELSE v::text END
$$;
CREATE FUNCTION judge.snapshot_digest(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT
SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to('nextera-evaluation-snapshot','UTF8')||decode('00','hex')||convert_to('v1','UTF8')||decode('00','hex')||convert_to(judge.canonical_json(v),'UTF8')),'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION judge.guard_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME IN ('submission_artifacts','state_events','activity_events') OR TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Assessment history is immutable';
  END IF;
  IF TG_TABLE_NAME='submissions' AND
    (to_jsonb(OLD)-ARRAY['state','started_at','finished_at']) IS DISTINCT FROM
    (to_jsonb(NEW)-ARRAY['state','started_at','finished_at']) THEN
    RAISE EXCEPTION 'Submission identity is immutable';
  ELSIF TG_TABLE_NAME='jobs' AND
    (to_jsonb(OLD)-ARRAY['state','available_at','retry_count','lease_generation','lease_token','lease_expires_at','current_worker_id','current_attempt_id','terminal_result_id','finished_at']) IS DISTINCT FROM
    (to_jsonb(NEW)-ARRAY['state','available_at','retry_count','lease_generation','lease_token','lease_expires_at','current_worker_id','current_attempt_id','terminal_result_id','finished_at']) THEN
    RAISE EXCEPTION 'Evaluation snapshot is immutable';
  ELSIF TG_TABLE_NAME='results' AND
    (to_jsonb(OLD)-ARRAY['application_status','processed_at','application_reason']) IS DISTINCT FROM
    (to_jsonb(NEW)-ARRAY['application_status','processed_at','application_reason']) THEN
    RAISE EXCEPTION 'Result payload is immutable';
  ELSIF TG_TABLE_NAME='attempts' AND
    (to_jsonb(OLD)-ARRAY['state','started_at','finished_at','infrastructure_error_code']) IS DISTINCT FROM
    (to_jsonb(NEW)-ARRAY['state','started_at','finished_at','infrastructure_error_code']) THEN
    RAISE EXCEPTION 'Attempt identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artifact_immutable BEFORE UPDATE OR DELETE ON app.submission_artifacts FOR EACH ROW EXECUTE FUNCTION judge.guard_history();
CREATE TRIGGER submission_identity BEFORE UPDATE OR DELETE ON app.submissions FOR EACH ROW EXECUTE FUNCTION judge.guard_history();
CREATE TRIGGER job_identity BEFORE UPDATE OR DELETE ON judge.jobs FOR EACH ROW EXECUTE FUNCTION judge.guard_history();
CREATE TRIGGER attempt_identity BEFORE UPDATE OR DELETE ON judge.attempts FOR EACH ROW EXECUTE FUNCTION judge.guard_history();
CREATE TRIGGER result_identity BEFORE UPDATE OR DELETE ON judge.results FOR EACH ROW EXECUTE FUNCTION judge.guard_history();
CREATE TRIGGER state_history BEFORE UPDATE OR DELETE ON app.state_events FOR EACH ROW EXECUTE FUNCTION judge.guard_history();
CREATE TRIGGER activity_history BEFORE UPDATE OR DELETE ON app.activity_events FOR EACH ROW EXECUTE FUNCTION judge.guard_history();
--> statement-breakpoint
CREATE FUNCTION judge.safe_feedback(v text) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('verdict',v,'message',CASE v
 WHEN 'passed' THEN 'All required checks passed.'
 WHEN 'failed' THEN 'Required checks did not pass.'
 WHEN 'compile_error' THEN 'The solution could not be compiled within the required profile.'
 WHEN 'runtime_error' THEN 'The solution could not complete within the required profile.'
 WHEN 'timeout' THEN 'The solution exceeded the execution time limit.'
 WHEN 'system_error' THEN 'Evaluation infrastructure could not verify or complete this attempt.' END)
$$;
CREATE FUNCTION judge.worker_identity() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE w uuid;
BEGIN
 SELECT id INTO w FROM judge.workers WHERE db_principal=session_user AND enabled;
 IF w IS NULL THEN RAISE EXCEPTION 'WORKER_UNAUTHORIZED' USING ERRCODE='42501'; END IF;
 RETURN w;
END $$;
CREATE FUNCTION judge.audit(s uuid,j uuid,a uuid,r uuid,e text,prev text,nxt text,actor uuid,reason text) RETURNS void
LANGUAGE sql SET search_path=pg_catalog AS $$
 INSERT INTO app.state_events(submission_id,job_id,attempt_id,result_id,entity_type,previous_state,next_state,actor_type,actor_id,reason,correlation_id)
 VALUES(s,j,a,r,e,prev,nxt,CASE WHEN actor IS NULL THEN 'system' ELSE 'worker' END,actor,reason,j)
$$;
--> statement-breakpoint
CREATE FUNCTION app.submission_context(auth_id uuid,cohort uuid,node text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;
BEGIN
 SELECT jsonb_build_object('user_id',u.id,'rules',n.submission_rules,'kind',n.kind) INTO ctx
 FROM app.users u JOIN app.cohort_memberships m ON m.user_id=u.id AND m.cohort_id=cohort
 JOIN app.cohorts c ON c.id=m.cohort_id JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id
 JOIN app.curriculum_nodes n ON n.curriculum_version_id=v.id AND n.node_key=node
 JOIN app.learner_node_progress p ON p.cohort_id=c.id AND p.user_id=u.id AND p.curriculum_version_id=v.id AND p.node_key=n.node_key
 WHERE u.auth_user_id=auth_id AND u.active AND u.role='learner' AND m.status='active' AND c.status='active'
 AND v.status='published' AND p.state IN ('available','in_progress','mastered') AND n.kind IN ('challenge','project')
 -- A local OCI fixture is meaningful only in an explicitly disposable database.
 AND ((NOT coalesce((n.resolved_evaluation_spec->>'test_only')::boolean,false)
   AND n.resolved_evaluation_spec->>'test_pack_artifact' ~ '^oci://[^/].+@sha256:[0-9a-f]{64}$')
   OR (current_database() LIKE 'foundation_test%' AND v.curriculum_key LIKE 'foundation-test-only-%'
     AND n.resolved_evaluation_spec->>'test_only'='true'
     AND n.resolved_evaluation_spec->>'test_pack_artifact' ~ '^oci:///[^@]+@sha256:[0-9a-f]{64}$'));
 IF ctx IS NULL THEN RAISE EXCEPTION 'SUBMISSION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN ctx;
END $$;
CREATE FUNCTION app.accept_submission(auth_id uuid,cohort uuid,node text,request_id uuid,filename text,bytes bigint,content_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; u uuid; c app.cohorts; v app.curriculum_versions; n app.curriculum_nodes;
 old app.submissions; art app.submission_artifacts; sid uuid:=gen_random_uuid(); jid uuid:=gen_random_uuid();
 snapshot jsonb; at_time timestamptz; ordinal bigint; object_key text;
BEGIN
 ctx:=app.submission_context(auth_id,cohort,node); u:=(ctx->>'user_id')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended(cohort::text||u::text,4));
 -- Hold authorization rows against concurrent deactivation until commit.
 PERFORM 1 FROM app.users WHERE id=u AND active AND role='learner' FOR SHARE;
 PERFORM 1 FROM app.cohort_memberships WHERE cohort_id=cohort AND user_id=u AND status='active' FOR SHARE;
 SELECT * INTO c FROM app.cohorts WHERE id=cohort FOR SHARE;
 ctx:=app.submission_context(auth_id,cohort,node);
 SELECT * INTO v FROM app.curriculum_versions WHERE id=c.curriculum_version_id;
 SELECT * INTO n FROM app.curriculum_nodes WHERE curriculum_version_id=v.id AND node_key=node;
 IF bytes NOT BETWEEN 1 AND 262144 OR content_hash !~ '^[0-9a-f]{64}$'
 OR filename !~ '^[A-Za-z0-9_][A-Za-z0-9_.-]*[.]go$'
 OR jsonb_array_length(n.submission_rules->'required_files')<>1
 OR n.submission_rules->'required_files'->>0<>filename
 OR NOT (n.submission_rules->'allowed_extensions' ? '.go')
 OR bytes>(n.submission_rules->>'max_size_kb')::bigint*1024 THEN
 RAISE EXCEPTION 'INVALID_ARTIFACT' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM app.submissions WHERE cohort_id=cohort AND user_id=u AND idempotency_key=request_id::text;
 IF FOUND THEN
   SELECT * INTO art FROM app.submission_artifacts WHERE id=old.artifact_id;
   IF old.node_key<>node OR art.sha256<>content_hash OR art.size_bytes<>bytes OR art.original_filename<>filename THEN
     RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023';
   END IF;
   RETURN old.id;
 END IF;
 object_key:=auth_id::text||'/'||cohort::text||'/'||request_id::text||'/'||content_hash;
 INSERT INTO app.submission_artifacts(owner_user_id,storage_bucket,storage_key,original_filename,size_bytes,sha256)
 VALUES(u,'nextera-submissions',object_key,filename,bytes,content_hash) RETURNING * INTO art;
 SELECT count(*)+1 INTO ordinal FROM app.submissions WHERE cohort_id=cohort AND user_id=u AND node_key=node;
 at_time:=clock_timestamp();
 snapshot:=n.resolved_evaluation_spec||jsonb_build_object('curriculum_version_id',v.id,'git_commit_sha',v.git_commit_sha,
   'evaluation_spec_digest',n.evaluation_spec_digest,'learner_id',u,'cohort_id',cohort,
   'submission_id',sid,'learner_attempt_ordinal',ordinal,'accepted_at',to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'artifact',jsonb_build_object('id',art.id,'bucket',art.storage_bucket,'key',art.storage_key,'filename',filename,'size_bytes',bytes,'sha256',content_hash));
 INSERT INTO app.submissions(id,cohort_id,user_id,curriculum_version_id,node_key,artifact_id,idempotency_key,evaluation_spec_digest,active_judge_job_id,created_at)
 VALUES(sid,cohort,u,v.id,node,art.id,request_id::text,n.evaluation_spec_digest,jid,at_time);
 INSERT INTO judge.jobs(id,submission_id,protocol_version,evaluation_snapshot,evaluation_digest,created_at)
 VALUES(jid,sid,(snapshot->>'protocol_version')::integer,snapshot,judge.snapshot_digest(snapshot),at_time);
 PERFORM judge.audit(sid,jid,NULL,NULL,'submission',NULL,'queued',NULL,'submission_accepted');
 PERFORM judge.audit(sid,jid,NULL,NULL,'job',NULL,'queued',NULL,'job_queued');
 -- Foundation 004 explicitly defers even the available -> in_progress write.
 RETURN sid;
END $$;
CREATE FUNCTION app.read_submissions(auth_id uuid,cohort uuid,node text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid;
BEGIN
 SELECT id INTO u FROM app.users WHERE auth_user_id=auth_id AND active AND role='learner';
 IF u IS NULL OR NOT EXISTS(SELECT FROM app.cohort_memberships m JOIN app.cohorts c ON c.id=m.cohort_id
 WHERE m.cohort_id=cohort AND m.user_id=u AND m.status='active' AND c.status='active') THEN
 RAISE EXCEPTION 'SUBMISSION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(row_to_json(history) ORDER BY history.created_at DESC,history.id) FROM (
 SELECT s.id,s.node_key,s.created_at,coalesce(r.verdict,s.state) AS state,r.learner_feedback AS feedback
 FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id
 LEFT JOIN judge.results r ON r.id=j.terminal_result_id AND r.job_id=j.id
 WHERE s.cohort_id=cohort AND s.user_id=u AND s.node_key=node ORDER BY s.created_at DESC,s.id LIMIT 50
 ) history),'[]'::jsonb);
END $$;
--> statement-breakpoint
CREATE FUNCTION judge.claim_job() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w judge.workers; j judge.jobs; a judge.attempts; at_time timestamptz;
BEGIN
 SELECT * INTO w FROM judge.workers WHERE id=judge.worker_identity() FOR UPDATE;
 IF EXISTS(SELECT FROM judge.jobs WHERE current_worker_id=w.id AND state IN ('claimed','running')) THEN RETURN NULL; END IF;
 SELECT * INTO j FROM judge.jobs q WHERE q.state='queued' AND q.available_at<=clock_timestamp()
 AND q.protocol_version=ANY(w.protocol_versions)
 AND q.evaluation_snapshot->>'runner_image_digest'=w.runner_image_digest
 AND q.evaluation_snapshot->>'target_platform'=w.platform
 AND q.evaluation_snapshot->>'toolchain_version'=w.capabilities->>'toolchain_version'
 AND q.evaluation_snapshot->>'resource_profile'=w.capabilities->>'resource_profile'
 AND q.evaluation_snapshot->>'snapshot_format_version'=w.capabilities->>'snapshot_format_version'
 AND q.evaluation_snapshot->>'sandbox_image_digest'=w.capabilities->>'sandbox_image_digest'
 AND (NOT (w.capabilities ? 'fixture_cohort_ids') OR w.capabilities->'fixture_cohort_ids' ? (q.evaluation_snapshot->>'cohort_id'))
 ORDER BY q.available_at,q.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 at_time:=clock_timestamp();
 INSERT INTO judge.attempts(job_id,attempt_number,worker_id,lease_generation,claim_token,claimed_at)
 VALUES(j.id,j.retry_count+1,w.id,j.lease_generation+1,gen_random_uuid(),at_time) RETURNING * INTO a;
 UPDATE judge.jobs SET state='claimed',lease_generation=a.lease_generation,lease_token=a.claim_token,
 lease_expires_at=at_time+interval '30 seconds',current_worker_id=w.id,current_attempt_id=a.id WHERE id=j.id;
 PERFORM judge.audit(j.submission_id,j.id,a.id,NULL,'job','queued','claimed',w.id,'job_claimed');
 PERFORM judge.audit(j.submission_id,j.id,a.id,NULL,'attempt',NULL,'claimed',w.id,'attempt_claimed');
 RETURN jsonb_build_object('job_id',j.id,'attempt_id',a.id,'worker_id',w.id,'token',a.claim_token,'generation',a.lease_generation,
 'evaluation_snapshot',j.evaluation_snapshot,'evaluation_digest',j.evaluation_digest,'lease_expires_at',at_time+interval '30 seconds');
END $$;
CREATE FUNCTION judge.check_claim(j judge.jobs,worker uuid,attempt uuid,token uuid,generation bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF j.id IS NULL OR j.state NOT IN ('claimed','running') OR j.current_worker_id IS DISTINCT FROM worker
 OR j.current_attempt_id IS DISTINCT FROM attempt OR j.lease_token IS DISTINCT FROM token
 OR j.lease_generation IS DISTINCT FROM generation OR j.lease_expires_at<=clock_timestamp() THEN
 RAISE EXCEPTION 'LEASE_LOST' USING ERRCODE='55000'; END IF;
END $$;
CREATE FUNCTION judge.renew_lease(job uuid,attempt uuid,token uuid,generation bigint) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j judge.jobs; w uuid:=judge.worker_identity(); expiry timestamptz;
BEGIN
 SELECT * INTO j FROM judge.jobs WHERE id=job FOR UPDATE;
 PERFORM judge.check_claim(j,w,attempt,token,generation);
 expiry:=clock_timestamp()+interval '30 seconds';
 UPDATE judge.jobs SET lease_expires_at=expiry WHERE id=job;
 RETURN expiry;
END $$;
CREATE FUNCTION judge.heartbeat() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE judge.workers SET last_heartbeat_at=clock_timestamp() WHERE id=judge.worker_identity()
$$;
CREATE FUNCTION judge.record_execution_attempt(job uuid,attempt uuid,token uuid,generation bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j judge.jobs; w uuid:=judge.worker_identity(); at_time timestamptz;
BEGIN
 SELECT * INTO j FROM judge.jobs WHERE id=job FOR UPDATE;
 PERFORM judge.check_claim(j,w,attempt,token,generation);
 IF j.state='running' THEN RETURN; END IF;
 at_time:=clock_timestamp();
 UPDATE judge.attempts SET state='running',started_at=at_time WHERE id=attempt;
 UPDATE judge.jobs SET state='running' WHERE id=job;
 UPDATE app.submissions SET state='running',started_at=coalesce(started_at,at_time) WHERE id=j.submission_id;
 PERFORM judge.audit(j.submission_id,job,attempt,NULL,'job','claimed','running',w,'evaluation_started');
 PERFORM judge.audit(j.submission_id,job,attempt,NULL,'attempt','claimed','running',w,'evaluation_started');
 PERFORM judge.audit(j.submission_id,job,attempt,NULL,'submission','queued','running',w,'evaluation_started');
END $$;
--> statement-breakpoint
-- Private helper: caller holds job lock and has already authenticated/validated ownership.
CREATE FUNCTION judge.finish_attempt(j judge.jobs,a judge.attempts,v text,metrics jsonb,code text,actor uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE rid uuid; at_time timestamptz:=clock_timestamp(); terminal boolean;
BEGIN
 terminal:=v<>'system_error' OR j.retry_count=2;
 INSERT INTO judge.results(job_id,attempt_id,evaluation_digest,verdict,measurements,learner_feedback,safe_operator_diagnostics,recorded_at)
 VALUES(j.id,a.id,j.evaluation_digest,v::app.submission_state,metrics,judge.safe_feedback(v),
 CASE WHEN code IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('code',code) END,at_time) RETURNING id INTO rid;
 UPDATE judge.attempts SET state=CASE WHEN v='system_error' THEN 'system_error'::judge.attempt_state ELSE 'completed'::judge.attempt_state END,
 finished_at=at_time,infrastructure_error_code=code WHERE id=a.id;
 IF terminal THEN
 UPDATE judge.jobs SET state=CASE WHEN v='system_error' THEN 'system_error'::judge.job_state ELSE 'completed'::judge.job_state END,
 terminal_result_id=rid,finished_at=at_time,lease_token=NULL,lease_expires_at=NULL WHERE id=j.id;
 ELSE
 UPDATE judge.jobs SET state='queued',retry_count=retry_count+1,available_at=at_time+CASE WHEN retry_count=0 THEN interval '2 seconds' ELSE interval '10 seconds' END,
 lease_token=NULL,lease_expires_at=NULL,current_worker_id=NULL,current_attempt_id=NULL WHERE id=j.id;
 UPDATE app.submissions SET state='queued' WHERE id=j.submission_id;
 END IF;
 PERFORM judge.audit(j.submission_id,j.id,a.id,rid,'attempt',a.state::text,CASE WHEN v='system_error' THEN 'system_error' ELSE 'completed' END,actor,coalesce(code,'evaluation_completed'));
 PERFORM judge.audit(j.submission_id,j.id,a.id,rid,'job',j.state::text,CASE WHEN NOT terminal THEN 'queued' WHEN v='system_error' THEN 'system_error' ELSE 'completed' END,actor,coalesce(code,'evaluation_completed'));
 RETURN rid;
END $$;
CREATE FUNCTION judge.record_outcome(job uuid,attempt uuid,token uuid,generation bigint,v text,metrics jsonb,code text) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE j judge.jobs; a judge.attempts; r judge.results; w uuid:=judge.worker_identity();
BEGIN
 IF v NOT IN ('passed','failed','compile_error','runtime_error','timeout','system_error')
 OR jsonb_typeof(metrics) IS DISTINCT FROM 'object' OR octet_length(metrics::text)>1024
 OR EXISTS(SELECT FROM jsonb_each(metrics) WHERE key NOT IN ('compilation_ms','execution_ms','compiled_bytes')
   OR jsonb_typeof(value)<>'number' OR value::text::numeric<0 OR value::text::numeric>86400000)
 OR (v='system_error' AND (code IS NULL OR code NOT IN ('ARTIFACT_UNAVAILABLE','ARTIFACT_MISMATCH','INCOMPATIBLE_ENVIRONMENT','CONTAINER_FAILURE','WORKER_FAILURE','STORAGE_FAILURE')))
 OR (v<>'system_error' AND code IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_RESULT' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM judge.jobs WHERE id=job FOR UPDATE;
 SELECT * INTO a FROM judge.attempts WHERE id=attempt AND job_id=job;
 IF a.id IS NULL OR a.worker_id IS DISTINCT FROM w OR a.claim_token IS DISTINCT FROM token OR a.lease_generation IS DISTINCT FROM generation THEN
 RAISE EXCEPTION 'LEASE_LOST' USING ERRCODE='55000'; END IF;
 SELECT * INTO r FROM judge.results WHERE attempt_id=attempt;
 IF FOUND THEN
 IF r.verdict::text<>v OR r.measurements<>metrics OR r.safe_operator_diagnostics<>
   (CASE WHEN code IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('code',code) END) THEN
   RAISE EXCEPTION 'RESULT_CONFLICT' USING ERRCODE='22023'; END IF;
 RETURN r.id;
 END IF;
 PERFORM judge.check_claim(j,w,attempt,token,generation);
 IF v<>'system_error' AND a.state<>'running' THEN RAISE EXCEPTION 'ATTEMPT_NOT_RUNNING'; END IF;
 RETURN judge.finish_attempt(j,a,v,metrics,code,w);
END $$;
CREATE FUNCTION judge.record_result(job uuid,attempt uuid,token uuid,generation bigint,v text,metrics jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF v NOT IN ('passed','failed','compile_error','runtime_error','timeout') THEN RAISE EXCEPTION 'INVALID_VERDICT'; END IF;
 RETURN judge.record_outcome(job,attempt,token,generation,v,metrics,NULL);
END $$;
CREATE FUNCTION judge.record_infrastructure_failure(job uuid,attempt uuid,token uuid,generation bigint,code text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT judge.record_outcome(job,attempt,token,generation,'system_error','{}'::jsonb,code)
$$;
CREATE FUNCTION judge.recover_expired(batch_size integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j judge.jobs; a judge.attempts; recovered integer:=0;
BEGIN
 IF batch_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_BATCH'; END IF;
 FOR j IN SELECT * FROM judge.jobs WHERE state IN ('claimed','running') AND lease_expires_at<=clock_timestamp()
 ORDER BY lease_expires_at,id FOR UPDATE SKIP LOCKED LIMIT batch_size LOOP
 SELECT * INTO a FROM judge.attempts WHERE id=j.current_attempt_id;
 PERFORM judge.finish_attempt(j,a,'system_error','{}'::jsonb,'LEASE_EXPIRED',NULL);
 recovered:=recovered+1;
 END LOOP;
 RETURN recovered;
END $$;
-- Provisioner-controlled revocation closes live claims atomically. Re-enabling
-- a worker cannot revive a previously revoked token, even before its old expiry.
CREATE FUNCTION judge.revoke_worker_claims() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j judge.jobs; a judge.attempts;
BEGIN
 IF NOT NEW.enabled OR OLD.enabled IS DISTINCT FROM NEW.enabled THEN
   FOR j IN SELECT * FROM judge.jobs WHERE current_worker_id=NEW.id AND state IN ('claimed','running') ORDER BY id FOR UPDATE LOOP
     SELECT * INTO a FROM judge.attempts WHERE id=j.current_attempt_id;
     PERFORM judge.finish_attempt(j,a,'system_error','{}'::jsonb,'WORKER_FAILURE',NULL);
   END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER worker_revocation AFTER UPDATE OF enabled ON judge.workers
FOR EACH ROW EXECUTE FUNCTION judge.revoke_worker_claims();
--> statement-breakpoint
-- All new functions are private unless listed below. Restricted owner has no progress writes.
-- Supabase's migration login is not a superuser. Temporary SET membership is
-- revoked before this migration transaction commits; no persistent escalation.
DO $$
BEGIN
 PERFORM set_config('nextera.temporary_owner_membership','false',true);
 IF NOT pg_has_role(current_user,'nextera_judge_owner','SET') THEN
   IF EXISTS(
     SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member JOIN pg_roles g ON g.oid=m.grantor
     WHERE r.rolname='nextera_judge_owner' AND u.rolname=current_user AND g.rolname=current_user) THEN
     RAISE EXCEPTION 'Existing owner membership needs an explicit migration-identity review';
   END IF;
   EXECUTE format('GRANT nextera_judge_owner TO %I',current_user);
   PERFORM set_config('nextera.temporary_owner_membership','true',true);
 END IF;
END $$;
GRANT CREATE ON SCHEMA app,judge TO nextera_judge_owner;
DO $$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('app','judge') AND p.proname IN (
 'canonical_json','snapshot_digest','guard_history','safe_feedback','worker_identity','audit',
 'submission_context','accept_submission','read_submissions','claim_job','check_claim','renew_lease',
 'heartbeat','record_execution_attempt','finish_attempt','record_outcome','record_result','record_infrastructure_failure','recover_expired','revoke_worker_claims') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
 EXECUTE format('ALTER FUNCTION %s OWNER TO nextera_judge_owner',f.signature);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA app,judge FROM nextera_judge_owner;
GRANT EXECUTE ON FUNCTION app.submission_context(uuid,uuid,text),app.accept_submission(uuid,uuid,text,uuid,text,bigint,text),app.read_submissions(uuid,uuid,text) TO nextera_web;
GRANT EXECUTE ON FUNCTION judge.claim_job(),judge.renew_lease(uuid,uuid,uuid,bigint),judge.heartbeat(),
 judge.record_execution_attempt(uuid,uuid,uuid,bigint),judge.record_result(uuid,uuid,uuid,bigint,text,jsonb),
 judge.record_infrastructure_failure(uuid,uuid,uuid,bigint,text) TO nextera_runner;
GRANT EXECUTE ON FUNCTION judge.recover_expired(integer) TO nextera_judge_maintenance;
DO $$
BEGIN
 IF current_setting('nextera.temporary_owner_membership')='true' THEN
   EXECUTE format('REVOKE nextera_judge_owner FROM %I GRANTED BY %I',current_user,current_user);
   IF pg_has_role(current_user,'nextera_judge_owner','SET') THEN
     RAISE EXCEPTION 'Temporary owner access was not fully revoked';
   END IF;
 END IF;
END $$;
