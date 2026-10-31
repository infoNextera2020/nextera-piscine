import { describe, expect, it, vi } from 'vitest';
import { scoreExamAttempt } from '@nextera/domain';
vi.mock('server-only', () => ({}));
vi.mock('../apps/web/node_modules/server-only', () => ({}));
import { ScoredExamMentorReviewClient } from '../apps/web/components/operator/scored-exam-review-client';
import {
  captureMentorMarks,
  parseMentorReviewAnswer,
  parseMentorReviewSnapshot,
  type MentorReviewDraft,
} from '../apps/web/components/operator/scored-exam-review-contract';
import { scoringHttp, id } from './operator-scoring-fixture';

const draft = (kind = 'coding', secondary = false): MentorReviewDraft => ({
  review: secondary ? 'secondary' : 'primary',
  evidenceDigest: 'e'.repeat(64),
  marks:
    kind === 'coding'
      ? { contract: 2 }
      : kind === 'trace_with_reason'
        ? { reason: 2 }
        : { counterexample: 4, explanation: 2 },
});
async function ready(kind: 'coding' | 'trace_with_reason' | 'debug_with_reason' = 'coding') {
  const f = await scoringHttp(kind);
  const client = new ScoredExamMentorReviewClient(f.identity, {
    send: f.send,
    operationId: f.operationId,
    changed: f.changed,
    accessRemoved: f.removed,
  });
  await client.load();
  await client.readAnswer(f.submissionId);
  client.editReview(f.submissionId, draft(kind));
  return { f, client };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe('unmounted assigned mentor client uses the real review wire contract', () => {
  it('rejects history regression after an acknowledged CAS write', async () => {
    const { f, client } = await ready();
    const stale = await f.metadata();
    f.get(async () => Response.json(stale));
    await client.record(f.submissionId);
    expect(client.getSnapshot().write.kind).toBe('recorded');
    expect(client.getSnapshot().fresh).toBe(false);
    expect(client.getSnapshot().phase).toBe('unavailable');
    expect(client.getCurrentPersistedOutcome()).toBeNull();
    f.get(null);
    await client.load();
    expect(client.getSnapshot().snapshot?.histories[0]?.revision).toBe('2');
    expect(client.getSnapshot().fresh).toBe(true);
  });
  it('exposes a current final outcome only from a fresh matching server proof', async () => {
    const { f, client } = await ready();
    await client.record(f.submissionId);
    const bundle = await f.service().readForOutcome(f.identity.authUserId, f.identity.attemptId);
    const raw = await f.metadata();
    const decision = {
      selection: raw.score.selection,
      priorFinalVerdict: null,
      proposedVerdict: 'failed' as const,
      disputed: false,
      initialThresholdReview: 'not_required' as const,
      affectedSubmissionIds: [],
    };
    const score = scoreExamAttempt({ ...bundle.snapshot, adjudication: decision });
    const projectionDigest = 'a'.repeat(64),
      adjudicationId = id(881);
    const final = {
      ...raw,
      score,
      finalOutcomePersisted: true,
      adjudicationPending: false,
      adjudication: { id: adjudicationId, current: true, projectionDigest, body: { decision } },
      currentOutcome: {
        id: id(882),
        revision: '1',
        verdict: score.status,
        totalPoints: score.totalPoints,
        codingPoints: score.codingPoints,
        projectionDigest,
        adjudicationId,
        resultDigest: 'b'.repeat(64),
        implementationDigest: 'c'.repeat(64),
        current: true,
      },
    };
    f.get(async () => Response.json(final));
    await client.load();
    expect(client.getCurrentPersistedOutcome()?.id).toBe(id(882));
    client.cancel();
    expect(client.getCurrentPersistedOutcome()).toBeNull();
    f.get(async () =>
      Response.json({ ...final, currentOutcome: { ...final.currentOutcome, current: false } }),
    );
    await client.load();
    expect(client.getCurrentPersistedOutcome()).toBeNull();
  });
  it('purges old protected records on a successful response for a different bound actor', async () => {
    const { f, client } = await ready(),
      raw = await f.metadata();
    f.get(async () => Response.json({ ...raw, context: { ...raw.context, actorUserId: id(99) } }));
    await client.load();
    expect(client.getSnapshot()).toMatchObject({
      phase: 'removed',
      snapshot: null,
      answers: {},
      drafts: {},
    });
    expect(f.removed).toHaveBeenCalledOnce();
  });
  it('ignores an older refresh rejection after a newer authorized refresh succeeds', async () => {
    const { f, client } = await ready(),
      held = deferred<Response>();
    f.get(() => held.promise);
    const old = client.load();
    f.get(null);
    await client.load();
    held.resolve(new Response(null, { status: 403 }));
    await old;
    expect(client.getSnapshot().phase).toBe('ready');
    expect(f.removed).not.toHaveBeenCalled();
  });

  it.each(['coding', 'trace_with_reason', 'debug_with_reason'] as const)(
    'reads and records exact %s marks without inventing a final outcome',
    async (kind) => {
      const { f, client } = await ready(kind);
      expect(client.getSnapshot().phase).toBe('ready');
      expect(client.getSnapshot().answers[f.submissionId]?.kind).toBe(kind);
      await client.record(f.submissionId);
      const state = client.getSnapshot();
      expect(state.write.kind).toBe('recorded');
      expect(state.fresh).toBe(true);
      expect(state.snapshot?.histories[0]?.revision).toBe('2');
      expect(state.snapshot?.histories[0]?.events.at(-1)?.eventKind).toBe('primary');
      expect(state.snapshot?.persistedOutcome).toBeNull();
      expect(client.getPendingCommand()).toBeNull();
      const call = f.calls.find((c) => c.init?.method === 'POST')!;
      expect(call.url).toBe('/api/mentor/checkpoints/scoring');
      expect(call.body).toEqual({
        version: 1,
        review: 'primary',
        attemptId: f.identity.attemptId,
        write: { operationId: id(700), submissionId: f.submissionId, expectedRevision: '1' },
        payload: {
          answerSha256: f.answer.answerSha256,
          rubricDigest: f.context.rubric.digest,
          assignmentDigest: f.context.assignment.digest,
          evidenceDigest: 'e'.repeat(64),
          marks: draft(kind).marks,
        },
      });
      expect(call.init).toMatchObject({
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
      });
      expect(f.calls.every((c) => c.url.startsWith('/api/mentor/checkpoints/scoring'))).toBe(true);
      client.dispose();
    },
  );
  it('keeps exact coding UTF8, BOM, CRLF, NUL and Unicode bytes through verification', async () => {
    const source = '\uFEFFfunc F() {}\r\n// café\u0000';
    const f = await scoringHttp('coding', { source });
    const metadata = await parseMentorReviewSnapshot(await f.metadata(), f.identity);
    const answer = await parseMentorReviewAnswer(
      await f.service().readAnswer(f.identity.authUserId, f.identity.attemptId, f.submissionId),
      metadata,
      f.submissionId,
    );
    expect(answer.kind === 'coding' && answer.source).toBe(source);
    const valid = answer as Extract<typeof answer, { kind: 'coding' }>;
    for (const changed of [source.replace('\r\n', '\n'), '\ud800', source + ' '])
      await expect(
        parseMentorReviewAnswer({ ...valid, source: changed }, metadata, f.submissionId),
      ).rejects.toThrow();
  });
  it('requires the verified exact accepted answer before any review write', async () => {
    const f = await scoringHttp();
    const client = new ScoredExamMentorReviewClient(f.identity, {
      send: f.send,
      operationId: f.operationId,
      changed: f.changed,
      accessRemoved: f.removed,
    });
    await client.load();
    client.editReview(f.submissionId, draft());
    await client.record(f.submissionId);
    await client.readAnswer(id(999));
    expect(f.calls.some((c) => c.init?.method === 'POST')).toBe(false);
    expect(f.calls.some((c) => c.url.includes('submission='))).toBe(false);
  });
  it('retries the original immutable operation/marks after lost acknowledgement and later edits', async () => {
    const { f, client } = await ready();
    let lost = true;
    f.post(async (packet) => {
      const receipt = f.commit(packet);
      if (lost) {
        lost = false;
        throw Error('lost acknowledgement');
      }
      return Response.json(receipt, { status: 202 });
    });
    await client.record(f.submissionId);
    const original = client.getPendingCommand();
    expect(client.getSnapshot().write.kind).toBe('uncertain');
    expect(client.getSnapshot().snapshot?.histories[0]?.revision).toBe('2');
    client.editReview(f.submissionId, { ...draft(), marks: { contract: 0 } });
    await client.record(f.submissionId);
    const sends = f.calls.filter((c) => c.body);
    expect(sends).toHaveLength(2);
    expect(sends[0]!.init?.body).toBe(sends[1]!.init?.body);
    expect(sends[1]!.body).toEqual(original);
    expect(f.receipts.size).toBe(1);
    expect(client.getSnapshot().drafts[f.submissionId]?.marks).toEqual({ contract: 0 });
    expect(client.getSnapshot().write).toMatchObject({
      kind: 'recorded',
      receipt: { replayed: true },
    });
  });
  it('does not silently rebase CAS conflicts or replace their operation', async () => {
    const { f, client } = await ready();
    f.post(async () => Response.json({ kind: 'stale_revision' }, { status: 412 }));
    await client.record(f.submissionId);
    const original = client.getPendingCommand();
    expect(client.getSnapshot().write.kind).toBe('conflict');
    await client.record(f.submissionId);
    expect(f.calls.filter((c) => c.body)).toHaveLength(1);
    expect(client.getPendingCommand()).toBe(original);
    client.acknowledgeFreshHistory();
    f.post(null);
    await client.record(f.submissionId);
    expect(f.calls.filter((c) => c.body)[1]!.body!.write.operationId).toBe(id(701));
  });
  it('records only the assigned independent reviewer against the latest primary event', async () => {
    const f = await scoringHttp('debug_with_reason', { secondary: true });
    const client = new ScoredExamMentorReviewClient(f.identity, {
      send: f.send,
      operationId: f.operationId,
      changed: f.changed,
      accessRemoved: f.removed,
    });
    await client.load();
    await client.readAnswer(f.submissionId);
    const primaryEventId = f.history.events.at(-1)!.eventId;
    client.editReview(f.submissionId, {
      ...draft('debug_with_reason', true),
      primaryEventId: id(999),
    });
    await client.record(f.submissionId);
    expect(f.calls.some((c) => c.body)).toBe(false);
    client.editReview(f.submissionId, { ...draft('debug_with_reason', true), primaryEventId });
    await client.record(f.submissionId);
    expect(f.calls.find((c) => c.body)?.body).toMatchObject({
      review: 'secondary',
      write: { expectedRevision: '2' },
      payload: { primaryEventId },
    });
  });
  it('blocks answer reads and review writes while intake is open', async () => {
    const f = await scoringHttp();
    f.context.completion = null;
    const client = new ScoredExamMentorReviewClient(f.identity, {
      send: f.send,
      operationId: f.operationId,
      changed: f.changed,
      accessRemoved: f.removed,
    });
    await client.load();
    await client.readAnswer(f.submissionId);
    client.editReview(f.submissionId, draft());
    await client.record(f.submissionId);
    expect(client.getSnapshot().snapshot?.score.status).toBe('in_progress');
    expect(f.calls).toHaveLength(1);
  });
  it('cancels transport without claiming that a possibly committed write was undone', async () => {
    const { f, client } = await ready();
    const held = deferred<Response>();
    let sent!: () => void;
    const started = new Promise<void>((resolve) => {
      sent = resolve;
    });
    f.post(async (packet) => {
      f.commit(packet);
      sent();
      return held.promise;
    });
    const recording = client.record(f.submissionId);
    await started;
    const original = client.getPendingCommand();
    client.editReview(f.submissionId, { ...draft(), marks: { contract: 0 } });
    client.cancel();
    held.resolve(Response.json({ kind: 'recorded' }, { status: 202 }));
    await recording;
    expect(client.getPendingCommand()).toBe(original);
    expect(client.getSnapshot().write.kind).toBe('uncertain');
    expect(client.getSnapshot().fresh).toBe(false);
    expect(client.getSnapshot().drafts[f.submissionId]?.marks).toEqual({ contract: 0 });
    await client.load();
    f.post(null);
    await client.record(f.submissionId);
    expect(f.calls.filter((c) => c.body)[1]!.body).toEqual(original);
  });
  it('clears protected records on current access loss and ignores late disposed-identity rejection', async () => {
    const { f, client } = await ready();
    f.get(async () => new Response(null, { status: 403 }));
    await client.load();
    expect(client.getSnapshot()).toMatchObject({
      phase: 'removed',
      snapshot: null,
      answers: {},
      drafts: {},
    });
    expect(f.removed).toHaveBeenCalledOnce();
    const second = await scoringHttp(),
      held = deferred<Response>();
    second.get(() => held.promise);
    const old = new ScoredExamMentorReviewClient(second.identity, {
      send: second.send,
      operationId: second.operationId,
      changed: second.changed,
      accessRemoved: second.removed,
    });
    const loading = old.load();
    old.dispose();
    const changes = second.changed.mock.calls.length;
    held.resolve(new Response(null, { status: 403 }));
    await loading;
    expect(second.removed).not.toHaveBeenCalled();
    expect(second.changed).toHaveBeenCalledTimes(changes);
    expect(old.getSnapshot().phase).toBe('disposed');
  });
  it('keeps transient refresh failure paused and cannot accept another actor or frozen answer hash', async () => {
    const { f, client } = await ready();
    f.get(async () => new Response(null, { status: 503 }));
    await client.load();
    await client.record(f.submissionId);
    expect(client.getSnapshot().fresh).toBe(false);
    expect(f.calls.some((c) => c.body)).toBe(false);
    const raw = await f.metadata();
    await expect(
      parseMentorReviewSnapshot(raw, { ...f.identity, actorUserId: id(99) }),
    ).rejects.toThrow();
    const bad = {
      ...raw,
      context: {
        ...raw.context,
        acceptances: [{ ...raw.context.acceptances[0]!, answerSha256: 'b'.repeat(64) }],
      },
    };
    await expect(parseMentorReviewSnapshot(bad, f.identity)).rejects.toThrow();
  });
  it('rejects malformed mark variants and bounds without inventing defaults', () => {
    for (const value of [
      { contract: -1 },
      { contract: 3 },
      { contract: 1.5 },
      { reason: 2 },
      { contract: '2' },
      { contract: 2, extra: true },
    ])
      expect(() => captureMentorMarks('coding', value)).toThrow();
    expect(() =>
      captureMentorMarks('debug_with_reason', { counterexample: 5, explanation: 0 }),
    ).toThrow();
    expect(() => captureMentorMarks('trace_with_reason', { reason: NaN })).toThrow();
    let accessed = false;
    expect(() =>
      captureMentorMarks(
        'coding',
        Object.defineProperty({}, 'contract', {
          enumerable: true,
          get: () => {
            accessed = true;
            return 2;
          },
        }),
      ),
    ).toThrow();
    expect(accessed).toBe(false);
  });
});
