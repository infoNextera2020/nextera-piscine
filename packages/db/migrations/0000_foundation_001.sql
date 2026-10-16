CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "judge";
--> statement-breakpoint
CREATE TYPE "judge"."attempt_state" AS ENUM('claimed', 'running', 'completed', 'system_error');--> statement-breakpoint
CREATE TYPE "judge"."job_state" AS ENUM('queued', 'claimed', 'running', 'completed', 'system_error');--> statement-breakpoint
CREATE TYPE "app"."progress_state" AS ENUM('locked', 'available', 'in_progress', 'mastered');--> statement-breakpoint
CREATE TYPE "judge"."result_application_status" AS ENUM('pending', 'applied', 'superseded');--> statement-breakpoint
CREATE TYPE "app"."submission_state" AS ENUM('queued', 'running', 'passed', 'failed', 'compile_error', 'runtime_error', 'timeout', 'system_error', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."user_role" AS ENUM('learner', 'operator', 'admin');--> statement-breakpoint
CREATE TABLE "app"."activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"user_id" uuid,
	"cohort_id" uuid,
	"curriculum_version_id" uuid,
	"node_key" text,
	"submission_id" uuid,
	"result_id" uuid,
	"correlation_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_events_version_check" CHECK ("app"."activity_events"."event_version" > 0),
	CONSTRAINT "activity_events_node_context_check" CHECK ("app"."activity_events"."node_key" IS NULL OR "app"."activity_events"."curriculum_version_id" IS NOT NULL),
	CONSTRAINT "activity_events_payload_check" CHECK (jsonb_typeof("app"."activity_events"."payload") = 'object' AND octet_length("app"."activity_events"."payload"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "app"."cohort_memberships" (
	"cohort_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cohort_memberships_cohort_id_user_id_pk" PRIMARY KEY("cohort_id","user_id"),
	CONSTRAINT "memberships_status_check" CHECK ("app"."cohort_memberships"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "app"."cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"status" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	CONSTRAINT "cohorts_slug_unique" UNIQUE("slug"),
	CONSTRAINT "cohorts_id_version_unique" UNIQUE("id","curriculum_version_id"),
	CONSTRAINT "cohorts_status_check" CHECK (length(trim("app"."cohorts"."status")) > 0),
	CONSTRAINT "cohorts_dates_check" CHECK ("app"."cohorts"."ends_at" IS NULL OR "app"."cohorts"."ends_at" >= "app"."cohorts"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "app"."curriculum_nodes" (
	"curriculum_version_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"quest_key" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"subject_markdown" text NOT NULL,
	"subject_digest" text NOT NULL,
	"skills" text[] NOT NULL,
	"submission_rules" jsonb NOT NULL,
	"resolved_evaluation_spec" jsonb NOT NULL,
	"evaluation_spec_digest" text NOT NULL,
	CONSTRAINT "curriculum_nodes_curriculum_version_id_node_key_pk" PRIMARY KEY("curriculum_version_id","node_key"),
	CONSTRAINT "nodes_position_unique" UNIQUE("curriculum_version_id","quest_key","position"),
	CONSTRAINT "nodes_kind_check" CHECK ("app"."curriculum_nodes"."kind" IN ('challenge', 'project', 'checkpoint')),
	CONSTRAINT "nodes_position_check" CHECK ("app"."curriculum_nodes"."position" > 0),
	CONSTRAINT "nodes_difficulty_check" CHECK ("app"."curriculum_nodes"."difficulty" > 0),
	CONSTRAINT "nodes_subject_digest_check" CHECK ("app"."curriculum_nodes"."subject_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "nodes_evaluation_digest_check" CHECK ("app"."curriculum_nodes"."evaluation_spec_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "nodes_submission_rules_check" CHECK (jsonb_typeof("app"."curriculum_nodes"."submission_rules") = 'object'),
	CONSTRAINT "nodes_resource_limits_check" CHECK (coalesce((jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec") = 'object' AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->'cpu_limit') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->>'cpu_limit')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->'memory_bytes') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->>'memory_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->'pid_limit') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->>'pid_limit')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->'timeout_ms') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->>'timeout_ms')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->'output_bytes') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->>'output_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->'temporary_filesystem_bytes') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->>'temporary_filesystem_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->'temporary_filesystem_inodes') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'compilation'->>'temporary_filesystem_inodes')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->'cpu_limit') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->>'cpu_limit')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->'memory_bytes') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->>'memory_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->'pid_limit') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->>'pid_limit')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->'timeout_ms') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->>'timeout_ms')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->'output_bytes') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->>'output_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->'temporary_filesystem_bytes') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->>'temporary_filesystem_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->'temporary_filesystem_inodes') = 'number'
      AND ("app"."curriculum_nodes"."resolved_evaluation_spec"->'resource_limits'->'execution'->>'temporary_filesystem_inodes')::numeric > 0
    )), false))
);
--> statement-breakpoint
CREATE TABLE "app"."curriculum_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_key" text NOT NULL,
	"version" text NOT NULL,
	"git_commit_sha" text NOT NULL,
	"content_digest" text NOT NULL,
	"digest_format_version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "curriculum_key_version_unique" UNIQUE("curriculum_key","version"),
	CONSTRAINT "curriculum_git_commit_check" CHECK ("app"."curriculum_versions"."git_commit_sha" ~ '^[0-9a-f]{40}$|^[0-9a-f]{64}$'),
	CONSTRAINT "curriculum_content_digest_check" CHECK ("app"."curriculum_versions"."content_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "curriculum_digest_format_check" CHECK ("app"."curriculum_versions"."digest_format_version" > 0),
	CONSTRAINT "curriculum_publication_check" CHECK ((
    ("app"."curriculum_versions"."status" = 'draft' AND "app"."curriculum_versions"."published_at" IS NULL) OR
    ("app"."curriculum_versions"."status" = 'published' AND "app"."curriculum_versions"."published_at" IS NOT NULL)
  ))
);
--> statement-breakpoint
CREATE TABLE "judge"."attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"worker_id" uuid NOT NULL,
	"lease_generation" bigint NOT NULL,
	"claim_token" uuid NOT NULL,
	"state" "judge"."attempt_state" DEFAULT 'claimed' NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"infrastructure_error_code" text,
	CONSTRAINT "attempts_job_number_unique" UNIQUE("job_id","attempt_number"),
	CONSTRAINT "attempts_id_job_unique" UNIQUE("id","job_id"),
	CONSTRAINT "attempts_claim_identity_unique" UNIQUE("id","job_id","worker_id","lease_generation"),
	CONSTRAINT "attempts_number_check" CHECK ("judge"."attempts"."attempt_number" BETWEEN 1 AND 3),
	CONSTRAINT "attempts_generation_check" CHECK ("judge"."attempts"."lease_generation" > 0),
	CONSTRAINT "attempts_lifecycle_check" CHECK ((
    ("judge"."attempts"."state" = 'claimed' AND "judge"."attempts"."started_at" IS NULL AND "judge"."attempts"."finished_at" IS NULL AND "judge"."attempts"."infrastructure_error_code" IS NULL) OR
    ("judge"."attempts"."state" = 'running' AND "judge"."attempts"."started_at" IS NOT NULL AND "judge"."attempts"."finished_at" IS NULL AND "judge"."attempts"."infrastructure_error_code" IS NULL) OR
    ("judge"."attempts"."state" = 'completed' AND "judge"."attempts"."started_at" IS NOT NULL AND "judge"."attempts"."finished_at" IS NOT NULL AND "judge"."attempts"."infrastructure_error_code" IS NULL) OR
    ("judge"."attempts"."state" = 'system_error' AND "judge"."attempts"."finished_at" IS NOT NULL AND "judge"."attempts"."infrastructure_error_code" IS NOT NULL)
  )),
	CONSTRAINT "attempts_timestamps_check" CHECK (("judge"."attempts"."started_at" IS NULL OR "judge"."attempts"."started_at" >= "judge"."attempts"."claimed_at") AND ("judge"."attempts"."finished_at" IS NULL OR ("judge"."attempts"."finished_at" >= "judge"."attempts"."claimed_at" AND ("judge"."attempts"."started_at" IS NULL OR "judge"."attempts"."finished_at" >= "judge"."attempts"."started_at"))))
);
--> statement-breakpoint
CREATE TABLE "judge"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"evaluation_number" integer DEFAULT 1 NOT NULL,
	"state" "judge"."job_state" DEFAULT 'queued' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"protocol_version" integer NOT NULL,
	"evaluation_snapshot" jsonb NOT NULL,
	"evaluation_digest" text NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"lease_generation" bigint DEFAULT 1 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"current_worker_id" uuid,
	"current_attempt_id" uuid,
	"terminal_result_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_submission_evaluation_unique" UNIQUE("submission_id","evaluation_number"),
	CONSTRAINT "jobs_id_submission_unique" UNIQUE("id","submission_id"),
	CONSTRAINT "jobs_evaluation_number_check" CHECK ("judge"."jobs"."evaluation_number" > 0),
	CONSTRAINT "jobs_protocol_check" CHECK ("judge"."jobs"."protocol_version" > 0),
	CONSTRAINT "jobs_retry_count_check" CHECK ("judge"."jobs"."retry_count" BETWEEN 0 AND 2),
	CONSTRAINT "jobs_lease_generation_check" CHECK ("judge"."jobs"."lease_generation" > 0),
	CONSTRAINT "jobs_evaluation_digest_check" CHECK ("judge"."jobs"."evaluation_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "jobs_resource_limits_check" CHECK (coalesce((jsonb_typeof("judge"."jobs"."evaluation_snapshot") = 'object' AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->'cpu_limit') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->>'cpu_limit')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->'memory_bytes') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->>'memory_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->'pid_limit') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->>'pid_limit')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->'timeout_ms') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->>'timeout_ms')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->'output_bytes') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->>'output_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->'temporary_filesystem_bytes') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->>'temporary_filesystem_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->'temporary_filesystem_inodes') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'compilation'->>'temporary_filesystem_inodes')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->'cpu_limit') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->>'cpu_limit')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->'memory_bytes') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->>'memory_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->'pid_limit') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->>'pid_limit')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->'timeout_ms') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->>'timeout_ms')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->'output_bytes') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->>'output_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->'temporary_filesystem_bytes') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->>'temporary_filesystem_bytes')::numeric > 0
    ) AND (
      jsonb_typeof("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->'temporary_filesystem_inodes') = 'number'
      AND ("judge"."jobs"."evaluation_snapshot"->'resource_limits'->'execution'->>'temporary_filesystem_inodes')::numeric > 0
    )), false)),
	CONSTRAINT "jobs_lifecycle_check" CHECK ((
    ("judge"."jobs"."state" = 'queued' AND "judge"."jobs"."lease_token" IS NULL AND "judge"."jobs"."lease_expires_at" IS NULL AND "judge"."jobs"."current_worker_id" IS NULL AND "judge"."jobs"."current_attempt_id" IS NULL AND "judge"."jobs"."terminal_result_id" IS NULL AND "judge"."jobs"."finished_at" IS NULL) OR
    ("judge"."jobs"."state" IN ('claimed', 'running') AND "judge"."jobs"."lease_token" IS NOT NULL AND "judge"."jobs"."lease_expires_at" IS NOT NULL AND "judge"."jobs"."current_worker_id" IS NOT NULL AND "judge"."jobs"."current_attempt_id" IS NOT NULL AND "judge"."jobs"."terminal_result_id" IS NULL AND "judge"."jobs"."finished_at" IS NULL) OR
    ("judge"."jobs"."state" IN ('completed', 'system_error') AND "judge"."jobs"."lease_token" IS NULL AND "judge"."jobs"."lease_expires_at" IS NULL AND "judge"."jobs"."current_worker_id" IS NOT NULL AND "judge"."jobs"."current_attempt_id" IS NOT NULL AND "judge"."jobs"."terminal_result_id" IS NOT NULL AND "judge"."jobs"."finished_at" IS NOT NULL)
  )),
	CONSTRAINT "jobs_timestamps_check" CHECK (("judge"."jobs"."finished_at" IS NULL OR "judge"."jobs"."finished_at" >= "judge"."jobs"."created_at") AND ("judge"."jobs"."lease_expires_at" IS NULL OR "judge"."jobs"."lease_expires_at" > "judge"."jobs"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "judge"."results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"evaluation_digest" text NOT NULL,
	"verdict" "app"."submission_state" NOT NULL,
	"measurements" jsonb NOT NULL,
	"learner_feedback" jsonb NOT NULL,
	"safe_operator_diagnostics" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"application_status" "judge"."result_application_status" DEFAULT 'pending' NOT NULL,
	"processed_at" timestamp with time zone,
	"application_reason" text,
	CONSTRAINT "results_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "results_id_job_attempt_unique" UNIQUE("id","job_id","attempt_id"),
	CONSTRAINT "results_evaluation_digest_check" CHECK ("judge"."results"."evaluation_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "results_terminal_verdict_check" CHECK ("judge"."results"."verdict" NOT IN ('queued', 'running')),
	CONSTRAINT "results_measurements_check" CHECK (jsonb_typeof("judge"."results"."measurements") = 'object' AND NOT jsonb_path_exists("judge"."results"."measurements", '$.* ? (@.type() != "number" || @ < 0)')),
	CONSTRAINT "results_feedback_check" CHECK (jsonb_typeof("judge"."results"."learner_feedback") = 'object' AND octet_length("judge"."results"."learner_feedback"::text) <= 65536),
	CONSTRAINT "results_diagnostics_check" CHECK (jsonb_typeof("judge"."results"."safe_operator_diagnostics") = 'object' AND octet_length("judge"."results"."safe_operator_diagnostics"::text) <= 65536),
	CONSTRAINT "results_application_check" CHECK ((
    ("judge"."results"."application_status" = 'pending' AND "judge"."results"."processed_at" IS NULL AND "judge"."results"."application_reason" IS NULL) OR
    ("judge"."results"."application_status" = 'applied' AND "judge"."results"."processed_at" IS NOT NULL) OR
    ("judge"."results"."application_status" = 'superseded' AND "judge"."results"."processed_at" IS NOT NULL AND "judge"."results"."application_reason" IS NOT NULL AND length(trim("judge"."results"."application_reason")) > 0)
  )),
	CONSTRAINT "results_timestamps_check" CHECK ("judge"."results"."processed_at" IS NULL OR "judge"."results"."processed_at" >= "judge"."results"."recorded_at")
);
--> statement-breakpoint
CREATE TABLE "judge"."workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"db_principal" text NOT NULL,
	"runner_image_digest" text NOT NULL,
	"protocol_versions" integer[] NOT NULL,
	"platform" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	CONSTRAINT "workers_db_principal_unique" UNIQUE("db_principal"),
	CONSTRAINT "workers_image_digest_check" CHECK ("judge"."workers"."runner_image_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "workers_protocols_check" CHECK (cardinality("judge"."workers"."protocol_versions") > 0 AND 0 < ALL("judge"."workers"."protocol_versions") AND array_position("judge"."workers"."protocol_versions", NULL) IS NULL),
	CONSTRAINT "workers_capabilities_check" CHECK (jsonb_typeof("judge"."workers"."capabilities") = 'object')
);
--> statement-breakpoint
CREATE TABLE "app"."learner_node_progress" (
	"cohort_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"state" "app"."progress_state" NOT NULL,
	"unlocked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"mastered_at" timestamp with time zone,
	"first_passing_submission_id" uuid,
	CONSTRAINT "learner_node_progress_pk" PRIMARY KEY("cohort_id","user_id","curriculum_version_id","node_key"),
	CONSTRAINT "progress_state_timestamps_check" CHECK ((
    ("app"."learner_node_progress"."state" = 'locked' AND "app"."learner_node_progress"."unlocked_at" IS NULL AND "app"."learner_node_progress"."started_at" IS NULL AND "app"."learner_node_progress"."mastered_at" IS NULL AND "app"."learner_node_progress"."first_passing_submission_id" IS NULL) OR
    ("app"."learner_node_progress"."state" = 'available' AND "app"."learner_node_progress"."unlocked_at" IS NOT NULL AND "app"."learner_node_progress"."started_at" IS NULL AND "app"."learner_node_progress"."mastered_at" IS NULL AND "app"."learner_node_progress"."first_passing_submission_id" IS NULL) OR
    ("app"."learner_node_progress"."state" = 'in_progress' AND "app"."learner_node_progress"."unlocked_at" IS NOT NULL AND "app"."learner_node_progress"."started_at" IS NOT NULL AND "app"."learner_node_progress"."mastered_at" IS NULL AND "app"."learner_node_progress"."first_passing_submission_id" IS NULL) OR
    ("app"."learner_node_progress"."state" = 'mastered' AND "app"."learner_node_progress"."unlocked_at" IS NOT NULL AND "app"."learner_node_progress"."started_at" IS NOT NULL AND "app"."learner_node_progress"."mastered_at" IS NOT NULL AND "app"."learner_node_progress"."first_passing_submission_id" IS NOT NULL)
  )),
	CONSTRAINT "progress_timestamp_order_check" CHECK (("app"."learner_node_progress"."started_at" IS NULL OR "app"."learner_node_progress"."started_at" >= "app"."learner_node_progress"."unlocked_at") AND ("app"."learner_node_progress"."mastered_at" IS NULL OR "app"."learner_node_progress"."mastered_at" >= "app"."learner_node_progress"."started_at"))
);
--> statement-breakpoint
CREATE TABLE "app"."node_prerequisites" (
	"curriculum_version_id" uuid NOT NULL,
	"prerequisite_node_key" text NOT NULL,
	"dependent_node_key" text NOT NULL,
	"rule" text NOT NULL,
	CONSTRAINT "node_prerequisites_pk" PRIMARY KEY("curriculum_version_id","prerequisite_node_key","dependent_node_key"),
	CONSTRAINT "prerequisites_rule_check" CHECK ("app"."node_prerequisites"."rule" = 'requires_pass'),
	CONSTRAINT "prerequisites_no_self_edge_check" CHECK ("app"."node_prerequisites"."prerequisite_node_key" <> "app"."node_prerequisites"."dependent_node_key")
);
--> statement-breakpoint
CREATE TABLE "app"."quests" (
	"curriculum_version_id" uuid NOT NULL,
	"quest_key" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "quests_curriculum_version_id_quest_key_pk" PRIMARY KEY("curriculum_version_id","quest_key"),
	CONSTRAINT "quests_position_unique" UNIQUE("curriculum_version_id","position"),
	CONSTRAINT "quests_position_check" CHECK ("app"."quests"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."state_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"job_id" uuid,
	"attempt_id" uuid,
	"result_id" uuid,
	"entity_type" text NOT NULL,
	"previous_state" text,
	"next_state" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "state_events_entity_check" CHECK ("app"."state_events"."entity_type" IN ('submission', 'job', 'attempt', 'progress')),
	CONSTRAINT "state_events_actor_check" CHECK (("app"."state_events"."actor_type" IN ('user', 'worker') AND "app"."state_events"."actor_id" IS NOT NULL) OR ("app"."state_events"."actor_type" = 'system' AND "app"."state_events"."actor_id" IS NULL)),
	CONSTRAINT "state_events_context_check" CHECK (("app"."state_events"."attempt_id" IS NULL OR "app"."state_events"."job_id" IS NOT NULL) AND ("app"."state_events"."result_id" IS NULL OR ("app"."state_events"."job_id" IS NOT NULL AND "app"."state_events"."attempt_id" IS NOT NULL))),
	CONSTRAINT "state_events_state_check" CHECK ((
    ("app"."state_events"."entity_type" = 'submission' AND "app"."state_events"."next_state" IN ('queued', 'running', 'passed', 'failed', 'compile_error', 'runtime_error', 'timeout', 'system_error', 'cancelled') AND ("app"."state_events"."previous_state" IS NULL OR "app"."state_events"."previous_state" IN ('queued', 'running', 'passed', 'failed', 'compile_error', 'runtime_error', 'timeout', 'system_error', 'cancelled'))) OR
    ("app"."state_events"."entity_type" = 'job' AND "app"."state_events"."next_state" IN ('queued', 'claimed', 'running', 'completed', 'system_error') AND ("app"."state_events"."previous_state" IS NULL OR "app"."state_events"."previous_state" IN ('queued', 'claimed', 'running', 'completed', 'system_error'))) OR
    ("app"."state_events"."entity_type" = 'attempt' AND "app"."state_events"."next_state" IN ('claimed', 'running', 'completed', 'system_error') AND ("app"."state_events"."previous_state" IS NULL OR "app"."state_events"."previous_state" IN ('claimed', 'running', 'completed', 'system_error'))) OR
    ("app"."state_events"."entity_type" = 'progress' AND "app"."state_events"."next_state" IN ('locked', 'available', 'in_progress', 'mastered') AND ("app"."state_events"."previous_state" IS NULL OR "app"."state_events"."previous_state" IN ('locked', 'available', 'in_progress', 'mastered')))
  ))
);
--> statement-breakpoint
CREATE TABLE "app"."submission_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_storage_unique" UNIQUE("storage_bucket","storage_key"),
	CONSTRAINT "artifacts_id_owner_unique" UNIQUE("id","owner_user_id"),
	CONSTRAINT "artifacts_size_check" CHECK ("app"."submission_artifacts"."size_bytes" > 0),
	CONSTRAINT "artifacts_digest_check" CHECK ("app"."submission_artifacts"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"artifact_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" "app"."submission_state" DEFAULT 'queued' NOT NULL,
	"evaluation_spec_digest" text NOT NULL,
	"active_judge_job_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "submissions_idempotency_unique" UNIQUE("cohort_id","user_id","idempotency_key"),
	CONSTRAINT "submissions_progress_evidence_unique" UNIQUE("id","cohort_id","user_id","curriculum_version_id","node_key"),
	CONSTRAINT "submissions_evaluation_digest_check" CHECK ("app"."submissions"."evaluation_spec_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "submissions_timestamps_check" CHECK (("app"."submissions"."started_at" IS NULL OR "app"."submissions"."started_at" >= "app"."submissions"."created_at") AND ("app"."submissions"."finished_at" IS NULL OR ("app"."submissions"."finished_at" >= "app"."submissions"."created_at" AND ("app"."submissions"."started_at" IS NULL OR "app"."submissions"."finished_at" >= "app"."submissions"."started_at")))),
	CONSTRAINT "submissions_lifecycle_check" CHECK (("app"."submissions"."state" = 'queued' AND "app"."submissions"."finished_at" IS NULL) OR ("app"."submissions"."state" = 'running' AND "app"."submissions"."started_at" IS NOT NULL AND "app"."submissions"."finished_at" IS NULL) OR ("app"."submissions"."state" NOT IN ('queued', 'running') AND "app"."submissions"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"role" "app"."user_role" DEFAULT 'learner' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "users_timestamps_check" CHECK ("app"."users"."updated_at" >= "app"."users"."created_at")
);
--> statement-breakpoint
ALTER TABLE "app"."activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."activity_events" ADD CONSTRAINT "activity_events_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "app"."cohorts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."activity_events" ADD CONSTRAINT "activity_events_curriculum_version_id_curriculum_versions_id_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "app"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."activity_events" ADD CONSTRAINT "activity_events_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."activity_events" ADD CONSTRAINT "activity_events_result_id_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "judge"."results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."activity_events" ADD CONSTRAINT "activity_events_node_fk" FOREIGN KEY ("curriculum_version_id","node_key") REFERENCES "app"."curriculum_nodes"("curriculum_version_id","node_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."activity_events" ADD CONSTRAINT "activity_events_cohort_version_fk" FOREIGN KEY ("cohort_id","curriculum_version_id") REFERENCES "app"."cohorts"("id","curriculum_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cohort_memberships" ADD CONSTRAINT "cohort_memberships_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "app"."cohorts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cohort_memberships" ADD CONSTRAINT "cohort_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cohorts" ADD CONSTRAINT "cohorts_curriculum_version_id_curriculum_versions_id_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "app"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."curriculum_nodes" ADD CONSTRAINT "nodes_quest_fk" FOREIGN KEY ("curriculum_version_id","quest_key") REFERENCES "app"."quests"("curriculum_version_id","quest_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge"."attempts" ADD CONSTRAINT "attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "judge"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge"."attempts" ADD CONSTRAINT "attempts_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "judge"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge"."jobs" ADD CONSTRAINT "jobs_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge"."jobs" ADD CONSTRAINT "jobs_current_worker_id_workers_id_fk" FOREIGN KEY ("current_worker_id") REFERENCES "judge"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge"."jobs" ADD CONSTRAINT "jobs_current_attempt_fk" FOREIGN KEY ("current_attempt_id","id","current_worker_id","lease_generation") REFERENCES "judge"."attempts"("id","job_id","worker_id","lease_generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge"."jobs" ADD CONSTRAINT "jobs_terminal_result_fk" FOREIGN KEY ("terminal_result_id","id","current_attempt_id") REFERENCES "judge"."results"("id","job_id","attempt_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge"."results" ADD CONSTRAINT "results_attempt_job_fk" FOREIGN KEY ("attempt_id","job_id") REFERENCES "judge"."attempts"("id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."learner_node_progress" ADD CONSTRAINT "progress_membership_fk" FOREIGN KEY ("cohort_id","user_id") REFERENCES "app"."cohort_memberships"("cohort_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."learner_node_progress" ADD CONSTRAINT "progress_cohort_version_fk" FOREIGN KEY ("cohort_id","curriculum_version_id") REFERENCES "app"."cohorts"("id","curriculum_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."learner_node_progress" ADD CONSTRAINT "progress_node_fk" FOREIGN KEY ("curriculum_version_id","node_key") REFERENCES "app"."curriculum_nodes"("curriculum_version_id","node_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."learner_node_progress" ADD CONSTRAINT "progress_first_passing_submission_fk" FOREIGN KEY ("first_passing_submission_id","cohort_id","user_id","curriculum_version_id","node_key") REFERENCES "app"."submissions"("id","cohort_id","user_id","curriculum_version_id","node_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."node_prerequisites" ADD CONSTRAINT "prerequisites_source_fk" FOREIGN KEY ("curriculum_version_id","prerequisite_node_key") REFERENCES "app"."curriculum_nodes"("curriculum_version_id","node_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."node_prerequisites" ADD CONSTRAINT "prerequisites_target_fk" FOREIGN KEY ("curriculum_version_id","dependent_node_key") REFERENCES "app"."curriculum_nodes"("curriculum_version_id","node_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quests" ADD CONSTRAINT "quests_curriculum_version_id_curriculum_versions_id_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "app"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."state_events" ADD CONSTRAINT "state_events_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."state_events" ADD CONSTRAINT "state_events_job_submission_fk" FOREIGN KEY ("job_id","submission_id") REFERENCES "judge"."jobs"("id","submission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."state_events" ADD CONSTRAINT "state_events_attempt_job_fk" FOREIGN KEY ("attempt_id","job_id") REFERENCES "judge"."attempts"("id","job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."state_events" ADD CONSTRAINT "state_events_result_fk" FOREIGN KEY ("result_id","job_id","attempt_id") REFERENCES "judge"."results"("id","job_id","attempt_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submission_artifacts" ADD CONSTRAINT "submission_artifacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_membership_fk" FOREIGN KEY ("cohort_id","user_id") REFERENCES "app"."cohort_memberships"("cohort_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_cohort_version_fk" FOREIGN KEY ("cohort_id","curriculum_version_id") REFERENCES "app"."cohorts"("id","curriculum_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_node_fk" FOREIGN KEY ("curriculum_version_id","node_key") REFERENCES "app"."curriculum_nodes"("curriculum_version_id","node_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_artifact_owner_fk" FOREIGN KEY ("artifact_id","user_id") REFERENCES "app"."submission_artifacts"("id","owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_active_job_fk" FOREIGN KEY ("active_judge_job_id","id") REFERENCES "judge"."jobs"("id","submission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."users" ADD CONSTRAINT "users_auth_user_id_users_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_cohort_type_idx" ON "app"."activity_events" USING btree ("cohort_id","event_type","occurred_at","id");--> statement-breakpoint
CREATE INDEX "activity_events_user_idx" ON "app"."activity_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_events_curriculum_node_idx" ON "app"."activity_events" USING btree ("curriculum_version_id","node_key");--> statement-breakpoint
CREATE INDEX "activity_events_submission_idx" ON "app"."activity_events" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "activity_events_result_idx" ON "app"."activity_events" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "app"."cohort_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cohorts_curriculum_idx" ON "app"."cohorts" USING btree ("curriculum_version_id");--> statement-breakpoint
CREATE INDEX "attempts_worker_idx" ON "judge"."attempts" USING btree ("worker_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_active_submission_idx" ON "judge"."jobs" USING btree ("submission_id") WHERE "judge"."jobs"."state" IN ('queued', 'claimed', 'running');--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "judge"."jobs" USING btree ("available_at","id") WHERE "judge"."jobs"."state" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_expired_lease_idx" ON "judge"."jobs" USING btree ("lease_expires_at","id") WHERE "judge"."jobs"."state" IN ('claimed', 'running');--> statement-breakpoint
CREATE INDEX "jobs_current_worker_idx" ON "judge"."jobs" USING btree ("current_worker_id");--> statement-breakpoint
CREATE INDEX "jobs_current_attempt_idx" ON "judge"."jobs" USING btree ("current_attempt_id");--> statement-breakpoint
CREATE INDEX "jobs_terminal_result_idx" ON "judge"."jobs" USING btree ("terminal_result_id");--> statement-breakpoint
CREATE INDEX "results_job_idx" ON "judge"."results" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "results_pending_idx" ON "judge"."results" USING btree ("recorded_at","id") WHERE "judge"."results"."application_status" = 'pending';--> statement-breakpoint
CREATE INDEX "workers_heartbeat_idx" ON "judge"."workers" USING btree ("last_heartbeat_at") WHERE "judge"."workers"."enabled" = true;--> statement-breakpoint
CREATE INDEX "progress_dashboard_idx" ON "app"."learner_node_progress" USING btree ("cohort_id","user_id","state");--> statement-breakpoint
CREATE INDEX "progress_node_idx" ON "app"."learner_node_progress" USING btree ("curriculum_version_id","node_key");--> statement-breakpoint
CREATE INDEX "progress_passing_submission_idx" ON "app"."learner_node_progress" USING btree ("first_passing_submission_id");--> statement-breakpoint
CREATE INDEX "prerequisites_dependent_idx" ON "app"."node_prerequisites" USING btree ("curriculum_version_id","dependent_node_key");--> statement-breakpoint
CREATE INDEX "state_events_submission_idx" ON "app"."state_events" USING btree ("submission_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "state_events_job_idx" ON "app"."state_events" USING btree ("job_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "state_events_attempt_idx" ON "app"."state_events" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "state_events_result_idx" ON "app"."state_events" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX "artifacts_owner_idx" ON "app"."submission_artifacts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "submissions_history_idx" ON "app"."submissions" USING btree ("cohort_id","user_id","node_key","created_at","id");--> statement-breakpoint
CREATE INDEX "submissions_cohort_state_idx" ON "app"."submissions" USING btree ("cohort_id","state","created_at","id");--> statement-breakpoint
CREATE INDEX "submissions_node_idx" ON "app"."submissions" USING btree ("curriculum_version_id","node_key");--> statement-breakpoint
CREATE INDEX "submissions_artifact_owner_idx" ON "app"."submissions" USING btree ("artifact_id","user_id");--> statement-breakpoint
CREATE INDEX "submissions_active_job_idx" ON "app"."submissions" USING btree ("active_judge_job_id");
--> statement-breakpoint
-- Reviewed addition: Drizzle 0.45 does not represent FK deferrability.
-- Keep the active job required; validate the circular pair at transaction commit.
ALTER TABLE "app"."submissions" ALTER CONSTRAINT "submissions_active_job_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- Runtime identities receive explicit grants in a later authorization migration.
REVOKE ALL ON SCHEMA "app", "judge" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "app", "judge" FROM PUBLIC;
