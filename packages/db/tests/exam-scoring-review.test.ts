import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  examScoringEventDigest,
  readExamScoringHistory,
  recordExamFunctionalEvidence,
  recordExamIndependentReview,
  recordExamMentorReview,
  RECORD_EXAM_SCORING_EVENT_SQL,
  READ_EXAM_SCORING_HISTORY_SQL,
  type ExamFunctionalResult,
  type ExamMentorReviewPayload,
  type ExamScoringReviewClient,
  type ExamSecondaryReviewPayload,
  type ExamScoringWrite,
} from '../queries/exam-scoring-review';

const id = (n: number) => '00000000-0000-0000-0000-' + n.toString(16).padStart(12, '0');
const h = (c: string) => c.repeat(64);
const write: ExamScoringWrite = {
  operationId: id(10),
  submissionId: id(20),
  expectedRevision: '0',
};
const result: ExamFunctionalResult = {
  state: 'evaluated',
  evidence: {
    submissionId: write.submissionId,
    questionKey: 'q1',
    answerSha256: h('a'),
    rubricDigest: h('b'),
    publishedCriteriaDigest: h('c'),
    evidenceDigest: h('d'),
    kind: 'groups',
    outcomes: [{ groupKey: 'ordinary', criteriaDigest: h('e'), passed: true }],
  },
};
const review: ExamMentorReviewPayload = {
  answerSha256: h('a'),
  rubricDigest: h('b'),
  assignmentDigest: h('c'),
  evidenceDigest: h('d'),
  marks: { contract: 2 },
};
const secondary = { ...review, primaryEventId: id(30) };
function fake(response: unknown = [{ data: { kind: 'forbidden' } }]) {
  const unsafe = vi.fn(async (statement: string, params: unknown[]) => {
    void statement;
    void params;
    return structuredClone(response);
  });
  return { client: { unsafe } as unknown as ExamScoringReviewClient, unsafe };
}
function recorded(
  payload: ExamFunctionalResult | ExamMentorReviewPayload | ExamSecondaryReviewPayload,
  replayed = false,
  revision = '1',
) {
  return [
    {
      data: {
        kind: 'recorded',
        eventId: id(40),
        operationId: write.operationId,
        submissionId: write.submissionId,
        revision,
        payloadDigest: examScoringEventDigest(payload),
        replayed,
      },
    },
  ];
}
function history(events: unknown[] = []) {
  return [
    {
      data: {
        submissionId: write.submissionId,
        attemptId: id(1),
        learnerId: id(2),
        cohortId: id(3),
        questionKey: 'q1',
        answerKind: 'coding',
        answerSha256: h('a'),
        definitionDigest: h('f'),
        rubricDigest: h('b'),
        form: 'A',
        acceptedOrdinal: '9007199254740993',
        revision: String(events.length),
        status: 'provisional',
        events,
      },
    },
  ];
}
function event(payload: ExamFunctionalResult = result, kind = 'functional', revision = '1') {
  return {
    eventId: id(40),
    operationId: write.operationId,
    revision,
    eventKind: kind,
    actorUserId: kind === 'functional' ? null : id(4),
    payload,
    payloadDigest: examScoringEventDigest(payload),
  };
}

describe('narrow scoring writes over an already configured client', () => {
  it('binds exact evaluator payload, immutable operation and expected revision in parameters', async () => {
    const f = fake(recorded(result));
    expect(await recordExamFunctionalEvidence(f.client, write, result)).toMatchObject({
      kind: 'recorded',
      revision: '1',
      replayed: false,
    });
    expect(f.unsafe).toHaveBeenCalledExactlyOnceWith(RECORD_EXAM_SCORING_EVENT_SQL, [
      null,
      write.operationId,
      write.submissionId,
      '0',
      'functional',
      expect.any(String),
      examScoringEventDigest(result),
    ]);
    const params = f.unsafe.mock.calls[0]![1];
    expect(JSON.parse(params[5] as string)).toEqual(result);
    expect(RECORD_EXAM_SCORING_EVENT_SQL).not.toContain(write.submissionId);
  });
  it('keeps primary and independent reviewer identity separate from learner/request claims', async () => {
    const f = fake(recorded(review));
    await recordExamMentorReview(f.client, id(4), write, review);
    expect(f.unsafe.mock.calls[0]![1].slice(0, 5)).toEqual([
      id(4),
      write.operationId,
      write.submissionId,
      '0',
      'primary',
    ]);
    const s = fake(recorded(secondary));
    await recordExamIndependentReview(s.client, id(5), write, secondary);
    expect(s.unsafe.mock.calls[0]![1].slice(0, 5)).toEqual([
      id(5),
      write.operationId,
      write.submissionId,
      '0',
      'secondary',
    ]);
    expect(JSON.parse(s.unsafe.mock.calls[0]![1][5] as string)).toEqual(secondary);
  });
  it('records infrastructure uncertainty as evidence state without manufacturing zero marks', async () => {
    const payload = { state: 'infrastructure_unknown' } as const;
    const f = fake(recorded(payload));
    await recordExamFunctionalEvidence(f.client, write, payload);
    expect(JSON.parse(f.unsafe.mock.calls[0]![1][5] as string)).toEqual(payload);
  });
  it.each([
    'forbidden',
    'invalid_input',
    'unavailable',
    'review_not_open',
    'conflict',
    'stale_revision',
  ] as const)('preserves proved SQL %s denial without automatic retry', async (kind) => {
    const f = fake([{ data: { kind } }]);
    expect(await recordExamFunctionalEvidence(f.client, write, result)).toEqual({ kind });
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it('preserves same-operation replay and compares arbitrary-precision revisions exactly', async () => {
    const f = fake(recorded(result, true, '9007199254740993'));
    const value = { ...write, expectedRevision: '9007199254740992' };
    expect(await recordExamFunctionalEvidence(f.client, value, result)).toMatchObject({
      kind: 'recorded',
      revision: '9007199254740993',
      replayed: true,
    });
    expect(f.unsafe.mock.calls[0]![1][3]).toBe(value.expectedRevision);
  });
  it('captures immutable input before native IO so later mutation cannot change the committed request', async () => {
    const payload = structuredClone(result);
    const w = { ...write };
    const f = fake(recorded(result));
    const pending = recordExamFunctionalEvidence(f.client, w, payload);
    w.submissionId = id(999);
    if (payload.state === 'evaluated') Object.assign(payload.evidence, { answerSha256: h('e') });
    await pending;
    expect(f.unsafe.mock.calls[0]![1][2]).toBe(write.submissionId);
    expect(JSON.parse(f.unsafe.mock.calls[0]![1][5] as string)).toEqual(result);
  });
  it.each(['0.1', '01', '-1', '+1', '9223372036854775807'])(
    'rejects invalid/overflowing expected revision %s before IO',
    async (expectedRevision) => {
      const f = fake();
      await expect(
        recordExamFunctionalEvidence(f.client, { ...write, expectedRevision }, result),
      ).rejects.toThrow('EXAM_SCORING_REVIEW_INVALID_INPUT');
      expect(f.unsafe).not.toHaveBeenCalled();
    },
  );
  it('rejects rebound evidence, invented marks, caller roles and property getters before IO', async () => {
    const f = fake();
    if (result.state !== 'evaluated') throw new Error('fixture');
    await expect(
      recordExamFunctionalEvidence(f.client, write, {
        ...result,
        evidence: { ...result.evidence, submissionId: id(999) },
      }),
    ).rejects.toThrow('INVALID_INPUT');
    await expect(
      recordExamMentorReview(f.client, id(4), write, {
        ...review,
        role: 'mentor',
      } as typeof review),
    ).rejects.toThrow('INVALID_INPUT');
    await expect(
      recordExamMentorReview(f.client, id(4), write, {
        ...review,
        marks: { contract: 2, style: 1 },
      } as typeof review),
    ).rejects.toThrow('INVALID_INPUT');
    const getter = vi.fn(() => id(4));
    const accessor = Object.defineProperty({ ...review }, 'answerSha256', {
      get: getter,
      enumerable: true,
    });
    await expect(recordExamMentorReview(f.client, id(4), write, accessor)).rejects.toThrow(
      'INVALID_INPUT',
    );
    expect(getter).not.toHaveBeenCalled();
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('reports transport ambiguity without leaking raw errors or silently retrying', async () => {
    const f = fake();
    f.unsafe.mockRejectedValue(new Error('private connection text'));
    await expect(recordExamFunctionalEvidence(f.client, write, result)).rejects.toThrow(
      'EXAM_SCORING_REVIEW_OUTCOME_UNKNOWN',
    );
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it.each([
    { reply: [] },
    { reply: [{ data: { kind: 'recorded' } }] },
    { reply: recorded(result, false, '2') },
    { reply: [{ data: { ...recorded(result)[0]!.data, submissionId: id(999) } }] },
    { reply: [{ data: { ...recorded(result)[0]!.data, payloadDigest: h('f') } }] },
    { reply: [{ data: { ...recorded(result)[0]!.data, role: 'admin' } }] },
  ])('fails closed on malformed or rebound SQL acknowledgement %j', async ({ reply }) => {
    const f = fake(reply);
    await expect(recordExamFunctionalEvidence(f.client, write, result)).rejects.toThrow(
      'EXAM_SCORING_REVIEW_OUTCOME_UNKNOWN',
    );
  });
  it('uses stable recursive key ordering and the exact SQL checkpoint digest framing', () => {
    const reversed = {
      marks: review.marks,
      evidenceDigest: review.evidenceDigest,
      assignmentDigest: review.assignmentDigest,
      rubricDigest: review.rubricDigest,
      answerSha256: review.answerSha256,
    };
    const canonical =
      '{"answerSha256":"' +
      h('a') +
      '","assignmentDigest":"' +
      h('c') +
      '","evidenceDigest":"' +
      h('d') +
      '","marks":{"contract":2},"rubricDigest":"' +
      h('b') +
      '"}';
    expect(examScoringEventDigest(reversed)).toBe(examScoringEventDigest(review));
    expect(examScoringEventDigest(review)).toBe(
      createHash('sha256')
        .update('01coding-exam-scoring-event\0v1\0' + canonical)
        .digest('hex'),
    );
  });
});

describe('authorized immutable scoring history stays provisional', () => {
  it('reads exact acceptance and full contiguous event history without creating a final grade', async () => {
    const f = fake(history([event()]));
    const read = await readExamScoringHistory(f.client, id(4), write.submissionId);
    expect(f.unsafe).toHaveBeenCalledExactlyOnceWith(READ_EXAM_SCORING_HISTORY_SQL, [
      id(4),
      write.submissionId,
    ]);
    expect(read).toMatchObject({
      status: 'provisional',
      acceptedOrdinal: '9007199254740993',
      revision: '1',
    });
    expect(read.events[0]).toMatchObject({ eventKind: 'functional', payload: result });
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.events)).toBe(true);
    expect(read).not.toHaveProperty('passed');
    expect(read).not.toHaveProperty('points');
  });
  it.each([
    { revision: '2' },
    { submissionId: id(999) },
    { status: 'passed' },
    { acceptedOrdinal: '01' },
    { events: [{ ...event(), revision: '2' }] },
    { events: [{ ...event(), payloadDigest: h('f') }] },
    { events: [{ ...event(), actorUserId: id(4) }] },
    { events: [event(), event()], revision: '2' },
  ])('rejects incomplete, forged or cross-submission history %j', async (patch) => {
    const value = history([event()]);
    Object.assign(value[0]!.data, patch);
    await expect(
      readExamScoringHistory(fake(value).client, id(4), write.submissionId),
    ).rejects.toThrow('EXAM_SCORING_REVIEW_UNAVAILABLE');
  });
  it('rejects a validly hashed functional result bound to another accepted answer', async () => {
    if (result.state !== 'evaluated') throw new Error('fixture');
    const other = { ...result, evidence: { ...result.evidence, answerSha256: h('e') } };
    const value = history([event(other)]);
    await expect(
      readExamScoringHistory(fake(value).client, id(4), write.submissionId),
    ).rejects.toThrow('UNAVAILABLE');
  });
});
