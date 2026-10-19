CREATE TABLE "app"."checkpoint_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"request_id" uuid NOT NULL,
	"definition_digest" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_digest" text NOT NULL,
	"normal_slot" integer NOT NULL,
	"kind" text NOT NULL,
	"replacement_for" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"closure_reason" text,
	"status" text DEFAULT 'active' NOT NULL,
	"completed_at" timestamp with time zone,
	"retake_announced_at" timestamp with time zone,
	CONSTRAINT "checkpoint_attempt_identity" UNIQUE("id","cohort_id","user_id","curriculum_version_id","node_key"),
	CONSTRAINT "checkpoint_start_request" UNIQUE("cohort_id","user_id","request_id"),
	CONSTRAINT "checkpoint_attempt_digest" CHECK ("app"."checkpoint_attempts"."definition_digest" ~ '^[0-9a-f]{64}$' AND "app"."checkpoint_attempts"."snapshot_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "checkpoint_attempt_policy" CHECK ("app"."checkpoint_attempts"."normal_slot" IN (1,2) AND (("app"."checkpoint_attempts"."kind"='normal' AND "app"."checkpoint_attempts"."replacement_for" IS NULL) OR ("app"."checkpoint_attempts"."kind"='replacement' AND "app"."checkpoint_attempts"."replacement_for" IS NOT NULL)) AND "app"."checkpoint_attempts"."deadline_at"="app"."checkpoint_attempts"."started_at"+interval '90 minutes'),
	CONSTRAINT "checkpoint_attempt_lifecycle" CHECK (("app"."checkpoint_attempts"."status"='active' AND "app"."checkpoint_attempts"."closed_at" IS NULL AND "app"."checkpoint_attempts"."closure_reason" IS NULL AND "app"."checkpoint_attempts"."completed_at" IS NULL) OR ("app"."checkpoint_attempts"."status"='evaluating' AND "app"."checkpoint_attempts"."closed_at" IS NOT NULL AND "app"."checkpoint_attempts"."closure_reason" IN ('finished','expired') AND "app"."checkpoint_attempts"."completed_at" IS NULL) OR ("app"."checkpoint_attempts"."status" IN ('passed','failed','infrastructure_blocked') AND "app"."checkpoint_attempts"."closed_at" IS NOT NULL AND "app"."checkpoint_attempts"."closure_reason" IN ('finished','expired') AND "app"."checkpoint_attempts"."completed_at" IS NOT NULL)),
	CONSTRAINT "checkpoint_attempt_time_order" CHECK (("app"."checkpoint_attempts"."closed_at" IS NULL OR "app"."checkpoint_attempts"."closed_at">="app"."checkpoint_attempts"."started_at") AND ("app"."checkpoint_attempts"."completed_at" IS NULL OR "app"."checkpoint_attempts"."completed_at">="app"."checkpoint_attempts"."closed_at"))
);
--> statement-breakpoint
CREATE TABLE "app"."checkpoint_definitions" (
	"curriculum_version_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"definition_digest" text NOT NULL,
	"definition" jsonb NOT NULL,
	CONSTRAINT "checkpoint_definitions_curriculum_version_id_node_key_pk" PRIMARY KEY("curriculum_version_id","node_key"),
	CONSTRAINT "checkpoint_definition_digest" CHECK ("app"."checkpoint_definitions"."definition_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "checkpoint_definition_policy" CHECK ("app"."checkpoint_definitions"."definition"->>'policyVersion'='1' AND "app"."checkpoint_definitions"."definition"->>'durationSeconds'='5400' AND jsonb_array_length("app"."checkpoint_definitions"."definition"->'tasks')=4)
);
--> statement-breakpoint
CREATE TABLE "app"."checkpoint_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"cohort_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"status" text NOT NULL,
	"points" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"evidence_digest" text NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	CONSTRAINT "checkpoint_outcomes_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "checkpoint_outcome_identity" UNIQUE("id","cohort_id","user_id","curriculum_version_id","node_key"),
	CONSTRAINT "checkpoint_outcome_score" CHECK ("app"."checkpoint_outcomes"."points" BETWEEN 0 AND 4 AND (("app"."checkpoint_outcomes"."status"='passed' AND "app"."checkpoint_outcomes"."points">=3) OR ("app"."checkpoint_outcomes"."status" IN ('failed','infrastructure_blocked') AND "app"."checkpoint_outcomes"."points"<3))),
	CONSTRAINT "checkpoint_evidence_digest" CHECK ("app"."checkpoint_outcomes"."evidence_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."checkpoint_replacement_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replacement_attempt_id" uuid,
	CONSTRAINT "checkpoint_replacement_grants_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "checkpoint_replacement_grants_replacement_attempt_id_unique" UNIQUE("replacement_attempt_id"),
	CONSTRAINT "checkpoint_replacement_reason" CHECK ("app"."checkpoint_replacement_grants"."reason"='trusted_infrastructure_failure')
);
--> statement-breakpoint
ALTER TABLE "app"."learner_node_progress" DROP CONSTRAINT "progress_state_timestamps_check";--> statement-breakpoint
ALTER TABLE "app"."state_events" ALTER COLUMN "submission_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."activity_events" ADD COLUMN "checkpoint_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."activity_events" ADD COLUMN "checkpoint_outcome_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."learner_node_progress" ADD COLUMN "first_passing_checkpoint_outcome_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."state_events" ADD COLUMN "checkpoint_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."state_events" ADD COLUMN "checkpoint_outcome_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD COLUMN "checkpoint_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD COLUMN "checkpoint_task_key" text;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_attempts" ADD CONSTRAINT "checkpoint_attempts_cohort_id_user_id_cohort_memberships_cohort_id_user_id_fk" FOREIGN KEY ("cohort_id","user_id") REFERENCES "app"."cohort_memberships"("cohort_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_attempts" ADD CONSTRAINT "checkpoint_attempts_cohort_id_curriculum_version_id_cohorts_id_curriculum_version_id_fk" FOREIGN KEY ("cohort_id","curriculum_version_id") REFERENCES "app"."cohorts"("id","curriculum_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_attempts" ADD CONSTRAINT "checkpoint_attempts_curriculum_version_id_node_key_checkpoint_definitions_curriculum_version_id_node_key_fk" FOREIGN KEY ("curriculum_version_id","node_key") REFERENCES "app"."checkpoint_definitions"("curriculum_version_id","node_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_attempts" ADD CONSTRAINT "checkpoint_attempts_replacement_for_checkpoint_attempts_id_fk" FOREIGN KEY ("replacement_for") REFERENCES "app"."checkpoint_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_definitions" ADD CONSTRAINT "checkpoint_definitions_curriculum_version_id_node_key_curriculum_nodes_curriculum_version_id_node_key_fk" FOREIGN KEY ("curriculum_version_id","node_key") REFERENCES "app"."curriculum_nodes"("curriculum_version_id","node_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_outcomes" ADD CONSTRAINT "checkpoint_outcomes_attempt_id_cohort_id_user_id_curriculum_version_id_node_key_checkpoint_attempts_id_cohort_id_user_id_curriculum_version_id_node_key_fk" FOREIGN KEY ("attempt_id","cohort_id","user_id","curriculum_version_id","node_key") REFERENCES "app"."checkpoint_attempts"("id","cohort_id","user_id","curriculum_version_id","node_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_replacement_grants" ADD CONSTRAINT "checkpoint_replacement_grants_attempt_id_checkpoint_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "app"."checkpoint_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_replacement_grants" ADD CONSTRAINT "checkpoint_replacement_grants_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_replacement_grants" ADD CONSTRAINT "checkpoint_replacement_grants_replacement_attempt_id_checkpoint_attempts_id_fk" FOREIGN KEY ("replacement_attempt_id") REFERENCES "app"."checkpoint_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoint_one_open" ON "app"."checkpoint_attempts" USING btree ("cohort_id","user_id","node_key") WHERE "app"."checkpoint_attempts"."status" IN ('active','evaluating');--> statement-breakpoint
ALTER TABLE "app"."activity_events" ADD CONSTRAINT "activity_events_checkpoint_attempt_id_checkpoint_attempts_id_fk" FOREIGN KEY ("checkpoint_attempt_id") REFERENCES "app"."checkpoint_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."activity_events" ADD CONSTRAINT "activity_events_checkpoint_outcome_id_checkpoint_outcomes_id_fk" FOREIGN KEY ("checkpoint_outcome_id") REFERENCES "app"."checkpoint_outcomes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."learner_node_progress" ADD CONSTRAINT "progress_checkpoint_outcome_fk" FOREIGN KEY ("first_passing_checkpoint_outcome_id","cohort_id","user_id","curriculum_version_id","node_key") REFERENCES "app"."checkpoint_outcomes"("id","cohort_id","user_id","curriculum_version_id","node_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."state_events" ADD CONSTRAINT "state_events_checkpoint_attempt_id_checkpoint_attempts_id_fk" FOREIGN KEY ("checkpoint_attempt_id") REFERENCES "app"."checkpoint_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."state_events" ADD CONSTRAINT "state_events_checkpoint_outcome_id_checkpoint_outcomes_id_fk" FOREIGN KEY ("checkpoint_outcome_id") REFERENCES "app"."checkpoint_outcomes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submission_checkpoint_identity_fk" FOREIGN KEY ("checkpoint_attempt_id","cohort_id","user_id","curriculum_version_id","node_key") REFERENCES "app"."checkpoint_attempts"("id","cohort_id","user_id","curriculum_version_id","node_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."learner_node_progress" ADD CONSTRAINT "progress_state_timestamps_check" CHECK ((
    ("app"."learner_node_progress"."state" = 'locked' AND "app"."learner_node_progress"."unlocked_at" IS NULL AND "app"."learner_node_progress"."started_at" IS NULL AND "app"."learner_node_progress"."mastered_at" IS NULL AND "app"."learner_node_progress"."first_passing_submission_id" IS NULL AND "app"."learner_node_progress"."first_passing_checkpoint_outcome_id" IS NULL) OR
    ("app"."learner_node_progress"."state" = 'available' AND "app"."learner_node_progress"."unlocked_at" IS NOT NULL AND "app"."learner_node_progress"."started_at" IS NULL AND "app"."learner_node_progress"."mastered_at" IS NULL AND "app"."learner_node_progress"."first_passing_submission_id" IS NULL AND "app"."learner_node_progress"."first_passing_checkpoint_outcome_id" IS NULL) OR
    ("app"."learner_node_progress"."state" = 'in_progress' AND "app"."learner_node_progress"."unlocked_at" IS NOT NULL AND "app"."learner_node_progress"."started_at" IS NOT NULL AND "app"."learner_node_progress"."mastered_at" IS NULL AND "app"."learner_node_progress"."first_passing_submission_id" IS NULL AND "app"."learner_node_progress"."first_passing_checkpoint_outcome_id" IS NULL) OR
    ("app"."learner_node_progress"."state" = 'mastered' AND "app"."learner_node_progress"."unlocked_at" IS NOT NULL AND "app"."learner_node_progress"."started_at" IS NOT NULL AND "app"."learner_node_progress"."mastered_at" IS NOT NULL AND num_nonnulls("app"."learner_node_progress"."first_passing_submission_id","app"."learner_node_progress"."first_passing_checkpoint_outcome_id") = 1)
  ));--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submission_checkpoint_pair_check" CHECK (("app"."submissions"."checkpoint_attempt_id" IS NULL) = ("app"."submissions"."checkpoint_task_key" IS NULL));