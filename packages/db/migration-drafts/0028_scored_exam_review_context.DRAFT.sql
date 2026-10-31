-- SOURCE REVIEW DRAFT ONLY. No registration, application, roles or runtime grants.
-- Requires reviewed0024/0027. Adds two read-only RPCs, no final-result mutation.
-- A pre-held fresh bootstrap DBA supplies a temporary SET-only owner span.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'exam-review-context-0028-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin)
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')
 OR NOT has_schema_privilege('nextera_checkpoint_owner','app','CREATE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner'
 AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner')
 OR to_regclass('app.exam_scoring_assignments') IS NULL
 OR to_regclass('app.exam_scoring_heads') IS NULL
 OR to_regprocedure('app.scored_exam_attempt_metadata(app.checkpoint_attempts)') IS NULL THEN
 RAISE EXCEPTION 'Reviewed fresh isolated owner and lifecycle prerequisites required'; END IF;
END $$;
SET LOCAL ROLE nextera_checkpoint_owner;

CREATE FUNCTION app.scored_exam_review_context(auth_id uuid,attempt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; assignment app.exam_scoring_assignments;
 r app.exam_scoring_rubrics; closure app.exam_scoring_closures; actor uuid;
 actor_role text; scope jsonb; made jsonb; completion jsonb; accepted jsonb;
 moment timestamptz; assignment_body jsonb;
BEGIN
 IF auth_id IS NULL OR attempt IS NULL OR current_setting('role')<>'none'
 OR NOT pg_has_role(session_user,'nextera_web','USAGE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolcanlogin
 AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR pg_has_role(session_user,'nextera_checkpoint_owner','USAGE')
 OR pg_has_role(session_user,'nextera_checkpoint_owner','SET')
 OR pg_has_role(session_user,'nextera_exam_evaluator','USAGE')
 OR pg_has_role(session_user,'nextera_exam_evaluator','SET') THEN
 RAISE EXCEPTION 'Exam review context forbidden' USING ERRCODE='42501'; END IF;
 -- All question acceptance/finish mutations lock this same attempt exclusively.
 -- The read captures one immutable acceptance/closure set without blocking on a mentor.
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt FOR SHARE;
 SELECT * INTO assignment FROM app.exam_scoring_assignments WHERE attempt_id=a.id FOR SHARE;
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=assignment.rubric_digest;
 IF a.id IS NULL OR assignment.attempt_id IS NULL OR r.rubric_digest IS NULL THEN
 RAISE EXCEPTION 'Exam review context forbidden' USING ERRCODE='42501'; END IF;
 SELECT u.id,u.role INTO actor,actor_role FROM app.users u
 JOIN app.cohort_memberships m ON m.user_id=u.id AND m.cohort_id=a.cohort_id
 WHERE u.auth_user_id=auth_id AND u.active AND m.status='active'
 AND ((u.id=a.user_id AND u.role='learner') OR
 (u.id IN(assignment.primary_mentor_id,assignment.secondary_mentor_id)
 AND u.id<>a.user_id AND u.role IN('operator','admin'))) FOR SHARE OF u,m;
 IF actor IS NULL THEN RAISE EXCEPTION 'Exam review context forbidden' USING ERRCODE='42501'; END IF;
 -- An admin/operator label alone never grants this reader or manual review.
 IF EXISTS(SELECT FROM unnest(ARRAY[assignment.primary_mentor_id,assignment.secondary_mentor_id]) assigned(id)
 WHERE assigned.id=a.user_id OR NOT EXISTS(SELECT FROM app.users u
 JOIN app.cohort_memberships m ON m.user_id=u.id AND m.cohort_id=a.cohort_id
 WHERE u.id=assigned.id AND u.active AND u.role IN('operator','admin') AND m.status='active'))
 OR app.scored_exam_attempt_metadata(a) IS NULL
 OR a.deadline_at<>a.started_at+interval '180 minutes'
 OR a.kind<>'normal' OR a.normal_slot<>1
 OR r.definition_digest IS DISTINCT FROM a.definition_digest
 OR a.snapshot_digest IS DISTINCT FROM app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt')
 OR a.snapshot->'definition'->'examScoring' IS DISTINCT FROM
 jsonb_build_object('version',1,'form',r.form,'rubricDigest',r.rubric_digest)
 OR NOT coalesce(app.exam_scoring_rubric_valid(r.rubric),false)
 OR NOT coalesce(app.exam_scoring_source_binding_valid(r.source_binding,r.rubric),false)
 OR r.source_binding_digest IS DISTINCT FROM app.checkpoint_digest(r.source_binding,'nextera-exam1-rubric-source-binding')
 OR r.rubric_digest IS DISTINCT FROM app.checkpoint_digest(r.rubric-'digest','01coding-exam-scoring-rubric') THEN
 RAISE EXCEPTION 'Frozen exam review binding unavailable' USING ERRCODE='PS005'; END IF;
 assignment_body:=jsonb_build_object('version',1,'attemptId',a.id,'learnerId',a.user_id,
 'cohortId',a.cohort_id,'definitionDigest',a.definition_digest,'rubricDigest',r.rubric_digest,
 'primaryMentorId',assignment.primary_mentor_id,'secondaryMentorId',assignment.secondary_mentor_id);
 IF assignment.assignment_digest IS DISTINCT FROM app.checkpoint_digest(assignment_body,'01coding-exam-scoring-assignment') THEN
 RAISE EXCEPTION 'Frozen mentor assignment unavailable' USING ERRCODE='PS005'; END IF;
 scope:=jsonb_build_object('learnerId',a.user_id,'cohortId',a.cohort_id,'attemptId',a.id,
 'form',r.form,'definitionDigest',a.definition_digest,'rubricDigest',r.rubric_digest);
 SELECT * INTO closure FROM app.exam_scoring_closures WHERE attempt_id=a.id;
 moment:=clock_timestamp(); completion:='null'::jsonb;
 IF closure.attempt_id IS NOT NULL THEN
 IF closure.closed_at<a.started_at OR closure.closed_at>moment
 OR (closure.reason='finished' AND closure.closed_at>=a.deadline_at)
 OR (closure.reason='expired' AND (closure.closed_at<a.deadline_at OR moment<a.deadline_at)) THEN
 RAISE EXCEPTION 'Exam closure clock unavailable' USING ERRCODE='PS005'; END IF;
 IF closure.reason='finished' THEN
 -- The one immutable closure for an attempt uses that attempt UUID as its receipt identity.
 completion:=jsonb_build_object('id',a.id,'scope',scope,
 'completedAtMicros',(extract(epoch FROM closure.closed_at)*1000000)::bigint::text,
 'closureOrdinal',closure.closure_ordinal::text); END IF;
 ELSIF a.status<>'active' THEN
 RAISE EXCEPTION 'Missing immutable exam closure' USING ERRCODE='PS005'; END IF;
 IF EXISTS(SELECT FROM app.exam_scoring_acceptances x LEFT JOIN app.exam_scoring_heads h
 ON h.submission_id=x.submission_id WHERE x.attempt_id=a.id AND
 (h.submission_id IS NULL OR x.snapshot_digest IS DISTINCT FROM a.snapshot_digest
 OR x.accepted_at<a.started_at OR x.accepted_at>=a.deadline_at OR x.accepted_at>moment
 OR (closure.attempt_id IS NOT NULL AND (x.accepted_ordinal>=closure.closure_ordinal OR x.accepted_at>closure.closed_at)))) THEN
 RAISE EXCEPTION 'Exam acceptance history unavailable' USING ERRCODE='PS005'; END IF;
 -- Heads bind later per-submission RPC reads; the service rejects revision drift.
 PERFORM h.submission_id FROM app.exam_scoring_heads h JOIN app.exam_scoring_acceptances x
 ON x.submission_id=h.submission_id WHERE x.attempt_id=a.id ORDER BY h.submission_id FOR SHARE OF h;
 SELECT coalesce(jsonb_agg(jsonb_build_object('submissionId',x.submission_id,
 'questionKey',x.question_key,'answerKind',x.answer_kind,'answerSha256',x.answer_digest,
 'acceptedAtMicros',(extract(epoch FROM x.accepted_at)*1000000)::bigint::text,
 'acceptedOrdinal',x.accepted_ordinal::text,'revision',h.revision::text) ORDER BY x.accepted_ordinal),'[]'::jsonb)
 INTO accepted FROM app.exam_scoring_acceptances x JOIN app.exam_scoring_heads h
 ON h.submission_id=x.submission_id WHERE x.attempt_id=a.id;
 made:=jsonb_build_object('version',1,'authUserId',auth_id,'actorUserId',actor,
 'access',CASE WHEN actor=a.user_id AND actor_role='learner' THEN 'learner' ELSE 'assigned_mentor' END,
 'attempt',jsonb_build_object('scope',scope,'assignedAttemptNumber',1,
 'openedAtMicros',(extract(epoch FROM a.started_at)*1000000)::bigint::text,
 'deadlineAtMicros',(extract(epoch FROM a.deadline_at)*1000000)::bigint::text),
 'snapshotDigest',a.snapshot_digest,'rubric',r.rubric,
 'assignment',jsonb_build_object('scope',scope,'digest',assignment.assignment_digest,
 'primaryMentorId',assignment.primary_mentor_id,
 'eligibleMentorIds',jsonb_build_array(assignment.primary_mentor_id,assignment.secondary_mentor_id)),
 'completion',completion,'serverNowMicros',(extract(epoch FROM moment)*1000000)::bigint::text,
 'acceptances',accepted,'adjudication',NULL);
 -- This is a read projection, never finalization, advancement or a review bypass.
 RETURN made;
END $$;

CREATE FUNCTION app.scored_exam_review_answer(auth_id uuid,attempt uuid,submission uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; a app.checkpoint_attempts; acc app.exam_scoring_acceptances;
 code app.submissions; artifact app.submission_artifacts; typed app.checkpoint_answer_receipts;
 owner_auth uuid; body jsonb; item jsonb; contract jsonb; maximum integer; bytes integer; request uuid; source_verified boolean;
BEGIN
 ctx:=app.scored_exam_review_context(auth_id,attempt);
 IF ctx->>'access' IS DISTINCT FROM 'assigned_mentor' OR submission IS NULL THEN
 RAISE EXCEPTION 'Assigned exam answer forbidden' USING ERRCODE='42501'; END IF;
 IF ctx->'completion'='null'::jsonb AND (ctx->>'serverNowMicros')::bigint<(ctx->'attempt'->>'deadlineAtMicros')::bigint THEN
 RAISE EXCEPTION 'Exam answer review is not open' USING ERRCODE='PS005'; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 SELECT * INTO acc FROM app.exam_scoring_acceptances WHERE submission_id=submission AND attempt_id=attempt;
 SELECT auth_user_id INTO owner_auth FROM app.users WHERE id=a.user_id;
 IF acc.submission_id IS NULL OR owner_auth IS NULL OR acc.snapshot_digest IS DISTINCT FROM a.snapshot_digest THEN
 RAISE EXCEPTION 'Assigned exam answer forbidden' USING ERRCODE='42501'; END IF;
 IF acc.source_kind='coding' AND acc.answer_kind='coding' THEN
 SELECT * INTO code FROM app.submissions WHERE id=submission AND checkpoint_attempt_id=a.id
 AND checkpoint_task_key=acc.question_key AND user_id=a.user_id AND cohort_id=a.cohort_id;
 SELECT * INTO artifact FROM app.submission_artifacts WHERE id=code.artifact_id AND owner_user_id=a.user_id;
 IF code.id IS NULL OR artifact.id IS NULL OR artifact.storage_bucket<>'nextera-submissions'
 OR artifact.sha256 IS DISTINCT FROM acc.answer_digest OR artifact.size_bytes NOT BETWEEN 1 AND 262144
 OR code.idempotency_key !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
 RAISE EXCEPTION 'Immutable exam code artifact unavailable' USING ERRCODE='PS005'; END IF;
 -- Preserve exact legacy four-segment receipts. Only the explicit scored path
 -- requires the later immutable upload reservation/intent/job proof.
 IF artifact.storage_key IS DISTINCT FROM owner_auth::text||'/'||a.cohort_id::text||'/'||code.idempotency_key||'/'||acc.answer_digest THEN
 IF acc.question_key !~ '^q[1-5]$'
 OR artifact.storage_key IS DISTINCT FROM owner_auth::text||'/'||a.cohort_id::text||'/scored-exam-v1/'||a.id::text||'/'||acc.question_key||'/'||code.idempotency_key||'/'||acc.answer_digest
 OR to_regclass('app.scored_exam_code_upload_reservations') IS NULL
 OR to_regclass('app.scored_exam_code_upload_policies') IS NULL THEN
 RAISE EXCEPTION 'Immutable scored exam code source unavailable' USING ERRCODE='PS005'; END IF;
 -- Dynamic only because this read-only draft precedes the optional resource
 -- draft. Missing later tables deny the new path; no privileges are granted.
 EXECUTE $proof$
 SELECT EXISTS(SELECT FROM app.scored_exam_code_upload_reservations r
 JOIN app.scored_exam_acceptance_intents i ON i.submission_id=($3).id
 AND i.artifact_id=($4).id AND i.job_id=($3).active_judge_job_id
 JOIN app.scored_exam_code_upload_policies p ON p.curriculum_version_id=r.curriculum_version_id
 AND p.node_key=r.node_key AND p.definition_digest=r.definition_digest AND p.policy_digest=r.upload_policy_digest
 JOIN judge.jobs j ON j.id=i.job_id AND j.submission_id=($3).id
 WHERE r.auth_user_id=$5 AND r.user_id=($1).user_id AND r.cohort_id=($1).cohort_id
 AND r.attempt_id=($1).id AND r.curriculum_version_id=($1).curriculum_version_id AND r.node_key=($1).node_key
 AND r.task_key=($2).question_key AND r.request_id=($3).idempotency_key::uuid
 AND r.definition_digest=($1).definition_digest AND r.snapshot_digest=($1).snapshot_digest
 AND r.filename=($4).original_filename AND r.byte_length=($4).size_bytes
 AND r.answer_digest=($2).answer_digest AND r.storage_key=($4).storage_key
 AND i.auth_user_id=r.auth_user_id AND i.user_id=r.user_id AND i.cohort_id=r.cohort_id
 AND i.attempt_id=r.attempt_id AND i.curriculum_version_id=r.curriculum_version_id AND i.node_key=r.node_key
 AND i.task_key=r.task_key AND i.request_id=r.request_id AND i.definition_digest=r.definition_digest
 AND i.snapshot_digest=r.snapshot_digest AND i.policy_digest=r.intake_policy_digest
 AND i.filename=r.filename AND i.byte_length=r.byte_length AND i.answer_digest=r.answer_digest
 AND j.evaluation_snapshot->'artifact'=jsonb_build_object('id',($4).id,'bucket',($4).storage_bucket,
 'key',($4).storage_key,'filename',($4).original_filename,'size_bytes',($4).size_bytes,'sha256',($4).sha256)
 AND j.evaluation_digest=app.checkpoint_digest(j.evaluation_snapshot,'nextera-evaluation-snapshot'))
 $proof$ INTO source_verified USING a,acc,code,artifact,owner_auth;
 IF source_verified IS DISTINCT FROM true THEN
 RAISE EXCEPTION 'Immutable scored exam code source unavailable' USING ERRCODE='PS005'; END IF;
 END IF;
 bytes:=artifact.size_bytes::integer; request:=code.idempotency_key::uuid;
 body:=jsonb_build_object('kind','stored_source','bucket',artifact.storage_bucket,
 'objectKey',artifact.storage_key,'filename',artifact.original_filename);
 ELSE
 SELECT * INTO typed FROM app.checkpoint_answer_receipts WHERE id=submission AND attempt_id=a.id
 AND task_key=acc.question_key AND user_id=a.user_id AND cohort_id=a.cohort_id;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=acc.question_key;
 contract:=item->'answerContract';
 IF typed.id IS NULL OR typed.auth_user_id IS DISTINCT FROM owner_auth
 OR typed.answer_kind IS DISTINCT FROM acc.answer_kind OR typed.answer_digest IS DISTINCT FROM acc.answer_digest
 OR typed.snapshot_digest IS DISTINCT FROM a.snapshot_digest OR typed.definition_digest IS DISTINCT FROM a.definition_digest
 OR contract->'version' IS DISTINCT FROM '1'::jsonb OR contract->>'kind' IS DISTINCT FROM acc.answer_kind
 OR jsonb_typeof(contract->'maxBytes') IS DISTINCT FROM 'number'
 OR contract->>'maxBytes' !~ '^[1-9][0-9]*$' OR (contract->>'maxBytes')::numeric>262144 THEN
 RAISE EXCEPTION 'Immutable structured exam answer unavailable' USING ERRCODE='PS005'; END IF;
 maximum:=(contract->>'maxBytes')::integer;
 IF octet_length(typed.answer_bytes)>maximum
 OR typed.answer_digest IS DISTINCT FROM encode(sha256(typed.answer_bytes),'hex')
 OR NOT coalesce(app.checkpoint_answer_payload_complete(typed.answer_bytes,typed.answer_kind),false)
 OR typed.answer_contract_digest IS DISTINCT FROM app.checkpoint_answer_contract_digest(a.user_id,a.cohort_id,a.id,acc.question_key,a.definition_digest,typed.answer_kind,maximum) THEN
 RAISE EXCEPTION 'Structured exam answer contract unavailable' USING ERRCODE='PS005'; END IF;
 bytes:=octet_length(typed.answer_bytes); request:=typed.request_id;
 body:=jsonb_build_object('kind','structured_payload','payloadBase64',replace(encode(typed.answer_bytes,'base64'),E'\n',''),
 'answerContract',jsonb_build_object('version',1,'kind',typed.answer_kind,'maxBytes',maximum,'digest',typed.answer_contract_digest));
 END IF;
 RETURN jsonb_build_object('version',1,'authUserId',auth_id,'actorUserId',ctx->'actorUserId',
 'ownerAuthUserId',owner_auth,'attemptId',a.id,'submissionId',submission,'requestId',request,
 'learnerId',a.user_id,'cohortId',a.cohort_id,'questionKey',acc.question_key,'answerKind',acc.answer_kind,
 'definitionDigest',a.definition_digest,'snapshotDigest',a.snapshot_digest,'rubricDigest',ctx->'rubric'->>'digest',
 'answerSha256',acc.answer_digest,'byteLength',bytes,'source',body);
END $$;

DO $$ DECLARE grantee record; obj regprocedure; BEGIN
 FOREACH obj IN ARRAY ARRAY['app.scored_exam_review_context(uuid,uuid)'::regprocedure,'app.scored_exam_review_answer(uuid,uuid,uuid)'::regprocedure] LOOP
 FOR grantee IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END recipient
 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 LEFT JOIN pg_roles r ON r.oid=a.grantee
 WHERE p.oid=obj AND a.grantee<>p.proowner LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',obj,grantee.recipient);
 END LOOP; END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.scored_exam_review_context(uuid,uuid) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.scored_exam_review_answer(uuid,uuid,uuid) TO nextera_web;
DO $$ DECLARE obj regprocedure; BEGIN
 FOREACH obj IN ARRAY ARRAY['app.scored_exam_review_context(uuid,uuid)'::regprocedure,'app.scored_exam_review_answer(uuid,uuid,uuid)'::regprocedure] LOOP
 IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
 WHERE p.oid=obj
 AND o.rolname='nextera_checkpoint_owner' AND p.prosecdef
 AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
 LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
 WHERE acl.grantee<>p.proowner AND (grantee.rolname IS DISTINCT FROM 'nextera_web'
 OR acl.privilege_type<>'EXECUTE' OR acl.is_grantable)))
 OR NOT has_function_privilege('nextera_web',obj::oid,'EXECUTE') THEN
 RAISE EXCEPTION 'Exact exam review RPC owner and ACL readback failed'; END IF;
 END LOOP;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none' THEN
 RAISE EXCEPTION 'Migration role restoration failed'; END IF;
END $$;
COMMIT;
