import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const draft = read('migration-drafts/0037_quest_review_persistence.DRAFT.sql');
function body(name: string) {
  const start = draft.indexOf('CREATE FUNCTION app.' + name + '(');
  expect(start).toBeGreaterThanOrEqual(0);
  const begin = draft.indexOf('AS $$', start);
  const end = draft.indexOf('$$;', begin + 5);
  expect(begin).toBeGreaterThan(start);
  expect(end).toBeGreaterThan(begin);
  return draft.slice(begin + 5, end);
}

describe('unapplied0037 initial quest-review persistence contract', () => {
  it('stays unregistered, new-target only and separate from registered migrations', () => {
    expect(draft.trim()).toMatch(/^-- SOURCE-ONLY \/ UNREGISTERED/);
    expect(draft).toContain('BEGIN;');
    expect(draft.trim()).toMatch(/COMMIT;$/);
    expect(draft).toContain("current_database() NOT LIKE 'foundation_test%'");
    expect(draft).toContain("current_setting('role')<>'none'");
    expect(draft).toContain("current_setting('server_encoding')<>'UTF8'");
    expect(draft).toContain('QUEST_REVIEW_FRESH_DRAFT_REQUIRED');
    expect(read('migrations/meta/_journal.json')).not.toContain('0037');
    expect(
      createHash('sha256').update(read('migrations/0000_foundation_001.sql')).digest('hex'),
    ).toBe('fc06a66e470cf3daf5bda121340095bf3e0f07450a3fd92745c7cc419d88b61d');
    expect(draft.match(/CREATE TABLE app\.[a-z_]+/g)).toEqual([
      'CREATE TABLE app.quest_review_cycles',
      'CREATE TABLE app.quest_review_assignments',
      'CREATE TABLE app.quest_review_receipts',
    ]);
  });
  it('cannot activate authority or coverage with a caller flag or JSON', () => {
    expect(body('_quest_review_authority_current')).toContain(
      "RAISE EXCEPTION 'QUEST_REVIEW_CONFIGURATION_REQUIRED'",
    );
    expect(body('_quest_review_authority_current')).not.toContain('RETURN');
    expect(body('_quest_review_selection_valid').trim()).toBe('SELECT false');
    expect(body('_quest_review_authority')).toContain(
      'app._quest_review_authority_current(auth,cohort,quest,learner)',
    );
    expect(body('_quest_review_authority')).toContain('u.auth_user_id=auth');
    expect(body('_quest_review_authority')).toContain("v.status='published'");
    expect(body('quest_review_dispatch')).toContain('app._quest_review_selection_valid(a,cycle)');
    expect(body('quest_review_dispatch')).not.toMatch(/runtimeReady|enabled|approvedByCaller/);
  });
  it('pins native identities, exact five ordered IDs and immutable initial policy', () => {
    expect(draft).toContain('UNIQUE(cohort_id,quest_key,learner_id)');
    expect(draft).toContain('UNIQUE(cycle_id,kind,reviewer_id)');
    expect(draft).toContain("WHERE kind='mentor'");
    expect(draft).toContain('id uuid PRIMARY KEY, assignment_id uuid NOT NULL UNIQUE');
    expect(draft).toContain(
      'FOREIGN KEY(assignment_id,cycle_id,cohort_id,quest_key,learner_id,reviewer_id)',
    );
    expect(draft).toContain('FOREIGN KEY(cycle_id,cohort_id,quest_key,learner_id,policy_revision)');
    expect(body('_quest_review_questions_valid')).toContain('cardinality(v)=5');
    expect(body('_quest_review_questions_valid')).toContain('count(DISTINCT q COLLATE "C")');
    expect(draft).toContain("peer_gate='submitted'");
    expect(draft).not.toMatch(/peer_count[^\n]*DEFAULT/);
    expect(body('_quest_review_uuid_valid')).toContain('[0-9a-f]');
    expect(body('_quest_review_proposal')).toContain("(ctx->'bank'->'questionIds') ?");
  });
  it('locks global requests before complete graph scope and rejects a second scope', () => {
    const lock = body('quest_review_lock');
    expect(lock.indexOf("'quest-review-request-v1'")).toBeLessThan(
      lock.indexOf("'quest-review-graph-v1'"),
    );
    expect(lock).toContain('pg_advisory_xact_lock');
    expect(lock).toContain('binding IS DISTINCT FROM expected');
    expect(lock).toContain("set_config('nextera.quest_review_lock',expected::text,true)");
    const authority = body('quest_review_lock_authority');
    expect(authority).toContain('identities IS DISTINCT FROM required');
    expect(authority).toContain('ORDER BY id FOR SHARE');
    expect(authority).toContain('ORDER BY cohort_id,user_id FOR SHARE');
    expect(authority).toContain('after_value IS DISTINCT FROM before_value');
    expect(draft).not.toContain('SKIP LOCKED');
  });
  it('does not use a transaction-local consistency fence as authority', () => {
    const dispatch = body('quest_review_dispatch');
    expect(dispatch).toContain('a:=app._quest_review_authority(auth,cohort,quest,learner)');
    expect(dispatch.indexOf('a IS DISTINCT FROM before_value')).toBeLessThan(
      dispatch.indexOf('a:=app.quest_review_lock_authority'),
    );
    expect(dispatch).toContain(
      'app._quest_review_required_ids(before_value,learner) IS DISTINCT FROM required',
    );
    expect(dispatch).toContain(
      'app._quest_review_authority(auth,cohort,quest,learner) IS DISTINCT FROM a',
    );
    expect(body('quest_review_lock_authority')).toContain(
      "set_config('nextera.quest_review_context',after_value::text,true)",
    );
  });
  it('queries the whole historical peer graph and never treats a truncated graph as complete', () => {
    const dispatch = body('quest_review_dispatch');
    expect(dispatch).toContain(
      "IF count_value>max_edges THEN RETURN jsonb_build_object('complete',false,'edges','[]'::jsonb)",
    );
    expect(dispatch).toContain("WHERE x.cohort_id=cohort AND x.quest_key=quest AND x.kind='peer'");
    expect(body('_quest_review_assignment_guard')).toContain(
      'a.reviewer_id=NEW.learner_id AND a.learner_id=NEW.reviewer_id',
    );
    expect(body('_quest_review_complete_roster')).toContain('peer_total NOT IN(0,c.peer_count)');
    expect(draft).toContain('DEFERRABLE INITIALLY DEFERRED');
  });
  it('retains peer-before-mentor and exact receipt decisions without mastery or XP writes', () => {
    const dispatch = body('quest_review_dispatch');
    expect(dispatch).toContain("r.decision='submitted'");
    expect(dispatch).toContain('r.submitted_at_ms>assigned_ms');
    expect(dispatch).toContain('QUEST_MENTOR_BEFORE_PEERS');
    expect(body('_quest_review_actor')).toContain(
      "actor->'eligible' IS DISTINCT FROM 'true'::jsonb",
    );
    expect(body('_quest_review_receipt_guard')).toContain(
      "assignment.kind='peer' AND NEW.decision<>'submitted'",
    );
    expect(body('_quest_review_receipt_guard')).toContain(
      "assignment.kind='mentor' AND NEW.decision NOT IN('approved','changes_requested')",
    );
    expect(draft).not.toMatch(
      /(?:INSERT INTO|UPDATE) app\.(?:learner_node_progress|state_events|activity_events)|\bXP\b/,
    );
  });
  it('preserves timestamps and global replay without exposing another actor receipt', () => {
    const dispatch = body('quest_review_dispatch');
    expect(dispatch).toContain('WHERE id=request FOR UPDATE');
    expect(dispatch).toContain('previous.reviewer_id<>actor_id');
    expect(dispatch).toContain('QUEST_REVIEW_IDEMPOTENCY_CONFLICT');
    expect(dispatch).toContain('app._quest_review_receipt(previous) IS DISTINCT FROM receipt');
    expect(dispatch).toContain("(receipt->>'submittedAtMs')::bigint");
    expect(dispatch).not.toMatch(/ON CONFLICT[\s\S]*DO UPDATE|EXCEPTION WHEN.*unique_violation/);
    expect(body('_quest_review_stored')).toContain('ORDER BY a.assigned_at_ms,a.id');
    expect(body('_quest_review_stored')).toContain('ORDER BY r.submitted_at_ms,r.id');
  });
  it('isolates the owner and exposes only four narrow web entry points', () => {
    expect(draft).toContain(
      'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    );
    expect(draft).toContain('r.oid=m.member OR r.oid=m.roleid');
    expect(draft).toContain('ENABLE ROW LEVEL SECURITY');
    for (const table of ['cycles', 'assignments', 'receipts']) {
      expect(draft).toContain(`BEFORE UPDATE OR DELETE ON app.quest_review_${table}`);
      expect(draft).toContain(
        `ALTER TABLE app.quest_review_${table} OWNER TO nextera_quest_review_owner`,
      );
    }
    expect(body('_quest_review_immutable')).toContain('QUEST_REVIEW_HISTORY_IMMUTABLE');
    const webGrants = (draft.match(/GRANT[^;]+;/g) ?? []).filter((g) => /TO nextera_web/.test(g));
    expect(webGrants).toHaveLength(1);
    expect(webGrants[0]).toContain('GRANT EXECUTE ON FUNCTION');
    expect(webGrants[0]!.match(/app\.quest_review_/g)).toHaveLength(4);
    expect(draft).not.toMatch(/GRANT nextera_quest_review_owner|ALTER DEFAULT PRIVILEGES/);
    expect(draft).toContain(
      'GRANT UPDATE(id) ON app.users,app.cohorts TO nextera_quest_review_owner',
    );
    expect(draft).toContain(
      'GRANT UPDATE(joined_at) ON app.cohort_memberships TO nextera_quest_review_owner',
    );
    expect(body('quest_review_dispatch')).not.toContain('EXECUTE ');
  });
});
