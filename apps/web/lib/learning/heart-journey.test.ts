import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Roadmap } from '../../components/learning/roadmap';
import type { LearningNode, LearningOverview } from './types';
const base = '/app/cohorts/assigned';
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
  href: base + '/challenges/work',
  roadmapHref: base + '?node=work',
  startedAt: null,
  unlockedAt: null,
  masteredAt: null,
};
const view = {
  nodes: [node],
  modules: [
    {
      key: 'quest',
      title: 'Published quest',
      nodes: [node],
      mastered: 0,
      state: 'available' as const,
      next: node,
    },
  ],
  current: node,
  counts: {
    total: 1,
    mastered: 0,
    challenges: 1,
    challengesPassed: 0,
    checkpoints: 0,
    checkpointsPassed: 0,
    projects: 0,
    projectsActive: 0,
    available: 1,
    started: 0,
  },
  submissions: [],
};
const render = (changes: Partial<Parameters<typeof Roadmap>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Roadmap, {
      view,
      initialModule: 'quest',
      initialNode: null,
      kind: null,
      base,
      preview: false,
      ...changes,
    }),
  );
describe('Direct Journey navigation preserves authorized destinations', () => {
  it('links the map quest directly to the existing quest page', () => {
    const html = render();
    expect(html).toContain('href="' + base + '?quest=quest"');
    expect(html).toContain('aria-label="Quest 1: Published quest. Available. Current work"');
    expect(html).not.toContain('One continuous journey.');
    expect(html).not.toContain('The Piscine journey');
    expect(html).not.toContain('aria-label="Journey view"');
  });
  it('uses supplied workspace destinations for available project and checkpoint leaves', () => {
    const leaves = [
      { ...node, key: 'project', kind: 'project' as const, href: base + '/challenges/project' },
      { ...node, key: 'gate', kind: 'checkpoint' as const, href: base + '/checkpoints/gate' },
    ];
    const html = render({ view: { ...view, nodes: leaves, modules: [] } });
    expect(html).toContain('href="' + leaves[0]!.href + '"');
    expect(html).toContain('href="' + leaves[1]!.href + '"');
  });
  it('does not construct a workspace link for locked leaves', () => {
    const locked = {
      ...node,
      key: 'locked',
      kind: 'project' as const,
      state: 'locked' as const,
      href: null,
      lockedReason: 'Requires a recorded prerequisite pass.',
      prerequisites: ['Recorded prerequisite'],
    };
    const html = render({
      view: { ...view, nodes: [locked], modules: [], current: null },
      initialNode: 'locked',
    });
    expect(html).toContain('Show requirements');
    expect(html).toContain('Requires a recorded prerequisite pass.');
    expect(html).toContain('Recorded prerequisite');
    expect(html).not.toContain('href="' + base + '/challenges/locked"');
  });
  it('keeps pending receipts distinct from mastery and suppresses learner indicators in preview', () => {
    const pending: LearningOverview['submissions'] = [
      {
        id: 'receipt',
        title: node.title,
        state: 'queued',
        at: '2026-10-24T10:00:00Z',
        href: node.href!,
      },
    ];
    expect(render({ view: { ...view, submissions: pending } })).toContain('Evaluation pending');
    const html = render({ view: { ...view, submissions: pending }, preview: true });
    expect(html).toContain('No learner progress is implied.');
    expect(html).not.toContain('Evaluation pending');
    expect(html).not.toContain('aria-current="step"');
  });
  it('preserves published emptiness without adding visual reference records', () => {
    const html = render({ view: { ...view, nodes: [], modules: [], current: null } });
    expect(html).toContain('No published curriculum');
    expect(html).not.toContain('Published quest');
    expect(html).not.toContain('<polyline');
    expect(html).not.toMatch(/Sudoku|Quadchecker|Quest 12/);
  });
  it('retains the existing Quest destination and authorized child link', () => {
    const html = render({ questDetail: true });
    expect(html).toContain('aria-label="Quest exercises"');
    expect(html).toContain('aria-label="Quest overview"');
    expect(html).toContain('href="' + node.href + '"');
  });
});
