import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  RECORD_EXAM_SCORING_EVENT_SQL,
  examScoringEventDigest,
  type ExamScoringStoredEvent,
} from '@nextera/db/exam-scoring-review';
import {
  acceptance,
  contextFixture,
  eventFixture,
  hash,
  historyFixture,
  id,
  reviewClient,
  reviewAnswerFixture,
} from '../../../../packages/db/tests/scored-exam-review-fixture';
import {
  configuredScoredExamReviewService,
  createScoredExamReviewService,
} from './scored-exam-review-service';

const policy = { version: 1 as const, maxBodyBytes: 4096, bodyTimeoutMs: 50 };
const contextWithEvents = (events: readonly ExamScoringStoredEvent[]) => {
  const original = contextFixture(),
    accepted = { ...acceptance(1), revision: String(events.length) };
  const context = { ...original, acceptances: [accepted] };
  return { context, accepted, history: historyFixture(context, accepted, events) };
};
const reviewBody = (context = contextFixture()) => ({
  version: 1,
  review: 'primary',
  attemptId: id(3),
  write: { operationId: id(700), submissionId: id(1001), expectedRevision: '0' },
  payload: {
    answerSha256: hash('1'),
    rubricDigest: context.rubric.digest,
    assignmentDigest: context.assignment.digest,
    evidenceDigest: hash('e'),
    marks: { contract: 2 },
  },
});
describe('persisted scoring history to approved score projection', () => {
  it('reads real configured RPCs and keeps completed exam provisional without fabricated adjudication', async () => {
    const context = contextFixture(),
      fake = reviewClient(context);
    const result = await createScoredExamReviewService({
      client: fake.client,
      bodyPolicy: policy,
    }).read(id(101), id(3));
    expect(result.score.intake.status).toBe('completed');
    expect(result.score.status).toBe('provisional');
    expect(result.score.totalPoints).toBeNull();
    expect(result.adjudicationPending).toBe(true);
    expect(result.finalOutcomePersisted).toBe(false);
    expect(fake.calls).toHaveLength(3);
  });
  it('assembles immutable functional plus assigned primary marks', async () => {
    const original = contextFixture(),
      a = acceptance(1);
    const events = [
      eventFixture(original, a, 'functional', 1),
      eventFixture(original, a, 'primary', 2),
    ];
    const f = contextWithEvents(events),
      fake = reviewClient(f.context, [f.history]);
    const result = await createScoredExamReviewService({
      client: fake.client,
      bodyPolicy: policy,
    }).read(id(101), id(3));
    expect(result.score.questions[0]).toMatchObject({ submissionId: a.submissionId, points: 15 });
    expect(result.score.knownCodingPoints).toBe(15);
    expect(result.score.status).toBe('provisional');
  });
  it('does not merge a superseded primary with the old secondary review', async () => {
    const c = contextFixture(),
      a = acceptance(1),
      primary = eventFixture(c, a, 'primary', 2, 0);
    const events = [
      eventFixture(c, a, 'functional', 1),
      primary,
      eventFixture(c, a, 'secondary', 3, 0, primary.eventId),
      eventFixture(c, a, 'primary', 4, 2),
    ];
    const f = contextWithEvents(events),
      fake = reviewClient(f.context, [f.history]);
    const result = await createScoredExamReviewService({
      client: fake.client,
      bodyPolicy: policy,
    }).read(id(101), id(3));
    expect(result.score.questions[0]?.points).toBe(15);
    expect(result.score.secondaryReviewPendingIds).toEqual([]);
    expect(result.score.status).toBe('provisional');
  });
  it('rejects a secondary review referencing a nonexistent primary, even with a valid event digest', async () => {
    const c = contextFixture(),
      a = acceptance(1);
    const f = contextWithEvents([
      eventFixture(c, a, 'functional', 1),
      eventFixture(c, a, 'primary', 2),
      eventFixture(c, a, 'secondary', 3, 2, id(9999)),
    ]);
    const fake = reviewClient(f.context, [f.history]);
    await expect(
      createScoredExamReviewService({ client: fake.client, bodyPolicy: policy }).read(
        id(101),
        id(3),
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('infrastructure uncertainty stays unresolved rather than becoming zero', async () => {
    const c = contextFixture(),
      a = acceptance(1),
      original = eventFixture(c, a, 'functional', 1);
    const payload = { state: 'infrastructure_unknown' as const };
    const event = { ...original, payload, payloadDigest: examScoringEventDigest(payload) };
    const f = contextWithEvents([event]),
      fake = reviewClient(f.context, [f.history]);
    const result = await createScoredExamReviewService({
      client: fake.client,
      bodyPolicy: policy,
    }).read(id(101), id(3));
    expect(result.score.questions[0]).toMatchObject({ state: 'unresolved', points: null });
    expect(result.score.pendingSubmissionIds).toEqual([a.submissionId]);
    expect(result.score.totalPoints).toBeNull();
  });
  it('counts the best whole finalized answer and uses newest acceptance for a tie', async () => {
    const c = contextFixture(),
      a = acceptance(1, 1, '2'),
      b = acceptance(1, 2, '2');
    const eventsA = [eventFixture(c, a, 'functional', 1), eventFixture(c, a, 'primary', 2, 0)];
    const eventsB = [eventFixture(c, b, 'functional', 1), eventFixture(c, b, 'primary', 2, 0)];
    const context = { ...c, acceptances: [a, b] },
      fake = reviewClient(context, [
        historyFixture(context, a, eventsA),
        historyFixture(context, b, eventsB),
      ]);
    const result = await createScoredExamReviewService({
      client: fake.client,
      bodyPolicy: policy,
    }).read(id(101), id(3));
    expect(result.score.questions[0]).toMatchObject({ points: 13, submissionId: b.submissionId });
  });
  it('rejects cross-scope history or drift of the captured revision vector', async () => {
    const c = contextFixture(),
      a = acceptance(1),
      context = { ...c, acceptances: [a] },
      history = historyFixture(context, a);
    const wrong = reviewClient(context, [{ ...history, cohortId: id(20) }]);
    await expect(
      createScoredExamReviewService({ client: wrong.client, bodyPolicy: policy }).read(
        id(101),
        id(3),
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
    const drift = reviewClient(context, [history], {
      context: (n) => (n === 1 ? context : { ...context, acceptances: [{ ...a, revision: '1' }] }),
    });
    await expect(
      createScoredExamReviewService({ client: drift.client, bodyPolicy: policy }).read(
        id(101),
        id(3),
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});
describe('assigned mentor write service', () => {
  it('keeps rollover GET available and permits the assigned replacement secondary review with CAS', async () => {
    const original = contextFixture(),
      a = acceptance(1, 1, '4');
    const p2 = eventFixture(original, a, 'primary', 2, 0),
      p4 = eventFixture(original, a, 'primary', 4, 2);
    const events = [
      eventFixture(original, a, 'functional', 1),
      p2,
      eventFixture(original, a, 'secondary', 3, 0, p2.eventId),
      p4,
    ];
    const context = { ...original, authUserId: id(102), actorUserId: id(5), acceptances: [a] };
    const fake = reviewClient(context, [historyFixture(context, a, events)]),
      service = createScoredExamReviewService({ client: fake.client, bodyPolicy: policy });
    expect((await service.read(id(102), id(3))).score.status).toBe('provisional');
    const replacement = {
      ...reviewBody(context),
      review: 'secondary',
      write: { operationId: id(701), submissionId: a.submissionId, expectedRevision: '4' },
      payload: { ...reviewBody(context).payload, primaryEventId: p4.eventId },
    };
    expect(await service.review(id(102), replacement)).toMatchObject({
      kind: 'recorded',
      revision: '5',
    });
    const write = [...fake.calls].reverse().find((c) => c.sql === RECORD_EXAM_SCORING_EVENT_SQL)!;
    expect(write.parameters.slice(0, 5)).toEqual([
      id(102),
      id(701),
      a.submissionId,
      '4',
      'secondary',
    ]);
    expect(JSON.parse(String(write.parameters[5])).primaryEventId).toBe(p4.eventId);
  });
  it('does not post a review until the learner completes the exam or server deadline passes', async () => {
    const c = { ...contextFixture(), completion: null, acceptances: [acceptance(1)] },
      fake = reviewClient(c);
    expect(
      await createScoredExamReviewService({ client: fake.client, bodyPolicy: policy }).review(
        id(101),
        reviewBody(c),
      ),
    ).toEqual({ kind: 'review_not_open' });
    expect(fake.calls.some((x) => x.sql === RECORD_EXAM_SCORING_EVENT_SQL)).toBe(false);
  });
  it('preserves the original operation/revision and posts only the primary RPC event', async () => {
    const c = { ...contextFixture(), acceptances: [acceptance(1, 1, '3')] },
      fake = reviewClient(c);
    const body = reviewBody(c);
    const result = await createScoredExamReviewService({
      client: fake.client,
      bodyPolicy: policy,
    }).review(id(101), body);
    expect(result.kind).toBe('recorded');
    const call = fake.calls.find((x) => x.sql === RECORD_EXAM_SCORING_EVENT_SQL)!;
    expect(call.parameters.slice(0, 5)).toEqual([id(101), id(700), id(1001), '0', 'primary']);
  });
  it('does not auto-retry an ambiguous write', async () => {
    const c = { ...contextFixture(), acceptances: [acceptance(1)] };
    const fake = reviewClient(c, [], {
      record: () => {
        throw new Error('transport ended');
      },
    });
    await expect(
      createScoredExamReviewService({ client: fake.client, bodyPolicy: policy }).review(
        id(101),
        reviewBody(c),
      ),
    ).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(fake.calls.filter((x) => x.sql === RECORD_EXAM_SCORING_EVENT_SQL)).toHaveLength(1);
  });
  it('rejects changed answer binding, self/escalated kind and wrong reviewer before writing', async () => {
    const c = { ...contextFixture(), acceptances: [acceptance(1)] },
      fake = reviewClient(c),
      service = createScoredExamReviewService({ client: fake.client, bodyPolicy: policy });
    const body = reviewBody(c);
    expect(
      await service.review(id(101), {
        ...body,
        payload: { ...body.payload, answerSha256: hash('0') },
      }),
    ).toEqual({ kind: 'conflict' });
    await expect(service.review(id(101), { ...body, review: 'functional' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(service.review(id(101), { ...body, actorUserId: id(4) })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      service.review(id(101), {
        ...body,
        review: 'secondary',
        payload: { ...body.payload, primaryEventId: id(11) },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(fake.calls.some((x) => x.sql === RECORD_EXAM_SCORING_EVENT_SQL)).toBe(false);
  });
  it('has no default activation, client or numeric transport policy', () => {
    const client = vi.fn(() => reviewClient(contextFixture()).client);
    for (const env of [
      {},
      { NEXTERA_SCORED_EXAM_REVIEW_V1: '1' },
      {
        NEXTERA_SCORED_EXAM_REVIEW_V1: '1',
        NEXTERA_SCORED_EXAM_REVIEW_POLICY: JSON.stringify({ ...policy, maxBodyBytes: 0 }),
      },
      {
        NEXTERA_SCORED_EXAM_REVIEW_V1: '1',
        NEXTERA_SCORED_EXAM_REVIEW_POLICY: JSON.stringify({ ...policy, extra: true }),
      },
    ])
      expect(configuredScoredExamReviewService(client, env)).toBeNull();
    expect(client).not.toHaveBeenCalled();
    expect(
      configuredScoredExamReviewService(client, {
        NEXTERA_SCORED_EXAM_REVIEW_V1: '1',
        NEXTERA_SCORED_EXAM_REVIEW_POLICY: JSON.stringify(policy),
      }),
    ).not.toBeNull();
    expect(client).toHaveBeenCalledOnce();
  });
});

describe('assigned answer inspection service', () => {
  it('offers validated snapshots without adjudication for the separate native outcome ledger', async () => {
    const context = contextFixture(),
      fake = reviewClient(context);
    const result = await createScoredExamReviewService({
      client: fake.client,
      bodyPolicy: policy,
    }).readForOutcome(id(101), id(3));
    expect(result.snapshot.attempt).toEqual(context.attempt);
    expect(Object.hasOwn(result.snapshot, 'adjudication')).toBe(false);
  });
  it('returns structured exact text only after an assignment recheck and denies code when no private port exists', async () => {
    const trace = reviewAnswerFixture('trace_with_reason'),
      fake = reviewClient(contextFixture(), [], { answer: () => trace.answer });
    const service = createScoredExamReviewService({ client: fake.client, bodyPolicy: policy });
    expect(await service.readAnswer(id(101), id(3), id(1001))).toMatchObject({
      kind: 'trace_with_reason',
      answer: JSON.parse(trace.text),
    });
    expect(fake.calls).toHaveLength(2);
    const code = reviewAnswerFixture(),
      unavailable = createScoredExamReviewService({
        client: reviewClient(contextFixture(), [], { answer: () => code.answer }).client,
        bodyPolicy: policy,
      });
    await expect(unavailable.readAnswer(id(101), id(3), id(1001))).rejects.toThrow(
      'SCORED_EXAM_REVIEW_ARTIFACT_UNAVAILABLE',
    );
  });
  it('does not return fetched code after access is revoked', async () => {
    const f = reviewAnswerFixture();
    let reads = 0;
    const fake = reviewClient(contextFixture(), [], {
      answer: () => {
        if (++reads > 1) throw Object.assign(new Error('revoked'), { code: '42501' });
        return f.answer;
      },
    });
    const port = { read: vi.fn(async () => new Uint8Array(f.bytes)) };
    const service = createScoredExamReviewService({
      client: fake.client,
      bodyPolicy: policy,
      artifactReader: port,
    });
    await expect(service.readAnswer(id(101), id(3), id(1001))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(port.read).toHaveBeenCalledOnce();
  });
});
