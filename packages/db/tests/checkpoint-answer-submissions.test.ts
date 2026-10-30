import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { OperationalDatabase } from '../operations/curriculum';
import {
  CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL,
  checkpointAnswerContractDigest,
  encodeCheckpointAnswerDraft,
} from '../queries/checkpoint-answer-drafts';
import {
  acceptCheckpointAnswer,
  readCheckpointAnswerSubmissionContext,
  readCheckpointAnswerSubmissionReadiness,
  CHECKPOINT_ANSWER_SUBMISSION_READINESS_SQL,
  type StructuredAnswerSubmissionWrite,
} from '../queries/checkpoint-answer-submissions';
import { captureMixedAnswer } from '../../../apps/web/lib/checkpoints/checkpoint-answer';

const learner = '10000000-0000-4000-8000-000000000001';
const provider = '20000000-0000-4000-8000-000000000002';
const request = '30000000-0000-4000-8000-000000000003';
const receipt = '40000000-0000-4000-8000-000000000004';
const actor = { id: learner, authUserId: provider };
const scope = {
  learnerId: learner,
  cohortId: request,
  attemptId: receipt,
  taskKey: 'trace-one',
  definitionDigest: 'a'.repeat(64),
};
const baseContract = { version: 1 as const, kind: 'trace_with_reason' as const, maxBytes: 4096 };
const contract = { ...baseContract, digest: checkpointAnswerContractDigest(scope, baseContract) };
const evaluator = {
  family: 'checkpoint_structured_answer' as const,
  version: 1 as const,
  kind: baseContract.kind,
  taskKey: scope.taskKey,
  definitionDigest: scope.definitionDigest,
  evaluatorKey: 'reviewed-trace',
  evaluatorDigest: 'b'.repeat(64),
};
const answer = {
  version: 1 as const,
  kind: baseContract.kind,
  output: '\uFEFF  ب\r\n\u0000',
  reason: ' explanation\r\n',
};
const encoded = encodeCheckpointAnswerDraft(JSON.stringify(answer));
const input: StructuredAnswerSubmissionWrite = {
  schema: 1,
  actor,
  scope,
  requestId: request,
  answerContractDigest: contract.digest,
  answer,
  payload: encoded.payload,
  sha256: encoded.sha256,
  byteLength: encoded.byteLength,
  evaluator,
  allowNew: true,
};
const context = {
  actor,
  scope,
  readAllowed: true,
  status: 'active',
  serverNow: '2026-10-30T10:00:00Z',
  deadline: '2026-10-30T11:00:00Z',
  answerContract: contract,
  submitAllowed: true,
};
const ready = {
  contract: true,
  isolated_tables: true,
  web_caller: true,
  guards: true,
  canonical_validator: true,
};
function accepted(write = input, replayed = false) {
  return {
    kind: 'accepted',
    replayed,
    receipt: {
      id: receipt,
      actor: write.actor,
      scope: write.scope,
      requestId: write.requestId,
      answerContractDigest: write.answerContractDigest,
      answerVersion: 1,
      answerKind: write.answer.kind,
      sha256: write.sha256,
      byteLength: write.byteLength,
      evaluator: write.evaluator,
      evaluation: 'pending',
      payloadBase64: Buffer.from(write.payload).toString('base64'),
    },
  };
}
function setup(value: unknown) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([ready])
    .mockResolvedValueOnce([{ data: value }]);
  return { execute, db: { execute } as unknown as OperationalDatabase };
}
describe('Typed official provider binding and read-only catalog gate', () => {
  it.each(Object.keys(ready))(
    'fails closed without exact %s readiness and never attempts intake',
    async (name) => {
      const f = setup(null);
      f.execute.mockReset().mockResolvedValue([{ ...ready, [name]: false }]);
      expect(await acceptCheckpointAnswer(f.db, input)).toEqual({ kind: 'unavailable' });
      expect(f.execute).toHaveBeenCalledOnce();
    },
  );
  it.each([undefined, false, 'true'])(
    'rejects a prior signature-only helper attestation %s',
    async (canonical_validator) => {
      const execute = vi
        .fn()
        .mockResolvedValue([{ ...ready, shared_validator: true, canonical_validator }]);
      const db = { execute } as unknown as OperationalDatabase;
      expect(await acceptCheckpointAnswer(db, input)).toEqual({ kind: 'unavailable' });
      await expect(
        readCheckpointAnswerSubmissionContext(db, actor, {
          attemptId: scope.attemptId,
          taskKey: scope.taskKey,
        }),
      ).rejects.toMatchObject({ code: 'unavailable' });
      expect(execute).toHaveBeenCalledTimes(2);
    },
  );
  it('does not claim native persistence or result reconciliation from a catalog/fake pass', async () => {
    const f = setup(null);
    expect(await readCheckpointAnswerSubmissionReadiness(f.db)).toEqual({
      ready: true,
      livePersistenceVerified: false,
      resultReconciliationVerified: false,
    });
    expect(CHECKPOINT_ANSWER_SUBMISSION_READINESS_SQL).not.toMatch(
      /CREATE |INSERT INTO|ALTER |GRANT |REVOKE /,
    );
    expect(CHECKPOINT_ANSWER_SUBMISSION_READINESS_SQL).toContain('checkpoint_answer_payload_valid');
    expect(CHECKPOINT_ANSWER_SUBMISSION_READINESS_SQL).toContain(
      CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL + ' AS canonical_validator',
    );
    expect(CHECKPOINT_ANSWER_SUBMISSION_READINESS_SQL).toContain(
      "'nextera_checkpoint_owner','SET'",
    );
  });
  it('requires distinct provider and application identities in both request and returned authority', async () => {
    const f = setup(context);
    const result = await readCheckpointAnswerSubmissionContext(f.db, actor, {
      attemptId: scope.attemptId,
      taskKey: scope.taskKey,
    });
    expect(result).toMatchObject({ scope, answerContract: contract, submitAllowed: true });
    const query = new PgDialect().sqlToQuery(f.execute.mock.calls[1]![0]);
    expect(query.params).toEqual([provider, learner, scope.attemptId, scope.taskKey]);
    expect(query.sql).toContain('checkpoint_answer_submission_context');
    for (const replacement of [
      { id: provider, authUserId: provider },
      { id: learner, authUserId: learner },
    ]) {
      const other = setup({ ...context, actor: replacement });
      await expect(
        readCheckpointAnswerSubmissionContext(other.db, actor, {
          attemptId: scope.attemptId,
          taskKey: scope.taskKey,
        }),
      ).rejects.toMatchObject({ code: 'unavailable' });
    }
  });
  it.each([
    { ...context, answerContract: { ...contract, digest: 'c'.repeat(64) } },
    { ...context, submitAllowed: 'true' },
    { ...context, scope: { ...scope, learnerId: provider } },
    { ...context, readAllowed: false },
    { ...context, sourceFile: 'answer.go' },
  ])('rejects unbound or malformed context %#', async (value) => {
    const f = setup(value);
    await expect(
      readCheckpointAnswerSubmissionContext(f.db, actor, {
        attemptId: scope.attemptId,
        taskKey: scope.taskKey,
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});
describe('Immutable typed intake and exact original receipt reconciliation', () => {
  it('uses one parameterized mutating RPC and proves exact canonical bytes including NUL/BOM/CRLF', async () => {
    const f = setup(accepted());
    expect(await acceptCheckpointAnswer(f.db, input)).toMatchObject({
      kind: 'accepted',
      replayed: false,
      receipt: { actor, scope, sha256: encoded.sha256, evaluation: 'pending' },
    });
    expect(f.execute).toHaveBeenCalledTimes(2);
    const query = new PgDialect().sqlToQuery(f.execute.mock.calls[1]![0]);
    expect(query.sql).toContain('app.accept_checkpoint_answer');
    expect(query.sql).not.toContain(encoded.payload);
    expect(query.params).toEqual([
      provider,
      learner,
      scope.cohortId,
      scope.attemptId,
      scope.taskKey,
      scope.definitionDigest,
      contract.digest,
      request,
      encoded.base64,
      encoded.sha256,
      evaluator.evaluatorKey,
      evaluator.evaluatorDigest,
      true,
    ]);
    expect(query.sql).not.toMatch(
      /judge\.|accept_checkpoint_submission|save_checkpoint|visible_run/,
    );
  });
  it('allows replay with no new allowance permission and rejects a falsely new acknowledgement', async () => {
    const write = { ...input, allowNew: false };
    expect(await acceptCheckpointAnswer(setup(accepted(write, true)).db, write)).toMatchObject({
      kind: 'accepted',
      replayed: true,
    });
    await expect(acceptCheckpointAnswer(setup(accepted(write)).db, write)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it.each([
    'closed',
    'forbidden',
    'definition_mismatch',
    'contract_mismatch',
    'conflict',
    'budget_exhausted',
    'unavailable',
  ])('passes only explicit no-intake denial %s', async (kind) => {
    expect(await acceptCheckpointAnswer(setup({ kind }).db, input)).toEqual({ kind });
  });
  it('captures the exact intent before the first asynchronous query', async () => {
    const copy = structuredClone(input);
    const f = setup(accepted());
    f.execute
      .mockReset()
      .mockImplementationOnce(async () => {
        (copy.actor as { id: string }).id = provider;
        (copy.scope as { taskKey: string }).taskKey = 'substituted';
        (copy.evaluator as { evaluatorKey: string }).evaluatorKey = 'substituted';
        return [ready];
      })
      .mockResolvedValueOnce([{ data: accepted() }]);
    expect(await acceptCheckpointAnswer(f.db, copy)).toMatchObject({ kind: 'accepted' });
    const query = new PgDialect().sqlToQuery(f.execute.mock.calls[1]![0]);
    expect(query.params).toContain(learner);
    expect(query.params).toContain('trace-one');
    expect(query.params).not.toContain('substituted');
  });
  it.each([
    (r: ReturnType<typeof accepted>) => ({
      ...r,
      receipt: { ...r.receipt, sha256: 'c'.repeat(64) },
    }),
    (r: ReturnType<typeof accepted>) => ({
      ...r,
      receipt: { ...r.receipt, payloadBase64: Buffer.from('different').toString('base64') },
    }),
    (r: ReturnType<typeof accepted>) => ({
      ...r,
      receipt: { ...r.receipt, actor: { ...actor, authUserId: learner } },
    }),
    (r: ReturnType<typeof accepted>) => ({
      ...r,
      receipt: { ...r.receipt, evaluator: { ...evaluator, evaluatorDigest: 'c'.repeat(64) } },
    }),
    (r: ReturnType<typeof accepted>) => ({ ...r, receipt: { ...r.receipt, evaluation: 'passed' } }),
    () => ({ kind: 'closed', committed: true }),
    () => ({ kind: 'unrecognized' }),
  ])(
    'throws on uncertain malformed acknowledgement %# instead of inventing failure or retry',
    async (change) => {
      const f = setup(change(accepted()));
      await expect(acceptCheckpointAnswer(f.db, input)).rejects.toBeDefined();
      expect(f.execute).toHaveBeenCalledTimes(2);
    },
  );
  it('propagates a lost post-intake connection without converting it to a denial', async () => {
    const f = setup(null),
      error = Object.assign(new Error('connection lost'), { code: '42501' });
    f.execute.mockReset().mockResolvedValueOnce([ready]).mockRejectedValueOnce(error);
    await expect(acceptCheckpointAnswer(f.db, input)).rejects.toBe(error);
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
});
describe('Official completeness agrees with captureMixedAnswer without trimming stored text', () => {
  const whitespace =
    '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  it.each(['', whitespace])(
    'rejects blank trace reason %# before any database query',
    async (reason) => {
      const changed = { ...answer, output: '', reason },
        e = encodeCheckpointAnswerDraft(JSON.stringify(changed)),
        f = setup(null);
      expect(() => captureMixedAnswer(scope, changed, 4096)).toThrow();
      expect(
        await acceptCheckpointAnswer(f.db, {
          ...input,
          answer: changed,
          payload: e.payload,
          sha256: e.sha256,
          byteLength: e.byteLength,
        }),
      ).toEqual({ kind: 'invalid_input' });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it.each(['\u0000', '\u0085', '\\t', '\\u000b', whitespace + '\u0000' + whitespace])(
    'keeps nonblank reason %# byte-exact and allows an empty trace output',
    async (reason) => {
      const changed = { ...answer, output: '', reason },
        e = encodeCheckpointAnswerDraft(JSON.stringify(changed));
      const write = {
        ...input,
        answer: changed,
        payload: e.payload,
        sha256: e.sha256,
        byteLength: e.byteLength,
      };
      expect(captureMixedAnswer(scope, changed, 4096).payload).toBe(e.payload);
      expect(await acceptCheckpointAnswer(setup(accepted(write)).db, write)).toMatchObject({
        kind: 'accepted',
      });
      expect(e.sha256).toBe(createHash('sha256').update(e.payload).digest('hex'));
    },
  );
  it.each(['source', 'explanation', 'counterexample'])(
    'requires every debug field %s, with the same whitespace semantics',
    async (field) => {
      const debug = {
        version: 1 as const,
        kind: 'debug_with_reason' as const,
        source: '\u0000',
        explanation: '\u0000',
        counterexample: '\u0000',
        [field]: whitespace,
      };
      const e = encodeCheckpointAnswerDraft(JSON.stringify(debug)),
        f = setup(null);
      expect(() => captureMixedAnswer(scope, debug, 4096)).toThrow();
      expect(
        await acceptCheckpointAnswer(f.db, {
          ...input,
          answer: debug,
          evaluator: { ...evaluator, kind: debug.kind },
          payload: e.payload,
          sha256: e.sha256,
          byteLength: e.byteLength,
        }),
      ).toEqual({ kind: 'invalid_input' });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
});
