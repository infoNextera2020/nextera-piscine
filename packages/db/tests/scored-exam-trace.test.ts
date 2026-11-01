import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EXAM_TRACE_COMPARATOR_V1 } from '@nextera/domain';
import { contextFixture } from './scored-exam-review-fixture';
import { scoredExamFramedDigest } from '../operations/scored-exam-publication';
import {
  createScoredExamTraceProcessor,
  prepareScoredExamTraceOracle,
  EXAM_TRACE_DETAIL_APPROVAL,
  type ScoredExamTraceSettings,
} from '../operations/scored-exam-trace';
import {
  RECORD_EXAM_SCORING_EVENT_SQL,
  type ExamScoringReviewClient,
} from '../queries/exam-scoring-review';

const id = (n: number) => '00000000-0000-0000-0000-' + n.toString(16).padStart(12, '0');
const hash = (x: Uint8Array | string) => createHash('sha256').update(x).digest('hex');
const h = (x: string) => x.repeat(64);
/** All answer/oracle/criteria bytes here are synthetic, never actual exam answers. */
function fixture(
  q: 'q6' | 'q7' = 'q6',
  actual = 'synthetic-alpha\r\n',
  expected = 'synthetic-alpha\n',
) {
  const rubric = contextFixture().rubric;
  const program = Buffer.from('package main // synthetic provenance, never executed'),
    checkpointDocument = Buffer.from('synthetic-private-checkpoints-not-an-approved-rubric');
  const input: Parameters<typeof prepareScoredExamTraceOracle>[0] = {
    evaluatorKey: 'synthetic-trace-v1',
    form: 'A' as const,
    questionKey: q,
    paperSha256: h('a'),
    publishedCriteriaDigest: rubric.questions.find((x) => x.questionKey === q)!
      .publishedCriteriaDigest,
    programBytes: program,
    expectedOutputBytes: Buffer.from(expected),
    checkpointDocumentBytes: checkpointDocument,
    review: {
      programSha256: hash(program),
      expectedOutputSha256: hash(expected),
      checkpointDocumentSha256: hash(checkpointDocument),
      referenceVerificationSha256: h('b'),
      approvalMessageId: EXAM_TRACE_DETAIL_APPROVAL,
    },
  };
  const oracle = prepareScoredExamTraceOracle(input);
  const rubricBody = {
    version: rubric.version,
    form: rubric.form,
    definitionDigest: rubric.definitionDigest,
    questions: rubric.questions,
  };
  const sourceBinding = {
    draftSha256: h('c'),
    paperSha256: input.paperSha256,
    decisions: {
      weightsOwnerMessageId: EXAM_TRACE_DETAIL_APPROVAL,
      approvedDraftSha256: h('c'),
      traceComparatorOwnerMessageId: EXAM_TRACE_DETAIL_APPROVAL,
      traceComparator: EXAM_TRACE_COMPARATOR_V1,
      manualCriteriaSha256: h('d'),
    },
    rubric: rubricBody,
  };
  const payload = JSON.stringify({
    version: 1,
    kind: 'trace_with_reason',
    output: actual,
    reason: 'synthetic private reason',
  });
  const context = {
    version: 1,
    receiptId: id(1),
    attemptId: id(2),
    learnerId: id(3),
    cohortId: id(4),
    curriculumVersionId: id(5),
    nodeKey: 'synthetic-exam',
    form: 'A',
    questionKey: q,
    answerKind: 'trace_with_reason',
    answerContractDigest: h('e'),
    acceptedAtMicros: '1793510000000000',
    answerBase64: Buffer.from(payload).toString('base64'),
    answerSha256: hash(payload),
    answerByteLength: Buffer.byteLength(payload),
    definitionDigest: rubric.definitionDigest,
    snapshotDigest: h('f'),
    evaluatorKey: oracle.evaluatorKey,
    evaluatorDigest: oracle.evaluatorDigest,
    publishedCriteriaDigest: input.publishedCriteriaDigest,
    rubricSourceBindingDigest: scoredExamFramedDigest(
      sourceBinding,
      'nextera-exam1-rubric-source-binding',
    ),
    rubric,
    sourceBinding,
    outbox: {
      receiptId: id(1),
      answerSha256: hash(payload),
      snapshotDigest: h('f'),
      evaluatorKey: oracle.evaluatorKey,
      evaluatorDigest: oracle.evaluatorDigest,
      evaluation: 'pending',
    },
    expectedRevision: '9007199254740993',
  };
  const retained = new Map<string, Uint8Array>();
  const events: string[] = [],
    writes: unknown[][] = [];
  const reader = {
    read: vi.fn(async () => {
      events.push('read');
      return context;
    }),
  };
  const criteria = {
    read: vi.fn(async () => {
      events.push('criteria');
      return oracle;
    }),
  };
  const publicationOutbox = {
    store: vi.fn(async (op: string, bytes: Uint8Array) => {
      events.push('store');
      if (retained.has(op) && !Buffer.from(retained.get(op)!).equals(Buffer.from(bytes)))
        throw new Error('immutable conflict');
      retained.set(op, new Uint8Array(bytes));
    }),
    read: vi.fn(async (op: string) => {
      events.push('retained');
      return retained.get(op) ?? null;
    }),
  };
  const ack = (p: unknown[]) => [
    {
      data: {
        kind: 'recorded',
        eventId: id(8),
        operationId: p[1],
        submissionId: p[2],
        revision: (BigInt(String(p[3])) + 1n).toString(),
        payloadDigest: p[6],
        replayed: writes.length > 1,
      },
    },
  ];
  const unsafe = vi.fn(async (sql: string, p: unknown[]) => {
    events.push('write');
    expect(sql).toBe(RECORD_EXAM_SCORING_EVENT_SQL);
    expect(p[0]).toBeNull();
    expect(retained.has(String(p[1]))).toBe(true);
    writes.push(structuredClone(p));
    return ack(p);
  });
  const settings: ScoredExamTraceSettings = {
    reader,
    criteria,
    publicationOutbox,
    client: { unsafe } as unknown as ExamScoringReviewClient,
    limits: {
      operationMs: 1000,
      maxContextBytes: 65536,
      maxAnswerBytes: 8192,
      maxEnvelopeBytes: 8192,
    },
  };
  return {
    context,
    oracle,
    input,
    payload,
    reader,
    criteria,
    publicationOutbox,
    retained,
    events,
    writes,
    unsafe,
    ack,
    settings,
  };
}

describe('private reviewed trace oracle preparation', () => {
  it('binds exact bytes/provenance without exposing oracle bytes or retaining caller buffers', () => {
    const f = fixture(),
      original = f.oracle.evaluatorDigest;
    f.input.expectedOutputBytes.fill(0);
    f.input.programBytes.fill(0);
    f.input.checkpointDocumentBytes.fill(0);
    expect(f.oracle.evaluatorDigest).toBe(original);
    expect(Object.keys(f.oracle)).toEqual(['version', 'evaluatorKey', 'spec', 'evaluatorDigest']);
    expect(JSON.stringify(f.oracle)).not.toContain('synthetic-alpha');
    expect(Object.isFrozen(f.oracle.spec)).toBe(true);
  });
  it.each([
    'programSha256',
    'expectedOutputSha256',
    'checkpointDocumentSha256',
    'approvalMessageId',
  ] as const)('rejects substituted %s', (field) => {
    const f = fixture(),
      review = { ...f.input.review, [field]: h('0') };
    expect(() => prepareScoredExamTraceOracle({ ...f.input, review } as typeof f.input)).toThrow(
      'SCORED_EXAM_TRACE_INVALID_INPUT',
    );
  });
  it('rejects invalid UTF-8 rather than changing private expected bytes', () => {
    const f = fixture();
    expect(() =>
      prepareScoredExamTraceOracle({ ...f.input, expectedOutputBytes: Uint8Array.of(0xff) }),
    ).toThrow();
  });
});

describe('one accepted q6/q7 receipt to existing scoring-event writer, fake ports only', () => {
  it('bounds private and retained byte views by intrinsic lengths without invoking shadow getters', async () => {
    const f = fixture();
    let invoked = 0;
    const oversized = new Uint8Array(1048577);
    Object.defineProperty(oversized, 'byteLength', {
      get() {
        invoked++;
        return 1;
      },
    });
    Object.defineProperty(oversized, Symbol.iterator, {
      get() {
        invoked++;
        throw new Error('iterator');
      },
    });
    expect(() =>
      prepareScoredExamTraceOracle({ ...f.input, expectedOutputBytes: oversized }),
    ).toThrow();
    const small = new Uint8Array(9000);
    Object.defineProperty(small, 'byteLength', {
      get() {
        invoked++;
        return 1;
      },
    });
    f.publicationOutbox.read.mockResolvedValueOnce(small);
    await expect(
      createScoredExamTraceProcessor(f.settings).prepare(id(1), id(9)),
    ).rejects.toThrow();
    expect(invoked).toBe(0);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('rejects shared oracle buffers and bounds record readback without trusting own byteLength', async () => {
    const f = fixture();
    expect(() =>
      prepareScoredExamTraceOracle({
        ...f.input,
        expectedOutputBytes: new Uint8Array(new SharedArrayBuffer(1)),
      }),
    ).toThrow();
    const processor = createScoredExamTraceProcessor(f.settings),
      p = await processor.prepare(id(1), id(9));
    let invoked = 0;
    const oversized = new Uint8Array(9000);
    Object.defineProperty(oversized, 'byteLength', {
      get() {
        invoked++;
        return 0;
      },
    });
    f.publicationOutbox.read.mockResolvedValueOnce(oversized);
    expect(await processor.record(p)).toEqual({ kind: 'unavailable' });
    expect(invoked).toBe(0);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it.each(['forbidden', 'unavailable', 'stale_revision'] as const)(
    'preserves lost-ACK uncertainty when the later exact retry is %s',
    async (kind) => {
      const f = fixture();
      f.unsafe.mockRejectedValueOnce(new Error('lost acknowledgement'));
      const processor = createScoredExamTraceProcessor(f.settings),
        p = await processor.prepare(id(1), id(9));
      expect(await processor.record(p)).toMatchObject({ kind: 'uncertain' });
      f.unsafe.mockResolvedValueOnce([{ data: { kind } }] as never);
      expect(await processor.retry(p)).toEqual({
        kind: 'uncertain',
        operationId: id(9),
        retry: 'same_envelope_only',
      });
      expect(f.unsafe).toHaveBeenCalledTimes(2);
      expect(await processor.retry(p)).toMatchObject({ kind: 'recorded' });
    },
  );

  it.each([false, true])(
    'sets the pending latch before a retention port can reenter publication (lost=%s)',
    async (lost) => {
      const f = fixture();
      if (lost) f.unsafe.mockRejectedValueOnce(new Error('synthetic lost ack'));
      const processor = createScoredExamTraceProcessor(f.settings);
      const prepared = await processor.prepare(id(1), id(9));
      let reentrant: ReturnType<typeof processor.retry> | undefined;
      f.publicationOutbox.read.mockImplementationOnce(async () => {
        reentrant = processor.retry(prepared);
        return f.retained.get(id(9))!;
      });
      expect(await processor.record(prepared)).toMatchObject({
        kind: lost ? 'uncertain' : 'recorded',
      });
      expect(await reentrant).toMatchObject({ kind: 'uncertain' });
      expect(f.unsafe).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['q6', 'q7'] as const)(
    'prepares and records %s with original whole-answer identity and durable readback first',
    async (q) => {
      const f = fixture(q),
        processor = createScoredExamTraceProcessor(f.settings);
      const before = structuredClone(f.context);
      const p = await processor.prepare(id(1), id(9));
      expect(f.events).toEqual(['read', 'criteria', 'read', 'store', 'retained']);
      expect(p.payload.state).toBe('evaluated');
      if (p.payload.state !== 'evaluated') throw new Error('fixture');
      expect(p.payload.evidence).toMatchObject({
        kind: 'trace_output',
        matched: true,
        questionKey: q,
        submissionId: id(1),
        answerSha256: hash(f.payload),
      });
      expect(await processor.record(p)).toMatchObject({
        kind: 'recorded',
        revision: '9007199254740994',
      });
      expect(f.context).toEqual(before);
      expect(f.writes[0]![3]).toBe('9007199254740993');
      const saved = Buffer.from(f.retained.get(id(9))!).toString();
      expect(saved).not.toContain('synthetic-alpha');
      expect(saved).not.toContain('private reason');
      expect(f.reader.read).toHaveBeenCalledTimes(2);
    },
  );
  it('records a confidently compared mismatch as false, not missing/infra evidence', async () => {
    const f = fixture('q6', 'synthetic-alpha \n'),
      processor = createScoredExamTraceProcessor(f.settings);
    const p = await processor.prepare(id(1), id(9));
    expect(p.payload).toMatchObject({ state: 'evaluated', evidence: { matched: false } });
    expect(await processor.record(p)).toMatchObject({ kind: 'recorded' });
  });
  it.each(['reader', 'criteria', 'publicationOutbox', 'limits', 'client'] as const)(
    'missing %s stays unavailable before touching a client method',
    async (field) => {
      let touched = 0;
      const f = fixture(),
        client = Object.defineProperty({}, 'unsafe', {
          get() {
            touched++;
            throw new Error('no access');
          },
        });
      const settings = {
        ...f.settings,
        client,
        [field]: null,
      } as unknown as ScoredExamTraceSettings;
      const processor = createScoredExamTraceProcessor(settings);
      expect(processor.available).toBe(false);
      await expect(processor.prepare(id(1), id(9))).rejects.toThrow(
        'SCORED_EXAM_TRACE_UNAVAILABLE',
      );
      expect(touched).toBe(0);
      expect(f.reader.read).not.toHaveBeenCalled();
    },
  );
  it.each([
    'learnerId',
    'cohortId',
    'attemptId',
    'curriculumVersionId',
    'nodeKey',
    'acceptedAtMicros',
    'expectedRevision',
  ] as const)('rejects %s drift across the read/criteria/recheck boundary', async (field) => {
    const f = fixture();
    f.criteria.read.mockImplementation(async () => {
      if (field === 'nodeKey') f.context.nodeKey = 'changed';
      else if (field === 'acceptedAtMicros' || field === 'expectedRevision')
        f.context[field] = '123';
      else f.context[field] = id(99);
      return f.oracle;
    });
    const processor = createScoredExamTraceProcessor(f.settings);
    await expect(processor.prepare(id(1), id(9))).rejects.toThrow('SCORED_EXAM_TRACE_UNAVAILABLE');
    expect(f.publicationOutbox.store).not.toHaveBeenCalled();
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('snapshots returned mutable receipt data before awaiting criteria', async () => {
    const f = fixture(),
      original = structuredClone(f.context);
    f.reader.read.mockResolvedValueOnce(f.context).mockResolvedValueOnce(original);
    f.criteria.read.mockImplementation(async () => {
      f.context.answerBase64 = 'changed';
      return f.oracle;
    });
    const p = await createScoredExamTraceProcessor(f.settings).prepare(id(1), id(9));
    expect(p.payload).toMatchObject({
      evidence: { answerSha256: original.answerSha256, matched: true },
    });
  });
  it.each([
    'question',
    'kind',
    'hash',
    'outbox',
    'route',
    'rubric-source',
    'forged-matched',
    'noncanonical-answer',
  ])('rejects malformed or substituted %s before retention/native publication', async (fault) => {
    const f = fixture();
    if (fault === 'question') (f.context as Record<string, unknown>).questionKey = 'q8';
    if (fault === 'kind') f.context.answerKind = 'debug_with_reason';
    if (fault === 'hash') f.context.answerSha256 = h('0');
    if (fault === 'outbox') f.context.outbox.receiptId = id(33);
    if (fault === 'route') f.context.evaluatorDigest = h('0');
    if (fault === 'rubric-source') f.context.rubricSourceBindingDigest = h('0');
    if (fault === 'forged-matched') Object.assign(f.context, { matched: true });
    if (fault === 'noncanonical-answer') {
      const raw = '{ ' + f.payload.slice(1);
      f.context.answerBase64 = Buffer.from(raw).toString('base64');
      f.context.answerSha256 = hash(raw);
      f.context.outbox.answerSha256 = hash(raw);
      f.context.answerByteLength = Buffer.byteLength(raw);
    }
    await expect(
      createScoredExamTraceProcessor(f.settings).prepare(id(1), id(9)),
    ).rejects.toThrow();
    expect(f.publicationOutbox.store).not.toHaveBeenCalled();
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('rejects a substituted/forged oracle and revoked read permission without zero evidence', async () => {
    const f = fixture();
    f.criteria.read.mockResolvedValue({ ...f.oracle });
    await expect(
      createScoredExamTraceProcessor(f.settings).prepare(id(1), id(9)),
    ).rejects.toThrow();
    f.criteria.read.mockResolvedValue(f.oracle);
    f.reader.read.mockResolvedValueOnce(f.context).mockRejectedValueOnce(new Error('revoked'));
    await expect(
      createScoredExamTraceProcessor(f.settings).prepare(id(1), id(9)),
    ).rejects.toThrow();
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('rejects accessor-backed native metadata without invoking it', async () => {
    const f = fixture();
    let invoked = false;
    Object.defineProperty(f.context, 'nodeKey', {
      get() {
        invoked = true;
        return 'bad';
      },
    });
    await expect(
      createScoredExamTraceProcessor(f.settings).prepare(id(1), id(9)),
    ).rejects.toThrow();
    expect(invoked).toBe(false);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('does not store/publish when criteria or durable retention is unavailable', async () => {
    const f = fixture();
    f.criteria.read.mockRejectedValueOnce(new Error('missing verified criteria'));
    await expect(
      createScoredExamTraceProcessor(f.settings).prepare(id(1), id(9)),
    ).rejects.toThrow();
    expect(f.publicationOutbox.store).not.toHaveBeenCalled();
    f.publicationOutbox.store.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(
      createScoredExamTraceProcessor(f.settings).prepare(id(1), id(9)),
    ).rejects.toThrow();
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('keeps an unknown acknowledgement and retries only the exact owned envelope/revision', async () => {
    const f = fixture();
    f.unsafe.mockRejectedValueOnce(new Error('lost acknowledgement'));
    const processor = createScoredExamTraceProcessor(f.settings),
      p = await processor.prepare(id(1), id(9));
    expect(await processor.record(p)).toEqual({
      kind: 'uncertain',
      operationId: id(9),
      retry: 'same_envelope_only',
    });
    f.context.expectedRevision = '999';
    expect(await processor.retry(p)).toMatchObject({ kind: 'recorded' });
    expect(f.reader.read).toHaveBeenCalledTimes(2);
    expect(f.unsafe).toHaveBeenCalledTimes(2);
    expect(f.unsafe.mock.calls[0]).toEqual(f.unsafe.mock.calls[1]);
    await expect(processor.record({ ...p })).rejects.toThrow('SCORED_EXAM_TRACE_INVALID_INPUT');
  });
  it('rejects tampered retention and preserves previous uncertainty', async () => {
    const f = fixture(),
      processor = createScoredExamTraceProcessor(f.settings),
      p = await processor.prepare(id(1), id(9));
    const original = f.retained.get(id(9))!;
    f.retained.set(id(9), Buffer.from('{}'));
    expect(await processor.record(p)).toEqual({ kind: 'unavailable' });
    expect(f.unsafe).not.toHaveBeenCalled();
    f.retained.set(id(9), original);
    f.unsafe.mockRejectedValueOnce(new Error('lost'));
    expect(await processor.record(p)).toMatchObject({ kind: 'uncertain' });
    f.retained.set(id(9), Buffer.from('{}'));
    expect(await processor.retry(p)).toMatchObject({ kind: 'uncertain' });
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it('passes through authoritative denial without inventing points or retrying', async () => {
    const f = fixture();
    f.unsafe.mockResolvedValueOnce([{ data: { kind: 'forbidden' } }] as never);
    const processor = createScoredExamTraceProcessor(f.settings),
      p = await processor.prepare(id(1), id(9));
    expect(await processor.record(p)).toEqual({ kind: 'forbidden' });
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it('bounds a hung preparation port without publishing or renewing a budget', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.reader.read.mockImplementation(() => new Promise(() => {}));
      const settings = { ...f.settings, limits: { ...f.settings.limits!, operationMs: 20 } };
      const pending = expect(
        createScoredExamTraceProcessor(settings).prepare(id(1), id(9)),
      ).rejects.toThrow('SCORED_EXAM_TRACE_UNAVAILABLE');
      await vi.advanceTimersByTimeAsync(21);
      await pending;
      expect(f.unsafe).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not start a native write after delayed retention exceeds its publication budget', async () => {
    const f = fixture(),
      settings = f.settings;
    const processor = createScoredExamTraceProcessor(settings),
      p = await processor.prepare(id(1), id(9));
    vi.useFakeTimers();
    try {
      let release!: (value: Uint8Array | null) => void;
      f.publicationOutbox.read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const pending = processor.record(p);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toMatchObject({ kind: 'uncertain' });
      release(f.retained.get(id(9))!);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.unsafe).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not duplicate a still-pending native write after timeout', async () => {
    const f = fixture(),
      settings = f.settings;
    const processor = createScoredExamTraceProcessor(settings),
      p = await processor.prepare(id(1), id(9));
    vi.useFakeTimers();
    try {
      let release!: (value: Awaited<ReturnType<typeof f.unsafe>>) => void;
      f.unsafe.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const pending = processor.record(p);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toMatchObject({ kind: 'uncertain' });
      expect(await processor.retry(p)).toMatchObject({ kind: 'uncertain' });
      expect(f.unsafe).toHaveBeenCalledTimes(1);
      release(f.ack(f.unsafe.mock.calls[0]![1]));
      await vi.advanceTimersByTimeAsync(0);
      expect(await processor.retry(p)).toMatchObject({ kind: 'recorded' });
      expect(f.unsafe).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
