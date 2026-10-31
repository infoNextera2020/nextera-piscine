import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = readFileSync(
  new URL('../migration-drafts/0036_atm_capture_evidence.DRAFT.sql', import.meta.url),
  'utf8',
);
describe('unapplied native ATM retention boundaries', () => {
  it('is append-only source guarded by explicit fresh-target bootstrap authority, with no role/seed creation', () => {
    expect(source).toContain('atm-capture-0036-bootstrap-dba-v1');
    expect(source).toContain('current_user IS DISTINCT FROM session_user');
    expect(source).toContain("current_database() !~ '^foundation_test_");
    expect(source).not.toMatch(
      /CREATE\s+ROLE|CREATE\s+USER|CREATE\s+DATABASE|INSERT INTO judge\.atm_capture_policies/i,
    );
  });
  it('uses native current session worker and lease before replay lookup/write/readback', () => {
    expect(source).toContain('judge.worker_identity()');
    expect(source).toContain('judge.check_claim(j,w.id,attempt,token,generation)');
    const reconcile = source.slice(
      source.indexOf('CREATE FUNCTION judge.reconcile_atm_capture'),
      source.indexOf('CREATE FUNCTION judge.retain_atm_capture'),
    );
    expect(reconcile.indexOf('judge.resolve_atm_capture_context')).toBeLessThan(
      reconcile.indexOf('SELECT * INTO r FROM judge.atm_capture_evidence'),
    );
    expect(reconcile).toContain('pg_advisory_xact_lock');
    expect(reconcile.match(/judge\.resolve_atm_capture_context/g)!.length).toBeGreaterThanOrEqual(
      3,
    );
  });
  it('joins the actual immutable Raid submission/team/cohort/definition/roster and exact artifact', () => {
    expect(source).toContain('FROM app.raid_attempts WHERE submission_id=s.id');
    expect(source).toContain('n.subject_digest IS DISTINCT FROM ra.definition_digest');
    expect(source).toContain('s.active_judge_job_id IS DISTINCT FROM j.id');
    expect(source).toContain('app.raid_attempt_members');
    expect(source).toContain('app.raid_team_members');
    expect(source).toContain(
      "j.evaluation_snapshot->'artifact' IS DISTINCT FROM jsonb_build_object",
    );
    expect(source).toContain(
      "s->>'semantic_profile_digest' IS DISTINCT FROM p.semantic_profile_digest",
    );
    expect(source).toContain("'version',4,'item_key',b->>'nodeKey','learner_file','main.go'");
    expect(source).toContain("judge.atm_evidence_digest(resource,'nextera-atm-resource-policy')");
  });
  it('stores full private bytes, forces durable commit and validates byte readback atomically before ack', () => {
    expect(source).toContain('payload_bytes bytea NOT NULL');
    expect(source).toContain("set_config('synchronous_commit','on',true)");
    expect(source).toContain("payload:=convert_from(r.payload_bytes,'UTF8')::jsonb");
    expect(source).toContain(
      "r.payload_bytes IS DISTINCT FROM convert_to(judge.canonical_json(payload),'UTF8')",
    );
    expect(source).toContain(
      'receipt:=judge.reconcile_atm_capture(job,attempt,worker,generation,operation,actual,capture_digest,token)',
    );
    const table = source.slice(
      source.indexOf('CREATE TABLE judge.atm_capture_evidence'),
      source.indexOf('ALTER TABLE judge.atm_capture_policies OWNER'),
    );
    expect(table).not.toMatch(/claim_token|token\s+uuid|stdout|stderr/);
  });
  it('forces private RLS, immutable full captures, narrow RPCs and separate private existing-owner bridge', () => {
    expect(source).toContain('ALTER TABLE judge.atm_capture_evidence FORCE ROW LEVEL SECURITY');
    expect(source).toContain('ALTER TABLE judge.atm_capture_policies FORCE ROW LEVEL SECURITY');
    expect(source).toContain('BEFORE UPDATE OR DELETE ON judge.atm_capture_evidence');
    expect(source).toContain(
      'ALTER FUNCTION app.atm_raid_capture_binding(uuid,uuid) OWNER TO nextera_raid_owner',
    );
    expect(source).toContain(
      'GRANT EXECUTE ON FUNCTION app.atm_raid_capture_binding(uuid,uuid) TO nextera_judge_owner',
    );
    expect(source).toContain('ATM_CAPTURE_FUNCTION_ACL_READBACK_FAILED');
    expect(source).not.toMatch(/GRANT\s+(?:SELECT|ALL)\s+ON\s+app\.raid/i);
  });
  it('does not award result, mastery, XP or bypass the existing shared-Raid mentor decision', () => {
    expect(source).not.toMatch(
      /UPDATE\s+app\.learner_node_progress|INSERT\s+INTO\s+judge\.results|INSERT\s+INTO\s+app\.raid_outcomes|apply_raid_automated_result\s*\(/i,
    );
    expect(source).not.toContain("'passed'");
  });
});
