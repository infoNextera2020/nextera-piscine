import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../apps/web/node_modules/server-only', () => ({}));
const auth = vi.hoisted(() => ({ authenticate: vi.fn(), database: vi.fn() }));
vi.mock('../apps/web/lib/auth/server', () => ({
  requireDomainUser: auth.authenticate,
  getDatabase: auth.database,
}));
import {
  createAssignedScoredExamReviewLoader,
  loadAssignedScoredExamReview,
} from '../apps/web/components/operator/scored-exam-review-loader';
import { scoringFixture, id } from './operator-scoring-fixture';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const user = (role: 'operator' | 'admin' | 'learner' = 'operator') => ({
  id: id(4),
  authUserId: id(101),
  displayName: 'Synthetic mentor',
  active: true,
  role,
});
describe('unmounted protected exact-attempt mentor loader', () => {
  it.each(['coding', 'trace_with_reason', 'debug_with_reason'] as const)(
    'loads assigned %s metadata/history and verified exact answer through existing service',
    async (kind) => {
      const f = scoringFixture(kind),
        authenticate = vi.fn(async () => user()),
        service = f.service();
      const readAnswer = vi.fn(service.readAnswer),
        factory = vi.fn(() => ({ ...service, readAnswer }));
      const load = createAssignedScoredExamReviewLoader({ authenticate, review: factory });
      expect(authenticate).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
      const result = await load({ attemptId: f.identity.attemptId, submissionId: f.submissionId });
      expect(result.kind).toBe('available');
      if (result.kind !== 'available') throw Error('Test metadata unavailable');
      expect(result.identity).toEqual(f.identity);
      expect(result.snapshot.context.access).toBe('assigned_mentor');
      expect(result.snapshot.histories[0]?.revision).toBe('1');
      expect(result.answer?.kind).toBe(kind);
      expect(result.snapshot.persistedOutcome).toBeNull();
      expect(readAnswer).toHaveBeenCalledWith(
        f.identity.authUserId,
        f.identity.attemptId,
        f.submissionId,
        undefined,
      );
    },
  );
  it('authorizes the existing staff role before constructing any service or protected read', async () => {
    const review = vi.fn();
    expect(
      await createAssignedScoredExamReviewLoader({
        authenticate: async () => user('learner'),
        review,
      })({ attemptId: id(3) }),
    ).toEqual({ kind: 'forbidden' });
    expect(review).not.toHaveBeenCalled();
  });
  it.each(['operator', 'admin'] as const)(
    'does not let %s role substitute for native mentor assignment',
    async (role) => {
      const f = scoringFixture();
      f.context.access = 'learner';
      f.context.actorUserId = id(1);
      f.context.authUserId = id(100);
      const service = f.service(),
        readAnswer = vi.fn(service.readAnswer);
      const result = await createAssignedScoredExamReviewLoader({
        authenticate: async () => ({ ...user(role), id: id(1), authUserId: id(100) }),
        review: () => ({ ...service, readAnswer }),
      })({ attemptId: id(3), submissionId: f.submissionId });
      expect(result).toEqual({ kind: 'forbidden' });
      expect(readAnswer).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid selection or attempted policy fields without authenticating or enumerating a queue', async () => {
    const authenticate = vi.fn(),
      review = vi.fn();
    const load = createAssignedScoredExamReviewLoader({ authenticate, review });
    for (const input of [
      { attemptId: 'missing' },
      { attemptId: id(3), submissionId: 'wrong' },
      { attemptId: id(3), role: 'admin' },
    ])
      expect(await load(input)).toEqual({ kind: 'invalid_input' });
    let accessed = false;
    const getter = Object.defineProperty({}, 'attemptId', {
      enumerable: true,
      get: () => {
        accessed = true;
        return id(3);
      },
    });
    expect(await load(getter as never)).toEqual({ kind: 'invalid_input' });
    expect(accessed).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });
  it('binds the exact selection before authentication resolves', async () => {
    const f = scoringFixture(),
      service = f.service();
    let resolve!: (value: ReturnType<typeof user>) => void;
    const authenticate = () =>
      new Promise<ReturnType<typeof user>>((done) => {
        resolve = done;
      });
    const read = vi.fn(service.read),
      input = { attemptId: id(3) };
    const loading = createAssignedScoredExamReviewLoader({
      authenticate,
      review: () => ({ ...service, read }),
    })(input);
    input.attemptId = id(999);
    resolve(user());
    expect((await loading).kind).toBe('available');
    expect(read).toHaveBeenCalledWith(id(101), id(3));
  });
  it('rejects an unlisted submission before any protected answer read', async () => {
    const f = scoringFixture(),
      service = f.service(),
      readAnswer = vi.fn(service.readAnswer);
    const load = createAssignedScoredExamReviewLoader({
      authenticate: async () => user(),
      review: () => ({ ...service, readAnswer }),
    });
    expect(await load({ attemptId: id(3), submissionId: id(999) })).toEqual({ kind: 'forbidden' });
    expect(readAnswer).not.toHaveBeenCalled();
  });
  it('keeps official answer reading unavailable before closure or when its native capability is absent', async () => {
    for (const open of [true, false]) {
      const f = scoringFixture();
      if (open) f.context.completion = null;
      const service = f.service(),
        readAnswer = vi.fn(service.readAnswer);
      const load = createAssignedScoredExamReviewLoader({
        authenticate: async () => user(),
        review: () => ({
          ...service,
          readAnswer,
          read: async (...args) => ({
            ...(await service.read(...args)),
            answerReadAvailable: false,
          }),
        }),
      });
      expect(await load({ attemptId: id(3), submissionId: f.submissionId })).toEqual({
        kind: 'unavailable',
      });
      expect(readAnswer).not.toHaveBeenCalled();
    }
  });
  it('hides all protected output after cancellation or an answer binding mismatch', async () => {
    const f = scoringFixture(),
      service = f.service(),
      controller = new AbortController();
    const load = createAssignedScoredExamReviewLoader({
      authenticate: async () => user(),
      review: () => ({
        ...service,
        read: async (...args) => {
          const value = await service.read(...args);
          controller.abort();
          return value;
        },
      }),
    });
    expect(await load({ attemptId: id(3) }, controller.signal)).toEqual({ kind: 'unavailable' });
    const bad = createAssignedScoredExamReviewLoader({
      authenticate: async () => user(),
      review: () => ({
        ...service,
        readAnswer: async (...args) => ({
          ...(await service.readAnswer(...args)),
          binding: { ...(await service.readAnswer(...args)).binding, submissionId: id(999) },
        }),
      }),
    });
    expect(await bad({ attemptId: id(3), submissionId: f.submissionId })).toEqual({
      kind: 'unavailable',
    });
  });
  it('does not treat an unattested persistence flag as an actual finalized outcome', async () => {
    const f = scoringFixture(),
      service = f.service();
    const load = createAssignedScoredExamReviewLoader({
      authenticate: async () => user(),
      review: () => ({
        ...service,
        read: async (...args) =>
          ({ ...(await service.read(...args)), finalOutcomePersisted: true }) as never,
      }),
    });
    expect(await load({ attemptId: id(3) })).toEqual({ kind: 'unavailable' });
  });
  it('requires configured outcomes to be readable instead of falling back to a provisional result', async () => {
    const f = scoringFixture();
    const load = createAssignedScoredExamReviewLoader({
      authenticate: async () => user(),
      review: f.service,
      outcomes: () => null,
    });
    expect(await load({ attemptId: id(3) })).toEqual({ kind: 'unavailable' });
  });
  it('uses real configured loader without opening a database when review service is disabled', async () => {
    vi.stubEnv('NEXTERA_SCORED_EXAM_REVIEW_V1', '0');
    vi.stubEnv('NEXTERA_SCORED_EXAM_OUTCOMES_V1', '0');
    auth.authenticate.mockResolvedValue(user());
    expect(await loadAssignedScoredExamReview({ attemptId: id(3) })).toEqual({
      kind: 'unavailable',
    });
    expect(auth.database).not.toHaveBeenCalled();
  });
});
