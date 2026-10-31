import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { MANUAL_EVIDENCE_READINESS_SQL } from '../queries/scored-exam-manual-evidence';
const sql = readFileSync(
  new URL('../migration-drafts/0035_scored_exam_manual_evidence.DRAFT.sql', import.meta.url),
  'utf8',
);
const body = (name: string) =>
  sql.match(
    new RegExp('CREATE FUNCTION app\\.' + name + '\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;'),
  )![1]!;
describe('manual evidence source proposal only (no native execution)', () => {
  it('pins both native RPC bodies, assigned-staff context and private tables', () => {
    for (const name of ['scored_exam_manual_evidence', 'record_scored_exam_manual_evidence'])
      expect(MANUAL_EVIDENCE_READINESS_SQL).toContain(
        createHash('sha256').update(body(name), 'utf8').digest('hex'),
      );
    expect(MANUAL_EVIDENCE_READINESS_SQL).toContain('c.relrowsecurity');
    expect(MANUAL_EVIDENCE_READINESS_SQL).toContain('guard_exam_scoring_history');
    expect(MANUAL_EVIDENCE_READINESS_SQL).toContain('has_table_privilege');
    const read = body('scored_exam_manual_evidence');
    expect(read.indexOf('ctx:=app.scored_exam_review_context')).toBeLessThan(
      read.indexOf('SELECT display_name'),
    );
    expect(read).toContain("IS DISTINCT FROM 'assigned_mentor'");
    expect(read).toContain('IF closed THEN');
  });
  it('puts the external users FK only after restoring the existing bootstrap authority without new grants', () => {
    expect(sql.indexOf('REFERENCES app.users')).toBeGreaterThan(sql.indexOf('RESET ROLE;'));
    expect(sql).not.toMatch(
      /GRANT\s+(?:ALL|REFERENCES|SELECT|INSERT|UPDATE|USAGE)|CREATE\s+ROLE|ALTER\s+ROLE|CREATE\s+OR\s+REPLACE/i,
    );
    expect(sql).toContain("current_database() !~ '^foundation_test_");
    expect(sql).toContain('exam-manual-evidence-0035-bootstrap-dba-v1');
  });
  it('never partially acknowledges an event if evidence insertion or readback fails', () => {
    const write = body('record_scored_exam_manual_evidence');
    expect(write.indexOf('app.record_exam_scoring_event(')).toBeLessThan(
      write.indexOf('INSERT INTO app.exam_manual_evidence'),
    );
    expect(write).not.toMatch(/EXCEPTION\s+WHEN/i);
    expect(write).toContain("RAISE EXCEPTION 'Atomic evidence readback failed'");
    expect(write).toContain("RAISE EXCEPTION 'Unexpected writer replay without durable evidence'");
    expect(write.indexOf('INSERT INTO app.exam_manual_evidence')).toBeLessThan(
      write.indexOf("RETURN result||jsonb_build_object('evidenceReference'"),
    );
  });
  it('takes operation then target-head locks before shared context, preserving the existing writer lock order', () => {
    const write = body('record_scored_exam_manual_evidence');
    expect(write.indexOf('hashtextextended(operation::text,24)')).toBeLessThan(
      write.indexOf('FOR UPDATE OF h'),
    );
    expect(write.indexOf('FOR UPDATE OF h')).toBeLessThan(
      write.indexOf('ctx:=app.scored_exam_review_context'),
    );
    expect(write).toContain("u.active AND m.status='active'");
    expect(write).toContain("u.id=CASE WHEN review='primary'");
  });
  it('requires exact retained document/operation/revision before missing criteria/policy can permit replay', () => {
    const write = body('record_scored_exam_manual_evidence');
    const auth = write.indexOf('ctx:=app.scored_exam_review_context'),
      old = write.indexOf('SELECT * INTO prior_event'),
      caps = write.indexOf('p.rubric_digest IS NULL OR criteria_text IS NULL');
    expect(auth).toBeLessThan(old);
    expect(write.indexOf("RETURN jsonb_build_object('kind','review_not_open')")).toBeLessThan(old);
    expect(old).toBeLessThan(caps);
    expect(write).toContain('prior.document IS DISTINCT FROM doc');
    expect(write).toContain('prior_event.expected_revision<>expected');
    expect(write).toContain('prior_event.submission_id<>submission');
    expect(write).toContain('prior_event.event_kind<>review');
    expect(write).toContain("encode(sha256(convert_to(criteria_text,'UTF8')),'hex')");
    expect(write).not.toContain('allowNew');
  });
  it('has required positive native caps and immutable audit retention without production defaults or silent purge', () => {
    expect(sql).toContain("ARRAY['version','maxEvidenceBytes','maxCriteriaBytes']");
    expect(sql).not.toMatch(
      /maxEvidenceBytes[^\n]*DEFAULT|maxCriteriaBytes[^\n]*DEFAULT|DELETE\s+FROM|TRUNCATE\s+TABLE|INTERVAL\s+'[^']*(?:day|hour)'/i,
    );
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON app.exam_manual_evidence_policies');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON app.exam_manual_evidence');
  });
  it('leaves the accepted scoring drafts and functional writer source untouched', () => {
    const pins: Record<string, string> = {
      '0024_exam_scoring_review.DRAFT.sql':
        'feab3623aaa1accf30f1391776427520f64cbe46dea99ed14ee02d41d5025292',
      '0028_scored_exam_review_context.DRAFT.sql':
        '3ef831a67effda3745394527a021285e799fbae1bf425461967b937a357015ce',
      '0032_scored_exam_functional_producer.DRAFT.sql':
        '2382a0621d3fa5499b99a19e3566dcbbd4f969bbc24b9feedb63f56e6b8c74f0',
      '0033_scored_exam_binary_result.DRAFT.sql':
        '5d2c08b4cd0f926cfb40e7dc0af53eecb6dea8669924f7e2e7306e99ac52a47b',
    };
    for (const [file, hash] of Object.entries(pins))
      expect(
        createHash('sha256')
          .update(readFileSync(new URL('../migration-drafts/' + file, import.meta.url)))
          .digest('hex'),
      ).toBe(hash);
  });
});
