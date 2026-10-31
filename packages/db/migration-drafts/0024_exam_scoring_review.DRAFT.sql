-- SOURCE REVIEW DRAFT ONLY. Not registered, applied, seeded or enabled.
-- Requires0000-0010, reviewed180-minute/mixed-answer policy,0021/0022 and
-- a separate fail-closed guard in legacy finalize_checkpoint BEFORE activation.
-- DBA supplies a temporary SET-only checkpoint-owner migration span; this file
-- does not grant membership, CREATE authority, create roles or seed any rubric.
-- Required new group nextera_exam_evaluator is restricted NOLOGIN. Only a fresh
-- explicitly registered evaluator LOGIN may post functional evidence. No learner
-- role, public Run result, request parameter or claimed mentor role is authority.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 -- Already-held authority proof, not a grant. The future disposable controller
 -- must independently verify fresh cluster ownership/scope before setting this
 -- audit marker. The marker alone never confers authority.
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'exam-scoring-0024-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin) THEN
 RAISE EXCEPTION 'Fresh isolated bootstrap DBA span required'; END IF;
END $$;
DO $$ BEGIN
 IF NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')
 OR NOT has_schema_privilege('nextera_checkpoint_owner','app','CREATE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner'
 AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner')
 OR to_regclass('app.checkpoint_answer_receipts') IS NULL
 OR NOT has_table_privilege(current_user,'app.submissions','TRIGGER')
 OR NOT has_table_privilege(current_user,'app.checkpoint_attempts','TRIGGER')
 OR NOT has_table_privilege(current_user,'app.checkpoint_answer_receipts','TRIGGER')
 OR to_regprocedure('app.checkpoint_digest(jsonb,text)') IS NULL
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_exam_evaluator'
 AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
 AND NOT rolreplication AND NOT rolbypassrls)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
 WHERE r.rolname='nextera_exam_evaluator') THEN
 RAISE EXCEPTION 'Reviewed scoring schema and confined owner/evaluator prerequisites required'; END IF;
END $$;
SET LOCAL ROLE nextera_checkpoint_owner;

CREATE FUNCTION app.exam_scoring_rubric_valid(r jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE q jsonb; g jsonb; seen text[]:=ARRAY[]::text[]; groups text[]; total integer; expected text;
BEGIN
 IF jsonb_typeof(r)<>'object' OR NOT (r ?& ARRAY['version','form','definitionDigest','digest','questions']) OR (SELECT count(*) FROM jsonb_object_keys(r))<>5
 OR EXISTS(SELECT FROM unnest(ARRAY['form','definitionDigest','digest']) k WHERE jsonb_typeof(r->k) IS DISTINCT FROM 'string')
 OR r->'version'<>'1'::jsonb OR r->>'form' NOT IN ('A','B','C','D')
 OR r->>'definitionDigest' !~ '^[0-9a-f]{64}$' OR r->>'digest' !~ '^[0-9a-f]{64}$'
 OR jsonb_typeof(r->'questions')<>'array' OR jsonb_array_length(r->'questions')<>8 THEN RETURN false; END IF;
 FOR q IN SELECT value FROM jsonb_array_elements(r->'questions') LOOP
 IF jsonb_typeof(q)<>'object' OR NOT (q ?& ARRAY['questionKey','kind','publishedCriteriaDigest','groupBasis','functionalGroups']) OR (SELECT count(*) FROM jsonb_object_keys(q))<>5
 OR EXISTS(SELECT FROM unnest(ARRAY['questionKey','kind','publishedCriteriaDigest','groupBasis']) k WHERE jsonb_typeof(q->k) IS DISTINCT FROM 'string')
 OR q->>'questionKey' IS NULL OR q->>'questionKey' NOT IN ('q1','q2','q3','q4','q5','q6','q7','q8')
 OR q->>'questionKey'=ANY(seen) OR q->>'publishedCriteriaDigest' !~ '^[0-9a-f]{64}$'
 OR q->>'groupBasis'<>'fixed_semantic' OR jsonb_typeof(q->'functionalGroups')<>'array' THEN RETURN false; END IF;
 expected:=CASE WHEN q->>'questionKey'='q8' THEN 'debug_with_reason' WHEN q->>'questionKey' IN ('q6','q7') THEN 'trace_with_reason' ELSE 'coding' END;
 IF q->>'kind' IS DISTINCT FROM expected THEN RETURN false; END IF;
 seen:=array_append(seen,q->>'questionKey');groups:=ARRAY[]::text[];total:=0;
 FOR g IN SELECT value FROM jsonb_array_elements(q->'functionalGroups') LOOP
 IF jsonb_typeof(g)<>'object' OR NOT (g ?& ARRAY['key','points','criteriaDigest']) OR (SELECT count(*) FROM jsonb_object_keys(g))<>3
 OR EXISTS(SELECT FROM unnest(ARRAY['key','criteriaDigest']) k WHERE jsonb_typeof(g->k) IS DISTINCT FROM 'string')
 OR g->>'key' !~ '^[a-z][a-z0-9-]{0,79}$' OR g->>'key'=ANY(groups)
 OR g->>'criteriaDigest' !~ '^[0-9a-f]{64}$' OR jsonb_typeof(g->'points')<>'number'
 OR g->>'points' !~ '^[1-9][0-9]*$' OR (g->>'points')::numeric>13 THEN RETURN false; END IF;
 groups:=array_append(groups,g->>'key');total:=total+(g->>'points')::integer;
 END LOOP;
 IF total<>CASE expected WHEN 'coding' THEN 13 WHEN 'debug_with_reason' THEN 9 ELSE 0 END THEN RETURN false; END IF;
 END LOOP;
 RETURN r->>'form' IS NOT NULL AND r->>'definitionDigest' IS NOT NULL AND r->>'digest' IS NOT NULL
 AND cardinality(seen)=8 AND NOT EXISTS(SELECT FROM jsonb_array_elements(r->'questions') q WHERE q->>'publishedCriteriaDigest' IS NULL OR q->>'groupBasis' IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(q->'functionalGroups') g WHERE g->>'key' IS NULL OR g->>'criteriaDigest' IS NULL OR g->>'points' IS NULL));
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION app.exam_scoring_source_binding_valid(b jsonb,r jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE d jsonb; k text;
BEGIN
 IF jsonb_typeof(b) IS DISTINCT FROM 'object'
 OR NOT (b ?& ARRAY['draftSha256','paperSha256','decisions','rubric'])
 OR (SELECT count(*) FROM jsonb_object_keys(b))<>4 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['draftSha256','paperSha256'] LOOP
 IF jsonb_typeof(b->k) IS DISTINCT FROM 'string'
 OR b->>k !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
 END LOOP;
 d:=b->'decisions';
 IF jsonb_typeof(d) IS DISTINCT FROM 'object'
 OR NOT (d ?& ARRAY['weightsOwnerMessageId','approvedDraftSha256','traceComparatorOwnerMessageId','traceComparator','manualCriteriaSha256'])
 OR (SELECT count(*) FROM jsonb_object_keys(d))<>5 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['weightsOwnerMessageId','approvedDraftSha256','traceComparatorOwnerMessageId','traceComparator','manualCriteriaSha256'] LOOP
 IF jsonb_typeof(d->k) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 END LOOP;
 IF d->>'weightsOwnerMessageId' !~ '^Sentinel_[0-9a-f]{32}$'
 OR d->>'traceComparatorOwnerMessageId' !~ '^Sentinel_[0-9a-f]{32}$'
 OR d->>'approvedDraftSha256' IS DISTINCT FROM b->>'draftSha256'
 OR d->>'manualCriteriaSha256' !~ '^[0-9a-f]{64}$'
 OR d->>'traceComparator' IS DISTINCT FROM 'exact_utf8'
 OR b->'rubric' IS DISTINCT FROM r-'digest' THEN RETURN false; END IF;
 RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE app.exam_scoring_rubrics (
 rubric_digest text PRIMARY KEY CHECK(rubric_digest ~ '^[0-9a-f]{64}$'),
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 form text NOT NULL CHECK(form IN ('A','B','C','D')), rubric jsonb NOT NULL,
 source_binding jsonb NOT NULL,
 source_binding_digest text NOT NULL CHECK(source_binding_digest ~ '^[0-9a-f]{64}$'),
 CHECK(app.exam_scoring_source_binding_valid(source_binding,rubric)),
 CHECK(source_binding_digest=app.checkpoint_digest(source_binding,'nextera-exam1-rubric-source-binding')),
 CHECK(app.exam_scoring_rubric_valid(rubric)),
 CHECK(rubric->>'digest'=rubric_digest AND rubric->>'definitionDigest'=definition_digest AND rubric->>'form'=form),
 CHECK(rubric_digest=app.checkpoint_digest(rubric-'digest','01coding-exam-scoring-rubric'))
);
CREATE TABLE app.exam_scoring_assignments (
 attempt_id uuid PRIMARY KEY,
 rubric_digest text NOT NULL REFERENCES app.exam_scoring_rubrics(rubric_digest) ON DELETE RESTRICT,
 assignment_digest text NOT NULL CHECK(assignment_digest ~ '^[0-9a-f]{64}$'),
 primary_mentor_id uuid NOT NULL,
 secondary_mentor_id uuid NOT NULL,
 CHECK(primary_mentor_id<>secondary_mentor_id)
);
-- No direct caller access to this sequence. Order is allocated inside the SAME
-- accepted-source INSERT transaction under the attempt row lock, not at delivery.
CREATE SEQUENCE app.exam_scoring_acceptance_order AS bigint NO CYCLE;
CREATE TABLE app.exam_scoring_acceptances (
 submission_id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES app.exam_scoring_assignments(attempt_id) ON DELETE RESTRICT,
 question_key text NOT NULL CHECK(question_key IN ('q1','q2','q3','q4','q5','q6','q7','q8')),
 answer_kind text NOT NULL CHECK(answer_kind IN ('coding','trace_with_reason','debug_with_reason')),
 answer_digest text NOT NULL CHECK(answer_digest ~ '^[0-9a-f]{64}$'),
 snapshot_digest text NOT NULL CHECK(snapshot_digest ~ '^[0-9a-f]{64}$'),
 evaluator_key text NOT NULL, evaluator_digest text NOT NULL CHECK(evaluator_digest ~ '^[0-9a-f]{64}$'),
 accepted_at timestamptz NOT NULL, accepted_ordinal bigint NOT NULL UNIQUE CHECK(accepted_ordinal>0),
 source_kind text NOT NULL CHECK(source_kind IN ('coding','structured'))
);
CREATE TABLE app.exam_scoring_closures (
 attempt_id uuid PRIMARY KEY REFERENCES app.exam_scoring_assignments(attempt_id) ON DELETE RESTRICT,
 closed_at timestamptz NOT NULL, closure_ordinal bigint NOT NULL UNIQUE CHECK(closure_ordinal>0),
 reason text NOT NULL CHECK(reason IN ('finished','expired'))
);
CREATE TABLE app.exam_scoring_heads (
 submission_id uuid PRIMARY KEY REFERENCES app.exam_scoring_acceptances(submission_id) ON DELETE RESTRICT,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0)
);
CREATE TABLE app.exam_scoring_evaluator_logins (
 login_name name PRIMARY KEY, evaluator_key text NOT NULL,
 evaluator_digest text NOT NULL CHECK(evaluator_digest ~ '^[0-9a-f]{64}$'),
 enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE app.exam_scoring_events (
 event_id uuid PRIMARY KEY, operation_id uuid NOT NULL UNIQUE,
 submission_id uuid NOT NULL REFERENCES app.exam_scoring_acceptances(submission_id) ON DELETE RESTRICT,
 revision bigint NOT NULL CHECK(revision>0), expected_revision bigint NOT NULL CHECK(expected_revision>=0),
 event_kind text NOT NULL CHECK(event_kind IN ('functional','primary','secondary')),
 caller_login name NOT NULL, actor_user_id uuid,
 payload jsonb NOT NULL, payload_digest text NOT NULL CHECK(payload_digest ~ '^[0-9a-f]{64}$'),
 recorded_at timestamptz NOT NULL, UNIQUE(submission_id,revision), CHECK(revision=expected_revision+1),
 CHECK((event_kind='functional' AND actor_user_id IS NULL) OR (event_kind<>'functional' AND actor_user_id IS NOT NULL)),
 CHECK(payload_digest=app.checkpoint_digest(payload,'01coding-exam-scoring-event'))
);
CREATE FUNCTION app.guard_exam_scoring_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'Exam scoring evidence and assignment history is immutable';
END $$;
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['exam_scoring_rubrics','exam_scoring_assignments','exam_scoring_acceptances','exam_scoring_closures','exam_scoring_events'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_exam_scoring_history()',n||'_immutable',n);
 END LOOP;
END $$;

CREATE FUNCTION app.capture_exam_scoring_acceptance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; assignment app.exam_scoring_assignments; r app.exam_scoring_rubrics;
 task text; kind text; content_hash text; route text; route_hash text; accepted timestamptz; source text;
BEGIN
 IF TG_TABLE_NAME='submissions' THEN
 IF NEW.checkpoint_attempt_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=NEW.checkpoint_attempt_id FOR UPDATE;
 task:=NEW.checkpoint_task_key;kind:='coding';source:='coding';accepted:=NEW.created_at;
 SELECT sha256 INTO content_hash FROM app.submission_artifacts WHERE id=NEW.artifact_id AND owner_user_id=NEW.user_id;
 route:='official-code';route_hash:=NEW.evaluation_spec_digest;
 ELSE
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=NEW.attempt_id FOR UPDATE;
 task:=NEW.task_key;kind:=NEW.answer_kind;content_hash:=NEW.answer_digest;
 route:=NEW.evaluator_key;route_hash:=NEW.evaluator_digest;accepted:=NEW.accepted_at;source:='structured';
 END IF;
 -- Legacy records are untouched. An explicit new marker with a missing binding
 -- rejects the new acceptance; it never guesses a rubric or accepts an old task.
 IF NOT (a.snapshot->'definition' ? 'examScoring') THEN RETURN NEW; END IF;
 SELECT * INTO assignment FROM app.exam_scoring_assignments WHERE attempt_id=a.id;
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=assignment.rubric_digest;
 IF assignment.attempt_id IS NULL OR r.rubric_digest IS NULL
 OR r.definition_digest IS DISTINCT FROM a.definition_digest
 OR a.snapshot->'definition'->'examScoring' IS DISTINCT FROM jsonb_build_object('version',1,'form',r.form,'rubricDigest',r.rubric_digest)
 OR a.snapshot_digest IS DISTINCT FROM app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt')
 OR a.deadline_at<>a.started_at+interval '180 minutes'
 OR a.status<>'active' OR accepted<a.started_at OR accepted>=a.deadline_at
 OR EXISTS(SELECT FROM app.exam_scoring_closures WHERE attempt_id=a.id)
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(r.rubric->'questions') q WHERE q->>'questionKey'=task AND q->>'kind'=kind)
 OR content_hash IS NULL OR content_hash !~ '^[0-9a-f]{64}$' THEN
 RAISE EXCEPTION 'Frozen Exam1 scoring acceptance unavailable' USING ERRCODE='PS005'; END IF;
 INSERT INTO app.exam_scoring_acceptances VALUES(NEW.id,a.id,task,kind,content_hash,a.snapshot_digest,route,route_hash,accepted,nextval('app.exam_scoring_acceptance_order'),source);
 INSERT INTO app.exam_scoring_heads(submission_id) VALUES(NEW.id);
 RETURN NEW;
END $$;
CREATE FUNCTION app.capture_exam_scoring_closure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF OLD.status='active' AND NEW.status<>'active' AND OLD.snapshot->'definition' ? 'examScoring' THEN
 IF NOT EXISTS(SELECT FROM app.exam_scoring_assignments WHERE attempt_id=OLD.id)
 OR NEW.closed_at IS NULL OR NEW.closure_reason NOT IN ('finished','expired') THEN
 RAISE EXCEPTION 'Frozen Exam1 closure unavailable' USING ERRCODE='PS005'; END IF;
 INSERT INTO app.exam_scoring_closures VALUES(OLD.id,NEW.closed_at,nextval('app.exam_scoring_acceptance_order'),NEW.closure_reason);
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION app.exam_scoring_marks_valid(m jsonb,k text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$ BEGIN
 IF jsonb_typeof(m)<>'object' THEN RETURN false; END IF;
 IF k='coding' THEN RETURN coalesce((m ? 'contract') AND (SELECT count(*)=1 FROM jsonb_object_keys(m)) AND m->>'contract' ~ '^[0-2]$' AND jsonb_typeof(m->'contract')='number',false); END IF;
 IF k='trace_with_reason' THEN RETURN coalesce((m ? 'reason') AND (SELECT count(*)=1 FROM jsonb_object_keys(m)) AND m->>'reason' ~ '^[0-2]$' AND jsonb_typeof(m->'reason')='number',false); END IF;
 IF k<>'debug_with_reason' THEN RETURN false; END IF;
 RETURN coalesce((m ?& ARRAY['counterexample','explanation']) AND (SELECT count(*)=2 FROM jsonb_object_keys(m)) AND m->>'counterexample' ~ '^[0-4]$' AND m->>'explanation' ~ '^[0-2]$'
 AND jsonb_typeof(m->'counterexample')='number' AND jsonb_typeof(m->'explanation')='number',false);
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION app.record_exam_scoring_event(auth_id uuid,operation uuid,submission uuid,expected bigint,kind text,body jsonb,body_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE acc app.exam_scoring_acceptances; a app.checkpoint_attempts; assignment app.exam_scoring_assignments;
 r app.exam_scoring_rubrics; q jsonb; actor uuid; evaluator app.exam_scoring_evaluator_logins;
 old app.exam_scoring_events; made app.exam_scoring_events; current_revision bigint;
 e jsonb; g jsonb; seen text[]:=ARRAY[]::text[]; prior app.exam_scoring_events;
BEGIN
 IF operation IS NULL OR expected IS NULL OR expected<0 OR expected=9223372036854775807
 OR kind IS NULL OR kind NOT IN ('functional','primary','secondary') OR body IS NULL
 OR body_hash IS DISTINCT FROM app.checkpoint_digest(body,'01coding-exam-scoring-event')
 OR current_setting('role')<>'none' THEN RETURN jsonb_build_object('kind','invalid_input'); END IF;
 SELECT * INTO acc FROM app.exam_scoring_acceptances WHERE submission_id=submission;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=acc.attempt_id FOR SHARE;
 SELECT * INTO assignment FROM app.exam_scoring_assignments WHERE attempt_id=acc.attempt_id FOR SHARE;
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=assignment.rubric_digest;
 IF acc.submission_id IS NULL OR assignment.attempt_id IS NULL OR r.rubric_digest IS NULL
 OR r.definition_digest IS DISTINCT FROM a.definition_digest OR acc.snapshot_digest IS DISTINCT FROM a.snapshot_digest THEN RETURN jsonb_build_object('kind','unavailable'); END IF;
 SELECT value INTO q FROM jsonb_array_elements(r.rubric->'questions') WHERE value->>'questionKey'=acc.question_key;
 IF kind='functional' THEN
 SELECT * INTO evaluator FROM app.exam_scoring_evaluator_logins WHERE login_name=session_user AND enabled FOR SHARE;
 IF auth_id IS NOT NULL OR evaluator.login_name IS NULL OR evaluator.evaluator_key IS DISTINCT FROM acc.evaluator_key
 OR evaluator.evaluator_digest IS DISTINCT FROM acc.evaluator_digest
 OR NOT pg_has_role(session_user,'nextera_exam_evaluator','USAGE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR pg_has_role(session_user,'nextera_checkpoint_owner','USAGE') OR pg_has_role(session_user,'nextera_checkpoint_owner','SET')
 OR pg_has_role(session_user,'nextera_web','USAGE') OR pg_has_role(session_user,'nextera_web','SET') THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 IF body=jsonb_build_object('state','infrastructure_unknown') THEN NULL;
 ELSE
 IF jsonb_typeof(body)<>'object' OR NOT (body ?& ARRAY['state','evidence']) OR (SELECT count(*) FROM jsonb_object_keys(body))<>2 OR jsonb_typeof(body->'state') IS DISTINCT FROM 'string' OR body->>'state' IS DISTINCT FROM 'evaluated' THEN RETURN jsonb_build_object('kind','invalid_input'); END IF;
 e:=body->'evidence';
 IF jsonb_typeof(e)<>'object' OR NOT (e ?& ARRAY['submissionId','questionKey','answerSha256','rubricDigest','publishedCriteriaDigest','evidenceDigest','kind']) OR (SELECT count(*) FROM jsonb_object_keys(e))<>8
 OR EXISTS(SELECT FROM unnest(ARRAY['submissionId','questionKey','answerSha256','rubricDigest','publishedCriteriaDigest','kind','evidenceDigest']) k WHERE jsonb_typeof(e->k) IS DISTINCT FROM 'string')
 OR e->>'submissionId' IS DISTINCT FROM acc.submission_id::text OR e->>'questionKey' IS DISTINCT FROM acc.question_key
 OR e->>'answerSha256' IS DISTINCT FROM acc.answer_digest OR e->>'rubricDigest' IS DISTINCT FROM r.rubric_digest
 OR e->>'publishedCriteriaDigest' IS DISTINCT FROM q->>'publishedCriteriaDigest'
 OR e->>'evidenceDigest' IS NULL OR e->>'evidenceDigest' !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('kind','invalid_input'); END IF;
 IF acc.answer_kind='trace_with_reason' THEN
 IF e->>'kind' IS DISTINCT FROM 'trace_output' OR jsonb_typeof(e->'matched') IS DISTINCT FROM 'boolean' THEN RETURN jsonb_build_object('kind','invalid_input'); END IF;
 ELSE
 IF e->>'kind' IS DISTINCT FROM 'groups' OR jsonb_typeof(e->'outcomes') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'outcomes')<>jsonb_array_length(q->'functionalGroups') THEN RETURN jsonb_build_object('kind','invalid_input'); END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(e->'outcomes') LOOP
 IF jsonb_typeof(g)<>'object' OR NOT (g ?& ARRAY['groupKey','criteriaDigest','passed']) OR (SELECT count(*) FROM jsonb_object_keys(g))<>3 OR g->>'groupKey'=ANY(seen)
 OR EXISTS(SELECT FROM unnest(ARRAY['groupKey','criteriaDigest']) k WHERE jsonb_typeof(g->k) IS DISTINCT FROM 'string')
 OR jsonb_typeof(g->'passed') IS DISTINCT FROM 'boolean' OR NOT EXISTS(SELECT FROM jsonb_array_elements(q->'functionalGroups') x WHERE x->>'key'=g->>'groupKey' AND x->>'criteriaDigest'=g->>'criteriaDigest') THEN RETURN jsonb_build_object('kind','invalid_input'); END IF;
 seen:=array_append(seen,g->>'groupKey'); END LOOP;
 END IF; END IF;
 ELSE
 SELECT u.id INTO actor FROM app.users u JOIN app.cohort_memberships m ON m.user_id=u.id AND m.cohort_id=a.cohort_id
 WHERE u.auth_user_id=auth_id AND u.active AND u.role IN ('operator','admin') AND m.status='active' FOR SHARE OF u,m;
 IF NOT pg_has_role(session_user,'nextera_web','USAGE') OR actor IS NULL OR actor=a.user_id
 OR actor IS DISTINCT FROM CASE kind WHEN 'primary' THEN assignment.primary_mentor_id ELSE assignment.secondary_mentor_id END THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 IF NOT EXISTS(SELECT FROM app.exam_scoring_closures WHERE attempt_id=a.id) AND clock_timestamp()<a.deadline_at THEN RETURN jsonb_build_object('kind','review_not_open'); END IF;
 IF jsonb_typeof(body)<>'object' OR NOT (body ?& ARRAY['answerSha256','rubricDigest','assignmentDigest','evidenceDigest','marks']) OR (SELECT count(*) FROM jsonb_object_keys(body))<>CASE kind WHEN 'primary' THEN 5 ELSE 6 END
 OR EXISTS(SELECT FROM unnest(ARRAY['answerSha256','rubricDigest','assignmentDigest','evidenceDigest']) k WHERE jsonb_typeof(body->k) IS DISTINCT FROM 'string')
 OR (kind='secondary' AND jsonb_typeof(body->'primaryEventId') IS DISTINCT FROM 'string')
 OR body->>'answerSha256' IS DISTINCT FROM acc.answer_digest OR body->>'rubricDigest' IS DISTINCT FROM r.rubric_digest
 OR body->>'assignmentDigest' IS DISTINCT FROM assignment.assignment_digest OR body->>'evidenceDigest' IS NULL OR body->>'evidenceDigest' !~ '^[0-9a-f]{64}$'
 OR NOT coalesce(app.exam_scoring_marks_valid(body->'marks',acc.answer_kind),false) THEN RETURN jsonb_build_object('kind','invalid_input'); END IF;
 END IF;
 -- Serialize per acceptance, and globally serialize a replay operation before
 -- looking it up. The expected revision is part of immutable replay identity.
 PERFORM pg_advisory_xact_lock(hashtextextended(operation::text,24));
 SELECT revision INTO current_revision FROM app.exam_scoring_heads WHERE submission_id=submission FOR UPDATE;
 SELECT * INTO old FROM app.exam_scoring_events WHERE operation_id=operation;
 IF FOUND THEN
 IF old.submission_id IS DISTINCT FROM submission OR old.expected_revision IS DISTINCT FROM expected OR old.event_kind IS DISTINCT FROM kind
 OR old.caller_login IS DISTINCT FROM session_user OR old.actor_user_id IS DISTINCT FROM actor
 OR old.payload IS DISTINCT FROM body OR old.payload_digest IS DISTINCT FROM body_hash THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 RETURN jsonb_build_object('kind','recorded','eventId',old.event_id,'operationId',operation,'submissionId',submission,'revision',old.revision::text,'payloadDigest',body_hash,'replayed',true); END IF;
 IF current_revision IS DISTINCT FROM expected THEN RETURN jsonb_build_object('kind','stale_revision'); END IF;
 IF kind='secondary' THEN
 SELECT * INTO prior FROM app.exam_scoring_events WHERE submission_id=submission AND event_kind='primary' ORDER BY revision DESC LIMIT 1;
 IF prior.event_id IS NULL OR body->>'primaryEventId' IS DISTINCT FROM prior.event_id::text OR prior.actor_user_id=actor THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 END IF;
 INSERT INTO app.exam_scoring_events VALUES(gen_random_uuid(),operation,submission,expected+1,expected,kind,session_user,actor,body,body_hash,clock_timestamp()) RETURNING * INTO made;
 UPDATE app.exam_scoring_heads SET revision=made.revision WHERE submission_id=submission;
 RETURN jsonb_build_object('kind','recorded','eventId',made.event_id,'operationId',operation,'submissionId',submission,'revision',made.revision::text,'payloadDigest',body_hash,'replayed',false);
END $$;
CREATE FUNCTION app.exam_scoring_history(auth_id uuid,submission uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE acc app.exam_scoring_acceptances; a app.checkpoint_attempts; assignment app.exam_scoring_assignments; r app.exam_scoring_rubrics; actor uuid; history jsonb; head_revision bigint;
BEGIN
 IF current_setting('role')<>'none' OR NOT pg_has_role(session_user,'nextera_web','USAGE') THEN RAISE EXCEPTION 'Scoring history forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO acc FROM app.exam_scoring_acceptances WHERE submission_id=submission;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=acc.attempt_id;
 SELECT * INTO assignment FROM app.exam_scoring_assignments WHERE attempt_id=a.id;
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=assignment.rubric_digest;
 SELECT u.id INTO actor FROM app.users u JOIN app.cohort_memberships m ON m.user_id=u.id AND m.cohort_id=a.cohort_id
 WHERE u.auth_user_id=auth_id AND u.active AND m.status='active' AND ((u.id=a.user_id AND u.role='learner') OR (u.id IN (assignment.primary_mentor_id,assignment.secondary_mentor_id) AND u.role IN ('operator','admin')));
 IF actor IS NULL OR acc.submission_id IS NULL THEN RAISE EXCEPTION 'Scoring history forbidden' USING ERRCODE='42501'; END IF;
 SELECT revision INTO head_revision FROM app.exam_scoring_heads WHERE submission_id=submission FOR SHARE;
 SELECT coalesce(jsonb_agg(jsonb_build_object('eventId',e.event_id,'operationId',e.operation_id,'revision',e.revision::text,'eventKind',e.event_kind,'actorUserId',e.actor_user_id,'payload',e.payload,'payloadDigest',e.payload_digest) ORDER BY revision),'[]'::jsonb) INTO history FROM app.exam_scoring_events e WHERE e.submission_id=submission;
 RETURN jsonb_build_object('submissionId',submission,'attemptId',a.id,'learnerId',a.user_id,'cohortId',a.cohort_id,'questionKey',acc.question_key,'answerKind',acc.answer_kind,'answerSha256',acc.answer_digest,'definitionDigest',a.definition_digest,'rubricDigest',r.rubric_digest,'form',r.form,'acceptedOrdinal',acc.accepted_ordinal::text,'revision',head_revision::text,'status','provisional','events',history);
 -- Final Exam1 outcome/progression application is deliberately not implemented
 -- by this evidence RPC. Missing/review-pending/system-error evidence is not zero.
END $$;

-- All new storage and helpers are private. Remove unexpected default grants
-- before granting only the two public RPCs to their explicit restricted groups.
DO $$ DECLARE o record; g record; BEGIN
 FOR o IN SELECT c.oid,c.oid::regclass AS name,c.relowner AS owner,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname IN ('exam_scoring_rubrics','exam_scoring_assignments','exam_scoring_acceptance_order','exam_scoring_acceptances','exam_scoring_closures','exam_scoring_heads','exam_scoring_evaluator_logins','exam_scoring_events') LOOP
 IF o.relkind='r' THEN EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',o.name); END IF;
 FOR g IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS recipient FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=o.oid AND a.grantee<>o.owner LOOP
 EXECUTE format('REVOKE ALL ON %s %s FROM %s',CASE WHEN (SELECT relkind FROM pg_class WHERE oid=o.oid)='S' THEN 'SEQUENCE' ELSE 'TABLE' END,o.name,g.recipient); END LOOP; END LOOP;
 FOR o IN SELECT p.oid,p.oid::regprocedure AS name,p.proowner AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN ('exam_scoring_rubric_valid','exam_scoring_source_binding_valid','guard_exam_scoring_history','capture_exam_scoring_acceptance','capture_exam_scoring_closure','exam_scoring_marks_valid','record_exam_scoring_event','exam_scoring_history') LOOP
 FOR g IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS recipient FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=o.oid AND a.grantee<>o.owner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',o.name,g.recipient); END LOOP; END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.record_exam_scoring_event(uuid,uuid,uuid,bigint,text,jsonb,text) TO nextera_web,nextera_exam_evaluator;
GRANT EXECUTE ON FUNCTION app.exam_scoring_history(uuid,uuid) TO nextera_web;
RESET ROLE;
DO $$ BEGIN
 -- Already-held authority proof, not a grant. The future disposable controller
 -- must independently verify fresh cluster ownership/scope before setting this
 -- audit marker. The marker alone never confers authority.
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'exam-scoring-0024-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin) THEN
 RAISE EXCEPTION 'Fresh isolated bootstrap DBA span required'; END IF;
END $$;
-- Separate reviewed table-owner/DBA span: install ONLY these three triggers on
-- the existing source tables. No TRIGGER privilege is granted to the migration
-- actor or web/evaluator. Preflight verifies the invoking DBA already has it.
-- Four external-existing-table FKs installed by the already-held bootstrap DBA.
ALTER TABLE app.exam_scoring_assignments ADD CONSTRAINT exam_scoring_assignment_attempt_fk FOREIGN KEY(attempt_id) REFERENCES app.checkpoint_attempts(id) ON DELETE RESTRICT;
ALTER TABLE app.exam_scoring_assignments ADD CONSTRAINT exam_scoring_assignment_primary_fk FOREIGN KEY(primary_mentor_id) REFERENCES app.users(id) ON DELETE RESTRICT;
ALTER TABLE app.exam_scoring_assignments ADD CONSTRAINT exam_scoring_assignment_secondary_fk FOREIGN KEY(secondary_mentor_id) REFERENCES app.users(id) ON DELETE RESTRICT;
ALTER TABLE app.exam_scoring_events ADD CONSTRAINT exam_scoring_event_actor_fk FOREIGN KEY(actor_user_id) REFERENCES app.users(id) ON DELETE RESTRICT;
CREATE TRIGGER exam_scoring_capture_coding AFTER INSERT ON app.submissions FOR EACH ROW EXECUTE FUNCTION app.capture_exam_scoring_acceptance();
CREATE TRIGGER exam_scoring_capture_structured AFTER INSERT ON app.checkpoint_answer_receipts FOR EACH ROW EXECUTE FUNCTION app.capture_exam_scoring_acceptance();
CREATE TRIGGER exam_scoring_capture_closure BEFORE UPDATE OF status ON app.checkpoint_attempts FOR EACH ROW EXECUTE FUNCTION app.capture_exam_scoring_closure();
-- Read back exact ownership/private table ACLs and named external FKs before
-- commit. Bootstrap authority installs constraints; it is never granted to the
-- checkpoint-owner, web, evaluator or migration actor by this draft.
DO $external_fk_audit$ BEGIN
 IF EXISTS(SELECT FROM (VALUES ('exam_scoring_rubrics'),('exam_scoring_assignments'),('exam_scoring_acceptances'),('exam_scoring_closures'),('exam_scoring_heads'),('exam_scoring_evaluator_logins'),('exam_scoring_events')) expected(name)
 WHERE NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_roles o ON o.oid=c.relowner WHERE n.nspname='app' AND c.relname=expected.name
 AND c.relkind='r' AND c.relrowsecurity AND o.rolname='nextera_checkpoint_owner'
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner))) THEN
 RAISE EXCEPTION 'New scoring table owner/RLS/private ACL readback failed'; END IF;
 IF EXISTS(SELECT FROM (VALUES
 ('exam_scoring_assignment_attempt_fk','app.exam_scoring_assignments','app.checkpoint_attempts',ARRAY['attempt_id']::text[],ARRAY['id']::text[],false),
 ('exam_scoring_assignment_primary_fk','app.exam_scoring_assignments','app.users',ARRAY['primary_mentor_id']::text[],ARRAY['id']::text[],false),
 ('exam_scoring_assignment_secondary_fk','app.exam_scoring_assignments','app.users',ARRAY['secondary_mentor_id']::text[],ARRAY['id']::text[],false),
 ('exam_scoring_event_actor_fk','app.exam_scoring_events','app.users',ARRAY['actor_user_id']::text[],ARRAY['id']::text[],false)
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
