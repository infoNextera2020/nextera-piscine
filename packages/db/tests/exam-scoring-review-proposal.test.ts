import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const proposal = readFileSync(
  new URL('../migration-drafts/0024_exam_scoring_review.DRAFT.sql', import.meta.url),
  'utf8',
);
describe('unapplied0024 scoring SQL source proposal', () => {
  it('is a transaction-only draft without actor escalation, runtime provisioning or seeds', () => {
    expect(proposal).toContain('SOURCE REVIEW DRAFT ONLY');
    expect(proposal).toContain('BEGIN;');
    expect(proposal.trimEnd()).toMatch(/COMMIT;$/);
    expect(proposal).not.toMatch(
      /(?:^|;)\s*(?:CREATE\s+ROLE|ALTER\s+ROLE|GRANT\s+nextera_checkpoint_owner\s+TO)/im,
    );
    expect(proposal).not.toMatch(
      /INSERT INTO app\.exam_scoring_rubrics|INSERT INTO app\.exam_scoring_assignments|INSERT INTO app\.exam_scoring_evaluator_logins/,
    );
  });
  it('requires already-held direct isolated bootstrap DBA authority for trigger installation', () => {
    expect(proposal.match(/rolname=current_user AND rolsuper AND rolcanlogin/g)).toHaveLength(2);
    expect(proposal.match(/current_user IS DISTINCT FROM session_user/g)).toHaveLength(2);
    expect(proposal.match(/exam-scoring-0024-bootstrap-dba-v1/g)).toHaveLength(2);
    expect(proposal).toContain("current_database() !~ '^foundation_test_[a-z0-9_]+$'");
    expect(proposal.indexOf('RESET ROLE;')).toBeLessThan(
      proposal.indexOf('CREATE TRIGGER exam_scoring_capture_coding'),
    );
  });
  it('rejects null/missing functional state and missing exact payload keys', () => {
    expect(proposal).toContain("body->>'state' IS DISTINCT FROM 'evaluated'");
    expect(proposal).toContain("NOT (body ?& ARRAY['state','evidence'])");
    expect(proposal).toContain("jsonb_typeof(e->'matched') IS DISTINCT FROM 'boolean'");
    expect(proposal).not.toContain("body->>'state'<>'evaluated'");
  });
  it('rejects JSON scalar coercion for all rubric and evidence identity strings', () => {
    for (const keys of [
      "['form','definitionDigest','digest']",
      "['questionKey','kind','publishedCriteriaDigest','groupBasis']",
      "['key','criteriaDigest']",
      "['submissionId','questionKey','answerSha256','rubricDigest','publishedCriteriaDigest','kind','evidenceDigest']",
      "['groupKey','criteriaDigest']",
      "['answerSha256','rubricDigest','assignmentDigest','evidenceDigest']",
    ])
      expect(proposal).toContain('unnest(ARRAY' + keys + ') k WHERE jsonb_typeof(');
    expect(proposal).toContain("jsonb_typeof(body->'primaryEventId') IS DISTINCT FROM 'string'");
    expect(proposal).toContain("(m ?& ARRAY['counterexample','explanation'])");
    expect(proposal).toContain("AND jsonb_typeof(m->'explanation')='number',false)");
  });
  it('freezes exact source/owner/manual/comparator provenance independently of the rubric digest', () => {
    expect(proposal).toContain('source_binding jsonb NOT NULL');
    expect(proposal).toContain(
      "source_binding_digest=app.checkpoint_digest(source_binding,'nextera-exam1-rubric-source-binding')",
    );
    expect(proposal).toContain("b ?& ARRAY['draftSha256','paperSha256','decisions','rubric']");
    expect(proposal).toContain(
      "d ?& ARRAY['weightsOwnerMessageId','approvedDraftSha256','traceComparatorOwnerMessageId','traceComparator','manualCriteriaSha256']",
    );
    expect(proposal).toContain("d->>'approvedDraftSha256' IS DISTINCT FROM b->>'draftSha256'");
    expect(proposal).toContain("d->>'traceComparator' IS DISTINCT FROM 'exact_utf8'");
    expect(proposal).toContain("b->'rubric' IS DISTINCT FROM r-'digest'");
    expect(proposal).toContain(
      "'exam_scoring_rubric_valid','exam_scoring_source_binding_valid','guard_exam_scoring_history'",
    );
  });
  it('installs only four external FKs in the preheld DBA span, retaining exact private ownership', () => {
    const ownerSpan = proposal.slice(
      proposal.indexOf('SET LOCAL ROLE nextera_checkpoint_owner;'),
      proposal.indexOf('RESET ROLE;'),
    );
    expect(ownerSpan).not.toMatch(/REFERENCES app\.(checkpoint_attempts|users)/);
    const bootstrapSpan = proposal.slice(proposal.indexOf('RESET ROLE;'));
    expect(bootstrapSpan.match(/ADD CONSTRAINT exam_scoring_\w+_fk FOREIGN KEY/g)).toHaveLength(4);
    expect(proposal).not.toMatch(/GRANT\s+REFERENCES/i);
    expect(bootstrapSpan).toContain('New scoring table owner/RLS/private ACL readback failed');
    expect(bootstrapSpan).toContain('Exact external scoring FK readback failed');
    expect(bootstrapSpan).toContain(
      'c.condeferrable=required.deferred AND c.condeferred=required.deferred',
    );
    expect(proposal.indexOf('END $external_fk_audit$;')).toBeLessThan(
      proposal.lastIndexOf('COMMIT;'),
    );
  });
  it('captures order in accepted-source and closure transactions without submitting drafts', () => {
    expect(proposal).toContain('FOR UPDATE');
    expect(proposal).toContain('AFTER INSERT ON app.submissions');
    expect(proposal).toContain('AFTER INSERT ON app.checkpoint_answer_receipts');
    expect(proposal).toContain('BEFORE UPDATE OF status ON app.checkpoint_attempts');
    expect(proposal).toContain("IF NOT (a.snapshot->'definition' ? 'examScoring') THEN RETURN NEW");
    expect(proposal).toContain("nextval('app.exam_scoring_acceptance_order')");
    expect(proposal).not.toMatch(
      /UPDATE app\.checkpoint_attempts|INSERT INTO app\.checkpoint_answer_receipts|UPDATE app\.learner_node_progress|INSERT INTO app\.checkpoint_outcomes/,
    );
  });
  it('serializes compare-and-set plus immutable replay and retains all old evidence', () => {
    expect(proposal).toContain('operation_id uuid NOT NULL UNIQUE');
    expect(proposal).toContain('UNIQUE(submission_id,revision)');
    expect(proposal).toContain('expected_revision+1');
    expect(proposal).toContain('WHERE submission_id=submission FOR UPDATE');
    expect(proposal).toContain('pg_advisory_xact_lock(hashtextextended(operation::text,24))');
    expect(proposal).toContain('old.expected_revision IS DISTINCT FROM expected');
    expect(proposal).toContain('old.payload IS DISTINCT FROM body');
    expect(proposal).toContain('BEFORE UPDATE OR DELETE');
    expect(proposal).not.toMatch(
      /UPDATE app\.exam_scoring_events|DELETE FROM app\.exam_scoring_events/,
    );
  });
  it('checks evaluator session login/route and active assigned independent mentors', () => {
    expect(proposal).toContain('WHERE login_name=session_user AND enabled');
    expect(proposal).toContain("pg_has_role(session_user,'nextera_exam_evaluator','USAGE')");
    expect(proposal).toContain('evaluator.evaluator_digest IS DISTINCT FROM acc.evaluator_digest');
    expect(proposal).toContain('u.auth_user_id=auth_id AND u.active');
    expect(proposal).toContain("u.role IN ('operator','admin') AND m.status='active'");
    expect(proposal).toContain('actor=a.user_id');
    expect(proposal).toContain('assignment.primary_mentor_id ELSE assignment.secondary_mentor_id');
    expect(proposal).toContain("body->>'primaryEventId' IS DISTINCT FROM prior.event_id::text");
    expect(proposal).toContain('prior.actor_user_id=actor');
  });
  it('requires frozen content/criteria and records infrastructure uncertainty without zero grade', () => {
    expect(proposal).toContain(
      "rubric_digest=app.checkpoint_digest(rubric-'digest','01coding-exam-scoring-rubric')",
    );
    expect(proposal).toContain(
      "e->>'publishedCriteriaDigest' IS DISTINCT FROM q->>'publishedCriteriaDigest'",
    );
    expect(proposal).toContain("x->>'criteriaDigest'=g->>'criteriaDigest'");
    expect(proposal).toContain("jsonb_build_object('state','infrastructure_unknown')");
    expect(proposal).toContain("'status','provisional'");
    expect(proposal).toContain(
      "clock_timestamp()<a.deadline_at THEN RETURN jsonb_build_object('kind','review_not_open')",
    );
  });
  it('cleans private defaults and grants only explicit restricted RPCs', () => {
    expect(proposal).toContain('ENABLE ROW LEVEL SECURITY');
    expect(proposal).toContain("a.grantee=0 THEN 'PUBLIC'");
    expect(proposal).toContain('REVOKE ALL ON FUNCTION');
    expect(proposal).toContain('TO nextera_web,nextera_exam_evaluator');
    expect(proposal).not.toMatch(/GRANT (SELECT|INSERT|UPDATE|DELETE|ALL|USAGE|CREATE)\b/i);
    expect(proposal.match(/SECURITY DEFINER SET search_path=pg_catalog/g)).toHaveLength(4);
  });
});
