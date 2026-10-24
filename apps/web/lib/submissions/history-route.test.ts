import { beforeEach, expect, it, vi } from 'vitest';
import { AccessDenied, type DomainUser } from '@nextera/domain';
const mocks = vi.hoisted(() => ({ user: vi.fn(), database: vi.fn(), read: vi.fn() }));
vi.mock('../auth/server', () => ({ requireDomainUser: mocks.user, getDatabase: mocks.database }));
vi.mock('@nextera/db/submissions', () => ({ readSubmissions: mocks.read }));
import { GET } from '../../app/api/submissions/history/route';

const cohort = '10000000-0000-4000-8000-000000000001';
const learner: DomainUser = {
  id: cohort,
  authUserId: '10000000-0000-4000-8000-000000000002',
  displayName: 'Learner',
  role: 'learner',
  active: true,
};
const request = (query = `cohort=${cohort}&node=hello-go`) =>
  new Request(`http://localhost/api/submissions/history?${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(learner);
  mocks.database.mockReturnValue({});
  mocks.read.mockResolvedValue([]);
});
it('passes the authenticated learner identity to the existing history query without caching', async () => {
  const rows = [{ id: 'receipt', state: 'queued', feedback: null }];
  mocks.read.mockResolvedValue(rows);
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual(rows);
  expect(mocks.read).toHaveBeenCalledWith({}, learner.authUserId, cohort, 'hello-go');
});
it('rejects malformed identifiers before the history query', async () => {
  const response = await GET(request('cohort=invalid&node=hello-go'));
  expect(response.status).toBe(400);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(mocks.read).not.toHaveBeenCalled();
});
it('keeps expired sessions unauthorized without opening the database', async () => {
  mocks.user.mockRejectedValue(new AccessDenied('UNAUTHENTICATED'));
  const response = await GET(request());
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'ACCESS_DENIED' });
  expect(mocks.database).not.toHaveBeenCalled();
});
it('retains role and database access denials', async () => {
  mocks.user.mockResolvedValue({ ...learner, role: 'operator' });
  expect((await GET(request())).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();
  mocks.user.mockResolvedValue(learner);
  mocks.read.mockRejectedValue({ code: '42501', message: 'private detail' });
  const response = await GET(request());
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'ACCESS_DENIED' });
});
it('reports a history infrastructure failure as unavailable without leaking its cause', async () => {
  mocks.read.mockRejectedValue(new Error('private database connection detail'));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ error: 'SUBMISSION_UNAVAILABLE' });
});
