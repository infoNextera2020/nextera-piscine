import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { createScoredExamReviewService } from '../apps/web/lib/checkpoints/scored-exam-review-service';
import {
  examScoringEventDigest,
  type ExamScoringStoredEvent,
} from '../packages/db/queries/exam-scoring-review';
import {
  acceptance,
  contextFixture,
  eventFixture,
  historyFixture,
  id,
  reviewAnswerFixture,
  reviewClient,
} from '../packages/db/tests/scored-exam-review-fixture';
import type { MentorReviewCommand } from '../apps/web/components/operator/scored-exam-review-contract';
import type { ExamAnswerKind } from '@nextera/domain';
import type {
  ScoredExamReviewAnswer,
  ScoredExamReviewContext,
} from '../packages/db/queries/scored-exam-review-context';
import type { ExamScoringHistory } from '../packages/db/queries/exam-scoring-review';
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Synthetic SQL/HTTP doubles only. No account, assignment or native persistence exists. */
export function scoringFixture(
  kind: ExamAnswerKind = 'coding',
  options: { secondary?: boolean; source?: string } = {},
) {
  const fixture = reviewAnswerFixture(kind);
  const text = options.source ?? fixture.text;
  const answer = structuredClone(fixture.answer) as Mutable<ScoredExamReviewAnswer>;
  answer.answerSha256 = createHash('sha256').update(text).digest('hex');
  answer.byteLength = Buffer.byteLength(text);
  if (answer.source.kind === 'structured_payload')
    answer.source = { ...answer.source, payloadBase64: Buffer.from(text).toString('base64') };
  else
    answer.source = {
      ...answer.source,
      objectKey: answer.source.objectKey
        .split('/')
        .slice(0, -1)
        .concat(answer.answerSha256)
        .join('/'),
    };
  const context = contextFixture() as Mutable<ScoredExamReviewContext>;
  if (options.secondary) {
    context.authUserId = id(102);
    context.actorUserId = id(5);
    answer.authUserId = id(102);
    answer.actorUserId = id(5);
  }
  const ordinal = kind === 'coding' ? 1 : kind === 'trace_with_reason' ? 6 : 8;
  const accepted = { ...acceptance(ordinal, 1, '1'), answerSha256: answer.answerSha256 };
  const history = historyFixture(context, accepted, [
    eventFixture(context, accepted, 'functional', 1),
  ]) as Mutable<ExamScoringHistory>;
  if (options.secondary) {
    history.events = [...history.events, eventFixture(context, accepted, 'primary', 2)];
    history.revision = accepted.revision = '2';
  }
  context.acceptances = [accepted];
  const metadata = async () => service().read(context.authUserId, context.attempt.scope.attemptId);
  function service() {
    return createScoredExamReviewService({
      client: reviewClient(context, [history], { answer: () => answer }).client,
      bodyPolicy: { version: 1, maxBodyBytes: 4096, bodyTimeoutMs: 1000 },
      artifactReader: { read: async () => new TextEncoder().encode(text) },
    });
  }
  const receipts = new Map<
    string,
    { packet: MentorReviewCommand; event: ExamScoringStoredEvent }
  >();
  function commit(packet: MentorReviewCommand) {
    const old = receipts.get(packet.write.operationId);
    if (old && JSON.stringify(old.packet) !== JSON.stringify(packet))
      throw Error('CONFLICTING_TEST_OPERATION');
    const event: ExamScoringStoredEvent = old?.event ?? {
      eventId: id(900 + receipts.size),
      operationId: packet.write.operationId,
      revision: String(BigInt(packet.write.expectedRevision) + 1n),
      eventKind: packet.review,
      actorUserId: context.actorUserId,
      payload: packet.payload,
      payloadDigest: examScoringEventDigest(packet.payload),
    };
    if (!old) {
      receipts.set(packet.write.operationId, { packet: structuredClone(packet), event });
      history.events = [...history.events, event];
      history.revision = accepted.revision = event.revision;
    }
    return {
      kind: 'recorded',
      eventId: event.eventId,
      operationId: event.operationId,
      submissionId: accepted.submissionId,
      revision: event.revision,
      payloadDigest: event.payloadDigest,
      replayed: !!old,
    };
  }
  return {
    context,
    accepted,
    answer,
    history,
    text,
    service,
    metadata,
    commit,
    receipts,
    identity: {
      authUserId: context.authUserId,
      actorUserId: context.actorUserId,
      attemptId: context.attempt.scope.attemptId,
    },
    submissionId: accepted.submissionId,
  };
}
export async function scoringHttp(
  kind: ExamAnswerKind = 'coding',
  options: Parameters<typeof scoringFixture>[1] = {},
) {
  const f = scoringFixture(kind, options);
  const calls: { url: string; init?: RequestInit; body?: MentorReviewCommand }[] = [];
  const changed = vi.fn(),
    removed = vi.fn();
  let operation = 700;
  let post: ((packet: MentorReviewCommand) => Promise<Response>) | null = null;
  let get: (() => Promise<Response>) | null = null;
  const send: typeof fetch = async (input, init) => {
    const url = String(input),
      packet =
        init?.method === 'POST'
          ? (JSON.parse(String(init.body)) as MentorReviewCommand)
          : undefined;
    calls.push({ url, ...(init ? { init } : {}), ...(packet ? { body: packet } : {}) });
    if (packet) return post ? post(packet) : Response.json(f.commit(packet), { status: 202 });
    if (url.includes('submission='))
      return Response.json(
        await f.service().readAnswer(f.identity.authUserId, f.identity.attemptId, f.submissionId),
      );
    return get ? get() : Response.json(await f.metadata());
  };
  return {
    ...f,
    calls,
    changed,
    removed,
    send,
    operationId: () => id(operation++),
    post: (handler: typeof post) => {
      post = handler;
    },
    get: (handler: typeof get) => {
      get = handler;
    },
  };
}
export { id };
