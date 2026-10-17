-- Reviewed cross-row curriculum guarantees and read-only web grants. No table changes.
CREATE FUNCTION app.guard_curriculum_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'published' THEN RAISE EXCEPTION 'Insert a draft, then publish a complete projection'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'published' THEN RAISE EXCEPTION 'Published curriculum is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.status = 'published' THEN
    IF NOT EXISTS (SELECT FROM app.curriculum_nodes WHERE curriculum_version_id = NEW.id) THEN
      RAISE EXCEPTION 'Publication requires a nonempty node projection';
    END IF;
    IF EXISTS (
      SELECT FROM app.curriculum_nodes n WHERE n.curriculum_version_id = NEW.id AND NOT coalesce((
        n.resolved_evaluation_spec->>'content_digest' = NEW.content_digest
        AND n.resolved_evaluation_spec->>'curriculum_version' = NEW.version
        AND n.resolved_evaluation_spec->>'curriculum_key' = NEW.curriculum_key
        AND n.resolved_evaluation_spec->>'node_key' = n.node_key
        AND n.resolved_evaluation_spec->>'subject_digest' = n.subject_digest
        AND n.resolved_evaluation_spec->>'configuration_digest' ~ '^[0-9a-f]{64}$'
        AND length(n.resolved_evaluation_spec->>'test_pack_id') > 0
        AND n.resolved_evaluation_spec->>'test_pack_digest' ~ '^[0-9a-f]{64}$'
        AND n.resolved_evaluation_spec->>'test_pack_artifact' LIKE 'oci://%@sha256:' || (n.resolved_evaluation_spec->>'test_pack_digest')
        AND n.resolved_evaluation_spec->>'runner_image_digest' ~ '^sha256:[0-9a-f]{64}$'
        AND n.resolved_evaluation_spec->>'sandbox_image_digest' ~ '^sha256:[0-9a-f]{64}$'
        AND n.resolved_evaluation_spec->>'toolchain_version' ~ '^go[0-9]+\.[0-9]+\.[0-9]+$'
        AND n.resolved_evaluation_spec->>'target_platform' IN ('linux/amd64','linux/arm64')
        AND n.resolved_evaluation_spec->>'dependency_policy' = 'offline'
        AND jsonb_typeof(n.resolved_evaluation_spec->'build_flags') = 'array'
        AND length(n.resolved_evaluation_spec->>'resource_profile') > 0
        AND (n.resolved_evaluation_spec->>'protocol_version')::numeric > 0
        AND (n.resolved_evaluation_spec->>'snapshot_format_version')::numeric > 0
        AND n.resolved_evaluation_spec->'case_generation'->>'mode' IN ('static','generated')
        AND (n.resolved_evaluation_spec->'case_generation'->>'mode' = 'static' OR (
          length(n.resolved_evaluation_spec->'case_generation'->>'seed') > 0
          AND length(n.resolved_evaluation_spec->'case_generation'->>'generator_version') > 0
        ))
      ), false)
    ) THEN RAISE EXCEPTION 'Publication requires complete, matching immutable evaluation identities'; END IF;
    IF EXISTS (
      WITH RECURSIVE walk(node_key, path, cycle) AS (
        SELECT dependent_node_key, ARRAY[prerequisite_node_key, dependent_node_key], false
        FROM app.node_prerequisites WHERE curriculum_version_id = NEW.id
        UNION ALL
        SELECT e.dependent_node_key, w.path || e.dependent_node_key, e.dependent_node_key = ANY(w.path)
        FROM walk w JOIN app.node_prerequisites e ON e.prerequisite_node_key = w.node_key
        WHERE e.curriculum_version_id = NEW.id AND NOT w.cycle
      ) SELECT FROM walk WHERE cycle
    ) THEN RAISE EXCEPTION 'Curriculum prerequisite graph contains a cycle'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER curriculum_version_guard BEFORE INSERT OR UPDATE OR DELETE ON app.curriculum_versions
FOR EACH ROW EXECUTE FUNCTION app.guard_curriculum_version();
--> statement-breakpoint
CREATE FUNCTION app.guard_curriculum_projection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE target_version uuid; version_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.curriculum_version_id <> NEW.curriculum_version_id THEN
    RAISE EXCEPTION 'Cannot move a curriculum projection between versions';
  END IF;
  IF TG_OP = 'DELETE' THEN target_version := OLD.curriculum_version_id;
  ELSE target_version := NEW.curriculum_version_id; END IF;
  -- Lock the parent so a child write cannot race a concurrent publication.
  SELECT status INTO version_status FROM app.curriculum_versions WHERE id = target_version FOR UPDATE;
  IF version_status = 'published' THEN RAISE EXCEPTION 'Published curriculum is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER quests_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.quests
FOR EACH ROW EXECUTE FUNCTION app.guard_curriculum_projection();
CREATE TRIGGER nodes_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.curriculum_nodes
FOR EACH ROW EXECUTE FUNCTION app.guard_curriculum_projection();
CREATE TRIGGER prerequisites_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.node_prerequisites
FOR EACH ROW EXECUTE FUNCTION app.guard_curriculum_projection();
--> statement-breakpoint
CREATE FUNCTION app.guard_cohort_pin() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.curriculum_version_id IS NOT DISTINCT FROM NEW.curriculum_version_id THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT FROM app.cohort_memberships WHERE cohort_id = OLD.id) THEN
    RAISE EXCEPTION 'An enrolled cohort cannot change curriculum version';
  END IF;
  IF NOT EXISTS (SELECT FROM app.curriculum_versions WHERE id = NEW.curriculum_version_id AND status = 'published') THEN
    RAISE EXCEPTION 'A cohort must pin a published curriculum version';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cohort_pin_guard BEFORE INSERT OR UPDATE OF curriculum_version_id ON app.cohorts
FOR EACH ROW EXECUTE FUNCTION app.guard_cohort_pin();
--> statement-breakpoint
CREATE FUNCTION app.serialize_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.cohort_id <> NEW.cohort_id OR OLD.user_id <> NEW.user_id) THEN
    RAISE EXCEPTION 'Membership identity cannot change';
  END IF;
  PERFORM 1 FROM app.cohorts WHERE id = NEW.cohort_id FOR UPDATE;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_cohort_lock BEFORE INSERT OR UPDATE ON app.cohort_memberships
FOR EACH ROW EXECUTE FUNCTION app.serialize_membership();
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.guard_curriculum_version(), app.guard_curriculum_projection(), app.guard_cohort_pin(), app.serialize_membership() FROM PUBLIC;
-- Column grants exclude evaluation specifications and all Judge/submission data.
GRANT SELECT (id, slug, name, curriculum_version_id, status, starts_at, ends_at) ON app.cohorts TO nextera_web;
GRANT SELECT (cohort_id, user_id, status, joined_at) ON app.cohort_memberships TO nextera_web;
GRANT SELECT (id, curriculum_key, version, status) ON app.curriculum_versions TO nextera_web;
GRANT SELECT (curriculum_version_id, quest_key, title, position) ON app.quests TO nextera_web;
GRANT SELECT (curriculum_version_id, node_key, quest_key, kind, title, position, difficulty, skills, submission_rules, subject_markdown) ON app.curriculum_nodes TO nextera_web;
GRANT SELECT (curriculum_version_id, prerequisite_node_key, dependent_node_key, rule) ON app.node_prerequisites TO nextera_web;
GRANT SELECT (cohort_id, user_id, curriculum_version_id, node_key, state, unlocked_at, started_at, mastered_at) ON app.learner_node_progress TO nextera_web;
