-- REVIEW DRAFT ONLY. Not registered; private synthetic database and named DBA only.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $scope$ BEGIN
 IF pg_catalog.current_database()<>'foundation_test_checkpoint_migration_adapter_20261029' OR current_user<>'anas' OR session_user<>'anas'
 OR NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname=current_user AND rolsuper)
 OR pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Private repair DBA context required' USING ERRCODE='42501'; END IF;
END $scope$;
LOCK TABLE pg_catalog.pg_authid,pg_catalog.pg_auth_members,pg_catalog.pg_proc,pg_catalog.pg_namespace IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $roles$ BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('nextera_web','nextera_judge_owner','nextera_runner','nextera_judge_maintenance','nextera_result_application','nextera_checkpoint_owner','nextera_raid_owner','checkpoint_migration_actor_20261029','checkpoint_migration_probe_20261029'))<>9
 OR EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname IN ('nextera_web','nextera_judge_owner','nextera_runner','nextera_judge_maintenance','nextera_result_application','nextera_checkpoint_owner','nextera_raid_owner','checkpoint_migration_actor_20261029','checkpoint_migration_probe_20261029') AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication))
 OR EXISTS(SELECT FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname IN ('nextera_web','nextera_judge_owner','nextera_runner','nextera_judge_maintenance','nextera_result_application','nextera_checkpoint_owner','nextera_raid_owner')) THEN
  RAISE EXCEPTION 'Existing isolated permission roles required' USING ERRCODE='42501'; END IF;
END $roles$;
DO $actor$ BEGIN
 IF EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname IN ('nextera_web','nextera_judge_owner','nextera_runner','nextera_judge_maintenance','nextera_result_application','nextera_checkpoint_owner','nextera_raid_owner')
 AND (pg_catalog.pg_has_role('checkpoint_migration_actor_20261029',r.oid,'SET') OR pg_catalog.pg_has_role('checkpoint_migration_actor_20261029',r.oid,'USAGE')))
 OR EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='checkpoint_migration_actor_20261029' AND rolinherit)
 OR EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolcanlogin AND rolname<>'anas') THEN
 RAISE EXCEPTION 'Repair must not expand effective actor access' USING ERRCODE='42501'; END IF;
END $actor$;
DO $verify$ DECLARE item record; object_id oid; actual_owner name; actual_roles text[]; BEGIN
 FOR item IN SELECT * FROM (VALUES ('app.submission_context(uuid,uuid,text)','nextera_judge_owner',ARRAY['nextera_raid_owner','nextera_web']::text[]),
('app.accept_submission(uuid,uuid,text,uuid,text,bigint,text)','nextera_judge_owner',ARRAY['nextera_raid_owner','nextera_web']::text[]),
('app.read_submissions(uuid,uuid,text)','nextera_judge_owner',ARRAY['nextera_web']::text[]),
('judge.claim_job()','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.renew_lease(uuid,uuid,uuid,bigint)','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.heartbeat()','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.record_execution_attempt(uuid,uuid,uuid,bigint)','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.record_result(uuid,uuid,uuid,bigint,text,jsonb)','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.record_infrastructure_failure(uuid,uuid,uuid,bigint,text)','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.recover_expired(integer)','nextera_judge_owner',ARRAY['nextera_judge_maintenance']::text[]),
('app.start_checkpoint(uuid,uuid,text,uuid)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.finish_checkpoint(uuid,uuid)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.checkpoint_task_context(uuid,uuid,text)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.accept_checkpoint_submission(uuid,uuid,text,uuid,text,bigint,text)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.read_checkpoint(uuid,uuid,text)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.grant_checkpoint_replacement(uuid,uuid)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.finalize_checkpoint(uuid)','nextera_checkpoint_owner',ARRAY['nextera_result_application']::text[]),
('app.announce_checkpoint_retake(uuid)','nextera_checkpoint_owner',ARRAY['nextera_result_application']::text[]),
('app.assign_raid_team(uuid,uuid,text,uuid,text,uuid,uuid[])','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.accept_raid_submission(uuid,uuid,text,uuid,text,bigint,text)','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.read_raid(uuid,uuid,text,uuid)','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.raid_review_queue(uuid)','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.review_raid(uuid,uuid,uuid,text,text)','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.raid_artifact_context(uuid,uuid)','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.apply_raid_automated_result(uuid)','nextera_raid_owner',ARRAY['nextera_result_application']::text[])) v(signature,owner_name,allowed_roles) LOOP
  object_id:=pg_catalog.to_regprocedure(item.signature);
  SELECT o.rolname INTO actual_owner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles o ON o.oid=p.proowner WHERE p.oid=object_id;
  IF object_id IS NULL OR actual_owner IS DISTINCT FROM item.owner_name THEN RAISE EXCEPTION 'Repair owner/identity precondition failed' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=object_id AND
   (a.grantee=0 OR (a.grantee<>p.proowner AND (r.oid IS NULL OR a.privilege_type<>'EXECUTE' OR a.is_grantable OR NOT(r.rolname=ANY(item.allowed_roles)))))) THEN
    RAISE EXCEPTION 'Unexpected or PUBLIC repair privilege' USING ERRCODE='42501'; END IF;
  SELECT coalesce(array_agg(DISTINCT r.rolname::text ORDER BY r.rolname::text),'{}'::text[]) INTO actual_roles
   FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=object_id AND a.grantee<>p.proowner;

 END LOOP;
END $verify$;
-- fixed-27-grants:start
GRANT EXECUTE ON FUNCTION app.submission_context(uuid,uuid,text) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.submission_context(uuid,uuid,text) TO nextera_raid_owner;
GRANT EXECUTE ON FUNCTION app.accept_submission(uuid,uuid,text,uuid,text,bigint,text) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.accept_submission(uuid,uuid,text,uuid,text,bigint,text) TO nextera_raid_owner;
GRANT EXECUTE ON FUNCTION app.read_submissions(uuid,uuid,text) TO nextera_web;
GRANT EXECUTE ON FUNCTION judge.claim_job() TO nextera_runner;
GRANT EXECUTE ON FUNCTION judge.renew_lease(uuid,uuid,uuid,bigint) TO nextera_runner;
GRANT EXECUTE ON FUNCTION judge.heartbeat() TO nextera_runner;
GRANT EXECUTE ON FUNCTION judge.record_execution_attempt(uuid,uuid,uuid,bigint) TO nextera_runner;
GRANT EXECUTE ON FUNCTION judge.record_result(uuid,uuid,uuid,bigint,text,jsonb) TO nextera_runner;
GRANT EXECUTE ON FUNCTION judge.record_infrastructure_failure(uuid,uuid,uuid,bigint,text) TO nextera_runner;
GRANT EXECUTE ON FUNCTION judge.recover_expired(integer) TO nextera_judge_maintenance;
GRANT EXECUTE ON FUNCTION app.start_checkpoint(uuid,uuid,text,uuid) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.finish_checkpoint(uuid,uuid) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.checkpoint_task_context(uuid,uuid,text) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.accept_checkpoint_submission(uuid,uuid,text,uuid,text,bigint,text) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.read_checkpoint(uuid,uuid,text) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.grant_checkpoint_replacement(uuid,uuid) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.finalize_checkpoint(uuid) TO nextera_result_application;
GRANT EXECUTE ON FUNCTION app.announce_checkpoint_retake(uuid) TO nextera_result_application;
GRANT EXECUTE ON FUNCTION app.assign_raid_team(uuid,uuid,text,uuid,text,uuid,uuid[]) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.accept_raid_submission(uuid,uuid,text,uuid,text,bigint,text) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.read_raid(uuid,uuid,text,uuid) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.raid_review_queue(uuid) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.review_raid(uuid,uuid,uuid,text,text) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.raid_artifact_context(uuid,uuid) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.apply_raid_automated_result(uuid) TO nextera_result_application;
-- fixed-27-grants:end
DO $verify$ DECLARE item record; object_id oid; actual_owner name; actual_roles text[]; BEGIN
 FOR item IN SELECT * FROM (VALUES ('app.submission_context(uuid,uuid,text)','nextera_judge_owner',ARRAY['nextera_raid_owner','nextera_web']::text[]),
('app.accept_submission(uuid,uuid,text,uuid,text,bigint,text)','nextera_judge_owner',ARRAY['nextera_raid_owner','nextera_web']::text[]),
('app.read_submissions(uuid,uuid,text)','nextera_judge_owner',ARRAY['nextera_web']::text[]),
('judge.claim_job()','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.renew_lease(uuid,uuid,uuid,bigint)','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.heartbeat()','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.record_execution_attempt(uuid,uuid,uuid,bigint)','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.record_result(uuid,uuid,uuid,bigint,text,jsonb)','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.record_infrastructure_failure(uuid,uuid,uuid,bigint,text)','nextera_judge_owner',ARRAY['nextera_runner']::text[]),
('judge.recover_expired(integer)','nextera_judge_owner',ARRAY['nextera_judge_maintenance']::text[]),
('app.start_checkpoint(uuid,uuid,text,uuid)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.finish_checkpoint(uuid,uuid)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.checkpoint_task_context(uuid,uuid,text)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.accept_checkpoint_submission(uuid,uuid,text,uuid,text,bigint,text)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.read_checkpoint(uuid,uuid,text)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.grant_checkpoint_replacement(uuid,uuid)','nextera_checkpoint_owner',ARRAY['nextera_web']::text[]),
('app.finalize_checkpoint(uuid)','nextera_checkpoint_owner',ARRAY['nextera_result_application']::text[]),
('app.announce_checkpoint_retake(uuid)','nextera_checkpoint_owner',ARRAY['nextera_result_application']::text[]),
('app.assign_raid_team(uuid,uuid,text,uuid,text,uuid,uuid[])','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.accept_raid_submission(uuid,uuid,text,uuid,text,bigint,text)','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.read_raid(uuid,uuid,text,uuid)','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.raid_review_queue(uuid)','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.review_raid(uuid,uuid,uuid,text,text)','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.raid_artifact_context(uuid,uuid)','nextera_raid_owner',ARRAY['nextera_web']::text[]),
('app.apply_raid_automated_result(uuid)','nextera_raid_owner',ARRAY['nextera_result_application']::text[])) v(signature,owner_name,allowed_roles) LOOP
  object_id:=pg_catalog.to_regprocedure(item.signature);
  SELECT o.rolname INTO actual_owner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles o ON o.oid=p.proowner WHERE p.oid=object_id;
  IF object_id IS NULL OR actual_owner IS DISTINCT FROM item.owner_name THEN RAISE EXCEPTION 'Repair owner/identity precondition failed' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=object_id AND
   (a.grantee=0 OR (a.grantee<>p.proowner AND (r.oid IS NULL OR a.privilege_type<>'EXECUTE' OR a.is_grantable OR NOT(r.rolname=ANY(item.allowed_roles)))))) THEN
    RAISE EXCEPTION 'Unexpected or PUBLIC repair privilege' USING ERRCODE='42501'; END IF;
  SELECT coalesce(array_agg(DISTINCT r.rolname::text ORDER BY r.rolname::text),'{}'::text[]) INTO actual_roles
   FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=object_id AND a.grantee<>p.proowner;
  IF actual_roles IS DISTINCT FROM item.allowed_roles THEN RAISE EXCEPTION 'Repair intended privileges incomplete' USING ERRCODE='42501'; END IF;
 END LOOP;
END $verify$;
COMMIT;
