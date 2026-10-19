-- Product-only permission role. Never grant to web, Runner, or browser logins.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_result_application') THEN
 CREATE ROLE nextera_result_application NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_result_application' AND
 (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_result_application') THEN
 RAISE EXCEPTION 'Result application role must be an isolated NOLOGIN permission role';
 END IF;
END $$;
GRANT USAGE ON SCHEMA app,judge TO nextera_result_application;
GRANT SELECT ON app.submissions,app.cohorts,app.cohort_memberships,app.curriculum_versions,
 app.curriculum_nodes,app.node_prerequisites,app.learner_node_progress,judge.jobs,judge.attempts,judge.results
 TO nextera_result_application;
GRANT UPDATE(state,finished_at) ON app.submissions TO nextera_result_application;
GRANT UPDATE(application_status,processed_at,application_reason) ON judge.results TO nextera_result_application;
-- Row locks require an UPDATE privilege, even on identities never modified by the service.
GRANT UPDATE(id) ON judge.jobs TO nextera_result_application;
GRANT UPDATE(joined_at) ON app.cohort_memberships TO nextera_result_application;
GRANT UPDATE(state,unlocked_at,started_at,mastered_at,first_passing_submission_id)
 ON app.learner_node_progress TO nextera_result_application;
GRANT INSERT ON app.state_events,app.activity_events TO nextera_result_application;

--> statement-breakpoint
CREATE FUNCTION judge.guard_application_receipt() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$ BEGIN
 IF OLD.application_status <> 'pending' AND
 (NEW.application_status,NEW.processed_at,NEW.application_reason) IS DISTINCT FROM
 (OLD.application_status,OLD.processed_at,OLD.application_reason) THEN
 RAISE EXCEPTION 'Applied result receipt is immutable';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION judge.guard_application_receipt() FROM PUBLIC;
CREATE TRIGGER result_receipt_immutable BEFORE UPDATE ON judge.results
FOR EACH ROW EXECUTE FUNCTION judge.guard_application_receipt();
--> statement-breakpoint
-- Intake remains narrow. A trigger starts progress only for an actual accepted
-- submission; it receives no caller-selected progression outcome.
CREATE FUNCTION app.start_accepted_progress() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$ BEGIN
 UPDATE app.learner_node_progress SET state='in_progress',started_at=NEW.created_at
 WHERE cohort_id=NEW.cohort_id AND user_id=NEW.user_id
 AND curriculum_version_id=NEW.curriculum_version_id AND node_key=NEW.node_key AND state='available';
 IF FOUND THEN
 INSERT INTO app.state_events(submission_id,entity_type,previous_state,next_state,actor_type,reason,correlation_id)
 VALUES(NEW.id,'progress','available','in_progress','system','submission_accepted',NEW.id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.start_accepted_progress() FROM PUBLIC;
CREATE TRIGGER submission_starts_progress AFTER INSERT ON app.submissions
FOR EACH ROW EXECUTE FUNCTION app.start_accepted_progress();
-- Use the restricted product role as function owner without persistent SET access.
DO $$ DECLARE temporary boolean:=false; BEGIN
 IF NOT pg_has_role(current_user,'nextera_result_application','SET') THEN
 EXECUTE format('GRANT nextera_result_application TO %I',current_user); temporary:=true;
 END IF;
 GRANT CREATE ON SCHEMA app TO nextera_result_application;
 ALTER FUNCTION app.start_accepted_progress() OWNER TO nextera_result_application;
 REVOKE CREATE ON SCHEMA app FROM nextera_result_application;
 IF temporary THEN
 EXECUTE format('REVOKE nextera_result_application FROM %I GRANTED BY %I',current_user,current_user);
 IF pg_has_role(current_user,'nextera_result_application','SET') THEN RAISE EXCEPTION 'Owner SET access remains'; END IF;
 END IF;
END $$;


--> statement-breakpoint
-- Upgrade pending Foundation 004 submissions using their original accepted time.
WITH first_accepted AS (
 SELECT DISTINCT ON (s.cohort_id,s.user_id,s.curriculum_version_id,s.node_key)
 s.* FROM app.submissions s JOIN app.learner_node_progress p USING(cohort_id,user_id,curriculum_version_id,node_key)
 WHERE p.state='available' ORDER BY s.cohort_id,s.user_id,s.curriculum_version_id,s.node_key,s.created_at,s.id
), changed AS (
 UPDATE app.learner_node_progress p SET state='in_progress',started_at=s.created_at
 FROM first_accepted s WHERE p.cohort_id=s.cohort_id AND p.user_id=s.user_id
 AND p.curriculum_version_id=s.curriculum_version_id AND p.node_key=s.node_key
 RETURNING s.id
)
INSERT INTO app.state_events(submission_id,entity_type,previous_state,next_state,actor_type,reason,correlation_id)
SELECT id,'progress','available','in_progress','system','accepted_submission_progress_backfill',id FROM changed;


