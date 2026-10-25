import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeNextAction } from '../../components/learning/home-next-action';
import type { LearningNode } from './types';

const cohort = { id: 'authorized-cohort', name: 'Assigned cohort' };
const node: LearningNode = {
  key: 'authorized-work',
  title: 'Authorized work',
  kind: 'challenge',
  questKey: 'foundations',
  questTitle: 'Foundations',
  state: 'available',
  assessmentState: null,
  label: 'Available',
  lockedReason: null,
  prerequisites: [],
  skills: [],
  href: '/app/cohorts/authorized-cohort/challenges/authorized-work',
  roadmapHref: '/app/cohorts/authorized-cohort?node=authorized-work',
  startedAt: null,
  unlockedAt: null,
  masteredAt: null,
};
const render = (current: LearningNode | null, nodes = [node], description: string | null = null) =>
  renderToStaticMarkup(
    createElement(HomeNextAction, {
      name: 'Local Learner',
      cohort,
      view: { current, nodes, currentDescription: description },
    }),
  );

describe('Home next action uses authorized overview facts', () => {
  it('links available work to its supplied destination without claiming first-ever activity', () => {
    const html = render(node, [node], 'The authorized subject excerpt.');
    expect(html).toContain(`href="${node.href}"`);
    expect(html).toContain('Open challenge');
    expect(html).toContain('The authorized subject excerpt.');
    expect(html).toContain('Available');
    expect(html).not.toMatch(/first challenge|never started|ready to submit/i);
    expect(html.match(/<a\b/g)).toHaveLength(1);
  });

  it('preserves stored in-progress work and supports the existing project kind', () => {
    const current = Object.freeze({
      ...node,
      kind: 'project' as const,
      state: 'in_progress' as const,
    });
    const html = render(current);
    expect(html).toContain('Authorized work');
    expect(html).toContain('Continue project');
    expect(html).toContain('In progress');
    expect(current.state).toBe('in_progress');
  });

  it('keeps no actionable work separate from published emptiness and completion', () => {
    const html = render(null, [{ ...node, state: 'mastered' }]);
    expect(html).toContain('No actionable work');
    expect(html).toContain('href="/app/cohorts/authorized-cohort"');
    expect(html).toContain('View journey');
    expect(html).not.toMatch(/No published curriculum|journey complete|unlocked|ready to begin/i);
  });

  it('shows confirmed empty curriculum without leaking a contradictory current node', () => {
    const html = render(node, [], 'Do not display this excerpt.');
    expect(html).toContain('No published work to show.');
    expect(html).not.toContain(node.title);
    expect(html).not.toContain('Do not display this excerpt.');
    expect(html).not.toContain(node.href);
    expect(html.match(/<a\b/g)).toHaveLength(1);
  });

  it('does not manufacture a launch link for locked or missing-destination work', () => {
    for (const current of [
      { ...node, state: 'locked' as const },
      { ...node, href: null },
    ]) {
      const html = render(current);
      expect(html).toContain('View journey');
      expect(html).not.toContain('Open challenge');
      expect(html).not.toContain(`href="${node.href}"`);
    }
  });

  it('escapes subject text and keeps decorative art out of keyboard navigation', () => {
    const html = render({ ...node, title: '<script>unsafe()</script>' }, [node], '<img src=x>');
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('aria-hidden="true" focusable="false"');
    expect(html).toContain('data-hairline-icon="arrow"');
  });
});
