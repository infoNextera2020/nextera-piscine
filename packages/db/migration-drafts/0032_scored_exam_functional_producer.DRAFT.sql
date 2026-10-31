-- SOURCE REVIEW DRAFT ONLY. No database, credentials, manifest rows or access are provisioned.
-- Requires reviewed0024-0031; existing evaluator LOGIN membership must already be held.
-- Every private manifest publication requires actual approved source bytes; there are no seeds.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'exam-functional-0032-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin)
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')
 OR NOT has_schema_privilege('nextera_checkpoint_owner','app','CREATE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_exam_evaluator' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR to_regprocedure('app.record_exam_scoring_event(uuid,uuid,uuid,bigint,text,jsonb,text)') IS NULL
 OR to_regprocedure('app.scored_exam_attempt_metadata(app.checkpoint_attempts)') IS NULL THEN
 RAISE EXCEPTION 'Fresh pre-held isolated functional producer prerequisites required'; END IF;
END $$;
SET LOCAL ROLE nextera_checkpoint_owner;
CREATE FUNCTION app.scored_exam_functional_manifest_valid(m jsonb,case_count integer) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE g jsonb;c jsonb;seen integer[]:=ARRAY[]::integer[];keys text[]:=ARRAY[]::text[];files jsonb;idx integer;
BEGIN
 IF case_count IS NULL OR case_count<1 OR jsonb_typeof(m) IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM jsonb_object_keys(m))<>4
 OR NOT(m ?& ARRAY['version','failureSemantics','caseFiles','groups']) OR m->'version' IS DISTINCT FROM '1'::jsonb
 OR m->>'failureSemantics' IS DISTINCT FROM 'complete-observations-only-v1'
 OR jsonb_typeof(m->'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'groups') NOT BETWEEN 1 AND 13 THEN RETURN false; END IF;
 files:=m->'caseFiles';
 IF jsonb_typeof(files) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(files))<>2
 OR NOT(files ?& ARRAY['publicSha256','privateSha256'])
 OR EXISTS(SELECT FROM unnest(ARRAY['publicSha256','privateSha256']) k WHERE jsonb_typeof(files->k) IS DISTINCT FROM 'string' OR files->>k !~ '^[0-9a-f]{64}$') THEN RETURN false; END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(m->'groups') LOOP
 IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(g))<>3
 OR NOT(g ?& ARRAY['groupKey','criteriaDigest','cases'])
 OR jsonb_typeof(g->'groupKey') IS DISTINCT FROM 'string' OR g->>'groupKey' !~ '^[a-z][a-z0-9-]{0,79}$' OR g->>'groupKey'=ANY(keys)
 OR jsonb_typeof(g->'criteriaDigest') IS DISTINCT FROM 'string' OR g->>'criteriaDigest' !~ '^[0-9a-f]{64}$'
 OR jsonb_typeof(g->'cases') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'cases')<1 THEN RETURN false; END IF;
 keys:=array_append(keys,g->>'groupKey');
 FOR c IN SELECT value FROM jsonb_array_elements(g->'cases') LOOP
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(c))<>2
 OR NOT(c ?& ARRAY['index','caseSha256']) OR jsonb_typeof(c->'index') IS DISTINCT FROM 'number'
 OR c->>'index' !~ '^(0|[1-9][0-9]*)$' OR (c->>'index')::numeric>=case_count
 OR jsonb_typeof(c->'caseSha256') IS DISTINCT FROM 'string' OR c->>'caseSha256' !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
 idx:=(c->>'index')::integer;IF idx=ANY(seen) THEN RETURN false; END IF;seen:=array_append(seen,idx);
 END LOOP;END LOOP;
 RETURN cardinality(seen)=case_count;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE app.scored_exam_functional_manifests (
 evaluator_key text NOT NULL CHECK(evaluator_key='official-code'),
 evaluator_digest text NOT NULL CHECK(evaluator_digest ~ '^[0-9a-f]{64}$'),
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 rubric_digest text NOT NULL CHECK(rubric_digest ~ '^[0-9a-f]{64}$'),
 rubric_source_binding_digest text NOT NULL CHECK(rubric_source_binding_digest ~ '^[0-9a-f]{64}$'),
 question_key text NOT NULL CHECK(question_key ~ '^q[1-5]$'),
 test_pack_id text NOT NULL CHECK(test_pack_id ~ '^[a-z][a-z0-9-]{0,99}$'),
 test_pack_digest text NOT NULL CHECK(test_pack_digest ~ '^[0-9a-f]{64}$'),
 manifest_bytes bytea NOT NULL CHECK(octet_length(manifest_bytes) BETWEEN 1 AND 1048576),
 manifest jsonb NOT NULL CHECK(manifest=convert_from(manifest_bytes,'UTF8')::jsonb),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256=encode(sha256(manifest_bytes),'hex')),
 case_count integer NOT NULL CHECK(app.scored_exam_functional_manifest_valid(manifest,case_count)),
 manifest_binding_digest text NOT NULL,
 PRIMARY KEY(evaluator_key,evaluator_digest,rubric_digest,question_key),
 CHECK(manifest_binding_digest=app.checkpoint_digest(jsonb_build_object('version',1,
 'evaluatorKey',evaluator_key,'evaluatorDigest',evaluator_digest,'definitionDigest',definition_digest,
 'rubricDigest',rubric_digest,'rubricSourceBindingDigest',rubric_source_binding_digest,'questionKey',question_key,
 'testPackId',test_pack_id,'testPackDigest',test_pack_digest,'manifestSha256',manifest_sha256,
 'publicCasesSha256',manifest->'caseFiles'->>'publicSha256','privateCasesSha256',manifest->'caseFiles'->>'privateSha256',
 'caseCount',case_count),'01coding-exam-functional-manifest-binding'))
);
CREATE FUNCTION app.guard_scored_exam_functional_manifest() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Private functional manifest provenance is immutable'; END $$;
CREATE TRIGGER scored_exam_functional_manifest_immutable BEFORE UPDATE OR DELETE ON app.scored_exam_functional_manifests
FOR EACH ROW EXECUTE FUNCTION app.guard_scored_exam_functional_manifest();
ALTER TABLE app.scored_exam_functional_manifests ENABLE ROW LEVEL SECURITY;

-- Read-only bridge. Existing0024 remains the only functional-event writer.
CREATE FUNCTION app.scored_exam_functional_context(submission uuid,job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE acc app.exam_scoring_acceptances;a app.checkpoint_attempts;assignment app.exam_scoring_assignments;
 r app.exam_scoring_rubrics;code app.submissions;art app.submission_artifacts;j judge.jobs;
 evaluator app.exam_scoring_evaluator_logins;m app.scored_exam_functional_manifests;
 item jsonb;spec jsonb;q jsonb;groups jsonb;revision bigint;
BEGIN
 IF submission IS NULL OR job IS NULL OR current_setting('role')<>'none'
 OR NOT pg_has_role(session_user,'nextera_exam_evaluator','USAGE')
 OR pg_has_role(session_user,'nextera_web','USAGE') OR pg_has_role(session_user,'nextera_web','SET')
 OR pg_has_role(session_user,'nextera_checkpoint_owner','USAGE') OR pg_has_role(session_user,'nextera_checkpoint_owner','SET')
 OR EXISTS(SELECT FROM unnest(ARRAY['nextera_result_application','nextera_runner','nextera_judge_owner','nextera_judge_maintenance']) forbidden(role_name)
 WHERE pg_has_role(session_user,role_name,'USAGE') OR pg_has_role(session_user,role_name,'SET'))
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN
 RAISE EXCEPTION 'Functional context forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO evaluator FROM app.exam_scoring_evaluator_logins WHERE login_name=session_user AND enabled FOR SHARE;
 SELECT * INTO acc FROM app.exam_scoring_acceptances WHERE submission_id=submission;
 IF evaluator.login_name IS NULL OR acc.source_kind IS DISTINCT FROM 'coding' OR acc.answer_kind IS DISTINCT FROM 'coding'
 OR acc.question_key !~ '^q[1-5]$' OR acc.evaluator_key IS DISTINCT FROM 'official-code'
 OR evaluator.evaluator_key IS DISTINCT FROM acc.evaluator_key OR evaluator.evaluator_digest IS DISTINCT FROM acc.evaluator_digest THEN
 RAISE EXCEPTION 'Exact acceptance evaluator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=acc.attempt_id FOR SHARE;
 SELECT * INTO assignment FROM app.exam_scoring_assignments WHERE attempt_id=a.id;
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=assignment.rubric_digest;
 SELECT * INTO code FROM app.submissions WHERE id=submission AND checkpoint_attempt_id=a.id AND checkpoint_task_key=acc.question_key
 AND user_id=a.user_id AND cohort_id=a.cohort_id AND curriculum_version_id=a.curriculum_version_id AND node_key=a.node_key;
 SELECT * INTO art FROM app.submission_artifacts WHERE id=code.artifact_id AND owner_user_id=a.user_id;
 SELECT * INTO j FROM judge.jobs WHERE id=job AND submission_id=submission AND id=code.active_judge_job_id;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=acc.question_key;
 SELECT value INTO q FROM jsonb_array_elements(r.rubric->'questions') WHERE value->>'questionKey'=acc.question_key;
 spec:=item->'evaluationSpec';
 IF app.scored_exam_attempt_metadata(a) IS NULL OR acc.snapshot_digest IS DISTINCT FROM a.snapshot_digest
 OR r.definition_digest IS DISTINCT FROM a.definition_digest OR NOT coalesce(app.exam_scoring_rubric_valid(r.rubric),false)
 OR NOT coalesce(app.exam_scoring_source_binding_valid(r.source_binding,r.rubric),false)
 OR r.source_binding_digest IS DISTINCT FROM app.checkpoint_digest(r.source_binding,'nextera-exam1-rubric-source-binding')
 OR code.id IS NULL OR art.id IS NULL OR art.sha256 IS DISTINCT FROM acc.answer_digest
 OR code.evaluation_spec_digest IS DISTINCT FROM acc.evaluator_digest
 OR item->>'evaluationDigest' IS DISTINCT FROM acc.evaluator_digest
 OR app.checkpoint_digest(spec,'nextera-evaluation-spec') IS DISTINCT FROM acc.evaluator_digest
 OR spec->'execution_contract'->'version' IS DISTINCT FROM '3'::jsonb
 OR spec->'execution_contract'->>'item_key' IS DISTINCT FROM acc.question_key
 OR j.id IS NULL OR j.state::text IS DISTINCT FROM 'completed'
 OR NOT EXISTS(SELECT FROM judge.results result WHERE result.id=j.terminal_result_id AND result.job_id=j.id
 AND result.evaluation_digest=j.evaluation_digest AND result.verdict::text IN('passed','failed'))
 OR j.evaluation_digest IS DISTINCT FROM app.checkpoint_digest(j.evaluation_snapshot,'nextera-evaluation-snapshot')
 OR (j.evaluation_snapshot-ARRAY['curriculum_version_id','git_commit_sha','evaluation_spec_digest','learner_id','cohort_id','submission_id','learner_attempt_ordinal','accepted_at','artifact']) IS DISTINCT FROM spec
 OR j.evaluation_snapshot->>'evaluation_spec_digest' IS DISTINCT FROM acc.evaluator_digest
 OR j.evaluation_snapshot->>'submission_id' IS DISTINCT FROM code.id::text
 OR j.evaluation_snapshot->>'learner_id' IS DISTINCT FROM a.user_id::text
 OR j.evaluation_snapshot->>'cohort_id' IS DISTINCT FROM a.cohort_id::text
 OR j.evaluation_snapshot->>'curriculum_version_id' IS DISTINCT FROM a.curriculum_version_id::text
 OR j.evaluation_snapshot->'artifact' IS DISTINCT FROM jsonb_build_object('id',art.id,'bucket',art.storage_bucket,'key',art.storage_key,'filename',art.original_filename,'size_bytes',art.size_bytes,'sha256',art.sha256) THEN
 RAISE EXCEPTION 'Frozen completed functional job unavailable' USING ERRCODE='PS005'; END IF;
 SELECT * INTO m FROM app.scored_exam_functional_manifests WHERE evaluator_key=acc.evaluator_key AND evaluator_digest=acc.evaluator_digest
 AND rubric_digest=r.rubric_digest AND question_key=acc.question_key;
 IF m.evaluator_key IS NULL OR m.definition_digest IS DISTINCT FROM a.definition_digest
 OR m.rubric_source_binding_digest IS DISTINCT FROM r.source_binding_digest
 OR m.test_pack_id IS DISTINCT FROM spec->>'test_pack_id' OR m.test_pack_digest IS DISTINCT FROM spec->>'test_pack_digest'
 OR NOT coalesce(app.scored_exam_functional_manifest_valid(m.manifest,m.case_count),false)
 OR jsonb_array_length(m.manifest->'groups')<>jsonb_array_length(q->'functionalGroups')
 OR EXISTS(SELECT FROM jsonb_array_elements(m.manifest->'groups') WITH ORDINALITY g(value,ord)
 WHERE g.value->>'groupKey' IS DISTINCT FROM q->'functionalGroups'->(g.ord::integer-1)->>'key'
 OR g.value->>'criteriaDigest' IS DISTINCT FROM q->'functionalGroups'->(g.ord::integer-1)->>'criteriaDigest') THEN
 RAISE EXCEPTION 'Registered private group provenance unavailable' USING ERRCODE='PS005'; END IF;
 SELECT jsonb_agg(jsonb_build_object('groupKey',value->>'groupKey','criteriaDigest',value->>'criteriaDigest') ORDER BY ord)
 INTO groups FROM jsonb_array_elements(m.manifest->'groups') WITH ORDINALITY g(value,ord);
 SELECT h.revision INTO revision FROM app.exam_scoring_heads h WHERE h.submission_id=submission FOR SHARE;
 IF revision IS NULL OR revision=9223372036854775807 THEN RAISE EXCEPTION 'Functional evidence head unavailable' USING ERRCODE='PS005'; END IF;
 RETURN jsonb_build_object('version',1,'submissionId',code.id,'jobId',j.id,'attemptId',a.id,'learnerId',a.user_id,'cohortId',a.cohort_id,
 'questionKey',acc.question_key,'answerSha256',acc.answer_digest,'definitionDigest',a.definition_digest,'snapshotDigest',a.snapshot_digest,
 'rubricDigest',r.rubric_digest,'rubricSourceBindingDigest',r.source_binding_digest,'publishedCriteriaDigest',q->>'publishedCriteriaDigest',
 'evaluatorKey',acc.evaluator_key,'evaluatorDigest',acc.evaluator_digest,'evaluationSnapshotDigest',j.evaluation_digest,
 'evaluationSpecDigest',code.evaluation_spec_digest,'testPackId',m.test_pack_id,'testPackDigest',m.test_pack_digest,
 'manifestSha256',m.manifest_sha256,'publicCasesSha256',m.manifest->'caseFiles'->>'publicSha256','privateCasesSha256',m.manifest->'caseFiles'->>'privateSha256',
 'caseCount',m.case_count,'manifestBindingDigest',m.manifest_binding_digest,'expectedRevision',revision::text,'groups',groups);
END $$;
DO $$ DECLARE grantee record;f regprocedure;BEGIN
 FOR grantee IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END recipient
 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
 WHERE c.oid='app.scored_exam_functional_manifests'::regclass AND a.grantee<>c.relowner LOOP
 EXECUTE format('REVOKE ALL ON TABLE app.scored_exam_functional_manifests FROM %s',grantee.recipient);END LOOP;
 FOREACH f IN ARRAY ARRAY['app.scored_exam_functional_manifest_valid(jsonb,integer)'::regprocedure,'app.guard_scored_exam_functional_manifest()'::regprocedure,'app.scored_exam_functional_context(uuid,uuid)'::regprocedure] LOOP
 FOR grantee IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END recipient
 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
 WHERE p.oid=f AND a.grantee<>p.proowner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f,grantee.recipient);END LOOP;END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.scored_exam_functional_context(uuid,uuid) TO nextera_exam_evaluator;
RESET ROLE;
ALTER TABLE app.scored_exam_functional_manifests ADD CONSTRAINT scored_exam_functional_manifest_rubric_fk FOREIGN KEY(rubric_digest) REFERENCES app.exam_scoring_rubrics(rubric_digest) ON DELETE RESTRICT;
DO $$ DECLARE f record;allowed text[];BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none' THEN RAISE EXCEPTION 'Functional producer role restoration failed';END IF;
 IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid='app.scored_exam_functional_manifests'::regclass AND r.rolname='nextera_checkpoint_owner' AND c.relrowsecurity
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)) THEN RAISE EXCEPTION 'Private manifest owner/RLS/ACL readback failed';END IF;
 FOR f IN SELECT p.*,r.rolname owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
 WHERE n.nspname='app' AND p.proname IN('scored_exam_functional_manifest_valid','guard_scored_exam_functional_manifest','scored_exam_functional_context') LOOP
 allowed:=CASE WHEN f.proname='scored_exam_functional_context' THEN ARRAY['nextera_exam_evaluator'] ELSE ARRAY[]::text[] END;
 IF f.owner<>'nextera_checkpoint_owner' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR f.prosecdef IS DISTINCT FROM (f.proname='scored_exam_functional_context')
 OR EXISTS(SELECT FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
 WHERE a.grantee<>f.proowner AND (a.grantee=0 OR NOT coalesce(r.rolname=ANY(allowed),false) OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 OR EXISTS(SELECT FROM unnest(allowed) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE')) THEN RAISE EXCEPTION 'Exact functional context owner/OID/ACL readback failed';END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN('scored_exam_functional_manifest_valid','guard_scored_exam_functional_manifest','scored_exam_functional_context'))<>3 THEN RAISE EXCEPTION 'Unexpected functional context function set';END IF;
END $$;
COMMIT;
