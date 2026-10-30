import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { OperationalDatabase } from '../operations/curriculum';
import {
  CHECKPOINT_ANSWER_DRAFT_READINESS_SQL,
  CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL,
  checkpointAnswerContractDigest,
  encodeCheckpointAnswerDraft,
  readCheckpointAnswerDraftContext,
  readCheckpointAnswerDraftReadiness,
  readCheckpointAnswerDraft,
  saveCheckpointAnswerDraft,
  type AnswerDraftContext,
} from '../queries/checkpoint-answer-drafts';

const id = '10000000-0000-4000-8000-000000000001';
const request = '20000000-0000-4000-8000-000000000002';
const scope = {
  learnerId: id,
  cohortId: id,
  attemptId: id,
  taskKey: 'trace-one',
  definitionDigest: 'a'.repeat(64),
};
const baseContract = { version: 1 as const, kind: 'trace_with_reason' as const, maxBytes: 4096 };
const contract = { ...baseContract, digest: checkpointAnswerContractDigest(scope, baseContract) };
const context: AnswerDraftContext = {
  scope,
  readAllowed: true,
  status: 'active',
  serverNow: '2026-10-30T10:00:00Z',
  deadline: '2026-10-30T11:00:00Z',
  answerContract: contract,
};
const payload = JSON.stringify({
  version: 1,
  kind: 'trace_with_reason',
  output: '\uFEFF  ب\r\n\u0000',
  reason: ' reason\r\n',
});
const encoded = encodeCheckpointAnswerDraft(payload);
const input = {
  authId: id,
  scope,
  answerContractDigest: contract.digest,
  requestId: request,
  baseVersion: 0,
  payload,
  sha256: encoded.sha256,
  byteLength: encoded.byteLength,
};
const ready = {
  contract: true,
  isolated_tables: true,
  web_caller: true,
  guards: true,
  canonical_validator: true,
};
function wire(value = payload, version = 1) {
  const bytes = Buffer.from(value);
  return {
    scope,
    answerContractDigest: contract.digest,
    payloadBase64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    version,
    requestId: request,
    expiresAt: '2026-10-30T12:00:00Z',
  };
}
function setup(data: unknown, ctx: unknown = context) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([ready])
    .mockResolvedValueOnce([{ data: ctx }])
    .mockResolvedValueOnce([ready])
    .mockResolvedValueOnce([{ data }]);
  return { execute, db: { execute } as unknown as OperationalDatabase };
}
describe('Structured draft readiness and frozen contract authority', () => {
  it.each([false, undefined, null, 'true', 1])(
    'rejects an absent or unproven canonical validator attestation %s before any draft RPC',
    async (canonical_validator) => {
      const execute = vi.fn().mockResolvedValue([{ ...ready, canonical_validator }]);
      await expect(
        readCheckpointAnswerDraftContext(
          { execute } as unknown as OperationalDatabase,
          id,
          id,
          'trace-one',
        ),
      ).rejects.toMatchObject({ code: 'unavailable' });
      expect(execute).toHaveBeenCalledOnce();
    },
  );
  it('rejects the old same-signature jsonb helper and a catalog row missing its body pin', async () => {
    for (const row of [
      { ...ready, canonical_validator: false },
      { contract: true, isolated_tables: true, web_caller: true, guards: true },
    ]) {
      const execute = vi.fn().mockResolvedValue([row]);
      expect(
        await readCheckpointAnswerDraftReadiness({ execute } as unknown as OperationalDatabase),
      ).toEqual({ ready: false, livePersistenceVerified: false });
      expect(execute).toHaveBeenCalledOnce();
    }
    expect(CHECKPOINT_ANSWER_DRAFT_READINESS_SQL).toContain(
      CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL + ' AS canonical_validator',
    );
  });

  it.each(['contract', 'isolated_tables', 'web_caller', 'guards', 'canonical_validator'])(
    'fails closed without %s and never uses legacy source RPCs',
    async (key) => {
      const execute = vi.fn().mockResolvedValue([{ ...ready, [key]: false }]);
      await expect(
        readCheckpointAnswerDraftContext(
          { execute } as unknown as OperationalDatabase,
          id,
          id,
          'trace-one',
        ),
      ).rejects.toMatchObject({ code: 'unavailable' });
      expect(execute).toHaveBeenCalledOnce();
    },
  );
  it('does not turn a truthy string or catalog error into live persistence evidence', async () => {
    const execute = vi.fn().mockResolvedValue([{ ...ready, contract: 'true' }]);
    expect(
      await readCheckpointAnswerDraftReadiness({ execute } as unknown as OperationalDatabase),
    ).toEqual({ ready: false, livePersistenceVerified: false });
    execute.mockRejectedValue(new Error('private details'));
    expect(
      await readCheckpointAnswerDraftReadiness({ execute } as unknown as OperationalDatabase),
    ).toEqual({ ready: false, livePersistenceVerified: false });
    expect(CHECKPOINT_ANSWER_DRAFT_READINESS_SQL).not.toMatch(
      /INSERT INTO|CREATE |ALTER |GRANT |REVOKE /,
    );
    expect(CHECKPOINT_ANSWER_DRAFT_READINESS_SQL).toContain(
      "NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','SET')",
    );
  });
  it('matches the specified newline hash domain, canonical UUIDs and no trailing newline', () => {
    const expected = createHash('sha256')
      .update(
        [
          '01coding-checkpoint-answer-contract-v1',
          id,
          id,
          id,
          'trace-one',
          'a'.repeat(64),
          '1',
          'trace_with_reason',
          '4096',
        ].join('\n'),
      )
      .digest('hex');
    expect(contract.digest).toBe(expected);
    expect(
      checkpointAnswerContractDigest({ ...scope, learnerId: id.toUpperCase() }, baseContract),
    ).toBe(expected);
    for (const change of [
      { ...baseContract, kind: 'debug_with_reason' as const },
      { ...baseContract, maxBytes: 4095 },
    ])
      expect(checkpointAnswerContractDigest(scope, change)).not.toBe(expected);
    expect(
      checkpointAnswerContractDigest({ ...scope, taskKey: 'trace-two' }, baseContract),
    ).not.toBe(expected);
    expect(
      checkpointAnswerContractDigest({ ...scope, definitionDigest: 'b'.repeat(64) }, baseContract),
    ).not.toBe(expected);
  });
  it('rejects an old .go context instead of inferring a structured contract', async () => {
    const f = setup(null, {
      scope,
      readAllowed: true,
      status: 'active',
      serverNow: context.serverNow,
      deadline: context.deadline,
      filename: 'answer.go',
      sourceBytes: 4096,
    });
    await expect(readCheckpointAnswerDraftContext(f.db, id, id, 'trace-one')).rejects.toMatchObject(
      { code: 'unavailable' },
    );
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ...contract, kind: ['trace_with_reason'] },
    { ...contract, version: 2 },
    { ...contract, maxBytes: 0 },
    { ...contract, maxBytes: 262145 },
    { ...contract, maxBytes: '4096' },
    { ...contract, kind: 'debug_with_reason' },
    { ...contract, maxBytes: 4095 },
    { ...contract, digest: 'b'.repeat(64) },
    { ...contract, extra: true },
  ])('rejects unproven or substituted contract %#', async (answerContract) => {
    const f = setup(null, { ...context, answerContract });
    await expect(readCheckpointAnswerDraft(f.db, id, scope, contract.digest)).rejects.toMatchObject(
      { code: 'unavailable' },
    );
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it.each(['learnerId', 'cohortId', 'definitionDigest'])(
    'does not accept a changed server scope %s',
    async (key) => {
      const changed = { ...scope, [key]: key === 'definitionDigest' ? 'b'.repeat(64) : request };
      const f = setup(null, {
        ...context,
        scope: changed,
        answerContract: {
          ...contract,
          digest: checkpointAnswerContractDigest(changed, baseContract),
        },
      });
      await expect(
        readCheckpointAnswerDraft(f.db, id, scope, contract.digest),
      ).rejects.toMatchObject({ code: 'definition_mismatch' });
      expect(f.execute).toHaveBeenCalledTimes(2);
    },
  );
  it('rejects withdrawn read access before a data RPC', async () => {
    const f = setup(null, { ...context, readAllowed: false });
    await expect(readCheckpointAnswerDraft(f.db, id, scope, contract.digest)).rejects.toMatchObject(
      { code: 'forbidden' },
    );
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
});
describe('Canonical exact-byte drafts, CAS and immutable request reconciliation', () => {
  it('preserves canonical payload bytes including field BOM, NUL escape, Unicode and CRLF', async () => {
    const f = setup({ kind: 'saved', record: wire() });
    const saved = await saveCheckpointAnswerDraft(f.db, input);
    expect(saved).toMatchObject({
      kind: 'saved',
      record: {
        payload,
        sha256: encoded.sha256,
        byteLength: encoded.byteLength,
        version: 1,
        requestId: request,
      },
    });
    const query = new PgDialect().sqlToQuery(f.execute.mock.calls[3]![0]);
    expect(query.sql).toContain('app.save_checkpoint_answer_draft');
    expect(query.sql).not.toContain(payload);
    expect(query.params).toContain(encoded.base64);
    expect(query.params).toContain(contract.digest);
    expect(query.params).toContain(scope.definitionDigest);
    expect(query.params).toContain(0);
    expect(query.sql).not.toMatch(/submissions|judge\.|visible_run/);
  });
  it('stores incomplete drafts without manufacturing completion, grades or a source file', async () => {
    const partial = JSON.stringify({
      version: 1,
      kind: 'trace_with_reason',
      output: '',
      reason: '',
    });
    const e = encodeCheckpointAnswerDraft(partial),
      f = setup({ kind: 'saved', record: wire(partial) });
    const result = await saveCheckpointAnswerDraft(f.db, {
      ...input,
      payload: partial,
      sha256: e.sha256,
      byteLength: e.byteLength,
    });
    expect(result).not.toHaveProperty('grade');
    expect(result).not.toHaveProperty('submissionId');
    expect(result).not.toHaveProperty('filename');
  });
  it('returns CAS conflict as data and never retries a different write', async () => {
    const other = JSON.stringify({
      version: 1,
      kind: 'trace_with_reason',
      output: 'different',
      reason: 'explanation',
    });
    const f = setup({ kind: 'conflict', current: wire(other, 2) });
    expect(await saveCheckpointAnswerDraft(f.db, input)).toMatchObject({
      kind: 'conflict',
      current: { payload: other, version: 2 },
    });
    expect(f.execute).toHaveBeenCalledTimes(4);
  });
  it('reconciles an original immutable receipt even while the current attempt is closed', async () => {
    const f = setup(wire(), { ...context, status: 'closed', serverNow: '2026-10-30T11:30:00Z' });
    expect(
      await readCheckpointAnswerDraft(f.db, id, scope, contract.digest, request),
    ).toMatchObject({ payload, version: 1, requestId: request });
    const query = new PgDialect().sqlToQuery(f.execute.mock.calls[3]![0]);
    expect(query.params).toContain(request);
  });
  it('does not fabricate a saved empty answer when no revision exists', async () => {
    expect(await readCheckpointAnswerDraft(setup(null).db, id, scope, contract.digest)).toBeNull();
  });
  it.each([-1, 1.5, NaN, Number.MAX_SAFE_INTEGER])(
    'rejects unsafe base version %s before any query',
    async (baseVersion) => {
      const f = setup(null);
      await expect(
        saveCheckpointAnswerDraft(f.db, { ...input, baseVersion }),
      ).rejects.toMatchObject({ code: 'unavailable' });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it.each([
    '{',
    JSON.stringify({ version: 1, kind: ['trace_with_reason'], output: '', reason: '' }),
    JSON.stringify({ version: 1, kind: 'trace_with_reason', output: '', reason: 1 }),
    JSON.stringify({ version: 1, kind: 'trace_with_reason', output: '', reason: '', extra: true }),
    '{"kind":"trace_with_reason","version":1,"output":"","reason":""}',
    JSON.stringify({ version: 1, kind: 'trace_with_reason', output: '', reason: '\ud800' }),
    'x'.repeat(262145),
  ])('rejects invalid or noncanonical payload %# before a query', async (value) => {
    const f = setup(null);
    await expect(
      saveCheckpointAnswerDraft(f.db, { ...input, payload: value }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('rejects mismatched transport hash and size without a database call', async () => {
    for (const patch of [{ sha256: 'b'.repeat(64) }, { byteLength: encoded.byteLength + 1 }]) {
      const f = setup(null);
      await expect(saveCheckpointAnswerDraft(f.db, { ...input, ...patch })).rejects.toMatchObject({
        code: 'unavailable',
      });
      expect(f.execute).not.toHaveBeenCalled();
    }
  });
  it('enforces the frozen size before any save RPC', async () => {
    const small = { ...contract, maxBytes: encoded.byteLength - 1 };
    small.digest = checkpointAnswerContractDigest(scope, small);
    const f = setup(null, { ...context, answerContract: small });
    await expect(
      saveCheckpointAnswerDraft(f.db, { ...input, answerContractDigest: small.digest }),
    ).rejects.toMatchObject({ code: 'definition_mismatch' });
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it.each([
    { scope: { ...scope, learnerId: request } },
    { answerContractDigest: 'b'.repeat(64) },
    { sha256: 'b'.repeat(64) },
    { payloadBase64: 'invalid base64!' },
    { byteLength: 999 },
    { version: 0 },
    { version: '1' },
    { requestId: 'bad' },
    { expiresAt: 'bad' },
    { expiresAt: '2026-10-30T09:00:00Z' },
  ])('rejects a foreign or corrupted stored record %#', async (patch) => {
    await expect(
      readCheckpointAnswerDraft(setup({ ...wire(), ...patch }).db, id, scope, contract.digest),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('rejects malformed UTF-8 even when storage digest and byte length match', async () => {
    const bytes = Buffer.from([0xc3, 0x28]),
      f = setup({
        ...wire(),
        payloadBase64: bytes.toString('base64'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.byteLength,
      });
    await expect(readCheckpointAnswerDraft(f.db, id, scope, contract.digest)).rejects.toMatchObject(
      { code: 'unavailable' },
    );
  });
  it('strips private record fields and accepts PostgreSQL base64 line wrapping', async () => {
    const record = wire();
    record.payloadBase64 = record.payloadBase64.match(/.{1,76}/g)!.join('\n');
    const result = await readCheckpointAnswerDraft(
      setup({ ...record, privateRubric: 'secret' }).db,
      id,
      scope,
      contract.digest,
    );
    expect(result?.payload).toBe(payload);
    expect(result).not.toHaveProperty('privateRubric');
  });
  it('does not acknowledge another source, request or version', async () => {
    const changed = JSON.stringify({
      version: 1,
      kind: 'trace_with_reason',
      output: 'later',
      reason: 'reason',
    });
    for (const record of [wire(changed), wire(payload, 2), { ...wire(), requestId: id }]) {
      await expect(
        saveCheckpointAnswerDraft(setup({ kind: 'saved', record }).db, input),
      ).rejects.toMatchObject({ code: 'unavailable' });
    }
  });
});
describe('Structured storage error isolation', () => {
  it.each([
    ['42501', 'forbidden'],
    ['PA001', 'closed'],
    ['PA002', 'definition_mismatch'],
    ['PA003', 'idempotency_conflict'],
    ['23505', 'idempotency_conflict'],
    ['PA004', 'storage_limit'],
    ['PA005', 'unavailable'],
    ['42883', 'unavailable'],
  ])('maps %s to %s without treating storage as graded quota', async (code, expected) => {
    const f = setup(null);
    f.execute
      .mockReset()
      .mockResolvedValueOnce([ready])
      .mockResolvedValueOnce([{ data: context }])
      .mockResolvedValueOnce([ready])
      .mockRejectedValueOnce({ cause: { code, message: 'private SQL/password' } });
    await expect(saveCheckpointAnswerDraft(f.db, input)).rejects.toMatchObject({ code: expected });
  });
});

/** All execute calls above/below are mocks. NUL assertions prove JS encoding/query projection only;
 * the DRAFT0021 source grammar has pure coverage, but native PostgreSQL parity/persistence is unproven. */
describe('Both explicit answer kinds and the hard UTF-8 wire bound', () => {
  it('round-trips a debug draft without using a source-only context or losing its explanation', async () => {
    const value = JSON.stringify({
      version: 1,
      kind: 'debug_with_reason',
      source: '\uFEFFpackage piscine\r\n\u0000',
      explanation: '\uFEFF explanation\r\n\u0000',
      counterexample: '\uFEFF counterexample and expected result \r\n\u0000',
    });
    const prepared = encodeCheckpointAnswerDraft(value);
    const debugContract = { ...contract, kind: 'debug_with_reason' as const };
    debugContract.digest = checkpointAnswerContractDigest(scope, debugContract);
    const f = setup(
      { kind: 'saved', record: { ...wire(value), answerContractDigest: debugContract.digest } },
      { ...context, answerContract: debugContract },
    );
    expect(
      await saveCheckpointAnswerDraft(f.db, {
        ...input,
        answerContractDigest: debugContract.digest,
        payload: value,
        sha256: prepared.sha256,
        byteLength: prepared.byteLength,
      }),
    ).toMatchObject({
      kind: 'saved',
      record: { payload: value, answerContractDigest: debugContract.digest },
    });
  });
  it('accepts the exact canonical 262144-byte boundary and rejects the next byte', () => {
    const empty = JSON.stringify({ version: 1, kind: 'trace_with_reason', output: '', reason: '' });
    const value = JSON.stringify({
      version: 1,
      kind: 'trace_with_reason',
      output: 'x'.repeat(262144 - Buffer.byteLength(empty)),
      reason: '',
    });
    expect(encodeCheckpointAnswerDraft(value).byteLength).toBe(262144);
    expect(() =>
      encodeCheckpointAnswerDraft(value.replace('"reason":""', '"reason":"x"')),
    ).toThrow();
  });
});
