import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const original = readFileSync(
  new URL('../migrations/0007_checkpoint_operations.sql', import.meta.url),
  'utf8',
);
const draft = readFileSync(
  new URL('../migration-drafts/0025_exam_legacy_finalizer_guard.DRAFT.sql', import.meta.url),
  'utf8',
);
describe('mixed exam legacy-finalizer guard SOURCE, not native SQL proof', () => {
  it('preserves registered source and exact unmarked legacy behavior', () => {
    expect(createHash('sha256').update(original).digest('hex')).toBe(
      '99e9d01c77f6eeb9f6f968e903375083531a3d2f112dfaca3249d458aaeeb35c',
    );
    const old = original.slice(
      original.indexOf('CREATE FUNCTION app.finalize_checkpoint('),
      original.indexOf('END $$;', original.indexOf('CREATE FUNCTION app.finalize_checkpoint(')) + 7,
    );
    const added = draft
      .split('$trusted_finalizer$')[1]!
      .trim()
      .replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
    const restored = added.replace(
      / -- A marked mixed[\s\S]+? END IF;\n(?= SELECT id INTO oid)/,
      '',
    );
    expect(restored).toBe(old);
  });
  it('guards any scoring marker before all legacy outcome/progression writes', () => {
    const body = draft.split('$trusted_finalizer$')[1]!;
    expect(body.indexOf("? 'examScoring'")).toBeLessThan(body.indexOf('SELECT id INTO oid'));
    const guard = body.slice(
      body.indexOf(' -- A marked mixed'),
      body.indexOf(' SELECT id INTO oid'),
    );
    expect(guard).toContain("a.status='active' AND at_time>=a.deadline_at");
    expect(guard).toContain("status='evaluating',closed_at=deadline_at,closure_reason='expired'");
    expect(guard).toContain('RETURN NULL;');
    expect(guard).not.toMatch(
      /INSERT|accept_checkpoint_submission|passed_count|learner_node_progress/,
    );
  });
  it('requires exact original function and unchanged owner/caller ACL, with transactional failure', () => {
    expect(draft).toContain("current_user<>'nextera_checkpoint_owner'");
    expect(draft).toContain('new_proc.proacl IS DISTINCT FROM old_proc.proacl');
    expect(draft).toContain('new_proc.proowner IS DISTINCT FROM old_proc.proowner');
    expect(draft).toContain('BEGIN;');
    expect(draft.trim()).toMatch(/COMMIT;$/);
    expect(draft).not.toMatch(
      /CREATE ROLE|GRANT |ALTER ROLE|SET ROLE|UPDATE app.checkpoint_outcomes/,
    );
  });
});
