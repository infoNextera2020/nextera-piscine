import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_SHA256,
  CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL,
  encodeCheckpointAnswerDraft,
  type AnswerKind,
} from '../queries/checkpoint-answer-drafts';
import {
  answerKinds,
  canonicalAnswerPayload,
  canonicalAnswerVectors,
  invalidTextFieldHex,
} from './fixtures/checkpoint-answer-canonical-vectors';
const draft = readFileSync(
  new URL('../migration-drafts/0021_checkpoint_answer_drafts.DRAFT.sql', import.meta.url),
  'utf8',
);
const journal = readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8');
/** Static SQL source review only. No PostgreSQL parsing, execution, concurrency or ACL rehearsal. */
describe('Unapplied structured answer DRAFT0021', () => {
  it('remains outside the migration journal and enables no policy or assessment data', () => {
    expect(draft).toContain('REVIEW DRAFT ONLY');
    expect(draft).toContain('escaped NUL stays ASCII and is never decoded');
    expect(draft).toContain(
      'Must not be activated before a separately authorized native PostgreSQL parity/ACL rehearsal',
    );
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
    const start = draft.indexOf('CREATE FUNCTION app.checkpoint_answer_draft_context');
    const end = draft.indexOf('CREATE FUNCTION app.checkpoint_answer_payload_valid');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const context = draft.slice(start, end);
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
    expect(draft).toContain('RETURN body COLLATE pg_catalog."C" ~ canonical_pattern');
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

/** This executes the exact source grammar in JavaScript, not PostgreSQL.
 * Only the documented PostgreSQL anchors are translated. It cannot attest native
 * regex, UTF-8 conversion, ACLs, locking, retention or persistence behavior. */
const validator = draft.slice(
  draft.indexOf('CREATE FUNCTION app.checkpoint_answer_payload_valid'),
  draft.indexOf('CREATE FUNCTION app.checkpoint_answer_draft_record'),
);
function sourcePattern(tag: string) {
  const marker = '$' + tag + '$';
  const pieces = validator.split(marker);
  if (pieces.length !== 3) throw new Error('Expected one frozen source pattern: ' + tag);
  return pieces[1]!;
}
const stringPattern = sourcePattern('json_string');
const patterns = Object.fromEntries(
  answerKinds.map((kind) => {
    const shape = sourcePattern(kind === 'trace_with_reason' ? 'trace' : 'debug');
    if (!shape.startsWith('\\A') || !shape.endsWith('\\Z'))
      throw new Error('Missing whole-text anchors');
    return [
      kind,
      new RegExp(
        '^' + shape.slice(2, -2).replaceAll('@STRING@', stringPattern) + '(?![\\s\\S])',
        'u',
      ),
    ];
  }),
) as Record<AnswerKind, RegExp>;
function sourceGrammarBytes(bytes: Uint8Array, kind: AnswerKind) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    // PostgreSQL text cannot contain raw NUL. This models that boundary; it does not execute it.
    return !text.includes('\u0000') && patterns[kind].test(text);
  } catch {
    return false;
  }
}
function sourceGrammar(payload: string, kind: AnswerKind) {
  const bytes = Buffer.from(payload, 'utf8');
  return bytes.toString('utf8') === payload && sourceGrammarBytes(bytes, kind);
}
function typedEncoderAccepts(payload: string) {
  try {
    encodeCheckpointAnswerDraft(payload);
    return true;
  } catch {
    return false;
  }
}
describe('Pure DRAFT0021 canonical grammar vectors (no native PostgreSQL proof)', () => {
  it('pins the exact corrected SQL function body and the unchanged internal helper contract', () => {
    const start = validator.indexOf('AS $$');
    const end = validator.indexOf('$$;', start + 'AS $$'.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = validator.slice(start + 'AS $$'.length, end);
    expect(createHash('sha256').update(body, 'utf8').digest('hex')).toBe(
      CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_SHA256,
    );
    const pin = CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL;
    for (const requirement of [
      "p.proname='checkpoint_answer_payload_valid'",
      'pg_catalog.oidvectortypes(p.proargtypes)',
      "='bytea,text'",
      "p.prorettype='pg_catalog.bool'::pg_catalog.regtype",
      "l.lanname='plpgsql'",
      "p.provolatile='i'",
      'p.proisstrict AND NOT p.prosecdef',
      "p.proconfig=ARRAY['search_path=pg_catalog']",
      "o.rolname='nextera_checkpoint_owner'",
      "pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8'))",
      "pg_catalog.decode('" + CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_SHA256 + "','hex')",
      "a.grantee<>p.proowner AND a.privilege_type='EXECUTE'",
    ])
      expect(pin).toContain(requirement);
    expect(pin).not.toContain("rolname='nextera_web'");
  });

  it('uses only frozen text patterns and leaves escaped NUL undecoded', () => {
    expect(validator).toContain("body:=convert_from(payload,'UTF8')");
    expect(validator).toContain('body COLLATE pg_catalog."C" ~ canonical_pattern');
    expect(validator).toContain('ELSE RETURN false');
    expect(validator).toContain('EXCEPTION WHEN OTHERS THEN RETURN false');
    expect(validator).not.toMatch(
      /jsonb|::json|json_each|->|trim\s*\(|normalize|replace\s*\(\s*body/i,
    );
    expect(stringPattern).toContain('\\u0001-\\u001f');
    expect(stringPattern).not.toContain('[:cntrl:]');
    expect(sourcePattern('trace').match(/@STRING@/g)).toHaveLength(2);
    expect(sourcePattern('debug').match(/@STRING@/g)).toHaveLength(3);
  });
  it.each(answerKinds)(
    'agrees with canonical encoding for every synthetic %s vector',
    (kind) => {
      const mismatches: string[] = [];
      let checked = 0;
      for (const vector of canonicalAnswerVectors(kind)) {
        const grammar = sourceGrammar(vector.payload, kind);
        const typed = typedEncoderAccepts(vector.payload);
        if (grammar !== vector.valid || typed !== vector.valid)
          mismatches.push(
            vector.name +
              ': grammar=' +
              grammar +
              ', typed=' +
              typed +
              ', expected=' +
              vector.valid,
          );
        checked++;
      }
      expect(mismatches.slice(0, 20)).toEqual([]);
      expect(checked).toBe(68124);
    },
    15_000,
  );
  it.each(answerKinds)('rejects every malformed UTF-8/raw-NUL byte vector for %s', (kind) => {
    for (const hex of invalidTextFieldHex) {
      const marker = 'ANSWER-BYTE-MARKER';
      const payload = canonicalAnswerPayload(kind, marker);
      const offset = payload.indexOf(marker);
      const bytes = Buffer.concat([
        Buffer.from(payload.slice(0, offset)),
        Buffer.from(hex, 'hex'),
        Buffer.from(payload.slice(offset + marker.length)),
      ]);
      expect(sourceGrammarBytes(bytes, kind), hex).toBe(false);
    }
  });
  it.each(answerKinds)(
    'keeps raw DEL, non-BMP scalars and literal escape text distinct for %s',
    (kind) => {
      for (const text of [
        '\u007f',
        '😀',
        '\u2028\u2029',
        '\uFEFF\r\n\u0000',
        '\\u0000',
        '\u00000',
      ]) {
        const payload = canonicalAnswerPayload(kind, text);
        expect(sourceGrammar(payload, kind)).toBe(true);
        expect(encodeCheckpointAnswerDraft(payload).payload).toBe(payload);
      }
      const other = kind === 'trace_with_reason' ? 'debug_with_reason' : 'trace_with_reason';
      expect(sourceGrammar(canonicalAnswerPayload(kind, ''), other)).toBe(false);
    },
  );
});
