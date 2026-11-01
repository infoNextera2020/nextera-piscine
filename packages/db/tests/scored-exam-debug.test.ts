import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  scoredExamFixture,
  scoredProjection,
} from '../../../scripts/curriculum/tests/scored-exam-fixture';
import { checkpointAnswerContractDigest } from '../queries/checkpoint-answer-drafts';
import {
  RECORD_EXAM_SCORING_EVENT_SQL,
  type ExamScoringReviewClient,
} from '../queries/exam-scoring-review';
import { EXAM_TRACE_DETAIL_APPROVAL } from '../operations/scored-exam-trace';
import {
  prepareScoredExamDebugProjection,
  createScoredExamDebugBridge,
  type ScoredExamDebugSettings,
  type ScoredExamDebugProjection,
} from '../operations/scored-exam-debug';
const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const h = (v: string) => v.repeat(64),
  id = (n: number) => '00000000-0000-0000-0000-' + n.toString(16).padStart(12, '0');
const limits = {
  operationMs: 1000,
  maxContextBytes: 1048576,
  maxAnswerBytes: 4096,
  maxEnvelopeBytes: 65536,
};
const projectionLimits = {
  maxContextBytes: limits.maxContextBytes,
  maxAnswerBytes: limits.maxAnswerBytes,
};
/** Synthetic non-runnable source. Approval-looking metadata is not owner/native authority. */
function fixture(source = 'package piscine\r\nfunc Fixture8(a,b int) int { return a+b }\r\n') {
  const f = scoredExamFixture();
  f.template.source_binding.decisions.weightsOwnerMessageId = EXAM_TRACE_DETAIL_APPROVAL;
  f.template.source_binding.decisions.traceComparatorOwnerMessageId = EXAM_TRACE_DETAIL_APPROVAL;
  const q = f.template.questions[7]!;
  q.functionalGroups = [3, 2, 2, 2].map((points, i) => ({
    key: ['normal', 'sign-zero', 'singleton', 'empty'][i]!,
    points,
    criteriaDigest: hash('synthetic-group-' + i),
  }));
  const publication = scoredProjection(f),
    task = publication.checkpoint.tasks[7]!;
  const payload = JSON.stringify({
    version: 1,
    kind: 'debug_with_reason',
    source,
    explanation: 'Synthetic cause and repair.',
    counterexample: 'Synthetic distinguishing input.',
  });
  const raw = Buffer.from(payload),
    route = task.answerEvaluator!;
  const scope = {
    learnerId: id(4),
    cohortId: id(6),
    attemptId: id(3),
    taskKey: 'q8',
    definitionDigest: publication.definitionDigest,
  };
  const context = {
    version: 1,
    receiptId: id(1),
    requestId: id(2),
    attemptId: id(3),
    learnerId: id(4),
    authUserId: id(5),
    cohortId: id(6),
    curriculumVersionId: id(7),
    nodeKey: publication.nodeKey,
    form: 'A',
    questionKey: 'q8',
    answerKind: 'debug_with_reason',
    answerContractDigest: checkpointAnswerContractDigest(scope, {
      version: 1,
      kind: 'debug_with_reason',
      maxBytes: Number(task.answerContract!.maxBytes),
    }),
    acceptedAtMicros: '1000000',
    acceptedOrdinal: '1',
    answerBase64: raw.toString('base64'),
    answerSha256: hash(raw),
    answerByteLength: raw.length,
    definitionDigest: publication.definitionDigest,
    snapshotDigest: h('b'),
    publishedCriteriaDigest: publication.scoringRubric.questions[7]!.publishedCriteriaDigest,
    publication,
    outbox: {
      receiptId: id(1),
      answerSha256: hash(raw),
      snapshotDigest: h('b'),
      evaluatorKey: route.evaluatorKey,
      evaluatorDigest: route.evaluatorDigest,
      evaluation: 'pending',
    },
    expectedRevision: '0',
  };
  const cases = [
    { input: [1, 2], expected: 3 },
    { input: [-1, 0], expected: -1 },
    { input: [1], expected: 1 },
    { input: [], expected: [] },
  ];
  const publicCasesBytes = Buffer.from(JSON.stringify(cases.slice(0, 2))),
    privateCasesBytes = Buffer.from(JSON.stringify(cases.slice(2)));
  const manifest = {
    version: 1,
    failureSemantics: 'complete-observations-only-v1',
    caseFiles: { publicSha256: hash(publicCasesBytes), privateSha256: hash(privateCasesBytes) },
    groups: q.functionalGroups.map((g, index) => ({
      groupKey: g.key,
      criteriaDigest: g.criteriaDigest,
      cases: [{ index, caseSha256: hash(JSON.stringify(cases[index])) }],
    })),
  };
  const pack = {
    manifestBytes: Buffer.from(JSON.stringify(manifest)),
    publicCasesBytes,
    privateCasesBytes,
  };
  return { context, pack, source, payload, manifest };
}
function job(projection: ScoredExamDebugProjection) {
  const { binding: b, source: s, execution: e } = projection.request;
  return {
    version: 1,
    projectionId: id(21),
    internalSubmissionId: id(22),
    jobId: id(23),
    projectionDigest: projection.projectionDigest,
    evaluationSnapshotDigest: h('8'),
    evaluationSpecDigest: e.evaluationSpecDigest,
    artifact: {
      id: id(24),
      bucket: 'nextera-submissions',
      key: [b.authUserId, b.cohortId, 'scored-exam-v1', b.attemptId, 'q8', id(21), s.sha256].join(
        '/',
      ),
      filename: s.filename,
      size_bytes: s.byteLength,
      sha256: s.sha256,
    },
  };
}
function terminal(projection: ScoredExamDebugProjection, j = job(projection)) {
  const e = projection.request.execution,
    m = e.manifestBinding;
  return {
    version: 1,
    state: 'persisted_terminal',
    projectionId: j.projectionId,
    internalSubmissionId: j.internalSubmissionId,
    jobId: j.jobId,
    executionId: id(25),
    evaluationSnapshotDigest: j.evaluationSnapshotDigest,
    evaluationSpecDigest: j.evaluationSpecDigest,
    resultDigest: h('c'),
    acknowledgedAtMicros: '2000000',
    report: {
      version: 1,
      jobId: j.jobId,
      submissionId: j.internalSubmissionId,
      itemKey: 'q8',
      evaluationSnapshotDigest: j.evaluationSnapshotDigest,
      evaluationSpecDigest: j.evaluationSpecDigest,
      artifactSha256: projection.request.source.sha256,
      testPackId: m.testPackId,
      testPackDigest: m.testPackDigest,
      manifestSha256: m.manifestSha256,
      publicCasesSha256: m.publicCasesSha256,
      privateCasesSha256: m.privateCasesSha256,
      caseCount: m.caseCount,
      groups: e.groups.map((g, i) => ({ ...g, passed: i % 2 === 0 })),
    },
  };
}
function harness() {
  const f = fixture(),
    projection = prepareScoredExamDebugProjection(f.context, f.pack, projectionLimits),
    j = job(projection),
    t = terminal(projection, j);
  const retained = new Map<string, Uint8Array>(),
    calls: { sql: string; parameters: unknown[] }[] = [];
  let lost = false,
    denial: string | null = null;
  const unsafe = vi.fn(async (sql: string, parameters: unknown[]): Promise<unknown> => {
    calls.push({ sql, parameters: structuredClone(parameters) });
    if (sql !== RECORD_EXAM_SCORING_EVENT_SQL) throw new Error('unexpected source SQL');
    if (lost) {
      lost = false;
      throw new Error('secret transport detail must not escape');
    }
    if (denial) return [{ data: { kind: denial } }];
    return [
      {
        data: {
          kind: 'recorded',
          eventId: id(50),
          operationId: parameters[1],
          submissionId: parameters[2],
          revision: (BigInt(String(parameters[3])) + 1n).toString(),
          payloadDigest: parameters[6],
          replayed: calls.length > 1,
        },
      },
    ];
  });
  const settings: ScoredExamDebugSettings = {
    reader: { read: vi.fn(async () => structuredClone(f.context)) },
    packs: { read: vi.fn(async () => f.pack) },
    jobs: {
      read: vi.fn(async () => structuredClone(j)),
      terminal: vi.fn(async () => structuredClone(t)),
    },
    publicationOutbox: {
      store: vi.fn(async (operation, bytes) => {
        const old = retained.get(operation);
        if (old && !Buffer.from(old).equals(Buffer.from(bytes)))
          throw new Error('immutable conflict');
        retained.set(operation, new Uint8Array(bytes));
      }),
      read: vi.fn(async (operation) =>
        retained.get(operation) ? new Uint8Array(retained.get(operation)!) : null,
      ),
    },
    client: { unsafe } as unknown as ExamScoringReviewClient,
    limits,
  };
  return {
    ...f,
    projection,
    j,
    t,
    settings,
    retained,
    calls,
    unsafe,
    lose: () => {
      lost = true;
    },
    deny: (v: string) => {
      denial = v;
    },
  };
}
describe('disabled q8 exact repair-source projection, synthetic data only', () => {
  it('separates whole answer identity from exact CRLF/Unicode source bytes and keeps all bindings immutable', () => {
    const f = fixture('package piscine\r\n// café\r\nfunc Fixture8(a,b int) int{return a+b}\r\n'),
      p = prepareScoredExamDebugProjection(f.context, f.pack, projectionLimits);
    expect(p.runtimeEnabled).toBe(false);
    expect(p.request.source.utf8).toBe(f.source);
    expect(p.request.source.sha256).toBe(hash(Buffer.from(f.source)));
    expect(p.request.source.sha256).not.toBe(f.context.answerSha256);
    expect(p.request.binding.answerSha256).toBe(f.context.answerSha256);
    expect(p.request.source.filename).toBe('q8.go');
    expect(p.request.execution.manifestBinding.answerKind).toBe('debug_with_reason');
    expect(Object.isFrozen(p.request.execution.groups)).toBe(true);
    expect(JSON.stringify(p)).not.toContain('Synthetic cause');
    expect(JSON.stringify(p)).not.toContain('Synthetic distinguishing');
  });
  it('changes projection identity when explanation changes even if source remains identical', () => {
    const f = fixture(),
      p = prepareScoredExamDebugProjection(f.context, f.pack, projectionLimits),
      answer = JSON.parse(f.payload) as Record<string, unknown>;
    answer.explanation = 'A distinct whole submission.';
    const raw = Buffer.from(JSON.stringify(answer));
    f.context.answerBase64 = raw.toString('base64');
    f.context.answerByteLength = raw.length;
    f.context.answerSha256 = hash(raw);
    f.context.outbox.answerSha256 = hash(raw);
    const other = prepareScoredExamDebugProjection(f.context, f.pack, projectionLimits);
    expect(other.request.source.sha256).toBe(p.request.source.sha256);
    expect(other.projectionDigest).not.toBe(p.projectionDigest);
  });
  it.each([
    'receipt',
    'kind',
    'question',
    'contract',
    'digest',
    'base64',
    'length',
    'criteria',
    'outbox',
    'owner',
    'weight',
    'case-file',
    'empty',
    'surrogate',
  ])('rejects malformed or unbound %s before any job/evidence', (fault) => {
    const f = fixture();
    const c = f.context as unknown as Record<string, unknown>;
    if (fault === 'receipt') c.receiptId = 'BAD';
    if (fault === 'kind') c.answerKind = 'coding';
    if (fault === 'question') c.questionKey = 'q1';
    if (fault === 'contract') c.answerContractDigest = h('f');
    if (fault === 'digest') c.answerSha256 = h('f');
    if (fault === 'base64') c.answerBase64 = f.context.answerBase64 + '\n';
    if (fault === 'length') c.answerByteLength = 1;
    if (fault === 'criteria') c.publishedCriteriaDigest = h('f');
    if (fault === 'outbox') f.context.outbox.evaluation = 'evaluated';
    if (fault === 'owner')
      (
        f.context.publication.scoringSourceBinding.decisions as unknown as {
          weightsOwnerMessageId: string;
        }
      ).weightsOwnerMessageId = 'Sentinel_' + 'f'.repeat(32);
    if (fault === 'weight')
      (
        f.context.publication.scoringRubric.questions[7]!.functionalGroups[0]! as unknown as {
          points: number;
        }
      ).points = 4;
    if (fault === 'case-file') f.pack.privateCasesBytes = Buffer.from('[]');
    if (fault === 'empty' || fault === 'surrogate') {
      const a = JSON.parse(f.payload) as Record<string, unknown>;
      a.source = fault === 'empty' ? ' ' : '\ud800';
      const raw = Buffer.from(JSON.stringify(a));
      c.answerBase64 = raw.toString('base64');
      c.answerByteLength = raw.length;
      c.answerSha256 = hash(raw);
      f.context.outbox.answerSha256 = hash(raw);
    }
    expect(() => prepareScoredExamDebugProjection(c, f.pack, projectionLimits)).toThrow();
  });
  it('does not invoke accessors or use overridden byte metadata', () => {
    const f = fixture(),
      getter = vi.fn(() => f.context.publication);
    Object.defineProperty(f.context, 'publication', { get: getter });
    expect(() => prepareScoredExamDebugProjection(f.context, f.pack, projectionLimits)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const g = fixture(),
      bytes = new Uint8Array(1048577);
    Object.defineProperty(bytes, 'byteLength', { value: 1 });
    Object.defineProperty(g.pack, 'manifestBytes', { value: bytes });
    expect(() => prepareScoredExamDebugProjection(g.context, g.pack, projectionLimits)).toThrow();
  });
});
describe('q8 required native mapping/result/publication ports, all fake', () => {
  it('is unavailable with every missing port and makes no hidden connection', () => {
    expect(createScoredExamDebugBridge().available).toBe(false);
    for (const missing of [
      'reader',
      'packs',
      'jobs',
      'publicationOutbox',
      'client',
      'limits',
    ] as const) {
      const f = harness();
      expect(createScoredExamDebugBridge({ ...f.settings, [missing]: null }).available).toBe(false);
      expect(f.unsafe).not.toHaveBeenCalled();
    }
  });
  it('composes the exact job report into whole-receipt functional evidence after protected readback', async () => {
    const f = harness(),
      bridge = createScoredExamDebugBridge(f.settings),
      p = await bridge.prepareProjection(id(1)),
      prepared = await bridge.prepareEvidence(p, id(40));
    expect(f.calls).toEqual([]);
    expect(prepared.write.submissionId).toBe(id(1));
    expect(prepared.payload.state).toBe('evaluated');
    if (prepared.payload.state !== 'evaluated') throw new Error('missing evidence');
    expect(prepared.payload.evidence).toMatchObject({
      questionKey: 'q8',
      answerSha256: f.context.answerSha256,
      kind: 'groups',
    });
    expect(prepared.payload.evidence).not.toHaveProperty('marks');
    expect(prepared.payload.evidence.answerSha256).not.toBe(p.request.source.sha256);
    expect(await bridge.record(prepared)).toMatchObject({ kind: 'recorded', submissionId: id(1) });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.parameters[2]).toBe(id(1));
    expect(f.calls[0]!.parameters[5]).not.toContain(f.source);
  });
  it.each([
    'receipt-as-execution',
    'job',
    'projection',
    'spec',
    'path',
    'owner-path',
    'file',
    'source',
    'whole-as-source',
    'terminal',
    'execution',
    'missing',
    'binary',
    'snapshot',
    'groups',
    'incomplete',
    'result',
  ])('rejects unbound %s with no scoring write', async (fault) => {
    const f = harness(),
      bridge = createScoredExamDebugBridge(f.settings),
      p = await bridge.prepareProjection(id(1));
    if (fault === 'receipt-as-execution') f.j.internalSubmissionId = id(1);
    if (fault === 'job') f.j.jobId = id(88);
    if (fault === 'projection') f.j.projectionDigest = h('f');
    if (fault === 'spec') f.j.evaluationSpecDigest = h('f');
    if (fault === 'path') f.j.artifact.key = f.j.artifact.key.replace('/q8/', '/q1/');
    if (fault === 'owner-path') f.j.artifact.key = f.j.artifact.key.replace(id(5), id(4));
    if (fault === 'file') f.j.artifact.filename = 'main.go';
    if (fault === 'source') f.j.artifact.sha256 = h('f');
    if (fault === 'whole-as-source') f.t.report.artifactSha256 = f.context.answerSha256;
    if (fault === 'terminal') f.t.state = 'claimed';
    if (fault === 'execution') f.t.executionId = '';
    if (fault === 'snapshot') f.t.report.evaluationSnapshotDigest = h('f');
    if (fault === 'missing') f.t.report = null as never;
    if (fault === 'binary') f.t.report = 'passed' as never;
    if (fault === 'groups') f.t.report.groups.reverse();
    if (fault === 'incomplete') f.t.report.groups.pop();
    if (fault === 'result') f.t.resultDigest = '';
    await expect(bridge.prepareEvidence(p, id(40))).rejects.toThrow();
    expect(f.calls).toEqual([]);
    expect(f.retained.size).toBe(0);
  });
  it('rejects changed immutable receipt provenance after projection, without replacing the job', async () => {
    const f = harness(),
      b = createScoredExamDebugBridge(f.settings),
      p = await b.prepareProjection(id(1));
    f.context.acceptedOrdinal = '2';
    await expect(b.prepareEvidence(p, id(40))).rejects.toThrow();
    expect(f.settings.jobs!.read).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
  });
  it('checks current revision then freezes exact envelope; lost acknowledgement retries no fresh source or job', async () => {
    const f = harness(),
      b = createScoredExamDebugBridge(f.settings),
      p = await b.prepareProjection(id(1));
    f.context.expectedRevision = '9';
    const prepared = await b.prepareEvidence(p, id(40));
    expect(prepared.write.expectedRevision).toBe('9');
    f.lose();
    expect(await b.record(prepared)).toMatchObject({ kind: 'uncertain', operationId: id(40) });
    const reads = vi.mocked(f.settings.reader!.read).mock.calls.length;
    expect(await b.retry(prepared)).toMatchObject({ kind: 'recorded', replayed: true });
    expect(vi.mocked(f.settings.reader!.read).mock.calls.length).toBe(reads);
    expect(f.calls[1]!.parameters).toEqual(f.calls[0]!.parameters);
    await expect(b.record(structuredClone(prepared))).rejects.toThrow();
  });
  it('does not erase unknown outcome after a later denied exact retry', async () => {
    const f = harness(),
      b = createScoredExamDebugBridge(f.settings),
      p = await b.prepareProjection(id(1)),
      prepared = await b.prepareEvidence(p, id(40));
    f.lose();
    await b.record(prepared);
    f.deny('forbidden');
    expect(await b.retry(prepared)).toMatchObject({ kind: 'uncertain' });
  });
  it('keeps infrastructure/read failures unresolved without publishing zero or marks', async () => {
    const f = harness(),
      b = createScoredExamDebugBridge(f.settings),
      p = await b.prepareProjection(id(1));
    vi.mocked(f.settings.jobs!.terminal).mockRejectedValue(new Error('sensitive native reason'));
    await expect(b.prepareEvidence(p, id(40))).rejects.toThrow('SCORED_EXAM_DEBUG_UNAVAILABLE');
    expect(f.calls).toEqual([]);
  });
  it('rejects modified retained evidence and forged projection ownership', async () => {
    const f = harness(),
      b = createScoredExamDebugBridge(f.settings),
      p = await b.prepareProjection(id(1));
    await expect(b.prepareEvidence(structuredClone(p), id(40))).rejects.toThrow();
    const prepared = await b.prepareEvidence(p, id(40));
    f.retained.set(id(40), Buffer.from('{}'));
    expect(await b.record(prepared)).toEqual({ kind: 'unavailable' });
    expect(f.calls).toEqual([]);
  });
  it('installs the pending publication latch before a retained-read callback can reenter', async () => {
    const f = harness(),
      b = createScoredExamDebugBridge(f.settings),
      p = await b.prepareProjection(id(1));
    const prepared = await b.prepareEvidence(p, id(40));
    let nested: unknown;
    vi.mocked(f.settings.publicationOutbox!.read).mockImplementation(async (operation) => {
      nested = await b.record(prepared);
      return new Uint8Array(f.retained.get(operation)!);
    });
    expect(await b.record(prepared)).toMatchObject({ kind: 'recorded' });
    expect(nested).toMatchObject({ kind: 'uncertain' });
    expect(f.calls).toHaveLength(1);
  });
  it('enforces the original preparation deadline and never writes after late retention', async () => {
    const f = harness();
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const b = createScoredExamDebugBridge(f.settings),
        p = await b.prepareProjection(id(1));
      vi.mocked(f.settings.publicationOutbox!.store).mockImplementation(async () => {
        now = limits.operationMs + 1;
      });
      await expect(b.prepareEvidence(p, id(40))).rejects.toThrow();
      expect(f.calls).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  });
});
