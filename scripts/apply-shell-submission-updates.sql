CREATE OR REPLACE FUNCTION app.submission_context(auth_id uuid,cohort uuid,node text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;
BEGIN
 SELECT jsonb_build_object('user_id',u.id,'rules',n.submission_rules,'kind',n.kind) INTO ctx
 FROM app.users u JOIN app.cohort_memberships m ON m.user_id=u.id AND m.cohort_id=cohort
 JOIN app.cohorts c ON c.id=m.cohort_id JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id
 JOIN app.curriculum_nodes n ON n.curriculum_version_id=v.id AND n.node_key=node
 JOIN app.learner_node_progress p ON p.cohort_id=c.id AND p.user_id=u.id AND p.curriculum_version_id=v.id AND p.node_key=n.node_key
 WHERE u.auth_user_id=auth_id AND u.active AND u.role='learner' AND m.status='active' AND c.status='active'
 AND v.status='published' AND p.state IN ('available','in_progress','mastered') AND n.kind IN ('challenge','project')
 AND (
   NOT (n.submission_rules->'allowed_extensions' ? '.go') OR
   (NOT coalesce((n.resolved_evaluation_spec->>'test_only')::boolean,false)
     AND n.resolved_evaluation_spec->>'test_pack_artifact' ~ '^oci://[^/].+@sha256:[0-9a-f]{64}$')
   OR (current_database() LIKE 'foundation_test%' AND v.curriculum_key LIKE 'foundation-test-only-%'
     AND n.resolved_evaluation_spec->>'test_only'='true'
     AND n.resolved_evaluation_spec->>'test_pack_artifact' ~ '^oci:///[^@]+@sha256:[0-9a-f]{64}$')
 );
 IF ctx IS NULL THEN RAISE EXCEPTION 'SUBMISSION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN ctx;
END $$;

CREATE OR REPLACE FUNCTION app.accept_submission(auth_id uuid,cohort uuid,node text,request_id uuid,filename text,bytes bigint,content_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; u uuid; c app.cohorts; v app.curriculum_versions; n app.curriculum_nodes;
 old app.submissions; art app.submission_artifacts; sid uuid:=gen_random_uuid(); jid uuid:=gen_random_uuid();
 snapshot jsonb; at_time timestamptz; ordinal bigint; object_key text;
BEGIN
 ctx:=app.submission_context(auth_id,cohort,node); u:=(ctx->>'user_id')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended(cohort::text||u::text,4));
 PERFORM 1 FROM app.users WHERE id=u AND active AND role='learner' FOR SHARE;
 PERFORM 1 FROM app.cohort_memberships WHERE cohort_id=cohort AND user_id=u AND status='active' FOR SHARE;
 SELECT * INTO c FROM app.cohorts WHERE id=cohort FOR SHARE;
 ctx:=app.submission_context(auth_id,cohort,node);
 SELECT * INTO v FROM app.curriculum_versions WHERE id=c.curriculum_version_id;
 SELECT * INTO n FROM app.curriculum_nodes WHERE curriculum_version_id=v.id AND node_key=node;
 IF bytes NOT BETWEEN 1 AND 262144 OR content_hash !~ '^[0-9a-f]{64}$'
 OR filename !~ '^[A-Za-z0-9_][A-Za-z0-9_.-]*$'
 OR jsonb_array_length(n.submission_rules->'required_files')<>1
 OR n.submission_rules->'required_files'->>0<>filename
 OR bytes>(n.submission_rules->>'max_size_kb')::bigint*1024 THEN
 RAISE EXCEPTION 'INVALID_ARTIFACT' USING ERRCODE='22023'; END IF;

 IF n.submission_rules ? 'allowed_extensions' AND jsonb_array_length(n.submission_rules->'allowed_extensions') > 0 THEN
   IF NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements_text(n.submission_rules->'allowed_extensions') ext
     WHERE (ext = '' AND filename !~ '[.]')
        OR (ext <> '' AND filename LIKE '%' || ext)
   ) THEN
     RAISE EXCEPTION 'INVALID_ARTIFACT' USING ERRCODE='22023';
   END IF;
 END IF;

 SELECT * INTO old FROM app.submissions WHERE cohort_id=cohort AND user_id=u AND idempotency_key=request_id::text;
 IF FOUND THEN
   SELECT * INTO art FROM app.submission_artifacts WHERE id=old.artifact_id;
   IF old.node_key<>node OR art.sha256<>content_hash OR art.size_bytes<>bytes OR art.original_filename<>filename THEN
     RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023';
   END IF;
   RETURN old.id;
 END IF;
 object_key:=auth_id::text||'/'||cohort::text||'/'||request_id::text||'/'||content_hash;
 INSERT INTO app.submission_artifacts(owner_user_id,storage_bucket,storage_key,original_filename,size_bytes,sha256)
 VALUES(u,'nextera-submissions',object_key,filename,bytes,content_hash) RETURNING * INTO art;
 SELECT count(*)+1 INTO ordinal FROM app.submissions WHERE cohort_id=cohort AND user_id=u AND node_key=node;
 at_time:=clock_timestamp();

 IF (n.submission_rules->'allowed_extensions' ? '.go') THEN
   snapshot:=n.resolved_evaluation_spec||jsonb_build_object('curriculum_version_id',v.id,'git_commit_sha',v.git_commit_sha,
     'evaluation_spec_digest',n.evaluation_spec_digest,'learner_id',u,'cohort_id',cohort,
     'submission_id',sid,'learner_attempt_ordinal',ordinal,'accepted_at',to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'artifact',jsonb_build_object('id',art.id,'bucket',art.storage_bucket,'key',art.storage_key,'filename',filename,'size_bytes',bytes,'sha256',content_hash));
   INSERT INTO app.submissions(id,cohort_id,user_id,curriculum_version_id,node_key,artifact_id,idempotency_key,evaluation_spec_digest,active_judge_job_id,created_at)
   VALUES(sid,cohort,u,v.id,node,art.id,request_id::text,n.evaluation_spec_digest,jid,at_time);
   INSERT INTO judge.jobs(id,submission_id,protocol_version,evaluation_snapshot,evaluation_digest,created_at)
   VALUES(jid,sid,(snapshot->>'protocol_version')::integer,snapshot,judge.snapshot_digest(snapshot),at_time);
   PERFORM judge.audit(sid,jid,NULL,NULL,'submission',NULL,'queued',NULL,'submission_accepted');
   PERFORM judge.audit(sid,jid,NULL,NULL,'job',NULL,'queued',NULL,'job_queued');
 ELSE
   INSERT INTO app.submissions(id,cohort_id,user_id,curriculum_version_id,node_key,artifact_id,idempotency_key,evaluation_spec_digest,active_judge_job_id,created_at,state)
   VALUES(sid,cohort,u,v.id,node,art.id,request_id::text,NULL,NULL,at_time,'submitted');
   UPDATE app.learner_node_progress
   SET state = 'in_progress', updated_at = at_time
   WHERE cohort_id = cohort AND user_id = u AND curriculum_version_id = v.id AND node_key = node
     AND state = 'available';
 END IF;

 RETURN sid;
END $$;

CREATE OR REPLACE FUNCTION app.read_submissions(auth_id uuid,cohort uuid,node text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid;
BEGIN
 SELECT id INTO u FROM app.users WHERE auth_user_id=auth_id AND active AND role='learner';
 IF u IS NULL OR NOT EXISTS(SELECT FROM app.cohort_memberships m JOIN app.cohorts c ON c.id=m.cohort_id
 WHERE m.cohort_id=cohort AND m.user_id=u AND m.status='active' AND c.status='active') THEN
 RAISE EXCEPTION 'SUBMISSION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(row_to_json(history) ORDER BY history.created_at DESC,history.id) FROM (
 SELECT s.id,s.node_key,s.created_at,coalesce(r.verdict,s.state) AS state,r.learner_feedback AS feedback
 FROM app.submissions s LEFT JOIN judge.jobs j ON j.id=s.active_judge_job_id
 LEFT JOIN judge.results r ON r.id=j.terminal_result_id AND r.job_id=j.id
 WHERE s.cohort_id=cohort AND s.user_id=u AND s.node_key=node ORDER BY s.created_at DESC,s.id LIMIT 50
 ) history),'[]'::jsonb);
END $$;
