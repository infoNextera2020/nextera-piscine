import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../app/login/actions', () => ({ logout: async () => {} }));
import { RaidQueue } from './queue';
import { RaidAssignment } from './assignment';
import { SubmissionForm } from '../submissions/form';
import { AppShell } from '../../components/learning/app-shell';
describe('Raid approved presentation uses existing contract capabilities', () => {
  it('separates configuration unavailable, no assignment and supplied queue records', () => {
    expect(renderToStaticMarkup(createElement(RaidQueue, { queue: null }))).toContain(
      'unavailable in this environment',
    );
    expect(renderToStaticMarkup(createElement(RaidQueue, { queue: [] }))).toContain(
      'No team assignments',
    );
    const markup = renderToStaticMarkup(
      createElement(RaidQueue, {
        queue: [
          {
            team_id: 'team',
            team: 'Actual team',
            cohort_id: 'cohort',
            cohort: 'Published cohort',
            node: 'raid',
            title: 'Published project',
            owner_hold: true,
            can_review: true,
          },
        ],
      }),
    );
    expect(markup).toContain('Actual team');
    expect(markup).toContain('?team=team');
    expect(markup).toContain('Assigned mentor');
    expect(markup).toContain('Owner decision required');
    expect(markup).not.toContain('Ready for review');
    expect(markup).not.toContain('Shared completion recorded');
  });
  it('assigns only existing IDs and exactly three visible member inputs, with no account creation action', () => {
    const markup = renderToStaticMarkup(createElement(RaidAssignment));
    expect((markup.match(/name="member[123]"/g) ?? []).length).toBe(3);
    for (const name of ['cohort', 'node', 'mentor', 'name'])
      expect(markup).toContain(`name="${name}"`);
    expect(markup).toContain('It does not create accounts');
    expect(markup).not.toContain('name="password"');
  });
  it('keeps the accepted Challenge upload copy unchanged unless Raid copy is supplied', () => {
    const base = { cohort: 'cohort', node: 'node', filename: 'source.go', maxSizeKb: 128 };
    const challenge = renderToStaticMarkup(createElement(SubmissionForm, base));
    expect(challenge).toContain('Submit your solution');
    expect(challenge).toContain('Submit solution');
    const raid = renderToStaticMarkup(
      createElement(SubmissionForm, {
        ...base,
        copy: {
          heading: 'New revision',
          description: 'New accepted source',
          submitLabel: 'Upload new revision',
        },
      }),
    );
    expect(raid).toContain('New revision');
    expect(raid).toContain('Upload new revision');
    expect(raid).toContain('type="file"');
    expect(raid).not.toContain('<textarea');
  });
  it.each(['learner', 'operator', 'admin'] as const)(
    'keeps Team reviews navigation appropriate for %s without changing role',
    (role) => {
      const markup = renderToStaticMarkup(
        createElement(AppShell, {
          user: { displayName: 'Test user', role },
          active: 'reviews',
          children: createElement('p', null, 'Workspace'),
        }),
      );
      if (role === 'learner') expect(markup).not.toContain('href="/operator/raids"');
      else {
        expect(markup).toContain('href="/operator/raids"');
        expect(markup).toContain('Team reviews');
      }
    },
  );
});
