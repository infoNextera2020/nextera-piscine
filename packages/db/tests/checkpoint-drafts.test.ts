import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { OperationalDatabase } from '../operations/curriculum';
import {
  CHECKPOINT_DRAFT_READINESS_SQL,
  CheckpointDraftStorageError,
  encodeCheckpointDraft,
  readCheckpointDraftContext,
  readCheckpointDraftReadiness,
  readCheckpointDraft,
  saveCheckpointDraft,
  type DraftScope,
} from '../queries/checkpoint-drafts';

const id = '10000000-0000-4000-8000-000000000001',
  request = '20000000-0000-4000-8000-000000000002';
const scope: DraftScope = {
  learnerId: id,
  cohortId: id,
  attemptId: id,
  taskKey: 'question-a',
  definitionDigest: 'a'.repeat(64),
};
const ready = { contract: true, isolated_tables: true, web_caller: true, guards: true };
function wire(source = 'package main\r\n', version = 1) {
  const bytes = Buffer.from(source);
  return {
    scope,
    sourceBase64: bytes.toString('base64'),
    sourceDigest: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    version,
    requestId: request,
    expiresAt: '2026-10-27T11:00:00Z',
  };
}
function db(data: unknown) {
  const execute = vi.fn().mockResolvedValueOnce([ready]).mockResolvedValueOnce([{ data }]);
  return { execute, database: { execute } as unknown as OperationalDatabase };
}
const input = { authId: id, scope, requestId: request, baseVersion: 0, source: 'package main\r\n' };

describe('Checkpoint draft repository readiness', () => {
  it.each(['contract', 'isolated_tables', 'web_caller', 'guards'])(
    'requires %s before any application RPC',
    async (key) => {
      const execute = vi.fn().mockResolvedValue([{ ...ready, [key]: false }]);
      const database = { execute } as unknown as OperationalDatabase;
      await expect(saveCheckpointDraft(database, input)).rejects.toMatchObject({
        code: 'unavailable',
      });
      expect(execute).toHaveBeenCalledOnce();
    },
  );
  it('does not treat truthy catalog strings or a failed probe as readiness', async () => {
    const execute = vi.fn().mockResolvedValue([{ ...ready, contract: 'true' }]);
    expect(
      (await readCheckpointDraftReadiness({ execute } as unknown as OperationalDatabase)).ready,
    ).toBe(false);
    execute.mockRejectedValue(new Error('private database credentials'));
    expect(
      await readCheckpointDraftReadiness({ execute } as unknown as OperationalDatabase),
    ).toEqual({ ready: false, livePersistenceVerified: false });
  });
  it('uses read-only catalogs, isolated ownership and no direct table write privilege', () => {
    expect(CHECKPOINT_DRAFT_READINESS_SQL).not.toMatch(
      /\b(INSERT INTO|UPDATE app\.|DELETE FROM|CREATE |ALTER |GRANT |REVOKE )/i,
    );
    expect(CHECKPOINT_DRAFT_READINESS_SQL).toContain('pg_catalog.pg_proc');
    expect(CHECKPOINT_DRAFT_READINESS_SQL).toContain('has_table_privilege');
    expect(CHECKPOINT_DRAFT_READINESS_SQL).toContain(
      "NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','SET')",
    );
  });
});

describe('Exact-byte query encoding and scoped projections', () => {
  it('preserves BOM, CRLF, NUL and Unicode without exposing bytes as SQL text', async () => {
    const source = '\uFEFFpackage main\r\n// café\u0000';
    const f = db({ kind: 'saved', record: wire(source) });
    expect(await saveCheckpointDraft(f.database, { ...input, source })).toEqual({
      kind: 'saved',
      record: { source, version: 1, requestId: request },
    });
    const query = new PgDialect().sqlToQuery(f.execute.mock.calls[1]![0]);
    expect(query.sql).toContain('app.save_checkpoint_draft');
    expect(query.sql).not.toContain(source);
    expect(query.params).toContain(Buffer.from(source).toString('base64'));
    expect(query.params).toContain(createHash('sha256').update(Buffer.from(source)).digest('hex'));
    expect(query.params).toContain(scope.definitionDigest);
  });
  it('supports intentionally empty accepted revisions', async () => {
    const f = db({ kind: 'saved', record: wire('') });
    expect(await saveCheckpointDraft(f.database, { ...input, source: '' })).toMatchObject({
      kind: 'saved',
      record: { source: '', version: 1 },
    });
  });
  it('rejects unpaired surrogates/oversized source before a database query', async () => {
    const execute = vi.fn(),
      database = { execute } as unknown as OperationalDatabase;
    for (const source of ['\ud800', 'x'.repeat(262145)])
      await expect(saveCheckpointDraft(database, { ...input, source })).rejects.toMatchObject({
        code: 'unavailable',
      });
    expect(execute).not.toHaveBeenCalled();
    expect(() => encodeCheckpointDraft('\ud800')).toThrow(CheckpointDraftStorageError);
  });
  it.each([-1, 1.5, NaN, Number.MAX_SAFE_INTEGER])(
    'rejects invalid base version %s without a query',
    async (baseVersion) => {
      const execute = vi.fn();
      await expect(
        saveCheckpointDraft({ execute } as unknown as OperationalDatabase, {
          ...input,
          baseVersion,
        }),
      ).rejects.toMatchObject({ code: 'unavailable' });
      expect(execute).not.toHaveBeenCalled();
    },
  );
  it('returns a conflict as data without issuing a second save or rewriting remote source', async () => {
    const f = db({ kind: 'conflict', current: wire('remote', 2) });
    expect(await saveCheckpointDraft(f.database, input)).toEqual({
      kind: 'conflict',
      current: { source: 'remote', version: 2, requestId: request },
    });
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it('reconciles an original receipt independently of the current head version', async () => {
    const f = db(wire('original', 1));
    expect(await readCheckpointDraft(f.database, id, scope, request)).toEqual({
      source: 'original',
      version: 1,
      requestId: request,
    });
    const query = new PgDialect().sqlToQuery(f.execute.mock.calls[1]![0]);
    expect(query.sql).toContain('app.read_checkpoint_draft');
    expect(query.params).toContain(request);
  });
  it('returns no fabricated saved empty record when storage has no revision', async () => {
    const f = db(null);
    expect(await readCheckpointDraft(f.database, id, scope)).toBeNull();
  });
  it.each([
    { scope: { ...scope, learnerId: request } },
    { sourceDigest: 'b'.repeat(64) },
    { sourceBase64: 'not base64!' },
    { byteLength: 999 },
    { version: 0 },
    { version: '1' },
    { expiresAt: 'invalid' },
  ])('rejects a corrupted or foreign record %o', async (patch) => {
    const f = db({ ...wire(), ...patch });
    await expect(readCheckpointDraft(f.database, id, scope)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it('rejects malformed UTF-8 even when the stored byte digest matches', async () => {
    const bytes = Buffer.from([0xc3, 0x28]),
      f = db({
        ...wire(),
        sourceBase64: bytes.toString('base64'),
        sourceDigest: createHash('sha256').update(bytes).digest('hex'),
        byteLength: 2,
      });
    await expect(readCheckpointDraft(f.database, id, scope)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it('does not report a save acknowledgement for another source or version', async () => {
    for (const record of [wire('different'), wire(input.source, 2), { ...wire(), requestId: id }]) {
      const f = db({ kind: 'saved', record });
      await expect(saveCheckpointDraft(f.database, input)).rejects.toMatchObject({
        code: 'unavailable',
      });
    }
  });
  it('accepts PostgreSQL base64 line wrapping and strips unrelated private fields', async () => {
    const source = 'x'.repeat(100),
      record = wire(source);
    record.sourceBase64 = record.sourceBase64.match(/.{1,76}/g)!.join('\n');
    const f = db({ ...record, privatePack: 'secret' });
    expect(await readCheckpointDraft(f.database, id, scope)).toEqual({
      source,
      version: 1,
      requestId: request,
    });
  });
  it('validates context fields, scope and explicit policy limits', async () => {
    const context = {
      scope,
      readAllowed: true,
      status: 'active',
      serverNow: '2026-10-27T10:00:00Z',
      deadline: '2026-10-27T11:00:00Z',
      sourceBytes: 128,
      filename: 'answer.go',
    };
    const f = db(context);
    expect(await readCheckpointDraftContext(f.database, id, id, 'question-a')).toEqual(context);
    for (const patch of [
      { sourceBytes: null },
      { sourceBytes: 262145 },
      { readAllowed: 'true' },
      { deadline: 'bad' },
      { scope: { ...scope, attemptId: request } },
    ]) {
      const f = db({ ...context, ...patch });
      await expect(
        readCheckpointDraftContext(f.database, id, id, 'question-a'),
      ).rejects.toMatchObject({ code: 'unavailable' });
    }
  });
});

describe('Database error mapping is private and fail closed', () => {
  it.each([
    ['42501', 'forbidden'],
    ['PD001', 'closed'],
    ['PD002', 'definition_mismatch'],
    ['PD003', 'idempotency_conflict'],
    ['23505', 'idempotency_conflict'],
    ['PD004', 'storage_limit'],
    ['PD005', 'unavailable'],
    ['42883', 'unavailable'],
  ])('maps SQLSTATE %s to %s', async (code, expected) => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([ready])
      .mockRejectedValueOnce({ cause: { code, message: 'private SQL/source/password' } });
    await expect(
      saveCheckpointDraft({ execute } as unknown as OperationalDatabase, input),
    ).rejects.toMatchObject({ code: expected });
    try {
      const f = db({});
      await saveCheckpointDraft(f.database, input);
    } catch (error) {
      expect(String(error)).not.toContain('password');
    }
  });
});
