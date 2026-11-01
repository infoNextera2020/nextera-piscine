-- SOURCE REVIEW DRAFT ONLY. Unregistered, unapplied and inactive.
-- Append-only compatibility after reviewed0022/0024/0027; no old migration bytes change.
-- Existing evaluator authority only. No roles, memberships, seeds, delivery or expected answers.
-- DBA must independently prove a fresh disposable target and already-held owner SET span.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('server_encoding')<>'UTF8'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'exam-trace-reader-0038-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin)
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')
 OR NOT has_schema_privilege('nextera_checkpoint_owner','app','CREATE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin
 AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_exam_evaluator' AND NOT rolcanlogin
 AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
 WHERE r.rolname IN('nextera_checkpoint_owner','nextera_exam_evaluator'))
 OR to_regprocedure('app.scored_exam_trace_context(uuid)') IS NOT NULL
 OR to_regprocedure('app.scored_exam_attempt_metadata(app.checkpoint_attempts)') IS NULL
 OR to_regprocedure('app.checkpoint_answer_payload_complete(bytea,text)') IS NULL
 OR to_regprocedure('app.checkpoint_answer_contract_digest(uuid,uuid,uuid,text,text,text,integer)') IS NULL THEN
 RAISE EXCEPTION 'EXAM_TRACE_SOURCE_PREREQUISITES_REQUIRED'; END IF;
END $$;
-- Exact existing private validator; unexpected body/attributes/owner/ACL deny replacement.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
 JOIN pg_language l ON l.oid=p.prolang
 WHERE p.oid=to_regprocedure('app.exam_scoring_source_binding_valid(jsonb,jsonb)')
 AND p.prorettype='boolean'::regtype AND p.prokind='f' AND p.provolatile='i'
 AND p.proisstrict AND NOT p.prosecdef AND l.lanname='plpgsql'
 AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND o.rolname='nextera_checkpoint_owner'
 AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='1a0ea30f30f154ea4126cdc2a34e31c7858827c73d4cf1fb4d818b67e21b92e4'
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE a.grantee<>p.proowner)) THEN RAISE EXCEPTION 'EXAM_TRACE_PRIOR_VALIDATOR_REQUIRED'; END IF;
END $$;
CREATE TEMP TABLE exam_trace_prior_validator ON COMMIT DROP AS
 SELECT oid,proowner,proacl,prosecdef,provolatile,proisstrict,proconfig
 FROM pg_proc WHERE oid='app.exam_scoring_source_binding_valid(jsonb,jsonb)'::regprocedure;
-- Existing private histories are immutable and owner confined. No new table privileges.
DO $$ DECLARE rel regclass; item record; BEGIN
 FOREACH rel IN ARRAY ARRAY[
 'app.checkpoint_answer_receipts'::regclass,'app.checkpoint_answer_outbox'::regclass,
 'app.checkpoint_answer_allowance_debits'::regclass,'app.checkpoint_answer_submit_policies'::regclass,
 'app.exam_scoring_acceptances'::regclass,'app.exam_scoring_assignments'::regclass,
 'app.exam_scoring_rubrics'::regclass,'app.exam_scoring_heads'::regclass,
 'app.exam_scoring_evaluator_logins'::regclass] LOOP
 IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_roles o ON o.oid=c.relowner
 WHERE c.oid=rel AND o.rolname='nextera_checkpoint_owner' AND c.relrowsecurity
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner))
 THEN RAISE EXCEPTION 'EXAM_TRACE_PRIVATE_HISTORY_REQUIRED'; END IF;
 END LOOP;
 FOR item IN SELECT * FROM (VALUES
 ('app.checkpoint_answer_receipts','checkpoint_answer_receipt_immutable','app.guard_checkpoint_answer_submission_history()'),
 ('app.checkpoint_answer_outbox','checkpoint_answer_outbox_immutable','app.guard_checkpoint_answer_submission_history()'),
 ('app.checkpoint_answer_allowance_debits','checkpoint_answer_debit_immutable','app.guard_checkpoint_answer_submission_history()'),
 ('app.exam_scoring_acceptances','exam_scoring_acceptances_immutable','app.guard_exam_scoring_history()'),
 ('app.exam_scoring_assignments','exam_scoring_assignments_immutable','app.guard_exam_scoring_history()'),
 ('app.exam_scoring_rubrics','exam_scoring_rubrics_immutable','app.guard_exam_scoring_history()')
 ) expected(relation_name,trigger_name,function_name) LOOP
 IF NOT EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid=to_regclass(item.relation_name)
 AND t.tgname=item.trigger_name AND t.tgfoid=to_regprocedure(item.function_name)
 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgtype=27)
 THEN RAISE EXCEPTION 'EXAM_TRACE_IMMUTABLE_HISTORY_REQUIRED'; END IF;
 END LOOP;
 FOREACH rel IN ARRAY ARRAY['app.checkpoint_attempts'::regclass,'app.checkpoint_definitions'::regclass,
 'app.users'::regclass,'app.cohorts'::regclass,'app.curriculum_versions'::regclass,'app.curriculum_nodes'::regclass] LOOP
 IF NOT has_table_privilege('nextera_checkpoint_owner',rel,'SELECT')
 THEN RAISE EXCEPTION 'EXAM_TRACE_EXISTING_READ_PRIVILEGES_REQUIRED'; END IF;
 END LOOP;
END $$;
SET LOCAL ROLE nextera_checkpoint_owner;

-- Additive version allowlist only. Historical exact_utf8 never acquires new semantics.
CREATE OR REPLACE FUNCTION app.exam_scoring_source_binding_valid(b jsonb,r jsonb) RETURNS boolean
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
 OR d->>'traceComparator' NOT IN ('exact_utf8','crlf_lf_optional_terminal_lf_v1')
 OR b->'rubric' IS DISTINCT FROM r-'digest' THEN RETURN false; END IF;
 RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION app.scored_exam_trace_context(receipt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE typed app.checkpoint_answer_receipts; acc app.exam_scoring_acceptances;
 a app.checkpoint_attempts; assignment app.exam_scoring_assignments; r app.exam_scoring_rubrics;
 evaluator app.exam_scoring_evaluator_logins; intent app.checkpoint_answer_outbox;
 debit app.checkpoint_answer_allowance_debits; policy app.checkpoint_answer_submit_policies;
 item jsonb; contract jsonb; route jsonb; allowance jsonb; q jsonb; revision bigint; maximum integer;
BEGIN
 IF receipt IS NULL OR current_setting('role')<>'none'
 OR NOT pg_has_role(session_user,'nextera_exam_evaluator','USAGE')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolcanlogin
 AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR EXISTS(SELECT FROM pg_roles denied WHERE
 (denied.rolname IN('nextera_web','nextera_checkpoint_owner','nextera_result_application',
 'nextera_runner','nextera_judge_owner','nextera_judge_maintenance') OR denied.rolname ~ '^nextera_.*_owner$')
 AND (pg_has_role(session_user,denied.oid,'USAGE') OR pg_has_role(session_user,denied.oid,'SET'))) THEN
 RAISE EXCEPTION 'EXAM_TRACE_CONTEXT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 -- The registry is re-read and locked on every call, never supplied by the caller.
 SELECT * INTO evaluator FROM app.exam_scoring_evaluator_logins
 WHERE login_name=session_user AND enabled FOR SHARE;
 SELECT * INTO typed FROM app.checkpoint_answer_receipts WHERE id=receipt;
 SELECT * INTO acc FROM app.exam_scoring_acceptances WHERE submission_id=receipt;
 IF evaluator.login_name IS NULL OR typed.id IS NULL OR acc.submission_id IS NULL
 OR typed.answer_kind IS DISTINCT FROM 'trace_with_reason' OR typed.answer_version IS DISTINCT FROM 1
 OR typed.task_key NOT IN('q6','q7') OR acc.source_kind IS DISTINCT FROM 'structured'
 OR acc.answer_kind IS DISTINCT FROM 'trace_with_reason' OR acc.question_key IS DISTINCT FROM typed.task_key
 OR evaluator.evaluator_key IS DISTINCT FROM typed.evaluator_key
 OR evaluator.evaluator_digest IS DISTINCT FROM typed.evaluator_digest
 OR acc.evaluator_key IS DISTINCT FROM typed.evaluator_key OR acc.evaluator_digest IS DISTINCT FROM typed.evaluator_digest THEN
 RAISE EXCEPTION 'EXAM_TRACE_CONTEXT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 -- Accepted source identity/snapshot are immutable. Do not acquire foreign-owner row locks.
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=typed.attempt_id;
 SELECT * INTO assignment FROM app.exam_scoring_assignments WHERE attempt_id=a.id;
 SELECT * INTO r FROM app.exam_scoring_rubrics WHERE rubric_digest=assignment.rubric_digest;
 SELECT * INTO intent FROM app.checkpoint_answer_outbox WHERE receipt_id=receipt;
 SELECT * INTO debit FROM app.checkpoint_answer_allowance_debits WHERE receipt_id=receipt;
 SELECT * INTO policy FROM app.checkpoint_answer_submit_policies
 WHERE curriculum_version_id=typed.curriculum_version_id AND node_key=typed.node_key
 AND definition_digest=typed.definition_digest AND task_key=typed.task_key;
 IF a.id IS NULL OR assignment.attempt_id IS NULL OR r.rubric_digest IS NULL
 OR app.scored_exam_attempt_metadata(a) IS NULL
 OR typed.user_id IS DISTINCT FROM a.user_id OR typed.cohort_id IS DISTINCT FROM a.cohort_id
 OR typed.curriculum_version_id IS DISTINCT FROM a.curriculum_version_id OR typed.node_key IS DISTINCT FROM a.node_key
 OR typed.definition_digest IS DISTINCT FROM a.definition_digest OR typed.snapshot_digest IS DISTINCT FROM a.snapshot_digest
 OR acc.attempt_id IS DISTINCT FROM a.id OR acc.snapshot_digest IS DISTINCT FROM a.snapshot_digest
 OR acc.answer_digest IS DISTINCT FROM typed.answer_digest OR acc.accepted_at IS DISTINCT FROM typed.accepted_at
 OR typed.accepted_at<a.started_at OR typed.accepted_at>=a.deadline_at
 OR (extract(epoch FROM typed.accepted_at)*1000000)::numeric NOT BETWEEN 1 AND 9223372036854775806
 OR a.deadline_at IS DISTINCT FROM a.started_at+interval '180 minutes'
 OR NOT EXISTS(SELECT FROM app.users u WHERE u.id=a.user_id AND u.auth_user_id=typed.auth_user_id)
 OR NOT EXISTS(SELECT FROM app.cohorts c WHERE c.id=a.cohort_id AND c.curriculum_version_id=a.curriculum_version_id)
 OR NOT EXISTS(SELECT FROM app.curriculum_versions v WHERE v.id=a.curriculum_version_id)
 OR NOT EXISTS(SELECT FROM app.curriculum_nodes n JOIN app.checkpoint_definitions d USING(curriculum_version_id,node_key)
 WHERE n.curriculum_version_id=a.curriculum_version_id AND n.node_key=a.node_key AND n.kind='checkpoint'
 AND n.resolved_evaluation_spec=a.snapshot->'evaluation_spec'
 AND n.evaluation_spec_digest=app.checkpoint_digest(n.resolved_evaluation_spec,'nextera-evaluation-spec')
 AND d.definition=a.snapshot->'definition' AND d.definition_digest=a.definition_digest)
 OR intent.receipt_id IS DISTINCT FROM typed.id OR typed.outbox_receipt_id IS DISTINCT FROM typed.id
 OR intent.answer_digest IS DISTINCT FROM typed.answer_digest OR intent.snapshot_digest IS DISTINCT FROM typed.snapshot_digest
 OR intent.evaluator_key IS DISTINCT FROM typed.evaluator_key OR intent.evaluator_digest IS DISTINCT FROM typed.evaluator_digest
 OR intent.evaluation IS DISTINCT FROM 'pending' OR intent.created_at IS DISTINCT FROM typed.accepted_at
 OR debit.receipt_id IS DISTINCT FROM typed.id OR typed.debit_receipt_id IS DISTINCT FROM typed.id
 OR debit.attempt_id IS DISTINCT FROM a.id OR debit.task_key IS DISTINCT FROM typed.task_key
 OR debit.units IS DISTINCT FROM 1 OR debit.created_at IS DISTINCT FROM typed.accepted_at
 OR EXISTS(SELECT FROM app.exam_scoring_closures closed WHERE closed.attempt_id=a.id
 AND (acc.accepted_ordinal>=closed.closure_ordinal OR acc.accepted_at>closed.closed_at)) THEN
 RAISE EXCEPTION 'EXAM_TRACE_CONTEXT_UNAVAILABLE' USING ERRCODE='PS005'; END IF;
 SELECT value INTO item FROM jsonb_array_elements(a.snapshot->'definition'->'tasks') WHERE value->>'key'=typed.task_key;
 SELECT value INTO q FROM jsonb_array_elements(r.rubric->'questions') WHERE value->>'questionKey'=typed.task_key;
 contract:=item->'answerContract'; route:=item->'answerEvaluator'; allowance:=item->'officialAnswerPolicy';
 IF item->'answerFormat' IS DISTINCT FROM jsonb_build_object('version',1,'kind','trace_with_reason')
 OR jsonb_typeof(contract) IS DISTINCT FROM 'object' OR contract-ARRAY['version','kind','maxBytes']<>'{}'::jsonb
 OR NOT(contract ?& ARRAY['version','kind','maxBytes']) OR contract->'version' IS DISTINCT FROM '1'::jsonb
 OR contract->>'kind' IS DISTINCT FROM 'trace_with_reason' OR jsonb_typeof(contract->'maxBytes') IS DISTINCT FROM 'number'
 OR contract->>'maxBytes' !~ '^[1-9][0-9]*$' OR (contract->>'maxBytes')::numeric>262144
 OR jsonb_typeof(allowance) IS DISTINCT FROM 'object' OR allowance-ARRAY['version','gradedAllowance']<>'{}'::jsonb
 OR NOT(allowance ?& ARRAY['version','gradedAllowance']) OR allowance->'version' IS DISTINCT FROM '1'::jsonb
 OR jsonb_typeof(allowance->'gradedAllowance') IS DISTINCT FROM 'number'
 OR allowance->>'gradedAllowance' !~ '^[1-9][0-9]*$' OR (allowance->>'gradedAllowance')::numeric>2147483647 THEN
 RAISE EXCEPTION 'EXAM_TRACE_CONTEXT_UNAVAILABLE' USING ERRCODE='PS005'; END IF;
 maximum:=(contract->>'maxBytes')::integer;
 IF policy.curriculum_version_id IS NULL OR policy.answer_kind IS DISTINCT FROM 'trace_with_reason'
 OR policy.max_answer_bytes IS DISTINCT FROM maximum OR policy.graded_allowance IS DISTINCT FROM (allowance->>'gradedAllowance')::integer
 OR policy.evaluator_key IS DISTINCT FROM typed.evaluator_key OR policy.evaluator_digest IS DISTINCT FROM typed.evaluator_digest
 OR route IS DISTINCT FROM jsonb_build_object('family','checkpoint_structured_answer','version',1,'kind','trace_with_reason',
 'definitionDigest',a.definition_digest,'taskKey',typed.task_key,'evaluatorKey',typed.evaluator_key,'evaluatorDigest',typed.evaluator_digest)
 OR typed.answer_contract_digest IS DISTINCT FROM app.checkpoint_answer_contract_digest(a.user_id,a.cohort_id,a.id,
 typed.task_key,a.definition_digest,'trace_with_reason',maximum)
 OR octet_length(typed.answer_bytes) NOT BETWEEN 1 AND maximum
 OR typed.answer_digest IS DISTINCT FROM encode(sha256(typed.answer_bytes),'hex')
 OR NOT coalesce(app.checkpoint_answer_payload_complete(typed.answer_bytes,'trace_with_reason'),false)
 OR NOT coalesce(app.exam_scoring_rubric_valid(r.rubric),false)
 OR NOT coalesce(app.exam_scoring_source_binding_valid(r.source_binding,r.rubric),false)
 OR r.definition_digest IS DISTINCT FROM a.definition_digest
 OR r.rubric_digest IS DISTINCT FROM app.checkpoint_digest(r.rubric-'digest','01coding-exam-scoring-rubric')
 OR r.source_binding_digest IS DISTINCT FROM app.checkpoint_digest(r.source_binding,'nextera-exam1-rubric-source-binding')
 OR r.source_binding->'decisions'->>'traceComparator' IS DISTINCT FROM 'crlf_lf_optional_terminal_lf_v1'
 OR r.source_binding->'decisions'->>'traceComparatorOwnerMessageId' IS DISTINCT FROM 'Sentinel_e849fe300ea88191acd6431b61521c7a'
 OR r.source_binding->'decisions'->>'weightsOwnerMessageId' IS DISTINCT FROM 'Sentinel_e849fe300ea88191acd6431b61521c7a'
 OR q->>'kind' IS DISTINCT FROM 'trace_with_reason' OR q->'functionalGroups' IS DISTINCT FROM '[]'::jsonb
 OR jsonb_typeof(q->'publishedCriteriaDigest') IS DISTINCT FROM 'string' OR q->>'publishedCriteriaDigest' !~ '^[0-9a-f]{64}$' THEN
 RAISE EXCEPTION 'EXAM_TRACE_CONTEXT_UNAVAILABLE' USING ERRCODE='PS005'; END IF;
 -- Own mutable head only. No UPDATE privilege or identity row lock is added to another owner.
 SELECT h.revision INTO revision FROM app.exam_scoring_heads h WHERE h.submission_id=receipt FOR SHARE;
 IF revision IS NULL OR revision<0 OR revision>=9223372036854775807 THEN
 RAISE EXCEPTION 'EXAM_TRACE_CONTEXT_UNAVAILABLE' USING ERRCODE='PS005'; END IF;
 -- No intake-open, current deadline, learner active, cohort active or policy-enabled test:
 -- accepted immutable work remains gradeable after expiry/deactivation. Evaluator authority above is current.
 RETURN jsonb_build_object('version',1,'receiptId',typed.id,'attemptId',a.id,'learnerId',a.user_id,'cohortId',a.cohort_id,
 'curriculumVersionId',a.curriculum_version_id,'nodeKey',a.node_key,'form',r.form,'questionKey',typed.task_key,
 'answerKind','trace_with_reason','answerContractDigest',typed.answer_contract_digest,
 'acceptedAtMicros',(extract(epoch FROM typed.accepted_at)*1000000)::bigint::text,
 'answerBase64',replace(encode(typed.answer_bytes,'base64'),E'\n',''),'answerSha256',typed.answer_digest,
 'answerByteLength',octet_length(typed.answer_bytes),'definitionDigest',a.definition_digest,'snapshotDigest',a.snapshot_digest,
 'evaluatorKey',typed.evaluator_key,'evaluatorDigest',typed.evaluator_digest,'publishedCriteriaDigest',q->>'publishedCriteriaDigest',
 'rubricSourceBindingDigest',r.source_binding_digest,'rubric',r.rubric,'sourceBinding',r.source_binding,
 'outbox',jsonb_build_object('receiptId',intent.receipt_id,'answerSha256',intent.answer_digest,
 'snapshotDigest',intent.snapshot_digest,'evaluatorKey',intent.evaluator_key,'evaluatorDigest',intent.evaluator_digest,'evaluation',intent.evaluation),
 'expectedRevision',revision::text);
EXCEPTION
 WHEN SQLSTATE '42501' THEN RAISE EXCEPTION 'EXAM_TRACE_CONTEXT_FORBIDDEN' USING ERRCODE='42501';
 WHEN OTHERS THEN RAISE EXCEPTION 'EXAM_TRACE_CONTEXT_UNAVAILABLE' USING ERRCODE='PS005';
END $$;
-- Default/inherited function grants are removed only for this new RPC.
DO $$ DECLARE recipient record; BEGIN
 FOR recipient IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END name
 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid='app.scored_exam_trace_context(uuid)'::regprocedure AND a.grantee<>p.proowner LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION app.scored_exam_trace_context(uuid) FROM %s',recipient.name);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.scored_exam_trace_context(uuid) TO nextera_exam_evaluator;
RESET ROLE;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 THEN RAISE EXCEPTION 'EXAM_TRACE_OWNER_SPAN_RESTORATION_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT FROM pg_proc p JOIN exam_trace_prior_validator old ON old.oid=p.oid
 WHERE p.oid='app.exam_scoring_source_binding_valid(jsonb,jsonb)'::regprocedure
 AND p.proowner=old.proowner AND p.proacl IS NOT DISTINCT FROM old.proacl
 AND p.prosecdef=old.prosecdef AND p.provolatile=old.provolatile AND p.proisstrict=old.proisstrict
 AND p.proconfig IS NOT DISTINCT FROM old.proconfig
 AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='66bef21e55436ebf378b1e9f95f71451faddde4366720436a1228cb185f6b616')
 THEN RAISE EXCEPTION 'EXAM_TRACE_VALIDATOR_IDENTITY_ACL_RESTORATION_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner JOIN pg_language l ON l.oid=p.prolang
 WHERE p.oid='app.scored_exam_trace_context(uuid)'::regprocedure AND o.rolname='nextera_checkpoint_owner'
 AND p.prorettype='jsonb'::regtype AND p.prokind='f' AND p.provolatile='v' AND NOT p.proisstrict AND p.prosecdef
 AND l.lanname='plpgsql' AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
 AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3f2236d9f2c1c10a1904dbe82c16f83bf50a940cf3a618953f02667995e4afe1'
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles g ON g.oid=a.grantee
 WHERE a.grantee<>p.proowner AND (g.rolname IS DISTINCT FROM 'nextera_exam_evaluator' OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 AND EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles g ON g.oid=a.grantee
 WHERE g.rolname='nextera_exam_evaluator' AND a.privilege_type='EXECUTE' AND NOT a.is_grantable))
 THEN RAISE EXCEPTION 'EXAM_TRACE_READER_OWNER_ACL_REQUIRED'; END IF;
END $$;
COMMIT;
