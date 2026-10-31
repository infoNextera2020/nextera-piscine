import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(
  new URL('../migration-drafts/0028_scored_exam_review_context.DRAFT.sql', import.meta.url),
  'utf8',
);
describe('append-only review-context SQL proposal only', () => {
  it('confines installation to a pre-held owner span and two read-only RPCs', () => {
    expect(sql.trim()).toMatch(/^-- SOURCE REVIEW DRAFT ONLY/);
    expect(sql).toContain('BEGIN;');
    expect(sql.trim()).toMatch(/COMMIT;$/);
    expect(sql).toContain("'exam-review-context-0028-bootstrap-dba-v1'");
    expect(sql).toContain('SET LOCAL ROLE nextera_checkpoint_owner;');
    expect(sql).toContain('RESET ROLE;');
    expect(sql.match(/CREATE FUNCTION /g)).toHaveLength(2);
    expect(sql).not.toMatch(
      /\b(?:CREATE ROLE|ALTER ROLE|DROP |TRUNCATE |GRANT SELECT|GRANT ALL)\b/i,
    );
  });
  it('authenticates current staff assignment/cohort and denies learner self-review or privileged SQL clients', () => {
    expect(sql).toContain("current_setting('role')<>'none'");
    expect(sql).toContain("NOT pg_has_role(session_user,'nextera_web','USAGE')");
    expect(sql).toContain(
      'AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls',
    );
    expect(sql).toContain('u.id IN(assignment.primary_mentor_id,assignment.secondary_mentor_id)');
    expect(sql).toContain("AND u.id<>a.user_id AND u.role IN('operator','admin')");
    expect(sql).toContain("u.active AND m.status='active'");
    expect(sql).toContain("USING ERRCODE='42501'");
  });
  it('verifies frozen rubric, source binding, assignment and 180-minute immutable acceptance set', () => {
    expect(sql).toContain('app.scored_exam_attempt_metadata(a) IS NULL');
    expect(sql).toContain("a.deadline_at<>a.started_at+interval '180 minutes'");
    expect(sql).toContain('app.exam_scoring_source_binding_valid(r.source_binding,r.rubric)');
    expect(sql).toContain("'01coding-exam-scoring-assignment'");
    expect(sql).toContain("'snapshotDigest',a.snapshot_digest");
    expect(sql).toContain("'revision',h.revision::text");
    expect(sql).toContain('ORDER BY h.submission_id FOR SHARE OF h');
    expect(sql).toContain('x.accepted_ordinal>=closure.closure_ordinal');
    expect(sql).toContain("'adjudication',NULL");
    const body = sql
      .split('CREATE FUNCTION app.scored_exam_review_context')[1]!
      .split('END $$;')[0]!;
    expect(body).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/);
  });
  it('reads back exact owner, private search path and only intended web EXECUTE', () => {
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION app.scored_exam_review_context(uuid,uuid) TO nextera_web;',
    );
    expect(sql).toContain("o.rolname='nextera_checkpoint_owner' AND p.prosecdef");
    expect(sql).toContain("p.proconfig=ARRAY['search_path=pg_catalog']::text[]");
    expect(sql).toContain("grantee.rolname IS DISTINCT FROM 'nextera_web'");
    expect(sql).toContain("acl.privilege_type<>'EXECUTE' OR acl.is_grantable");
    expect(sql).toContain("WHEN a.grantee=0 THEN 'PUBLIC'");
  });
  it('leaves registered checkpoint migration bytes intact', () => {
    const original = readFileSync(
      new URL('../migrations/0006_checkpoint_domain.sql', import.meta.url),
    );
    expect(createHash('sha256').update(original).digest('hex')).toBe(
      'd6b8b6a4b553eb53e1a238ebc312a523c02a48fe9ae95da67589233cd8afe67a',
    );
  });
  it('reads exact assigned answer bytes without granting Storage access or mutating attempts', () => {
    expect(sql).toContain("ctx->>'access' IS DISTINCT FROM 'assigned_mentor'");
    expect(sql).toContain('Exam answer review is not open');
    expect(sql).toContain('artifact.sha256 IS DISTINCT FROM acc.answer_digest');
    expect(sql).toContain(
      'app.checkpoint_answer_payload_complete(typed.answer_bytes,typed.answer_kind)',
    );
    expect(sql).toContain('app.checkpoint_answer_contract_digest(a.user_id,a.cohort_id,a.id');
    expect(sql).toContain("'payloadBase64',replace(encode(typed.answer_bytes,'base64')");
    expect(sql).not.toMatch(/CREATE POLICY|ALTER POLICY|storage[.]objects|nextera_artifact_reader/);
  });
});

describe('optional scored upload source proof (source inspection only)', () => {
  it('preserves exact legacy path and requires later reservation/intent/policy/job identity for scored keys', () => {
    expect(sql).toContain(
      "artifact.storage_key IS DISTINCT FROM owner_auth::text||'/'||a.cohort_id::text||'/'||code.idempotency_key||'/'||acc.answer_digest",
    );
    expect(sql).toContain("'/scored-exam-v1/'||a.id::text||'/'||acc.question_key");
    expect(sql).toContain("to_regclass('app.scored_exam_code_upload_reservations') IS NULL");
    expect(sql).toContain('EXECUTE $proof$');
    expect(sql).toContain('r.snapshot_digest=($1).snapshot_digest');
    expect(sql).toContain('i.policy_digest=r.intake_policy_digest');
    expect(sql).toContain('p.policy_digest=r.upload_policy_digest');
    expect(sql).toContain('i.artifact_id=($4).id AND i.job_id=($3).active_judge_job_id');
    expect(sql).toContain("j.evaluation_snapshot->'artifact'=jsonb_build_object");
    expect(sql).toContain(
      "j.evaluation_digest=app.checkpoint_digest(j.evaluation_snapshot,'nextera-evaluation-snapshot')",
    );
    const proof = sql.split('EXECUTE $proof$')[1]!.split('$proof$ INTO')[0]!;
    expect(proof).not.toMatch(/\benabled\b|\b(?:INSERT|UPDATE|DELETE|GRANT)\b/i);
  });
});
