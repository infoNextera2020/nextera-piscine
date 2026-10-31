import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = (name: string) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const original = source('migrations/0007_checkpoint_operations.sql');
const editor = source('migration-drafts/0014_checkpoint_editor_context.DRAFT.sql');
const draft = source('migration-drafts/0027_scored_exam_lifecycle.DRAFT.sql');
const procedure = (text: string, name: string) => {
  const start = text.indexOf(`FUNCTION app.${name}(`);
  if (start < 0) throw Error('missing function');
  const body = text.indexOf('AS $$', start) + 5;
  return text.slice(body, text.indexOf('END $$;', body) + 4);
};
describe('unapplied0027 exact marked Exam1 lifecycle preparation', () => {
  it('is one fresh isolated DBA transaction and never creates authority, publishes content or changes registered bytes', () => {
    expect(draft).toContain('BEGIN;');
    expect(draft.trim()).toMatch(/COMMIT;$/);
    expect(draft).toContain("current_setting('role')<>'none'");
    expect(draft).toContain('rolsuper AND rolcanlogin');
    expect(draft).not.toMatch(/CREATE ROLE|CREATE USER|ALTER ROLE|GRANT /);
    expect(draft).not.toMatch(
      /UPDATE app\.curriculum_versions|INSERT INTO app\.scored_exam_lifecycle_policies|INSERT INTO app\.scored_exam_intake_policies/,
    );
    expect(createHash('sha256').update(original).digest('hex')).toBe(
      '99e9d01c77f6eeb9f6f968e903375083531a3d2f112dfaca3249d458aaeeb35c',
    );
    expect(source('migrations/meta/_journal.json')).not.toContain('0027');
  });
  it('requires exact version3,180minutes,eight ordered explicit formats rather than widening legacy constants', () => {
    const validator = procedure(draft, 'scored_exam_definition_valid');
    expect(validator).toContain("d->'policyVersion' IS DISTINCT FROM '3'::jsonb");
    expect(validator).toContain("d->'durationSeconds' IS DISTINCT FROM '10800'::jsonb");
    expect(validator).toContain("jsonb_array_length(d->'tasks')<>8");
    expect(validator).toContain("item->>'key' IS DISTINCT FROM 'q'||question_ordinal::text");
    expect(validator).toContain(
      "item->'answerFormat' IS DISTINCT FROM jsonb_build_object('version',1,'kind',kind)",
    );
    expect(draft).toContain("deadline_at=started_at+interval '90 minutes'");
    expect(draft).toContain("deadline_at=started_at+interval '180 minutes'");
  });
  it('omits exactly four recursive leaves for the versioned core hash while retaining full node/snapshot hashes', () => {
    const core = procedure(draft, 'scored_exam_definition_core');
    expect(core).toContain("spec #- '{checkpoint_definition,examScoring,rubricDigest}'");
    expect(core).toContain("'nextera-scored-exam-definition-core'");
    expect(core.match(/#-/g)).toHaveLength(4);
    for (const position of [5, 6, 7]) {
      expect(core).toContain(
        `{checkpoint_definition,tasks,${position},answerEvaluator,definitionDigest}`,
      );
    }
    for (const name of [
      'start_scored_exam',
      'scored_exam_attempt_metadata',
      'guard_checkpoint_definition',
    ]) {
      expect(procedure(draft, name)).toMatch(
        /answerEvaluator'->>'definitionDigest' IS DISTINCT FROM/,
      );
    }
    const start = procedure(draft, 'start_scored_exam');
    expect(start).toContain("'evaluation_spec',n.resolved_evaluation_spec");
    expect(start).toContain("'evaluation_spec_digest',n.evaluation_spec_digest");
    expect(start).toContain(
      "n.evaluation_spec_digest IS DISTINCT FROM app.checkpoint_digest(n.resolved_evaluation_spec,'nextera-evaluation-spec')",
    );
    expect(start).toContain("app.checkpoint_digest(snap,'nextera-checkpoint-attempt')");
  });
  it('pins one attempt and exact private nonself mentor/form assignment atomically before any question may be accepted', () => {
    const start = procedure(draft, 'start_scored_exam');
    expect(start).toContain('pg_advisory_xact_lock');
    expect(start).toContain('checkpoint_lock_access');
    expect(start).toContain('SCORED_EXAM_ATTEMPT_EXHAUSTED');
    expect(start).toContain('request_id=request');
    expect(start).toContain('FOR SHARE OF actor,m');
    expect(start).toContain('actor.id<>u');
    expect(start).toContain('INSERT INTO app.exam_scoring_assignments');
    expect(start).toContain("'01coding-exam-scoring-assignment'");
    expect(start.indexOf('INSERT INTO app.exam_scoring_assignments')).toBeLessThan(
      start.indexOf('cap:=app.scored_exam_question_capability'),
    );
    expect(start).toContain("cap->>'status' IS DISTINCT FROM 'open'");
    expect(start).not.toContain('INSERT INTO app.submissions');
    expect(start).not.toContain('INSERT INTO app.checkpoint_answer_receipts');
  });
  it('uses explicit coding/typed allowances and returns honest unavailable capabilities without passed or quota3 defaults', () => {
    const capability = procedure(draft, 'scored_exam_question_capability');
    expect(capability).toContain('app.scored_exam_intake_context(auth_id,attempt,task)');
    expect(capability).toContain(
      'app.checkpoint_answer_submission_context(auth_id,u,attempt,task)',
    );
    expect(capability).toContain('p.graded_acceptance_allowance');
    expect(capability).toContain('typed.graded_allowance');
    expect(capability).toContain(
      "WHEN SQLSTATE 'PS005' OR SQLSTATE 'PA005' THEN allowed:=false;status:='unavailable'",
    );
    expect(capability).not.toMatch(/reserved<3|NOT passed|state='passed'|coalesce\([^\n]+,3\)/);
  });
  it('keeps legacy start source exact after removing only the new marked dispatch', () => {
    const current = procedure(draft, 'start_checkpoint');
    const restored = current.replace(
      / -- BEGIN MARKED LIFECYCLE BRANCH[\s\S]+? -- END MARKED LIFECYCLE BRANCH\n/,
      '',
    );
    expect(restored).toBe(procedure(original, 'start_checkpoint'));
  });
  it('does not replace finish or the guarded legacy finalizer, reopen attempts or auto-submit drafts', () => {
    expect(draft).not.toMatch(
      /(?:CREATE|REPLACE) FUNCTION app\.(?:finish_checkpoint|finalize_checkpoint)\(/,
    );
    expect(draft).not.toMatch(/UPDATE app\.checkpoint_attempts SET status='active'/);
    expect(draft).not.toContain('app.accept_checkpoint_submission(');
    expect(draft).not.toContain('app.accept_checkpoint_answer(');
  });
  it('keeps the legacy0014 editor source and routes only valid marked coding tasks through reviewed0026', () => {
    expect(editor).toContain(
      "'submitAllowed',a.status='active' AND at_time<a.deadline_at AND NOT passed AND reserved<3",
    );
    const ctx = procedure(draft, 'checkpoint_editor_context');
    expect(ctx).toContain("task NOT IN ('q1','q2','q3','q4','q5')");
    expect(ctx).toContain('app.scored_exam_intake_context(auth_id,attempt,task)');
    expect(ctx).toContain("'scoredExam'");
  });
  it('projects no questions before an attempt and never turns provisional100point scoring into legacy3/4', () => {
    const view = procedure(draft, 'read_checkpoint');
    expect(view.indexOf("marked_tasks:='[]'::jsonb")).toBeLessThan(
      view.indexOf('IF a.id IS NOT NULL THEN'),
    );
    expect(view).toContain("'policy',NULL,'scored_exam',meta");
    expect(view).toContain("'points',NULL,'outcome_id',NULL,'policy',NULL,'scored_exam'");
    expect(view).toContain("'replacement_available',false");
    expect(view).toContain("'submission',app.scored_exam_question_capability");
  });
  it('installs only exact four external lifecycle FKs in DBA span and retains private table ownership/RLS/PUBLIC denial', () => {
    const span = draft.indexOf('RESET ROLE;');
    const fk = draft.indexOf('ADD CONSTRAINT scored_exam_lifecycle_member_fk');
    expect(fk).toBeGreaterThan(span);
    expect(draft).toContain('ENABLE ROW LEVEL SECURITY');
    expect(draft).toContain('REVOKE ALL ON TABLE app.scored_exam_lifecycle_policies');
    expect(draft).toContain(
      "c.confdeltype='r' AND c.confupdtype='a' AND NOT c.condeferrable AND NOT c.condeferred",
    );
    expect(draft).toContain('wanted.source_columns');
    expect(draft).toContain('wanted.target_columns');
  });
});

describe('exact legacy operation preservation and reviewed prerequisites', () => {
  it.each([
    ['checkpoint_task_context', original, ' meta jsonb; cap jsonb; typed jsonb;'],
    ['checkpoint_editor_context', editor, ' meta jsonb; ctx jsonb;'],
    ['guard_checkpoint_definition', original, ''],
    [
      'read_checkpoint',
      original,
      ' d app.checkpoint_definitions; meta jsonb; item jsonb; marked_tasks jsonb; marked_history jsonb; history_attempt app.checkpoint_attempts;',
    ],
  ])('keeps every unmarked statement of %s exact', (name, baseline, declaration) => {
    const restored = procedure(draft, name!)
      .replace(
        / -- BEGIN MARKED (?:TASK|EDITOR|DEFINITION|READ) BRANCH\.[\s\S]+? -- END MARKED (?:TASK|EDITOR|DEFINITION|READ) BRANCH\.\n/,
        '',
      )
      .replace(declaration!, '');
    expect(restored).toBe(procedure(baseline!, name!));
  });
  it('requires guarded finalizer and both structured/closure captures before widening schema', () => {
    const prerequisite = draft.slice(0, draft.indexOf('SET LOCAL ROLE nextera_checkpoint_owner'));
    expect(prerequisite).toContain(
      '792fafffa1021857fc8ed97eaa05dc1861c0d412850b4efddedd5b503102073e',
    );
    expect(prerequisite).toContain('exam_scoring_capture_structured');
    expect(prerequisite).toContain('exam_scoring_capture_closure');
    expect(prerequisite).toContain("t.tgenabled='O' AND NOT t.tgisinternal");
    expect(procedure(draft, 'read_checkpoint')).toContain("'provisional'::text AS scoring_status");
  });
});

describe('scope-bound prior actor and truthful marked replacement boundary', () => {
  it('requires the reviewed original actor rather than adopting any observed owner/ACL', () => {
    const pre = draft.slice(0, draft.indexOf('SET LOCAL ROLE nextera_checkpoint_owner'));
    expect(pre).toContain('nextera.scored_exam_0027_migration_actor');
    expect(pre).toContain('owner_role.rolname=CASE');
    expect(pre).toContain('p.prosecdef=(r.signature NOT IN');
    expect(pre).toContain('a.grantee=0 OR a.is_grantable');
    expect(pre).toContain("a.privilege_type='EXECUTE' AND NOT a.is_grantable");
    expect(draft).toContain('Existing lifecycle owner/ACL/security context changed');
  });
  it('rejects every marked replacement at the DB boundary before producing a grant', () => {
    const body = procedure(draft, 'grant_checkpoint_replacement');
    expect(body.indexOf('SCORED_EXAM_REPLACEMENT_UNAVAILABLE')).toBeLessThan(
      body.indexOf('INSERT INTO app.checkpoint_replacement_grants'),
    );
    expect(body).toContain("a.snapshot->'definition' ? 'examScoring'");
    const restored = body.replace(
      / -- BEGIN MARKED REPLACEMENT BRANCH\.[\s\S]+? -- END MARKED REPLACEMENT BRANCH\.\n/,
      '',
    );
    expect(restored).toBe(procedure(original, 'grant_checkpoint_replacement'));
    expect(draft).toContain("'app.grant_checkpoint_replacement(uuid,uuid)'::regprocedure");
  });
  it('does not advertise a marked retake while retaining the exact legacy notifier body', () => {
    const body = procedure(draft, 'announce_checkpoint_retake');
    const guard = body.slice(
      body.indexOf(' -- BEGIN MARKED RETAKE'),
      body.indexOf(' -- END MARKED RETAKE'),
    );
    expect(guard).toContain("a.snapshot->'definition' ? 'examScoring'");
    expect(guard).toContain('RETURN;');
    expect(guard).not.toMatch(/UPDATE|INSERT|checkpoint_event/);
    expect(
      body.replace(/ -- BEGIN MARKED RETAKE BRANCH\.[\s\S]+? -- END MARKED RETAKE BRANCH\.\n/, ''),
    ).toBe(procedure(original, 'announce_checkpoint_retake'));
  });
  it('keeps the result hook private and provisional until a real immutable ledger replaces it', () => {
    const body = procedure(draft, 'scored_exam_result_projection');
    expect(body).toContain('app.checkpoint_user(auth_id,a.cohort_id)');
    expect(body).toContain('app.scored_exam_attempt_metadata(a)');
    expect(body).toContain("'total_points',NULL,'coding_points',NULL,'outcome_id',NULL");
    expect(body).not.toMatch(/INSERT|UPDATE|DELETE|3\/4|pass_points/);
    expect(draft).toContain('app.scored_exam_result_projection(uuid,uuid)');
    expect(procedure(draft, 'read_checkpoint')).toContain(
      "'scored_result',CASE WHEN a.id IS NOT NULL THEN app.scored_exam_result_projection(auth_id,a.id) END",
    );
  });
});
