import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const draft = read('migration-drafts/0038_scored_exam_trace_context.DRAFT.sql');
const original = read('migration-drafts/0024_exam_scoring_review.DRAFT.sql');
const processor = read('operations/scored-exam-trace.ts');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function body(source: string, name: string) {
  const start = source.indexOf('FUNCTION app.' + name + '(');
  expect(start).toBeGreaterThanOrEqual(0);
  const begin = source.indexOf('AS $$', start) + 5;
  const end = source.indexOf('$$;', begin);
  expect(end).toBeGreaterThan(begin);
  return source.slice(begin, end);
}
const reader = body(draft, 'scored_exam_trace_context');
const oldValidator = body(original, 'exam_scoring_source_binding_valid');
const validator = body(draft, 'exam_scoring_source_binding_valid');

// Tiny source-only argument splitter; this is not a PostgreSQL parser or SQL execution.
function argumentsOf(source: string) {
  let depth = 0,
    quoted = false,
    start = 0;
  const args: string[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "'") {
      if (quoted && source[i + 1] === "'") {
        i++;
        continue;
      }
      quoted = !quoted;
    } else if (!quoted) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) {
          args.push(source.slice(start, i).trim());
          return args;
        }
        depth--;
      } else if (ch === ',' && depth === 0) {
        args.push(source.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  throw new Error('Unterminated source argument list');
}
const objectFields = (args: string[]) =>
  args
    .filter((_, index) => index % 2 === 0)
    .map((key) => {
      expect(key).toMatch(/^'[A-Za-z][A-Za-z0-9]*'$/);
      return key.slice(1, -1);
    });

describe('unapplied0038 restricted trace reader SQL contract', () => {
  it('is one unregistered append-only draft and leaves the original validator source unchanged', () => {
    expect(draft).toContain('SOURCE REVIEW DRAFT ONLY');
    expect(draft).toContain('BEGIN;');
    expect(draft.trimEnd()).toMatch(/COMMIT;$/);
    expect(read('migrations/meta/_journal.json')).not.toContain('0038');
    expect(draft.match(/CREATE (?:OR REPLACE )?FUNCTION app\./g)).toHaveLength(2);
    expect(draft).not.toMatch(
      /(?:CREATE|ALTER|DROP) (?:ROLE|SCHEMA)|GRANT (?:SELECT|UPDATE|REFERENCES)|GRANT nextera_/,
    );
    expect(draft).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) app\./);
    expect(sha(original)).toBe('feab3623aaa1accf30f1391776427520f64cbe46dea99ed14ee02d41d5025292');
  });
  it('makes only the additive comparator allowlist change to the pinned private validator body', () => {
    expect(validator).toBe(
      oldValidator.replace(
        "d->>'traceComparator' IS DISTINCT FROM 'exact_utf8'",
        "d->>'traceComparator' NOT IN ('exact_utf8','crlf_lf_optional_terminal_lf_v1')",
      ),
    );
    expect(draft).toContain(
      "p.oid=to_regprocedure('app.exam_scoring_source_binding_valid(jsonb,jsonb)')",
    );
    expect(draft).toContain(
      "encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='" + sha(oldValidator) + "'",
    );
    expect(draft).toContain(
      "encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='" + sha(validator) + "'",
    );
    expect(draft).toContain('p.proacl IS NOT DISTINCT FROM old.proacl');
    expect(draft).toContain('old.oid=p.oid');
    expect(draft).toContain('EXAM_TRACE_PRIOR_VALIDATOR_REQUIRED');
  });
  it('requires a fresh direct DBA and already-held confined owner span without granting one', () => {
    expect(draft).toContain("current_database() !~ '^foundation_test_[a-z0-9_]+$'");
    expect(draft).toContain('exam-trace-reader-0038-bootstrap-dba-v1');
    expect(draft).toContain('current_user IS DISTINCT FROM session_user');
    expect(draft).toContain("pg_has_role(current_user,'nextera_checkpoint_owner','SET')");
    expect(draft).toContain("NOT has_table_privilege('nextera_checkpoint_owner',rel,'SELECT')");
    expect(draft).toContain(
      'AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls',
    );
    expect(draft).toContain('EXAM_TRACE_OWNER_SPAN_RESTORATION_REQUIRED');
  });
  it('rechecks the actual enabled evaluator login and exact route on every invocation', () => {
    expect(reader).toContain("current_setting('role')<>'none'");
    expect(reader).toContain("pg_has_role(session_user,'nextera_exam_evaluator','USAGE')");
    expect(reader).toContain('rolname=session_user AND rolcanlogin');
    expect(reader).toContain(
      "pg_has_role(session_user,denied.oid,'USAGE') OR pg_has_role(session_user,denied.oid,'SET')",
    );
    for (const role of [
      'nextera_web',
      'nextera_checkpoint_owner',
      'nextera_result_application',
      'nextera_runner',
      'nextera_judge_owner',
      'nextera_judge_maintenance',
    ])
      expect(reader).toContain("'" + role + "'");
    expect(reader).toContain('WHERE login_name=session_user AND enabled FOR SHARE');
    expect(reader).toContain('evaluator.evaluator_key IS DISTINCT FROM typed.evaluator_key');
    expect(reader).toContain('evaluator.evaluator_digest IS DISTINCT FROM typed.evaluator_digest');
    expect(reader).not.toMatch(/claimedRole|auth_id|current_setting\('.*evaluator/);
  });
  it('binds the complete immutable accepted receipt/outbox/debit/structured-scoring tuple', () => {
    expect(reader).toContain("typed.task_key NOT IN('q6','q7')");
    expect(reader).toContain("acc.source_kind IS DISTINCT FROM 'structured'");
    for (const check of [
      'acc.attempt_id IS DISTINCT FROM a.id',
      'acc.snapshot_digest IS DISTINCT FROM a.snapshot_digest',
      'acc.answer_digest IS DISTINCT FROM typed.answer_digest',
      'acc.accepted_at IS DISTINCT FROM typed.accepted_at',
      'typed.curriculum_version_id IS DISTINCT FROM a.curriculum_version_id',
      'typed.node_key IS DISTINCT FROM a.node_key',
      'intent.created_at IS DISTINCT FROM typed.accepted_at',
      'debit.units IS DISTINCT FROM 1',
      'debit.created_at IS DISTINCT FROM typed.accepted_at',
      'debit.attempt_id IS DISTINCT FROM a.id',
      'debit.task_key IS DISTINCT FROM typed.task_key',
      'acc.accepted_ordinal>=closed.closure_ordinal',
    ])
      expect(reader).toContain(check);
    expect(reader).toContain("a.deadline_at IS DISTINCT FROM a.started_at+interval '180 minutes'");
    expect(reader).toContain("n.resolved_evaluation_spec=a.snapshot->'evaluation_spec'");
    expect(reader).toContain('app.scored_exam_attempt_metadata(a)');
  });
  it('checks the frozen route, canonical raw payload, approved provenance and own current head', () => {
    expect(reader).toContain("contract-ARRAY['version','kind','maxBytes']");
    expect(reader).toContain(
      "route IS DISTINCT FROM jsonb_build_object('family','checkpoint_structured_answer'",
    );
    expect(reader).toContain('app.checkpoint_answer_contract_digest(a.user_id,a.cohort_id,a.id,');
    expect(reader).toContain("encode(sha256(typed.answer_bytes),'hex')");
    expect(reader).toContain(
      "app.checkpoint_answer_payload_complete(typed.answer_bytes,'trace_with_reason')",
    );
    expect(reader).toContain(
      "'answerBase64',replace(encode(typed.answer_bytes,'base64'),E'\\n','')",
    );
    expect(reader).toContain("'answerByteLength',octet_length(typed.answer_bytes)");
    expect(reader.match(/Sentinel_e849fe300ea88191acd6431b61521c7a/g)).toHaveLength(2);
    expect(reader).toContain("traceComparator' IS DISTINCT FROM 'crlf_lf_optional_terminal_lf_v1'");
    expect(reader).toContain(
      'SELECT h.revision INTO revision FROM app.exam_scoring_heads h WHERE h.submission_id=receipt FOR SHARE',
    );
    expect(reader).toContain("'expectedRevision',revision::text");
    expect(reader).toContain(
      "'acceptedAtMicros',(extract(epoch FROM typed.accepted_at)*1000000)::bigint::text",
    );
    expect(reader).toContain(
      "WHEN OTHERS THEN RAISE EXCEPTION 'EXAM_TRACE_CONTEXT_UNAVAILABLE' USING ERRCODE='PS005'",
    );
  });
  it('keeps accepted grading independent from current learner intake and foreign-owner row locks', () => {
    expect(reader).not.toMatch(
      /clock_timestamp|checkpoint_user\(|checkpoint_lock_access\(|checkpoint_answer_submission_context\(|a\.status|u\.active|c\.status|policy\.enabled/,
    );
    expect(reader.match(/FOR SHARE/g)).toHaveLength(2);
    expect(reader).not.toContain('FOR UPDATE');
    expect(reader).not.toMatch(/WHERE id=typed\.attempt_id FOR|WHERE id=a\.user_id FOR/);
    expect(draft).not.toMatch(/GRANT UPDATE|GRANT SELECT/);
  });
  it('matches the exact processor context and outbox ABI without returning oracle/private criteria bytes', () => {
    const names = processor
      .match(/const contextNames = \[([\s\S]+?)\] as const;/)![1]!
      .match(/'[A-Za-z][A-Za-z0-9]*'/g)!
      .map((k) => k.slice(1, -1));
    const result = argumentsOf(reader.split('RETURN jsonb_build_object(', 2)[1]!);
    expect(objectFields(result)).toEqual(names);
    const outboxAt = result.indexOf("'outbox'");
    const outbox = argumentsOf(result[outboxAt + 1]!.slice('jsonb_build_object('.length));
    expect(objectFields(outbox)).toEqual([
      'receiptId',
      'answerSha256',
      'snapshotDigest',
      'evaluatorKey',
      'evaluatorDigest',
      'evaluation',
    ]);
    expect(objectFields(result)).not.toContain('expectedOutput');
    expect(reader).not.toMatch(/expectedOutput|checkpointDocument|criteria_text|manifest_bytes/);
  });
  it('guards immutable private prerequisites and preserves exact narrow final ACLs', () => {
    expect(draft).toContain('EXAM_TRACE_IMMUTABLE_HISTORY_REQUIRED');
    expect(draft).toContain("AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgtype=27");
    expect(draft).toContain('c.relrowsecurity');
    const grants = draft.match(/GRANT[^;]+;/g) ?? [];
    expect(grants).toEqual([
      'GRANT EXECUTE ON FUNCTION app.scored_exam_trace_context(uuid) TO nextera_exam_evaluator;',
    ]);
    expect(draft).toContain("g.rolname IS DISTINCT FROM 'nextera_exam_evaluator'");
    expect(draft).toContain("a.privilege_type<>'EXECUTE' OR a.is_grantable");
    expect(draft).toContain("p.provolatile='v' AND NOT p.proisstrict AND p.prosecdef");
    expect(draft).toContain(
      "encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='" + sha(reader) + "'",
    );
  });
});
