import { beforeEach, expect, it, vi } from 'vitest';
import { AccessDenied } from '@nextera/domain';
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  db: vi.fn(),
  read: vi.fn(),
  review: vi.fn(),
  assign: vi.fn(),
}));
vi.mock('../auth/server', () => ({ requireDomainUser: mocks.user, getDatabase: mocks.db }));
vi.mock('@nextera/db/raids', () => ({
  readRaid: mocks.read,
  reviewRaid: mocks.review,
  assignRaidTeam: mocks.assign,
}));
import { GET, POST } from '../../app/api/raids/route';
const id = '10000000-0000-4000-8000-000000000001';
const user = {
  id,
  authUserId: '10000000-0000-4000-8000-000000000002',
  displayName: 'Test',
  active: true,
  role: 'learner',
};
const body = {
  action: 'review',
  attempt: id,
  requestId: id,
  decision: 'approved',
  feedback: 'Reviewed exact file',
};
const post = (data: unknown = body, origin = 'http://localhost') =>
  new Request('http://localhost/api/raids', {
    method: 'POST',
    headers: { Host: 'localhost', Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(user);
  mocks.db.mockReturnValue({});
  mocks.read.mockResolvedValue({ team: null, attempts: [], can_submit: false, can_review: false });
  mocks.review.mockResolvedValue({ review_id: id, outcome_id: id });
});
it('rejects cross-origin mutation before reading identity or database', async () => {
  expect((await POST(post(body, 'https://other.invalid'))).status).toBe(403);
  expect(mocks.user).not.toHaveBeenCalled();
});
it('keeps unauthenticated requests unauthorized', async () => {
  mocks.user.mockRejectedValue(new AccessDenied('UNAUTHENTICATED'));
  expect((await POST(post())).status).toBe(401);
  expect(mocks.review).not.toHaveBeenCalled();
});
it('does not let a learner approve or assign through the API', async () => {
  expect((await POST(post())).status).toBe(403);
  expect((await POST(post({ ...body, action: 'assign' }))).status).toBe(403);
  expect(mocks.review).not.toHaveBeenCalled();
  expect(mocks.assign).not.toHaveBeenCalled();
});
it('passes only verified Auth identity and exact review intent, not browser-provided roster/progress', async () => {
  mocks.user.mockResolvedValue({ ...user, role: 'operator' });
  const response = await POST(
    post({ ...body, members: ['forged'], outcome_id: 'forged', unlocked: ['forged'] }),
  );
  expect(response.status).toBe(200);
  expect(mocks.review).toHaveBeenCalledWith({}, user.authUserId, {
    attempt: id,
    requestId: id,
    decision: 'approved',
    feedback: 'Reviewed exact file',
  });
});
it('reports owner hold as blocked rather than review/completion success', async () => {
  mocks.user.mockResolvedValue({ ...user, role: 'operator' });
  mocks.review.mockResolvedValue({ status: 'owner_decision_required' });
  const response = await POST(post());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ status: 'owner_decision_required' });
});
it('preserves wrapped database permission denial without exposing private details', async () => {
  mocks.user.mockResolvedValue({ ...user, role: 'operator' });
  mocks.review.mockRejectedValue(
    new Error('private', { cause: { code: '42501', message: 'private' } }),
  );
  const response = await POST(post());
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'FORBIDDEN' });
});
it('rejects oversized JSON before a mutation', async () => {
  mocks.user.mockResolvedValue({ ...user, role: 'operator' });
  expect((await POST(post({ ...body, feedback: 'x'.repeat(9000) }))).status).toBe(413);
  expect(mocks.review).not.toHaveBeenCalled();
});
it('validates GET context and avoids caching shared private records', async () => {
  const response = await GET(new Request(`http://localhost/api/raids?cohort=${id}&node=raid`));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(mocks.read).toHaveBeenCalledWith({}, user.authUserId, id, 'raid', undefined);
  expect((await GET(new Request('http://localhost/api/raids?cohort=wrong&node=raid'))).status).toBe(
    400,
  );
});
it('rejects invalid roster count even for the owner before SQL', async () => {
  mocks.user.mockResolvedValue({ ...user, role: 'admin' });
  const response = await POST(
    post({
      action: 'assign',
      cohort: id,
      node: 'raid',
      name: 'Team',
      mentor: id,
      members: [id, id],
      requestId: id,
    }),
  );
  expect(response.status).toBe(400);
  expect(mocks.assign).not.toHaveBeenCalled();
});
