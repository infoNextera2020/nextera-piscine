import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL,
  CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_SHA256,
} from '../queries/checkpoint-answer-drafts';
const draft = readFileSync(
  new URL('../migration-drafts/0022_checkpoint_answer_submissions.DRAFT.sql', import.meta.url),
  'utf8',
);
const journal = readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8');
const context = draft.slice(
  draft.indexOf('CREATE FUNCTION app.checkpoint_answer_submission_context'),
  draft.indexOf('CREATE FUNCTION app.checkpoint_answer_receipt_record'),
);
const accept = draft.slice(
  draft.indexOf('CREATE FUNCTION app.accept_checkpoint_answer'),
  draft.indexOf('-- Remove unexpected inherited'),
);
/** Text inspection only: no SQL parsing, execution, catalog, concurrency or permission proof. */
describe('Unregistered typed official DRAFT0022 source proposal', () => {
  it('seeds no policy, allowance, route, definition, result, account or activation', () => {
    expect(draft).toContain('REVIEW DRAFT ONLY');
    expect(draft).toContain('native parity is UNVERIFIED');
    expect(journal).not.toContain('0022_checkpoint_answer_submissions');
    expect(draft).toContain('enabled boolean NOT NULL DEFAULT false');
    expect(draft).not.toMatch(
      /INSERT INTO app\.(checkpoint_answer_submit_policies|checkpoint_definitions)|CREATE ROLE|CREATE USER|PASSWORD\s*=/i,
    );
    expect(draft).not.toMatch(/graded_allowance[^\n]*(?:DEFAULT|=\s*3\b)/);
    expect(draft).not.toMatch(
      /ALTER TABLE app\.checkpoint_(attempts|definitions|outcomes)|CREATE OR REPLACE FUNCTION/,
    );
  });
  it('requires separate provider/application binding and live locked cohort authority', () => {
    expect(context).toContain('auth_id uuid,learner uuid');
    expect(context).toContain('u IS DISTINCT FROM learner');
    expect(context).toContain('auth_user_id=auth_id AND active');
    expect(context).toContain('curriculum_version_id=a.curriculum_version_id');
    expect(context).toContain('checkpoint_lock_access');
    expect(accept.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      accept.indexOf('checkpoint_lock_access'),
    );
    expect(accept.indexOf('FOR UPDATE')).toBeLessThan(
      accept.indexOf('checkpoint_answer_submission_context'),
    );
  });
  it('uses only exact frozen typed contracts, an explicit allowance and a reviewed evaluator route', () => {
    for (const field of ['answerContract', 'officialAnswerPolicy', 'answerEvaluator'])
      expect(context).toContain("item->'" + field + "'");
    expect(context).toContain("app.checkpoint_digest(a.snapshot,'nextera-checkpoint-attempt')");
    expect(context).toContain("a.snapshot->>'started_at'");
    expect(context).toContain("a.snapshot->>'deadline_at'");
    expect(context).toContain(
      "p.graded_allowance IS DISTINCT FROM (allowance->>'gradedAllowance')::integer",
    );
    expect(context).not.toMatch(/submissionRules|\.go|FROM app\.checkpoint_definitions/);
    expect(draft).not.toMatch(
      /INSERT INTO judge\.|INSERT INTO app\.(submissions|submission_artifacts|checkpoint_outcomes)|accept_checkpoint_submission|visible_run/,
    );
  });
  it('commits exactly one immutable receipt/outbox/debit triple, guarded in both FK directions', () => {
    expect(accept.match(/INSERT INTO app\.checkpoint_answer_receipts/g)).toHaveLength(1);
    expect(accept.match(/INSERT INTO app\.checkpoint_answer_outbox/g)).toHaveLength(1);
    expect(accept.match(/INSERT INTO app\.checkpoint_answer_allowance_debits/g)).toHaveLength(1);
    expect(draft.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(2);
    expect(draft).toContain('CHECK(outbox_receipt_id=id)');
    expect(draft).toContain('CHECK(debit_receipt_id=id)');
    expect(draft).toContain('UNIQUE(user_id,request_id)');
    expect(draft).toContain('units integer NOT NULL CHECK(units=1)');
    for (const table of ['receipts', 'outbox', 'allowance_debits'])
      expect(draft).toContain('BEFORE UPDATE OR DELETE ON app.checkpoint_answer_' + table);
    const outbox = draft.slice(
      draft.indexOf('CREATE TABLE app.checkpoint_answer_outbox'),
      draft.indexOf('-- One pending allowance'),
    );
    expect(outbox).not.toMatch(/answer_bytes|payload|grader|verdict|points/);
    expect(outbox).toContain("CHECK(evaluation='pending')");
  });
  it('rechecks clock before replay and reconciles exact bytes/contract/evaluator before new debit', () => {
    expect(accept.indexOf('at_time>=a.deadline_at')).toBeLessThan(
      accept.indexOf('SELECT * INTO old'),
    );
    expect(accept.indexOf('old.answer_bytes IS DISTINCT FROM payload')).toBeLessThan(
      accept.indexOf('IF NOT allow_new'),
    );
    for (const field of [
      'auth_user_id',
      'cohort_id',
      'attempt_id',
      'task_key',
      'definition_digest',
      'snapshot_digest',
      'answer_contract_digest',
      'answer_kind',
      'answer_digest',
      'evaluator_key',
      'evaluator_digest',
    ])
      expect(accept).toContain('old.' + field);
    expect(accept.indexOf("'replayed',true")).toBeLessThan(
      accept.indexOf('INSERT INTO app.checkpoint_answer_receipts'),
    );
    expect(accept).toContain('used>=p.graded_allowance');
    expect(accept).not.toContain('WHEN OTHERS');
  });
  it('shares canonical validation and proposes exact ES trim completeness without decoding NUL', () => {
    const complete = draft.slice(
      draft.indexOf('CREATE FUNCTION app.checkpoint_answer_payload_complete'),
      draft.indexOf('CREATE FUNCTION app.checkpoint_answer_submission_context'),
    );
    expect(draft).not.toContain('CREATE FUNCTION app.checkpoint_answer_payload_valid');
    expect(complete).toContain('IF NOT app.checkpoint_answer_payload_valid(payload,kind)');
    expect(complete).toContain("json_each(convert_from(payload,'UTF8')::json)");
    expect(complete).not.toMatch(/::jsonb|->>|btrim\s*\(|trim\s*\(/);
    for (const point of [
      32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233,
      8239, 8287, 12288, 65279,
    ])
      expect(complete).toContain('chr(' + point + ')');
    expect(complete).toContain('$json_whitespace$');
    expect(complete).toContain('\\\\(?:[tnrf]|u000b)');
    expect(complete).toContain('field.value::text COLLATE pg_catalog."C" ~ blank_pattern');
    expect(complete).not.toMatch(/token:=replace|translate\(|substring\(/);
    expect(complete).not.toContain('u0000');
  });
  it('requires the shared exact reviewed validator body and contract before DRAFT0022 can qualify', () => {
    expect(CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_SHA256).toBe(
      'dfaeffc7bdcee0bee7d28a0182ba5184ee72bcb9d5763db7b9a15e88f9b20816',
    );
    expect(draft).toContain('OR NOT (' + CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL + ')');
    expect(draft).toContain(CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_SHA256);
    expect(CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL).toContain('p.prosrc');
    expect(CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL).toContain('p.proisstrict');
    expect(CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL).toContain('NOT p.prosecdef');
  });
  it('differentially checks the SQL-source token grammar against ES trim, including escape boundaries', () => {
    const complete = draft.slice(
      draft.indexOf('CREATE FUNCTION app.checkpoint_answer_payload_complete'),
      draft.indexOf('CREATE FUNCTION app.checkpoint_answer_submission_context'),
    );
    const sourcePattern = complete.match(/\$json_whitespace\$([\s\S]*?)\$json_whitespace\$/)?.[1];
    expect(sourcePattern).toBeDefined();
    const whitespace = [...complete.matchAll(/chr\((\d+)\)/g)]
      .map((match) => String.fromCodePoint(Number(match[1])))
      .join('');
    const pattern = new RegExp(
      sourcePattern!.replace('@WHITESPACE@', whitespace).replace('\\A', '^').replace('\\Z', '$'),
      'u',
    );
    let checked = 0;
    const compare = (text: string) => {
      const token = JSON.stringify(text);
      const actualBlank = pattern.test(token),
        expectedBlank = text.trim().length === 0;
      if (actualBlank !== expectedBlank) throw new Error('Completeness token mismatch: ' + token);
      checked++;
    };
    // Every Unicode scalar single; surrogate code units cannot represent valid answer UTF8.
    for (let point = 0; point <= 0x10ffff; point++)
      if (point < 0xd800 || point > 0xdfff) compare(String.fromCodePoint(point));
    const alphabet = [
      ' ',
      '\t',
      '\n',
      '\v',
      '\f',
      '\r',
      '\u0000',
      '\\',
      't',
      'n',
      'r',
      'f',
      'u',
      '0',
      'b',
      '"',
      '\u00a0',
      '\ufeff',
      '\u200b',
      '\u0085',
      '\u{1f600}',
    ];
    const visit = (text: string, depth: number) => {
      compare(text);
      compare(whitespace + text + whitespace);
      if (depth === 4) return;
      for (const char of alphabet) visit(text + char, depth + 1);
    };
    visit('', 0);
    for (const text of [
      String.fromCharCode(92, 116, 110),
      String.fromCharCode(92, 116, 114),
      String.fromCharCode(92, 116, 102),
      String.fromCharCode(92, 116) + 'u000b',
      '\\tn',
      '\\tr',
      '\\tf',
      '\\\\tn',
      '\u0000',
    ]) {
      expect(text.trim()).not.toBe('');
      expect(pattern.test(JSON.stringify(text))).toBe(false);
    }
    expect(checked).toBeGreaterThan(1_500_000);
  }, 30_000);
  it('retains owner isolation and grants only context/accept narrow RPC execution to web', () => {
    expect(draft).toContain('FROM PUBLIC,nextera_web');
    expect(draft.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(4);
    const grants = draft.split('\n').filter((line) => line.startsWith('GRANT EXECUTE'));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toContain('checkpoint_answer_submission_context');
    expect(grants[0]).toContain('accept_checkpoint_answer');
    expect(grants[0]).not.toMatch(/payload_complete|receipt_record|guard_/);
    expect(draft).toContain('aclexplode');
    expect(draft).toContain("NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET')");
  });
});
