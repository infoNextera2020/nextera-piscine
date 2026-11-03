CREATE OR REPLACE FUNCTION app._quest_review_selection_valid(authority jsonb, cycle jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT true
$$;
ALTER FUNCTION app._quest_review_selection_valid(jsonb, jsonb) OWNER TO nextera_quest_review_owner;

CREATE OR REPLACE FUNCTION app._quest_review_authority_current(auth uuid, cohort uuid, quest text, learner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_actor app.users%ROWTYPE;
  v_curriculum_version uuid;
  v_peers jsonb;
  v_mentors jsonb;
  v_evidence_digest text := repeat('e', 64);
  v_bank_digest text := repeat('b', 64);
  v_authority_rev text := repeat('a', 64);
BEGIN
  SELECT * INTO v_actor FROM app.users WHERE auth_user_id = auth AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501';
  END IF;

  SELECT curriculum_version_id INTO v_curriculum_version FROM app.cohorts WHERE id = cohort AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id::text,
    'role', u.role::text,
    'cohortId', cohort::text,
    'active', u.active,
    'eligible', true
  ) ORDER BY u.id), '[]'::jsonb) INTO v_peers
  FROM app.users u
  JOIN app.cohort_memberships m ON m.user_id = u.id
  WHERE m.cohort_id = cohort AND m.status = 'active'
    AND u.role = 'learner' AND u.active = true AND u.id <> learner;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id::text,
    'role', u.role::text,
    'cohortId', cohort::text,
    'active', u.active,
    'eligible', true
  ) ORDER BY u.id), '[]'::jsonb) INTO v_mentors
  FROM app.users u
  WHERE u.role IN ('operator', 'admin') AND u.active = true;

  RETURN jsonb_build_object(
    'version', 1,
    'authUserId', auth::text,
    'scope', jsonb_build_object('cohortId', cohort::text, 'questKey', quest, 'learnerId', learner::text),
    'curriculumVersionId', v_curriculum_version::text,
    'authorityRevision', v_authority_rev,
    'context', jsonb_build_object(
      'actor', jsonb_build_object(
        'id', v_actor.id::text,
        'role', v_actor.role::text,
        'cohortId', cohort::text,
        'active', v_actor.active,
        'eligible', true
      ),
      'learnerAccess', true,
      'evidence', jsonb_build_object(
        'contentVersion', 'content-1',
        'evidenceVersion', 'evidence-1',
        'evidenceDigest', v_evidence_digest
      ),
      'policy', jsonb_build_object(
        'version', 1,
        'revision', 'policy-1',
        'peerCount', 1,
        'peerGate', 'submitted',
        'rankingPolicyVersion', 'rank-1'
      ),
      'bank', jsonb_build_object(
        'version', 'bank-1',
        'digest', v_bank_digest,
        'questionIds', jsonb_build_array('q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8')
      ),
      'selectionPolicyVersion', 'selection-1',
      'rubricVersion', 'rubric-1',
      'initialAssignmentAllowed', true,
      'peerCandidates', v_peers,
      'mentorCandidates', v_mentors
    )
  );
END $$;
ALTER FUNCTION app._quest_review_authority_current(uuid, uuid, text, uuid) OWNER TO nextera_quest_review_owner;
REVOKE ALL ON FUNCTION app._quest_review_authority_current(uuid, uuid, text, uuid) FROM PUBLIC, nextera_web, nextera_runner;
