import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const source = readFileSync(
  new URL('../migration-drafts/0029_scored_exam_outcomes.DRAFT.sql', import.meta.url),
  'utf8',
);
describe('0029 source proposal only, not native SQL proof', () => {
  it('requires a fresh pre-held isolated DBA and creates no LOGIN or role', () => {
    expect(source).toContain('exam-outcomes-0029-bootstrap-dba-v1');
    expect(source).toContain("current_database() !~ '^foundation_test_");
    expect(source).not.toMatch(/CREATE\s+ROLE|CREATE\s+USER|ALTER\s+ROLE/i);
  });
  it('keeps legacy0–4 outcomes separate and preserves all existing passing pointers', () => {
    expect(source).not.toMatch(/ALTER TABLE app\.checkpoint_outcomes/);
    expect(source).toContain(
      'first_passing_submission_id,first_passing_checkpoint_outcome_id,first_passing_raid_outcome_id,first_passing_scored_exam_outcome_id',
    );
    expect(source).toContain('exam_scoring_final_outcomes');
  });
  it('freezes adjudication/outcome history and rejects public table access', () => {
    expect(source).toContain('exam_adjudication_immutable BEFORE UPDATE OR DELETE');
    expect(source).toContain('exam_final_outcome_immutable BEFORE UPDATE OR DELETE');
    expect(source).toContain('ENABLE ROW LEVEL SECURITY');
    expect(source).toContain('REVOKE ALL ON TABLE');
  });
  it('locks the entire attempt/head vector and compares exact frozen projection and prior result', () => {
    expect(source).toContain('WHERE id=attempt FOR UPDATE');
    expect(source).toContain('ORDER BY h.submission_id FOR UPDATE OF h');
    expect(source).toContain('ad.projection IS DISTINCT FROM p');
    expect(source).toContain('head.latest_id IS DISTINCT FROM expected_outcome');
    expect(source).toContain('ad.expected_prior_outcome_id IS DISTINCT FROM head.latest_id');
  });
  it('recomputes approved point groups and whole best submission with newest tie', () => {
    expect(source).toContain("WHEN 'coding' THEN");
    expect(source).toContain('total>=60 AND coding>=45');
    expect(source).toContain('points>best OR (points=best AND x.accepted_ordinal>best_order)');
    expect(source).toContain('result_body IS DISTINCT FROM expected');
  });
  it('keeps infrastructure uncertainty unavailable rather than scoring it zero', () => {
    expect(source).toContain("f.payload->>'state' IS DISTINCT FROM 'evaluated'");
    expect(source).toContain('candidate IS NULL');
  });
  it('requires current-primary-linked independent marks for verdict changes', () => {
    expect(source).toContain('prior.verdict IS DISTINCT FROM candidate');
    expect(source).toContain("payload->>'primaryEventId'=primary_event.event_id::text");
    expect(source).toContain(
      "second_event.payload->'marks' IS DISTINCT FROM primary_event.payload->'marks'",
    );
  });
  it('does not infer initial threshold policy or let the browser apply a verdict', () => {
    expect(source).toContain("initialThresholdReview'='unresolved'");
    expect(source).toContain('exam_scoring_outcome_logins');
    expect(source).toContain("NOT pg_has_role(session_user,'nextera_web','USAGE')");
    expect(source).toContain('implementation_digest=implementation');
  });
  it('preserves the entire legacy trigger below one narrowly proved correction branch', () => {
    expect(source).not.toContain('__LEGACY_GUARD_SHA__');
    expect(source).toContain("replace(p.prosrc,injection,'') IS DISTINCT FROM original");
    expect(source).toContain("(to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')");
    expect(source).toContain('nextera.scored_exam_outcome_operation');
    expect(source).toContain('p.proacl IS DISTINCT FROM acl_before');
  });
  it('never unlocks downstream projects or awards invented XP', () => {
    expect(source).not.toMatch(
      /UPDATE app\.learner_node_progress target|SET state='available'|INSERT INTO app\.xp/i,
    );
    expect(source).toContain('Deliberately no prerequisite/next-node unlock');
  });
  it('preserves original completion time for a reviewed terminal correction', () =>
    expect(source).toContain(
      "completed_at=CASE WHEN a.status='evaluating' THEN at_time ELSE a.completed_at END",
    ));
  it('restores role and verifies owner/ACL before committing', () => {
    expect(source).toContain('RESET ROLE;');
    expect(source).toContain('Exact outcome function owner/ACL readback failed');
    expect(source.trim().endsWith('COMMIT;')).toBe(true);
  });
});

describe('post-final revision invalidation and authorization locks (source only)', () => {
  it('invalidates mastery on either evidence or adjudication revision without touching legacy passing pointers', () => {
    const block = source.slice(
      source.indexOf('CREATE FUNCTION app.invalidate_scored_exam_mastery()'),
      source.indexOf('-- Preserve the complete registered trigger body.'),
    );
    expect(block).toContain('LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog');
    expect(block).toContain('AFTER UPDATE OF revision ON app.exam_scoring_heads');
    expect(block).toContain(
      'AFTER UPDATE OF revision,latest_id ON app.exam_scoring_adjudication_heads',
    );
    expect(block).toContain(
      "state='in_progress',mastered_at=NULL,first_passing_scored_exam_outcome_id=NULL",
    );
    expect(block).toContain(
      "AND state='mastered' AND first_passing_scored_exam_outcome_id=prior.id",
    );
    expect(block).toContain(
      'o.attempt_id=a.id AND o.cohort_id=a.cohort_id AND o.user_id=a.user_id',
    );
    expect(block).toContain(
      'num_nonnulls(first_passing_submission_id,first_passing_checkpoint_outcome_id,first_passing_raid_outcome_id)=0',
    );
    expect(block).not.toMatch(
      /first_passing_(?:submission|checkpoint_outcome|raid_outcome)_id\s*=/,
    );
    expect(block).not.toContain('FOR UPDATE');
    expect(source).toContain("'app.invalidate_scored_exam_mastery()'::regprocedure");
    expect(source).toContain("<>11 THEN RAISE EXCEPTION 'Unexpected outcome function set'");
  });
  it('holds the exact applier registration and all scoped access rows through outcome commit', () => {
    expect(source).toContain(
      'login_name=session_user AND cohort_id=a.cohort_id AND enabled AND implementation_digest=implementation FOR SHARE',
    );
    expect(source).toContain('curriculum_version_id=a.curriculum_version_id FOR SHARE');
    expect(source).toContain("m.status='active' FOR SHARE OF u,m");
    expect(source).toContain('ORDER BY u.id FOR SHARE OF u,cm');
    expect(source).toContain('GET DIAGNOSTICS staff_count=ROW_COUNT');
    expect(source).toContain(
      'progress.first_passing_scored_exam_outcome_id IS DISTINCT FROM prior.id',
    );
  });
});

describe('effective second-review requirement SQL/domain parity (source only)', () => {
  it('rejects affected IDs when neither dispute nor a verdict change requires review', () => {
    const validator = source
      .split('CREATE FUNCTION app.scored_exam_adjudication_body_valid')[1]!
      .split('CREATE FUNCTION app.scored_exam_outcome_applier')[0]!;
    expect(validator).toContain("IF decision->'disputed'='false'::jsonb");
    expect(validator).toContain(
      "(prior_verdict IS NOT NULL AND prior_verdict=candidate->>'verdict')",
    );
    expect(validator).toContain(
      "(prior_verdict IS NULL AND decision->>'initialThresholdReview'='not_required')",
    );
    expect(validator).toContain(
      "AND jsonb_array_length(decision->'affectedSubmissionIds')<>0 THEN RETURN false; END IF;",
    );
    expect(
      validator.indexOf("AND jsonb_array_length(decision->'affectedSubmissionIds')<>0"),
    ).toBeLessThan(validator.indexOf('RETURN true;'));
  });
});
