import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import { createPostgresCheckpointOfficialSubmitAuthority } from './postgres-editor-context';
import { configureCheckpointDraftBackend } from './editor-backend-config';
const id = '00000000-0000-4000-8000-000000000001',
  auth = '00000000-0000-4000-8000-000000000002',
  attempt = '00000000-0000-4000-8000-000000000003';
const actor = { id, authUserId: auth },
  task = { attemptId: attempt, taskKey: 'question-a' };
const context = {
  scope: {
    learnerId: id,
    cohortId: id,
    attemptId: attempt,
    taskKey: 'question-a',
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
function setup(value: unknown = context) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([{ contract: true, caller_isolation: true }])
    .mockResolvedValueOnce([{ data: value }]);
  const database = vi.fn(() => ({ execute }) as unknown as OperationalDatabase);
  return { execute, database };
}
describe('Lazy authoritative official checkpoint context', () => {
  it('opens no database at factory construction and projects verified context only', async () => {
    const f = setup(),
      authority = createPostgresCheckpointOfficialSubmitAuthority(f.database);
    expect(f.database).not.toHaveBeenCalled();
    expect(await authority.context(actor, task)).toEqual(context);
    expect(f.database).toHaveBeenCalledTimes(1);
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it('rejects another learner even if an adapter returns internally well-formed scope', async () => {
    const f = setup({ ...context, scope: { ...context.scope, learnerId: auth } });
    await expect(
      createPostgresCheckpointOfficialSubmitAuthority(f.database).context(actor, task),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('keeps missing schema readiness unavailable, with no fallback query', async () => {
    const f = setup();
    f.execute.mockReset().mockResolvedValue([{ contract: false, caller_isolation: true }]);
    await expect(
      createPostgresCheckpointOfficialSubmitAuthority(f.database).context(actor, task),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('maps current access loss and hides internal connection errors', async () => {
    const f = setup();
    f.execute
      .mockReset()
      .mockResolvedValueOnce([{ contract: true, caller_isolation: true }])
      .mockRejectedValueOnce({ code: '42501', message: 'private' });
    await expect(
      createPostgresCheckpointOfficialSubmitAuthority(f.database).context(actor, task),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const authority = createPostgresCheckpointOfficialSubmitAuthority(() => {
      throw new Error('secret connection detail');
    });
    await expect(authority.context(actor, task)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
describe('Explicit draft storage opt-in is not a readiness bypass', () => {
  it.each([undefined, null, '', 'true', 'postgres', 'postgres-v1 ', 'POSTGRES-V1', true])(
    'keeps unknown setting %s disabled without connection',
    (setting) => {
      const database = vi.fn();
      expect(configureCheckpointDraftBackend(setting, database)).toBeNull();
      expect(database).not.toHaveBeenCalled();
    },
  );
  it('constructs lazily and rechecks SQL readiness separately for each method', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue([
        { contract: false, isolated_tables: false, web_caller: false, guards: false },
      ]);
    const database = vi.fn(() => ({ execute }) as unknown as OperationalDatabase);
    const backend = configureCheckpointDraftBackend('postgres-v1', database)!;
    expect(database).not.toHaveBeenCalled();
    await expect(backend.context(actor, task)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(backend.read(actor, context.scope)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(database).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
