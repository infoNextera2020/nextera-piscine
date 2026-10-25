-- Dedicated shared-project path. Ordinary challenge/checkpoint mastery and Judge execution are unchanged.
CREATE FUNCTION app.assign_raid_team(auth_id uuid,cohort uuid,node text,request uuid,label text,mentor uuid,members uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner_id uuid; version_id uuid; tid uuid; old app.raid_teams; BEGIN
 SELECT id INTO owner_id FROM app.users WHERE auth_user_id=auth_id AND active AND role='admin';
 IF owner_id IS NULL THEN RAISE EXCEPTION 'RAID_ASSIGNMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF cardinality(members)<>3 OR array_position(members,NULL) IS NOT NULL OR (SELECT count(DISTINCT x) FROM unnest(members) x)<>3
 OR length(trim(label)) NOT BETWEEN 1 AND 100 OR mentor=ANY(members) THEN RAISE EXCEPTION 'RAID_REQUIRES_THREE_MEMBERS' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(cohort::text||node,8));
 SELECT c.curriculum_version_id INTO version_id FROM app.cohorts c JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id
 JOIN app.curriculum_nodes n ON n.curriculum_version_id=v.id AND n.node_key=node
 WHERE c.id=cohort AND c.status='active' AND v.status='published' AND n.kind='project' FOR SHARE OF c;
 IF version_id IS NULL THEN RAISE EXCEPTION 'RAID_ASSIGNMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM app.raid_teams WHERE assigned_by=owner_id AND request_id=request;
 IF FOUND THEN
 IF old.cohort_id<>cohort OR old.node_key<>node OR old.mentor_user_id<>mentor OR old.name<>label OR
 (SELECT array_agg(user_id ORDER BY user_id) FROM app.raid_team_members WHERE team_id=old.id)<>(SELECT array_agg(x ORDER BY x) FROM unnest(members) x)
 THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF; RETURN old.id; END IF;
 PERFORM 1 FROM app.users WHERE id=ANY(members||ARRAY[mentor,owner_id]) ORDER BY id FOR SHARE;
 PERFORM 1 FROM app.cohort_memberships WHERE cohort_id=cohort AND user_id=ANY(members||ARRAY[mentor]) ORDER BY user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM app.users WHERE id=owner_id AND active AND role='admin') OR NOT EXISTS(SELECT FROM app.users u WHERE u.id=mentor AND u.active AND u.role IN ('operator','admin') AND
 (u.role='admin' OR EXISTS(SELECT FROM app.cohort_memberships m WHERE m.cohort_id=cohort AND m.user_id=u.id AND m.status='active')))
 OR (SELECT count(*) FROM app.users u JOIN app.cohort_memberships m ON m.user_id=u.id AND m.cohort_id=cohort
 WHERE u.id=ANY(members) AND u.active AND u.role='learner' AND m.status='active')<>3
 THEN RAISE EXCEPTION 'RAID_ASSIGNMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 -- A replacement assignment retires the overlapping immutable team, never changes old recipients.
 UPDATE app.raid_teams t SET active=false WHERE t.cohort_id=cohort AND t.curriculum_version_id=version_id AND t.node_key=node AND t.active
 AND EXISTS(SELECT FROM app.raid_team_members m WHERE m.team_id=t.id AND m.user_id=ANY(members));
 INSERT INTO app.raid_teams(cohort_id,curriculum_version_id,node_key,name,mentor_user_id,assigned_by,request_id)
 VALUES(cohort,version_id,node,label,mentor,owner_id,request) RETURNING id INTO tid;
 INSERT INTO app.raid_team_members(team_id,user_id) SELECT tid,x FROM unnest(members) x;
 RETURN tid;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.accept_raid_submission(auth_id uuid,cohort uuid,node text,request uuid,filename text,bytes bigint,content_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; u uuid; t app.raid_teams; sid uuid; aid uuid; old app.raid_attempts; a app.submission_artifacts; m record; version_id uuid; BEGIN
 ctx:=app.submission_context(auth_id,cohort,node); u:=(ctx->>'user_id')::uuid;
 IF ctx->>'kind'<>'project' THEN RAISE EXCEPTION 'RAID_SUBMISSION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(cohort::text||node,8));
 SELECT ra.* INTO old FROM app.raid_attempts ra JOIN app.submissions s ON s.id=ra.submission_id
 WHERE s.cohort_id=cohort AND s.user_id=u AND s.idempotency_key=request::text;
 IF FOUND THEN
 SELECT ar.* INTO a FROM app.submission_artifacts ar JOIN app.submissions s ON s.artifact_id=ar.id WHERE s.id=old.submission_id;
 IF a.sha256<>content_hash OR a.original_filename<>filename OR a.size_bytes<>bytes THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
 RETURN old.submission_id; END IF;
 SELECT rt.* INTO t FROM app.raid_teams rt JOIN app.raid_team_members tm ON tm.team_id=rt.id
 WHERE rt.cohort_id=cohort AND rt.node_key=node AND rt.active AND tm.user_id=u FOR UPDATE OF rt;
 IF NOT FOUND THEN RAISE EXCEPTION 'RAID_TEAM_REQUIRED' USING ERRCODE='42501'; END IF;
 -- All operations acquiring several learner keys do so in UUID order.
 FOR m IN SELECT user_id FROM app.raid_team_members WHERE team_id=t.id ORDER BY user_id LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended(cohort::text||m.user_id::text,4)); END LOOP;
 PERFORM 1 FROM app.users WHERE id IN (SELECT user_id FROM app.raid_team_members WHERE team_id=t.id) ORDER BY id FOR SHARE;
 PERFORM 1 FROM app.cohort_memberships WHERE cohort_id=cohort AND user_id IN (SELECT user_id FROM app.raid_team_members WHERE team_id=t.id) ORDER BY user_id FOR SHARE;
 SELECT curriculum_version_id INTO version_id FROM app.cohorts WHERE id=cohort AND status='active' FOR SHARE;
 IF version_id IS DISTINCT FROM t.curriculum_version_id OR
 (SELECT count(*) FROM app.raid_team_members tm JOIN app.users u ON u.id=tm.user_id JOIN app.cohort_memberships cm ON cm.user_id=u.id AND cm.cohort_id=cohort
 JOIN app.learner_node_progress p ON p.user_id=u.id AND p.cohort_id=cohort AND p.curriculum_version_id=version_id AND p.node_key=node
 WHERE tm.team_id=t.id AND u.active AND u.role='learner' AND cm.status='active' AND p.state IN ('available','in_progress','mastered'))<>3
 THEN RAISE EXCEPTION 'RAID_MEMBER_INELIGIBLE' USING ERRCODE='42501'; END IF;
 sid:=app.accept_submission(auth_id,cohort,node,request,filename,bytes,content_hash);
 IF EXISTS(SELECT FROM app.raid_attempts WHERE submission_id=sid) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
 INSERT INTO app.raid_attempts(team_id,submission_id,ordinal,definition_digest,created_at)
 SELECT t.id,sid,coalesce((SELECT max(ordinal) FROM app.raid_attempts WHERE team_id=t.id),0)+1,n.subject_digest,s.created_at
 FROM app.curriculum_nodes n JOIN app.submissions s ON s.id=sid WHERE n.curriculum_version_id=version_id AND n.node_key=node RETURNING id INTO aid;
 INSERT INTO app.raid_attempt_members(attempt_id,user_id,cohort_id,curriculum_version_id,node_key)
 SELECT aid,user_id,cohort,version_id,node FROM app.raid_team_members WHERE team_id=t.id;
 -- No automatic mastery. All three members have now started the same accepted work.
 UPDATE app.learner_node_progress SET state='in_progress',started_at=(SELECT created_at FROM app.raid_attempts WHERE id=aid)
 WHERE cohort_id=cohort AND curriculum_version_id=version_id AND node_key=node AND state='available'
 AND user_id IN (SELECT user_id FROM app.raid_attempt_members WHERE attempt_id=aid);
 RETURN sid;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.apply_raid_automated_result(rid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j judge.jobs; s app.submissions; r judge.results; a judge.attempts; ra app.raid_attempts; t app.raid_teams; n app.curriculum_nodes; at_time timestamptz; authoritative boolean; reason text; receipt app.raid_automated_receipts; BEGIN
 IF NOT pg_has_role(session_user,'nextera_result_application','USAGE') THEN RAISE EXCEPTION 'RESULT_APPLICATION_UNAUTHORIZED' USING ERRCODE='42501'; END IF;
 SELECT ra0.* INTO ra FROM app.raid_attempts ra0 JOIN judge.jobs j0 ON j0.submission_id=ra0.submission_id JOIN judge.results r0 ON r0.job_id=j0.id WHERE r0.id=rid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT j0.* INTO j FROM judge.jobs j0 JOIN judge.results r0 ON r0.job_id=j0.id WHERE r0.id=rid FOR UPDATE OF j0;
 SELECT * INTO s FROM app.submissions WHERE id=j.submission_id FOR UPDATE;
 SELECT * INTO r FROM judge.results WHERE id=rid FOR UPDATE;
 SELECT * INTO t FROM app.raid_teams WHERE id=ra.team_id FOR UPDATE;
 SELECT * INTO n FROM app.curriculum_nodes WHERE curriculum_version_id=t.curriculum_version_id AND node_key=t.node_key;
 SELECT * INTO a FROM judge.attempts WHERE id=r.attempt_id AND job_id=j.id;
 IF s.id IS NULL OR n.kind IS DISTINCT FROM 'project' OR s.cohort_id<>t.cohort_id OR s.curriculum_version_id<>t.curriculum_version_id OR s.node_key<>t.node_key
 OR s.checkpoint_attempt_id IS NOT NULL OR n.subject_digest<>ra.definition_digest OR n.evaluation_spec_digest<>s.evaluation_spec_digest
 OR NOT EXISTS(SELECT FROM app.curriculum_versions v JOIN app.cohorts c ON c.curriculum_version_id=v.id WHERE c.id=t.cohort_id AND v.id=t.curriculum_version_id AND v.status='published')
 OR j.evaluation_snapshot->'artifact'->>'id' IS DISTINCT FROM s.artifact_id::text
 OR j.evaluation_snapshot->'artifact'->>'sha256' IS DISTINCT FROM (SELECT sha256 FROM app.submission_artifacts WHERE id=s.artifact_id)
 OR r.evaluation_digest<>j.evaluation_digest OR j.evaluation_snapshot->>'submission_id' IS DISTINCT FROM s.id::text OR j.evaluation_snapshot->>'learner_id' IS DISTINCT FROM s.user_id::text
 OR j.evaluation_snapshot->>'cohort_id' IS DISTINCT FROM s.cohort_id::text OR j.evaluation_snapshot->>'curriculum_version_id' IS DISTINCT FROM s.curriculum_version_id::text
 OR j.evaluation_snapshot->>'node_key' IS DISTINCT FROM s.node_key OR j.evaluation_snapshot->>'evaluation_spec_digest' IS DISTINCT FROM s.evaluation_spec_digest
 OR a.id IS NULL OR a.state NOT IN ('completed','system_error') THEN RAISE EXCEPTION 'RAID_RESULT_IDENTITY_CONFLICT'; END IF;
 authoritative:=s.active_judge_job_id=j.id AND j.terminal_result_id=r.id;
 IF r.application_status<>'pending' THEN
 IF r.processed_at IS NULL OR (r.application_status='applied' AND (NOT authoritative OR s.state<>r.verdict OR r.application_reason<>'raid_automated_result_recorded'
 OR NOT EXISTS(SELECT FROM app.raid_automated_receipts ar WHERE ar.attempt_id=ra.id AND ar.result_id=r.id AND ar.verdict=r.verdict)))
 OR (r.application_status='superseded' AND (authoritative OR r.application_reason NOT IN ('intermediate_infrastructure_result','superseded_evaluation')))
 THEN RAISE EXCEPTION 'APPLICATION_RECEIPT_CONFLICT'; END IF; RETURN to_jsonb(r); END IF;
 at_time:=greatest(clock_timestamp(),s.created_at,s.started_at,r.recorded_at);
 IF NOT authoritative THEN
 IF s.active_judge_job_id=j.id AND (r.verdict<>'system_error' OR a.attempt_number>j.retry_count) THEN RAISE EXCEPTION 'RESULT_NOT_TERMINAL'; END IF;
 reason:=CASE WHEN s.active_judge_job_id=j.id THEN 'intermediate_infrastructure_result' ELSE 'superseded_evaluation' END;
 UPDATE judge.results SET application_status='superseded',processed_at=at_time,application_reason=reason WHERE id=rid RETURNING * INTO r; RETURN to_jsonb(r); END IF;
 IF s.state NOT IN ('queued','running') OR (r.verdict='system_error' AND (j.state<>'system_error' OR a.state<>'system_error'))
 OR (r.verdict<>'system_error' AND (j.state<>'completed' OR a.state<>'completed')) OR r.verdict IN ('queued','running','cancelled') THEN RAISE EXCEPTION 'RESULT_NOT_TERMINAL'; END IF;
 INSERT INTO app.raid_automated_receipts(attempt_id,result_id,verdict,created_at) VALUES(ra.id,rid,r.verdict,at_time);
 UPDATE app.submissions SET state=r.verdict,finished_at=at_time WHERE id=s.id;
 UPDATE judge.results SET application_status='applied',processed_at=at_time,application_reason='raid_automated_result_recorded' WHERE id=rid RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
--> statement-breakpoint
-- Sticky holds preserve an access-removal incident even after later reactivation.
CREATE FUNCTION app.hold_raids_after_access_removal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF (TG_TABLE_NAME='users' AND (to_jsonb(NEW)->>'active')::boolean AND to_jsonb(NEW)->>'role'='learner') OR (TG_TABLE_NAME<>'users' AND to_jsonb(NEW)->>'status'='active') THEN RETURN NEW; END IF;
 INSERT INTO app.raid_owner_holds(attempt_id,reason)
 SELECT DISTINCT m.attempt_id,'member_access_removed' FROM app.raid_attempt_members m
 WHERE NOT EXISTS(SELECT FROM app.raid_outcomes o WHERE o.attempt_id=m.attempt_id)
 AND CASE WHEN TG_TABLE_NAME='users' THEN m.user_id=(to_jsonb(NEW)->>'id')::uuid
 WHEN TG_TABLE_NAME='cohort_memberships' THEN m.user_id=(to_jsonb(NEW)->>'user_id')::uuid AND m.cohort_id=(to_jsonb(NEW)->>'cohort_id')::uuid
 ELSE m.cohort_id=(to_jsonb(NEW)->>'id')::uuid END ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.read_raid(auth_id uuid,cohort uuid,node text,selected_team uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u app.users; t app.raid_teams; history jsonb; can_upload boolean:=false; BEGIN
 SELECT * INTO u FROM app.users WHERE auth_user_id=auth_id AND active;
 IF u.id IS NULL OR NOT EXISTS(SELECT FROM app.cohorts c JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id JOIN app.curriculum_nodes n ON n.curriculum_version_id=v.id AND n.node_key=node
 WHERE c.id=cohort AND (c.status='active' OR u.role='admin') AND v.status='published' AND n.kind='project')
 OR (u.role<>'admin' AND NOT EXISTS(SELECT FROM app.cohort_memberships WHERE cohort_id=cohort AND user_id=u.id AND status='active'))
 OR (u.role='learner' AND NOT EXISTS(SELECT FROM app.learner_node_progress WHERE cohort_id=cohort AND user_id=u.id AND node_key=node AND state<>'locked'))
 THEN RAISE EXCEPTION 'RAID_READ_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT rt.* INTO t FROM app.raid_teams rt WHERE rt.cohort_id=cohort AND rt.node_key=node AND (rt.active OR (u.role='admin' AND selected_team=rt.id)) AND
 (selected_team IS NULL OR rt.id=selected_team) AND (u.role='admin' OR rt.mentor_user_id=u.id OR EXISTS(SELECT FROM app.raid_team_members tm WHERE tm.team_id=rt.id AND tm.user_id=u.id))
 ORDER BY rt.created_at DESC,rt.id LIMIT 1;
 IF u.role='operator' AND t.id IS NULL THEN RAISE EXCEPTION 'RAID_READ_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF u.role='learner' AND t.id IS NOT NULL THEN
 BEGIN PERFORM app.submission_context(auth_id,cohort,node); can_upload:=true; EXCEPTION WHEN insufficient_privilege THEN can_upload:=false; END;
 can_upload:=can_upload AND (SELECT count(*) FROM app.raid_team_members tm JOIN app.users mu ON mu.id=tm.user_id
 JOIN app.cohort_memberships cm ON cm.user_id=mu.id AND cm.cohort_id=cohort JOIN app.learner_node_progress p ON p.cohort_id=cohort AND p.user_id=mu.id AND p.node_key=node AND p.curriculum_version_id=t.curriculum_version_id
 WHERE tm.team_id=t.id AND mu.active AND mu.role='learner' AND cm.status='active' AND p.state<>'locked')=3; END IF;
 SELECT coalesce(jsonb_agg(x.data ORDER BY x.at DESC,x.ordinal DESC), '[]'::jsonb) INTO history FROM (
 SELECT ra.ordinal,ra.created_at AS at,jsonb_build_object('id',ra.id,'ordinal',ra.ordinal,'created_at',ra.created_at,
 'filename',ar.original_filename,'artifact_digest',ar.sha256,'uploader',uploader.display_name,
 'members',(SELECT jsonb_agg(jsonb_build_object('id',m.user_id,'displayName',mu.display_name) ORDER BY m.user_id) FROM app.raid_attempt_members m JOIN app.users mu ON mu.id=m.user_id WHERE m.attempt_id=ra.id),
 'automated_state',s.state,'feedback',jr.learner_feedback,
 'review',CASE WHEN rv.id IS NULL THEN NULL ELSE jsonb_build_object('decision',rv.decision,'feedback',rv.feedback,'created_at',rv.created_at) END,
 'outcome_id',o.id,'status',CASE WHEN o.id IS NOT NULL THEN 'completed'
 WHEN EXISTS(SELECT FROM app.raid_owner_holds WHERE attempt_id=ra.id) THEN 'owner_decision_required'
 WHEN NOT rt.active OR ra.ordinal<>(SELECT max(ordinal) FROM app.raid_attempts WHERE team_id=rt.id) THEN 'superseded'
 WHEN s.state IN ('queued','running') THEN 'awaiting_checks' WHEN s.state IN ('system_error','cancelled') THEN 'attention_required'
 WHEN s.state<>'passed' OR rv.decision='changes_requested' THEN 'changes_required' ELSE 'awaiting_review' END) AS data
 FROM app.raid_attempts ra JOIN app.raid_teams rt ON rt.id=ra.team_id JOIN app.submissions s ON s.id=ra.submission_id
 JOIN app.submission_artifacts ar ON ar.id=s.artifact_id JOIN app.users uploader ON uploader.id=s.user_id
 LEFT JOIN app.raid_automated_receipts ac ON ac.attempt_id=ra.id LEFT JOIN judge.results jr ON jr.id=ac.result_id
 LEFT JOIN app.raid_reviews rv ON rv.attempt_id=ra.id LEFT JOIN app.raid_outcomes o ON o.attempt_id=ra.id
 WHERE rt.cohort_id=cohort AND rt.node_key=node AND ((u.role='learner' AND EXISTS(SELECT FROM app.raid_attempt_members m WHERE m.attempt_id=ra.id AND m.user_id=u.id))
 OR (u.role<>'learner' AND rt.id=t.id)) ORDER BY ra.created_at DESC,ra.id LIMIT 50
 ) x;
 RETURN jsonb_build_object('team',CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id',t.id,'name',t.name,'mentor',(SELECT display_name FROM app.users WHERE id=t.mentor_user_id),
 'members',(SELECT jsonb_agg(jsonb_build_object('id',tm.user_id,'displayName',mu.display_name) ORDER BY tm.user_id) FROM app.raid_team_members tm JOIN app.users mu ON mu.id=tm.user_id WHERE tm.team_id=t.id)) END,
 'attempts',history,'can_submit',can_upload,'can_review',u.id=t.mentor_user_id AND t.active);
END $$;
--> statement-breakpoint
CREATE FUNCTION app.raid_review_queue(auth_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u app.users; BEGIN
 SELECT * INTO u FROM app.users WHERE auth_user_id=auth_id AND active AND role IN ('operator','admin');
 IF u.id IS NULL THEN RAISE EXCEPTION 'RAID_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('team_id',t.id,'team',t.name,'cohort_id',c.id,'cohort',c.name,'node',n.node_key,'title',n.title,
 'owner_hold',EXISTS(SELECT FROM app.raid_attempts a JOIN app.raid_owner_holds h ON h.attempt_id=a.id WHERE a.team_id=t.id),
 'can_review',t.mentor_user_id=u.id) ORDER BY t.created_at DESC,t.id)
 FROM app.raid_teams t JOIN app.cohorts c ON c.id=t.cohort_id JOIN app.curriculum_nodes n ON n.curriculum_version_id=t.curriculum_version_id AND n.node_key=t.node_key
 WHERE (t.active OR (u.role='admin' AND EXISTS(SELECT FROM app.raid_attempts a JOIN app.raid_owner_holds h ON h.attempt_id=a.id WHERE a.team_id=t.id))) AND (c.status='active' OR u.role='admin') AND (u.role='admin' OR (t.mentor_user_id=u.id AND EXISTS(SELECT FROM app.cohort_memberships m WHERE m.cohort_id=c.id AND m.user_id=u.id AND m.status='active')))), '[]'::jsonb);
END $$;
--> statement-breakpoint
CREATE FUNCTION app.raid_artifact_context(auth_id uuid,aid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE data jsonb; BEGIN
 SELECT jsonb_build_object('bucket',ar.storage_bucket,'key',ar.storage_key,'filename',ar.original_filename,'digest',ar.sha256,'size',ar.size_bytes) INTO data
 FROM app.raid_attempts a JOIN app.raid_teams t ON t.id=a.team_id JOIN app.submissions s ON s.id=a.submission_id JOIN app.submission_artifacts ar ON ar.id=s.artifact_id
 JOIN app.users u ON u.id=t.mentor_user_id JOIN app.cohorts c ON c.id=t.cohort_id
 JOIN app.raid_automated_receipts ac ON ac.attempt_id=a.id AND ac.verdict='passed'
 WHERE a.id=aid AND u.auth_user_id=auth_id AND u.active AND u.role IN ('operator','admin') AND c.status='active'
 AND (u.role='admin' OR EXISTS(SELECT FROM app.cohort_memberships m WHERE m.cohort_id=c.id AND m.user_id=u.id AND m.status='active'))
 AND NOT EXISTS(SELECT FROM app.raid_attempt_members m WHERE m.attempt_id=aid AND m.user_id=u.id);
 IF data IS NULL THEN RAISE EXCEPTION 'RAID_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF; RETURN data;
END $$;
--> statement-breakpoint

CREATE TRIGGER raid_user_access_removed AFTER UPDATE OF active,role ON app.users FOR EACH ROW EXECUTE FUNCTION app.hold_raids_after_access_removal();
CREATE TRIGGER raid_member_access_removed AFTER UPDATE OF status ON app.cohort_memberships FOR EACH ROW EXECUTE FUNCTION app.hold_raids_after_access_removal();
CREATE TRIGGER raid_cohort_access_removed AFTER UPDATE OF status ON app.cohorts FOR EACH ROW EXECUTE FUNCTION app.hold_raids_after_access_removal();
--> statement-breakpoint
CREATE FUNCTION app.review_raid(auth_id uuid,aid uuid,request uuid,choice text,note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; ra app.raid_attempts; t app.raid_teams; rr app.raid_reviews; result app.raid_automated_receipts; oid uuid; member record; changed record; at_time timestamptz; BEGIN
 SELECT * INTO ra FROM app.raid_attempts WHERE id=aid;
 SELECT * INTO t FROM app.raid_teams WHERE id=ra.team_id FOR UPDATE;
 SELECT u.id INTO actor FROM app.users u WHERE u.auth_user_id=auth_id AND u.active AND u.role IN ('operator','admin') AND u.id=t.mentor_user_id
 AND (u.role='admin' OR EXISTS(SELECT FROM app.cohort_memberships m WHERE m.cohort_id=t.cohort_id AND m.user_id=u.id AND m.status='active')) FOR SHARE;
 IF actor IS NULL OR EXISTS(SELECT FROM app.raid_attempt_members WHERE attempt_id=aid AND user_id=actor) THEN RAISE EXCEPTION 'RAID_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF choice NOT IN ('approved','changes_requested') OR length(trim(note)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_REVIEW' USING ERRCODE='22023'; END IF;
 SELECT * INTO rr FROM app.raid_reviews WHERE attempt_id=aid OR (reviewer_id=actor AND request_id=request);
 IF FOUND THEN
 IF rr.attempt_id<>aid OR rr.reviewer_id<>actor OR rr.request_id<>request OR rr.decision<>choice OR rr.feedback<>note THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('review_id',rr.id,'outcome_id',(SELECT id FROM app.raid_outcomes WHERE attempt_id=aid)); END IF;
 IF NOT t.active OR ra.ordinal<>(SELECT max(ordinal) FROM app.raid_attempts WHERE team_id=t.id) THEN RAISE EXCEPTION 'RAID_ATTEMPT_SUPERSEDED' USING ERRCODE='22023'; END IF;
 -- Hold all recipient authorization rows until finalization commits. A deactivation waits, or we see its sticky hold.
 FOR member IN SELECT user_id FROM app.raid_attempt_members WHERE attempt_id=aid ORDER BY user_id LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended(t.cohort_id::text||member.user_id::text,4)); END LOOP;
 PERFORM 1 FROM app.users WHERE id IN (SELECT user_id FROM app.raid_attempt_members WHERE attempt_id=aid) ORDER BY id FOR SHARE;
 PERFORM 1 FROM app.cohort_memberships WHERE cohort_id=t.cohort_id AND user_id IN (SELECT user_id FROM app.raid_attempt_members WHERE attempt_id=aid) ORDER BY user_id FOR SHARE;
 PERFORM 1 FROM app.cohorts WHERE id=t.cohort_id FOR SHARE;
 IF EXISTS(SELECT FROM app.raid_owner_holds WHERE attempt_id=aid) OR NOT EXISTS(SELECT FROM app.cohorts WHERE id=t.cohort_id AND status='active') OR
 (SELECT count(*) FROM app.raid_attempt_members m JOIN app.users u ON u.id=m.user_id JOIN app.cohort_memberships cm ON cm.user_id=u.id AND cm.cohort_id=t.cohort_id
 WHERE m.attempt_id=aid AND u.active AND u.role='learner' AND cm.status='active')<>3 THEN
 INSERT INTO app.raid_owner_holds(attempt_id,reason) VALUES(aid,'member_access_removed') ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('status','owner_decision_required'); END IF;
 SELECT * INTO result FROM app.raid_automated_receipts WHERE attempt_id=aid;
 IF result.verdict IS DISTINCT FROM 'passed' THEN RAISE EXCEPTION 'RAID_CHECKS_NOT_PASSED' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM app.node_prerequisites WHERE curriculum_version_id=t.curriculum_version_id AND rule<>'requires_pass') THEN RAISE EXCEPTION 'UNSUPPORTED_PREREQUISITE'; END IF;
 at_time:=clock_timestamp();
 INSERT INTO app.raid_reviews(attempt_id,reviewer_id,request_id,decision,feedback,created_at) VALUES(aid,actor,request,choice,note,at_time) RETURNING * INTO rr;
 IF choice='changes_requested' THEN RETURN jsonb_build_object('review_id',rr.id,'outcome_id',NULL); END IF;
 INSERT INTO app.raid_outcomes(attempt_id,review_id,created_at) VALUES(aid,rr.id,at_time) RETURNING id INTO oid;
 FOR member IN SELECT * FROM app.raid_attempt_members WHERE attempt_id=aid ORDER BY user_id LOOP
 PERFORM 1 FROM app.learner_node_progress WHERE cohort_id=t.cohort_id AND user_id=member.user_id ORDER BY node_key FOR UPDATE;
 IF (SELECT count(*) FROM app.learner_node_progress WHERE cohort_id=t.cohort_id AND user_id=member.user_id AND curriculum_version_id=t.curriculum_version_id)<>(SELECT count(*) FROM app.curriculum_nodes WHERE curriculum_version_id=t.curriculum_version_id)
 OR NOT EXISTS(SELECT FROM app.learner_node_progress WHERE cohort_id=t.cohort_id AND user_id=member.user_id AND curriculum_version_id=t.curriculum_version_id AND node_key=t.node_key AND state<>'locked')
 THEN RAISE EXCEPTION 'PROGRESS_IDENTITY_CONFLICT'; END IF;
 INSERT INTO app.raid_member_receipts(outcome_id,attempt_id,user_id,cohort_id,curriculum_version_id,node_key,created_at)
 VALUES(oid,aid,member.user_id,t.cohort_id,t.curriculum_version_id,t.node_key,at_time);
 UPDATE app.learner_node_progress SET state='mastered',started_at=coalesce(started_at,ra.created_at),mastered_at=at_time,first_passing_raid_outcome_id=oid
 WHERE cohort_id=t.cohort_id AND user_id=member.user_id AND curriculum_version_id=t.curriculum_version_id AND node_key=t.node_key AND state<>'mastered';
 INSERT INTO app.activity_events(event_type,event_version,user_id,cohort_id,curriculum_version_id,node_key,correlation_id,payload)
 VALUES('raid_completed',1,member.user_id,t.cohort_id,t.curriculum_version_id,t.node_key,oid,jsonb_build_object('outcome_id',oid,'attempt_id',aid));
 FOR changed IN UPDATE app.learner_node_progress p SET state='available',unlocked_at=at_time
 WHERE p.cohort_id=t.cohort_id AND p.user_id=member.user_id AND p.curriculum_version_id=t.curriculum_version_id AND p.state='locked'
 AND NOT EXISTS(SELECT FROM app.node_prerequisites e LEFT JOIN app.learner_node_progress q ON q.cohort_id=t.cohort_id AND q.user_id=member.user_id AND q.curriculum_version_id=e.curriculum_version_id AND q.node_key=e.prerequisite_node_key
 WHERE e.curriculum_version_id=t.curriculum_version_id AND e.dependent_node_key=p.node_key AND q.state IS DISTINCT FROM 'mastered') RETURNING node_key LOOP
 INSERT INTO app.activity_events(event_type,event_version,user_id,cohort_id,curriculum_version_id,node_key,correlation_id,payload)
 VALUES('node_unlocked',1,member.user_id,t.cohort_id,t.curriculum_version_id,changed.node_key,oid,jsonb_build_object('raid_outcome_id',oid)); END LOOP;
 END LOOP;
 RETURN jsonb_build_object('review_id',rr.id,'outcome_id',oid);
END $$;

--> statement-breakpoint
-- Restrict every function explicitly, including private trigger helpers.
DO $$ DECLARE f record; temporary boolean:=false; BEGIN
 IF NOT pg_has_role(current_user,'nextera_raid_owner','SET') THEN EXECUTE format('GRANT nextera_raid_owner TO %I',current_user); temporary:=true; END IF;
 GRANT CREATE ON SCHEMA app TO nextera_raid_owner;
 FOR f IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname IN
 ('guard_raid_history','check_raid_roster','assign_raid_team','accept_raid_submission','apply_raid_automated_result','hold_raids_after_access_removal','review_raid','read_raid','raid_review_queue','raid_artifact_context') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.name); EXECUTE format('ALTER FUNCTION %s OWNER TO nextera_raid_owner',f.name); END LOOP;
 REVOKE CREATE ON SCHEMA app FROM nextera_raid_owner;
 IF temporary THEN EXECUTE format('REVOKE nextera_raid_owner FROM %I GRANTED BY %I',current_user,current_user);
 IF pg_has_role(current_user,'nextera_raid_owner','SET') THEN RAISE EXCEPTION 'Owner SET access remains'; END IF; END IF;
END $$;
GRANT EXECUTE ON FUNCTION app.assign_raid_team(uuid,uuid,text,uuid,text,uuid,uuid[]),app.accept_raid_submission(uuid,uuid,text,uuid,text,bigint,text),
 app.read_raid(uuid,uuid,text,uuid),app.raid_review_queue(uuid),app.review_raid(uuid,uuid,uuid,text,text),app.raid_artifact_context(uuid,uuid) TO nextera_web;
GRANT EXECUTE ON FUNCTION app.apply_raid_automated_result(uuid) TO nextera_result_application;
