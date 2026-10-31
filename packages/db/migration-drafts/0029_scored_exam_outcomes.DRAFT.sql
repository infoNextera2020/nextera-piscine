-- SOURCE REVIEW DRAFT ONLY. Never registered/applied/provisioned by this file.
-- Requires0000-0010 + reviewed0024-0028. No new role or LOGIN is created.
-- A fresh isolated bootstrap DBA supplies an already-held SET-only owner span.
-- Missing explicit scoped adjudication policy/evidence means provisional, not a waiver.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'exam-outcomes-0029-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin)
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')
 OR NOT has_schema_privilege('nextera_checkpoint_owner','app','CREATE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin
 AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR to_regprocedure('app.scored_exam_result_projection(uuid,uuid)') IS NULL
 OR to_regprocedure('app.scored_exam_review_context(uuid,uuid)') IS NULL
 OR to_regclass('app.exam_scoring_events') IS NULL THEN
 RAISE EXCEPTION 'Reviewed fresh isolated outcome owner prerequisites required'; END IF;
END $$;
-- The existing three evidence pointers, including Raid, remain unchanged.
ALTER TABLE app.learner_node_progress ADD COLUMN first_passing_scored_exam_outcome_id uuid;
ALTER TABLE app.learner_node_progress DROP CONSTRAINT progress_state_timestamps_check;
ALTER TABLE app.learner_node_progress ADD CONSTRAINT progress_state_timestamps_check CHECK (
 (state='locked' AND unlocked_at IS NULL AND started_at IS NULL AND mastered_at IS NULL AND num_nonnulls(first_passing_submission_id,first_passing_checkpoint_outcome_id,first_passing_raid_outcome_id,first_passing_scored_exam_outcome_id)=0) OR
 (state='available' AND unlocked_at IS NOT NULL AND started_at IS NULL AND mastered_at IS NULL AND num_nonnulls(first_passing_submission_id,first_passing_checkpoint_outcome_id,first_passing_raid_outcome_id,first_passing_scored_exam_outcome_id)=0) OR
 (state='in_progress' AND unlocked_at IS NOT NULL AND started_at IS NOT NULL AND mastered_at IS NULL AND num_nonnulls(first_passing_submission_id,first_passing_checkpoint_outcome_id,first_passing_raid_outcome_id,first_passing_scored_exam_outcome_id)=0) OR
 (state='mastered' AND unlocked_at IS NOT NULL AND started_at IS NOT NULL AND mastered_at IS NOT NULL AND num_nonnulls(first_passing_submission_id,first_passing_checkpoint_outcome_id,first_passing_raid_outcome_id,first_passing_scored_exam_outcome_id)=1)
);
-- Narrow new column authority for the existing NOLOGIN owner, never callers.
GRANT UPDATE(first_passing_scored_exam_outcome_id) ON app.learner_node_progress TO nextera_checkpoint_owner;
SET LOCAL ROLE nextera_checkpoint_owner;
CREATE TABLE app.exam_scoring_adjudications (
 id uuid PRIMARY KEY, operation_id uuid NOT NULL UNIQUE, attempt_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), previous_id uuid REFERENCES app.exam_scoring_adjudications(id),
 actor_user_id uuid NOT NULL, caller_login name NOT NULL,
 projection jsonb NOT NULL, projection_digest text NOT NULL CHECK(projection_digest ~ '^[0-9a-f]{64}$'),
 expected_prior_outcome_id uuid, body jsonb NOT NULL,
 body_digest text NOT NULL CHECK(body_digest=app.checkpoint_digest(body,'01coding-exam-adjudication')),
 policy_digest text NOT NULL CHECK(policy_digest=app.checkpoint_digest(body->'policy','01coding-exam-adjudication-policy')),
 recorded_at timestamptz NOT NULL, UNIQUE(attempt_id,revision),
 CHECK(projection_digest=app.checkpoint_digest(projection,'01coding-exam-outcome-projection'))
);
CREATE TABLE app.exam_scoring_adjudication_heads (
 attempt_id uuid PRIMARY KEY, revision bigint NOT NULL CHECK(revision>=0),
 latest_id uuid REFERENCES app.exam_scoring_adjudications(id),
 CHECK((revision=0)=(latest_id IS NULL))
);
CREATE TABLE app.exam_scoring_final_outcomes (
 id uuid PRIMARY KEY, operation_id uuid NOT NULL UNIQUE, attempt_id uuid NOT NULL,
 cohort_id uuid NOT NULL,user_id uuid NOT NULL,curriculum_version_id uuid NOT NULL,node_key text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), previous_id uuid REFERENCES app.exam_scoring_final_outcomes(id),
 adjudication_id uuid NOT NULL UNIQUE REFERENCES app.exam_scoring_adjudications(id),
 projection_digest text NOT NULL CHECK(projection_digest ~ '^[0-9a-f]{64}$'),
 verdict text NOT NULL CHECK(verdict IN('passed','failed')),
 total_points integer NOT NULL CHECK(total_points BETWEEN 0 AND 100),
 coding_points integer NOT NULL CHECK(coding_points BETWEEN 0 AND 75),
 result jsonb NOT NULL,result_digest text NOT NULL CHECK(result_digest=app.checkpoint_digest(result,'01coding-exam-final-outcome')),
 implementation_digest text NOT NULL CHECK(implementation_digest ~ '^[0-9a-f]{64}$'),
 caller_login name NOT NULL,applied_at timestamptz NOT NULL,
 UNIQUE(attempt_id,revision),UNIQUE(id,cohort_id,user_id,curriculum_version_id,node_key),
 CHECK((verdict='passed')=(total_points>=60 AND coding_points>=45))
);
CREATE TABLE app.exam_scoring_outcome_heads (
 attempt_id uuid PRIMARY KEY,revision bigint NOT NULL CHECK(revision>=0),
 latest_id uuid REFERENCES app.exam_scoring_final_outcomes(id),
 CHECK((revision=0)=(latest_id IS NULL))
);
-- Owner-configured future runtime identity, not a membership or credential grant.
CREATE TABLE app.exam_scoring_outcome_logins (
 login_name name NOT NULL,cohort_id uuid NOT NULL,
 implementation_digest text NOT NULL CHECK(implementation_digest ~ '^[0-9a-f]{64}$'),
 enabled boolean NOT NULL DEFAULT false,PRIMARY KEY(login_name,cohort_id)
);
CREATE FUNCTION app.guard_exam_outcome_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'Scored exam adjudication and outcome history is immutable';
END $$;
CREATE TRIGGER exam_adjudication_immutable BEFORE UPDATE OR DELETE ON app.exam_scoring_adjudications FOR EACH ROW EXECUTE FUNCTION app.guard_exam_outcome_history();
CREATE TRIGGER exam_final_outcome_immutable BEFORE UPDATE OR DELETE ON app.exam_scoring_final_outcomes FOR EACH ROW EXECUTE FUNCTION app.guard_exam_outcome_history();

CREATE FUNCTION app.scored_exam_outcome_web_caller() RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT current_setting('role')='none' AND pg_has_role(session_user,'nextera_web','USAGE')
 AND EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 AND NOT pg_has_role(session_user,'nextera_checkpoint_owner','USAGE') AND NOT pg_has_role(session_user,'nextera_checkpoint_owner','SET')
 AND NOT pg_has_role(session_user,'nextera_exam_evaluator','USAGE') AND NOT pg_has_role(session_user,'nextera_exam_evaluator','SET')
$$;
CREATE FUNCTION app.scored_exam_outcome_projection(a app.checkpoint_attempts) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE assignment app.exam_scoring_assignments;r app.exam_scoring_rubrics;c app.exam_scoring_closures;accepted jsonb;
BEGIN
 SELECT * INTO assignment FROM app.exam_scoring_assignments WHERE attempt_id=a.id;
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=assignment.rubric_digest;
 SELECT * INTO c FROM app.exam_scoring_closures WHERE attempt_id=a.id;
 IF assignment.attempt_id IS NULL OR r.rubric_digest IS NULL OR app.scored_exam_attempt_metadata(a) IS NULL
 OR a.snapshot_digest IS DISTINCT FROM app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt')
 OR r.definition_digest IS DISTINCT FROM a.definition_digest THEN RAISE EXCEPTION 'Outcome snapshot unavailable' USING ERRCODE='PS005'; END IF;
 IF assignment.primary_mentor_id=a.user_id OR assignment.secondary_mentor_id=a.user_id OR assignment.assignment_digest IS DISTINCT FROM app.checkpoint_digest(jsonb_build_object('version',1,'attemptId',a.id,'learnerId',a.user_id,'cohortId',a.cohort_id,'definitionDigest',a.definition_digest,'rubricDigest',r.rubric_digest,'primaryMentorId',assignment.primary_mentor_id,'secondaryMentorId',assignment.secondary_mentor_id),'01coding-exam-scoring-assignment') THEN RAISE EXCEPTION 'Outcome assignment unavailable' USING ERRCODE='PS005';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('submissionId',x.submission_id,'questionKey',x.question_key,
 'answerKind',x.answer_kind,'answerSha256',x.answer_digest,
 'acceptedAtMicros',(extract(epoch FROM x.accepted_at)*1000000)::bigint::text,
 'acceptedOrdinal',x.accepted_ordinal::text,'revision',h.revision::text) ORDER BY x.accepted_ordinal),'[]'::jsonb)
 INTO accepted FROM app.exam_scoring_acceptances x JOIN app.exam_scoring_heads h ON h.submission_id=x.submission_id WHERE x.attempt_id=a.id;
 IF jsonb_array_length(accepted)<>(SELECT count(*) FROM app.exam_scoring_acceptances WHERE attempt_id=a.id)
 THEN RAISE EXCEPTION 'Missing outcome evidence head' USING ERRCODE='PS005'; END IF;
 RETURN jsonb_build_object('version',1,'scope',jsonb_build_object('learnerId',a.user_id,'cohortId',a.cohort_id,'attemptId',a.id,
 'form',r.form,'definitionDigest',a.definition_digest,'rubricDigest',r.rubric_digest),
 'snapshotDigest',a.snapshot_digest,'assignmentDigest',assignment.assignment_digest,
 'closure',CASE WHEN c.attempt_id IS NULL THEN NULL ELSE jsonb_build_object('reason',c.reason,
 'closedAtMicros',(extract(epoch FROM c.closed_at)*1000000)::bigint::text,'closureOrdinal',c.closure_ordinal::text) END,
 'acceptances',accepted);
END $$;

-- Independently recompute the approved best WHOLE finalized submission per question.
-- Any unresolved infrastructure/functional/manual evidence remains unavailable, never zero.
CREATE FUNCTION app.scored_exam_outcome_candidate(a app.checkpoint_attempts) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE assignment app.exam_scoring_assignments;r app.exam_scoring_rubrics;x app.exam_scoring_acceptances;
 f app.exam_scoring_events;p app.exam_scoring_events;s app.exam_scoring_events;q jsonb;g jsonb;
 key text;points integer;functional integer;manual integer;best integer;best_order bigint;best_id uuid;best_hash text;
 total integer:=0;coding integer:=0;questions jsonb:='[]';selection jsonb:='[]';
BEGIN
 SELECT * INTO assignment FROM app.exam_scoring_assignments WHERE attempt_id=a.id;
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=assignment.rubric_digest;
 IF r.rubric_digest IS NULL OR NOT EXISTS(SELECT FROM app.exam_scoring_closures WHERE attempt_id=a.id) THEN RETURN NULL; END IF;
 FOREACH key IN ARRAY ARRAY['q1','q2','q3','q4','q5','q6','q7','q8'] LOOP
 SELECT value INTO q FROM jsonb_array_elements(r.rubric->'questions') WHERE value->>'questionKey'=key;
 best:=-1;best_order:=-1;best_id:=NULL;best_hash:=NULL;
 FOR x IN SELECT * FROM app.exam_scoring_acceptances WHERE attempt_id=a.id AND question_key=key ORDER BY accepted_ordinal LOOP
 SELECT * INTO f FROM app.exam_scoring_events WHERE submission_id=x.submission_id AND event_kind='functional' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO p FROM app.exam_scoring_events WHERE submission_id=x.submission_id AND event_kind='primary' ORDER BY revision DESC LIMIT 1;
 IF f.event_id IS NULL OR p.event_id IS NULL OR f.payload->>'state' IS DISTINCT FROM 'evaluated'
 OR p.actor_user_id IS DISTINCT FROM assignment.primary_mentor_id THEN RETURN NULL; END IF;
 SELECT * INTO s FROM app.exam_scoring_events WHERE submission_id=x.submission_id AND event_kind='secondary'
 AND payload->>'primaryEventId'=p.event_id::text ORDER BY revision DESC LIMIT 1;
 IF s.event_id IS NOT NULL AND (s.actor_user_id IS DISTINCT FROM assignment.secondary_mentor_id OR s.payload->'marks' IS DISTINCT FROM p.payload->'marks') THEN RETURN NULL; END IF;
 IF x.answer_kind='trace_with_reason' THEN functional:=CASE WHEN f.payload->'evidence'->'matched'='true'::jsonb THEN 3 ELSE 0 END;
 ELSE
 functional:=0;
 FOR g IN SELECT value FROM jsonb_array_elements(q->'functionalGroups') LOOP
 IF EXISTS(SELECT FROM jsonb_array_elements(f.payload->'evidence'->'outcomes') o WHERE o->>'groupKey'=g->>'key' AND o->>'criteriaDigest'=g->>'criteriaDigest' AND o->'passed'='true'::jsonb)
 THEN functional:=functional+(g->>'points')::integer; END IF;
 END LOOP;
 END IF;
 manual:=CASE x.answer_kind WHEN 'coding' THEN (p.payload->'marks'->>'contract')::integer
 WHEN 'trace_with_reason' THEN (p.payload->'marks'->>'reason')::integer
 ELSE (p.payload->'marks'->>'counterexample')::integer+(p.payload->'marks'->>'explanation')::integer END;
 points:=functional+manual;
 IF points>best OR (points=best AND x.accepted_ordinal>best_order) THEN best:=points;best_order:=x.accepted_ordinal;best_id:=x.submission_id;best_hash:=x.answer_digest; END IF;
 END LOOP;
 selection:=selection||jsonb_build_array(jsonb_build_object('questionKey',key,'submissionId',best_id));
 questions:=questions||jsonb_build_array(jsonb_build_object('questionKey',key,'state',CASE WHEN best_id IS NULL THEN 'unsubmitted' ELSE 'scored' END,
 'submissionId',best_id,'answerSha256',best_hash,'points',CASE WHEN best_id IS NULL THEN NULL ELSE best END));
 total:=total+greatest(best,0);IF key IN('q1','q2','q3','q4','q5') THEN coding:=coding+greatest(best,0); END IF;
 END LOOP;
 RETURN jsonb_build_object('selection',selection,'questions',questions,'totalPoints',total,'codingPoints',coding,
 'verdict',CASE WHEN total>=60 AND coding>=45 THEN 'passed' ELSE 'failed' END);
END $$;

CREATE FUNCTION app.scored_exam_adjudication_body_valid(b jsonb,p jsonb,candidate jsonb,prior_id uuid,prior_verdict text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE policy jsonb;decision jsonb;x jsonb;seen text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(b) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(b))<>5
 OR NOT (b ?& ARRAY['version','projectionDigest','priorOutcomeId','policy','decision'])
 OR b->'version' IS DISTINCT FROM '1'::jsonb
 OR b->>'projectionDigest' IS DISTINCT FROM app.checkpoint_digest(p,'01coding-exam-outcome-projection')
 OR b->'priorOutcomeId' IS DISTINCT FROM coalesce(to_jsonb(prior_id),'null'::jsonb) THEN RETURN false; END IF;
 policy:=b->'policy';decision:=b->'decision';
 IF jsonb_typeof(policy) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(policy))<>10
 OR NOT (policy ?& ARRAY['version','attemptId','snapshotDigest','rubricDigest','assignmentDigest','projectionDigest','initialThresholdReview','disputed','affectedSubmissionIds','evidenceDigest'])
 OR policy->'version' IS DISTINCT FROM '1'::jsonb
 OR policy->>'attemptId' IS DISTINCT FROM p->'scope'->>'attemptId'
 OR policy->>'snapshotDigest' IS DISTINCT FROM p->>'snapshotDigest'
 OR policy->>'rubricDigest' IS DISTINCT FROM p->'scope'->>'rubricDigest'
 OR policy->>'assignmentDigest' IS DISTINCT FROM p->>'assignmentDigest'
 OR policy->>'projectionDigest' IS DISTINCT FROM b->>'projectionDigest'
 OR policy->>'initialThresholdReview' IS NULL OR policy->>'initialThresholdReview' NOT IN('required','not_required','unresolved')
 OR jsonb_typeof(policy->'disputed') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(policy->'affectedSubmissionIds') IS DISTINCT FROM 'array'
 OR jsonb_typeof(policy->'evidenceDigest') IS DISTINCT FROM 'string' OR policy->>'evidenceDigest' !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
 IF EXISTS(SELECT FROM unnest(ARRAY['attemptId','snapshotDigest','rubricDigest','assignmentDigest','projectionDigest','initialThresholdReview','evidenceDigest']) k WHERE jsonb_typeof(policy->k) IS DISTINCT FROM 'string') THEN RETURN false;END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(policy->'affectedSubmissionIds') LOOP
 IF jsonb_typeof(x) IS DISTINCT FROM 'string' OR (x#>>'{}') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 OR (x#>>'{}')=ANY(seen) OR NOT EXISTS(SELECT FROM jsonb_array_elements(p->'acceptances') a WHERE a->>'submissionId'=x#>>'{}') THEN RETURN false; END IF;
 seen:=array_append(seen,x#>>'{}'); END LOOP;
 IF jsonb_typeof(decision) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(decision))<>6
 OR NOT (decision ?& ARRAY['selection','priorFinalVerdict','proposedVerdict','disputed','initialThresholdReview','affectedSubmissionIds'])
 OR decision->'selection' IS DISTINCT FROM candidate->'selection'
 OR decision->'priorFinalVerdict' IS DISTINCT FROM coalesce(to_jsonb(prior_verdict),'null'::jsonb)
 OR decision->>'proposedVerdict' IS DISTINCT FROM candidate->>'verdict'
 OR decision->'disputed' IS DISTINCT FROM policy->'disputed'
 OR decision->'initialThresholdReview' IS DISTINCT FROM policy->'initialThresholdReview'
 OR decision->'affectedSubmissionIds' IS DISTINCT FROM policy->'affectedSubmissionIds' THEN RETURN false; END IF;
 -- Match examSecondReviewRequirement: an unchanged prior verdict takes
 -- precedence over the initial policy, while a dispute always requires review.
 IF decision->'disputed'='false'::jsonb
 AND ((prior_verdict IS NOT NULL AND prior_verdict=candidate->>'verdict')
 OR (prior_verdict IS NULL AND decision->>'initialThresholdReview'='not_required'))
 AND jsonb_array_length(decision->'affectedSubmissionIds')<>0 THEN RETURN false; END IF;
 RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION app.scored_exam_outcome_applier(cohort uuid,implementation text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(current_setting('role')='none' AND implementation ~ '^[0-9a-f]{64}$'
 AND EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 AND pg_has_role(session_user,'nextera_exam_evaluator','USAGE')
 AND NOT pg_has_role(session_user,'nextera_web','USAGE') AND NOT pg_has_role(session_user,'nextera_web','SET')
 AND NOT pg_has_role(session_user,'nextera_checkpoint_owner','USAGE') AND NOT pg_has_role(session_user,'nextera_checkpoint_owner','SET')
 AND EXISTS(SELECT FROM app.exam_scoring_outcome_logins l WHERE l.login_name=session_user AND l.cohort_id=cohort AND l.enabled AND l.implementation_digest=implementation),false)
$$;

CREATE FUNCTION app.scored_exam_outcome_state(auth_id uuid,attempt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE context jsonb;a app.checkpoint_attempts;p jsonb;d text;ad app.exam_scoring_adjudications;o app.exam_scoring_final_outcomes;
BEGIN
 context:=app.scored_exam_review_context(auth_id,attempt);
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR SHARE;
 p:=app.scored_exam_outcome_projection(a);d:=app.checkpoint_digest(p,'01coding-exam-outcome-projection');
 SELECT x.* INTO ad FROM app.exam_scoring_adjudication_heads h JOIN app.exam_scoring_adjudications x ON x.id=h.latest_id WHERE h.attempt_id=a.id;
 SELECT x.* INTO o FROM app.exam_scoring_outcome_heads h JOIN app.exam_scoring_final_outcomes x ON x.id=h.latest_id WHERE h.attempt_id=a.id;
 RETURN jsonb_build_object('version',1,'projection',p,'projectionDigest',d,
 'adjudication',CASE WHEN ad.id IS NULL THEN NULL ELSE jsonb_build_object('id',ad.id,'revision',ad.revision::text,'operationId',ad.operation_id,
 'projectionDigest',ad.projection_digest,'expectedPriorOutcomeId',ad.expected_prior_outcome_id,
 'policyDigest',ad.policy_digest,'bodyDigest',ad.body_digest,'body',ad.body,
 'current',ad.projection_digest=d AND (ad.expected_prior_outcome_id IS NOT DISTINCT FROM o.id OR o.adjudication_id=ad.id)) END,
 'currentOutcome',CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('id',o.id,'revision',o.revision::text,'verdict',o.verdict,
 'totalPoints',o.total_points,'codingPoints',o.coding_points,'projectionDigest',o.projection_digest,'adjudicationId',o.adjudication_id,
 'resultDigest',o.result_digest,'implementationDigest',o.implementation_digest,'current',o.projection_digest=d AND o.adjudication_id=ad.id) END);
END $$;

CREATE FUNCTION app.record_scored_exam_adjudication(auth_id uuid,operation uuid,attempt uuid,expected_id uuid,b jsonb,b_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;context jsonb;p jsonb;candidate jsonb;d text;
 h app.exam_scoring_adjudication_heads;old app.exam_scoring_adjudications;made app.exam_scoring_adjudications;o app.exam_scoring_final_outcomes;
BEGIN
 IF operation IS NULL OR attempt IS NULL OR b IS NULL OR b_hash IS NULL OR b_hash IS DISTINCT FROM app.checkpoint_digest(b,'01coding-exam-adjudication') THEN RETURN jsonb_build_object('kind','invalid_input'); END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 context:=app.scored_exam_review_context(auth_id,attempt);
 IF context->>'access' IS DISTINCT FROM 'assigned_mentor' OR context->>'actorUserId' IS DISTINCT FROM context->'assignment'->>'primaryMentorId' THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 SELECT * INTO old FROM app.exam_scoring_adjudications WHERE operation_id=operation;
 IF old.id IS NOT NULL THEN
 IF old.attempt_id IS DISTINCT FROM a.id OR old.actor_user_id IS DISTINCT FROM (context->>'actorUserId')::uuid OR old.body_digest IS DISTINCT FROM b_hash OR old.body IS DISTINCT FROM b THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 RETURN jsonb_build_object('kind','accepted','receipt',jsonb_build_object('id',old.id,'attemptId',old.attempt_id,'operationId',old.operation_id,'revision',old.revision::text,'projectionDigest',old.projection_digest,'policyDigest',old.policy_digest,'bodyDigest',old.body_digest),'replayed',true); END IF;
 PERFORM h.submission_id FROM app.exam_scoring_heads h JOIN app.exam_scoring_acceptances x ON x.submission_id=h.submission_id WHERE x.attempt_id=a.id ORDER BY h.submission_id FOR UPDATE OF h;
 p:=app.scored_exam_outcome_projection(a);candidate:=app.scored_exam_outcome_candidate(a);
 IF p->'closure'='null'::jsonb OR candidate IS NULL THEN RETURN jsonb_build_object('kind','unavailable'); END IF;
 SELECT x.* INTO o FROM app.exam_scoring_outcome_heads oh JOIN app.exam_scoring_final_outcomes x ON x.id=oh.latest_id WHERE oh.attempt_id=a.id;
 IF NOT app.scored_exam_adjudication_body_valid(b,p,candidate,o.id,o.verdict) THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 INSERT INTO app.exam_scoring_adjudication_heads VALUES(a.id,0,NULL) ON CONFLICT(attempt_id) DO NOTHING;
 SELECT * INTO h FROM app.exam_scoring_adjudication_heads WHERE attempt_id=a.id FOR UPDATE;
 IF h.latest_id IS DISTINCT FROM expected_id OR h.revision=9223372036854775807 THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 d:=app.checkpoint_digest(p,'01coding-exam-outcome-projection');
 INSERT INTO app.exam_scoring_adjudications VALUES(gen_random_uuid(),operation,a.id,h.revision+1,h.latest_id,(context->>'actorUserId')::uuid,session_user,p,d,o.id,b,b_hash,app.checkpoint_digest(b->'policy','01coding-exam-adjudication-policy'),clock_timestamp()) RETURNING * INTO made;
 UPDATE app.exam_scoring_adjudication_heads SET revision=made.revision,latest_id=made.id WHERE attempt_id=a.id;
 RETURN jsonb_build_object('kind','accepted','receipt',jsonb_build_object('id',made.id,'attemptId',made.attempt_id,'operationId',made.operation_id,'revision',made.revision::text,'projectionDigest',made.projection_digest,'policyDigest',made.policy_digest,'bodyDigest',made.body_digest),'replayed',false);
END $$;
CREATE FUNCTION app.apply_scored_exam_outcome(operation uuid,attempt uuid,adjudication uuid,expected_outcome uuid,implementation text,result_body jsonb,result_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;assignment app.exam_scoring_assignments;
 ad app.exam_scoring_adjudications;head app.exam_scoring_outcome_heads;old app.exam_scoring_final_outcomes;made app.exam_scoring_final_outcomes;
 prior app.exam_scoring_final_outcomes;p jsonb;d text;candidate jsonb;expected jsonb;decision jsonb;required boolean;
 item jsonb;primary_event app.exam_scoring_events;second_event app.exam_scoring_events;
 progress app.learner_node_progress;registration app.exam_scoring_outcome_logins;staff_count integer;at_time timestamptz;old_flag text;
BEGIN
 IF operation IS NULL OR attempt IS NULL OR adjudication IS NULL OR result_body IS NULL
 OR result_hash IS DISTINCT FROM app.checkpoint_digest(result_body,'01coding-exam-final-outcome') THEN RETURN jsonb_build_object('kind','invalid_input'); END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR UPDATE;
 IF a.id IS NULL THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 -- Hold the exact enabled principal/implementation registration through commit.
 SELECT * INTO registration FROM app.exam_scoring_outcome_logins
 WHERE login_name=session_user AND cohort_id=a.cohort_id AND enabled AND implementation_digest=implementation FOR SHARE;
 IF registration.login_name IS NULL OR NOT app.scored_exam_outcome_applier(a.cohort_id,implementation) THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 PERFORM id FROM app.cohorts WHERE id=a.cohort_id AND status='active' AND curriculum_version_id=a.curriculum_version_id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 PERFORM u.id FROM app.users u JOIN app.cohort_memberships m ON m.user_id=u.id AND m.cohort_id=a.cohort_id
 WHERE u.id=a.user_id AND u.active AND u.role='learner' AND m.status='active' FOR SHARE OF u,m;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 SELECT * INTO old FROM app.exam_scoring_final_outcomes WHERE operation_id=operation;
 IF old.id IS NOT NULL THEN
 IF old.attempt_id IS DISTINCT FROM a.id OR old.adjudication_id IS DISTINCT FROM adjudication OR old.implementation_digest IS DISTINCT FROM implementation
 OR old.result_digest IS DISTINCT FROM result_hash OR old.result IS DISTINCT FROM result_body OR old.caller_login IS DISTINCT FROM session_user THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 RETURN jsonb_build_object('kind','accepted','receipt',jsonb_build_object('id',old.id,'attemptId',old.attempt_id,'operationId',old.operation_id,'revision',old.revision::text,'adjudicationId',old.adjudication_id,'projectionDigest',old.projection_digest,'resultDigest',old.result_digest,'verdict',old.verdict,'totalPoints',old.total_points,'codingPoints',old.coding_points),'replayed',true); END IF;
 SELECT * INTO assignment FROM app.exam_scoring_assignments WHERE attempt_id=a.id FOR SHARE;
 IF assignment.attempt_id IS NULL OR assignment.primary_mentor_id=a.user_id OR assignment.secondary_mentor_id=a.user_id THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 PERFORM u.id FROM app.users u JOIN app.cohort_memberships cm ON cm.user_id=u.id AND cm.cohort_id=a.cohort_id
 WHERE u.id=ANY(ARRAY[assignment.primary_mentor_id,assignment.secondary_mentor_id]) AND u.active AND u.role IN('operator','admin') AND cm.status='active'
 ORDER BY u.id FOR SHARE OF u,cm;
 GET DIAGNOSTICS staff_count=ROW_COUNT;
 IF staff_count<>2 THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 PERFORM h.submission_id FROM app.exam_scoring_heads h JOIN app.exam_scoring_acceptances x ON x.submission_id=h.submission_id WHERE x.attempt_id=a.id ORDER BY h.submission_id FOR UPDATE OF h;
 p:=app.scored_exam_outcome_projection(a);d:=app.checkpoint_digest(p,'01coding-exam-outcome-projection');candidate:=app.scored_exam_outcome_candidate(a);
 IF p->'closure'='null'::jsonb OR candidate IS NULL OR a.status NOT IN('evaluating','passed','failed') THEN RETURN jsonb_build_object('kind','unavailable'); END IF;
 SELECT x.* INTO ad FROM app.exam_scoring_adjudication_heads h JOIN app.exam_scoring_adjudications x ON x.id=h.latest_id WHERE h.attempt_id=a.id FOR SHARE OF h;
 IF ad.id IS DISTINCT FROM adjudication OR ad.projection_digest IS DISTINCT FROM d OR ad.projection IS DISTINCT FROM p THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 INSERT INTO app.exam_scoring_outcome_heads VALUES(a.id,0,NULL) ON CONFLICT(attempt_id) DO NOTHING;
 SELECT * INTO head FROM app.exam_scoring_outcome_heads WHERE attempt_id=a.id FOR UPDATE;
 SELECT * INTO prior FROM app.exam_scoring_final_outcomes WHERE id=head.latest_id;
 IF head.latest_id IS DISTINCT FROM expected_outcome OR ad.expected_prior_outcome_id IS DISTINCT FROM head.latest_id OR head.revision=9223372036854775807
 OR NOT app.scored_exam_adjudication_body_valid(ad.body,p,candidate,prior.id,prior.verdict) THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 decision:=ad.body->'decision';
 required:=decision->'disputed'='true'::jsonb OR (prior.id IS NOT NULL AND prior.verdict IS DISTINCT FROM candidate->>'verdict')
 OR (prior.id IS NULL AND decision->>'initialThresholdReview'='required');
 IF prior.id IS NULL AND decision->>'initialThresholdReview'='unresolved' THEN RETURN jsonb_build_object('kind','unavailable'); END IF;
 IF required THEN
 IF jsonb_array_length(decision->'affectedSubmissionIds')=0 THEN RETURN jsonb_build_object('kind','unavailable'); END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(decision->'affectedSubmissionIds') LOOP
 SELECT * INTO primary_event FROM app.exam_scoring_events WHERE submission_id=(item#>>'{}')::uuid AND event_kind='primary' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO second_event FROM app.exam_scoring_events WHERE submission_id=(item#>>'{}')::uuid AND event_kind='secondary' AND payload->>'primaryEventId'=primary_event.event_id::text ORDER BY revision DESC LIMIT 1;
 IF primary_event.event_id IS NULL OR second_event.event_id IS NULL OR second_event.actor_user_id IS DISTINCT FROM assignment.secondary_mentor_id
 OR second_event.payload->'marks' IS DISTINCT FROM primary_event.payload->'marks' THEN RETURN jsonb_build_object('kind','unavailable'); END IF;
 END LOOP; END IF;
 expected:=jsonb_build_object('version',1,'adjudicationId',ad.id,'projectionDigest',d,
 'selection',candidate->'selection','questions',candidate->'questions','totalPoints',candidate->'totalPoints','codingPoints',candidate->'codingPoints',
 'verdict',candidate->'verdict','implementationDigest',implementation);
 IF result_body IS DISTINCT FROM expected THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 SELECT * INTO progress FROM app.learner_node_progress WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key FOR UPDATE;
 IF progress.node_key IS NULL OR progress.state NOT IN('in_progress','mastered') OR num_nonnulls(progress.first_passing_submission_id,progress.first_passing_checkpoint_outcome_id,progress.first_passing_raid_outcome_id)<>0
 OR (progress.first_passing_scored_exam_outcome_id IS NOT NULL AND progress.first_passing_scored_exam_outcome_id IS DISTINCT FROM prior.id) THEN RETURN jsonb_build_object('kind','unavailable'); END IF;
 at_time:=clock_timestamp();
 INSERT INTO app.exam_scoring_final_outcomes VALUES(gen_random_uuid(),operation,a.id,a.cohort_id,a.user_id,a.curriculum_version_id,a.node_key,
 head.revision+1,head.latest_id,ad.id,d,candidate->>'verdict',(candidate->>'totalPoints')::integer,(candidate->>'codingPoints')::integer,
 result_body,result_hash,implementation,session_user,at_time) RETURNING * INTO made;
 UPDATE app.exam_scoring_outcome_heads SET revision=made.revision,latest_id=made.id WHERE attempt_id=a.id;
 old_flag:=current_setting('nextera.scored_exam_outcome_operation',true);
 PERFORM set_config('nextera.scored_exam_outcome_operation',operation::text,true);
 UPDATE app.checkpoint_attempts SET status=made.verdict,completed_at=CASE WHEN a.status='evaluating' THEN at_time ELSE a.completed_at END WHERE id=a.id;
 UPDATE app.learner_node_progress SET state=CASE WHEN made.verdict='passed' THEN 'mastered'::app.progress_state ELSE 'in_progress'::app.progress_state END,
 mastered_at=CASE WHEN made.verdict='passed' THEN coalesce(progress.mastered_at,at_time) ELSE NULL END,
 first_passing_scored_exam_outcome_id=CASE WHEN made.verdict='passed' THEN made.id ELSE NULL END
 WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key;
 IF progress.state::text IS DISTINCT FROM CASE WHEN made.verdict='passed' THEN 'mastered' ELSE 'in_progress' END THEN
 INSERT INTO app.state_events(checkpoint_attempt_id,entity_type,previous_state,next_state,actor_type,reason,correlation_id)
 VALUES(a.id,'progress',progress.state::text,CASE WHEN made.verdict='passed' THEN 'mastered' ELSE 'in_progress' END,'system','scored_exam_outcome_applied',made.id); END IF;
 PERFORM set_config('nextera.scored_exam_outcome_operation',coalesce(old_flag,''),true);
 -- Deliberately no prerequisite/next-node unlock, project scheduling or XP mutation.
 RETURN jsonb_build_object('kind','accepted','receipt',jsonb_build_object('id',made.id,'attemptId',made.attempt_id,'operationId',made.operation_id,'revision',made.revision::text,'adjudicationId',made.adjudication_id,'projectionDigest',made.projection_digest,'resultDigest',made.result_digest,'verdict',made.verdict,'totalPoints',made.total_points,'codingPoints',made.coding_points),'replayed',false);
END $$;

-- A changed native evidence/adjudication head makes any prior mastery provisional.
-- The writers already hold the attempt lock before the head lock. Do not upgrade
-- their SHARE lock here: concurrent submission reviews must not deadlock.
CREATE FUNCTION app.invalidate_scored_exam_mastery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt uuid;a app.checkpoint_attempts;prior app.exam_scoring_final_outcomes;
BEGIN
 IF NEW.revision IS NOT DISTINCT FROM OLD.revision THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='exam_scoring_heads' THEN
 SELECT attempt_id INTO attempt FROM app.exam_scoring_acceptances WHERE submission_id=NEW.submission_id;
 ELSIF TG_TABLE_NAME='exam_scoring_adjudication_heads' THEN attempt:=NEW.attempt_id;
 ELSE RAISE EXCEPTION 'Unexpected scored exam invalidation source'; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF a.id IS NULL OR app.scored_exam_attempt_metadata(a) IS NULL THEN RETURN NEW; END IF;
 SELECT o.* INTO prior FROM app.exam_scoring_outcome_heads h JOIN app.exam_scoring_final_outcomes o ON o.id=h.latest_id
 WHERE h.attempt_id=a.id AND o.attempt_id=a.id AND o.cohort_id=a.cohort_id AND o.user_id=a.user_id
 AND o.curriculum_version_id=a.curriculum_version_id AND o.node_key=a.node_key;
 IF prior.id IS NULL THEN RETURN NEW; END IF;
 UPDATE app.learner_node_progress SET state='in_progress',mastered_at=NULL,first_passing_scored_exam_outcome_id=NULL
 WHERE cohort_id=a.cohort_id AND user_id=a.user_id AND curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key
 AND state='mastered' AND first_passing_scored_exam_outcome_id=prior.id
 AND num_nonnulls(first_passing_submission_id,first_passing_checkpoint_outcome_id,first_passing_raid_outcome_id)=0;
 IF FOUND THEN
 INSERT INTO app.state_events(checkpoint_attempt_id,entity_type,previous_state,next_state,actor_type,reason,correlation_id)
 VALUES(a.id,'progress','mastered','in_progress','system','scored_exam_outcome_invalidated',prior.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER exam_scoring_head_invalidates_mastery AFTER UPDATE OF revision ON app.exam_scoring_heads
FOR EACH ROW EXECUTE FUNCTION app.invalidate_scored_exam_mastery();
CREATE TRIGGER exam_adjudication_head_invalidates_mastery AFTER UPDATE OF revision,latest_id ON app.exam_scoring_adjudication_heads
FOR EACH ROW EXECUTE FUNCTION app.invalidate_scored_exam_mastery();

-- Preserve the complete registered trigger body. The sole exception permits a
-- marked terminal status correction proved by the just-CAS-written private head.
DO $$
DECLARE original text;patched text;injection text;owner_before oid;acl_before aclitem[];p record;
BEGIN
 SELECT prosrc,proowner,proacl INTO original,owner_before,acl_before FROM pg_proc WHERE oid='app.guard_checkpoint_history()'::regprocedure;
 IF encode(sha256(convert_to(original,'UTF8')),'hex') IS DISTINCT FROM '6384679bb03f4de72d8049b9078cbe02c3aeb0127bd21d38d3860d26a72ed549'
 OR NOT EXISTS(SELECT FROM pg_proc WHERE oid='app.guard_checkpoint_history()'::regprocedure AND proowner=(SELECT oid FROM pg_roles WHERE rolname='nextera_checkpoint_owner') AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog']::text[]) THEN
 RAISE EXCEPTION 'Exact registered checkpoint history guard required'; END IF;
 injection:=$branch$
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='checkpoint_attempts' AND OLD.snapshot->'definition' ? 'examScoring'
 AND OLD.status IN('passed','failed') AND NEW.status IS DISTINCT FROM OLD.status THEN
 DECLARE h app.exam_scoring_outcome_heads;current_outcome app.exam_scoring_final_outcomes;prior_outcome app.exam_scoring_final_outcomes;
 decision app.exam_scoring_adjudications;affected jsonb;primary_event app.exam_scoring_events;secondary_event app.exam_scoring_events;
 BEGIN
 SELECT * INTO h FROM app.exam_scoring_outcome_heads WHERE attempt_id=OLD.id;
 SELECT * INTO current_outcome FROM app.exam_scoring_final_outcomes WHERE id=h.latest_id;
 SELECT * INTO prior_outcome FROM app.exam_scoring_final_outcomes WHERE id=current_outcome.previous_id;
 SELECT * INTO decision FROM app.exam_scoring_adjudications WHERE id=current_outcome.adjudication_id;
 IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
 OR NEW.status NOT IN('passed','failed') OR current_outcome.id IS NULL OR prior_outcome.id IS NULL
 OR current_outcome.revision<>prior_outcome.revision+1 OR h.revision<>current_outcome.revision
 OR current_outcome.attempt_id IS DISTINCT FROM OLD.id OR current_outcome.cohort_id IS DISTINCT FROM OLD.cohort_id
 OR current_outcome.user_id IS DISTINCT FROM OLD.user_id OR current_outcome.curriculum_version_id IS DISTINCT FROM OLD.curriculum_version_id OR current_outcome.node_key IS DISTINCT FROM OLD.node_key
 OR current_outcome.verdict IS DISTINCT FROM NEW.status OR prior_outcome.verdict IS DISTINCT FROM OLD.status
 OR current_outcome.caller_login IS DISTINCT FROM session_user
 OR current_setting('nextera.scored_exam_outcome_operation',true) IS DISTINCT FROM current_outcome.operation_id::text
 OR NOT app.scored_exam_outcome_applier(OLD.cohort_id,current_outcome.implementation_digest)
 OR current_outcome.projection_digest IS DISTINCT FROM app.checkpoint_digest(app.scored_exam_outcome_projection(OLD),'01coding-exam-outcome-projection')
 OR (current_outcome.result-ARRAY['version','adjudicationId','projectionDigest','implementationDigest']) IS DISTINCT FROM app.scored_exam_outcome_candidate(OLD)
 OR decision.expected_prior_outcome_id IS DISTINCT FROM prior_outcome.id
 OR decision.body->'decision'->>'priorFinalVerdict' IS DISTINCT FROM OLD.status
 OR jsonb_array_length(decision.body->'decision'->'affectedSubmissionIds')=0 THEN
 RAISE EXCEPTION 'Unproved scored exam terminal correction'; END IF;
 FOR affected IN SELECT value FROM jsonb_array_elements(decision.body->'decision'->'affectedSubmissionIds') LOOP
 SELECT * INTO primary_event FROM app.exam_scoring_events WHERE submission_id=(affected#>>'{}')::uuid AND event_kind='primary' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO secondary_event FROM app.exam_scoring_events WHERE submission_id=(affected#>>'{}')::uuid AND event_kind='secondary' AND payload->>'primaryEventId'=primary_event.event_id::text ORDER BY revision DESC LIMIT 1;
 IF primary_event.event_id IS NULL OR secondary_event.event_id IS NULL OR secondary_event.payload->'marks' IS DISTINCT FROM primary_event.payload->'marks' THEN
 RAISE EXCEPTION 'Independent current-primary review required for terminal correction'; END IF;
 END LOOP;
 RETURN NEW;
 END;
 END IF;
$branch$;
 patched:=substr(original,1,strpos(original,'BEGIN')+4)||injection||substr(original,strpos(original,'BEGIN')+5);
 EXECUTE format('CREATE OR REPLACE FUNCTION app.guard_checkpoint_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS %L',patched);
 SELECT prosrc,proowner,proacl INTO p FROM pg_proc WHERE oid='app.guard_checkpoint_history()'::regprocedure;
 IF p.prosrc IS DISTINCT FROM patched OR replace(p.prosrc,injection,'') IS DISTINCT FROM original OR p.proowner IS DISTINCT FROM owner_before OR p.proacl IS DISTINCT FROM acl_before THEN
 RAISE EXCEPTION 'Legacy guard preservation/readback failed'; END IF;
END $$;

CREATE OR REPLACE FUNCTION app.scored_exam_result_projection(auth_id uuid,attempt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts;p jsonb;d text;o app.exam_scoring_final_outcomes;ad app.exam_scoring_adjudications;candidate jsonb;
BEGIN
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR SHARE;
 IF a.id IS NULL OR app.checkpoint_user(auth_id,a.cohort_id) IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Exam result forbidden' USING ERRCODE='42501'; END IF;
 IF app.scored_exam_attempt_metadata(a) IS NULL THEN RAISE EXCEPTION 'Exam result metadata unavailable' USING ERRCODE='PS005'; END IF;
 IF a.status='active' AND clock_timestamp()<a.deadline_at THEN
 RETURN jsonb_build_object('version',1,'status','in_progress','total_points',NULL,'coding_points',NULL,'outcome_id',NULL); END IF;
 PERFORM h.submission_id FROM app.exam_scoring_heads h JOIN app.exam_scoring_acceptances x ON x.submission_id=h.submission_id WHERE x.attempt_id=a.id ORDER BY h.submission_id FOR SHARE OF h;
 p:=app.scored_exam_outcome_projection(a);d:=app.checkpoint_digest(p,'01coding-exam-outcome-projection');candidate:=app.scored_exam_outcome_candidate(a);
 SELECT x.* INTO o FROM app.exam_scoring_outcome_heads h JOIN app.exam_scoring_final_outcomes x ON x.id=h.latest_id WHERE h.attempt_id=a.id;
 SELECT x.* INTO ad FROM app.exam_scoring_adjudication_heads h JOIN app.exam_scoring_adjudications x ON x.id=h.latest_id WHERE h.attempt_id=a.id;
 IF candidate IS NOT NULL AND o.id IS NOT NULL AND o.projection_digest=d AND o.adjudication_id=ad.id
 AND ad.projection_digest=d AND (o.result-ARRAY['version','adjudicationId','projectionDigest','implementationDigest'])=candidate
 AND o.result_digest=app.checkpoint_digest(o.result,'01coding-exam-final-outcome') THEN
 RETURN jsonb_build_object('version',1,'status',o.verdict,'total_points',o.total_points,'coding_points',o.coding_points,'outcome_id',o.id); END IF;
 RETURN jsonb_build_object('version',1,'status','provisional','total_points',NULL,'coding_points',NULL,'outcome_id',NULL);
END $$;

DO $$ DECLARE n text;grantee record;f regprocedure;recipient text;BEGIN
 FOREACH n IN ARRAY ARRAY['exam_scoring_adjudications','exam_scoring_adjudication_heads','exam_scoring_final_outcomes','exam_scoring_outcome_heads','exam_scoring_outcome_logins'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',n);
 FOR grantee IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END recipient
 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
 WHERE c.oid=('app.'||n)::regclass AND a.grantee<>c.relowner LOOP EXECUTE format('REVOKE ALL ON TABLE app.%I FROM %s',n,grantee.recipient);END LOOP;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['app.guard_exam_outcome_history()'::regprocedure,'app.invalidate_scored_exam_mastery()'::regprocedure,
 'app.scored_exam_outcome_web_caller()'::regprocedure,'app.scored_exam_outcome_projection(app.checkpoint_attempts)'::regprocedure,
 'app.scored_exam_outcome_candidate(app.checkpoint_attempts)'::regprocedure,
 'app.scored_exam_adjudication_body_valid(jsonb,jsonb,jsonb,uuid,text)'::regprocedure,
 'app.scored_exam_outcome_applier(uuid,text)'::regprocedure,'app.scored_exam_outcome_state(uuid,uuid)'::regprocedure,
 'app.record_scored_exam_adjudication(uuid,uuid,uuid,uuid,jsonb,text)'::regprocedure,
 'app.apply_scored_exam_outcome(uuid,uuid,uuid,uuid,text,jsonb,text)'::regprocedure,
 'app.scored_exam_result_projection(uuid,uuid)'::regprocedure] LOOP
 FOR grantee IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END recipient
 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
 WHERE p.oid=f AND a.grantee<>p.proowner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f,grantee.recipient);END LOOP;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.scored_exam_outcome_state(uuid,uuid),app.record_scored_exam_adjudication(uuid,uuid,uuid,uuid,jsonb,text) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.apply_scored_exam_outcome(uuid,uuid,uuid,uuid,text,jsonb,text) TO nextera_exam_evaluator;
RESET ROLE;
-- External REFERENCES are supplied only by this already-held isolated DBA span.
ALTER TABLE app.exam_scoring_adjudications ADD CONSTRAINT exam_adjudication_attempt_fk FOREIGN KEY(attempt_id) REFERENCES app.checkpoint_attempts(id) ON DELETE RESTRICT;
ALTER TABLE app.exam_scoring_adjudication_heads ADD CONSTRAINT exam_adjudication_head_attempt_fk FOREIGN KEY(attempt_id) REFERENCES app.checkpoint_attempts(id) ON DELETE RESTRICT;
ALTER TABLE app.exam_scoring_outcome_heads ADD CONSTRAINT exam_outcome_head_attempt_fk FOREIGN KEY(attempt_id) REFERENCES app.checkpoint_attempts(id) ON DELETE RESTRICT;
ALTER TABLE app.exam_scoring_final_outcomes ADD CONSTRAINT exam_final_outcome_identity_fk FOREIGN KEY(attempt_id,cohort_id,user_id,curriculum_version_id,node_key) REFERENCES app.checkpoint_attempts(id,cohort_id,user_id,curriculum_version_id,node_key) ON DELETE RESTRICT;
ALTER TABLE app.exam_scoring_adjudications ADD CONSTRAINT exam_adjudication_prior_outcome_fk FOREIGN KEY(expected_prior_outcome_id) REFERENCES app.exam_scoring_final_outcomes(id) ON DELETE RESTRICT;
ALTER TABLE app.exam_scoring_outcome_logins ADD CONSTRAINT exam_outcome_login_cohort_fk FOREIGN KEY(cohort_id) REFERENCES app.cohorts(id) ON DELETE RESTRICT;
ALTER TABLE app.learner_node_progress ADD CONSTRAINT progress_scored_exam_outcome_fk FOREIGN KEY(first_passing_scored_exam_outcome_id,cohort_id,user_id,curriculum_version_id,node_key) REFERENCES app.exam_scoring_final_outcomes(id,cohort_id,user_id,curriculum_version_id,node_key) ON DELETE RESTRICT;
DO $$ DECLARE f record;allowed text[];BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none' THEN RAISE EXCEPTION 'Outcome migration role restoration failed';END IF;
 FOR f IN SELECT p.*,o.rolname owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles o ON o.oid=p.proowner
 WHERE n.nspname='app' AND p.proname IN('guard_exam_outcome_history','invalidate_scored_exam_mastery','scored_exam_outcome_web_caller','scored_exam_outcome_projection','scored_exam_outcome_candidate','scored_exam_adjudication_body_valid','scored_exam_outcome_applier','scored_exam_outcome_state','record_scored_exam_adjudication','apply_scored_exam_outcome','scored_exam_result_projection') LOOP
 allowed:=CASE WHEN f.proname IN('scored_exam_outcome_state','record_scored_exam_adjudication') THEN ARRAY['nextera_web'] WHEN f.proname='apply_scored_exam_outcome' THEN ARRAY['nextera_exam_evaluator'] ELSE ARRAY[]::text[] END;
 IF f.owner<>'nextera_checkpoint_owner' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR EXISTS(SELECT FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
 WHERE a.grantee<>f.proowner AND (a.grantee=0 OR NOT coalesce(r.rolname=ANY(allowed),false) OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 OR EXISTS(SELECT FROM unnest(allowed) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE')) THEN RAISE EXCEPTION 'Exact outcome function owner/ACL readback failed';END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN('guard_exam_outcome_history','invalidate_scored_exam_mastery','scored_exam_outcome_web_caller','scored_exam_outcome_projection','scored_exam_outcome_candidate','scored_exam_adjudication_body_valid','scored_exam_outcome_applier','scored_exam_outcome_state','record_scored_exam_adjudication','apply_scored_exam_outcome','scored_exam_result_projection'))<>11 THEN RAISE EXCEPTION 'Unexpected outcome function set';END IF;
 IF NOT has_column_privilege('nextera_checkpoint_owner','app.learner_node_progress','first_passing_scored_exam_outcome_id','UPDATE') OR has_column_privilege('nextera_web','app.learner_node_progress','first_passing_scored_exam_outcome_id','UPDATE') OR has_column_privilege('nextera_exam_evaluator','app.learner_node_progress','first_passing_scored_exam_outcome_id','UPDATE') THEN RAISE EXCEPTION 'Outcome progress column isolation failed';END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles o ON o.oid=c.relowner WHERE n.nspname='app' AND c.relname IN('exam_scoring_adjudications','exam_scoring_adjudication_heads','exam_scoring_final_outcomes','exam_scoring_outcome_heads','exam_scoring_outcome_logins') AND c.relrowsecurity AND o.rolname='nextera_checkpoint_owner')<>5 THEN RAISE EXCEPTION 'Outcome table owner/isolation readback failed';END IF;
END $$;
COMMIT;
