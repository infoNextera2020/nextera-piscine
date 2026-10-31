-- SOURCE REVIEW DRAFT ONLY. No execution or membership/credential/table authority is provisioned.
-- Binary display receipts only. Scored mastery remains exclusively in reviewed0029.
-- Uses existing0005 result-application column privileges through a SECURITY INVOKER registrar.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'exam-binary-0033-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin)
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')
 OR NOT has_schema_privilege('nextera_checkpoint_owner','app','CREATE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_result_application' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR to_regprocedure('app.scored_exam_attempt_metadata(app.checkpoint_attempts)') IS NULL THEN
 RAISE EXCEPTION 'Fresh pre-held isolated binary receipt prerequisites required';END IF;
END $$;
SET LOCAL ROLE nextera_checkpoint_owner;
-- A private-table validation seam. Only the existing result application principal
-- may inspect a receipt, and no functional group or points are derived here.
CREATE FUNCTION app.scored_exam_binary_result_context(rid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r judge.results;j judge.jobs;s app.submissions;a app.checkpoint_attempts;
 acc app.exam_scoring_acceptances;assignment app.exam_scoring_assignments;rubric app.exam_scoring_rubrics;art app.submission_artifacts;
 item jsonb;spec jsonb;
BEGIN
 IF rid IS NULL OR current_setting('role')<>'none' OR NOT pg_has_role(session_user,'nextera_result_application','USAGE')
 OR pg_has_role(session_user,'nextera_checkpoint_owner','USAGE') OR pg_has_role(session_user,'nextera_checkpoint_owner','SET')
 OR pg_has_role(session_user,'nextera_web','USAGE') OR pg_has_role(session_user,'nextera_web','SET')
 OR pg_has_role(session_user,'nextera_exam_evaluator','USAGE') OR pg_has_role(session_user,'nextera_exam_evaluator','SET')
 OR EXISTS(SELECT FROM unnest(ARRAY['nextera_runner','nextera_judge_owner','nextera_judge_maintenance']) forbidden(role_name)
 WHERE pg_has_role(session_user,role_name,'USAGE') OR pg_has_role(session_user,role_name,'SET'))
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN
 RAISE EXCEPTION 'Binary result application forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM judge.results WHERE id=rid;
 SELECT * INTO j FROM judge.jobs WHERE id=r.job_id;
 SELECT * INTO s FROM app.submissions WHERE id=j.submission_id;
 IF r.id IS NULL OR j.id IS NULL OR s.id IS NULL OR r.evaluation_digest IS DISTINCT FROM j.evaluation_digest THEN
 RAISE EXCEPTION 'Binary result identity unavailable' USING ERRCODE='PS005';END IF;
 -- Only verified unmarked sources may fall back to the unchanged legacy path.
 IF s.checkpoint_attempt_id IS NULL THEN
 IF j.evaluation_snapshot->'checkpoint_definition' ? 'examScoring' OR j.evaluation_snapshot->'checkpoint_definition'->'policyVersion'='3'::jsonb THEN RAISE EXCEPTION 'Unbound marked binary source' USING ERRCODE='PS005';END IF;
 RETURN NULL;END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=s.checkpoint_attempt_id FOR SHARE;
 IF a.id IS NULL OR a.user_id IS DISTINCT FROM s.user_id OR a.cohort_id IS DISTINCT FROM s.cohort_id
 OR a.curriculum_version_id IS DISTINCT FROM s.curriculum_version_id OR a.node_key IS DISTINCT FROM s.node_key
 OR a.snapshot_digest IS DISTINCT FROM app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt') THEN
 RAISE EXCEPTION 'Binary checkpoint identity unavailable' USING ERRCODE='PS005';END IF;
 IF NOT(a.snapshot->'definition' ? 'examScoring') THEN
 IF a.snapshot->'definition'->'policyVersion'='3'::jsonb THEN RAISE EXCEPTION 'Incomplete marked binary definition' USING ERRCODE='PS005';END IF;
 RETURN NULL;END IF;
 IF app.scored_exam_attempt_metadata(a) IS NULL THEN RAISE EXCEPTION 'Marked binary lifecycle unavailable' USING ERRCODE='PS005';END IF;
 SELECT * INTO acc FROM app.exam_scoring_acceptances WHERE submission_id=s.id AND attempt_id=a.id;
 SELECT * INTO assignment FROM app.exam_scoring_assignments WHERE attempt_id=a.id;
 SELECT * INTO rubric FROM app.exam_scoring_rubrics WHERE rubric_digest=assignment.rubric_digest;
 SELECT * INTO art FROM app.submission_artifacts WHERE id=s.artifact_id AND owner_user_id=a.user_id;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=s.checkpoint_task_key;
 spec:=item->'evaluationSpec';
 IF acc.submission_id IS NULL OR acc.source_kind IS DISTINCT FROM 'coding' OR acc.answer_kind IS DISTINCT FROM 'coding'
 OR acc.question_key !~ '^q[1-5]$' OR acc.question_key IS DISTINCT FROM s.checkpoint_task_key
 OR acc.snapshot_digest IS DISTINCT FROM a.snapshot_digest OR acc.accepted_at IS DISTINCT FROM s.created_at
 OR s.created_at<a.started_at OR s.created_at>=a.deadline_at
 OR EXISTS(SELECT FROM app.exam_scoring_closures c WHERE c.attempt_id=a.id AND acc.accepted_ordinal>=c.closure_ordinal)
 OR acc.evaluator_key IS DISTINCT FROM 'official-code' OR acc.evaluator_digest IS DISTINCT FROM s.evaluation_spec_digest
 OR item->>'evaluationDigest' IS DISTINCT FROM s.evaluation_spec_digest
 OR app.checkpoint_digest(spec,'nextera-evaluation-spec') IS DISTINCT FROM s.evaluation_spec_digest
 OR spec->'execution_contract'->'version' IS DISTINCT FROM '3'::jsonb
 OR spec->'execution_contract'->>'item_key' IS DISTINCT FROM acc.question_key
 OR art.id IS NULL OR art.sha256 IS DISTINCT FROM acc.answer_digest
 OR rubric.rubric_digest IS NULL OR rubric.definition_digest IS DISTINCT FROM a.definition_digest
 OR NOT coalesce(app.exam_scoring_source_binding_valid(rubric.source_binding,rubric.rubric),false)
 OR rubric.source_binding_digest IS DISTINCT FROM app.checkpoint_digest(rubric.source_binding,'nextera-exam1-rubric-source-binding')
 OR j.evaluation_digest IS DISTINCT FROM app.checkpoint_digest(j.evaluation_snapshot,'nextera-evaluation-snapshot')
 OR (j.evaluation_snapshot-ARRAY['curriculum_version_id','git_commit_sha','evaluation_spec_digest','learner_id','cohort_id','submission_id','learner_attempt_ordinal','accepted_at','artifact']) IS DISTINCT FROM spec
 OR j.evaluation_snapshot->>'evaluation_spec_digest' IS DISTINCT FROM s.evaluation_spec_digest
 OR j.evaluation_snapshot->>'submission_id' IS DISTINCT FROM s.id::text
 OR j.evaluation_snapshot->>'learner_id' IS DISTINCT FROM s.user_id::text
 OR j.evaluation_snapshot->>'cohort_id' IS DISTINCT FROM s.cohort_id::text
 OR j.evaluation_snapshot->>'curriculum_version_id' IS DISTINCT FROM s.curriculum_version_id::text
 OR j.evaluation_snapshot->'artifact' IS DISTINCT FROM jsonb_build_object('id',art.id,'bucket',art.storage_bucket,'key',art.storage_key,'filename',art.original_filename,'size_bytes',art.size_bytes,'sha256',art.sha256) THEN
 RAISE EXCEPTION 'Frozen marked binary source unavailable' USING ERRCODE='PS005';END IF;
 RETURN jsonb_build_object('version',1,'resultId',r.id,'jobId',j.id,'submissionId',s.id,'checkpointAttemptId',a.id,
 'definitionDigest',a.definition_digest,'evaluationSpecDigest',s.evaluation_spec_digest,'evaluationSnapshotDigest',j.evaluation_digest,
 'answerSha256',acc.answer_digest,'rubricDigest',rubric.rubric_digest);
END $$;

CREATE FUNCTION app.apply_scored_exam_binary_result(rid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE r judge.results;j judge.jobs;s app.submissions;attempt judge.attempts;ctx jsonb;authoritative boolean;at_time timestamptz;reason text;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR NOT pg_has_role(session_user,'nextera_result_application','USAGE') THEN RAISE EXCEPTION 'Direct result application principal required' USING ERRCODE='42501';END IF;
 SELECT job_id INTO j.id FROM judge.results WHERE id=rid;
 SELECT * INTO j FROM judge.jobs WHERE id=j.id FOR UPDATE;
 SELECT * INTO s FROM app.submissions WHERE id=j.submission_id FOR UPDATE;
 SELECT * INTO r FROM judge.results WHERE id=rid FOR UPDATE;
 IF r.id IS NULL OR j.id IS NULL OR s.id IS NULL OR r.job_id IS DISTINCT FROM j.id OR r.evaluation_digest IS DISTINCT FROM j.evaluation_digest THEN
 RAISE EXCEPTION 'Binary receipt identity conflict';END IF;
 ctx:=app.scored_exam_binary_result_context(rid);
 IF ctx IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO attempt FROM judge.attempts WHERE id=r.attempt_id AND job_id=j.id;
 IF attempt.id IS NULL OR attempt.state::text NOT IN('completed','system_error') THEN RAISE EXCEPTION 'Binary result attempt is not terminal';END IF;
 authoritative:=s.active_judge_job_id=j.id AND j.terminal_result_id=r.id;
 IF r.application_status::text<>'pending' THEN
 IF r.processed_at IS NULL
 OR (r.application_status::text='applied' AND (NOT authoritative OR s.state IS DISTINCT FROM r.verdict OR s.finished_at IS DISTINCT FROM r.processed_at OR r.application_reason IS DISTINCT FROM 'scored_exam_binary_result_applied'))
 OR (r.application_status::text='superseded' AND (authoritative OR r.application_reason IS DISTINCT FROM CASE WHEN s.active_judge_job_id=j.id THEN 'intermediate_infrastructure_result' ELSE 'superseded_evaluation' END
 OR (s.active_judge_job_id=j.id AND (r.verdict::text<>'system_error' OR attempt.attempt_number>j.retry_count)))) THEN
 RAISE EXCEPTION 'Binary application receipt conflict';END IF;
 RETURN to_jsonb(r);END IF;
 at_time:=greatest(clock_timestamp(),s.created_at,s.started_at,r.recorded_at);
 IF NOT authoritative THEN
 IF s.active_judge_job_id=j.id AND (r.verdict::text<>'system_error' OR attempt.attempt_number>j.retry_count) THEN RAISE EXCEPTION 'Nonterminal binary result';END IF;
 reason:=CASE WHEN s.active_judge_job_id=j.id THEN 'intermediate_infrastructure_result' ELSE 'superseded_evaluation' END;
 UPDATE judge.results SET application_status='superseded',processed_at=at_time,application_reason=reason WHERE id=rid RETURNING * INTO r;
 RETURN to_jsonb(r);END IF;
 IF j.state::text NOT IN('completed','system_error')
 OR (r.verdict::text='system_error' AND (j.state::text<>'system_error' OR attempt.state::text<>'system_error'))
 OR (r.verdict::text<>'system_error' AND (j.state::text<>'completed' OR attempt.state::text<>'completed'))
 OR r.verdict::text NOT IN('passed','failed','compile_error','runtime_error','timeout','system_error')
 OR s.state::text NOT IN('queued','running') THEN RAISE EXCEPTION 'Binary source lifecycle conflict';END IF;
 UPDATE app.submissions SET state=r.verdict,finished_at=at_time WHERE id=s.id;
 INSERT INTO app.state_events(submission_id,job_id,attempt_id,result_id,entity_type,previous_state,next_state,actor_type,reason,correlation_id)
 VALUES(s.id,j.id,attempt.id,r.id,'submission',s.state::text,r.verdict::text,'system','scored_exam_binary_result_applied',j.id);
 INSERT INTO app.activity_events(event_type,event_version,user_id,cohort_id,curriculum_version_id,node_key,submission_id,result_id,correlation_id,payload)
 VALUES('scored_exam_binary_result_recorded',1,s.user_id,s.cohort_id,s.curriculum_version_id,s.node_key,s.id,r.id,j.id,
 jsonb_build_object('version',1,'scoringStatus','provisional','definitionDigest',ctx->>'definitionDigest','evaluationSnapshotDigest',j.evaluation_digest));
 UPDATE judge.results SET application_status='applied',processed_at=at_time,application_reason='scored_exam_binary_result_applied' WHERE id=rid RETURNING * INTO r;
 -- No checkpoint finalizer, attempt closure, group scores, progress, unlock or XP mutation.
 RETURN to_jsonb(r);
END $$;
DO $$ DECLARE f regprocedure;grantee record;BEGIN
 FOREACH f IN ARRAY ARRAY['app.scored_exam_binary_result_context(uuid)'::regprocedure,'app.apply_scored_exam_binary_result(uuid)'::regprocedure] LOOP
 FOR grantee IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END recipient
 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
 WHERE p.oid=f AND a.grantee<>p.proowner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f,grantee.recipient);END LOOP;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.scored_exam_binary_result_context(uuid),app.apply_scored_exam_binary_result(uuid) TO nextera_result_application;
RESET ROLE;
DO $$ DECLARE f record;BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none' THEN RAISE EXCEPTION 'Binary receipt role restoration failed';END IF;
 FOR f IN SELECT p.*,r.rolname owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
 WHERE n.nspname='app' AND p.proname IN('scored_exam_binary_result_context','apply_scored_exam_binary_result') LOOP
 IF f.owner<>'nextera_checkpoint_owner' OR f.prorettype<>'jsonb'::regtype OR oidvectortypes(f.proargtypes)<>'uuid'
 OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR f.prosecdef IS DISTINCT FROM (f.proname='scored_exam_binary_result_context')
 OR NOT has_function_privilege('nextera_result_application',f.oid,'EXECUTE')
 OR EXISTS(SELECT FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
 WHERE a.grantee<>f.proowner AND (a.grantee=0 OR r.rolname IS DISTINCT FROM 'nextera_result_application' OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
 RAISE EXCEPTION 'Exact binary receipt owner/OID/ACL readback failed';END IF;END LOOP;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN('scored_exam_binary_result_context','apply_scored_exam_binary_result'))<>2 THEN RAISE EXCEPTION 'Unexpected binary receipt function set';END IF;
END $$;
COMMIT;
