import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const draft = readFileSync(
  new URL('../migration-drafts/0021_checkpoint_answer_drafts.DRAFT.sql', import.meta.url),
  'utf8',
);
const journal = readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8');
/** Static SQL source review only. No PostgreSQL parsing, execution, concurrency or ACL rehearsal. */
describe('Unapplied structured answer DRAFT0021', () => {
  it('remains outside the migration journal and enables no policy or assessment data', () => {
    expect(draft).toContain('REVIEW DRAFT ONLY');
    expect(draft).toContain('UNRESOLVED: jsonb rejects escaped U+0000');
    expect(draft).toContain('must not be activated while this remains unresolved');
    expect(journal).not.toContain('0021_checkpoint_answer_drafts');
    expect(draft).toContain('enabled boolean NOT NULL DEFAULT false');
    expect(draft).not.toMatch(/INSERT INTO app\.checkpoint_answer_draft_policies/);
    expect(draft).not.toMatch(/CREATE ROLE|CREATE USER|PASSWORD\s*=/i);
  });
  it('preserves both earlier source/context DRAFT bytes', () => {
    for (const [file, expected] of [
      [
        '0011_checkpoint_drafts.DRAFT.sql',
        'eaf3f7e95589fddf081f73084700ee994e9d87a775187d76f0d39d8d89e5a1e6',
      ],
      [
        '0014_checkpoint_editor_context.DRAFT.sql',
        '8146ae6be34adfeacdbcaf3fb9e22b4a3516b9202eeee8cfaf3fbd88e81b78c3',
      ],
    ])
      expect(
        createHash('sha256')
          .update(readFileSync(new URL('../migration-drafts/' + file, import.meta.url)))
          .digest('hex'),
      ).toBe(expected);
  });
  it('binds explicit kind/version/size to the immutable attempt snapshot and exact digest domain', () => {
    const context = draft.slice(
      draft.indexOf('CREATE FUNCTION app.checkpoint_answer_draft_context'),
      draft.indexOf('-- Validate typed canonical JSON'),
    );
    expect(context).toContain("a.snapshot->'definition'->'tasks'");
    expect(context).toContain("contract:=item->'answerContract'");
    expect(context).toContain("app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt')");
    expect(context).toContain(
      "a.snapshot->>'definition_digest' IS DISTINCT FROM a.definition_digest",
    );
    expect(context).toContain("a.snapshot->>'deadline_at'");
    expect(context).not.toContain("item->'submissionRules'");
    expect(context).not.toContain('FROM app.checkpoint_definitions');
    expect(draft).toContain(
      "concat_ws(E'\\n','01coding-checkpoint-answer-contract-v1',learner::text,cohort::text,attempt::text,task,definition,'1',kind,maximum::text)",
    );
  });
  it('retains exact canonical bytes in immutable scoped revisions with separate storage bounds', () => {
    expect(draft).toContain('answer_bytes bytea NOT NULL');
    expect(draft).toContain('answer_contract_digest text NOT NULL');
    expect(draft).toContain('UNIQUE(user_id,request_id)');
    expect(draft).toContain('version=base_version+1');
    expect(draft).toContain('BEFORE UPDATE ON app.checkpoint_answer_draft_revisions');
    expect(draft).toContain("RETURN convert_to(canonical,'UTF8')=payload");
    expect(draft).toContain('used_receipts>=p.max_receipts_per_task');
    expect(draft).toContain("ERRCODE='PA004'");
    expect(draft).not.toMatch(/trim\s*\(/i);
  });
  it('serializes saves consistently, reconciles exact receipts before deadline and checks CAS before insert', () => {
    const save = draft.slice(draft.indexOf('CREATE FUNCTION app.save_checkpoint_answer_draft'));
    expect(save.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      save.indexOf('checkpoint_lock_access'),
    );
    expect(save.indexOf('SELECT * INTO old')).toBeLessThan(save.indexOf("a.status<>'active'"));
    expect(save.indexOf('old.answer_bytes IS DISTINCT FROM payload')).toBeLessThan(
      save.indexOf("a.status<>'active'"),
    );
    expect(save.indexOf('IF base<>head')).toBeLessThan(
      save.indexOf('INSERT INTO app.checkpoint_answer_draft_revisions'),
    );
    expect(save).toContain('old.answer_contract_digest IS DISTINCT FROM contract');
  });
  it('grants only the three narrow web RPCs and no direct table or helper execution', () => {
    expect(draft).toContain('FROM PUBLIC,nextera_web');
    const grants = draft.split('\n').filter((line) => line.startsWith('GRANT EXECUTE'));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toContain('checkpoint_answer_draft_context');
    expect(grants[0]).toContain('read_checkpoint_answer_draft');
    expect(grants[0]).toContain('save_checkpoint_answer_draft');
    expect(grants[0]).not.toContain('payload_valid');
    expect(draft).toContain('ENABLE ROW LEVEL SECURITY');
    expect(draft).toContain('SET search_path=pg_catalog');
  });
  it('has zero official acceptance, job, grading, Run, progression or budget effects', () => {
    expect(draft).not.toMatch(
      /INSERT INTO (judge\.|app\.(submissions|submission_artifacts|checkpoint_outcomes|learner_node_progress))/i,
    );
    expect(draft).not.toMatch(
      /UPDATE app\.(checkpoint_attempts|learner_node_progress)|accept_checkpoint_submission|visible_run/,
    );
    expect(draft).not.toMatch(/ALTER TABLE app\.checkpoint_(attempts|definitions|outcomes)/);
  });
});
