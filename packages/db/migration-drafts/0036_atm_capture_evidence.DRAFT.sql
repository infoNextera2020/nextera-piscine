-- SOURCE-ONLY DRAFT. Not registered, applied, connected, or activated here.
-- Requires the reviewed existing native judge + shared-Raid schema/function closure,
-- including the checkpoint_attempt_id column. No minimum rollout or old-byte change is implied.
-- Future authority: direct bootstrap DBA in an explicitly approved fresh target;
-- temporary owner CREATE prerequisites, new objects and the exact EXECUTEs below only.
-- No LOGIN/credential, worker registration, policy seed, mastery/result/mentor change.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_setting('role')<>'none'
 OR current_database() !~ '^foundation_test_[a-z0-9_]+$'
 OR current_setting('nextera.test_migration_span',true) IS DISTINCT FROM 'atm-capture-0036-bootstrap-dba-v1'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper AND rolcanlogin)
 OR NOT pg_has_role(current_user,'nextera_judge_owner','SET')
 OR NOT pg_has_role(current_user,'nextera_raid_owner','SET')
 OR NOT has_schema_privilege('nextera_judge_owner','judge','CREATE')
 OR NOT has_schema_privilege('nextera_raid_owner','app','CREATE')
 OR EXISTS(SELECT FROM pg_roles WHERE rolname IN('nextera_judge_owner','nextera_raid_owner','nextera_runner')
   AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
 OR (SELECT count(*) FROM pg_roles WHERE rolname IN('nextera_judge_owner','nextera_raid_owner','nextera_runner'))<>3
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
   WHERE r.rolname IN('nextera_judge_owner','nextera_raid_owner','nextera_runner'))
 OR to_regprocedure('judge.worker_identity()') IS NULL
 OR to_regprocedure('judge.check_claim(judge.jobs,uuid,uuid,uuid,bigint)') IS NULL
 OR to_regprocedure('judge.snapshot_digest(jsonb)') IS NULL
 OR to_regclass('app.raid_attempts') IS NULL
 OR to_regclass('judge.atm_capture_policies') IS NOT NULL OR to_regclass('judge.atm_capture_evidence') IS NOT NULL
 OR EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
   (n.nspname='judge' AND p.proname IN('atm_evidence_digest','guard_atm_capture_history','atm_capture_policy_valid',
    'resolve_atm_capture_context','atm_capture_payload_valid','reconcile_atm_capture','retain_atm_capture'))
   OR (n.nspname='app' AND p.proname='atm_raid_capture_binding')) THEN
 RAISE EXCEPTION 'ATM_CAPTURE_REVIEWED_PREREQUISITES_REQUIRED'; END IF;
END $$;

CREATE FUNCTION judge.atm_evidence_digest(body jsonb,domain text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(domain,'UTF8')||decode('00','hex')||convert_to('v1','UTF8')||decode('00','hex')||
   convert_to(judge.canonical_json(body),'UTF8')),'hex')
$$;
CREATE FUNCTION judge.guard_atm_capture_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'ATM_CAPTURE_IMMUTABLE' USING ERRCODE='55000'; END $$;

CREATE FUNCTION judge.atm_capture_policy_valid(cases jsonb,limits jsonb,case_count integer) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE c jsonb; i integer:=0; private_seen boolean:=false; v jsonb;
BEGIN
 IF case_count IS NULL OR case_count<1 OR jsonb_typeof(cases) IS DISTINCT FROM 'array'
 OR jsonb_array_length(cases)<>case_count OR octet_length(cases::text)>1048576
 OR jsonb_typeof(limits) IS DISTINCT FROM 'object'
 OR NOT(limits ?& ARRAY['maxPayloadBytes','maxStdinBytes','maxStdoutBytes','maxStderrBytes','maxCaseCount'])
 OR limits-ARRAY['maxPayloadBytes','maxStdinBytes','maxStdoutBytes','maxStderrBytes','maxCaseCount']<>'{}'::jsonb THEN RETURN false; END IF;
 FOR v IN SELECT value FROM jsonb_each(limits) LOOP
  IF jsonb_typeof(v)<>'number' OR v::text !~ '^[1-9][0-9]*$' OR v::text::numeric>2147483647 THEN RETURN false; END IF;
 END LOOP;
 IF case_count>(limits->>'maxCaseCount')::integer THEN RETURN false; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(cases) LOOP
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR NOT(c ?& ARRAY['caseFile','caseIndex','inputSha256'])
  OR c-ARRAY['caseFile','caseIndex','inputSha256']<>'{}'::jsonb
  OR c->>'caseFile' NOT IN('cases/public.json','cases/private.json')
  OR jsonb_typeof(c->'caseFile') IS DISTINCT FROM 'string'
  OR c->'caseIndex' IS DISTINCT FROM to_jsonb(i)
  OR c->>'inputSha256' !~ '^[0-9a-f]{64}$' OR jsonb_typeof(c->'inputSha256')<>'string'
  OR (private_seen AND c->>'caseFile'='cases/public.json') THEN RETURN false; END IF;
  private_seen:=private_seen OR c->>'caseFile'='cases/private.json'; i:=i+1;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE TABLE judge.atm_capture_policies (
 evaluation_spec_digest text NOT NULL CHECK(evaluation_spec_digest ~ '^[0-9a-f]{64}$'),
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 test_pack_id text NOT NULL CHECK(test_pack_id ~ '^[a-z][a-z0-9-]{0,99}$'),
 test_pack_digest text NOT NULL CHECK(test_pack_digest ~ '^[0-9a-f]{64}$'),
 semantic_profile_digest text NOT NULL CHECK(semantic_profile_digest='f09da2b66999409f6dc08ea8f54ef5c34ac259d48cccf5b1d66ecb63ad4c1007'),
 runner_image_digest text NOT NULL CHECK(runner_image_digest ~ '^sha256:[0-9a-f]{64}$'),
 resource_policy_digest text NOT NULL CHECK(resource_policy_digest ~ '^[0-9a-f]{64}$'),
 model_id text NOT NULL CHECK(model_id='atm-independent-model-v1'),
 case_count integer NOT NULL, cases jsonb NOT NULL, limits jsonb NOT NULL,
 registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(evaluation_spec_digest,definition_digest),
 CHECK(judge.atm_capture_policy_valid(cases,limits,case_count))
);
CREATE TABLE judge.atm_capture_evidence (
 operation_id uuid PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES judge.jobs(id), judge_attempt_id uuid NOT NULL,
 worker_id uuid NOT NULL, generation bigint NOT NULL,
 submission_id uuid NOT NULL REFERENCES app.submissions(id),
 raid_attempt_id uuid NOT NULL REFERENCES app.raid_attempts(id),
 context jsonb NOT NULL, context_digest text NOT NULL CHECK(context_digest ~ '^[0-9a-f]{64}$'),
 capture_digest text NOT NULL CHECK(capture_digest ~ '^[0-9a-f]{64}$'),
 payload_bytes bytea NOT NULL CHECK(octet_length(payload_bytes)>0),
 retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(job_id,judge_attempt_id,worker_id,generation),
 FOREIGN KEY(judge_attempt_id,job_id,worker_id,generation)
  REFERENCES judge.attempts(id,job_id,worker_id,lease_generation)
);
ALTER TABLE judge.atm_capture_policies OWNER TO nextera_judge_owner;
ALTER TABLE judge.atm_capture_evidence OWNER TO nextera_judge_owner;
ALTER TABLE judge.atm_capture_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE judge.atm_capture_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE judge.atm_capture_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE judge.atm_capture_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY atm_policy_owner ON judge.atm_capture_policies TO nextera_judge_owner USING(true) WITH CHECK(true);
CREATE POLICY atm_capture_owner ON judge.atm_capture_evidence TO nextera_judge_owner USING(true) WITH CHECK(true);
REVOKE ALL ON judge.atm_capture_policies,judge.atm_capture_evidence FROM PUBLIC,nextera_web,nextera_runner,nextera_raid_owner;
CREATE TRIGGER immutable_atm_capture_policy BEFORE UPDATE OR DELETE ON judge.atm_capture_policies
 FOR EACH ROW EXECUTE FUNCTION judge.guard_atm_capture_history();
CREATE TRIGGER immutable_atm_capture_evidence BEFORE UPDATE OR DELETE ON judge.atm_capture_evidence
 FOR EACH ROW EXECUTE FUNCTION judge.guard_atm_capture_history();

-- Private existing-owner bridge: no broad Raid-table grant to the worker/judge owner.
CREATE FUNCTION app.atm_raid_capture_binding(job uuid,submission uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s app.submissions; ra app.raid_attempts; t app.raid_teams; n app.curriculum_nodes;
 c app.cohorts; v app.curriculum_versions; a app.submission_artifacts; j judge.jobs;
BEGIN
 SELECT * INTO j FROM judge.jobs WHERE id=job;
 SELECT * INTO s FROM app.submissions WHERE id=submission;
 SELECT * INTO ra FROM app.raid_attempts WHERE submission_id=s.id;
 SELECT * INTO t FROM app.raid_teams WHERE id=ra.team_id;
 SELECT * INTO c FROM app.cohorts WHERE id=s.cohort_id;
 SELECT * INTO v FROM app.curriculum_versions WHERE id=s.curriculum_version_id;
 SELECT * INTO n FROM app.curriculum_nodes WHERE curriculum_version_id=s.curriculum_version_id AND node_key=s.node_key;
 SELECT * INTO a FROM app.submission_artifacts WHERE id=s.artifact_id;
 PERFORM id FROM app.users WHERE id IN(SELECT user_id FROM app.raid_attempt_members WHERE attempt_id=ra.id)
  OR id=t.mentor_user_id ORDER BY id FOR SHARE;
 PERFORM joined_at FROM app.cohort_memberships WHERE cohort_id=c.id AND
  (user_id IN(SELECT user_id FROM app.raid_attempt_members WHERE attempt_id=ra.id) OR user_id=t.mentor_user_id)
  ORDER BY user_id FOR SHARE;
 -- Access-removal triggers lock the access row before deactivating the team.
 -- Take those access locks first, then re-read the mutable cohort/team/submission.
 SELECT * INTO c FROM app.cohorts WHERE id=s.cohort_id FOR SHARE;
 SELECT * INTO t FROM app.raid_teams WHERE id=ra.team_id FOR SHARE;
 SELECT * INTO s FROM app.submissions WHERE id=submission FOR SHARE;
 IF j.id IS NULL OR s.id IS NULL OR ra.id IS NULL OR t.id IS NULL OR n.node_key IS NULL OR a.id IS NULL
 OR j.submission_id IS DISTINCT FROM s.id OR s.active_judge_job_id IS DISTINCT FROM j.id
 OR s.checkpoint_attempt_id IS NOT NULL OR n.kind<>'project' OR NOT t.active
 OR t.cohort_id IS DISTINCT FROM s.cohort_id OR t.curriculum_version_id IS DISTINCT FROM s.curriculum_version_id
 OR t.node_key IS DISTINCT FROM s.node_key OR c.curriculum_version_id IS DISTINCT FROM s.curriculum_version_id
 OR c.status<>'active' OR v.status<>'published' OR n.subject_digest IS DISTINCT FROM ra.definition_digest
 OR n.evaluation_spec_digest IS DISTINCT FROM s.evaluation_spec_digest
 OR ra.ordinal<>(SELECT max(ordinal) FROM app.raid_attempts WHERE team_id=t.id)
 OR EXISTS(SELECT FROM app.raid_owner_holds WHERE attempt_id=ra.id)
 OR EXISTS(SELECT FROM app.raid_outcomes WHERE attempt_id=ra.id)
 OR (SELECT count(*) FROM app.raid_attempt_members m JOIN app.users u ON u.id=m.user_id
   JOIN app.cohort_memberships cm ON cm.user_id=u.id AND cm.cohort_id=c.id
   WHERE m.attempt_id=ra.id AND m.cohort_id=c.id AND m.curriculum_version_id=s.curriculum_version_id
   AND m.node_key=s.node_key AND u.active AND u.role='learner' AND cm.status='active')<>3
 OR NOT EXISTS(SELECT FROM app.raid_attempt_members WHERE attempt_id=ra.id AND user_id=s.user_id)
 OR EXISTS((SELECT user_id FROM app.raid_attempt_members WHERE attempt_id=ra.id) EXCEPT
   (SELECT user_id FROM app.raid_team_members WHERE team_id=t.id))
 OR EXISTS((SELECT user_id FROM app.raid_team_members WHERE team_id=t.id) EXCEPT
   (SELECT user_id FROM app.raid_attempt_members WHERE attempt_id=ra.id))
 OR NOT EXISTS(SELECT FROM app.users u JOIN app.cohort_memberships cm ON cm.user_id=u.id AND cm.cohort_id=c.id
   WHERE u.id=t.mentor_user_id AND u.active AND u.role IN('operator','admin') AND cm.status='active')
 OR a.owner_user_id IS DISTINCT FROM s.user_id OR a.storage_bucket<>'nextera-submissions'
 OR a.storage_key IS DISTINCT FROM (SELECT auth_user_id::text FROM app.users WHERE id=s.user_id)||'/'||s.cohort_id::text||'/'||s.idempotency_key||'/'||a.sha256
 OR j.evaluation_snapshot->>'submission_id' IS DISTINCT FROM s.id::text
 OR j.evaluation_snapshot->>'learner_id' IS DISTINCT FROM s.user_id::text
 OR j.evaluation_snapshot->>'cohort_id' IS DISTINCT FROM s.cohort_id::text
 OR j.evaluation_snapshot->>'curriculum_version_id' IS DISTINCT FROM s.curriculum_version_id::text
 OR j.evaluation_snapshot->>'node_key' IS DISTINCT FROM s.node_key
 OR j.evaluation_snapshot->>'evaluation_spec_digest' IS DISTINCT FROM s.evaluation_spec_digest
 OR j.evaluation_snapshot->>'git_commit_sha' IS DISTINCT FROM v.git_commit_sha
 OR j.evaluation_snapshot->>'subject_digest' IS DISTINCT FROM ra.definition_digest
 OR j.evaluation_snapshot->>'accepted_at' IS DISTINCT FROM to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 OR j.evaluation_snapshot->'artifact' IS DISTINCT FROM jsonb_build_object('id',a.id,'bucket',a.storage_bucket,
   'key',a.storage_key,'filename',a.original_filename,'size_bytes',a.size_bytes,'sha256',a.sha256)
 OR (j.evaluation_snapshot-ARRAY['curriculum_version_id','git_commit_sha','evaluation_spec_digest','learner_id',
   'cohort_id','submission_id','learner_attempt_ordinal','accepted_at','artifact']) IS DISTINCT FROM n.resolved_evaluation_spec
 THEN RAISE EXCEPTION 'ATM_CAPTURE_BINDING_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('raidAttemptId',ra.id,'teamId',t.id,'cohortId',c.id,'curriculumVersionId',v.id,
  'nodeKey',n.node_key,'definitionDigest',ra.definition_digest,'sourceSha256',a.sha256);
END $$;

CREATE FUNCTION judge.resolve_atm_capture_context(job uuid,attempt uuid,worker uuid,generation bigint,
 submission uuid,snapshot_digest text,token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w judge.workers; j judge.jobs; a judge.attempts; b jsonb; p judge.atm_capture_policies;
 s jsonb; contract jsonb; resource jsonb; body jsonb;
BEGIN
 IF job IS NULL OR attempt IS NULL OR worker IS NULL OR generation IS NULL OR generation<1
 OR submission IS NULL OR token IS NULL OR snapshot_digest IS NULL OR snapshot_digest !~ '^[0-9a-f]{64}$'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND rolinherit
   AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 OR NOT pg_has_role(session_user,'nextera_runner','USAGE')
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
   WHERE r.rolname=session_user AND (m.roleid<>'nextera_runner'::regrole OR m.admin_option)) THEN
 RAISE EXCEPTION 'ATM_CAPTURE_WORKER_UNAUTHORIZED' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM judge.workers WHERE id=judge.worker_identity() FOR SHARE;
 SELECT * INTO j FROM judge.jobs WHERE id=job FOR UPDATE;
 IF w.id IS DISTINCT FROM worker THEN RAISE EXCEPTION 'ATM_CAPTURE_WORKER_UNAUTHORIZED' USING ERRCODE='42501'; END IF;
 PERFORM judge.check_claim(j,w.id,attempt,token,generation);
 SELECT * INTO a FROM judge.attempts WHERE id=attempt AND job_id=job;
 IF a.worker_id IS DISTINCT FROM worker OR a.claim_token IS DISTINCT FROM token OR a.lease_generation IS DISTINCT FROM generation
 OR j.submission_id IS DISTINCT FROM submission OR j.evaluation_digest IS DISTINCT FROM snapshot_digest
 OR j.evaluation_digest IS DISTINCT FROM judge.snapshot_digest(j.evaluation_snapshot)
 OR a.state NOT IN('claimed','running') THEN RAISE EXCEPTION 'ATM_CAPTURE_CLAIM_LOST' USING ERRCODE='55000'; END IF;
 b:=app.atm_raid_capture_binding(job,submission); s:=j.evaluation_snapshot; contract:=s->'execution_contract';
 SELECT * INTO p FROM judge.atm_capture_policies WHERE evaluation_spec_digest=s->>'evaluation_spec_digest'
   AND definition_digest=b->>'definitionDigest';
 IF p.evaluation_spec_digest IS NULL OR jsonb_typeof(contract) IS DISTINCT FROM 'object'
 OR contract IS DISTINCT FROM jsonb_build_object('version',4,'item_key',b->>'nodeKey','learner_file','main.go',
   'function','','input_type','stdin_utf8','output_type','atm_report_events_v1')
 OR s->>'semantic_profile_digest' IS DISTINCT FROM p.semantic_profile_digest
 OR s->>'test_pack_id' IS DISTINCT FROM p.test_pack_id OR s->>'test_pack_digest' IS DISTINCT FROM p.test_pack_digest
 OR s->>'runner_image_digest' IS DISTINCT FROM p.runner_image_digest
 OR jsonb_typeof(s->'test_pack_artifact') IS DISTINCT FROM 'string'
 OR s->>'test_pack_artifact' !~ '^[^[:space:]@]+@sha256:[0-9a-f]{64}$'
 OR s ? 'test_only'
 OR judge.atm_evidence_digest(s-ARRAY['curriculum_version_id','git_commit_sha','evaluation_spec_digest','learner_id',
   'cohort_id','submission_id','learner_attempt_ordinal','accepted_at','artifact'],'nextera-evaluation-spec') IS DISTINCT FROM s->>'evaluation_spec_digest'
 OR s->>'runner_image_digest' IS DISTINCT FROM w.runner_image_digest
 OR s->>'target_platform' IS DISTINCT FROM w.platform OR s->>'toolchain_version' IS DISTINCT FROM w.capabilities->>'toolchain_version'
 OR s->>'resource_profile' IS DISTINCT FROM w.capabilities->>'resource_profile'
 OR s->>'snapshot_format_version' IS DISTINCT FROM w.capabilities->>'snapshot_format_version'
 OR s->>'sandbox_image_digest' IS DISTINCT FROM w.capabilities->>'sandbox_image_digest'
 OR NOT(j.protocol_version=ANY(w.protocol_versions))
 OR (w.capabilities ? 'fixture_cohort_ids' AND NOT(w.capabilities->'fixture_cohort_ids' ? (s->>'cohort_id')))
 OR s->'case_generation' IS DISTINCT FROM '{"mode":"static"}'::jsonb
 OR NOT(s ?& ARRAY['sandbox_image_digest','toolchain_version','target_platform','build_flags','dependency_policy',
   'resource_profile','resource_limits','protocol_version','snapshot_format_version','case_generation'])
 THEN RAISE EXCEPTION 'ATM_CAPTURE_POLICY_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 resource:=jsonb_build_object('sandbox_image_digest',s->'sandbox_image_digest','toolchain_version',s->'toolchain_version',
  'target_platform',s->'target_platform','build_flags',s->'build_flags','dependency_policy',s->'dependency_policy',
  'resource_profile',s->'resource_profile','resource_limits',s->'resource_limits','protocol_version',s->'protocol_version',
  'snapshot_format_version',s->'snapshot_format_version','case_generation',s->'case_generation');
 IF judge.atm_evidence_digest(resource,'nextera-atm-resource-policy') IS DISTINCT FROM p.resource_policy_digest THEN
 RAISE EXCEPTION 'ATM_CAPTURE_RESOURCE_MISMATCH' USING ERRCODE='42501'; END IF;
 body:=b||jsonb_build_object('version',1,'jobId',job,'judgeAttemptId',attempt,'workerId',worker,'generation',generation::text,
  'submissionId',submission,'evaluationSnapshotDigest',j.evaluation_digest,'evaluationSpecDigest',p.evaluation_spec_digest,
  'testPackId',p.test_pack_id,'testPackDigest',p.test_pack_digest,'semanticProfileDigest',p.semantic_profile_digest,
  'runnerImageDigest',p.runner_image_digest,'resourcePolicyDigest',p.resource_policy_digest,'modelId',p.model_id,'caseCount',p.case_count);
 PERFORM judge.check_claim(j,w.id,attempt,token,generation);
 RETURN body||jsonb_build_object('contextDigest',judge.atm_evidence_digest(body,'nextera-atm-capture-context'));
END $$;

CREATE FUNCTION judge.atm_capture_payload_valid(captures jsonb,p judge.atm_capture_policies) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE c jsonb; expected jsonb; i integer:=0; input bytea; output bytea; error_bytes bytea; key text; raw text; bound integer;
BEGIN
 IF jsonb_typeof(captures) IS DISTINCT FROM 'array' OR jsonb_array_length(captures)>p.case_count THEN RETURN false; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(captures) LOOP
  expected:=p.cases->i;
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR NOT(c ?& ARRAY['caseFile','caseIndex','inputSha256','stdinBase64','stdoutBase64','stderrBase64',
    'exitCode','transportWriteComplete','stdinHalfClosed','outputComplete','termination','assessment'])
  OR c-ARRAY['caseFile','caseIndex','inputSha256','stdinBase64','stdoutBase64','stderrBase64','exitCode','transportWriteComplete',
    'stdinHalfClosed','outputComplete','termination','assessment']<>'{}'::jsonb
  OR c->'caseIndex' IS DISTINCT FROM to_jsonb(i) OR c->'caseFile' IS DISTINCT FROM expected->'caseFile'
  OR c->'inputSha256' IS DISTINCT FROM expected->'inputSha256' THEN RETURN false; END IF;
  FOREACH key IN ARRAY ARRAY['stdinBase64','stdoutBase64','stderrBase64'] LOOP
   IF jsonb_typeof(c->key) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
   raw:=c->>key;
   IF raw !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' THEN RETURN false; END IF;
   input:=decode(raw,'base64');
   bound:=(p.limits->>CASE key WHEN 'stdinBase64' THEN 'maxStdinBytes' WHEN 'stdoutBase64' THEN 'maxStdoutBytes' ELSE 'maxStderrBytes' END)::integer;
   IF octet_length(input)>bound OR replace(encode(input,'base64'),E'\n','')<>raw THEN RETURN false; END IF;
   IF key='stdinBase64' AND encode(sha256(input),'hex') IS DISTINCT FROM c->>'inputSha256' THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(c->'transportWriteComplete') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(c->'stdinHalfClosed') IS DISTINCT FROM 'boolean' OR jsonb_typeof(c->'outputComplete') IS DISTINCT FROM 'boolean'
  OR c->>'termination' NOT IN('exited','timed_out','unknown')
  OR c->>'assessment' NOT IN('observations_match','projection_mismatch','execution_not_clean','incomplete_observation','capture_unavailable')
  OR jsonb_typeof(c->'termination') IS DISTINCT FROM 'string' OR jsonb_typeof(c->'assessment') IS DISTINCT FROM 'string'
  OR (c->>'termination'='exited' AND (jsonb_typeof(c->'exitCode') IS DISTINCT FROM 'number'
    OR c->>'exitCode' !~ '^(0|[1-9][0-9]*)$' OR (c->>'exitCode')::numeric>255))
  OR (c->>'termination'<>'exited' AND c->'exitCode' IS DISTINCT FROM 'null'::jsonb)
  OR (c->'outputComplete'='true'::jsonb AND c->>'termination'<>'exited')
  OR (c->>'assessment' IN('observations_match','projection_mismatch') AND
    (c->'transportWriteComplete'<>'true'::jsonb OR c->'stdinHalfClosed'<>'true'::jsonb OR
     c->'outputComplete'<>'true'::jsonb OR c->>'termination'<>'exited' OR c->'exitCode'<>'0'::jsonb)) THEN RETURN false; END IF;
  i:=i+1;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION judge.reconcile_atm_capture(job uuid,attempt uuid,worker uuid,generation bigint,
 operation uuid,context jsonb,capture_digest text,token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual jsonb; r judge.atm_capture_evidence; payload jsonb; p judge.atm_capture_policies;
BEGIN
 actual:=judge.resolve_atm_capture_context(job,attempt,worker,generation,(context->>'submissionId')::uuid,
  context->>'evaluationSnapshotDigest',token);
 IF operation IS NULL OR actual IS DISTINCT FROM context OR capture_digest IS NULL OR capture_digest !~ '^[0-9a-f]{64}$' THEN
 RAISE EXCEPTION 'ATM_CAPTURE_CONFLICT' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(operation::text,36));
 -- Revalidate after waiting; a previously valid claim cannot authorize a late replay/readback.
 IF judge.resolve_atm_capture_context(job,attempt,worker,generation,(context->>'submissionId')::uuid,
   context->>'evaluationSnapshotDigest',token) IS DISTINCT FROM actual THEN RAISE EXCEPTION 'ATM_CAPTURE_CLAIM_LOST'; END IF;
 SELECT * INTO r FROM judge.atm_capture_evidence WHERE operation_id=operation;
 IF FOUND THEN
  SELECT * INTO p FROM judge.atm_capture_policies WHERE evaluation_spec_digest=context->>'evaluationSpecDigest'
    AND definition_digest=context->>'definitionDigest';
  payload:=convert_from(r.payload_bytes,'UTF8')::jsonb;
  IF r.worker_id IS DISTINCT FROM worker OR r.job_id IS DISTINCT FROM job OR r.judge_attempt_id IS DISTINCT FROM attempt
  OR r.generation IS DISTINCT FROM generation OR r.context IS DISTINCT FROM actual
  OR r.context_digest IS DISTINCT FROM actual->>'contextDigest' OR r.capture_digest IS DISTINCT FROM capture_digest
  OR r.submission_id IS DISTINCT FROM (actual->>'submissionId')::uuid OR r.raid_attempt_id IS DISTINCT FROM (actual->>'raidAttemptId')::uuid
  OR payload-ARRAY['version','context','captures']<>'{}'::jsonb OR payload->'version' IS DISTINCT FROM '1'::jsonb
  OR payload->'context' IS DISTINCT FROM actual OR NOT judge.atm_capture_payload_valid(payload->'captures',p)
  OR octet_length(r.payload_bytes)>(p.limits->>'maxPayloadBytes')::integer
  OR r.payload_bytes IS DISTINCT FROM convert_to(judge.canonical_json(payload),'UTF8')
  OR judge.atm_evidence_digest(payload,'nextera-atm-capture') IS DISTINCT FROM capture_digest THEN
  RAISE EXCEPTION 'ATM_CAPTURE_CONFLICT' USING ERRCODE='22023'; END IF;
  IF judge.resolve_atm_capture_context(job,attempt,worker,generation,(context->>'submissionId')::uuid,
   context->>'evaluationSnapshotDigest',token) IS DISTINCT FROM actual THEN RAISE EXCEPTION 'ATM_CAPTURE_CLAIM_LOST'; END IF;
  RETURN jsonb_build_object('version',1,'operationId',operation,'contextDigest',actual->>'contextDigest','captureDigest',capture_digest,'state','retained');
 END IF;
 RETURN jsonb_build_object('version',1,'operationId',operation,'contextDigest',actual->>'contextDigest','captureDigest',capture_digest,'state','not_retained');
END $$;

CREATE FUNCTION judge.retain_atm_capture(job uuid,attempt uuid,worker uuid,generation bigint,
 operation uuid,context jsonb,capture_digest text,captures jsonb,token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual jsonb; receipt jsonb; p judge.atm_capture_policies; payload jsonb; bytes bytea; old judge.atm_capture_evidence;
BEGIN
 -- Reconcile performs fresh current native worker/claim/access/deadline proof BEFORE any replay lookup.
 receipt:=judge.reconcile_atm_capture(job,attempt,worker,generation,operation,context,capture_digest,token);
 actual:=context;
 SELECT * INTO p FROM judge.atm_capture_policies WHERE evaluation_spec_digest=actual->>'evaluationSpecDigest'
  AND definition_digest=actual->>'definitionDigest';
 IF NOT judge.atm_capture_payload_valid(captures,p) THEN RAISE EXCEPTION 'ATM_CAPTURE_INVALID' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_object('version',1,'context',actual,'captures',captures);
 bytes:=convert_to(judge.canonical_json(payload),'UTF8');
 IF octet_length(bytes)>(p.limits->>'maxPayloadBytes')::integer
 OR judge.atm_evidence_digest(payload,'nextera-atm-capture') IS DISTINCT FROM capture_digest THEN
 RAISE EXCEPTION 'ATM_CAPTURE_INVALID' USING ERRCODE='22023'; END IF;
 IF receipt->>'state'='retained' THEN
  SELECT * INTO old FROM judge.atm_capture_evidence WHERE operation_id=operation;
  IF old.payload_bytes IS DISTINCT FROM bytes THEN RAISE EXCEPTION 'ATM_CAPTURE_CONFLICT' USING ERRCODE='22023'; END IF;
  IF judge.resolve_atm_capture_context(job,attempt,worker,generation,(actual->>'submissionId')::uuid,
   actual->>'evaluationSnapshotDigest',token) IS DISTINCT FROM actual THEN RAISE EXCEPTION 'ATM_CAPTURE_CLAIM_LOST'; END IF;
  RETURN receipt;
 END IF;
 IF judge.resolve_atm_capture_context(job,attempt,worker,generation,(actual->>'submissionId')::uuid,
   actual->>'evaluationSnapshotDigest',token) IS DISTINCT FROM actual THEN RAISE EXCEPTION 'ATM_CAPTURE_CLAIM_LOST'; END IF;
 -- Force normal durable WAL acknowledgement for this transaction; no storage fallback.
 PERFORM set_config('synchronous_commit','on',true);
 INSERT INTO judge.atm_capture_evidence(operation_id,job_id,judge_attempt_id,worker_id,generation,submission_id,raid_attempt_id,
  context,context_digest,capture_digest,payload_bytes)
 VALUES(operation,job,attempt,worker,generation,(actual->>'submissionId')::uuid,(actual->>'raidAttemptId')::uuid,
  actual,actual->>'contextDigest',capture_digest,bytes);
 -- Actual durable private bytes are read back and validated inside this same atomic statement.
 receipt:=judge.reconcile_atm_capture(job,attempt,worker,generation,operation,actual,capture_digest,token);
 IF receipt->>'state'<>'retained' THEN RAISE EXCEPTION 'ATM_CAPTURE_READBACK_UNAVAILABLE'; END IF;
 RETURN receipt;
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='judge' AND p.proname IN('atm_evidence_digest','guard_atm_capture_history','atm_capture_policy_valid',
  'resolve_atm_capture_context','atm_capture_payload_valid','reconcile_atm_capture','retain_atm_capture') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,nextera_web,nextera_runner,nextera_raid_owner',f.signature);
  EXECUTE format('ALTER FUNCTION %s OWNER TO nextera_judge_owner',f.signature);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.atm_raid_capture_binding(uuid,uuid) FROM PUBLIC,nextera_web,nextera_runner;
ALTER FUNCTION app.atm_raid_capture_binding(uuid,uuid) OWNER TO nextera_raid_owner;
GRANT EXECUTE ON FUNCTION app.atm_raid_capture_binding(uuid,uuid) TO nextera_judge_owner;
GRANT EXECUTE ON FUNCTION judge.resolve_atm_capture_context(uuid,uuid,uuid,bigint,uuid,text,uuid),
 judge.reconcile_atm_capture(uuid,uuid,uuid,bigint,uuid,jsonb,text,uuid),
 judge.retain_atm_capture(uuid,uuid,uuid,bigint,uuid,jsonb,text,jsonb,uuid) TO nextera_runner;
DO $$ DECLARE f record; BEGIN
 IF has_table_privilege('nextera_runner','judge.atm_capture_evidence','SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege('nextera_web','judge.atm_capture_evidence','SELECT,INSERT,UPDATE,DELETE')
 OR NOT has_function_privilege('nextera_runner','judge.retain_atm_capture(uuid,uuid,uuid,bigint,uuid,jsonb,text,jsonb,uuid)','EXECUTE')
 OR has_function_privilege('nextera_web','judge.retain_atm_capture(uuid,uuid,uuid,bigint,uuid,jsonb,text,jsonb,uuid)','EXECUTE')
 OR NOT EXISTS(SELECT FROM pg_class WHERE oid='judge.atm_capture_evidence'::regclass AND relrowsecurity AND relforcerowsecurity) THEN
 RAISE EXCEPTION 'ATM_CAPTURE_ACL_READBACK_FAILED'; END IF;
 FOR f IN SELECT p.oid,p.proowner,p.proname,n.nspname,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='judge' AND p.proname IN('atm_evidence_digest','guard_atm_capture_history','atm_capture_policy_valid',
  'resolve_atm_capture_context','atm_capture_payload_valid','reconcile_atm_capture','retain_atm_capture'))
 OR (n.nspname='app' AND p.proname='atm_raid_capture_binding') LOOP
  IF f.proowner<>CASE WHEN f.nspname='app' THEN 'nextera_raid_owner'::regrole ELSE 'nextera_judge_owner'::regrole END
  OR EXISTS(SELECT FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE
   a.grantee<>f.proowner AND NOT(a.privilege_type='EXECUTE' AND NOT a.is_grantable AND
    ((f.nspname='app' AND a.grantee='nextera_judge_owner'::regrole) OR
     (f.proname IN('resolve_atm_capture_context','reconcile_atm_capture','retain_atm_capture') AND a.grantee='nextera_runner'::regrole)))) THEN
  RAISE EXCEPTION 'ATM_CAPTURE_FUNCTION_ACL_READBACK_FAILED'; END IF;
 END LOOP;
 IF EXISTS(SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 WHERE c.oid IN('judge.atm_capture_policies'::regclass,'judge.atm_capture_evidence'::regclass)
 AND (c.relowner<>'nextera_judge_owner'::regrole OR a.grantee<>c.relowner)) THEN
 RAISE EXCEPTION 'ATM_CAPTURE_PRIVATE_TABLE_ACL_READBACK_FAILED'; END IF;
END $$;
COMMIT;
