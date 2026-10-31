import { describe, expect, it, vi } from 'vitest';
import {
  readScoredExamReviewContext,
  READ_SCORED_EXAM_REVIEW_CONTEXT_SQL,
  readScoredExamReviewAnswer,
  verifyScoredExamReviewWriteCapability,
  SCORED_EXAM_REVIEW_WRITE_CAPABILITY_SQL,
  type ScoredExamReviewClient,
} from '../queries/scored-exam-review-context';
import {
  acceptance,
  contextFixture,
  hash,
  id,
  reviewAnswerFixture,
  reviewClient,
} from './scored-exam-review-fixture';
const client = (value: unknown) =>
  ({ unsafe: vi.fn(async () => [{ data: value }]) }) as unknown as ScoredExamReviewClient;
function set(value: unknown, path: readonly (string | number)[], replacement: unknown) {
  let object = value as Record<string, unknown>;
  for (const key of path.slice(0, -1)) object = object[String(key)] as Record<string, unknown>;
  object[String(path.at(-1))] = replacement;
}
const malformed: readonly [string, readonly (string | number)[], unknown][] = [
  ['wrong authenticated identity', ['authUserId'], id(9)],
  ['wrong attempt', ['attempt', 'scope', 'attemptId'], id(9)],
  ['legacy duration', ['attempt', 'deadlineAtMicros'], '5401000000'],
  ['unassigned admin', ['actorUserId'], id(9)],
  ['self mentor', ['actorUserId'], id(1)],
  ['learner alias for staff', ['access'], 'learner'],
  ['wrong rubric digest', ['rubric', 'digest'], hash('0')],
  ['changed published weight', ['rubric', 'questions', 0, 'functionalGroups', 0, 'points'], 12],
  ['changed mentor assignment', ['assignment', 'eligibleMentorIds', 1], id(9)],
  ['clock before start', ['serverNowMicros'], '1'],
  ['invented adjudication', ['adjudication'], {}],
  ['unknown projection field', ['role'], 'admin'],
];
describe('configured authoritative scored exam context reader', () => {
  it('binds exact auth/attempt, frozen hashes, assignment and microsecond window', async () => {
    const c = contextFixture(),
      db = client(c);
    const result = await readScoredExamReviewContext(db, c.authUserId, c.attempt.scope.attemptId);
    expect(result).toEqual(c);
    expect(Object.isFrozen(result.assignment)).toBe(true);
    expect(db.unsafe).toHaveBeenCalledWith(READ_SCORED_EXAM_REVIEW_CONTEXT_SQL, [
      c.authUserId,
      c.attempt.scope.attemptId,
    ]);
  });
  it('permits only learner-self in the explicitly learner read projection', async () => {
    const c = { ...contextFixture(), actorUserId: id(1), access: 'learner' as const };
    expect((await readScoredExamReviewContext(client(c), c.authUserId, id(3))).access).toBe(
      'learner',
    );
  });
  it.each(malformed)('rejects %s', async (_, path, replacement) => {
    const c = structuredClone(contextFixture());
    set(c, path, replacement);
    await expect(readScoredExamReviewContext(client(c), id(101), id(3))).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it('binds acceptance IDs, clocks, positive order, question kind and exact revision', async () => {
    const c = { ...contextFixture(), acceptances: [acceptance(1, 1, '4')] };
    expect(
      (await readScoredExamReviewContext(client(c), id(101), id(3))).acceptances[0]?.revision,
    ).toBe('4');
    for (const change of [
      { acceptedOrdinal: '0' },
      { acceptedAtMicros: '2000001' },
      { answerKind: 'trace_with_reason' },
      { revision: '01' },
      { answerSha256: 'invalid' },
    ]) {
      await expect(
        readScoredExamReviewContext(
          client({ ...c, acceptances: [{ ...c.acceptances[0], ...change }] }),
          id(101),
          id(3),
        ),
      ).rejects.toMatchObject({ code: 'unavailable' });
    }
    await expect(
      readScoredExamReviewContext(
        client({ ...c, acceptances: [...c.acceptances, ...c.acceptances] }),
        id(101),
        id(3),
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('does not execute accessor fields', async () => {
    const c = contextFixture(),
      getter = vi.fn(() => 1);
    Object.defineProperty(c, 'version', { enumerable: true, get: getter });
    await expect(readScoredExamReviewContext(client(c), id(101), id(3))).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(getter).not.toHaveBeenCalled();
  });
  it('invalid input performs no SQL and SQL authority denial stays forbidden', async () => {
    const db = client(contextFixture());
    await expect(readScoredExamReviewContext(db, 'wrong', id(3))).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(db.unsafe).not.toHaveBeenCalled();
    const denied = {
      unsafe: vi.fn(async () => {
        throw Object.assign(new Error('not retained'), { code: '42501' });
      }),
    } as unknown as ScoredExamReviewClient;
    await expect(readScoredExamReviewContext(denied, id(101), id(3))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('assigned immutable answer reader and existing ACL readiness', () => {
  it('requires the exact native catalog proof before writes, never grants a role', async () => {
    const good = reviewClient(contextFixture());
    await expect(verifyScoredExamReviewWriteCapability(good.client)).resolves.toBeUndefined();
    expect(good.calls[0]?.sql).toBe(SCORED_EXAM_REVIEW_WRITE_CAPABILITY_SQL);
    expect(SCORED_EXAM_REVIEW_WRITE_CAPABILITY_SQL).not.toMatch(
      /\b(?:GRANT|SET ROLE|CREATE ROLE)\b/,
    );
    await expect(
      verifyScoredExamReviewWriteCapability(
        reviewClient(contextFixture(), [], { capability: false }).client,
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
  it.each(['coding', 'trace_with_reason', 'debug_with_reason'] as const)(
    'binds %s answers to exact actor/attempt/submission and immutable bytes',
    async (kind) => {
      const f = reviewAnswerFixture(kind),
        fake = reviewClient(contextFixture(), [], { answer: () => f.answer });
      expect(await readScoredExamReviewAnswer(fake.client, id(101), id(3), id(1001))).toEqual(
        f.answer,
      );
    },
  );
  it('rejects changed actor scope, path traversal, bytes or contract without returning content', async () => {
    const f = reviewAnswerFixture(),
      bad = {
        ...f.answer,
        source: {
          kind: 'stored_source',
          bucket: 'nextera-submissions',
          objectKey: '../other',
          filename: 'f.go',
        },
      };
    await expect(
      readScoredExamReviewAnswer(
        reviewClient(contextFixture(), [], { answer: () => bad }).client,
        id(101),
        id(3),
        id(1001),
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
    const trace = reviewAnswerFixture('trace_with_reason');
    await expect(
      readScoredExamReviewAnswer(
        reviewClient(contextFixture(), [], {
          answer: () => ({ ...trace.answer, answerSha256: hash('0') }),
        }).client,
        id(101),
        id(3),
        id(1001),
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('assigned seven-segment scored code artifact scope', () => {
  it('accepts the exact scored key while preserving immutable legacy receipts', async () => {
    const f = reviewAnswerFixture();
    const key = `${f.answer.ownerAuthUserId}/${f.answer.cohortId}/scored-exam-v1/${f.answer.attemptId}/${f.answer.questionKey}/${f.answer.requestId}/${f.answer.answerSha256}`;
    const answer = {
      ...f.answer,
      source: {
        kind: 'stored_source',
        bucket: 'nextera-submissions',
        filename: 'f.go',
        objectKey: key,
      },
    };
    const loaded = await readScoredExamReviewAnswer(
      reviewClient(contextFixture(), [], { answer: () => answer }).client,
      id(101),
      id(3),
      id(1001),
    );
    expect(loaded.source).toEqual(answer.source);
    expect(
      await readScoredExamReviewAnswer(
        reviewClient(contextFixture(), [], { answer: () => f.answer }).client,
        id(101),
        id(3),
        id(1001),
      ),
    ).toEqual(f.answer);
  });
  it.each(['attempt', 'task', 'extra', 'namespace', 'owner', 'hash'])(
    'rejects %s mismatch in the scored artifact key',
    async (fault) => {
      const f = reviewAnswerFixture();
      const parts = [
        f.answer.ownerAuthUserId,
        f.answer.cohortId,
        'scored-exam-v1',
        f.answer.attemptId,
        f.answer.questionKey,
        f.answer.requestId,
        f.answer.answerSha256,
      ];
      if (fault === 'attempt') parts[3] = id(99);
      else if (fault === 'task') parts[4] = 'q2';
      else if (fault === 'extra') parts.push('extra');
      else if (fault === 'namespace') parts[2] = 'scored-exam-v2';
      else if (fault === 'owner') parts[0] = id(99);
      else parts[6] = hash('f');
      const answer = {
        ...f.answer,
        source: {
          kind: 'stored_source',
          bucket: 'nextera-submissions',
          filename: 'f.go',
          objectKey: parts.join('/'),
        },
      };
      await expect(
        readScoredExamReviewAnswer(
          reviewClient(contextFixture(), [], { answer: () => answer }).client,
          id(101),
          id(3),
          id(1001),
        ),
      ).rejects.toMatchObject({ code: 'unavailable' });
    },
  );
});
