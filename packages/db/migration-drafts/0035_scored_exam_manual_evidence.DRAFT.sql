-- SOURCE REVIEW DRAFT ONLY. Never registered or applied by this source slice.
-- Requires reviewed 0024/0028. Additive manual evidence wrapper; old writers unchanged.
-- Evidence and policy retain the existing immutable scoring audit lifetime; no TTL/purge.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'exam-manual-evidence-0035-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin)
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')
 OR NOT has_schema_privilege('nextera_checkpoint_owner','app','CREATE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin
 AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner')
 OR to_regprocedure('app.record_exam_scoring_event(uuid,uuid,uuid,bigint,text,jsonb,text)') IS NULL
 OR to_regprocedure('app.scored_exam_review_context(uuid,uuid)') IS NULL THEN
 RAISE EXCEPTION 'Reviewed fresh isolated owner and review prerequisites required'; END IF;
END $$;
SET LOCAL ROLE nextera_checkpoint_owner;

CREATE TABLE app.exam_manual_evidence_policies (
 rubric_digest text PRIMARY KEY REFERENCES app.exam_scoring_rubrics(rubric_digest),
 policy jsonb NOT NULL,
 policy_digest text NOT NULL CHECK(policy_digest=app.checkpoint_digest(policy,'01coding-exam-manual-evidence-policy')),
 CHECK(jsonb_typeof(policy)='object' AND policy ?& ARRAY['version','maxEvidenceBytes','maxCriteriaBytes'] AND policy-ARRAY['version','maxEvidenceBytes','maxCriteriaBytes']='{}'::jsonb
 AND policy->'version'='1'::jsonb
 AND jsonb_typeof(policy->'maxEvidenceBytes')='number' AND policy->>'maxEvidenceBytes' ~ '^[1-9][0-9]*$'
 AND (policy->>'maxEvidenceBytes')::numeric<=2147483647
 AND jsonb_typeof(policy->'maxCriteriaBytes')='number' AND policy->>'maxCriteriaBytes' ~ '^[1-9][0-9]*$'
 AND (policy->>'maxCriteriaBytes')::numeric<=2147483647)
);
CREATE TABLE app.exam_manual_evidence (
 event_id uuid PRIMARY KEY REFERENCES app.exam_scoring_events(event_id),
 document jsonb NOT NULL,
 document_digest text NOT NULL CHECK(document_digest=app.checkpoint_digest(document,'01coding-exam-manual-evidence')),
 byte_length integer NOT NULL CHECK(byte_length=octet_length(convert_to(app.checkpoint_canonical(document),'UTF8'))),
 source_actor_id uuid NOT NULL,
 source_role text NOT NULL CHECK(source_role IN('operator','admin')),
 policy_digest text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app.exam_manual_evidence_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.exam_manual_evidence ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER immutable_manual_evidence_policy BEFORE UPDATE OR DELETE ON app.exam_manual_evidence_policies
 FOR EACH ROW EXECUTE FUNCTION app.guard_exam_scoring_history();
CREATE TRIGGER immutable_manual_evidence BEFORE UPDATE OR DELETE ON app.exam_manual_evidence
 FOR EACH ROW EXECUTE FUNCTION app.guard_exam_scoring_history();

CREATE FUNCTION app.scored_exam_manual_evidence(auth_id uuid,attempt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; r app.exam_scoring_rubrics; p app.exam_manual_evidence_policies;
 closed boolean; records jsonb; learner_name text;
BEGIN
 ctx:=app.scored_exam_review_context(auth_id,attempt);
 IF ctx->>'access' IS DISTINCT FROM 'assigned_mentor' THEN
 RAISE EXCEPTION 'Assigned staff evidence only' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=ctx->'rubric'->>'digest';
 SELECT * INTO p FROM app.exam_manual_evidence_policies WHERE rubric_digest=r.rubric_digest;
 SELECT display_name INTO learner_name FROM app.users WHERE id=(ctx->'attempt'->'scope'->>'learnerId')::uuid;
 closed:=ctx->'completion'<>'null'::jsonb OR (ctx->>'serverNowMicros')::bigint >= (ctx->'attempt'->>'deadlineAtMicros')::bigint;
 records:='[]'::jsonb;
 IF closed THEN
 SELECT coalesce(jsonb_agg(jsonb_build_object('eventId',e.event_id,'operationId',e.operation_id,
 'submissionId',e.submission_id,'revision',e.revision::text,'review',e.event_kind,
 'sourceActorId',d.source_actor_id,'sourceRole',d.source_role,'policyDigest',d.policy_digest,
 'document',d.document,'digest',d.document_digest,'byteLength',d.byte_length)
 ORDER BY e.submission_id,e.revision),'[]'::jsonb) INTO records
 FROM app.exam_manual_evidence d JOIN app.exam_scoring_events e USING(event_id)
 JOIN app.exam_scoring_acceptances a USING(submission_id) WHERE a.attempt_id=attempt;
 END IF;
 RETURN jsonb_build_object('version',1,'authUserId',auth_id,'actorUserId',ctx->'actorUserId',
 'attemptId',attempt,'contextDigest',app.checkpoint_digest(ctx-'serverNowMicros','01coding-exam-review-display-context'),
 'closed',closed,'sourceBinding',CASE WHEN closed THEN r.source_binding ELSE NULL END,
 'sourceBindingDigest',CASE WHEN closed THEN r.source_binding_digest ELSE NULL END,
 'policy',CASE WHEN closed THEN p.policy ELSE NULL END,'policyDigest',CASE WHEN closed THEN p.policy_digest ELSE NULL END,
 'learner',jsonb_build_object('displayName',learner_name,'studentNumber',NULL), 'records',records);
END $$;

CREATE FUNCTION app.record_scored_exam_manual_evidence(auth_id uuid,attempt uuid,operation uuid,
 submission uuid,expected bigint,review text,body jsonb,evidence jsonb,criteria_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; acc jsonb; question jsonb; r app.exam_scoring_rubrics;
 p app.exam_manual_evidence_policies; prior app.exam_manual_evidence; prior_event app.exam_scoring_events;
 doc jsonb; doc_hash text; bytes integer; result jsonb; actor_role text; old_found boolean;
BEGIN
 IF attempt IS NULL OR operation IS NULL OR submission IS NULL OR expected IS NULL OR expected<0
 OR expected>=9223372036854775807 OR review NOT IN('primary','secondary') OR review IS NULL
 OR jsonb_typeof(evidence) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(evidence))<>3
 OR evidence->'version' IS DISTINCT FROM '1'::jsonb OR evidence->>'manualCriteriaSha256' !~ '^[0-9a-f]{64}$'
 OR NOT(evidence ? 'manualCriteriaSha256') OR NOT(evidence ? 'notes')
 OR jsonb_typeof(evidence->'notes') NOT IN('null','string') THEN RETURN jsonb_build_object('kind','invalid_input'); END IF;
 -- Match the unchanged writer's operation->head order before context takes shared heads.
 PERFORM pg_advisory_xact_lock(hashtextextended(attempt::text,35));
 PERFORM pg_advisory_xact_lock(hashtextextended(operation::text,24));
 -- Do not lock another learner's head for an unassigned/removed caller.
 PERFORM h.submission_id FROM app.exam_scoring_heads h
 JOIN app.exam_scoring_acceptances x ON x.submission_id=h.submission_id
 JOIN app.checkpoint_attempts a ON a.id=x.attempt_id
 JOIN app.exam_scoring_assignments assignment ON assignment.attempt_id=a.id
 JOIN app.users u ON u.auth_user_id=auth_id
 JOIN app.cohort_memberships m ON m.user_id=u.id AND m.cohort_id=a.cohort_id
 WHERE h.submission_id=submission AND a.id=attempt AND u.active AND m.status='active'
 AND u.role IN('operator','admin') AND u.id<>a.user_id
 AND u.id=CASE WHEN review='primary' THEN assignment.primary_mentor_id ELSE assignment.secondary_mentor_id END
 FOR UPDATE OF h FOR SHARE OF a,assignment,u,m;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 ctx:=app.scored_exam_review_context(auth_id,attempt);
 IF ctx->>'access' IS DISTINCT FROM 'assigned_mentor' OR ctx->>'actorUserId' IS DISTINCT FROM
 CASE WHEN review='primary' THEN ctx->'assignment'->>'primaryMentorId' ELSE ctx->'assignment'->'eligibleMentorIds'->>1 END
 THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 IF ctx->'completion'='null'::jsonb AND (ctx->>'serverNowMicros')::bigint < (ctx->'attempt'->>'deadlineAtMicros')::bigint
 THEN RETURN jsonb_build_object('kind','review_not_open'); END IF;
 SELECT value INTO acc FROM jsonb_array_elements(ctx->'acceptances') WHERE value->>'submissionId'=submission::text;
 IF acc IS NULL THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 SELECT value INTO question FROM jsonb_array_elements(ctx->'rubric'->'questions') WHERE value->>'questionKey'=acc->>'questionKey';
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=ctx->'rubric'->>'digest';
 IF evidence->>'manualCriteriaSha256' IS DISTINCT FROM r.source_binding->'decisions'->>'manualCriteriaSha256'
 OR body->>'answerSha256' IS DISTINCT FROM acc->>'answerSha256'
 OR body->>'rubricDigest' IS DISTINCT FROM r.rubric_digest
 OR body->>'assignmentDigest' IS DISTINCT FROM ctx->'assignment'->>'digest' THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 -- Every field is resolved natively; evidenceDigest is an expected receipt check, not an authority claim.
 doc:=jsonb_build_object('version',1,'operationId',operation,'expectedRevision',expected::text,
 'review',review,'actorUserId',ctx->'actorUserId','scope',ctx->'attempt'->'scope',
 'snapshotDigest',ctx->>'snapshotDigest','assignmentDigest',ctx->'assignment'->>'digest',
 'submissionId',submission,'questionKey',acc->>'questionKey','answerKind',acc->>'answerKind',
 'answerSha256',acc->>'answerSha256','manualCriteriaSha256',evidence->>'manualCriteriaSha256',
 'publishedCriteriaDigest',question->>'publishedCriteriaDigest','marks',body->'marks','notes',evidence->'notes');
 IF review='secondary' THEN doc:=doc||jsonb_build_object('primaryEventId',body->>'primaryEventId'); END IF;
 doc_hash:=app.checkpoint_digest(doc,'01coding-exam-manual-evidence');
 bytes:=octet_length(convert_to(app.checkpoint_canonical(doc),'UTF8'));
 IF body->>'evidenceDigest' IS DISTINCT FROM doc_hash THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(operation::text,24));
 SELECT * INTO prior_event FROM app.exam_scoring_events WHERE operation_id=operation;
 old_found:=FOUND;
 IF old_found THEN
 SELECT * INTO prior FROM app.exam_manual_evidence WHERE event_id=prior_event.event_id;
 IF prior.event_id IS NULL OR prior.document IS DISTINCT FROM doc OR prior.document_digest IS DISTINCT FROM doc_hash
 OR prior.source_actor_id::text IS DISTINCT FROM ctx->>'actorUserId'
 OR prior_event.submission_id<>submission OR prior_event.expected_revision<>expected OR prior_event.event_kind<>review
 THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 ELSE
 SELECT * INTO p FROM app.exam_manual_evidence_policies WHERE rubric_digest=r.rubric_digest;
 IF p.rubric_digest IS NULL OR criteria_text IS NULL
 OR encode(sha256(convert_to(criteria_text,'UTF8')),'hex') IS DISTINCT FROM evidence->>'manualCriteriaSha256'
 OR octet_length(convert_to(criteria_text,'UTF8'))>(p.policy->>'maxCriteriaBytes')::integer
 OR bytes>(p.policy->>'maxEvidenceBytes')::integer THEN RETURN jsonb_build_object('kind','unavailable'); END IF;
 END IF;
 -- The existing manual writer rechecks authority, closure, exact replay and CAS in this transaction.
 result:=app.record_exam_scoring_event(auth_id,operation,submission,expected,review,body,
 app.checkpoint_digest(body,'01coding-exam-scoring-event'));
 IF result->>'kind'<>'recorded' THEN RETURN result; END IF;
 IF NOT old_found THEN
 IF result->'replayed' IS DISTINCT FROM 'false'::jsonb THEN
 RAISE EXCEPTION 'Unexpected writer replay without durable evidence' USING ERRCODE='PS005'; END IF;
 SELECT role INTO actor_role FROM app.users WHERE id=(ctx->>'actorUserId')::uuid;
 INSERT INTO app.exam_manual_evidence(event_id,document,document_digest,byte_length,source_actor_id,source_role,policy_digest)
 VALUES((result->>'eventId')::uuid,doc,doc_hash,bytes,(ctx->>'actorUserId')::uuid,actor_role,p.policy_digest);
 ELSE
 IF result->>'eventId' IS DISTINCT FROM prior.event_id::text OR result->'replayed' IS DISTINCT FROM 'true'::jsonb THEN
 RAISE EXCEPTION 'Retained evidence receipt mismatch' USING ERRCODE='PS005'; END IF;
 END IF;
 -- Do not catch an insertion/readback failure: PostgreSQL rolls back the scoring writer too.
 IF NOT EXISTS(SELECT FROM app.exam_manual_evidence d WHERE d.event_id=(result->>'eventId')::uuid
 AND d.document=doc AND d.document_digest=doc_hash AND d.byte_length=bytes) THEN
 RAISE EXCEPTION 'Atomic evidence readback failed' USING ERRCODE='PS005'; END IF;
 RETURN result||jsonb_build_object('evidenceReference',jsonb_build_object('version',1,'eventId',result->>'eventId',
 'digest',doc_hash,'byteLength',bytes,'notesStored',evidence->'notes'<>'null'::jsonb));
END $$;

DO $$ DECLARE item record; obj regclass; fn regprocedure; BEGIN
 FOREACH obj IN ARRAY ARRAY['app.exam_manual_evidence_policies'::regclass,'app.exam_manual_evidence'::regclass] LOOP
 FOR item IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END recipient
 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=obj AND a.grantee<>c.relowner LOOP
 EXECUTE format('REVOKE ALL ON TABLE %s FROM %s',obj,item.recipient); END LOOP; END LOOP;
 FOREACH fn IN ARRAY ARRAY['app.scored_exam_manual_evidence(uuid,uuid)'::regprocedure,
 'app.record_scored_exam_manual_evidence(uuid,uuid,uuid,uuid,bigint,text,jsonb,jsonb,text)'::regprocedure] LOOP
 FOR item IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END recipient
 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=fn AND a.grantee<>p.proowner LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',fn,item.recipient); END LOOP; END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.scored_exam_manual_evidence(uuid,uuid) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.record_scored_exam_manual_evidence(uuid,uuid,uuid,uuid,bigint,text,jsonb,jsonb,text) TO nextera_web;
RESET ROLE;

-- The already-held isolated bootstrap DBA installs the sole externally-owned FK.
ALTER TABLE app.exam_manual_evidence ADD CONSTRAINT exam_manual_evidence_source_actor_fk
 FOREIGN KEY(source_actor_id) REFERENCES app.users(id) ON DELETE RESTRICT;
DO $manual_evidence_audit$ BEGIN
 IF EXISTS(SELECT FROM (VALUES('exam_manual_evidence_policies','immutable_manual_evidence_policy'),
 ('exam_manual_evidence','immutable_manual_evidence')) expected(name,guard)
 WHERE NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles o ON o.oid=c.relowner
 WHERE n.nspname='app' AND c.relname=expected.name AND c.relrowsecurity AND o.rolname='nextera_checkpoint_owner'
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee<>c.relowner)
 AND EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=expected.guard
 AND t.tgfoid='app.guard_exam_scoring_history()'::regprocedure AND t.tgenabled='O' AND NOT t.tgisinternal))) THEN
 RAISE EXCEPTION 'Manual evidence private owner/RLS/ACL/history guard readback failed'; END IF;
END $manual_evidence_audit$;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none' THEN
 RAISE EXCEPTION 'Migration role restoration failed'; END IF;
END $$;
COMMIT;
