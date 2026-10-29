import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RaidQueueItem } from '@nextera/db/raids';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  database: vi.fn(),
  queue: vi.fn(),
  read: vi.fn(),
}));
vi.mock('../apps/web/lib/auth/server', () => ({
  authorizePage: mocks.authorize,
  getDatabase: mocks.database,
}));
vi.mock('@nextera/db/raids', () => ({ readRaidQueue: mocks.queue, readRaid: mocks.read }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import OperatorPage from '../apps/web/app/operator/page';
import RaidReviewQueue from '../apps/web/app/operator/raids/page';

const team: RaidQueueItem = {
  team_id: '10000000-0000-4000-8000-000000000001',
  team: 'Team',
  cohort_id: '20000000-0000-4000-8000-000000000001',
  cohort: 'Cohort',
  node: 'project',
  title: 'Published title',
  owner_hold: false,
  can_review: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    displayName: 'Operator',
    role: 'operator',
    authUserId: 'auth-id',
  });
  mocks.database.mockReturnValue({ marker: 'fake-injected-database' });
  mocks.queue.mockResolvedValue([team]);
  mocks.read.mockResolvedValue({
    team: { id: team.team_id, name: 'Team', mentor: 'Mentor', members: [] },
    attempts: [],
    can_review: false,
    can_submit: false,
  });
});

describe('operator server route assembly', () => {
  it('authorizes before loading protected queues', async () => {
    mocks.authorize.mockRejectedValue(new Error('FORBIDDEN'));
    await expect(OperatorPage()).rejects.toThrow('FORBIDDEN');
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('keeps the existing exact operator/admin page guard', async () => {
    await OperatorPage();
    expect(mocks.authorize).toHaveBeenCalledWith(['operator', 'admin']);
    expect(mocks.queue).toHaveBeenCalledWith(mocks.database.mock.results[0]!.value, 'auth-id');
  });
  it('presents queue failure as unavailable without leaking raw database detail', async () => {
    mocks.queue.mockRejectedValue(new Error('private connection information'));
    const html = renderToStaticMarkup(await OperatorPage());
    expect(html).toContain('Raid reviews are unavailable');
    expect(html).not.toContain('private connection information');
  });
  it('loads selected detail only from an already-authorized queue row', async () => {
    await RaidReviewQueue({ searchParams: Promise.resolve({ team: team.team_id }) });
    expect(mocks.read).toHaveBeenCalledWith(
      mocks.database.mock.results[0]!.value,
      'auth-id',
      team.cohort_id,
      team.node,
      team.team_id,
    );
  });
  it.each(['other', ['first', 'second']] as const)(
    'does not read a non-authorized selection',
    async (candidate) => {
      const html = renderToStaticMarkup(
        await RaidReviewQueue({
          searchParams: Promise.resolve({ team: candidate as string | string[] }),
        }),
      );
      expect(mocks.read).not.toHaveBeenCalled();
      expect(html).toContain('No review detail has been loaded');
      expect(html).not.toContain('value="approved"');
    },
  );
  it('does not expose a mismatched detail returned for the authorized selection', async () => {
    mocks.read.mockResolvedValue({
      team: { id: 'other', name: 'Hidden team' },
      attempts: [],
      can_review: true,
    });
    const html = renderToStaticMarkup(
      await RaidReviewQueue({ searchParams: Promise.resolve({ team: team.team_id }) }),
    );
    expect(html).not.toContain('Hidden team');
    expect(html).toContain('Review detail unavailable');
  });
  it('retains admin-only assignment and keeps it absent for operators', async () => {
    const operator = renderToStaticMarkup(
      await RaidReviewQueue({ searchParams: Promise.resolve({}) }),
    );
    expect(operator).not.toContain('Owner assignment');
    mocks.authorize.mockResolvedValue({
      displayName: 'Admin',
      role: 'admin',
      authUserId: 'auth-id',
    });
    const admin = renderToStaticMarkup(
      await RaidReviewQueue({ searchParams: Promise.resolve({}) }),
    );
    expect(admin).toContain('Owner assignment');
  });
  it('hides even the existing assignment form if readiness cannot be confirmed', async () => {
    mocks.authorize.mockResolvedValue({
      displayName: 'Admin',
      role: 'admin',
      authUserId: 'auth-id',
    });
    mocks.queue.mockResolvedValue(null);
    const html = renderToStaticMarkup(await RaidReviewQueue({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain('Owner assignment');
    expect(html).toContain('Raid reviews are unavailable');
  });
  it('uses the approved minimal admin overview without fabricated aggregate counts', async () => {
    mocks.authorize.mockResolvedValue({
      displayName: 'Admin',
      role: 'admin',
      authUserId: 'auth-id',
    });
    const page = renderToStaticMarkup(await OperatorPage());
    expect(page).toContain('Keep the cohort moving.');
    expect(page).not.toContain('60 students');
    expect(page).not.toContain('3 mentors');
  });
});
