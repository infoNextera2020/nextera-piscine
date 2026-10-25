import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommandCenter, HomeWelcome } from '../../components/learning/command-center';
import { Roadmap } from '../../components/learning/roadmap';
import type { LearningNode, LearningOverview } from './types';
const node: LearningNode = {
  key: 'work',
  title: 'Published work',
  kind: 'challenge',
  questKey: 'quest',
  questTitle: 'Published quest',
  state: 'available',
  assessmentState: null,
  label: 'Available',
  lockedReason: null,
  prerequisites: [],
  skills: ['Go'],
  href: '/app/cohorts/assigned/challenges/work',
  roadmapHref: '/app/cohorts/assigned?node=work',
  startedAt: null,
  unlockedAt: null,
  masteredAt: null,
};
const locked: LearningNode = {
  ...node,
  key: 'locked',
  title: 'Restricted work',
  state: 'locked',
  href: null,
  lockedReason: 'Requires a recorded prerequisite pass.',
  prerequisites: ['Published prerequisite'],
};
const view: LearningOverview = {
  nodes: [node, locked],
  modules: [
    {
      key: 'quest',
      title: 'Published quest',
      nodes: [node, locked],
      mastered: 0,
      state: 'available',
      next: node,
    },
  ],
  current: node,
  currentDescription: 'Authorized brief excerpt.',
  checkpoint: null,
  checkpointStatus: null,
  submissions: [
    {
      id: 'receipt',
      title: node.title,
      state: 'queued',
      at: '2026-10-24T10:00:00Z',
      href: node.href!,
    },
  ],
  updates: [
    {
      id: 'infra',
      title: node.title,
      detail: 'Safe server explanation.',
      state: 'system_error',
      at: '2026-10-24T10:00:00Z',
      href: node.href!,
    },
  ],
  counts: {
    total: 2,
    mastered: 0,
    challenges: 2,
    challengesPassed: 0,
    checkpoints: 0,
    checkpointsPassed: 0,
    projects: 0,
    projectsActive: 0,
    available: 1,
    started: 0,
  },
};
const renderJourney = (props: Partial<Parameters<typeof Roadmap>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Roadmap, {
      view,
      initialModule: 'quest',
      initialNode: null,
      kind: null,
      base: '/app/cohorts/assigned',
      preview: false,
      ...props,
    }),
  );
describe('Home and Journey use the supplied overview', () => {
  it('keeps Home pending receipts and infrastructure feedback distinct from passing work', () => {
    const html = renderToStaticMarkup(
      createElement(CommandCenter, {
        name: 'Learner',
        cohort: {
          id: 'assigned',
          name: 'Assigned cohort',
          version: 'v1',
          startsAt: new Date('2026-10-24T00:00:00Z'),
          slug: 'assigned',
          curriculumVersionId: 'fixture-version',
          curriculumKey: 'fixture-only',
          endsAt: null,
        },
        view,
      }),
    );
    expect(html).toContain('Authorized brief excerpt.');
    expect(html).toContain('Queued');
    expect(html).not.toContain('Safe server explanation.');
    expect(html).toContain('Your evaluation is pending.');
    expect(html).toContain('0 of 2 curriculum nodes mastered');
    expect(html).not.toMatch(/XP|streak|All required checks passed/);
  });
  it('shows locked metadata and the supplied requirement without a restricted workspace link', () => {
    const html = renderJourney({ initialNode: 'locked' });
    expect(html).toContain('Restricted work');
    expect(html).toContain('Requires a recorded prerequisite pass.');
    expect(html).toContain('Published prerequisite');
    expect(html).not.toContain('challenges/locked');
    expect(html).not.toContain('Open challenge</a>');
  });
  it('uses the existing quest query and supplied authorized work destination', () => {
    const html = renderJourney({ questDetail: true });
    expect(html).toContain('aria-label="Quest exercises"');
    expect(html).toContain('aria-label="Quest overview"');
    expect(html).toContain('href="' + node.href + '"');
    expect(html).toContain('aria-current="page">Published quest');
  });
  it('uses the heart route without a List/Tree mode and retains a distinct selected state', () => {
    const html = renderJourney({ initialLayout: 'tree', initialNode: 'locked' });
    expect(html).toContain('aria-label="Piscine journey map"');
    expect(html).not.toContain('aria-label="Journey view"');
    expect(html).toContain('The line follows published reading order.');
    expect(html).toContain('aria-label="Selected roadmap details"');
    expect(html).toContain('data-state="locked"');
    expect(locked.state).toBe('locked');
  });
  it('does not imply personal progress in a read-only preview', () => {
    const html = renderJourney({
      preview: true,
      view: { ...view, counts: { ...view.counts, mastered: 99 } },
    });
    expect(html).toContain('No learner progress is implied.');
    expect(html).not.toContain('>99<');
    expect(html).not.toContain('aria-current="step"');
    expect(html).not.toContain('Evaluation pending');
    expect(html).not.toContain('mastered in quest');
  });
  it('distinguishes unpublished curriculum from no cohort enrollment', () => {
    const html = renderJourney({ view: { ...view, nodes: [], modules: [] } });
    expect(html).toContain('No published curriculum');
    expect(html).not.toContain(node.title);
    const empty = renderToStaticMarkup(
      createElement(HomeWelcome, { name: 'Learner', preview: false, empty: true }),
    );
    expect(empty).toContain(
      'No active cohorts assigned. Enrollment is controlled by your operator.',
    );
    expect(empty).not.toContain('nodes mastered');
  });
});
