import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RaidAttemptView, RaidView } from '@nextera/domain';
import type { RaidQueueItem } from '@nextera/db/raids';
import { StaffShell } from '../apps/web/components/operator/staff-shell';
import {
  AdminOverview,
  MentorOverview,
  StaffRaidQueue,
} from '../apps/web/components/operator/staff-overview';
import { StaffRaidReviewDetail } from '../apps/web/components/operator/raid-review-detail';
import {
  confirmsSelectedTeam,
  latestRaidAttempt,
  selectedRaidTeam,
} from '../apps/web/components/operator/review-model';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const team: RaidQueueItem = {
  team_id: '10000000-0000-4000-8000-000000000001',
  team: 'Team <one>',
  cohort_id: '20000000-0000-4000-8000-000000000001',
  cohort: 'Cohort',
  node: 'first-project',
  title: 'Published project title',
  owner_hold: false,
  can_review: true,
};
const attempt: RaidAttemptView = {
  id: '30000000-0000-4000-8000-000000000001',
  ordinal: 1,
  created_at: '2026-10-29T10:00:00Z',
  filename: 'project.go',
  artifact_digest: 'a'.repeat(64),
  uploader: 'Learner',
  members: [
    { id: '1', displayName: 'A' },
    { id: '2', displayName: 'B' },
    { id: '3', displayName: 'C' },
  ],
  automated_state: 'passed',
  feedback: null,
  review: null,
  outcome_id: null,
  status: 'awaiting_review',
};
const view: RaidView = {
  team: { id: team.team_id, name: team.team, mentor: 'Assigned mentor', members: attempt.members },
  attempts: [attempt],
  can_submit: false,
  can_review: true,
};
const detail = (initial: RaidView | null) =>
  renderToStaticMarkup(
    createElement(StaffRaidReviewDetail, {
      initial,
      team: team.team_id,
      cohort: team.cohort_id,
      node: team.node,
      title: team.title,
    }),
  );

describe('staff presentation preserves capability boundaries', () => {
  it('uses the authentic X01 mark and view navigation without a role grant or switch', () => {
    const html = renderToStaticMarkup(
      createElement(StaffShell, {
        user: { displayName: 'Reviewer', role: 'operator' },
        active: 'reviews',
        children: 'Workspace',
      }),
    );
    expect(html).toContain('/branding/01-coding/mark.svg');
    expect(html).toContain('Skip to workspace');
    expect(html).toContain('aria-label="Staff navigation"');
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain('Switch role');
    expect(html).not.toContain('Nextera');
  });
  it('keeps absent Quest persistence distinct from an empty review queue or a Raid', () => {
    const html = renderToStaticMarkup(createElement(MentorOverview, { queue: [team] }));
    expect(html).toContain('Quest review is not available yet');
    expect(html).toContain('No review decision can be recorded here');
    expect(html).toContain('configured schedule');
    expect(html).toContain('Assigned Raid teams');
    expect(html).toContain('Published project title');
    expect(html).not.toContain('Learner A');
    expect(html).not.toContain('Approve review');
    expect(html).not.toContain('value="approved"');
  });
  it('distinguishes unavailable and empty authorized Raid reads', () => {
    expect(renderToStaticMarkup(createElement(StaffRaidQueue, { queue: null }))).toContain(
      'Raid reviews are unavailable',
    );
    const empty = renderToStaticMarkup(createElement(StaffRaidQueue, { queue: [] }));
    expect(empty).toContain('No assigned teams');
    expect(empty).not.toContain('Raid reviews are unavailable');
  });
  it('does not infer an automated PASS from a queue assignment', () => {
    const html = renderToStaticMarkup(createElement(StaffRaidQueue, { queue: [team] }));
    expect(html).toContain('Assigned mentor');
    expect(html).not.toContain('Ready for your review');
    expect(html).not.toContain('Checks passed');
    expect(html).toContain('Team &lt;one&gt;');
    expect(html).toContain('/operator/raids?team=' + team.team_id);
  });
  it('keeps holds and administrator previews separate from mentor authority', () => {
    const html = renderToStaticMarkup(
      createElement(StaffRaidQueue, { queue: [{ ...team, owner_hold: true, can_review: false }] }),
    );
    expect(html).toContain('Owner decision required');
    expect(html).not.toContain('Team completed');
    const preview = renderToStaticMarkup(
      createElement(StaffRaidQueue, { queue: [{ ...team, can_review: false }] }),
    );
    expect(preview).toContain('Read-only owner preview');
  });
  it('shows capability gaps without fake admin links, metrics or grant actions', () => {
    const html = renderToStaticMarkup(createElement(AdminOverview, { queue: [] }));
    expect(html).toContain('Portal management unavailable');
    expect(html).toContain('/operator/raids#assignments');
    expect(html).not.toContain('/admin/users');
    expect(html).not.toContain('/admin/schedule');
    expect(html).not.toContain('60 students');
    expect(html).not.toContain('Assign role');
  });
  it('shows no protected detail or mutation when the initial authorized read is missing', () => {
    const html = detail(null);
    expect(html).toContain('Review detail unavailable');
    expect(html).not.toContain('project.go');
    expect(html).not.toContain('/api/raids/artifact');
    expect(html).not.toContain('value="approved"');
  });
  it('rejects an initial detail for a different selected team', () => {
    const html = detail({ ...view, team: { ...view.team!, id: 'other' } });
    expect(html).not.toContain('project.go');
    expect(html).not.toContain('value="approved"');
  });
  it('reuses the actual exact-revision form for an eligible assigned mentor', () => {
    const html = detail(view);
    expect(html).toContain('Review this exact revision');
    expect(html).toContain('value="approved"');
    expect(html).toContain('value="changes_requested"');
    expect(html).toContain('/api/raids/artifact?attempt=' + attempt.id);
    expect(html).toContain(attempt.artifact_digest);
    expect(html).not.toContain('Shared completion recorded');
  });
  it('does not expose artifact download or review to an administrator preview', () => {
    const html = detail({ ...view, can_review: false });
    expect(html).toContain('Read-only owner preview');
    expect(html).not.toContain('/api/raids/artifact');
    expect(html).not.toContain('value="approved"');
  });
  it.each(['owner_decision_required', 'superseded', 'completed', 'changes_required'] as const)(
    'does not offer approval for %s',
    (status) => {
      expect(detail({ ...view, attempts: [{ ...attempt, status }] })).not.toContain(
        'value="approved"',
      );
    },
  );
  it('does not offer approval or source download before automated PASS', () => {
    const html = detail({ ...view, attempts: [{ ...attempt, automated_state: 'failed' }] });
    expect(html).not.toContain('value="approved"');
    expect(html).not.toContain('/api/raids/artifact');
  });
});

describe('staff detail selection is scoped to the authorized queue', () => {
  it('does not resolve unknown, unready or duplicate query input into a protected read', () => {
    expect(selectedRaidTeam([team], 'other')).toBeNull();
    expect(selectedRaidTeam(null, team.team_id)).toBeNull();
    expect(selectedRaidTeam([team], [team.team_id])).toBeNull();
    expect(selectedRaidTeam([team], team.team_id)).toEqual(team);
  });
  it('selects latest revision without changing history order', () => {
    const older = { ...attempt, ordinal: 0 };
    const entries = [attempt, older];
    expect(latestRaidAttempt(entries)).toBe(attempt);
    expect(entries).toEqual([attempt, older]);
    expect(latestRaidAttempt([])).toBeNull();
  });
  it('requires an exact team identity in the returned detail', () => {
    expect(confirmsSelectedTeam(view, team.team_id)).toBe(true);
    expect(confirmsSelectedTeam({ ...view, team: null }, team.team_id)).toBe(false);
    expect(confirmsSelectedTeam(view, 'other')).toBe(false);
  });
});
