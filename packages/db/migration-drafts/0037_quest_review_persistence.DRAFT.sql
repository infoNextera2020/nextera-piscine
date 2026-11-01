-- SOURCE-ONLY / UNREGISTERED. Do not apply or reuse a closed rehearsal.
-- Three initial-cycle tables only. Authority and coverage remain unavailable.
BEGIN;
DO $$ BEGIN
 IF current_user<>session_user OR current_setting('role')<>'none'
 OR current_database() NOT LIKE 'foundation_test%'
 OR current_setting('server_encoding')<>'UTF8'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolsuper AND rolcanlogin)
 THEN RAISE EXCEPTION 'QUEST_REVIEW_SETUP_REQUIRED'; END IF;
 IF to_regclass('app.quest_review_cycles') IS NOT NULL
 OR to_regclass('app.quest_review_assignments') IS NOT NULL
 OR to_regclass('app.quest_review_receipts') IS NOT NULL
 OR EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='app' AND (p.proname LIKE 'quest_review_%' OR p.proname LIKE '_quest_review_%'))
 THEN RAISE EXCEPTION 'QUEST_REVIEW_FRESH_DRAFT_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_quest_review_owner') THEN
  CREATE ROLE nextera_quest_review_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='nextera_quest_review_owner'
  AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid
  WHERE r.rolname='nextera_quest_review_owner')
 THEN RAISE EXCEPTION 'QUEST_REVIEW_OWNER_ISOLATION_REQUIRED'; END IF;
END $$;

CREATE FUNCTION app._quest_review_text_valid(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(v COLLATE "C"<>'' AND v COLLATE "C"=btrim(v,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') COLLATE "C",false)
$$;
CREATE FUNCTION app._quest_review_uuid_valid(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(v ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$',false)
$$;
CREATE FUNCTION app._quest_review_exact(v jsonb,keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_typeof(v)='object' AND v ?& keys AND
  (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(v)='object' THEN v ELSE '{}'::jsonb END))=cardinality(keys),false)
$$;
CREATE FUNCTION app._quest_review_integer(v jsonb,low_value bigint,high_value bigint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^-?(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
 RETURN (v::text)::numeric BETWEEN low_value AND high_value;
END $$;
CREATE FUNCTION app._quest_review_questions_valid(v text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(array_ndims(v)=1 AND cardinality(v)=5
  AND NOT EXISTS(SELECT FROM unnest(v) q WHERE NOT app._quest_review_text_valid(q))
  AND (SELECT count(DISTINCT q COLLATE "C") FROM unnest(v) q)=5,false)
$$;

CREATE TABLE app.quest_review_cycles (
 id uuid PRIMARY KEY,
 cohort_id uuid NOT NULL, quest_key text COLLATE "C" NOT NULL, learner_id uuid NOT NULL,
 curriculum_version_id uuid NOT NULL,
 content_version text COLLATE "C" NOT NULL, evidence_version text COLLATE "C" NOT NULL,
 evidence_digest text COLLATE "C" NOT NULL CHECK(evidence_digest ~ '^[0-9a-f]{64}$'),
 question_bank_version text COLLATE "C" NOT NULL,
 question_bank_digest text COLLATE "C" NOT NULL CHECK(question_bank_digest ~ '^[0-9a-f]{64}$'),
 selection_policy_version text COLLATE "C" NOT NULL, rubric_version text COLLATE "C" NOT NULL,
 question_ids text[] NOT NULL CHECK(app._quest_review_questions_valid(question_ids)),
 policy_version integer NOT NULL CHECK(policy_version=1),
 policy_revision text COLLATE "C" NOT NULL,
 peer_count bigint NOT NULL CHECK(peer_count BETWEEN 1 AND 9007199254740991),
 peer_gate text COLLATE "C" NOT NULL CHECK(peer_gate='submitted'),
 ranking_policy_version text COLLATE "C" NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT quest_review_one_initial_scope UNIQUE(cohort_id,quest_key,learner_id),
 CONSTRAINT quest_review_cycle_identity UNIQUE(id,cohort_id,quest_key,learner_id,policy_revision),
 FOREIGN KEY(cohort_id,learner_id) REFERENCES app.cohort_memberships(cohort_id,user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(cohort_id,curriculum_version_id) REFERENCES app.cohorts(id,curriculum_version_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK(app._quest_review_text_valid(quest_key) AND app._quest_review_text_valid(content_version)
  AND app._quest_review_text_valid(evidence_version) AND app._quest_review_text_valid(question_bank_version)
  AND app._quest_review_text_valid(selection_policy_version) AND app._quest_review_text_valid(rubric_version)
  AND app._quest_review_text_valid(policy_revision) AND app._quest_review_text_valid(ranking_policy_version))
);
CREATE TABLE app.quest_review_assignments (
 id uuid PRIMARY KEY, cycle_id uuid NOT NULL, cohort_id uuid NOT NULL,
 quest_key text COLLATE "C" NOT NULL, learner_id uuid NOT NULL,
 policy_revision text COLLATE "C" NOT NULL, reviewer_id uuid NOT NULL REFERENCES app.users(id),
 kind text COLLATE "C" NOT NULL CHECK(kind IN('peer','mentor')),
 assigned_at_ms bigint NOT NULL CHECK(assigned_at_ms BETWEEN -8640000000000000 AND 8640000000000000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(reviewer_id<>learner_id),
 FOREIGN KEY(cycle_id,cohort_id,quest_key,learner_id,policy_revision)
  REFERENCES app.quest_review_cycles(id,cohort_id,quest_key,learner_id,policy_revision) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT quest_review_assignment_identity UNIQUE(id,cycle_id,cohort_id,quest_key,learner_id,reviewer_id),
 CONSTRAINT quest_review_assignment_reviewer UNIQUE(cycle_id,kind,reviewer_id)
);
CREATE UNIQUE INDEX quest_review_one_mentor ON app.quest_review_assignments(cycle_id) WHERE kind='mentor';
CREATE TABLE app.quest_review_receipts (
 id uuid PRIMARY KEY, assignment_id uuid NOT NULL UNIQUE,
 cycle_id uuid NOT NULL, cohort_id uuid NOT NULL, quest_key text COLLATE "C" NOT NULL,
 learner_id uuid NOT NULL, reviewer_id uuid NOT NULL,
 decision text COLLATE "C" NOT NULL CHECK(decision IN('submitted','approved','changes_requested')),
 submitted_at_ms bigint NOT NULL CHECK(submitted_at_ms BETWEEN -8640000000000000 AND 8640000000000000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(assignment_id,cycle_id,cohort_id,quest_key,learner_id,reviewer_id)
  REFERENCES app.quest_review_assignments(id,cycle_id,cohort_id,quest_key,learner_id,reviewer_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
ALTER TABLE app.quest_review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quest_review_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quest_review_receipts ENABLE ROW LEVEL SECURITY;

-- Deliberately unavailable: a caller flag, JSON body or matching digest is not authority.
CREATE FUNCTION app._quest_review_authority_current(auth uuid,cohort uuid,quest text,learner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'QUEST_REVIEW_CONFIGURATION_REQUIRED' USING ERRCODE='55000'; END $$;
CREATE FUNCTION app._quest_review_selection_valid(authority jsonb,cycle jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT false $$;

CREATE FUNCTION app._quest_review_authority(auth uuid,cohort uuid,quest text,learner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb; ctx jsonb; actor jsonb; scope jsonb; item jsonb; actor_id uuid; version_id uuid;
BEGIN
 IF auth IS NULL OR cohort IS NULL OR learner IS NULL OR NOT app._quest_review_text_valid(quest)
 THEN RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
 a:=app._quest_review_authority_current(auth,cohort,quest,learner);
 IF NOT app._quest_review_exact(a,ARRAY['version','authUserId','scope','curriculumVersionId','authorityRevision','context'])
 OR a->'version' IS DISTINCT FROM '1'::jsonb OR a->>'authUserId' IS DISTINCT FROM auth::text
 OR NOT app._quest_review_uuid_valid(a->>'curriculumVersionId')
 OR coalesce(a->>'authorityRevision','') !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'QUEST_REVIEW_CONFIGURATION_REQUIRED' USING ERRCODE='55000'; END IF;
 scope:=a->'scope'; ctx:=a->'context'; actor:=ctx->'actor';
 IF NOT app._quest_review_exact(scope,ARRAY['cohortId','questKey','learnerId'])
 OR scope IS DISTINCT FROM jsonb_build_object('cohortId',cohort::text,'questKey',quest,'learnerId',learner::text)
 OR NOT app._quest_review_exact(ctx,ARRAY['actor','learnerAccess','evidence','policy','bank','selectionPolicyVersion','rubricVersion','initialAssignmentAllowed','peerCandidates','mentorCandidates'])
 OR NOT app._quest_review_exact(actor,ARRAY['id','role','cohortId','active','eligible'])
 OR NOT app._quest_review_uuid_valid(actor->>'id') OR actor->>'cohortId' IS DISTINCT FROM cohort::text
 OR actor->'active' IS DISTINCT FROM 'true'::jsonb OR ctx->'learnerAccess' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(actor->'eligible') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(ctx->'initialAssignmentAllowed') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(ctx->'peerCandidates') IS DISTINCT FROM 'array'
 OR jsonb_typeof(ctx->'mentorCandidates') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
 actor_id:=(actor->>'id')::uuid; version_id:=(a->>'curriculumVersionId')::uuid;
 IF NOT EXISTS(SELECT FROM app.users u WHERE u.auth_user_id=auth AND u.id=actor_id AND u.active AND u.role::text=actor->>'role')
 OR NOT EXISTS(SELECT FROM app.users u JOIN app.cohort_memberships m ON m.user_id=u.id
  WHERE u.id=learner AND u.active AND u.role='learner' AND m.cohort_id=cohort AND m.status='active')
 OR NOT EXISTS(SELECT FROM app.cohorts c JOIN app.curriculum_versions v ON v.id=c.curriculum_version_id
  WHERE c.id=cohort AND c.status='active' AND c.curriculum_version_id=version_id AND v.status='published')
 OR NOT EXISTS(SELECT FROM app.curriculum_nodes n WHERE n.curriculum_version_id=version_id AND n.quest_key=quest)
 THEN RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements((ctx->'peerCandidates')||(ctx->'mentorCandidates')) LOOP
  IF NOT app._quest_review_exact(item,ARRAY['id','role','cohortId','active','eligible'])
  OR NOT app._quest_review_uuid_valid(item->>'id') OR item->>'cohortId' IS DISTINCT FROM cohort::text
  OR jsonb_typeof(item->'active') IS DISTINCT FROM 'boolean' OR jsonb_typeof(item->'eligible') IS DISTINCT FROM 'boolean'
  THEN RAISE EXCEPTION 'QUEST_REVIEW_CONFIGURATION_REQUIRED' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT FROM app.users u WHERE u.id=(item->>'id')::uuid AND u.role::text=item->>'role' AND to_jsonb(u.active)=item->'active')
  THEN RAISE EXCEPTION 'QUEST_REVIEW_CONFIGURATION_REQUIRED' USING ERRCODE='55000'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(ctx->'peerCandidates'))<>jsonb_array_length(ctx->'peerCandidates')
 OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(ctx->'mentorCandidates'))<>jsonb_array_length(ctx->'mentorCandidates')
 THEN RAISE EXCEPTION 'QUEST_REVIEW_CONFIGURATION_REQUIRED' USING ERRCODE='55000'; END IF;
 IF actor_id<>learner AND (actor->'eligible' IS DISTINCT FROM 'true'::jsonb OR NOT EXISTS(
  SELECT FROM app.quest_review_assignments q JOIN app.quest_review_cycles c ON c.id=q.cycle_id
  WHERE c.cohort_id=cohort AND c.quest_key=quest AND c.learner_id=learner AND q.reviewer_id=actor_id
  AND ((q.kind='peer' AND actor->>'role'='learner') OR(q.kind='mentor' AND actor->>'role' IN('operator','admin')))))
 THEN RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN a;
END $$;

CREATE FUNCTION app._quest_review_required_ids(a jsonb,learner uuid) RETURNS uuid[]
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT array_agg(DISTINCT id ORDER BY id) FROM (
  SELECT learner AS id UNION ALL SELECT (a->'context'->'actor'->>'id')::uuid
  UNION ALL SELECT (v->>'id')::uuid FROM jsonb_array_elements((a->'context'->'peerCandidates')||(a->'context'->'mentorCandidates')) v
 ) identities
$$;
-- A transaction-local consistency fence is never authentication/authorization.
CREATE FUNCTION app._quest_review_fence(setting_name text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
BEGIN
 IF setting_name NOT IN('nextera.quest_review_lock','nextera.quest_review_context')
 THEN RAISE EXCEPTION 'QUEST_REVIEW_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 RETURN nullif(current_setting(setting_name,true),'')::jsonb;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'QUEST_REVIEW_UNAVAILABLE' USING ERRCODE='55000';
END $$;
CREATE FUNCTION app.quest_review_lock(cohort uuid,quest text,request uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expected jsonb:=jsonb_build_array(cohort::text,quest,request::text); binding jsonb;
BEGIN
 IF cohort IS NULL OR NOT app._quest_review_text_valid(quest) THEN RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
 binding:=app._quest_review_fence('nextera.quest_review_lock');
 IF binding IS NOT NULL AND binding IS DISTINCT FROM expected THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
 IF request IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('quest-review-request-v1',request::text)::text,0));
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('quest-review-graph-v1',cohort::text,quest)::text,0));
 PERFORM set_config('nextera.quest_review_lock',expected::text,true);
 RETURN true;
END $$;
CREATE FUNCTION app.quest_review_context(auth uuid,cohort uuid,quest text,learner uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app._quest_review_authority(auth,cohort,quest,learner) $$;
CREATE FUNCTION app.quest_review_lock_authority(auth uuid,cohort uuid,quest text,learner uuid,identities uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE before_value jsonb; after_value jsonb; required uuid[]; binding jsonb;
BEGIN
 binding:=app._quest_review_fence('nextera.quest_review_lock');
 IF binding IS NULL OR binding->>0 IS DISTINCT FROM cohort::text OR binding->>1 IS DISTINCT FROM quest
 THEN RAISE EXCEPTION 'QUEST_REVIEW_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 before_value:=app._quest_review_authority(auth,cohort,quest,learner);
 required:=app._quest_review_required_ids(before_value,learner);
 IF identities IS DISTINCT FROM required THEN RAISE EXCEPTION 'QUEST_REVIEW_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 PERFORM 1 FROM app.users WHERE id=ANY(required) ORDER BY id FOR SHARE;
 PERFORM 1 FROM app.cohort_memberships WHERE cohort_id=cohort AND user_id=ANY(required) ORDER BY cohort_id,user_id FOR SHARE;
 PERFORM 1 FROM app.cohorts WHERE id=cohort FOR SHARE;
 after_value:=app._quest_review_authority(auth,cohort,quest,learner);
 IF after_value IS DISTINCT FROM before_value OR app._quest_review_required_ids(after_value,learner) IS DISTINCT FROM required
 THEN RAISE EXCEPTION 'QUEST_REVIEW_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 -- Consistency fence only: future dispatch still calls the private authority hook.
 PERFORM set_config('nextera.quest_review_context',after_value::text,true);
 RETURN after_value;
END $$;

CREATE FUNCTION app._quest_review_ready(a jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE ctx jsonb:=a->'context'; e jsonb:=ctx->'evidence'; p jsonb:=ctx->'policy'; b jsonb:=ctx->'bank'; q jsonb;
BEGIN
 IF NOT app._quest_review_exact(e,ARRAY['contentVersion','evidenceVersion','evidenceDigest'])
 OR NOT app._quest_review_text_valid(e->>'contentVersion') OR NOT app._quest_review_text_valid(e->>'evidenceVersion')
 OR coalesce(e->>'evidenceDigest','') !~ '^[0-9a-f]{64}$'
 OR NOT app._quest_review_exact(p,ARRAY['version','revision','peerCount','peerGate','rankingPolicyVersion'])
 OR p->'version' IS DISTINCT FROM '1'::jsonb OR NOT app._quest_review_text_valid(p->>'revision')
 OR NOT app._quest_review_integer(p->'peerCount',1,9007199254740991)
 OR p->>'peerGate' IS DISTINCT FROM 'submitted' OR NOT app._quest_review_text_valid(p->>'rankingPolicyVersion')
 OR NOT app._quest_review_exact(b,ARRAY['version','digest','questionIds'])
 OR NOT app._quest_review_text_valid(b->>'version') OR coalesce(b->>'digest','') !~ '^[0-9a-f]{64}$'
 OR jsonb_typeof(b->'questionIds') IS DISTINCT FROM 'array'
 OR NOT app._quest_review_text_valid(ctx->>'selectionPolicyVersion') OR NOT app._quest_review_text_valid(ctx->>'rubricVersion')
 THEN RAISE EXCEPTION 'QUEST_REVIEW_CONFIGURATION_REQUIRED' USING ERRCODE='55000'; END IF;
 FOR q IN SELECT value FROM jsonb_array_elements(b->'questionIds') LOOP
  IF jsonb_typeof(q) IS DISTINCT FROM 'string' OR NOT app._quest_review_text_valid(q#>>'{}')
  THEN RAISE EXCEPTION 'QUEST_REVIEW_CONFIGURATION_REQUIRED' USING ERRCODE='55000'; END IF;
 END LOOP;
 IF jsonb_array_length(b->'questionIds')=0 OR
 (SELECT count(DISTINCT value) FROM jsonb_array_elements(b->'questionIds'))<>jsonb_array_length(b->'questionIds')
 THEN RAISE EXCEPTION 'QUEST_REVIEW_CONFIGURATION_REQUIRED' USING ERRCODE='55000'; END IF;
END $$;
CREATE FUNCTION app._quest_review_cycle(c app.quest_review_cycles) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('version',1,'cycleId',c.id::text,'cohortId',c.cohort_id::text,
 'questKey',c.quest_key,'learnerId',c.learner_id::text,'contentVersion',c.content_version,
 'evidenceVersion',c.evidence_version,'evidenceDigest',c.evidence_digest,
 'questionBankVersion',c.question_bank_version,'questionBankDigest',c.question_bank_digest,
 'questionIds',to_jsonb(c.question_ids),'selectionPolicyVersion',c.selection_policy_version,'rubricVersion',c.rubric_version)
$$;
CREATE FUNCTION app._quest_review_policy(c app.quest_review_cycles) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('version',c.policy_version,'revision',c.policy_revision,'peerCount',c.peer_count,
 'peerGate',c.peer_gate,'rankingPolicyVersion',c.ranking_policy_version)
$$;
CREATE FUNCTION app._quest_review_assignment(a app.quest_review_assignments) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',a.id::text,'cycle',app._quest_review_cycle(c),'policyRevision',a.policy_revision,
 'kind',a.kind,'reviewerId',a.reviewer_id::text,'assignedAtMs',a.assigned_at_ms)
 FROM app.quest_review_cycles c WHERE c.id=a.cycle_id
$$;
CREATE FUNCTION app._quest_review_receipt(r app.quest_review_receipts) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id::text,'assignmentId',r.assignment_id::text,'cycle',app._quest_review_cycle(c),
 'reviewerId',r.reviewer_id::text,'decision',r.decision,'submittedAtMs',r.submitted_at_ms)
 FROM app.quest_review_cycles c WHERE c.id=r.cycle_id
$$;
CREATE FUNCTION app._quest_review_stored(c app.quest_review_cycles) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('cycle',app._quest_review_cycle(c),'policy',app._quest_review_policy(c),
 'assignments',coalesce((SELECT jsonb_agg(app._quest_review_assignment(a) ORDER BY a.assigned_at_ms,a.id)
 FROM app.quest_review_assignments a WHERE a.cycle_id=c.id),'[]'::jsonb),
 'receipts',coalesce((SELECT jsonb_agg(app._quest_review_receipt(r) ORDER BY r.submitted_at_ms,r.id)
 FROM app.quest_review_receipts r WHERE r.cycle_id=c.id),'[]'::jsonb))
$$;
CREATE FUNCTION app._quest_review_assert_current(a jsonb,c app.quest_review_cycles) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE ctx jsonb:=a->'context';
BEGIN
 PERFORM app._quest_review_ready(a);
 IF c.cohort_id::text IS DISTINCT FROM a->'scope'->>'cohortId'
 OR c.quest_key IS DISTINCT FROM a->'scope'->>'questKey'
 OR c.learner_id::text IS DISTINCT FROM a->'scope'->>'learnerId'
 OR c.curriculum_version_id::text IS DISTINCT FROM a->>'curriculumVersionId'
 THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
 IF app._quest_review_policy(c) IS DISTINCT FROM ctx->'policy'
 OR c.question_bank_version IS DISTINCT FROM ctx->'bank'->>'version'
 OR c.question_bank_digest IS DISTINCT FROM ctx->'bank'->>'digest'
 OR c.selection_policy_version IS DISTINCT FROM ctx->>'selectionPolicyVersion'
 OR c.rubric_version IS DISTINCT FROM ctx->>'rubricVersion'
 THEN RAISE EXCEPTION 'QUEST_REVIEW_POLICY_CONFLICT' USING ERRCODE='22023'; END IF;
 IF c.content_version IS DISTINCT FROM ctx->'evidence'->>'contentVersion'
 OR c.evidence_version IS DISTINCT FROM ctx->'evidence'->>'evidenceVersion'
 OR c.evidence_digest IS DISTINCT FROM ctx->'evidence'->>'evidenceDigest'
 THEN RAISE EXCEPTION 'QUEST_REVIEW_EVIDENCE_CONFLICT' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION app._quest_review_proposal(a jsonb,cycle jsonb,policy jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE ctx jsonb:=a->'context'; q jsonb; ids text[];
BEGIN
 PERFORM app._quest_review_ready(a);
 IF NOT app._quest_review_exact(cycle,ARRAY['version','cycleId','cohortId','questKey','learnerId','contentVersion','evidenceVersion','evidenceDigest','questionBankVersion','questionBankDigest','questionIds','selectionPolicyVersion','rubricVersion'])
 OR cycle->'version' IS DISTINCT FROM '1'::jsonb
 OR NOT app._quest_review_uuid_valid(cycle->>'cycleId')
 OR cycle->>'cohortId' IS DISTINCT FROM a->'scope'->>'cohortId'
 OR cycle->>'questKey' IS DISTINCT FROM a->'scope'->>'questKey'
 OR cycle->>'learnerId' IS DISTINCT FROM a->'scope'->>'learnerId'
 OR cycle->>'contentVersion' IS DISTINCT FROM ctx->'evidence'->>'contentVersion'
 OR cycle->>'evidenceVersion' IS DISTINCT FROM ctx->'evidence'->>'evidenceVersion'
 OR cycle->>'evidenceDigest' IS DISTINCT FROM ctx->'evidence'->>'evidenceDigest'
 OR cycle->>'questionBankVersion' IS DISTINCT FROM ctx->'bank'->>'version'
 OR cycle->>'questionBankDigest' IS DISTINCT FROM ctx->'bank'->>'digest'
 OR cycle->>'selectionPolicyVersion' IS DISTINCT FROM ctx->>'selectionPolicyVersion'
 OR cycle->>'rubricVersion' IS DISTINCT FROM ctx->>'rubricVersion'
 OR policy IS DISTINCT FROM ctx->'policy'
 OR jsonb_typeof(cycle->'questionIds') IS DISTINCT FROM 'array'
 THEN RETURN false; END IF;
 FOR q IN SELECT value FROM jsonb_array_elements(cycle->'questionIds') LOOP
  IF jsonb_typeof(q) IS DISTINCT FROM 'string' OR NOT app._quest_review_text_valid(q#>>'{}')
  OR NOT ((ctx->'bank'->'questionIds') ? (q#>>'{}')) THEN RETURN false; END IF;
 END LOOP;
 SELECT array_agg(value#>>'{}' ORDER BY ordinal) INTO ids
 FROM jsonb_array_elements(cycle->'questionIds') WITH ORDINALITY t(value,ordinal);
 RETURN app._quest_review_questions_valid(ids);
END $$;
CREATE FUNCTION app._quest_review_actor(a jsonb,request uuid,c app.quest_review_cycles) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE actor jsonb:=a->'context'->'actor';
BEGIN
 IF request IS NULL THEN
  IF actor->>'id' IS DISTINCT FROM a->'scope'->>'learnerId' OR actor->>'role' IS DISTINCT FROM 'learner'
  THEN RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
 ELSE
  IF c.id IS NULL OR actor->>'id'=c.learner_id::text OR actor->'eligible' IS DISTINCT FROM 'true'::jsonb
  OR NOT EXISTS(SELECT FROM app.quest_review_assignments x WHERE x.cycle_id=c.id AND x.reviewer_id::text=actor->>'id'
   AND ((x.kind='peer' AND actor->>'role'='learner') OR(x.kind='mentor' AND actor->>'role' IN('operator','admin'))))
  THEN RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
 END IF;
END $$;

CREATE FUNCTION app._quest_review_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'QUEST_REVIEW_HISTORY_IMMUTABLE' USING ERRCODE='22023'; END $$;
CREATE TRIGGER quest_review_cycles_immutable BEFORE UPDATE OR DELETE ON app.quest_review_cycles
FOR EACH ROW EXECUTE FUNCTION app._quest_review_immutable();
CREATE TRIGGER quest_review_assignments_immutable BEFORE UPDATE OR DELETE ON app.quest_review_assignments
FOR EACH ROW EXECUTE FUNCTION app._quest_review_immutable();
CREATE TRIGGER quest_review_receipts_immutable BEFORE UPDATE OR DELETE ON app.quest_review_receipts
FOR EACH ROW EXECUTE FUNCTION app._quest_review_immutable();
CREATE FUNCTION app._quest_review_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app._quest_review_fence('nextera.quest_review_lock')->>0 IS DISTINCT FROM NEW.cohort_id::text
 OR app._quest_review_fence('nextera.quest_review_lock')->>1 IS DISTINCT FROM NEW.quest_key
 THEN RAISE EXCEPTION 'QUEST_REVIEW_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('quest-review-graph-v1',NEW.cohort_id::text,NEW.quest_key)::text,0));
 IF NEW.kind='peer' AND EXISTS(SELECT FROM app.quest_review_assignments a
  WHERE a.kind='peer' AND a.cohort_id=NEW.cohort_id AND a.quest_key=NEW.quest_key
  AND a.reviewer_id=NEW.learner_id AND a.learner_id=NEW.reviewer_id)
 THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quest_review_assignment_graph BEFORE INSERT ON app.quest_review_assignments
FOR EACH ROW EXECUTE FUNCTION app._quest_review_assignment_guard();
CREATE FUNCTION app._quest_review_receipt_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE assignment app.quest_review_assignments;
BEGIN
 SELECT * INTO assignment FROM app.quest_review_assignments WHERE id=NEW.assignment_id;
 IF assignment.id IS NULL OR NEW.submitted_at_ms<assignment.assigned_at_ms
 OR (assignment.kind='peer' AND NEW.decision<>'submitted')
 OR (assignment.kind='mentor' AND NEW.decision NOT IN('approved','changes_requested'))
 THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quest_review_receipt_kind BEFORE INSERT ON app.quest_review_receipts
FOR EACH ROW EXECUTE FUNCTION app._quest_review_receipt_guard();
CREATE FUNCTION app._quest_review_complete_roster() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.quest_review_cycles; peer_total bigint; mentor app.quest_review_assignments;
BEGIN
 SELECT * INTO c FROM app.quest_review_cycles WHERE id=NEW.cycle_id;
 SELECT count(*) INTO peer_total FROM app.quest_review_assignments WHERE cycle_id=c.id AND kind='peer';
 IF c.id IS NULL OR peer_total NOT IN(0,c.peer_count)
 THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
 SELECT * INTO mentor FROM app.quest_review_assignments WHERE cycle_id=c.id AND kind='mentor';
 IF mentor.id IS NOT NULL AND (peer_total<>c.peer_count OR
  (SELECT count(*) FROM app.quest_review_assignments x JOIN app.quest_review_receipts r ON r.assignment_id=x.id
   WHERE x.cycle_id=c.id AND x.kind='peer' AND r.decision='submitted' AND r.submitted_at_ms<=mentor.assigned_at_ms)<>c.peer_count)
 THEN RAISE EXCEPTION 'QUEST_MENTOR_BEFORE_PEERS' USING ERRCODE='22023'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER quest_review_peer_bundle AFTER INSERT ON app.quest_review_assignments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app._quest_review_complete_roster();
CREATE CONSTRAINT TRIGGER quest_review_receipt_bundle AFTER INSERT ON app.quest_review_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app._quest_review_complete_roster();


CREATE FUNCTION app.quest_review_dispatch(auth uuid,cohort uuid,quest text,learner uuid,request uuid,operation text,payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 a jsonb; before_value jsonb; binding jsonb; ctx jsonb; actor jsonb;
 c app.quest_review_cycles; previous app.quest_review_receipts; assignment app.quest_review_assignments;
 cycle jsonb; policy jsonb; item jsonb; receipt jsonb; question_ids text[];
 required uuid[]; actual_reviewers uuid[]; expected_reviewers uuid[];
 actor_id uuid; reviewer uuid; assignment_id uuid; proposed_id uuid;
 assigned_ms bigint; submitted_ms bigint; count_value bigint; max_edges bigint;
 kind_value text; answer jsonb; is_existing boolean; v_revision text;
BEGIN
 IF operation NOT IN('read','peer_graph','receipt','insert_cycle','insert_assignments','insert_receipt','validate_selection')
 OR operation IS NULL OR payload IS NULL OR octet_length(payload::text)>1048576
 THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
 binding:=app._quest_review_fence('nextera.quest_review_lock');
 IF binding IS DISTINCT FROM jsonb_build_array(cohort::text,quest,request::text)
 THEN RAISE EXCEPTION 'QUEST_REVIEW_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 -- The GUC is consistency only. Calling the private hook remains mandatory;
 -- the shipped hook raises, and no caller-supplied fence can enable authority.
 before_value:=app._quest_review_fence('nextera.quest_review_context');
 a:=app._quest_review_authority(auth,cohort,quest,learner);
 IF before_value IS NULL OR a IS DISTINCT FROM before_value
 THEN RAISE EXCEPTION 'QUEST_REVIEW_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 required:=app._quest_review_required_ids(a,learner);
 -- Exact existing scope only; reject changed identities before another row lock.
 IF app._quest_review_required_ids(before_value,learner) IS DISTINCT FROM required
 THEN RAISE EXCEPTION 'QUEST_REVIEW_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 PERFORM app.quest_review_lock(cohort,quest,request);
 a:=app.quest_review_lock_authority(auth,cohort,quest,learner,required);
 IF a IS DISTINCT FROM before_value THEN RAISE EXCEPTION 'QUEST_REVIEW_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 PERFORM app._quest_review_ready(a);
 ctx:=a->'context'; actor:=ctx->'actor'; actor_id:=(actor->>'id')::uuid;
 SELECT * INTO c FROM app.quest_review_cycles WHERE cohort_id=cohort AND quest_key=quest AND learner_id=learner FOR UPDATE;
 is_existing:=FOUND;
 PERFORM app._quest_review_actor(a,request,c);
 IF is_existing THEN PERFORM app._quest_review_assert_current(a,c); END IF;

 IF operation='read' THEN
  IF NOT app._quest_review_exact(payload,ARRAY[]::text[]) THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
  IF NOT is_existing THEN RETURN 'null'::jsonb; END IF;
  RETURN app._quest_review_stored(c);
 ELSIF operation='peer_graph' THEN
  IF NOT app._quest_review_exact(payload,ARRAY['maxEdges']) OR NOT app._quest_review_integer(payload->'maxEdges',1,2147483647)
  THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
  max_edges:=(payload->>'maxEdges')::bigint;
  SELECT count(*) INTO count_value FROM app.quest_review_assignments x WHERE x.cohort_id=cohort AND x.quest_key=quest AND x.kind='peer';
  IF count_value>max_edges THEN RETURN jsonb_build_object('complete',false,'edges','[]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('cohortId',x.cohort_id::text,'questKey',x.quest_key,
   'reviewerId',x.reviewer_id::text,'learnerId',x.learner_id::text) ORDER BY x.learner_id,x.reviewer_id,x.id),'[]'::jsonb)
  INTO answer FROM app.quest_review_assignments x WHERE x.cohort_id=cohort AND x.quest_key=quest AND x.kind='peer';
  RETURN jsonb_build_object('complete',true,'edges',answer);
 ELSIF operation='receipt' THEN
  IF request IS NULL OR NOT app._quest_review_exact(payload,ARRAY['requestId']) OR payload->>'requestId' IS DISTINCT FROM request::text
  THEN RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO previous FROM app.quest_review_receipts WHERE id=request FOR UPDATE;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  IF previous.cohort_id<>cohort OR previous.quest_key<>quest OR previous.learner_id<>learner OR previous.reviewer_id<>actor_id
  THEN RAISE EXCEPTION 'QUEST_REVIEW_IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
  RETURN app._quest_review_receipt(previous);
 ELSIF operation='validate_selection' THEN
  IF NOT app._quest_review_exact(payload,ARRAY['cycle']) THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
  RETURN to_jsonb(app._quest_review_proposal(a,payload->'cycle',ctx->'policy') AND
   coalesce(app._quest_review_selection_valid(a,payload->'cycle'),false));
 ELSIF operation='insert_cycle' THEN
  IF request IS NOT NULL OR is_existing OR ctx->'initialAssignmentAllowed' IS DISTINCT FROM 'true'::jsonb
  OR NOT app._quest_review_exact(payload,ARRAY['cycle','policy'])
  THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
  cycle:=payload->'cycle';policy:=payload->'policy';
  IF NOT app._quest_review_proposal(a,cycle,policy) OR NOT coalesce(app._quest_review_selection_valid(a,cycle),false)
  THEN RAISE EXCEPTION 'QUEST_REVIEW_CONFIGURATION_REQUIRED' USING ERRCODE='55000'; END IF;
  SELECT array_agg(value#>>'{}' ORDER BY ordinal) INTO question_ids
   FROM jsonb_array_elements(cycle->'questionIds') WITH ORDINALITY t(value,ordinal);
  INSERT INTO app.quest_review_cycles(id,cohort_id,quest_key,learner_id,curriculum_version_id,
   content_version,evidence_version,evidence_digest,question_bank_version,question_bank_digest,
   selection_policy_version,rubric_version,question_ids,policy_version,policy_revision,peer_count,peer_gate,ranking_policy_version)
  VALUES((cycle->>'cycleId')::uuid,cohort,quest,learner,(a->>'curriculumVersionId')::uuid,
   cycle->>'contentVersion',cycle->>'evidenceVersion',cycle->>'evidenceDigest',cycle->>'questionBankVersion',cycle->>'questionBankDigest',
   cycle->>'selectionPolicyVersion',cycle->>'rubricVersion',question_ids,1,policy->>'revision',(policy->>'peerCount')::bigint,'submitted',policy->>'rankingPolicyVersion');
 ELSIF operation='insert_assignments' THEN
  IF NOT is_existing OR ctx->'initialAssignmentAllowed' IS DISTINCT FROM 'true'::jsonb
  OR NOT app._quest_review_exact(payload,ARRAY['assignments']) OR jsonb_typeof(payload->'assignments') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
  count_value:=jsonb_array_length(payload->'assignments');
  IF count_value=0 THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
  kind_value:=payload->'assignments'->0->>'kind';
  IF kind_value='peer' THEN
   IF EXISTS(SELECT FROM app.quest_review_assignments x WHERE x.cycle_id=c.id) OR count_value<>c.peer_count
   THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
   SELECT array_agg(candidate_id ORDER BY ord) INTO expected_reviewers FROM (
    SELECT (v->>'id')::uuid AS candidate_id,ord FROM jsonb_array_elements(ctx->'peerCandidates') WITH ORDINALITY candidates(v,ord)
    WHERE v->>'role'='learner' AND v->'active'='true'::jsonb AND v->'eligible'='true'::jsonb
    AND v->>'cohortId'=cohort::text AND v->>'id'<>learner::text
    AND NOT EXISTS(SELECT FROM app.quest_review_assignments reverse_edge WHERE reverse_edge.kind='peer'
      AND reverse_edge.cohort_id=cohort AND reverse_edge.quest_key=quest
      AND reverse_edge.reviewer_id=learner AND reverse_edge.learner_id=(v->>'id')::uuid)
    ORDER BY ord LIMIT c.peer_count
   ) valid_candidates;
  ELSIF kind_value='mentor' THEN
   IF count_value<>1 OR EXISTS(SELECT FROM app.quest_review_assignments x WHERE x.cycle_id=c.id AND x.kind='mentor')
   OR (SELECT count(*) FROM app.quest_review_assignments x WHERE x.cycle_id=c.id AND x.kind='peer')<>c.peer_count
   OR (SELECT count(*) FROM app.quest_review_assignments x JOIN app.quest_review_receipts r ON r.assignment_id=x.id
     WHERE x.cycle_id=c.id AND x.kind='peer' AND r.decision='submitted')<>c.peer_count
   THEN RAISE EXCEPTION 'QUEST_MENTOR_BEFORE_PEERS' USING ERRCODE='22023'; END IF;
   -- After peer Submit, automatic mentor allocation is bound to that same receipt.
   IF request IS NOT NULL AND NOT EXISTS(SELECT FROM app.quest_review_receipts r JOIN app.quest_review_assignments x ON x.id=r.assignment_id
    WHERE r.id=request AND r.cycle_id=c.id AND r.reviewer_id=actor_id AND x.kind='peer' AND r.decision='submitted')
   THEN RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
   SELECT ARRAY[(v->>'id')::uuid] INTO expected_reviewers
   FROM jsonb_array_elements(ctx->'mentorCandidates') WITH ORDINALITY candidates(v,ord)
   WHERE v->>'role' IN('operator','admin') AND v->'active'='true'::jsonb AND v->'eligible'='true'::jsonb
   AND v->>'cohortId'=cohort::text AND v->>'id'<>learner::text ORDER BY ord LIMIT 1;
  ELSE RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
  actual_reviewers:=ARRAY[]::uuid[];
  FOR item IN SELECT value FROM jsonb_array_elements(payload->'assignments') LOOP
   IF NOT app._quest_review_exact(item,ARRAY['id','cycle','policyRevision','kind','reviewerId','assignedAtMs'])
   OR NOT app._quest_review_uuid_valid(item->>'id') OR NOT app._quest_review_uuid_valid(item->>'reviewerId')
   OR item->'cycle' IS DISTINCT FROM app._quest_review_cycle(c) OR item->>'policyRevision' IS DISTINCT FROM c.policy_revision
   OR item->>'kind' IS DISTINCT FROM kind_value OR NOT app._quest_review_integer(item->'assignedAtMs',-8640000000000000,8640000000000000)
   THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
   reviewer:=(item->>'reviewerId')::uuid;assigned_ms:=(item->>'assignedAtMs')::bigint;
   actual_reviewers:=array_append(actual_reviewers,reviewer);
   IF kind_value='mentor' AND EXISTS(SELECT FROM app.quest_review_assignments x JOIN app.quest_review_receipts r ON r.assignment_id=x.id
    WHERE x.cycle_id=c.id AND x.kind='peer' AND r.submitted_at_ms>assigned_ms)
   THEN RAISE EXCEPTION 'QUEST_MENTOR_BEFORE_PEERS' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF actual_reviewers IS DISTINCT FROM expected_reviewers
  OR cardinality(actual_reviewers)<>(SELECT count(DISTINCT x) FROM unnest(actual_reviewers) x)
  THEN RAISE EXCEPTION 'QUEST_REVIEW_CONFIGURATION_REQUIRED' USING ERRCODE='55000'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(payload->'assignments') LOOP
   INSERT INTO app.quest_review_assignments(id,cycle_id,cohort_id,quest_key,learner_id,policy_revision,reviewer_id,kind,assigned_at_ms)
   VALUES((item->>'id')::uuid,c.id,cohort,quest,learner,c.policy_revision,(item->>'reviewerId')::uuid,kind_value,(item->>'assignedAtMs')::bigint);
  END LOOP;
 ELSIF operation='insert_receipt' THEN
  IF NOT is_existing OR request IS NULL OR NOT app._quest_review_exact(payload,ARRAY['receipt'])
  THEN RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
  receipt:=payload->'receipt';
  IF NOT app._quest_review_exact(receipt,ARRAY['id','assignmentId','cycle','reviewerId','decision','submittedAtMs'])
  OR receipt->>'id' IS DISTINCT FROM request::text OR NOT app._quest_review_uuid_valid(receipt->>'assignmentId')
  OR receipt->'cycle' IS DISTINCT FROM app._quest_review_cycle(c) OR receipt->>'reviewerId' IS DISTINCT FROM actor_id::text
  OR NOT app._quest_review_integer(receipt->'submittedAtMs',-8640000000000000,8640000000000000)
  THEN RAISE EXCEPTION 'QUEST_REVIEW_RECORD_CONFLICT' USING ERRCODE='22023'; END IF;
  SELECT * INTO assignment FROM app.quest_review_assignments WHERE id=(receipt->>'assignmentId')::uuid AND cycle_id=c.id FOR UPDATE;
  IF assignment.id IS NULL OR assignment.reviewer_id<>actor_id
  OR (assignment.kind='peer' AND (actor->>'role'<>'learner' OR receipt->>'decision' IS DISTINCT FROM 'submitted'))
  OR (assignment.kind='mentor' AND (actor->>'role' NOT IN('operator','admin') OR receipt->>'decision' NOT IN('approved','changes_requested')))
  THEN RAISE EXCEPTION 'QUEST_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO previous FROM app.quest_review_receipts WHERE id=request FOR UPDATE;
  IF FOUND THEN
   IF app._quest_review_receipt(previous) IS DISTINCT FROM receipt
   THEN RAISE EXCEPTION 'QUEST_REVIEW_IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
   RETURN 'true'::jsonb;
  END IF;
  IF EXISTS(SELECT FROM app.quest_review_receipts r WHERE r.assignment_id=assignment.id)
  THEN RAISE EXCEPTION 'QUEST_REVIEW_IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
  INSERT INTO app.quest_review_receipts(id,assignment_id,cycle_id,cohort_id,quest_key,learner_id,reviewer_id,decision,submitted_at_ms)
  VALUES(request,assignment.id,c.id,cohort,quest,learner,actor_id,receipt->>'decision',(receipt->>'submittedAtMs')::bigint);
 END IF;
 IF app._quest_review_authority(auth,cohort,quest,learner) IS DISTINCT FROM a
 THEN RAISE EXCEPTION 'QUEST_REVIEW_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 RETURN 'true'::jsonb;
END $$;

-- Proposed privilege changes are text in this unapplied draft only.
GRANT USAGE ON SCHEMA app TO nextera_quest_review_owner;
GRANT SELECT ON app.users,app.cohorts,app.cohort_memberships,app.curriculum_versions,app.curriculum_nodes TO nextera_quest_review_owner;
-- PostgreSQL row-lock privileges only; these columns are never changed here.
GRANT UPDATE(id) ON app.users,app.cohorts TO nextera_quest_review_owner;
GRANT UPDATE(joined_at) ON app.cohort_memberships TO nextera_quest_review_owner;
ALTER TABLE app.quest_review_cycles OWNER TO nextera_quest_review_owner;
ALTER TABLE app.quest_review_assignments OWNER TO nextera_quest_review_owner;
ALTER TABLE app.quest_review_receipts OWNER TO nextera_quest_review_owner;
REVOKE ALL ON app.quest_review_cycles,app.quest_review_assignments,app.quest_review_receipts
 FROM PUBLIC,nextera_web,nextera_runner,nextera_judge_maintenance;
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'app._quest_review_text_valid(text)',
 'app._quest_review_uuid_valid(text)',
 'app._quest_review_exact(jsonb,text[])',
 'app._quest_review_integer(jsonb,bigint,bigint)',
 'app._quest_review_questions_valid(text[])',
 'app._quest_review_authority_current(uuid,uuid,text,uuid)',
 'app._quest_review_selection_valid(jsonb,jsonb)',
 'app._quest_review_authority(uuid,uuid,text,uuid)',
 'app._quest_review_required_ids(jsonb,uuid)',
 'app._quest_review_fence(text)',
 'app.quest_review_lock(uuid,text,uuid)',
 'app.quest_review_context(uuid,uuid,text,uuid)',
 'app.quest_review_lock_authority(uuid,uuid,text,uuid,uuid[])',
 'app._quest_review_ready(jsonb)',
 'app._quest_review_cycle(app.quest_review_cycles)',
 'app._quest_review_policy(app.quest_review_cycles)',
 'app._quest_review_assignment(app.quest_review_assignments)',
 'app._quest_review_receipt(app.quest_review_receipts)',
 'app._quest_review_stored(app.quest_review_cycles)',
 'app._quest_review_assert_current(jsonb,app.quest_review_cycles)',
 'app._quest_review_proposal(jsonb,jsonb,jsonb)',
 'app._quest_review_actor(jsonb,uuid,app.quest_review_cycles)',
 'app._quest_review_immutable()',
 'app._quest_review_assignment_guard()',
 'app._quest_review_receipt_guard()',
 'app._quest_review_complete_roster()',
 'app.quest_review_dispatch(uuid,uuid,text,uuid,uuid,text,jsonb)'
 ] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO nextera_quest_review_owner',signature::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,nextera_web,nextera_runner,nextera_judge_maintenance',signature::regprocedure);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.quest_review_lock(uuid,text,uuid),app.quest_review_context(uuid,uuid,text,uuid),
 app.quest_review_lock_authority(uuid,uuid,text,uuid,uuid[]),app.quest_review_dispatch(uuid,uuid,text,uuid,uuid,text,jsonb) TO nextera_web;
COMMIT;
