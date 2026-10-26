import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import { createPostgresCheckpointDraftBackend } from './postgres-drafts';
import { checkpointDraftBackend, checkpointRunBackend } from './editor-backends';
import { createHash } from 'node:crypto';
const id = '10000000-0000-4000-8000-000000000001',
  request = '20000000-0000-4000-8000-000000000002';
const actor = { id, authUserId: id },
  scope = {
    learnerId: id,
    cohortId: id,
    attemptId: id,
    taskKey: 'question-a',
    definitionDigest: 'a'.repeat(64),
  };
const ready = { contract: true, isolated_tables: true, web_caller: true, guards: true };
const source = 'exact\r\n',
  sha256 = createHash('sha256').update(Buffer.from(source)).digest('hex');
const input = {
  actor,
  scope,
  requestId: request,
  source,
  sha256,
  byteLength: Buffer.byteLength(source),
  baseVersion: 0,
};
describe('Prepared PostgreSQL draft adapter remains disabled in production', () => {
  it('does not instantiate a live adapter as a side effect', () => {
    expect(checkpointDraftBackend).toBeNull();
    expect(checkpointRunBackend).toBeNull();
  });
  it('rejects another domain learner before a query', async () => {
    const execute = vi.fn(),
      backend = createPostgresCheckpointDraftBackend({ execute } as unknown as OperationalDatabase);
    await expect(backend.read(actor, { ...scope, learnerId: request })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects a mismatched transport hash/size before a query', async () => {
    const execute = vi.fn(),
      backend = createPostgresCheckpointDraftBackend({ execute } as unknown as OperationalDatabase);
    await expect(backend.save({ ...input, sha256: 'b'.repeat(64) })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    ['42501', 'FORBIDDEN'],
    ['PD001', 'CLOSED'],
    ['PD002', 'DEFINITION_MISMATCH'],
    ['PD003', 'IDEMPOTENCY_CONFLICT'],
    ['PD004', 'UNAVAILABLE'],
  ])('maps %s to %s without leaking database details', async (code, expected) => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([ready])
      .mockRejectedValueOnce({ code, message: 'secret SQL/password' });
    const backend = createPostgresCheckpointDraftBackend({
      execute,
    } as unknown as OperationalDatabase);
    await expect(backend.save(input)).rejects.toMatchObject({ code: expected });
  });
});
