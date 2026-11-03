import postgres from 'postgres';

const sql = postgres('postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001');

async function main() {
  await sql.unsafe(`ALTER TABLE app.submissions ALTER COLUMN active_judge_job_id DROP NOT NULL;`);
  await sql.unsafe(`GRANT UPDATE(state, started_at) ON app.learner_node_progress TO nextera_judge_owner;`);
  await sql.unsafe(`
CREATE OR REPLACE FUNCTION app.accept_submission(auth_id uuid,cohort uuid,node text,request_id uuid,filename text,bytes bigint,content_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; u uuid; c app.cohorts; v app.curriculum_versions; n app.curriculum_nodes;
 old app.submissions; art app.submission_artifacts; sid uuid:=gen_random_uuid(); jid uuid:=gen_random_uuid();
 snapshot jsonb; at_time timestamptz; ordinal bigint; object_key text;
 rules jsonb;
BEGIN
 IF request_id IS NULL OR filename IS NULL OR bytes IS NULL OR content_hash IS NULL
    OR filename !~ '^[A-Za-z0-9_][A-Za-z0-9_.-]*$' OR bytes<1 OR bytes>262144
    OR content_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'SUBMISSION_MALFORMED' USING ERRCODE='22023'; END IF;
 ctx:=app.submission_context(auth_id,cohort,node);
 u:=(ctx->>'user_id')::uuid;
 SELECT * INTO c FROM app.cohorts WHERE id=cohort;
 SELECT * INTO v FROM app.curriculum_versions WHERE id=c.curriculum_version_id;
 SELECT * INTO n FROM app.curriculum_nodes WHERE curriculum_version_id=v.id AND node_key=node;
 
 rules := n.submission_rules;
 IF rules IS NOT NULL AND rules ? 'allowed_extensions' THEN
   DECLARE
     ext text;
     allowed boolean := false;
     elem text;
   BEGIN
     IF position('.' in filename) > 0 THEN
       ext := substring(filename from '\\.[^.]+$');
     ELSE
       ext := '';
     END IF;
     FOR elem IN SELECT jsonb_array_elements_text(rules->'allowed_extensions') LOOP
       IF elem = ext THEN
         allowed := true;
         EXIT;
       END IF;
     END LOOP;
     IF NOT allowed THEN
       RAISE EXCEPTION 'SUBMISSION_MALFORMED' USING ERRCODE='22023';
     END IF;
   END;
 END IF;

 at_time:=clock_timestamp();
 SELECT * INTO old FROM app.submissions WHERE cohort_id=cohort AND user_id=u AND node_key=node
   AND idempotency_key=request_id::text;
 IF old.id IS NOT NULL THEN
  SELECT * INTO art FROM app.submission_artifacts WHERE id=old.artifact_id;
  IF art.sha256 IS DISTINCT FROM content_hash OR art.size_bytes IS DISTINCT FROM bytes
     OR art.original_filename IS DISTINCT FROM filename THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
  RETURN old.id;
 END IF;
 object_key:=format('%s/%s/%s/%s',auth_id,cohort,request_id,content_hash);
 INSERT INTO app.submission_artifacts(owner_user_id,storage_bucket,storage_key,original_filename,size_bytes,sha256)
 VALUES(u,'nextera-submissions',object_key,filename,bytes,content_hash) RETURNING * INTO art;
 SELECT coalesce(max((j.evaluation_snapshot->>'learner_attempt_ordinal')::bigint),0)+1 INTO ordinal
 FROM app.submissions s JOIN judge.jobs j ON j.id=s.active_judge_job_id
 WHERE s.cohort_id=cohort AND s.user_id=u AND s.node_key=node;

 IF coalesce(n.resolved_evaluation_spec->>'test_pack_id', '') <> '' THEN
   snapshot:=n.resolved_evaluation_spec||jsonb_build_object(
     'curriculum_version_id',v.id,
     'git_commit_sha',v.git_commit_sha,
     'evaluation_spec_digest',n.evaluation_spec_digest,
     'learner_id',u,
     'cohort_id',cohort,
     'submission_id',sid,
     'learner_attempt_ordinal',ordinal,
     'accepted_at',to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'artifact',jsonb_build_object('id',art.id,'bucket',art.storage_bucket,'key',art.storage_key,'filename',filename,'size_bytes',bytes,'sha256',content_hash)
   );
   INSERT INTO app.submissions(id,cohort_id,user_id,curriculum_version_id,node_key,artifact_id,idempotency_key,evaluation_spec_digest,active_judge_job_id,created_at)
   VALUES(sid,cohort,u,v.id,node,art.id,request_id::text,n.evaluation_spec_digest,jid,at_time);
   INSERT INTO judge.jobs(id,submission_id,protocol_version,evaluation_snapshot,evaluation_digest,created_at)
   VALUES(jid,sid,(snapshot->>'protocol_version')::integer,snapshot,judge.snapshot_digest(snapshot),at_time);
   PERFORM judge.audit(sid,jid,NULL,NULL,'submission',NULL,'queued',NULL,'submission_accepted');
   PERFORM judge.audit(sid,jid,NULL,NULL,'job',NULL,'queued',NULL,'job_queued');
 ELSE
   INSERT INTO app.submissions(id,cohort_id,user_id,curriculum_version_id,node_key,artifact_id,idempotency_key,evaluation_spec_digest,active_judge_job_id,created_at,state)
   VALUES(sid,cohort,u,v.id,node,art.id,request_id::text,coalesce(n.evaluation_spec_digest, '0000000000000000000000000000000000000000000000000000000000000000'),NULL,at_time,'queued');
   UPDATE app.learner_node_progress
   SET state = 'in_progress', started_at = coalesce(started_at, at_time)
   WHERE cohort_id = cohort AND user_id = u AND curriculum_version_id = v.id AND node_key = node
     AND state = 'available';
 END IF;

 RETURN sid;
END $$;
  `);
  console.log('[OK] Updated app.accept_submission with queued state for non-Go submissions.');
  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
