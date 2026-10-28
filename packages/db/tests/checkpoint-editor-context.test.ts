import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { OperationalDatabase } from '../operations/curriculum';
import {
  checkpointEditorContextReady,
  readCheckpointEditorContext,
  CheckpointEditorContextError,
} from '../queries/checkpoint-editor-context';
const auth = '00000000-0000-4000-8000-000000000001',
  attempt = '00000000-0000-4000-8000-000000000002';
const value = {
  scope: {
    learnerId: '00000000-0000-4000-8000-000000000003',
    cohortId: '00000000-0000-4000-8000-000000000004',
    attemptId: attempt,
    taskKey: 'a',
    definitionDigest: 'a'.repeat(64),
  },
  readAllowed: true,
  status: 'active',
  serverNow: '2026-10-28T10:00:00Z',
  deadline: '2026-10-28T11:00:00Z',
  sourceBytes: 1024,
  filename: 'answer.go',
  submitAllowed: true,
};
function setup(data: unknown = value) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([{ contract: true, caller_isolation: true }])
    .mockResolvedValueOnce([{ data }]);
  return { execute, db: { execute } as unknown as OperationalDatabase };
}
describe('Independent official editor context query', () => {
  it('reads only after readiness attestation and projects immutable source scope', async () => {
    const f = setup();
    expect(await readCheckpointEditorContext(f.db, auth, attempt, 'a')).toEqual(value);
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it.each([
    { contract: false, caller_isolation: true },
    { contract: true, caller_isolation: false },
    { contract: 'true', caller_isolation: true },
  ])('fails closed on missing or broad context authority %o', async (row) => {
    const f = setup();
    f.execute.mockReset().mockResolvedValue([row]);
    expect(await checkpointEditorContextReady(f.db)).toBe(false);
    await expect(readCheckpointEditorContext(f.db, auth, attempt, 'a')).rejects.toThrow(
      CheckpointEditorContextError,
    );
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed input without database queries', async () => {
    const f = setup();
    await expect(readCheckpointEditorContext(f.db, auth, attempt, '../a')).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([
    { scope: { ...value.scope, attemptId: auth } },
    { scope: { ...value.scope, taskKey: 'b' } },
    { scope: { ...value.scope, definitionDigest: 'x' } },
    { sourceBytes: 0 },
    { sourceBytes: 262145 },
    { filename: '../a.go' },
    { submitAllowed: 'true' },
    { status: 'closed' },
    { serverNow: value.deadline },
  ])('rejects malformed response or stale submission claim %o', async (patch) => {
    const f = setup({ ...value, ...patch });
    await expect(readCheckpointEditorContext(f.db, auth, attempt, 'a')).rejects.toThrow(
      CheckpointEditorContextError,
    );
  });
  it('preserves a closed authorized context without enabling Submit', async () => {
    const f = setup({ ...value, status: 'closed', submitAllowed: false });
    expect((await readCheckpointEditorContext(f.db, auth, attempt, 'a')).submitAllowed).toBe(false);
  });
  it('does not expose arbitrary database diagnostics', async () => {
    const f = setup();
    f.execute
      .mockReset()
      .mockResolvedValueOnce([{ contract: true, caller_isolation: true }])
      .mockRejectedValueOnce(new Error('private diagnostic'));
    await expect(readCheckpointEditorContext(f.db, auth, attempt, 'a')).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it('keeps the context function in a migration draft and avoids mutable-definition authority', () => {
    const sql = readFileSync(
      new URL('../migration-drafts/0014_checkpoint_editor_context.DRAFT.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain('REVIEW DRAFT ONLY');
    expect(sql).toContain("a.snapshot->'definition'->'tasks'");
    expect(sql).toContain("'definitionDigest',a.definition_digest");
    expect(sql).toContain('u:=app.checkpoint_user(auth_id,a.cohort_id)');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION app.checkpoint_editor_context(uuid,uuid,text) FROM PUBLIC',
    );
    expect(sql).not.toMatch(/CREATE ROLE|CREATE USER|GRANT ALL|INSERT INTO|UPDATE app|DELETE FROM/);
    const journal = readFileSync(
      new URL('../migrations/meta/_journal.json', import.meta.url),
      'utf8',
    );
    expect(journal).not.toContain('0014');
  });
});
