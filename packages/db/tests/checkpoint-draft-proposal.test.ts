import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const draft = readFileSync(
  new URL('../migration-drafts/0011_checkpoint_drafts.DRAFT.sql', import.meta.url),
  'utf8',
);
const journal = readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8');

/** These are source/activation guard checks, NOT PostgreSQL execution or race tests. */
describe('Unapplied draft migration activation boundary', () => {
  it('is not registered with the ordinary migration runner and does not seed policies/data', () => {
    expect(journal).not.toContain('0011_checkpoint_drafts');
    expect(draft).toContain('REVIEW DRAFT ONLY');
    expect(draft).not.toMatch(/INSERT INTO app\.checkpoint_draft_policies/i);
    expect(draft).toContain('enabled boolean NOT NULL DEFAULT false');
  });
  it('creates no roles/accounts/credentials and grants no direct draft table access to web', () => {
    expect(draft).not.toMatch(/\bCREATE ROLE\b|\bPASSWORD\s*=/i);
    expect(draft).toContain('FROM PUBLIC,nextera_web');
    expect(draft).not.toMatch(/GRANT\s+nextera_checkpoint_owner\s+TO/i);
    const grants = draft.split('\n').filter((line) => line.startsWith('GRANT EXECUTE'));
    expect(grants).toHaveLength(1);
    expect(grants[0]).not.toContain('purge_expired');
  });
  it('proposes immutable byte receipts, same-learner lock order and CAS before insertion', () => {
    expect(draft).toContain('source_bytes bytea NOT NULL');
    expect(draft).toContain('sha256(source)');
    expect(draft).toContain('UNIQUE(user_id,request_id)');
    const save = draft.slice(draft.indexOf('CREATE FUNCTION app.save_checkpoint_draft'));
    expect(save.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      save.indexOf('checkpoint_lock_access'),
    );
    expect(save.indexOf('IF base<>head')).toBeLessThan(
      save.indexOf('INSERT INTO app.checkpoint_draft_revisions'),
    );
    expect(save.indexOf('SELECT * INTO old')).toBeLessThan(save.indexOf("a.status<>'active'"));
  });
  it('does not assign grading/progression effects and bounds cleanup to already-expired rows', () => {
    expect(draft).not.toMatch(/INSERT INTO (judge\.|app\.submissions|app\.learner_node_progress)/i);
    expect(draft).toContain('batch IS NULL OR batch NOT BETWEEN 1 AND 1000');
    expect(draft).toContain('least(cutoff,clock_timestamp())');
    expect(draft).toContain('FOR UPDATE SKIP LOCKED');
  });
});
