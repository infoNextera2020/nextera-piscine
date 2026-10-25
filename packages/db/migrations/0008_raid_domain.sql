-- Approved three-member shared Raid contract. Apply only to an explicitly approved environment.
-- No login, credential, live assignment, curriculum or learner record is created here.
CREATE TABLE app.raid_teams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid NOT NULL,
 curriculum_version_id uuid NOT NULL, node_key text NOT NULL, name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 mentor_user_id uuid NOT NULL REFERENCES app.users(id), assigned_by uuid NOT NULL REFERENCES app.users(id), request_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(cohort_id,curriculum_version_id) REFERENCES app.cohorts(id,curriculum_version_id),
 FOREIGN KEY(curriculum_version_id,node_key) REFERENCES app.curriculum_nodes(curriculum_version_id,node_key), UNIQUE(assigned_by,request_id)
);
CREATE TABLE app.raid_team_members (
 team_id uuid NOT NULL REFERENCES app.raid_teams(id), user_id uuid NOT NULL REFERENCES app.users(id),
 PRIMARY KEY(team_id,user_id)
);
CREATE TABLE app.raid_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES app.raid_teams(id),
 submission_id uuid NOT NULL UNIQUE REFERENCES app.submissions(id), ordinal integer NOT NULL CHECK(ordinal>0),
 definition_digest text NOT NULL CHECK(definition_digest ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(team_id,ordinal)
);
CREATE TABLE app.raid_attempt_members (
 attempt_id uuid NOT NULL REFERENCES app.raid_attempts(id), user_id uuid NOT NULL,
 cohort_id uuid NOT NULL, curriculum_version_id uuid NOT NULL, node_key text NOT NULL,
 PRIMARY KEY(attempt_id,user_id), UNIQUE(attempt_id,user_id,cohort_id,curriculum_version_id,node_key),
 FOREIGN KEY(cohort_id,user_id) REFERENCES app.cohort_memberships(cohort_id,user_id),
 FOREIGN KEY(cohort_id,curriculum_version_id) REFERENCES app.cohorts(id,curriculum_version_id),
 FOREIGN KEY(curriculum_version_id,node_key) REFERENCES app.curriculum_nodes(curriculum_version_id,node_key)
);
CREATE TABLE app.raid_automated_receipts (
 attempt_id uuid PRIMARY KEY REFERENCES app.raid_attempts(id), result_id uuid NOT NULL UNIQUE REFERENCES judge.results(id),
 verdict app.submission_state NOT NULL CHECK(verdict NOT IN ('queued','running','cancelled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.raid_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid NOT NULL UNIQUE REFERENCES app.raid_attempts(id),
 reviewer_id uuid NOT NULL REFERENCES app.users(id), request_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approved','changes_requested')),
 feedback text NOT NULL CHECK(length(trim(feedback)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(reviewer_id,request_id), UNIQUE(id,attempt_id)
);
CREATE TABLE app.raid_outcomes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid NOT NULL UNIQUE REFERENCES app.raid_attempts(id),
 review_id uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,attempt_id), FOREIGN KEY(review_id,attempt_id) REFERENCES app.raid_reviews(id,attempt_id)
);
CREATE TABLE app.raid_member_receipts (
 outcome_id uuid NOT NULL, attempt_id uuid NOT NULL, user_id uuid NOT NULL,
 cohort_id uuid NOT NULL, curriculum_version_id uuid NOT NULL, node_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(outcome_id,user_id),
 UNIQUE(outcome_id,user_id,cohort_id,curriculum_version_id,node_key),
 FOREIGN KEY(outcome_id,attempt_id) REFERENCES app.raid_outcomes(id,attempt_id),
 FOREIGN KEY(attempt_id,user_id,cohort_id,curriculum_version_id,node_key)
 REFERENCES app.raid_attempt_members(attempt_id,user_id,cohort_id,curriculum_version_id,node_key)
);
CREATE TABLE app.raid_owner_holds (
 attempt_id uuid PRIMARY KEY REFERENCES app.raid_attempts(id), reason text NOT NULL CHECK(reason='member_access_removed'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX raid_teams_context_idx ON app.raid_teams(cohort_id,node_key) WHERE active;
CREATE INDEX raid_members_user_idx ON app.raid_team_members(user_id);
CREATE INDEX raid_attempt_history_idx ON app.raid_attempts(team_id,ordinal DESC);
--> statement-breakpoint
ALTER TABLE app.learner_node_progress ADD COLUMN first_passing_raid_outcome_id uuid;
ALTER TABLE app.learner_node_progress ADD CONSTRAINT progress_raid_outcome_fk
 FOREIGN KEY(first_passing_raid_outcome_id,user_id,cohort_id,curriculum_version_id,node_key)
 REFERENCES app.raid_member_receipts(outcome_id,user_id,cohort_id,curriculum_version_id,node_key);
ALTER TABLE app.learner_node_progress DROP CONSTRAINT progress_state_timestamps_check;
ALTER TABLE app.learner_node_progress ADD CONSTRAINT progress_state_timestamps_check CHECK (
 (state='locked' AND unlocked_at IS NULL AND started_at IS NULL AND mastered_at IS NULL AND num_nonnulls(first_passing_submission_id,first_passing_checkpoint_outcome_id,first_passing_raid_outcome_id)=0) OR
 (state='available' AND unlocked_at IS NOT NULL AND started_at IS NULL AND mastered_at IS NULL AND num_nonnulls(first_passing_submission_id,first_passing_checkpoint_outcome_id,first_passing_raid_outcome_id)=0) OR
 (state='in_progress' AND unlocked_at IS NOT NULL AND started_at IS NOT NULL AND mastered_at IS NULL AND num_nonnulls(first_passing_submission_id,first_passing_checkpoint_outcome_id,first_passing_raid_outcome_id)=0) OR
 (state='mastered' AND unlocked_at IS NOT NULL AND started_at IS NOT NULL AND mastered_at IS NOT NULL AND num_nonnulls(first_passing_submission_id,first_passing_checkpoint_outcome_id,first_passing_raid_outcome_id)=1)
);
--> statement-breakpoint
CREATE FUNCTION app.guard_raid_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_TABLE_NAME='raid_teams' AND TG_OP='UPDATE' AND (to_jsonb(OLD)-'active')=(to_jsonb(NEW)-'active') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Raid evidence is immutable';
END $$;
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['raid_teams','raid_team_members','raid_attempts','raid_attempt_members','raid_automated_receipts','raid_reviews','raid_outcomes','raid_member_receipts','raid_owner_holds'] LOOP
 EXECUTE format('CREATE TRIGGER raid_history_immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_raid_history()',n);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC',n);
 END LOOP;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_raid_owner') THEN
 CREATE ROLE nextera_raid_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_raid_owner' AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='nextera_raid_owner') THEN
 RAISE EXCEPTION 'Raid owner must be an isolated NOLOGIN permission role'; END IF;
END $$;
GRANT USAGE ON SCHEMA app,judge TO nextera_raid_owner;
GRANT SELECT,INSERT ON app.raid_teams,app.raid_team_members,app.raid_attempts,app.raid_attempt_members,
 app.raid_automated_receipts,app.raid_reviews,app.raid_outcomes,app.raid_member_receipts,app.raid_owner_holds TO nextera_raid_owner;
GRANT UPDATE(active) ON app.raid_teams TO nextera_raid_owner;
GRANT SELECT ON app.users,app.cohorts,app.cohort_memberships,app.curriculum_versions,app.curriculum_nodes,
 app.node_prerequisites,app.learner_node_progress,app.submissions,app.submission_artifacts,judge.jobs,judge.attempts,judge.results TO nextera_raid_owner;
GRANT UPDATE(id) ON app.users,app.cohorts,judge.jobs TO nextera_raid_owner;
GRANT UPDATE(joined_at) ON app.cohort_memberships TO nextera_raid_owner;
GRANT UPDATE(state,finished_at) ON app.submissions TO nextera_raid_owner;
GRANT UPDATE(application_status,processed_at,application_reason) ON judge.results TO nextera_raid_owner;
GRANT UPDATE(state,unlocked_at,started_at,mastered_at,first_passing_raid_outcome_id) ON app.learner_node_progress TO nextera_raid_owner;
GRANT INSERT ON app.state_events,app.activity_events TO nextera_raid_owner;
GRANT EXECUTE ON FUNCTION app.submission_context(uuid,uuid,text),app.accept_submission(uuid,uuid,text,uuid,text,bigint,text) TO nextera_raid_owner;
--> statement-breakpoint
CREATE FUNCTION app.check_raid_roster() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer; BEGIN
 IF TG_TABLE_NAME='raid_team_members' THEN SELECT count(*) INTO n FROM app.raid_team_members WHERE team_id=NEW.team_id;
 ELSE SELECT count(*) INTO n FROM app.raid_attempt_members WHERE attempt_id=NEW.attempt_id; END IF;
 IF n<>3 THEN RAISE EXCEPTION 'RAID_REQUIRES_THREE_MEMBERS' USING ERRCODE='22023'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER raid_team_size AFTER INSERT ON app.raid_team_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_raid_roster();
CREATE CONSTRAINT TRIGGER raid_snapshot_size AFTER INSERT ON app.raid_attempt_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_raid_roster();
