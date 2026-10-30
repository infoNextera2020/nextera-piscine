-- REVIEW DRAFT ONLY. Not in migration journal; no SQL is applied by this file being present.
-- Read-only metadata for an existing frozen attempt. No draft/Run capability, roles or records.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_checkpoint_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_checkpoint_owner')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_web')
 OR NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET') THEN
 RAISE EXCEPTION 'Approved isolated checkpoint migration context required'; END IF;
 IF to_regprocedure('app.checkpoint_editor_context(uuid,uuid,text)') IS NOT NULL THEN
 RAISE EXCEPTION 'Checkpoint editor context already exists; review migration state'; END IF;
END $$;

CREATE FUNCTION app.checkpoint_editor_context(auth_id uuid,attempt uuid,task text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.checkpoint_attempts; u uuid; item jsonb; at_time timestamptz;
 rules jsonb; kb numeric; filename text; reserved bigint; passed boolean;
BEGIN
 IF attempt IS NULL OR task IS NULL OR task !~ '^[a-z0-9-]{1,100}$' THEN
 RAISE EXCEPTION 'Checkpoint editor forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM app.checkpoint_attempts WHERE id=attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'Checkpoint editor forbidden' USING ERRCODE='42501'; END IF;
 u:=app.checkpoint_user(auth_id,a.cohort_id);
 IF u IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Checkpoint editor forbidden' USING ERRCODE='42501'; END IF;
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

-- Finalize ACLs while the migration actor still owns these NEW objects.
-- SET-only membership permits transfer, not inherited ACL administration afterward.
REVOKE ALL ON FUNCTION app.checkpoint_editor_context(uuid,uuid,text) FROM PUBLIC;
DO $$ DECLARE entry record; BEGIN
 FOR entry IN SELECT DISTINCT r.rolname FROM pg_proc p
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 JOIN pg_roles r ON r.oid=a.grantee
 WHERE p.oid='app.checkpoint_editor_context(uuid,uuid,text)'::regprocedure AND a.grantee<>p.proowner LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION app.checkpoint_editor_context(uuid,uuid,text) FROM %I',entry.rolname);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.checkpoint_editor_context(uuid,uuid,text) TO nextera_web;

-- Same existing owner and narrow web EXECUTE convention as0007; no new role or broad grant.
GRANT CREATE ON SCHEMA app TO nextera_checkpoint_owner;
ALTER FUNCTION app.checkpoint_editor_context(uuid,uuid,text) OWNER TO nextera_checkpoint_owner;
REVOKE CREATE ON SCHEMA app FROM nextera_checkpoint_owner;
COMMIT;
