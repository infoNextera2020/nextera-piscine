-- Foundation 006 trusted checkpoint operations. No policy input comes from a browser.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner') THEN
 CREATE ROLE nextera_checkpoint_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND
 (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner') THEN
 RAISE EXCEPTION 'Checkpoint owner must be an isolated NOLOGIN permission role'; END IF;
END $$;
GRANT USAGE ON SCHEMA app,judge TO nextera_checkpoint_owner;
GRANT SELECT ON app.users,app.cohorts,app.cohort_memberships,app.curriculum_versions,app.curriculum_nodes,
 app.node_prerequisites,app.learner_node_progress,app.submissions,app.submission_artifacts,judge.jobs,judge.results TO nextera_checkpoint_owner;
GRANT SELECT,INSERT,UPDATE ON app.checkpoint_attempts,app.checkpoint_outcomes,app.checkpoint_replacement_grants TO nextera_checkpoint_owner;
GRANT SELECT ON app.checkpoint_definitions TO nextera_checkpoint_owner,nextera_result_application;
GRANT SELECT ON app.checkpoint_attempts,app.checkpoint_outcomes TO nextera_result_application;
GRANT UPDATE(id) ON app.users,app.cohorts TO nextera_checkpoint_owner;
GRANT UPDATE(joined_at) ON app.cohort_memberships TO nextera_checkpoint_owner;
GRANT UPDATE(state,started_at,unlocked_at,mastered_at,first_passing_checkpoint_outcome_id) ON app.learner_node_progress TO nextera_checkpoint_owner;
GRANT INSERT ON app.submissions,app.submission_artifacts,judge.jobs,app.activity_events,app.state_events TO nextera_checkpoint_owner;
--> statement-breakpoint
CREATE FUNCTION app.checkpoint_canonical(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT CASE jsonb_typeof(v) WHEN 'object' THEN '{'||coalesce((SELECT string_agg(to_jsonb(key)::text||':'||app.checkpoint_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(v)),'')||'}'
 WHEN 'array' THEN '['||coalesce((SELECT string_agg(app.checkpoint_canonical(value),',' ORDER BY ord) FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ord)),'')||']' ELSE v::text END
$$;
CREATE FUNCTION app.checkpoint_digest(v jsonb,domain text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(domain,'UTF8')||decode('00','hex')||convert_to('v1','UTF8')||decode('00','hex')||convert_to(app.checkpoint_canonical(v),'UTF8')),'hex')
$$;
CREATE FUNCTION app.guard_checkpoint_definition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE n app.curriculum_nodes;v app.curriculum_versions;
BEGIN
 SELECT * INTO n FROM app.curriculum_nodes WHERE curriculum_version_id=NEW.curriculum_version_id AND node_key=NEW.node_key;
 SELECT * INTO v FROM app.curriculum_versions WHERE id=NEW.curriculum_version_id;
 IF v.status<>'draft' OR n.kind<>'checkpoint' OR n.evaluation_spec_digest<>NEW.definition_digest OR n.resolved_evaluation_spec->'checkpoint_definition' IS DISTINCT FROM NEW.definition
 OR (SELECT count(DISTINCT value->>'key') FROM jsonb_array_elements(NEW.definition->'tasks'))<>4
 OR (SELECT count(DISTINCT value->>'testPackId') FROM jsonb_array_elements(NEW.definition->'tasks'))<>4
 THEN RAISE EXCEPTION 'Invalid committed checkpoint definition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkpoint_definition_projection BEFORE INSERT ON app.checkpoint_definitions FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_definition();
CREATE FUNCTION app.guard_checkpoint_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.status='published' AND OLD.status<>'published' AND EXISTS(
 SELECT FROM app.curriculum_nodes n LEFT JOIN app.checkpoint_definitions d USING(curriculum_version_id,node_key)
 WHERE n.curriculum_version_id=NEW.id AND n.kind='checkpoint' AND (d.node_key IS NULL OR d.definition_digest<>n.evaluation_spec_digest)) THEN
 RAISE EXCEPTION 'Publication requires every committed checkpoint definition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkpoint_publication_guard BEFORE UPDATE OF status ON app.curriculum_versions FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_publication();
CREATE FUNCTION app.guard_checkpoint_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME IN ('checkpoint_definitions','checkpoint_outcomes') THEN RAISE EXCEPTION 'Checkpoint evidence is immutable'; END IF;
 IF TG_TABLE_NAME='checkpoint_attempts' THEN
 IF (to_jsonb(OLD)-ARRAY['status','closed_at','closure_reason','completed_at','retake_announced_at']) IS DISTINCT FROM
 (to_jsonb(NEW)-ARRAY['status','closed_at','closure_reason','completed_at','retake_announced_at']) THEN RAISE EXCEPTION 'Checkpoint attempt identity is immutable'; END IF;
 IF OLD.status IN ('passed','failed','infrastructure_blocked') AND (to_jsonb(OLD)-'retake_announced_at') IS DISTINCT FROM (to_jsonb(NEW)-'retake_announced_at') THEN RAISE EXCEPTION 'Terminal checkpoint is immutable'; END IF;
 IF OLD.status='evaluating' AND (NEW.status='active' OR NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.closure_reason IS DISTINCT FROM OLD.closure_reason) THEN RAISE EXCEPTION 'Checkpoint cannot reopen'; END IF;
 IF OLD.retake_announced_at IS NOT NULL AND NEW.retake_announced_at IS DISTINCT FROM OLD.retake_announced_at THEN RAISE EXCEPTION 'Retake announcement immutable'; END IF;
 ELSIF TG_TABLE_NAME='checkpoint_replacement_grants' AND
 ((to_jsonb(OLD)-'replacement_attempt_id') IS DISTINCT FROM (to_jsonb(NEW)-'replacement_attempt_id') OR OLD.replacement_attempt_id IS NOT NULL) THEN RAISE EXCEPTION 'Replacement grant immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkpoint_definition_history BEFORE UPDATE OR DELETE ON app.checkpoint_definitions FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_history();
CREATE TRIGGER checkpoint_attempt_history BEFORE UPDATE OR DELETE ON app.checkpoint_attempts FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_history();
CREATE TRIGGER checkpoint_outcome_history BEFORE UPDATE OR DELETE ON app.checkpoint_outcomes FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_history();
CREATE TRIGGER checkpoint_grant_history BEFORE UPDATE OR DELETE ON app.checkpoint_replacement_grants FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_history();
-- Immutable normal slots independently enforce the two normal attempt budget.
CREATE UNIQUE INDEX checkpoint_normal_slot ON app.checkpoint_attempts(cohort_id,user_id,node_key,normal_slot) WHERE kind='normal';
ALTER TABLE app.state_events ADD CONSTRAINT state_checkpoint_context CHECK
 ((submission_id IS NOT NULL OR checkpoint_attempt_id IS NOT NULL) AND (job_id IS NULL OR submission_id IS NOT NULL));
--> statement-breakpoint
CREATE FUNCTION app.checkpoint_user(auth_id uuid,cohort uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid;
BEGIN
 SELECT id INTO u FROM app.users WHERE auth_user_id=auth_id AND active AND role='learner';
 PERFORM 1 FROM app.cohort_memberships WHERE cohort_id=cohort AND user_id=u AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'CHECKPOINT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM app.cohorts WHERE id=cohort AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'CHECKPOINT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN u;
END $$;
CREATE FUNCTION app.checkpoint_lock_access(auth_id uuid,cohort uuid) RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE u uuid;
BEGIN
 u:=app.checkpoint_user(auth_id,cohort);
 PERFORM 1 FROM app.users WHERE id=u FOR SHARE;
 PERFORM 1 FROM app.cohort_memberships WHERE cohort_id=cohort AND user_id=u FOR SHARE;
 PERFORM 1 FROM app.cohorts WHERE id=cohort FOR SHARE;
 RETURN app.checkpoint_user(auth_id,cohort);
END $$;
CREATE FUNCTION app.checkpoint_event(a app.checkpoint_attempts,event text,outcome uuid DEFAULT NULL,node text DEFAULT NULL) RETURNS void
LANGUAGE sql SET search_path=pg_catalog AS $$
 INSERT INTO app.activity_events(event_type,event_version,user_id,cohort_id,curriculum_version_id,node_key,checkpoint_attempt_id,checkpoint_outcome_id,correlation_id,payload)
 VALUES(event,1,a.user_id,a.cohort_id,a.curriculum_version_id,coalesce(node,a.node_key),a.id,outcome,a.id,'{}'::jsonb)
$$;
CREATE FUNCTION app.start_checkpoint(auth_id uuid,cohort uuid,node text,request uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid; c app.cohorts; d app.checkpoint_definitions; a app.checkpoint_attempts; prev app.checkpoint_attempts;
 g app.checkpoint_replacement_grants; at_time timestamptz; slot integer; attempt_kind text; snap jsonb; aid uuid:=gen_random_uuid();
BEGIN
 u:=app.checkpoint_user(auth_id,cohort);
 PERFORM pg_advisory_xact_lock(hashtextextended(cohort::text||u::text,4));
 u:=app.checkpoint_lock_access(auth_id,cohort);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE cohort_id=cohort AND user_id=u AND request_id=request;
 IF FOUND THEN IF a.node_key<>node THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF; RETURN a.id; END IF;
 SELECT * INTO c FROM app.cohorts WHERE id=cohort;
 SELECT d0.* INTO d FROM app.checkpoint_definitions d0 JOIN app.curriculum_nodes n USING(curriculum_version_id,node_key)
 JOIN app.curriculum_versions v ON v.id=n.curriculum_version_id
 WHERE d0.curriculum_version_id=c.curriculum_version_id AND d0.node_key=node AND n.kind='checkpoint' AND v.status='published'
 AND d0.definition_digest=n.evaluation_spec_digest;
 IF d.node_key IS NULL OR NOT EXISTS(SELECT FROM app.learner_node_progress WHERE cohort_id=cohort AND user_id=u AND node_key=node AND state IN ('available','in_progress'))
 OR EXISTS(SELECT FROM app.node_prerequisites e LEFT JOIN app.learner_node_progress p ON p.cohort_id=cohort AND p.user_id=u AND p.curriculum_version_id=e.curriculum_version_id AND p.node_key=e.prerequisite_node_key
 WHERE e.curriculum_version_id=c.curriculum_version_id AND e.dependent_node_key=node AND (e.rule<>'requires_pass' OR p.state IS DISTINCT FROM 'mastered'))
 THEN RAISE EXCEPTION 'CHECKPOINT_INELIGIBLE'; END IF;
 IF EXISTS(SELECT FROM app.checkpoint_outcomes WHERE cohort_id=cohort AND user_id=u AND node_key=node AND status='passed') THEN RAISE EXCEPTION 'CHECKPOINT_ALREADY_PASSED'; END IF;
 SELECT * INTO prev FROM app.checkpoint_attempts WHERE cohort_id=cohort AND user_id=u AND node_key=node ORDER BY started_at DESC,id DESC LIMIT 1;
 at_time:=clock_timestamp();
 IF prev.id IS NULL THEN slot:=1; attempt_kind:='normal';
 ELSIF prev.status IN ('active','evaluating') THEN RAISE EXCEPTION 'CHECKPOINT_OPEN';
 ELSIF prev.status='infrastructure_blocked' THEN
 SELECT * INTO g FROM app.checkpoint_replacement_grants WHERE attempt_id=prev.id AND replacement_attempt_id IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHECKPOINT_RECOVERY_REQUIRED'; END IF;
 slot:=prev.normal_slot;attempt_kind:='replacement';
 ELSIF prev.status='failed' AND prev.normal_slot=1 AND prev.completed_at+interval '24 hours'<=at_time THEN slot:=2;attempt_kind:='normal';
 ELSE RAISE EXCEPTION 'CHECKPOINT_RETAKE_UNAVAILABLE'; END IF;
 snap:=jsonb_build_object('definition',d.definition,'definition_digest',d.definition_digest,'attempt_id',aid,'cohort_id',cohort,'learner_id',u,
 'curriculum_version_id',c.curriculum_version_id,'node_key',node,'normal_slot',slot,'kind',attempt_kind,'started_at',to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'deadline_at',to_char((at_time+interval '90 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 INSERT INTO app.checkpoint_attempts(id,cohort_id,user_id,curriculum_version_id,node_key,request_id,definition_digest,snapshot,snapshot_digest,normal_slot,kind,replacement_for,started_at,deadline_at)
 VALUES(aid,cohort,u,c.curriculum_version_id,node,request,d.definition_digest,snap,app.checkpoint_digest(snap,'nextera-checkpoint-attempt'),slot,attempt_kind,CASE WHEN attempt_kind='replacement' THEN prev.id END,at_time,at_time+interval '90 minutes') RETURNING * INTO a;
 IF attempt_kind='replacement' THEN UPDATE app.checkpoint_replacement_grants SET replacement_attempt_id=aid WHERE id=g.id; END IF;
 UPDATE app.learner_node_progress SET state='in_progress',started_at=at_time WHERE cohort_id=cohort AND user_id=u AND node_key=node AND state='available';
 IF FOUND THEN INSERT INTO app.state_events(checkpoint_attempt_id,entity_type,previous_state,next_state,actor_type,reason,correlation_id)
 VALUES(aid,'progress','available','in_progress','system','checkpoint_started',aid); END IF;
 PERFORM app.checkpoint_event(a,'checkpoint_started'); RETURN aid;
END $$;
CREATE FUNCTION app.finish_checkpoint(auth_id uuid,attempt uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; u uuid; at_time timestamptz;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'CHECKPOINT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||u::text,4));
 PERFORM app.checkpoint_lock_access(auth_id,a.cohort_id);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 IF a.status='active' THEN
 at_time:=greatest(clock_timestamp(),a.started_at);
 UPDATE app.checkpoint_attempts SET status='evaluating',closed_at=least(at_time,deadline_at),closure_reason=CASE WHEN at_time>=deadline_at THEN 'expired' ELSE 'finished' END WHERE id=attempt RETURNING * INTO a;
 PERFORM app.checkpoint_event(a,CASE WHEN a.closure_reason='expired' THEN 'checkpoint_expired' ELSE 'checkpoint_finished' END);
 END IF;
 RETURN a.id;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.checkpoint_task_context(auth_id uuid,attempt uuid,task text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; u uuid; item jsonb;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'CHECKPOINT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;
 IF item IS NULL THEN RAISE EXCEPTION 'CHECKPOINT_TASK_UNKNOWN'; END IF;
 RETURN jsonb_build_object('user_id',u,'cohort_id',a.cohort_id,'rules',item->'submissionRules');
END $$;
CREATE FUNCTION app.accept_checkpoint_submission(auth_id uuid,attempt uuid,task text,request_id uuid,filename text,bytes bigint,content_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; ctx jsonb; item jsonb; spec jsonb; rules jsonb; old app.submissions; art app.submission_artifacts;
 sid uuid:=gen_random_uuid();jid uuid:=gen_random_uuid();ordinal bigint;at_time timestamptz;snap jsonb;v app.curriculum_versions; consumed bigint;
BEGIN
 ctx:=app.checkpoint_task_context(auth_id,attempt,task);
 PERFORM pg_advisory_xact_lock(hashtextextended((ctx->>'cohort_id')||(ctx->>'user_id'),4));
 PERFORM app.checkpoint_lock_access(auth_id,(ctx->>'cohort_id')::uuid);
 ctx:=app.checkpoint_task_context(auth_id,attempt,task);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 SELECT * INTO old FROM app.submissions WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND idempotency_key=request_id::text;
 IF FOUND THEN
 SELECT * INTO art FROM app.submission_artifacts WHERE id=old.artifact_id;
 IF old.checkpoint_attempt_id IS DISTINCT FROM attempt OR old.checkpoint_task_key IS DISTINCT FROM task OR art.sha256 IS DISTINCT FROM content_hash OR art.size_bytes IS DISTINCT FROM bytes OR art.original_filename IS DISTINCT FROM filename THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
 RETURN old.id;
 END IF;
 at_time:=clock_timestamp();
 IF a.status<>'active' OR at_time>=a.deadline_at THEN RAISE EXCEPTION 'CHECKPOINT_CLOSED'; END IF;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;
 SELECT count(*) INTO consumed FROM app.submissions WHERE checkpoint_attempt_id=attempt AND checkpoint_task_key=task AND state<>'system_error';
 IF consumed>=3 OR EXISTS(SELECT FROM app.submissions WHERE checkpoint_attempt_id=attempt AND checkpoint_task_key=task AND state='passed') THEN RAISE EXCEPTION 'CHECKPOINT_TASK_QUOTA'; END IF;
 rules:=item->'submissionRules';spec:=item->'evaluationSpec';
 IF bytes NOT BETWEEN 1 AND 262144 OR content_hash !~ '^[0-9a-f]{64}$' OR filename !~ '^[A-Za-z0-9_][A-Za-z0-9_]*[.]go$'
 OR jsonb_array_length(rules->'required_files')<>1 OR rules->'required_files'->>0<>filename OR NOT (rules->'allowed_extensions' ? '.go') OR bytes>(rules->>'max_size_kb')::bigint*1024 THEN RAISE EXCEPTION 'INVALID_ARTIFACT'; END IF;
 IF NOT ((NOT coalesce((spec->>'test_only')::boolean,false) AND spec->>'test_pack_artifact' ~ '^oci://[^/].+@sha256:[0-9a-f]{64}$')
 OR (current_database() LIKE 'foundation_test%' AND spec->>'curriculum_key' LIKE 'foundation-test-only-%' AND spec->>'test_only'='true' AND spec->>'test_pack_artifact' ~ '^oci:///[^@]+@sha256:[0-9a-f]{64}$')) THEN RAISE EXCEPTION 'CHECKPOINT_EVALUATION_UNAPPROVED'; END IF;
 SELECT * INTO v FROM app.curriculum_versions WHERE id=a.curriculum_version_id;
 INSERT INTO app.submission_artifacts(owner_user_id,storage_bucket,storage_key,original_filename,size_bytes,sha256)
 VALUES(a.user_id,'nextera-submissions',auth_id::text||'/'||a.cohort_id::text||'/'||request_id::text||'/'||content_hash,filename,bytes,content_hash) RETURNING * INTO art;
 SELECT count(*)+1 INTO ordinal FROM app.submissions WHERE checkpoint_attempt_id=attempt AND checkpoint_task_key=task;
 snap:=spec||jsonb_build_object('curriculum_version_id',v.id,'git_commit_sha',v.git_commit_sha,'evaluation_spec_digest',item->>'evaluationDigest','learner_id',a.user_id,'cohort_id',a.cohort_id,
 'submission_id',sid,'learner_attempt_ordinal',ordinal,'accepted_at',to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'artifact',jsonb_build_object('id',art.id,'bucket',art.storage_bucket,'key',art.storage_key,'filename',filename,'size_bytes',bytes,'sha256',content_hash));
 INSERT INTO app.submissions(id,cohort_id,user_id,curriculum_version_id,node_key,artifact_id,idempotency_key,evaluation_spec_digest,active_judge_job_id,created_at,checkpoint_attempt_id,checkpoint_task_key)
 VALUES(sid,a.cohort_id,a.user_id,v.id,a.node_key,art.id,request_id::text,item->>'evaluationDigest',jid,at_time,attempt,task);
 INSERT INTO judge.jobs(id,submission_id,protocol_version,evaluation_snapshot,evaluation_digest,created_at)
 VALUES(jid,sid,(snap->>'protocol_version')::integer,snap,app.checkpoint_digest(snap,'nextera-evaluation-snapshot'),at_time);
 INSERT INTO app.state_events(submission_id,job_id,entity_type,next_state,actor_type,reason,correlation_id)
 VALUES(sid,jid,'submission','queued','system','submission_accepted',jid),(sid,jid,'job','queued','system','job_queued',jid);
 RETURN sid;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.finalize_checkpoint(attempt uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; task jsonb; passed_count integer:=0;infra_count integer:=0;pending boolean:=false;has_pass boolean;has_infra boolean;
 outcome_status text;oid uuid;at_time timestamptz;history jsonb;proof jsonb;p app.learner_node_progress;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHECKPOINT_NOT_FOUND'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||a.user_id::text,4));
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
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
CREATE FUNCTION app.announce_checkpoint_retake(attempt uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||a.user_id::text,4));
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 IF a.status='failed' AND a.normal_slot=1 AND a.completed_at+interval '24 hours'<=clock_timestamp() AND a.retake_announced_at IS NULL
 AND NOT EXISTS(SELECT FROM app.checkpoint_attempts WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND node_key=a.node_key AND (started_at>a.started_at OR status='passed'))
 AND EXISTS(SELECT FROM app.users u JOIN app.cohort_memberships m ON m.user_id=u.id JOIN app.cohorts c ON c.id=m.cohort_id WHERE u.id=a.user_id AND u.active AND u.role='learner' AND m.cohort_id=a.cohort_id AND m.status='active' AND c.status='active') THEN
 UPDATE app.checkpoint_attempts SET retake_announced_at=clock_timestamp() WHERE id=attempt;
 PERFORM app.checkpoint_event(a,'checkpoint_retake_available'); END IF;
END $$;
CREATE FUNCTION app.grant_checkpoint_replacement(auth_id uuid,attempt uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;actor app.users;gid uuid;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 SELECT * INTO actor FROM app.users WHERE auth_user_id=auth_id AND active AND role IN ('operator','admin') FOR SHARE;
 IF actor.id IS NULL OR a.id IS NULL OR (actor.role='operator' AND NOT EXISTS(SELECT FROM app.cohort_memberships WHERE cohort_id=a.cohort_id AND user_id=actor.id AND status='active')) THEN RAISE EXCEPTION 'CHECKPOINT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||a.user_id::text,4));
 IF NOT EXISTS(SELECT FROM app.checkpoint_outcomes WHERE attempt_id=attempt AND status='infrastructure_blocked') THEN RAISE EXCEPTION 'CHECKPOINT_NOT_INFRASTRUCTURE_BLOCKED'; END IF;
 SELECT id INTO gid FROM app.checkpoint_replacement_grants WHERE attempt_id=attempt;
 IF FOUND THEN RETURN gid; END IF;
 INSERT INTO app.checkpoint_replacement_grants(attempt_id,actor_user_id,reason) VALUES(attempt,actor.id,'trusted_infrastructure_failure') RETURNING id INTO gid;
 PERFORM app.checkpoint_event(a,'checkpoint_replacement_granted');RETURN gid;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.read_checkpoint(auth_id uuid,cohort uuid,node text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid;v uuid;a app.checkpoint_attempts;tasks jsonb;hist jsonb;attempt_history jsonb;eligible boolean;
BEGIN
 u:=app.checkpoint_user(auth_id,cohort);
 SELECT curriculum_version_id INTO v FROM app.cohorts WHERE id=cohort;
 IF NOT EXISTS(SELECT FROM app.checkpoint_definitions WHERE curriculum_version_id=v AND node_key=node) THEN RAISE EXCEPTION 'CHECKPOINT_NOT_FOUND'; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE cohort_id=cohort AND user_id=u AND node_key=node ORDER BY started_at DESC,id DESC LIMIT 1;
 SELECT state IN ('available','in_progress') INTO eligible FROM app.learner_node_progress WHERE cohort_id=cohort AND user_id=u AND node_key=node;
 IF a.id IS NOT NULL THEN
 SELECT jsonb_agg(jsonb_build_object('key',t->>'key','title',t->>'title','subject',t->>'subjectMarkdown','rules',t->'submissionRules','passed',EXISTS(SELECT FROM app.submissions s WHERE s.checkpoint_attempt_id=a.id AND s.checkpoint_task_key=t->>'key' AND s.state='passed'),'reserved',(SELECT count(*) FROM app.submissions s WHERE s.checkpoint_attempt_id=a.id AND s.checkpoint_task_key=t->>'key' AND s.state<>'system_error')) ORDER BY ord) INTO tasks FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WITH ORDINALITY x(t,ord);
 SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.created_at,h.id),'[]'::jsonb) INTO hist FROM
 (SELECT s.id,s.checkpoint_task_key AS task_key,s.created_at,s.state,CASE WHEN r.application_status='applied' THEN r.learner_feedback END AS feedback
 FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id LEFT JOIN judge.results r ON r.id=j.terminal_result_id
 WHERE s.checkpoint_attempt_id=a.id ORDER BY s.created_at,s.id LIMIT 100) h;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.started_at),'[]'::jsonb) INTO attempt_history FROM
 (SELECT ca.id,ca.normal_slot,ca.kind,ca.started_at,ca.deadline_at,ca.status,ca.completed_at,o.points,o.id AS outcome_id
 FROM app.checkpoint_attempts ca LEFT JOIN app.checkpoint_outcomes o ON o.attempt_id=ca.id WHERE ca.cohort_id=cohort AND ca.user_id=u AND ca.node_key=node) h;
 RETURN jsonb_build_object('server_now',clock_timestamp(),'eligible',coalesce(eligible,false),'attempt',CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,'status',a.status,'normal_slot',a.normal_slot,'kind',a.kind,'started_at',a.started_at,'deadline_at',a.deadline_at,'completed_at',a.completed_at,'retake_at',CASE WHEN a.status='failed' AND a.normal_slot=1 THEN a.completed_at+interval '24 hours' END) END,
 'tasks',coalesce(tasks,'[]'::jsonb),'submissions',coalesce(hist,'[]'::jsonb),'history',attempt_history,
 'replacement_available',EXISTS(SELECT FROM app.checkpoint_replacement_grants WHERE attempt_id=a.id AND replacement_attempt_id IS NULL));
END $$;
--> statement-breakpoint
-- Fix owners and revoke default PUBLIC execution in this same migration transaction.
DO $$ DECLARE temporary boolean:=false; f record; BEGIN
 IF NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET') THEN EXECUTE format('GRANT nextera_checkpoint_owner TO %I',current_user);temporary:=true; END IF;
 GRANT CREATE ON SCHEMA app TO nextera_checkpoint_owner;
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='app' AND p.proname IN ('checkpoint_canonical','checkpoint_digest','checkpoint_user','checkpoint_lock_access','checkpoint_event','start_checkpoint','finish_checkpoint','checkpoint_task_context','accept_checkpoint_submission','finalize_checkpoint','announce_checkpoint_retake','grant_checkpoint_replacement','read_checkpoint') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
 EXECUTE format('ALTER FUNCTION %s OWNER TO nextera_checkpoint_owner',f.signature);
 END LOOP;
 REVOKE ALL ON FUNCTION app.guard_checkpoint_history(),app.guard_checkpoint_definition(),app.guard_checkpoint_publication() FROM PUBLIC;
 REVOKE CREATE ON SCHEMA app FROM nextera_checkpoint_owner;
GRANT EXECUTE ON FUNCTION app.start_checkpoint(uuid,uuid,text,uuid),app.finish_checkpoint(uuid,uuid),app.checkpoint_task_context(uuid,uuid,text),app.accept_checkpoint_submission(uuid,uuid,text,uuid,text,bigint,text),app.read_checkpoint(uuid,uuid,text),app.grant_checkpoint_replacement(uuid,uuid) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.finalize_checkpoint(uuid),app.announce_checkpoint_retake(uuid) TO nextera_result_application;
 IF temporary THEN
 EXECUTE format('REVOKE nextera_checkpoint_owner FROM %I GRANTED BY %I',current_user,current_user);
 IF pg_has_role(current_user,'nextera_checkpoint_owner','SET') THEN RAISE EXCEPTION 'Temporary checkpoint owner access remains'; END IF;
 END IF;
END $$;
