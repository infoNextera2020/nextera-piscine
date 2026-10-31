-- REVIEW DRAFT ONLY. Source-only, unregistered/unapplied, native PostgreSQL UNVERIFIED.
-- Requires0000-0010 and reviewed0011/0014/0021/0022/0024/0025/0026. Do NOT apply0017.
-- Marked Exam1 only: technical policyVersion3, eight mixed questions,10800seconds,
-- one normal attempt, no replacement. Unmarked registered behavior stays byte-identical.
-- No curriculum, calendar, mentor IDs, numeric allowance/rates, roles or credentials seeded.
-- Fresh disposable controller must prove scope before the already-held direct DBA span.
-- It must also bind the ORIGINAL registered migration actor from its reviewed
-- immutable scope as nextera.scored_exam_0027_migration_actor. Never infer/adopt it
-- from a currently observed function owner. This audit input grants no authority.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'scored-exam-0027-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin)
 OR nullif(current_setting('nextera.scored_exam_0027_migration_actor',true),'') IS NULL
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_setting('nextera.scored_exam_0027_migration_actor',true)
 AND (rolname=current_user OR (NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)))
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner')
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')
 OR NOT has_schema_privilege('nextera_checkpoint_owner','app','CREATE')
 OR to_regprocedure('app.scored_exam_intake_context(uuid,uuid,text)') IS NULL
 OR to_regprocedure('app.checkpoint_answer_submission_context(uuid,uuid,uuid,text)') IS NULL
 OR to_regclass('app.exam_scoring_assignments') IS NULL
 OR to_regclass('app.exam_scoring_closures') IS NULL
 OR NOT EXISTS(SELECT FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=to_regprocedure('app.finalize_checkpoint(uuid)') AND r.rolname='nextera_checkpoint_owner' AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog'] AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='792fafffa1021857fc8ed97eaa05dc1861c0d412850b4efddedd5b503102073e')
 OR NOT EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid='app.checkpoint_answer_receipts'::regclass AND t.tgname='exam_scoring_capture_structured' AND t.tgfoid=to_regprocedure('app.capture_exam_scoring_acceptance()') AND t.tgenabled='O' AND NOT t.tgisinternal)
 OR NOT EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid='app.checkpoint_attempts'::regclass AND t.tgname='exam_scoring_capture_closure' AND t.tgfoid=to_regprocedure('app.capture_exam_scoring_closure()') AND t.tgenabled='O' AND NOT t.tgisinternal)
 OR to_regprocedure('app.checkpoint_policy_contract_v2()') IS NOT NULL THEN
 RAISE EXCEPTION 'Reviewed fresh isolated lifecycle prerequisites required'; END IF;
END $$;
-- Pin replaced functions before any edit; unexpected prior migration order fails closed.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('app.start_checkpoint(uuid,uuid,text,uuid)','56d5ec80f12b81b54ec8948a920b9959843a11c27b66f60294477a285d195d43'),
 ('app.read_checkpoint(uuid,uuid,text)','a1ad068fd7de11e089ab9935d9a2b871897a46c723bacf834f2ab5ee319046cf'),
 ('app.checkpoint_task_context(uuid,uuid,text)','2b3e32855df31e044ccbb90c007fc1eac07c28b6ee5374381a2566484ff2a8ca'),
 ('app.guard_checkpoint_definition()','5d001ec4bfa3b31a3f9446b4026736e019e4503bb44f35f65e68736eb5a24a0b'),
 ('app.guard_checkpoint_publication()','85e4f870052a667887b2820d71310ce8b1e3fa0bae3a70652b1e7033365b7ea9'),
 ('app.grant_checkpoint_replacement(uuid,uuid)','f63739e30b21e82245f8a9733c5e63fdb04bef6567283687c9a8f3d100c262c2'),
 ('app.announce_checkpoint_retake(uuid)','6cab78e4b19d98af5bb7253f6a1b4ad4b76916c70133c02dba098f7eb0a3071a'),
 ('app.checkpoint_editor_context(uuid,uuid,text)','177abba39d83def4c92860f288bedd5438b601c1641902c2d5f4894f49657589')
 ) expected(signature,source_sha256) LOOP
 IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_roles owner_role ON owner_role.oid=p.proowner WHERE p.oid=to_regprocedure(r.signature)
 AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=r.source_sha256
 AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.prokind='f' AND NOT p.proisstrict AND p.provolatile='v'
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 AND owner_role.rolname=CASE WHEN r.signature IN ('app.guard_checkpoint_definition()','app.guard_checkpoint_publication()') THEN current_setting('nextera.scored_exam_0027_migration_actor',true) ELSE 'nextera_checkpoint_owner' END
 AND p.prosecdef=(r.signature NOT IN ('app.guard_checkpoint_definition()','app.guard_checkpoint_publication()'))
 AND p.prorettype=CASE WHEN r.signature IN ('app.guard_checkpoint_definition()','app.guard_checkpoint_publication()') THEN 'pg_catalog.trigger'::regtype WHEN r.signature IN ('app.start_checkpoint(uuid,uuid,text,uuid)','app.grant_checkpoint_replacement(uuid,uuid)') THEN 'pg_catalog.uuid'::regtype WHEN r.signature='app.announce_checkpoint_retake(uuid)' THEN 'pg_catalog.void'::regtype ELSE 'pg_catalog.jsonb'::regtype END
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner AND (a.grantee=0 OR a.is_grantable OR r.signature IN ('app.guard_checkpoint_definition()','app.guard_checkpoint_publication()') OR a.grantee<>(SELECT oid FROM pg_roles WHERE rolname=CASE WHEN r.signature='app.announce_checkpoint_retake(uuid)' THEN 'nextera_result_application' ELSE 'nextera_web' END)))
 AND (r.signature IN ('app.guard_checkpoint_definition()','app.guard_checkpoint_publication()') OR EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname=CASE WHEN r.signature='app.announce_checkpoint_retake(uuid)' THEN 'nextera_result_application' ELSE 'nextera_web' END) AND a.privilege_type='EXECUTE' AND NOT a.is_grantable))) THEN
 RAISE EXCEPTION 'Lifecycle source prerequisite changed'; END IF;
 END LOOP;
END $$;
CREATE TEMP TABLE scored_exam_prior_rpc ON COMMIT DROP AS
 SELECT p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig FROM pg_proc p
 WHERE p.oid=ANY(ARRAY['app.start_checkpoint(uuid,uuid,text,uuid)'::regprocedure,
 'app.read_checkpoint(uuid,uuid,text)'::regprocedure,'app.checkpoint_task_context(uuid,uuid,text)'::regprocedure,
 'app.checkpoint_editor_context(uuid,uuid,text)'::regprocedure,'app.guard_checkpoint_definition()'::regprocedure,
 'app.guard_checkpoint_publication()'::regprocedure,'app.grant_checkpoint_replacement(uuid,uuid)'::regprocedure,'app.announce_checkpoint_retake(uuid)'::regprocedure]::oid[]);

SET LOCAL ROLE nextera_checkpoint_owner;
CREATE FUNCTION app.scored_exam_definition_valid(d jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE item jsonb;kind text;seen text[]:=ARRAY[]::text[];rules jsonb;marker jsonb;question_ordinal integer:=0;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d->'policyVersion' IS DISTINCT FROM '3'::jsonb
 OR d->'durationSeconds' IS DISTINCT FROM '10800'::jsonb
 OR jsonb_typeof(d->'tasks') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'tasks')<>8 THEN RETURN false;END IF;
 marker:=d->'examScoring';
 IF jsonb_typeof(marker) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(marker))<>3
 OR marker->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(marker->'form') IS DISTINCT FROM 'string'
 OR marker->>'form' NOT IN ('A','B','C','D') OR jsonb_typeof(marker->'rubricDigest') IS DISTINCT FROM 'string'
 OR marker->>'rubricDigest' !~ '^[0-9a-f]{64}$' THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(d->'tasks') LOOP
 question_ordinal:=question_ordinal+1;
 IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'key') IS DISTINCT FROM 'string'
 OR item->>'key' IS DISTINCT FROM 'q'||question_ordinal::text OR item->>'key'=ANY(seen)
 OR jsonb_typeof(item->'title') IS DISTINCT FROM 'string' OR length(item->>'title')=0
 OR jsonb_typeof(item->'subjectMarkdown') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 kind:=CASE WHEN item->>'key'='q8' THEN 'debug_with_reason' WHEN item->>'key' IN ('q6','q7') THEN 'trace_with_reason' ELSE 'coding' END;
 IF item->'answerFormat' IS DISTINCT FROM jsonb_build_object('version',1,'kind',kind) THEN RETURN false;END IF;
 rules:=item->'submissionRules';
 IF jsonb_typeof(rules) IS DISTINCT FROM 'object' OR jsonb_typeof(rules->'required_files') IS DISTINCT FROM 'array'
 OR jsonb_typeof(rules->'max_size_kb') IS DISTINCT FROM 'number' OR rules->>'max_size_kb' !~ '^[1-9][0-9]*$'
 OR (rules->>'max_size_kb')::numeric>2147483647 THEN RETURN false;END IF;
 IF kind='trace_with_reason' THEN
 IF jsonb_array_length(rules->'required_files')<>0 THEN RETURN false;END IF;
 ELSE
 IF jsonb_array_length(rules->'required_files')<>1 OR jsonb_typeof(rules->'required_files'->0) IS DISTINCT FROM 'string'
 OR rules->'required_files'->>0 !~ '^[A-Za-z0-9_]+[.]go$' THEN RETURN false;END IF;
 END IF;
 IF kind<>'coding' AND (jsonb_typeof(item->'answerContract') IS DISTINCT FROM 'object'
 OR item->'answerContract'->'version' IS DISTINCT FROM '1'::jsonb
 OR item->'answerContract'->>'kind' IS DISTINCT FROM kind
 OR jsonb_typeof(item->'answerEvaluator') IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM jsonb_object_keys(item->'answerEvaluator'))<>7
 OR NOT (item->'answerEvaluator' ?& ARRAY['family','version','kind','definitionDigest','taskKey','evaluatorKey','evaluatorDigest'])
 OR item->'answerEvaluator'->>'family' IS DISTINCT FROM 'checkpoint_structured_answer'
 OR item->'answerEvaluator'->'version' IS DISTINCT FROM '1'::jsonb
 OR item->'answerEvaluator'->>'kind' IS DISTINCT FROM kind
 OR item->'answerEvaluator'->>'taskKey' IS DISTINCT FROM item->>'key'
 OR jsonb_typeof(item->'answerEvaluator'->'definitionDigest') IS DISTINCT FROM 'string'
 OR item->'answerEvaluator'->>'definitionDigest' !~ '^[0-9a-f]{64}$') THEN RETURN false;END IF;
 seen:=array_append(seen,item->>'key');
 END LOOP;
 RETURN cardinality(seen)=8;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
-- Break recursive bindings with exactly four omitted leaves: marker.rubricDigest
-- and the three typed evaluator definitionDigest self-bindings. Every other field
-- remains. Guard/start/snapshot validation requires each typed binding equal core.
CREATE FUNCTION app.scored_exam_definition_core(spec jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$ BEGIN
 IF jsonb_typeof(spec) IS DISTINCT FROM 'object' OR NOT app.scored_exam_definition_valid(spec->'checkpoint_definition') THEN
 RAISE EXCEPTION 'Scored full definition unavailable';END IF;
 RETURN app.checkpoint_digest(spec #- '{checkpoint_definition,examScoring,rubricDigest}'
 #- '{checkpoint_definition,tasks,5,answerEvaluator,definitionDigest}'
 #- '{checkpoint_definition,tasks,6,answerEvaluator,definitionDigest}'
 #- '{checkpoint_definition,tasks,7,answerEvaluator,definitionDigest}','nextera-scored-exam-definition-core');
END $$;

CREATE TABLE app.scored_exam_lifecycle_policies (
 cohort_id uuid NOT NULL,user_id uuid NOT NULL,curriculum_version_id uuid NOT NULL,node_key text NOT NULL,
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 rubric_digest text NOT NULL REFERENCES app.exam_scoring_rubrics(rubric_digest) ON DELETE RESTRICT,
 primary_mentor_id uuid NOT NULL,secondary_mentor_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,
 PRIMARY KEY(cohort_id,user_id,curriculum_version_id,node_key,definition_digest),
 CHECK(primary_mentor_id<>secondary_mentor_id AND user_id<>primary_mentor_id AND user_id<>secondary_mentor_id)
);
CREATE FUNCTION app.guard_scored_exam_lifecycle_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE used boolean;BEGIN
 SELECT EXISTS(SELECT FROM app.checkpoint_attempts WHERE cohort_id=OLD.cohort_id AND user_id=OLD.user_id AND curriculum_version_id=OLD.curriculum_version_id AND node_key=OLD.node_key AND definition_digest=OLD.definition_digest) INTO used;
 IF TG_OP='DELETE' THEN IF OLD.enabled OR used THEN RAISE EXCEPTION 'Retained lifecycle policy';END IF;RETURN OLD;END IF;
 IF (OLD.enabled OR used) AND (to_jsonb(OLD)-'enabled') IS DISTINCT FROM (to_jsonb(NEW)-'enabled') THEN RAISE EXCEPTION 'Frozen lifecycle policy';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scored_exam_lifecycle_policy_immutable BEFORE UPDATE OR DELETE ON app.scored_exam_lifecycle_policies FOR EACH ROW EXECUTE FUNCTION app.guard_scored_exam_lifecycle_policy();

CREATE FUNCTION app.scored_exam_attempt_metadata(a app.checkpoint_attempts) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE x app.exam_scoring_assignments;r app.exam_scoring_rubrics;b jsonb;spec jsonb;
BEGIN
 SELECT * INTO x FROM app.exam_scoring_assignments WHERE attempt_id=a.id;
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=x.rubric_digest;
 spec:=a.snapshot->'evaluation_spec';
 IF a.id IS NULL OR NOT coalesce(app.scored_exam_definition_valid(a.snapshot->'definition'),false)
 OR a.normal_slot<>1 OR a.kind<>'normal' OR a.replacement_for IS NOT NULL OR a.deadline_at<>a.started_at+interval '180 minutes'
 OR a.snapshot->>'attempt_id' IS DISTINCT FROM a.id::text OR a.snapshot->>'cohort_id' IS DISTINCT FROM a.cohort_id::text
 OR a.snapshot->>'learner_id' IS DISTINCT FROM a.user_id::text OR a.snapshot->>'curriculum_version_id' IS DISTINCT FROM a.curriculum_version_id::text
 OR a.snapshot->>'node_key' IS DISTINCT FROM a.node_key OR a.snapshot->>'definition_digest' IS DISTINCT FROM a.definition_digest
 OR a.snapshot->>'normal_slot' IS DISTINCT FROM '1' OR a.snapshot->>'kind' IS DISTINCT FROM 'normal'
 OR (a.snapshot->>'started_at')::timestamptz IS DISTINCT FROM a.started_at OR (a.snapshot->>'deadline_at')::timestamptz IS DISTINCT FROM a.deadline_at
 OR a.snapshot_digest IS DISTINCT FROM app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt')
 OR spec->'checkpoint_definition' IS DISTINCT FROM a.snapshot->'definition'
 OR a.snapshot->>'evaluation_spec_digest' IS DISTINCT FROM app.checkpoint_digest(spec,'nextera-evaluation-spec')
 OR a.definition_digest IS DISTINCT FROM app.scored_exam_definition_core(spec)
 OR EXISTS(SELECT FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') item WHERE item->'answerFormat'->>'kind'<>'coding' AND item->'answerEvaluator'->>'definitionDigest' IS DISTINCT FROM a.definition_digest)
 OR x.attempt_id IS NULL OR r.rubric_digest IS NULL OR r.definition_digest IS DISTINCT FROM a.definition_digest
 OR a.snapshot->'definition'->'examScoring' IS DISTINCT FROM jsonb_build_object('version',1,'form',r.form,'rubricDigest',r.rubric_digest)
 OR x.primary_mentor_id=a.user_id OR x.secondary_mentor_id=a.user_id THEN
 RAISE EXCEPTION 'Frozen scored lifecycle unavailable' USING ERRCODE='PS005';END IF;
 b:=jsonb_build_object('version',1,'attemptId',a.id,'learnerId',a.user_id,'cohortId',a.cohort_id,'definitionDigest',a.definition_digest,'rubricDigest',x.rubric_digest,'primaryMentorId',x.primary_mentor_id,'secondaryMentorId',x.secondary_mentor_id);
 IF x.assignment_digest IS DISTINCT FROM app.checkpoint_digest(b,'01coding-exam-scoring-assignment') THEN RAISE EXCEPTION 'Frozen assignment mismatch' USING ERRCODE='PS005';END IF;
 RETURN jsonb_build_object('version',1,'form',r.form,'rubric_digest',r.rubric_digest,'duration_seconds',10800,'normal_attempts',1);
END $$;

-- Private lifecycle projection seam.0029 may replace this exact owner-only
-- function after its real immutable100-point ledger/current-vector proof exists.
-- No score is invented from legacy result booleans or synchronous mentor presence.
CREATE FUNCTION app.scored_exam_result_projection(auth_id uuid,attempt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;u uuid;BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF a.id IS NULL OR u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Scored result forbidden' USING ERRCODE='42501';END IF;
 PERFORM app.scored_exam_attempt_metadata(a);
 RETURN jsonb_build_object('version',1,'status',CASE WHEN a.status='active' AND clock_timestamp()<a.deadline_at THEN 'in_progress' ELSE 'provisional' END,'total_points',NULL,'coding_points',NULL,'outcome_id',NULL);
END $$;

-- Returns only server-owned submission capability. Missing policies remain unavailable;
-- never infer three attempts, unlimited resubmissions, or passed-task prohibition.
CREATE FUNCTION app.scored_exam_question_capability(auth_id uuid,attempt uuid,task text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;u uuid;ctx jsonb;item jsonb;status text;allowed boolean;used bigint;recent bigint;p app.scored_exam_intake_policies;typed app.checkpoint_answer_submit_policies;at_time timestamptz;authority text;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM a.user_id OR task IS NULL OR task !~ '^q[1-8]$' THEN RAISE EXCEPTION 'Scored task forbidden' USING ERRCODE='42501';END IF;
 PERFORM app.scored_exam_attempt_metadata(a);
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;
 authority:=CASE WHEN task IN ('q1','q2','q3','q4','q5') THEN 'scored_exam_intake_v1' ELSE 'checkpoint_answers_v1' END;
 BEGIN
 IF authority='scored_exam_intake_v1' THEN
 ctx:=app.scored_exam_intake_context(auth_id,attempt,task);
 SELECT * INTO p FROM app.scored_exam_intake_policies WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=a.definition_digest AND task_key=task AND enabled FOR SHARE;
 at_time:=(ctx->>'serverNow')::timestamptz;
 SELECT count(*),count(*) FILTER(WHERE accepted_at>=to_timestamp(floor(extract(epoch FROM at_time)*1000/p.rate_window_ms)*p.rate_window_ms/1000)) INTO used,recent FROM app.scored_exam_acceptance_intents WHERE attempt_id=a.id AND task_key=task;
 allowed:=(ctx->>'canSubmit')::boolean;
 status:=CASE WHEN ctx->>'status'='closed' THEN 'closed' WHEN used>=p.graded_acceptance_allowance THEN 'allowance_exhausted' WHEN recent>=p.max_acceptances_per_window THEN 'rate_limited' WHEN allowed THEN 'open' ELSE 'unavailable' END;
 ELSE
 ctx:=app.checkpoint_answer_submission_context(auth_id,u,attempt,task);
 SELECT * INTO typed FROM app.checkpoint_answer_submit_policies WHERE curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key AND definition_digest=a.definition_digest AND task_key=task AND enabled FOR SHARE;
 SELECT count(*) INTO used FROM app.checkpoint_answer_allowance_debits WHERE attempt_id=a.id AND task_key=task;
 allowed:=(ctx->>'submitAllowed')::boolean;
 status:=CASE WHEN ctx->>'status'<>'active' OR (ctx->>'serverNow')::timestamptz >= (ctx->>'deadline')::timestamptz THEN 'closed' WHEN used>=typed.graded_allowance THEN 'allowance_exhausted' WHEN allowed THEN 'open' ELSE 'unavailable' END;
 END IF;
 EXCEPTION WHEN SQLSTATE 'PS005' OR SQLSTATE 'PA005' THEN allowed:=false;status:='unavailable';
 END;
 RETURN jsonb_build_object('version',1,'allowed',coalesce(allowed,false),'status',coalesce(status,'unavailable'),'authority',authority);
END $$;

CREATE FUNCTION app.start_scored_exam(auth_id uuid,cohort uuid,node text,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid;c app.cohorts;d app.checkpoint_definitions;n app.curriculum_nodes;a app.checkpoint_attempts;
 p app.scored_exam_lifecycle_policies;r app.exam_scoring_rubrics;mentor uuid;aid uuid:=gen_random_uuid();at_time timestamptz;snap jsonb;b jsonb;task jsonb;cap jsonb;
BEGIN
 IF auth_id IS NULL OR cohort IS NULL OR node IS NULL OR request IS NULL THEN RAISE EXCEPTION 'Scored start forbidden' USING ERRCODE='42501';END IF;
 u:=app.checkpoint_user(auth_id,cohort);PERFORM pg_advisory_xact_lock(hashtextextended(cohort::text||u::text,4));u:=app.checkpoint_lock_access(auth_id,cohort);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE cohort_id=cohort AND user_id=u AND request_id=request;
 IF FOUND THEN IF a.node_key IS DISTINCT FROM node THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;PERFORM app.scored_exam_attempt_metadata(a);RETURN a.id;END IF;
 SELECT * INTO c FROM app.cohorts WHERE id=cohort;
 SELECT * INTO n FROM app.curriculum_nodes WHERE curriculum_version_id=c.curriculum_version_id AND node_key=node;
 SELECT * INTO d FROM app.checkpoint_definitions WHERE curriculum_version_id=c.curriculum_version_id AND node_key=node;
 IF n.kind IS DISTINCT FROM 'checkpoint' OR NOT EXISTS(SELECT FROM app.curriculum_versions WHERE id=c.curriculum_version_id AND status='published')
 OR NOT coalesce(app.scored_exam_definition_valid(d.definition),false)
 OR n.resolved_evaluation_spec->'checkpoint_definition' IS DISTINCT FROM d.definition
 OR n.evaluation_spec_digest IS DISTINCT FROM app.checkpoint_digest(n.resolved_evaluation_spec,'nextera-evaluation-spec')
 OR d.definition_digest IS DISTINCT FROM app.scored_exam_definition_core(n.resolved_evaluation_spec)
 OR EXISTS(SELECT FROM jsonb_array_elements(d.definition->'tasks') item WHERE item->'answerFormat'->>'kind'<>'coding' AND item->'answerEvaluator'->>'definitionDigest' IS DISTINCT FROM d.definition_digest)
 OR NOT EXISTS(SELECT FROM app.learner_node_progress WHERE cohort_id=cohort AND user_id=u AND curriculum_version_id=c.curriculum_version_id AND node_key=node AND state IN ('available','in_progress'))
 OR EXISTS(SELECT FROM app.node_prerequisites e LEFT JOIN app.learner_node_progress l ON l.cohort_id=cohort AND l.user_id=u AND l.curriculum_version_id=e.curriculum_version_id AND l.node_key=e.prerequisite_node_key WHERE e.curriculum_version_id=c.curriculum_version_id AND e.dependent_node_key=node AND (e.rule<>'requires_pass' OR l.state IS DISTINCT FROM 'mastered')) THEN RAISE EXCEPTION 'CHECKPOINT_INELIGIBLE';END IF;
 IF EXISTS(SELECT FROM app.checkpoint_attempts WHERE cohort_id=cohort AND user_id=u AND node_key=node) THEN RAISE EXCEPTION 'SCORED_EXAM_ATTEMPT_EXHAUSTED';END IF;
 SELECT * INTO p FROM app.scored_exam_lifecycle_policies WHERE cohort_id=cohort AND user_id=u AND curriculum_version_id=c.curriculum_version_id AND node_key=node AND definition_digest=d.definition_digest AND enabled FOR SHARE;
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=p.rubric_digest;
 IF p.cohort_id IS NULL OR r.definition_digest IS DISTINCT FROM d.definition_digest OR d.definition->'examScoring' IS DISTINCT FROM jsonb_build_object('version',1,'form',r.form,'rubricDigest',r.rubric_digest) THEN RAISE EXCEPTION 'Explicit lifecycle assignment unavailable' USING ERRCODE='PS005';END IF;
 FOREACH mentor IN ARRAY ARRAY[p.primary_mentor_id,p.secondary_mentor_id] LOOP
 PERFORM 1 FROM app.users actor JOIN app.cohort_memberships m ON m.user_id=actor.id WHERE actor.id=mentor AND actor.id<>u AND actor.active AND actor.role IN ('operator','admin') AND m.cohort_id=cohort AND m.status='active' FOR SHARE OF actor,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Assigned mentor unavailable' USING ERRCODE='PS005';END IF;END LOOP;
 at_time:=clock_timestamp();
 snap:=jsonb_build_object('definition',d.definition,'definition_digest',d.definition_digest,'evaluation_spec',n.resolved_evaluation_spec,'evaluation_spec_digest',n.evaluation_spec_digest,'attempt_id',aid,'cohort_id',cohort,'learner_id',u,'curriculum_version_id',c.curriculum_version_id,'node_key',node,'normal_slot',1,'kind','normal','started_at',to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'deadline_at',to_char((at_time+interval '180 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 INSERT INTO app.checkpoint_attempts(id,cohort_id,user_id,curriculum_version_id,node_key,request_id,definition_digest,snapshot,snapshot_digest,normal_slot,kind,replacement_for,started_at,deadline_at)
 VALUES(aid,cohort,u,c.curriculum_version_id,node,request,d.definition_digest,snap,app.checkpoint_digest(snap,'nextera-checkpoint-attempt'),1,'normal',NULL,at_time,at_time+interval '180 minutes') RETURNING * INTO a;
 b:=jsonb_build_object('version',1,'attemptId',aid,'learnerId',u,'cohortId',cohort,'definitionDigest',d.definition_digest,'rubricDigest',r.rubric_digest,'primaryMentorId',p.primary_mentor_id,'secondaryMentorId',p.secondary_mentor_id);
 INSERT INTO app.exam_scoring_assignments(attempt_id,rubric_digest,assignment_digest,primary_mentor_id,secondary_mentor_id) VALUES(aid,r.rubric_digest,app.checkpoint_digest(b,'01coding-exam-scoring-assignment'),p.primary_mentor_id,p.secondary_mentor_id);
 PERFORM app.scored_exam_attempt_metadata(a);
 -- Entire start rolls back if any required explicit policy/evaluator/ABI/resource bound is absent.
 FOR task IN SELECT value FROM jsonb_array_elements(d.definition->'tasks') LOOP
 cap:=app.scored_exam_question_capability(auth_id,aid,task->>'key');
 IF cap->>'status' IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'Required scored question capability unavailable' USING ERRCODE='PS005';END IF;END LOOP;
 UPDATE app.learner_node_progress SET state='in_progress',started_at=at_time WHERE cohort_id=cohort AND user_id=u AND node_key=node AND state='available';
 IF FOUND THEN INSERT INTO app.state_events(checkpoint_attempt_id,entity_type,previous_state,next_state,actor_type,reason,correlation_id) VALUES(aid,'progress','available','in_progress','system','checkpoint_started',aid);END IF;
 PERFORM app.checkpoint_event(a,'checkpoint_started');RETURN aid;
END $$;

-- Helpers/storage are private; only existing RPC entrypoints remain callable by web.
ALTER TABLE app.scored_exam_lifecycle_policies ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE g record;f record;BEGIN
 FOR g IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END recipient FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid='app.scored_exam_lifecycle_policies'::regclass AND a.grantee<>c.relowner LOOP EXECUTE format('REVOKE ALL ON TABLE app.scored_exam_lifecycle_policies FROM %s',g.recipient);END LOOP;
 FOR f IN SELECT p.oid,p.oid::regprocedure signature,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('scored_exam_definition_valid','scored_exam_definition_core','guard_scored_exam_lifecycle_policy','scored_exam_attempt_metadata','scored_exam_result_projection','scored_exam_question_capability','start_scored_exam') LOOP
 FOR g IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END recipient FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f.oid AND a.grantee<>p.proowner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f.signature,g.recipient);END LOOP;END LOOP;
END $$;
RESET ROLE;
-- Already-held DBA span installs constraints/replaces exact existing RPC bodies;
-- it grants no lasting REFERENCES/TRIGGER/owner authority to any runtime principal.
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'scored-exam-0027-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin) THEN RAISE EXCEPTION 'Direct bootstrap DBA span lost';END IF;
END $$;
ALTER TABLE app.scored_exam_lifecycle_policies ADD CONSTRAINT scored_exam_lifecycle_member_fk FOREIGN KEY(cohort_id,user_id) REFERENCES app.cohort_memberships(cohort_id,user_id) ON DELETE RESTRICT;
ALTER TABLE app.scored_exam_lifecycle_policies ADD CONSTRAINT scored_exam_lifecycle_definition_fk FOREIGN KEY(curriculum_version_id,node_key) REFERENCES app.checkpoint_definitions(curriculum_version_id,node_key) ON DELETE RESTRICT;
ALTER TABLE app.scored_exam_lifecycle_policies ADD CONSTRAINT scored_exam_lifecycle_primary_fk FOREIGN KEY(primary_mentor_id) REFERENCES app.users(id) ON DELETE RESTRICT;
ALTER TABLE app.scored_exam_lifecycle_policies ADD CONSTRAINT scored_exam_lifecycle_secondary_fk FOREIGN KEY(secondary_mentor_id) REFERENCES app.users(id) ON DELETE RESTRICT;
-- Existing rows are checked, never rewritten. Inline constraints do not grant
-- new helper EXECUTE to arbitrary table writers. Triggers perform full validation.
ALTER TABLE app.checkpoint_definitions DROP CONSTRAINT checkpoint_definition_policy;
ALTER TABLE app.checkpoint_definitions ADD CONSTRAINT checkpoint_definition_policy CHECK(coalesce(CASE WHEN jsonb_typeof(definition)='object' AND jsonb_typeof(definition->'tasks')='array' THEN CASE WHEN definition ? 'examScoring' THEN definition->'policyVersion'='3'::jsonb AND definition->'durationSeconds'='10800'::jsonb AND jsonb_array_length(definition->'tasks')=8 AND jsonb_typeof(definition->'examScoring')='object' ELSE definition->>'policyVersion'='1' AND definition->>'durationSeconds'='5400' AND jsonb_array_length(definition->'tasks')=4 END ELSE false END,false)) NOT VALID;
ALTER TABLE app.checkpoint_definitions VALIDATE CONSTRAINT checkpoint_definition_policy;
ALTER TABLE app.checkpoint_attempts DROP CONSTRAINT checkpoint_attempt_policy;
ALTER TABLE app.checkpoint_attempts ADD CONSTRAINT checkpoint_attempt_policy CHECK(coalesce(CASE WHEN snapshot->'definition' ? 'examScoring' THEN normal_slot=1 AND kind='normal' AND replacement_for IS NULL AND deadline_at=started_at+interval '180 minutes' ELSE normal_slot IN (1,2) AND ((kind='normal' AND replacement_for IS NULL) OR (kind='replacement' AND replacement_for IS NOT NULL)) AND deadline_at=started_at+interval '90 minutes' END,false)) NOT VALID;
ALTER TABLE app.checkpoint_attempts VALIDATE CONSTRAINT checkpoint_attempt_policy;

CREATE OR REPLACE FUNCTION app.start_checkpoint(auth_id uuid,cohort uuid,node text,request uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid; c app.cohorts; d app.checkpoint_definitions; a app.checkpoint_attempts; prev app.checkpoint_attempts;
 g app.checkpoint_replacement_grants; at_time timestamptz; slot integer; attempt_kind text; snap jsonb; aid uuid:=gen_random_uuid();
BEGIN
 -- BEGIN MARKED LIFECYCLE BRANCH (unmarked body below is preserved exactly).
 IF EXISTS(SELECT FROM app.cohorts cohort_row JOIN app.checkpoint_definitions definition_row ON definition_row.curriculum_version_id=cohort_row.curriculum_version_id WHERE cohort_row.id=cohort AND definition_row.node_key=node AND definition_row.definition ? 'examScoring') THEN
 RETURN app.start_scored_exam(auth_id,cohort,node,request);END IF;
 -- END MARKED LIFECYCLE BRANCH
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

CREATE OR REPLACE FUNCTION app.guard_checkpoint_definition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE n app.curriculum_nodes;v app.curriculum_versions;
BEGIN
 -- BEGIN MARKED DEFINITION BRANCH.
 IF NEW.definition ? 'examScoring' THEN
 SELECT * INTO n FROM app.curriculum_nodes WHERE curriculum_version_id=NEW.curriculum_version_id AND node_key=NEW.node_key;
 SELECT * INTO v FROM app.curriculum_versions WHERE id=NEW.curriculum_version_id;
 IF v.status IS DISTINCT FROM 'draft' OR n.kind IS DISTINCT FROM 'checkpoint'
 OR NOT coalesce(app.scored_exam_definition_valid(NEW.definition),false)
 OR n.resolved_evaluation_spec->'checkpoint_definition' IS DISTINCT FROM NEW.definition
 OR NEW.definition_digest IS DISTINCT FROM app.scored_exam_definition_core(n.resolved_evaluation_spec)
 OR EXISTS(SELECT FROM jsonb_array_elements(NEW.definition->'tasks') item WHERE item->'answerFormat'->>'kind'<>'coding' AND item->'answerEvaluator'->>'definitionDigest' IS DISTINCT FROM NEW.definition_digest)
 OR n.evaluation_spec_digest IS DISTINCT FROM app.checkpoint_digest(n.resolved_evaluation_spec,'nextera-evaluation-spec') THEN RAISE EXCEPTION 'Invalid committed scored exam definition';END IF;
 RETURN NEW;END IF;
 -- END MARKED DEFINITION BRANCH.
 SELECT * INTO n FROM app.curriculum_nodes WHERE curriculum_version_id=NEW.curriculum_version_id AND node_key=NEW.node_key;
 SELECT * INTO v FROM app.curriculum_versions WHERE id=NEW.curriculum_version_id;
 IF v.status<>'draft' OR n.kind<>'checkpoint' OR n.evaluation_spec_digest<>NEW.definition_digest OR n.resolved_evaluation_spec->'checkpoint_definition' IS DISTINCT FROM NEW.definition
 OR (SELECT count(DISTINCT value->>'key') FROM jsonb_array_elements(NEW.definition->'tasks'))<>4
 OR (SELECT count(DISTINCT value->>'testPackId') FROM jsonb_array_elements(NEW.definition->'tasks'))<>4
 THEN RAISE EXCEPTION 'Invalid committed checkpoint definition'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.guard_checkpoint_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.status='published' AND OLD.status<>'published' AND EXISTS(
 SELECT FROM app.curriculum_nodes n LEFT JOIN app.checkpoint_definitions d USING(curriculum_version_id,node_key)
 WHERE n.curriculum_version_id=NEW.id AND n.kind='checkpoint' AND (d.node_key IS NULL OR CASE WHEN d.definition ? 'examScoring' THEN d.definition_digest IS DISTINCT FROM app.scored_exam_definition_core(n.resolved_evaluation_spec) OR n.resolved_evaluation_spec->'checkpoint_definition' IS DISTINCT FROM d.definition OR n.evaluation_spec_digest IS DISTINCT FROM app.checkpoint_digest(n.resolved_evaluation_spec,'nextera-evaluation-spec') ELSE d.definition_digest<>n.evaluation_spec_digest END)) THEN
 RAISE EXCEPTION 'Publication requires every committed checkpoint definition'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.checkpoint_task_context(auth_id uuid,attempt uuid,task text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; u uuid; item jsonb; meta jsonb; cap jsonb; typed jsonb;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'CHECKPOINT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;
 IF item IS NULL THEN RAISE EXCEPTION 'CHECKPOINT_TASK_UNKNOWN'; END IF;
 -- BEGIN MARKED TASK BRANCH.
 IF a.snapshot->'definition' ? 'examScoring' THEN
 meta:=app.scored_exam_attempt_metadata(a);cap:=app.scored_exam_question_capability(auth_id,attempt,task);
 IF cap->>'status'='unavailable' THEN RAISE EXCEPTION 'Scored question unavailable' USING ERRCODE='PS005';END IF;
 IF item->'answerFormat'->>'kind'<>'coding' THEN typed:=app.checkpoint_answer_submission_context(auth_id,u,attempt,task);END IF;
 RETURN jsonb_build_object('user_id',u,'cohort_id',a.cohort_id,'rules',item->'submissionRules','scoredExam',jsonb_build_object('version',1,'form',meta->>'form','rubricDigest',meta->>'rubric_digest'),'answerFormat',item->'answerFormat','submission',cap)
 || CASE WHEN typed IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('answerContract',typed->'answerContract','officialAnswerPolicy',item->'officialAnswerPolicy','answerEvaluator',item->'answerEvaluator') END;
 END IF;
 -- END MARKED TASK BRANCH.
 RETURN jsonb_build_object('user_id',u,'cohort_id',a.cohort_id,'rules',item->'submissionRules');
END $$;

CREATE OR REPLACE FUNCTION app.checkpoint_editor_context(auth_id uuid,attempt uuid,task text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; u uuid; item jsonb; at_time timestamptz;
 rules jsonb; kb numeric; filename text; reserved bigint; passed boolean; meta jsonb; ctx jsonb;
BEGIN
 IF attempt IS NULL OR task IS NULL OR task !~ '^[a-z0-9-]{1,100}$' THEN
 RAISE EXCEPTION 'Checkpoint editor forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'Checkpoint editor forbidden' USING ERRCODE='42501'; END IF;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Checkpoint editor forbidden' USING ERRCODE='42501'; END IF;
 -- BEGIN MARKED EDITOR BRANCH.
 IF a.snapshot->'definition' ? 'examScoring' THEN
 meta:=app.scored_exam_attempt_metadata(a);
 IF task NOT IN ('q1','q2','q3','q4','q5') THEN RAISE EXCEPTION 'Use typed answer context' USING ERRCODE='42501';END IF;
 ctx:=app.scored_exam_intake_context(auth_id,attempt,task);
 RETURN jsonb_build_object('scope',jsonb_build_object('learnerId',u,'cohortId',a.cohort_id,'attemptId',a.id,'taskKey',task,'definitionDigest',a.definition_digest),'readAllowed',true,'status',CASE WHEN ctx->>'status'='open' THEN 'active' ELSE 'closed' END,'serverNow',ctx->'serverNow','deadline',ctx->'deadline','sourceBytes',ctx->'maxCodeBytes','filename',ctx->'filename','submitAllowed',ctx->'canSubmit','scoredExam',jsonb_build_object('version',1,'form',meta->>'form','rubricDigest',meta->>'rubric_digest'));
 END IF;
 -- END MARKED EDITOR BRANCH.
 -- The source of truth is the immutable attempt, never a newly edited definition or client digest.
 IF a.snapshot->>'attempt_id' IS DISTINCT FROM a.id::text
 OR a.snapshot->>'cohort_id' IS DISTINCT FROM a.cohort_id::text
 OR a.snapshot->>'learner_id' IS DISTINCT FROM a.user_id::text
 OR a.snapshot->>'node_key' IS DISTINCT FROM a.node_key
 OR a.snapshot->>'curriculum_version_id' IS DISTINCT FROM a.curriculum_version_id::text
 OR (a.snapshot->>'deadline_at')::timestamptz IS DISTINCT FROM a.deadline_at
 OR a.snapshot->>'definition_digest' IS DISTINCT FROM a.definition_digest
 OR a.snapshot_digest IS DISTINCT FROM app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt')
 OR jsonb_typeof(a.snapshot->'definition'->'tasks') IS DISTINCT FROM 'array' THEN
 RAISE EXCEPTION 'Checkpoint editor context unavailable'; END IF;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=task;
 IF item IS NULL THEN RAISE EXCEPTION 'Checkpoint editor forbidden' USING ERRCODE='42501'; END IF;
 rules:=item->'submissionRules';
 IF jsonb_typeof(rules->'required_files') IS DISTINCT FROM 'array'
 OR jsonb_array_length(rules->'required_files')<>1
 OR jsonb_typeof(rules->'required_files'->0) IS DISTINCT FROM 'string'
 OR (rules->'required_files'->>0) !~ '^[A-Za-z0-9_]+[.]go$'
 OR (rules->>'max_size_kb') IS NULL OR (rules->>'max_size_kb') !~ '^[0-9]+$' THEN
 RAISE EXCEPTION 'Checkpoint editor source contract unavailable'; END IF;
 kb:=(rules->>'max_size_kb')::numeric;
 IF kb<1 OR kb>2147483647 THEN RAISE EXCEPTION 'Checkpoint editor source contract unavailable'; END IF;
 filename:=rules->'required_files'->>0;
 SELECT count(*) FILTER(WHERE state<>'system_error'),coalesce(bool_or(state='passed'),false)
 INTO reserved,passed FROM app.submissions WHERE checkpoint_attempt_id=a.id AND checkpoint_task_key=task;
 at_time:=clock_timestamp();
 -- Mirror current registered0007 intake allowance; do not introduce a new quota/threshold.
 RETURN jsonb_build_object(
 'scope',jsonb_build_object('learnerId',u,'cohortId',a.cohort_id,'attemptId',a.id,'taskKey',task,'definitionDigest',a.definition_digest),
 'readAllowed',true,'status',CASE WHEN a.status='active' THEN 'active' ELSE 'closed' END,
 'serverNow',at_time,'deadline',a.deadline_at,'sourceBytes',least(kb*1024,262144)::integer,'filename',filename,
 'submitAllowed',a.status='active' AND at_time<a.deadline_at AND NOT passed AND reserved<3);
END $$;

CREATE OR REPLACE FUNCTION app.read_checkpoint(auth_id uuid,cohort uuid,node text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid;v uuid;a app.checkpoint_attempts;tasks jsonb;hist jsonb;attempt_history jsonb;eligible boolean; d app.checkpoint_definitions; meta jsonb; item jsonb; marked_tasks jsonb; marked_history jsonb; history_attempt app.checkpoint_attempts;
BEGIN
 u:=app.checkpoint_user(auth_id,cohort);
 SELECT curriculum_version_id INTO v FROM app.cohorts WHERE id=cohort;
 IF NOT EXISTS(SELECT FROM app.checkpoint_definitions WHERE curriculum_version_id=v AND node_key=node) THEN RAISE EXCEPTION 'CHECKPOINT_NOT_FOUND'; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE cohort_id=cohort AND user_id=u AND node_key=node ORDER BY started_at DESC,id DESC LIMIT 1;
 -- BEGIN MARKED READ BRANCH.
 SELECT * INTO d FROM app.checkpoint_definitions WHERE curriculum_version_id=v AND node_key=node;
 IF d.definition ? 'examScoring' THEN
 IF NOT coalesce(app.scored_exam_definition_valid(d.definition),false)
 OR NOT EXISTS(SELECT FROM app.curriculum_nodes n WHERE n.curriculum_version_id=v AND n.node_key=node AND n.resolved_evaluation_spec->'checkpoint_definition'=d.definition AND d.definition_digest=app.scored_exam_definition_core(n.resolved_evaluation_spec) AND n.evaluation_spec_digest=app.checkpoint_digest(n.resolved_evaluation_spec,'nextera-evaluation-spec')) THEN RAISE EXCEPTION 'Scored definition unavailable' USING ERRCODE='PS005';END IF;
 meta:=jsonb_build_object('version',1,'form',d.definition->'examScoring'->>'form','rubric_digest',d.definition->'examScoring'->>'rubricDigest','duration_seconds',10800,'normal_attempts',1);
 SELECT state IN ('available','in_progress') INTO eligible FROM app.learner_node_progress WHERE cohort_id=cohort AND user_id=u AND node_key=node;
 IF a.id IS NULL THEN
 eligible:=coalesce(eligible,false) AND EXISTS(SELECT FROM app.scored_exam_lifecycle_policies p JOIN app.exam_scoring_rubrics r ON r.rubric_digest=p.rubric_digest WHERE p.cohort_id=cohort AND p.user_id=u AND p.curriculum_version_id=v AND p.node_key=node AND p.definition_digest=d.definition_digest AND p.enabled AND r.definition_digest=d.definition_digest AND d.definition->'examScoring'=jsonb_build_object('version',1,'form',r.form,'rubricDigest',r.rubric_digest));
 END IF;
 marked_tasks:='[]'::jsonb;marked_history:='[]'::jsonb;
 IF a.id IS NOT NULL THEN
 meta:=app.scored_exam_attempt_metadata(a);
 FOR item IN SELECT value FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') LOOP
 marked_tasks:=marked_tasks||jsonb_build_array(jsonb_build_object('key',item->>'key','title',item->>'title','subject',item->>'subjectMarkdown','rules',item->'submissionRules','answer_format',item->'answerFormat','passed',false,'reserved',(SELECT count(*) FROM app.exam_scoring_acceptances WHERE attempt_id=a.id AND question_key=item->>'key'),'submission',app.scored_exam_question_capability(auth_id,a.id,item->>'key')));
 END LOOP;
 FOR history_attempt IN SELECT ca.* FROM app.checkpoint_attempts ca WHERE ca.cohort_id=cohort AND ca.user_id=u AND ca.node_key=node ORDER BY ca.started_at,ca.id LOOP
 marked_history:=marked_history||jsonb_build_array(jsonb_build_object('id',history_attempt.id,'normal_slot',history_attempt.normal_slot,'kind',history_attempt.kind,'started_at',history_attempt.started_at,'deadline_at',history_attempt.deadline_at,'status',history_attempt.status,'completed_at',history_attempt.completed_at,'points',NULL,'outcome_id',NULL,'policy',NULL,'scored_exam',app.scored_exam_attempt_metadata(history_attempt),'scored_result',app.scored_exam_result_projection(auth_id,history_attempt.id)));
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(receipt_history) ORDER BY receipt_history.created_at,receipt_history.id),'[]'::jsonb) INTO hist FROM
 (SELECT s.id,s.checkpoint_task_key AS task_key,s.created_at,s.state::text AS state,CASE WHEN r.application_status='applied' THEN r.learner_feedback END AS feedback,'provisional'::text AS scoring_status FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id AND j.submission_id=s.id LEFT JOIN judge.results r ON r.id=j.terminal_result_id WHERE s.checkpoint_attempt_id=a.id
 UNION ALL
 SELECT answer.id,answer.task_key,answer.accepted_at AS created_at,outbox.evaluation AS state,NULL::jsonb AS feedback,'provisional'::text AS scoring_status FROM app.checkpoint_answer_receipts answer JOIN app.checkpoint_answer_outbox outbox ON outbox.receipt_id=answer.id WHERE answer.attempt_id=a.id ORDER BY created_at,id LIMIT 100) receipt_history;
 END IF;
 RETURN jsonb_build_object('policy',NULL,'scored_exam',meta,'scored_result',CASE WHEN a.id IS NOT NULL THEN app.scored_exam_result_projection(auth_id,a.id) END,'server_now',clock_timestamp(),'eligible',coalesce(eligible,false),'attempt',CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,'status',a.status,'normal_slot',a.normal_slot,'kind',a.kind,'started_at',a.started_at,'deadline_at',a.deadline_at,'completed_at',a.completed_at,'retake_at',NULL) END,'tasks',marked_tasks,'submissions',coalesce(hist,'[]'::jsonb),'history',marked_history,'replacement_available',false);
 END IF;
 -- END MARKED READ BRANCH.
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

CREATE OR REPLACE FUNCTION app.grant_checkpoint_replacement(auth_id uuid,attempt uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;actor app.users;gid uuid;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 SELECT * INTO actor FROM app.users WHERE auth_user_id=auth_id AND active AND role IN ('operator','admin') FOR SHARE;
 IF actor.id IS NULL OR a.id IS NULL OR (actor.role='operator' AND NOT EXISTS(SELECT FROM app.cohort_memberships WHERE cohort_id=a.cohort_id AND user_id=actor.id AND status='active')) THEN RAISE EXCEPTION 'CHECKPOINT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 -- BEGIN MARKED REPLACEMENT BRANCH.
 IF a.snapshot->'definition' ? 'examScoring' THEN RAISE EXCEPTION 'SCORED_EXAM_REPLACEMENT_UNAVAILABLE' USING ERRCODE='42501';END IF;
 -- END MARKED REPLACEMENT BRANCH.
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||a.user_id::text,4));
 IF NOT EXISTS(SELECT FROM app.checkpoint_outcomes WHERE attempt_id=attempt AND status='infrastructure_blocked') THEN RAISE EXCEPTION 'CHECKPOINT_NOT_INFRASTRUCTURE_BLOCKED'; END IF;
 SELECT id INTO gid FROM app.checkpoint_replacement_grants WHERE attempt_id=attempt;
 IF FOUND THEN RETURN gid; END IF;
 INSERT INTO app.checkpoint_replacement_grants(attempt_id,actor_user_id,reason) VALUES(attempt,actor.id,'trusted_infrastructure_failure') RETURNING id INTO gid;
 PERFORM app.checkpoint_event(a,'checkpoint_replacement_granted');RETURN gid;
END $$;

CREATE OR REPLACE FUNCTION app.announce_checkpoint_retake(attempt uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.cohort_id::text||a.user_id::text,4));
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 -- BEGIN MARKED RETAKE BRANCH.
 IF a.snapshot->'definition' ? 'examScoring' THEN RETURN;END IF;
 -- END MARKED RETAKE BRANCH.
 IF a.status='failed' AND a.normal_slot=1 AND a.completed_at+interval '24 hours'<=clock_timestamp() AND a.retake_announced_at IS NULL
 AND NOT EXISTS(SELECT FROM app.checkpoint_attempts WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND node_key=a.node_key AND (started_at>a.started_at OR status='passed'))
 AND EXISTS(SELECT FROM app.users u JOIN app.cohort_memberships m ON m.user_id=u.id JOIN app.cohorts c ON c.id=m.cohort_id WHERE u.id=a.user_id AND u.active AND u.role='learner' AND m.cohort_id=a.cohort_id AND m.status='active' AND c.status='active') THEN
 UPDATE app.checkpoint_attempts SET retake_announced_at=clock_timestamp() WHERE id=attempt;
 PERFORM app.checkpoint_event(a,'checkpoint_retake_available'); END IF;
END $$;

-- No change to finish_checkpoint,0025 finalizer guard, official question intake,
-- score/result application or immutable registered migration bytes. Finish never submits drafts.
-- Verify all four exact external FK columns/actions and private owner/RLS before commit.
DO $lifecycle_readback$ DECLARE expected text;BEGIN
 IF EXISTS(SELECT FROM scored_exam_prior_rpc old LEFT JOIN pg_proc proc_after ON proc_after.oid=old.oid
 WHERE proc_after.oid IS NULL OR proc_after.proowner IS DISTINCT FROM old.proowner OR proc_after.proacl IS DISTINCT FROM old.proacl
 OR proc_after.prosecdef IS DISTINCT FROM old.prosecdef OR proc_after.proconfig IS DISTINCT FROM old.proconfig) THEN RAISE EXCEPTION 'Existing lifecycle owner/ACL/security context changed';END IF;
 IF NOT EXISTS(SELECT FROM pg_class c WHERE c.oid='app.scored_exam_lifecycle_policies'::regclass AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='nextera_checkpoint_owner') AND c.relrowsecurity AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)) THEN RAISE EXCEPTION 'Private lifecycle table readback failed';END IF;
 FOREACH expected IN ARRAY ARRAY['app.scored_exam_definition_valid(jsonb)','app.scored_exam_definition_core(jsonb)','app.guard_scored_exam_lifecycle_policy()','app.scored_exam_attempt_metadata(app.checkpoint_attempts)','app.scored_exam_result_projection(uuid,uuid)','app.scored_exam_question_capability(uuid,uuid,text)','app.start_scored_exam(uuid,uuid,text,uuid)'] LOOP
 IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=to_regprocedure(expected) AND r.rolname='nextera_checkpoint_owner' AND p.proconfig @> ARRAY['search_path=pg_catalog'] AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner)) THEN RAISE EXCEPTION 'Private lifecycle helper ACL/owner readback failed';END IF;
 END LOOP;
 IF EXISTS(SELECT FROM (VALUES
 ('scored_exam_lifecycle_member_fk','app.cohort_memberships',ARRAY['cohort_id','user_id']::text[],ARRAY['cohort_id','user_id']::text[]),
 ('scored_exam_lifecycle_definition_fk','app.checkpoint_definitions',ARRAY['curriculum_version_id','node_key']::text[],ARRAY['curriculum_version_id','node_key']::text[]),
 ('scored_exam_lifecycle_primary_fk','app.users',ARRAY['primary_mentor_id']::text[],ARRAY['id']::text[]),
 ('scored_exam_lifecycle_secondary_fk','app.users',ARRAY['secondary_mentor_id']::text[],ARRAY['id']::text[])
 ) wanted(name,target,source_columns,target_columns) WHERE NOT EXISTS(SELECT FROM pg_constraint c WHERE c.conname=wanted.name AND c.conrelid='app.scored_exam_lifecycle_policies'::regclass AND c.confrelid=to_regclass(wanted.target) AND c.contype='f' AND c.convalidated AND c.confdeltype='r' AND c.confupdtype='a' AND NOT c.condeferrable AND NOT c.condeferred AND (SELECT array_agg(a.attname::text ORDER BY x.ord) FROM unnest(c.conkey) WITH ORDINALITY x(n,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=x.n)=wanted.source_columns AND (SELECT array_agg(a.attname::text ORDER BY x.ord) FROM unnest(c.confkey) WITH ORDINALITY x(n,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=x.n)=wanted.target_columns)) THEN RAISE EXCEPTION 'Exact lifecycle FK readback failed';END IF;
END $lifecycle_readback$;
COMMIT;
