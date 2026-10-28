-- REVIEW DRAFT ONLY. Source preparation, not registered, applied, published or live verified.
-- Successor to registered0006/0007; do not edit or rerun historical migration files.
-- No selected exam counts/thresholds: v2 reads them from an explicit frozen definition.
-- Legacy v1 remains four tasks/pass three. Duration/quota/slots/cooldown/access are unchanged.
-- Runtime adapters/UI must consume the returned policy before v2 publication is approved.
-- Compatibility/review: no historical rows or frozen JSON/digests are rewritten.
-- Legacy valid outcome proofs retain policy_version=1 and their original field shape.
-- Constraint validation can reject corrupt/unversioned historical evidence; repair is NOT implicit.
-- Registered Drizzle schema/index.ts intentionally remains v1 until approved migration promotion.
-- Current TS CheckpointView/UI omit policy metadata; update/readiness-check them before v2 use.
-- Source/static tests are not PostgreSQL parsing, concurrency, grants or live-result evidence.
-- Rollback before COMMIT restores the old contract atomically. After any v2 evidence exists,
-- do not reinstall v1-only constraints/functions or delete history; use a reviewed forward fix.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ DECLARE sig text; BEGIN
 IF to_regclass('app.checkpoint_attempts') IS NULL OR to_regclass('app.checkpoint_definitions') IS NULL
 OR to_regclass('app.checkpoint_outcomes') IS NULL
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner')
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_web')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_result_application') THEN
 RAISE EXCEPTION 'Approved isolated checkpoint migration context required'; END IF;
 IF to_regprocedure('app.checkpoint_policy_contract_v2()') IS NOT NULL
 OR to_regprocedure('app.checkpoint_policy_v2(jsonb)') IS NOT NULL
 OR to_regprocedure('app.checkpoint_attempt_policy_v2(app.checkpoint_attempts)') IS NOT NULL
 OR to_regprocedure('app.guard_checkpoint_outcome_policy_v2()') IS NOT NULL THEN
 RAISE EXCEPTION 'Checkpoint v2 objects already exist; review migration state'; END IF;
 FOREACH sig IN ARRAY ARRAY['app.start_checkpoint(uuid,uuid,text,uuid)','app.checkpoint_task_context(uuid,uuid,text)',
 'app.finalize_checkpoint(uuid)','app.read_checkpoint(uuid,uuid,text)'] LOOP
 IF NOT EXISTS(SELECT FROM pg_proc f JOIN pg_roles r ON r.oid=f.proowner
 WHERE f.oid=to_regprocedure(sig) AND r.rolname='nextera_checkpoint_owner' AND f.prosecdef
 AND f.proconfig @> ARRAY['search_path=pg_catalog']) THEN
 RAISE EXCEPTION 'Unexpected checkpoint operation ownership or security context'; END IF;
 END LOOP;
END $$;

-- Pure internal policy decoder. No v2 fallback to a global passing threshold.
CREATE FUNCTION app.checkpoint_policy_v2(definition jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE task_count integer;required_points integer;
BEGIN
 IF definition IS NULL OR jsonb_typeof(definition)<>'object'
 OR jsonb_typeof(definition->'tasks') IS DISTINCT FROM 'array'
 OR definition->>'durationSeconds' IS DISTINCT FROM '5400' THEN
 RAISE EXCEPTION 'CHECKPOINT_POLICY_UNAVAILABLE'; END IF;
 task_count:=jsonb_array_length(definition->'tasks');
 IF definition->>'policyVersion'='1' THEN
 IF task_count<>4 THEN RAISE EXCEPTION 'CHECKPOINT_POLICY_UNAVAILABLE'; END IF;
 -- This branch preserves historical v1 scoring, not a new policy/default.
 RETURN jsonb_build_object('policy_version',1,'task_count',4,'pass_points',3);
 END IF;
 IF definition->>'policyVersion' IS DISTINCT FROM '2'
 OR jsonb_typeof(definition->'policyVersion') IS DISTINCT FROM 'number'
 OR jsonb_typeof(definition->'durationSeconds') IS DISTINCT FROM 'number'
 OR task_count<1 OR jsonb_typeof(definition->'passPoints') IS DISTINCT FROM 'number'
 OR (definition->>'passPoints') !~ '^[1-9][0-9]*$' THEN
 RAISE EXCEPTION 'CHECKPOINT_POLICY_UNAVAILABLE'; END IF;
 IF (definition->>'passPoints')::numeric NOT BETWEEN 1 AND task_count THEN
 RAISE EXCEPTION 'CHECKPOINT_POLICY_UNAVAILABLE'; END IF;
 required_points:=(definition->>'passPoints')::integer;
 RETURN jsonb_build_object('policy_version',2,'task_count',task_count,'pass_points',required_points);
END $$;

-- Read policy only from the immutable attempt snapshot, never today's definition row.
CREATE FUNCTION app.checkpoint_attempt_policy_v2(a app.checkpoint_attempts) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$ BEGIN
 IF a.id IS NULL OR a.snapshot IS NULL OR jsonb_typeof(a.snapshot) IS DISTINCT FROM 'object'
 OR a.snapshot->>'attempt_id' IS DISTINCT FROM a.id::text
 OR a.snapshot->>'cohort_id' IS DISTINCT FROM a.cohort_id::text
 OR a.snapshot->>'learner_id' IS DISTINCT FROM a.user_id::text
 OR a.snapshot->>'curriculum_version_id' IS DISTINCT FROM a.curriculum_version_id::text
 OR a.snapshot->>'node_key' IS DISTINCT FROM a.node_key
 OR a.snapshot->>'definition_digest' IS DISTINCT FROM a.definition_digest
 OR a.snapshot->>'normal_slot' IS DISTINCT FROM a.normal_slot::text
 OR a.snapshot->>'kind' IS DISTINCT FROM a.kind
 OR (a.snapshot->>'started_at')::timestamptz IS DISTINCT FROM a.started_at
 OR (a.snapshot->>'deadline_at')::timestamptz IS DISTINCT FROM a.deadline_at
 OR a.snapshot_digest IS DISTINCT FROM app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt') THEN
 RAISE EXCEPTION 'CHECKPOINT_SNAPSHOT_IDENTITY_CONFLICT'; END IF;
 RETURN app.checkpoint_policy_v2(a.snapshot->'definition');
END $$;

-- Inline constraints avoid granting EXECUTE on internal helpers to table writers.
-- CASE makes type/number checks precede casts; NULL is never accepted as valid policy.
ALTER TABLE app.checkpoint_definitions DROP CONSTRAINT checkpoint_definition_policy;
ALTER TABLE app.checkpoint_definitions ADD CONSTRAINT checkpoint_definition_policy CHECK (
 coalesce(CASE WHEN jsonb_typeof(definition)='object' AND jsonb_typeof(definition->'tasks')='array' THEN
 CASE WHEN definition->>'policyVersion'='1' AND definition->>'durationSeconds'='5400' THEN jsonb_array_length(definition->'tasks')=4
 WHEN definition->>'policyVersion'='2' AND jsonb_typeof(definition->'policyVersion')='number'
 AND definition->>'durationSeconds'='5400' AND jsonb_typeof(definition->'durationSeconds')='number'
 AND jsonb_typeof(definition->'passPoints')='number' AND definition->>'passPoints' ~ '^[1-9][0-9]*$'
 THEN jsonb_array_length(definition->'tasks')>0 AND (definition->>'passPoints')::numeric BETWEEN 1 AND jsonb_array_length(definition->'tasks')
 ELSE false END ELSE false END,false)) NOT VALID;
ALTER TABLE app.checkpoint_definitions VALIDATE CONSTRAINT checkpoint_definition_policy;

ALTER TABLE app.checkpoint_outcomes DROP CONSTRAINT checkpoint_outcome_score;
ALTER TABLE app.checkpoint_outcomes ADD CONSTRAINT checkpoint_outcome_score CHECK (
 coalesce(CASE WHEN evidence->>'policy_version'='1' THEN
 points BETWEEN 0 AND 4 AND ((status='passed' AND points>=3) OR (status IN ('failed','infrastructure_blocked') AND points<3))
 WHEN evidence->>'policy_version'='2' AND jsonb_typeof(evidence->'policy_version')='number'
 AND jsonb_typeof(evidence->'task_count')='number' AND evidence->>'task_count' ~ '^[1-9][0-9]*$'
 AND jsonb_typeof(evidence->'pass_points')='number' AND evidence->>'pass_points' ~ '^[1-9][0-9]*$' THEN
 (evidence->>'task_count')::numeric<=2147483647
 AND (evidence->>'pass_points')::numeric BETWEEN 1 AND (evidence->>'task_count')::numeric
 AND points BETWEEN 0 AND (evidence->>'task_count')::numeric
 AND ((status='passed' AND points>=(evidence->>'pass_points')::numeric)
 OR (status IN ('failed','infrastructure_blocked') AND points<(evidence->>'pass_points')::numeric))
 ELSE false END,false)) NOT VALID;
ALTER TABLE app.checkpoint_outcomes VALIDATE CONSTRAINT checkpoint_outcome_score;

CREATE OR REPLACE FUNCTION app.guard_checkpoint_definition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE n app.curriculum_nodes;v app.curriculum_versions;task_count integer;
BEGIN
 SELECT * INTO n FROM app.curriculum_nodes WHERE curriculum_version_id=NEW.curriculum_version_id AND node_key=NEW.node_key;
 SELECT * INTO v FROM app.curriculum_versions WHERE id=NEW.curriculum_version_id;
 task_count:=jsonb_array_length(NEW.definition->'tasks');
 IF v.status IS DISTINCT FROM 'draft' OR n.kind IS DISTINCT FROM 'checkpoint'
 OR n.evaluation_spec_digest IS DISTINCT FROM NEW.definition_digest
 OR n.resolved_evaluation_spec->'checkpoint_definition' IS DISTINCT FROM NEW.definition
 OR task_count IS NULL OR task_count<1
 OR (SELECT count(DISTINCT value->>'key') FROM jsonb_array_elements(NEW.definition->'tasks'))<>task_count
 OR (SELECT count(DISTINCT value->>'testPackId') FROM jsonb_array_elements(NEW.definition->'tasks'))<>task_count
 THEN RAISE EXCEPTION 'Invalid committed checkpoint definition'; END IF;
 RETURN NEW;
END $$;

-- New outcomes must bind their scoring metadata and digest to the frozen attempt.
-- Existing outcome bytes are never updated/recomputed; v1 proof shape stays identical.
CREATE FUNCTION app.guard_checkpoint_outcome_policy_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;scoring jsonb;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=NEW.attempt_id;
 scoring:=app.checkpoint_attempt_policy_v2(a);
 IF NEW.cohort_id IS DISTINCT FROM a.cohort_id OR NEW.user_id IS DISTINCT FROM a.user_id
 OR NEW.curriculum_version_id IS DISTINCT FROM a.curriculum_version_id OR NEW.node_key IS DISTINCT FROM a.node_key
 OR NEW.evidence->>'snapshot_digest' IS DISTINCT FROM a.snapshot_digest
 OR NEW.evidence->'policy_version' IS DISTINCT FROM scoring->'policy_version'
 OR NEW.evidence->'points' IS DISTINCT FROM to_jsonb(NEW.points)
 OR NEW.evidence->>'status' IS DISTINCT FROM NEW.status
 OR NEW.evidence_digest IS DISTINCT FROM app.checkpoint_digest(NEW.evidence,'nextera-checkpoint-outcome') THEN
 RAISE EXCEPTION 'CHECKPOINT_OUTCOME_IDENTITY_CONFLICT'; END IF;
 IF scoring->>'policy_version'='2' THEN
 IF NEW.evidence->'task_count' IS DISTINCT FROM scoring->'task_count'
 OR NEW.evidence->'pass_points' IS DISTINCT FROM scoring->'pass_points' THEN
 RAISE EXCEPTION 'CHECKPOINT_OUTCOME_POLICY_CONFLICT'; END IF;
 ELSIF NEW.evidence ? 'task_count' OR NEW.evidence ? 'pass_points' THEN
 RAISE EXCEPTION 'CHECKPOINT_LEGACY_PROOF_SHAPE_CONFLICT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkpoint_outcome_policy_v2 BEFORE INSERT ON app.checkpoint_outcomes
FOR EACH ROW EXECUTE FUNCTION app.guard_checkpoint_outcome_policy_v2();

CREATE OR REPLACE FUNCTION app.start_checkpoint(auth_id uuid,cohort uuid,node text,request uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
  PERFORM app.checkpoint_policy_v2(d.definition);
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

CREATE OR REPLACE FUNCTION app.checkpoint_task_context(auth_id uuid,attempt uuid,task text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; u uuid; item jsonb;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'CHECKPOINT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM app.checkpoint_attempt_policy_v2(a);
  SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;
 IF item IS NULL THEN RAISE EXCEPTION 'CHECKPOINT_TASK_UNKNOWN'; END IF;
 RETURN jsonb_build_object('user_id',u,'cohort_id',a.cohort_id,'rules',item->'submissionRules');
END $$;

CREATE OR REPLACE FUNCTION app.finalize_checkpoint(attempt uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; task jsonb; passed_count integer:=0;infra_count integer:=0;pending boolean:=false;has_pass boolean;has_infra boolean;
 scoring jsonb;required_points integer;outcome_status text;oid uuid;at_time timestamptz;history jsonb;proof jsonb;p app.learner_node_progress;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHECKPOINT_NOT_FOUND'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||a.user_id::text,4));
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 SELECT id INTO oid FROM app.checkpoint_outcomes WHERE attempt_id=attempt;
 IF FOUND THEN RETURN oid; END IF;
  scoring:=app.checkpoint_attempt_policy_v2(a);
  required_points:=(scoring->>'pass_points')::integer;
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
 outcome_status:=CASE WHEN passed_count>=required_points THEN 'passed' WHEN passed_count+infra_count>=required_points THEN 'infrastructure_blocked' ELSE 'failed' END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('submission_id',s.id,'task_key',s.checkpoint_task_key,'job_id',j.id,'result_id',r.id,'evaluation_digest',j.evaluation_digest,'verdict',r.verdict,'processed_at',r.processed_at) ORDER BY s.checkpoint_task_key,s.created_at,s.id),'[]'::jsonb) INTO history
 FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id JOIN judge.results r ON r.id=j.terminal_result_id AND r.application_status='applied' WHERE s.checkpoint_attempt_id=attempt;
 SELECT greatest(at_time,a.closed_at,max(r.processed_at)) INTO at_time FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id JOIN judge.results r ON r.id=j.terminal_result_id WHERE s.checkpoint_attempt_id=attempt;
 IF scoring->>'policy_version'='1' THEN
  proof:=jsonb_build_object('snapshot_digest',a.snapshot_digest,'policy_version',1,'points',passed_count,'status',outcome_status,'results',history);
  ELSE
  proof:=jsonb_build_object('snapshot_digest',a.snapshot_digest,'policy_version',2,'task_count',(scoring->>'task_count')::integer,'pass_points',required_points,'points',passed_count,'status',outcome_status,'results',history);
  END IF;
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

CREATE OR REPLACE FUNCTION app.read_checkpoint(auth_id uuid,cohort uuid,node text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE scoring jsonb;definition jsonb;u uuid;v uuid;a app.checkpoint_attempts;tasks jsonb;hist jsonb;attempt_history jsonb;eligible boolean;
BEGIN
 u:=app.checkpoint_user(auth_id,cohort);
 SELECT curriculum_version_id INTO v FROM app.cohorts WHERE id=cohort;
 IF NOT EXISTS(SELECT FROM app.checkpoint_definitions WHERE curriculum_version_id=v AND node_key=node) THEN RAISE EXCEPTION 'CHECKPOINT_NOT_FOUND'; END IF;
 SELECT d.definition INTO definition FROM app.checkpoint_definitions d WHERE d.curriculum_version_id=v AND d.node_key=node;
  SELECT * INTO a FROM app.checkpoint_attempts WHERE cohort_id=cohort AND user_id=u AND node_key=node ORDER BY started_at DESC,id DESC LIMIT 1;
  scoring:=CASE WHEN a.id IS NOT NULL THEN app.checkpoint_attempt_policy_v2(a) ELSE app.checkpoint_policy_v2(definition) END;
 SELECT state IN ('available','in_progress') INTO eligible FROM app.learner_node_progress WHERE cohort_id=cohort AND user_id=u AND node_key=node;
 IF a.id IS NOT NULL THEN
 SELECT jsonb_agg(jsonb_build_object('key',t->>'key','title',t->>'title','subject',t->>'subjectMarkdown','rules',t->'submissionRules','passed',EXISTS(SELECT FROM app.submissions s WHERE s.checkpoint_attempt_id=a.id AND s.checkpoint_task_key=t->>'key' AND s.state='passed'),'reserved',(SELECT count(*) FROM app.submissions s WHERE s.checkpoint_attempt_id=a.id AND s.checkpoint_task_key=t->>'key' AND s.state<>'system_error')) ORDER BY ord) INTO tasks FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WITH ORDINALITY x(t,ord);
 SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.created_at,h.id),'[]'::jsonb) INTO hist FROM
 (SELECT s.id,s.checkpoint_task_key AS task_key,s.created_at,s.state,CASE WHEN r.application_status='applied' THEN r.learner_feedback END AS feedback
 FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id LEFT JOIN judge.results r ON r.id=j.terminal_result_id
 WHERE s.checkpoint_attempt_id=a.id ORDER BY s.created_at,s.id LIMIT 100) h;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.started_at),'[]'::jsonb) INTO attempt_history FROM
 (SELECT ca.id,ca.normal_slot,ca.kind,ca.started_at,ca.deadline_at,ca.status,ca.completed_at,o.points,o.id AS outcome_id,app.checkpoint_attempt_policy_v2(ca) AS policy
 FROM app.checkpoint_attempts ca LEFT JOIN app.checkpoint_outcomes o ON o.attempt_id=ca.id WHERE ca.cohort_id=cohort AND ca.user_id=u AND ca.node_key=node) h;
 RETURN jsonb_build_object('policy',scoring,'server_now',clock_timestamp(),'eligible',coalesce(eligible,false),'attempt',CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,'status',a.status,'normal_slot',a.normal_slot,'kind',a.kind,'started_at',a.started_at,'deadline_at',a.deadline_at,'completed_at',a.completed_at,'retake_at',CASE WHEN a.status='failed' AND a.normal_slot=1 THEN a.completed_at+interval '24 hours' END) END,
 'tasks',coalesce(tasks,'[]'::jsonb),'submissions',coalesce(hist,'[]'::jsonb),'history',attempt_history,
 'replacement_available',EXISTS(SELECT FROM app.checkpoint_replacement_grants WHERE attempt_id=a.id AND replacement_attempt_id IS NULL));
END $$;


-- Keep the original committed-definition publication check; additionally require
-- this complete installed contract for explicitly authored v2 definitions.
CREATE OR REPLACE FUNCTION app.guard_checkpoint_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.status='published' AND OLD.status<>'published' THEN
 IF EXISTS(SELECT FROM app.curriculum_nodes n LEFT JOIN app.checkpoint_definitions d USING(curriculum_version_id,node_key)
 WHERE n.curriculum_version_id=NEW.id AND n.kind='checkpoint' AND (d.node_key IS NULL OR d.definition_digest<>n.evaluation_spec_digest)) THEN
 RAISE EXCEPTION 'Publication requires every committed checkpoint definition'; END IF;
 IF EXISTS(SELECT FROM app.checkpoint_definitions d WHERE d.curriculum_version_id=NEW.id AND d.definition->>'policyVersion'='2') AND
 (NOT EXISTS(SELECT FROM pg_proc f JOIN pg_roles r ON r.oid=f.proowner
 WHERE f.oid=to_regprocedure('app.checkpoint_policy_contract_v2()') AND r.rolname='nextera_checkpoint_owner'
 AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND f.prosecdef AND f.provolatile='i'
 AND f.proconfig @> ARRAY['search_path=pg_catalog'])
 OR to_regprocedure('app.checkpoint_policy_v2(jsonb)') IS NULL
 OR to_regprocedure('app.checkpoint_attempt_policy_v2(app.checkpoint_attempts)') IS NULL
 OR NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='app.checkpoint_outcomes'::regclass
 AND tgname='checkpoint_outcome_policy_v2' AND tgenabled='O' AND NOT tgisinternal)) THEN
 RAISE EXCEPTION 'CHECKPOINT_POLICY_V2_NOT_READY'; END IF;
 END IF;RETURN NEW;
END $$;

-- Additive installation marker only. It does not attest adapters, content, live testing or approval.
CREATE FUNCTION app.checkpoint_policy_contract_v2() RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('contract','checkpoint-policy-v2','versions',jsonb_build_array(1,2),'runtime_verified',false)
$$;

GRANT CREATE ON SCHEMA app TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_policy_v2(jsonb) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_attempt_policy_v2(app.checkpoint_attempts) OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.guard_checkpoint_outcome_policy_v2() OWNER TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_policy_contract_v2() OWNER TO nextera_checkpoint_owner;
REVOKE CREATE ON SCHEMA app FROM nextera_checkpoint_owner;
REVOKE ALL ON FUNCTION app.checkpoint_policy_v2(jsonb),app.checkpoint_attempt_policy_v2(app.checkpoint_attempts),
 app.guard_checkpoint_outcome_policy_v2(),app.checkpoint_policy_contract_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.checkpoint_policy_contract_v2() TO nextera_web,nextera_result_application;
-- Existing operation owners/ACLs are retained by CREATE OR REPLACE, not widened.
-- Unchanged functions: finish_checkpoint, accept_checkpoint_submission, checkpoint_user,
-- checkpoint_lock_access, grant_checkpoint_replacement, announce_checkpoint_retake,
-- checkpoint_canonical/checkpoint_digest and every history/immutability trigger.
-- 0014 editor context remains separate; its three-submission quota is not a task-count limit.
COMMIT;
