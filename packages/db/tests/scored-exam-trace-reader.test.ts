import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { EXAM_TRACE_COMPARATOR_V1 } from '@nextera/domain';
import { contextFixture } from './scored-exam-review-fixture';
import { scoredExamFramedDigest } from '../operations/scored-exam-publication';
import {
  EXAM_TRACE_DETAIL_APPROVAL,
  prepareScoredExamTraceOracle,
  createScoredExamTraceProcessor,
} from '../operations/scored-exam-trace';
import { RECORD_EXAM_SCORING_EVENT_SQL } from '../queries/exam-scoring-review';
import {
  createPostgresScoredExamTraceReader,
  READ_SCORED_EXAM_TRACE_CONTEXT_SQL,
  SCORED_EXAM_TRACE_READER_BODY_SHA256,
  SCORED_EXAM_TRACE_BINDING_VALIDATOR_BODY_SHA256,
  type ScoredExamTraceReaderSettings,
} from '../queries/scored-exam-trace-reader';

const id = (n: number) => '00000000-0000-0000-0000-' + n.toString(16).padStart(12, '0');
const h = (s: string) => s.repeat(64);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** Synthetic immutable acceptance; no real learner, credential or expected answer. */
function fixture() {
  const rubric = contextFixture().rubric;
  const body = {
    version: rubric.version,
    form: rubric.form,
    definitionDigest: rubric.definitionDigest,
    questions: rubric.questions,
  };
  const sourceBinding = {
    draftSha256: h('a'),
    paperSha256: h('b'),
    decisions: {
      weightsOwnerMessageId: EXAM_TRACE_DETAIL_APPROVAL,
      approvedDraftSha256: h('a'),
      traceComparatorOwnerMessageId: EXAM_TRACE_DETAIL_APPROVAL,
      traceComparator: EXAM_TRACE_COMPARATOR_V1,
      manualCriteriaSha256: h('c'),
    },
    rubric: body,
  };
  const payload = JSON.stringify({
    version: 1,
    kind: 'trace_with_reason',
    output: 'synthetic-line\r\n',
    reason: 'synthetic reasoning',
  });
  const raw = {
    version: 1,
    receiptId: id(10),
    attemptId: id(2),
    learnerId: id(3),
    cohortId: id(4),
    curriculumVersionId: id(5),
    nodeKey: 'synthetic-exam',
    form: 'A',
    questionKey: 'q6',
    answerKind: 'trace_with_reason',
    answerContractDigest: h('d'),
    acceptedAtMicros: '1793510000000000',
    answerBase64: Buffer.from(payload).toString('base64'),
    answerSha256: hash(payload),
    answerByteLength: Buffer.byteLength(payload),
    definitionDigest: rubric.definitionDigest,
    snapshotDigest: h('e'),
    evaluatorKey: 'synthetic-trace-v1',
    evaluatorDigest: h('f'),
    publishedCriteriaDigest: rubric.questions[5]!.publishedCriteriaDigest,
    rubricSourceBindingDigest: scoredExamFramedDigest(
      sourceBinding,
      'nextera-exam1-rubric-source-binding',
    ),
    rubric,
    sourceBinding,
    outbox: {
      receiptId: id(10),
      answerSha256: hash(payload),
      snapshotDigest: h('e'),
      evaluatorKey: 'synthetic-trace-v1',
      evaluatorDigest: h('f'),
      evaluation: 'pending',
    },
    expectedRevision: '9007199254740993',
  };
  const unsafe = vi.fn<(sql: string, parameters: unknown[]) => Promise<unknown>>(async () => [
    { data: raw },
  ]);
  const settings: ScoredExamTraceReaderSettings = {
    client: { unsafe } as unknown as NonNullable<ScoredExamTraceReaderSettings['client']>,
    limits: { queryMs: 1000, maxContextBytes: 65536, maxAnswerBytes: 8192 },
  };
  return { raw, payload, unsafe, settings };
}

describe('restricted native trace reader source adapter, no database', () => {
  it('pins both exact unapplied native bodies, not only their shape or a caller hash', () => {
    const draft = readFileSync(
      new URL('../migration-drafts/0038_scored_exam_trace_context.DRAFT.sql', import.meta.url),
      'utf8',
    );
    const body = (name: string) => {
      const at = draft.indexOf('FUNCTION app.' + name + '('),
        start = draft.indexOf('AS $$', at) + 5,
        end = draft.indexOf('$$;', start);
      expect(at).toBeGreaterThanOrEqual(0);
      return draft.slice(start, end);
    };
    expect(hash(body('scored_exam_trace_context'))).toBe(SCORED_EXAM_TRACE_READER_BODY_SHA256);
    expect(hash(body('exam_scoring_source_binding_valid'))).toBe(
      SCORED_EXAM_TRACE_BINDING_VALIDATOR_BODY_SHA256,
    );
  });
  it('composes the actual restricted reader adapter into the receipt processor and existing writer with fake SQL only', async () => {
    const f = fixture(),
      program = Buffer.from('synthetic reference program, not executed'),
      expected = Buffer.from('synthetic-line\n'),
      document = Buffer.from('synthetic private checklist');
    const oracle = prepareScoredExamTraceOracle({
      evaluatorKey: f.raw.evaluatorKey,
      form: 'A',
      questionKey: 'q6',
      paperSha256: f.raw.sourceBinding.paperSha256,
      publishedCriteriaDigest: f.raw.publishedCriteriaDigest,
      programBytes: program,
      expectedOutputBytes: expected,
      checkpointDocumentBytes: document,
      review: {
        programSha256: hash(program.toString()),
        expectedOutputSha256: hash(expected.toString()),
        checkpointDocumentSha256: hash(document.toString()),
        referenceVerificationSha256: h('c'),
        approvalMessageId: EXAM_TRACE_DETAIL_APPROVAL,
      },
    });
    f.raw.evaluatorDigest = oracle.evaluatorDigest;
    f.raw.outbox.evaluatorDigest = oracle.evaluatorDigest;
    const retained = new Map<string, Uint8Array>();
    f.unsafe.mockImplementation(async (sql, params = []) => {
      if (sql === READ_SCORED_EXAM_TRACE_CONTEXT_SQL) return [{ data: f.raw }];
      expect(sql).toBe(RECORD_EXAM_SCORING_EVENT_SQL);
      expect(retained.has(String(params[1]))).toBe(true);
      return [
        {
          data: {
            kind: 'recorded',
            eventId: id(88),
            operationId: params[1],
            submissionId: params[2],
            revision: (BigInt(String(params[3])) + 1n).toString(),
            payloadDigest: params[6],
            replayed: false,
          },
        },
      ];
    });
    const reader = createPostgresScoredExamTraceReader(f.settings)!;
    const processor = createScoredExamTraceProcessor({
      reader,
      criteria: { read: async () => oracle },
      publicationOutbox: {
        store: async (op, bytes) => {
          retained.set(op, new Uint8Array(bytes));
        },
        read: async (op) => retained.get(op) ?? null,
      },
      client: f.settings.client,
      limits: {
        operationMs: 1000,
        maxContextBytes: 65536,
        maxAnswerBytes: 8192,
        maxEnvelopeBytes: 8192,
      },
    });
    const prepared = await processor.prepare(id(10), id(99));
    expect(prepared.payload).toMatchObject({
      state: 'evaluated',
      evidence: { kind: 'trace_output', matched: true, answerSha256: f.raw.answerSha256 },
    });
    expect(await processor.record(prepared)).toMatchObject({
      kind: 'recorded',
      submissionId: id(10),
    });
    expect(f.unsafe.mock.calls.map(([sql]) => sql)).toEqual([
      READ_SCORED_EXAM_TRACE_CONTEXT_SQL,
      READ_SCORED_EXAM_TRACE_CONTEXT_SQL,
      RECORD_EXAM_SCORING_EVENT_SQL,
    ]);
  });

  it('does no I/O or client lookup without explicit settings/limits', () => {
    expect(createPostgresScoredExamTraceReader()).toBeNull();
    let touched = 0;
    const client = Object.defineProperty({}, 'unsafe', {
      get() {
        touched++;
        throw new Error('forbidden');
      },
    });
    expect(
      createPostgresScoredExamTraceReader({
        client,
        limits: null,
      } as unknown as ScoredExamTraceReaderSettings),
    ).toBeNull();
    const f = fixture();
    expect(
      createPostgresScoredExamTraceReader({
        ...f.settings,
        limits: { ...f.settings.limits!, queryMs: 0 },
      }),
    ).toBeNull();
    expect(touched).toBe(0);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('attests role/catalog/source/ACL and calls the fixed RPC in the SAME statement for every pooled read', async () => {
    const f = fixture(),
      reader = createPostgresScoredExamTraceReader(f.settings)!;
    expect(f.unsafe).not.toHaveBeenCalled();
    const result = await reader.read(id(10));
    expect(result).toEqual(f.raw);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sourceBinding)).toBe(true);
    expect(f.unsafe).toHaveBeenCalledExactlyOnceWith(READ_SCORED_EXAM_TRACE_CONTEXT_SQL, [id(10)]);
    f.unsafe.mockResolvedValueOnce([{ data: null }] as never);
    await expect(reader.read(id(10))).rejects.toThrow('SCORED_EXAM_TRACE_READER_UNAVAILABLE');
    expect(f.unsafe).toHaveBeenCalledTimes(2);
    const sql = READ_SCORED_EXAM_TRACE_CONTEXT_SQL;
    expect(sql).toContain('WITH verified AS MATERIALIZED');
    expect(sql).toContain(
      'CASE WHEN ready THEN app.scored_exam_trace_context($1::pg_catalog.uuid) ELSE NULL END',
    );
    for (const guard of [
      'current_user=session_user',
      "current_setting('role')='none'",
      'prosecdef=true',
      'proisstrict=false',
      "provolatile='v'",
      'prosrc',
      'proconfig',
      'acl.is_grantable',
      'nextera_exam_evaluator',
      'nextera_web',
      'nextera_checkpoint_owner',
      SCORED_EXAM_TRACE_READER_BODY_SHA256,
      SCORED_EXAM_TRACE_BINDING_VALIDATOR_BODY_SHA256,
    ])
      expect(sql).toContain(guard);
    expect(sql).not.toMatch(/SET ROLE|GRANT |FROM app\./);
    expect(sql).toContain(
      "'app.scored_exam_trace_context(pg_catalog.uuid)'::pg_catalog.regprocedure",
    );
    expect(sql).toContain(
      "'app.exam_scoring_source_binding_valid(pg_catalog.jsonb,pg_catalog.jsonb)'::pg_catalog.regprocedure",
    );
    expect(SCORED_EXAM_TRACE_READER_BODY_SHA256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('captures returned native data and client method without retaining caller mutation', async () => {
    const f = fixture(),
      reader = createPostgresScoredExamTraceReader(f.settings)!;
    const original = f.raw.learnerId,
      result = await reader.read(id(10));
    f.raw.learnerId = id(99);
    expect(result.learnerId).toBe(original);
    Object.assign(f.settings.client!, {
      unsafe() {
        throw new Error('replaced method');
      },
    });
    expect(await reader.read(id(10))).toMatchObject({ learnerId: id(99) });
  });
  it.each(['', 'not-uuid', id(10).toUpperCase(), id(10) + 'extra'])(
    'rejects noncanonical receipt ID %s before dispatch',
    async (receipt) => {
      const f = fixture();
      await expect(
        createPostgresScoredExamTraceReader(f.settings)!.read(receipt),
      ).rejects.toThrow();
      expect(f.unsafe).not.toHaveBeenCalled();
    },
  );
  it.each([
    'null',
    'wrong-receipt',
    'debug',
    'wrapped-base64',
    'wrong-digest',
    'unbound-criteria',
    'oversize',
  ])('fails closed on native %s', async (fault) => {
    const f = fixture();
    if (fault === 'null') f.unsafe.mockResolvedValueOnce([{ data: null }] as never);
    if (fault === 'wrong-receipt') f.raw.receiptId = id(77);
    if (fault === 'debug') f.raw.questionKey = 'q8';
    if (fault === 'wrapped-base64') f.raw.answerBase64 += '\n';
    if (fault === 'wrong-digest') f.raw.answerSha256 = h('0');
    if (fault === 'unbound-criteria')
      f.raw.sourceBinding.decisions.traceComparator =
        'exact_utf8' as typeof EXAM_TRACE_COMPARATOR_V1;
    const settings =
      fault === 'oversize'
        ? { ...f.settings, limits: { ...f.settings.limits!, maxContextBytes: 64 } }
        : f.settings;
    await expect(createPostgresScoredExamTraceReader(settings)!.read(id(10))).rejects.toThrow(
      'SCORED_EXAM_TRACE_READER_UNAVAILABLE',
    );
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it('does not invoke row or nested metadata accessors', async () => {
    const f = fixture();
    let touched = 0;
    const row = Object.defineProperty({}, 'data', {
      get() {
        touched++;
        throw new Error('private value');
      },
    });
    f.unsafe.mockResolvedValueOnce([row] as never);
    await expect(createPostgresScoredExamTraceReader(f.settings)!.read(id(10))).rejects.toThrow();
    Object.defineProperty(f.raw, 'answerBase64', {
      get() {
        touched++;
        throw new Error('private answer');
      },
    });
    await expect(createPostgresScoredExamTraceReader(f.settings)!.read(id(10))).rejects.toThrow();
    expect(touched).toBe(0);
  });
  it('sanitizes driver errors without retry or global pool/role actions', async () => {
    const f = fixture();
    f.unsafe.mockRejectedValueOnce(new Error('secret source should never escape'));
    await expect(createPostgresScoredExamTraceReader(f.settings)!.read(id(10))).rejects.toThrow(
      'SCORED_EXAM_TRACE_READER_UNAVAILABLE',
    );
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it.each(['resolve', 'reject', 'throw-cancel'] as const)(
    'bounds the owned pending read, ignores late %s and requests cancel once',
    async (mode) => {
      vi.useFakeTimers();
      try {
        const f = fixture();
        let resolve!: (v: unknown) => void, reject!: (v: unknown) => void;
        const query = new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        });
        const cancel = vi.fn(() => {
          if (mode === 'throw-cancel') throw new Error('cancel failed');
          return Promise.resolve();
        });
        const prototype = Object.create(Promise.prototype) as object;
        Object.defineProperty(prototype, 'cancel', { value: cancel });
        Object.setPrototypeOf(query, prototype);
        f.unsafe.mockImplementationOnce(() => query as never);
        const reader = createPostgresScoredExamTraceReader({
          ...f.settings,
          limits: { ...f.settings.limits!, queryMs: 50 },
        })!;
        const pending = expect(reader.read(id(10))).rejects.toThrow(
          'SCORED_EXAM_TRACE_READER_UNAVAILABLE',
        );
        await vi.advanceTimersByTimeAsync(51);
        await pending;
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(f.unsafe).toHaveBeenCalledTimes(1);
        if (mode === 'reject') reject(new Error('late private result'));
        else resolve([{ data: f.raw }]);
        await vi.advanceTimersByTimeAsync(100);
        expect(cancel).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('does not invoke a cancel getter or cancel a completed read', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      let touched = 0;
      const query = new Promise(() => {});
      Object.defineProperty(query, 'cancel', {
        get() {
          touched++;
          throw new Error('getter');
        },
      });
      f.unsafe.mockImplementationOnce(() => query as never);
      const reader = createPostgresScoredExamTraceReader({
        ...f.settings,
        limits: { ...f.settings.limits!, queryMs: 50 },
      })!;
      const pending = expect(reader.read(id(10))).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(51);
      await pending;
      expect(touched).toBe(0);
      const cancel = vi.fn();
      const complete = Promise.resolve([{ data: f.raw }]);
      Object.defineProperty(complete, 'cancel', { value: cancel });
      f.unsafe.mockImplementationOnce(() => complete as never);
      await reader.read(id(10));
      await vi.advanceTimersByTimeAsync(100);
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
