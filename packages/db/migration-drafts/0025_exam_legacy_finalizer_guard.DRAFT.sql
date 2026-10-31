-- SOURCE DRAFT ONLY. Unregistered, unapplied and NOT part of the Auth rehearsal.
-- This is a fail-closed guard, not the mixed-exam outcome/progression applier.
-- Registered0007 bytes remain untouched; unmarked legacy function body remains exact.
-- A reviewed migration transaction must supply temporary owner context, restoring it
-- before commit. No LOGIN, membership, schema/table grant or wider caller ACL is added.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $guard_patch$
DECLARE old_proc pg_catalog.pg_proc; new_proc pg_catalog.pg_proc; owner_oid oid;
BEGIN
 IF current_user<>'nextera_checkpoint_owner' THEN RAISE EXCEPTION 'Verified checkpoint owner context required'; END IF;
 SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname='nextera_checkpoint_owner'
 AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication;
 SELECT p.* INTO old_proc FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('app.finalize_checkpoint(uuid)');
 IF owner_oid IS NULL OR old_proc.oid IS NULL OR old_proc.proowner<>owner_oid
 OR old_proc.prorettype<>'uuid'::regtype OR old_proc.prokind<>'f' OR NOT old_proc.prosecdef
 OR old_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
 OR encode(sha256(convert_to(old_proc.prosrc,'UTF8')),'hex')<>'061ea655e846ce5eafe1ff592ccc46ac6b18e3a9d7e11e1f63065a82ed3a8755'
 OR EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(old_proc.proacl,pg_catalog.acldefault('f',old_proc.proowner))) a
 WHERE a.grantee=0 OR (a.grantee<>old_proc.proowner AND a.grantee<>coalesce((SELECT oid FROM pg_catalog.pg_roles WHERE rolname='nextera_result_application'),0)) OR (a.is_grantable AND a.grantee<>old_proc.proowner))
 THEN RAISE EXCEPTION 'Exact legacy finalizer source/owner/ACL required'; END IF;
 EXECUTE $trusted_finalizer$
CREATE OR REPLACE FUNCTION app.finalize_checkpoint(attempt uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; task jsonb; passed_count integer:=0;infra_count integer:=0;pending boolean:=false;has_pass boolean;has_infra boolean;
 outcome_status text;oid uuid;at_time timestamptz;history jsonb;proof jsonb;p app.learner_node_progress;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHECKPOINT_NOT_FOUND'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||a.user_id::text,4));
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 -- A marked mixed/scored definition must never fall through the legacy four-task
 -- boolean pass/progression path. Closure is independent of mentor review.
 IF (a.snapshot->'definition') ? 'examScoring' THEN
 at_time:=clock_timestamp();
 IF a.status='active' AND at_time>=a.deadline_at THEN
 UPDATE app.checkpoint_attempts SET status='evaluating',closed_at=deadline_at,closure_reason='expired' WHERE id=attempt RETURNING * INTO a;
 PERFORM app.checkpoint_event(a,'checkpoint_expired');
 END IF;
 RETURN NULL;
 END IF;
 SELECT id INTO oid FROM app.checkpoint_outcomes WHERE attempt_id=attempt;
 IF FOUND THEN RETURN oid; END IF;
 at_time:=clock_timestamp();
 IF a.status='active' THEN
 IF at_time<a.deadline_at THEN RETURN NULL; END IF;
 UPDATE app.checkpoint_attempts SET status='evaluating',closed_at=deadline_at,closure_reason='expired' WHERE id=attempt RETURNING * INTO a;
 PERFORM app.checkpoint_event(a,'checkpoint_expired');
 END IF;
 IF a.status<>'evaluating' THEN RAISE EXCEPTION 'CHECKPOINT_STATE_CONFLICT'; END IF;
 -- Read only committed, product-applied authoritative terminal results. Never lock
 -- jobs here: result application locks job before taking this learner's advisory lock.
 FOR task IN SELECT value FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') LOOP
 SELECT coalesce(bool_or(r.verdict='passed' AND r.application_status='applied'),false),
 coalesce(bool_or(r.verdict='system_error' AND r.application_status='applied'),false) AND count(*) FILTER(WHERE r.application_status='applied' AND r.verdict IN ('passed','failed','compile_error','runtime_error','timeout'))<3,
 pending OR coalesce(bool_or(r.id IS NULL OR r.application_status<>'applied'),false)
 INTO has_pass,has_infra,pending
 FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id AND j.submission_id=s.id
 LEFT JOIN judge.results r ON r.id=j.terminal_result_id AND r.job_id=j.id AND r.evaluation_digest=j.evaluation_digest
 WHERE s.checkpoint_attempt_id=attempt AND s.checkpoint_task_key=task->>'key';
 IF has_pass THEN passed_count:=passed_count+1; ELSIF has_infra THEN infra_count:=infra_count+1; END IF;
 END LOOP;
 IF pending THEN RETURN NULL; END IF;
 outcome_status:=CASE WHEN passed_count>=3 THEN 'passed' WHEN passed_count+infra_count>=3 THEN 'infrastructure_blocked' ELSE 'failed' END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('submission_id',s.id,'task_key',s.checkpoint_task_key,'job_id',j.id,'result_id',r.id,'evaluation_digest',j.evaluation_digest,'verdict',r.verdict,'processed_at',r.processed_at) ORDER BY s.checkpoint_task_key,s.created_at,s.id),'[]'::jsonb) INTO history
 FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id JOIN judge.results r ON r.id=j.terminal_result_id AND r.application_status='applied' WHERE s.checkpoint_attempt_id=attempt;
 SELECT greatest(at_time,a.closed_at,max(r.processed_at)) INTO at_time FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id JOIN judge.results r ON r.id=j.terminal_result_id WHERE s.checkpoint_attempt_id=attempt;
 proof:=jsonb_build_object('snapshot_digest',a.snapshot_digest,'policy_version',1,'points',passed_count,'status',outcome_status,'results',history);
 INSERT INTO app.checkpoint_outcomes(attempt_id,cohort_id,user_id,curriculum_version_id,node_key,status,points,evidence,evidence_digest,applied_at)
 VALUES(attempt,a.cohort_id,a.user_id,a.curriculum_version_id,a.node_key,outcome_status,passed_count,proof,app.checkpoint_digest(proof,'nextera-checkpoint-outcome'),at_time) RETURNING id INTO oid;
 UPDATE app.checkpoint_attempts SET status=outcome_status,completed_at=at_time WHERE id=attempt;
 PERFORM app.checkpoint_event(a,'checkpoint_'||outcome_status,oid);
 IF outcome_status='passed' THEN
 PERFORM 1 FROM app.learner_node_progress WHERE cohort_id=a.cohort_id AND user_id=a.user_id ORDER BY node_key FOR UPDATE;
 UPDATE app.learner_node_progress SET state='mastered',mastered_at=at_time,first_passing_checkpoint_outcome_id=oid
 WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND state='in_progress';
 IF FOUND THEN
 INSERT INTO app.state_events(checkpoint_attempt_id,checkpoint_outcome_id,entity_type,previous_state,next_state,actor_type,reason,correlation_id)
 VALUES(a.id,oid,'progress','in_progress','mastered','system','checkpoint_mastered:'||a.node_key,a.id);
 FOR p IN UPDATE app.learner_node_progress target SET state='available',unlocked_at=at_time
 WHERE target.cohort_id=a.cohort_id AND target.user_id=a.user_id AND target.curriculum_version_id=a.curriculum_version_id AND target.state='locked'
 AND EXISTS(SELECT FROM app.node_prerequisites e WHERE e.curriculum_version_id=target.curriculum_version_id AND e.dependent_node_key=target.node_key)
 AND NOT EXISTS(SELECT FROM app.node_prerequisites e LEFT JOIN app.learner_node_progress pre ON pre.cohort_id=a.cohort_id AND pre.user_id=a.user_id AND pre.curriculum_version_id=e.curriculum_version_id AND pre.node_key=e.prerequisite_node_key
 WHERE e.curriculum_version_id=target.curriculum_version_id AND e.dependent_node_key=target.node_key AND (e.rule<>'requires_pass' OR pre.state IS DISTINCT FROM 'mastered')) RETURNING target.* LOOP
 PERFORM app.checkpoint_event(a,'node_unlocked',oid,p.node_key);
 INSERT INTO app.state_events(checkpoint_attempt_id,checkpoint_outcome_id,entity_type,previous_state,next_state,actor_type,reason,correlation_id)
 VALUES(a.id,oid,'progress','locked','available','system','node_unlocked:'||p.node_key,a.id);
 END LOOP;
 END IF;
 ELSIF outcome_status='failed' AND a.normal_slot=2 THEN PERFORM app.checkpoint_event(a,'checkpoint_retake_exhausted',oid);
 END IF;
 RETURN oid;
END $$;
$trusted_finalizer$;
 SELECT p.* INTO new_proc FROM pg_catalog.pg_proc p WHERE p.oid=old_proc.oid;
 IF new_proc.proowner IS DISTINCT FROM old_proc.proowner OR new_proc.proacl IS DISTINCT FROM old_proc.proacl
 OR new_proc.prosecdef IS DISTINCT FROM old_proc.prosecdef OR new_proc.proconfig IS DISTINCT FROM old_proc.proconfig
 OR encode(sha256(convert_to(new_proc.prosrc,'UTF8')),'hex')<>'792fafffa1021857fc8ed97eaa05dc1861c0d412850b4efddedd5b503102073e'
 THEN RAISE EXCEPTION 'Finalizer identity/ACL/body restoration check failed'; END IF;
END $guard_patch$;
COMMIT;
