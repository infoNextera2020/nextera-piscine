import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommandCenter, HomeWelcome } from '../../components/learning/command-center';
import { HairlineIcon } from '../../components/learning/hairline-icon';
import type { LearningNode, LearningOverview, LearningSubmission } from './types';
const cohort = {
  id: 'assigned',
  name: 'Authorized cohort',
  version: 'approved-version',
  startsAt: new Date('2026-10-24'),
  endsAt: null,
  slug: 'assigned',
  curriculumVersionId: 'published-version',
  curriculumKey: 'actual-key',
};
const node: LearningNode = {
  key: 'published-work',
  title: 'Actual work title',
  kind: 'challenge',
  questKey: 'actual-quest',
  questTitle: 'Actual quest title',
  state: 'in_progress',
  assessmentState: null,
  label: 'In progress',
  lockedReason: null,
  prerequisites: [],
  skills: [],
  href: '/app/cohorts/assigned/challenges/published-work',
  roadmapHref: '/app/cohorts/assigned?node=published-work',
  startedAt: null,
  unlockedAt: null,
  masteredAt: null,
};
const base: LearningOverview = {
  nodes: [node],
  modules: [],
  current: node,
  currentDescription: 'Actual authorized brief.',
  checkpoint: null,
  checkpointStatus: null,
  submissions: [],
  updates: [],
  counts: {
    total: 1,
    mastered: 0,
    challenges: 1,
    challengesPassed: 0,
    checkpoints: 0,
    checkpointsPassed: 0,
    projects: 0,
    projectsActive: 0,
    available: 0,
    started: 1,
  },
};
const receipt: LearningSubmission = {
  id: 'actual-receipt',
  title: 'Actual recorded title',
  href: node.href!,
  at: '2026-10-24T12:00:00Z',
  state: 'failed',
  feedback: 'Actual safe server feedback.',
};
const render = (changes: Partial<LearningOverview> = {}) =>
  renderToStaticMarkup(
    createElement(CommandCenter, { name: 'Learner', cohort, view: { ...base, ...changes } }),
  );
describe('Functional Home preserves authoritative facts and conditional actions', () => {
  it('renders supplied titles, excerpt and one primary work destination', () => {
    const html = render();
    for (const text of [
      node.title,
      node.questTitle,
      cohort.name,
      'Actual authorized brief.',
      'Continue challenge',
    ])
      expect(html).toContain(text);
    expect(html.match(new RegExp('href="' + node.href + '"', 'g'))).toHaveLength(1);
    expect(html).not.toMatch(/Hello Go|Quest 2|\bXP\b|streak|ready to submit/i);
  });
  it.each(['challenge', 'project', 'checkpoint'] as const)(
    'uses the supplied %s destination without inferring eligibility',
    (kind) => {
      const current = {
        ...node,
        kind,
        state: 'available' as const,
        href: '/actual-authorized/' + kind,
      };
      const html = render({ current });
      expect(html).toContain('href="' + current.href + '"');
      expect(html).toContain('Open ' + kind);
    },
  );
  it('withholds work action for locked or destinationless metadata', () => {
    for (const current of [
      { ...node, state: 'locked' as const },
      { ...node, href: null },
    ]) {
      const html = render({ current });
      expect(html).not.toContain('Continue challenge');
      expect(html).not.toContain('href="' + node.href + '"');
      expect(html).toContain('View journey');
    }
  });
  it('does not fabricate completion or a milestone when none is provided', () => {
    const html = render({
      current: null,
      nodes: [{ ...node, state: 'mastered' }],
      counts: { ...base.counts, mastered: 1 },
    });
    expect(html).toContain('No actionable work');
    expect(html).not.toMatch(/journey complete|Next milestone|unlocked/i);
  });
  it('suppresses a contradictory current node when published curriculum is empty', () => {
    const html = render({ nodes: [], counts: { ...base.counts, total: 0 } });
    expect(html).toContain('No published curriculum');
    expect(html).not.toContain(node.title);
    expect(html).not.toContain('Actual authorized brief.');
  });
  it.each(['queued', 'running'] as const)(
    'keeps %s receipts pending even when unrelated activity says passed',
    (state) => {
      const html = render({
        submissions: [{ ...receipt, state, feedback: null }],
        updates: [
          {
            id: 'different',
            title: receipt.title,
            state: 'passed',
            detail: 'Do not use this as receipt feedback',
            at: receipt.at,
            href: receipt.href,
          },
        ],
      });
      expect(html).toContain('Your evaluation is pending.');
      expect(html).not.toContain('Your latest submission passed.');
      expect(html).not.toContain('Do not use this as receipt feedback');
    },
  );
  it('shows passed feedback without manufacturing mastery or unlocking', () => {
    const html = render({ submissions: [{ ...receipt, state: 'passed' }] });
    expect(html).toContain('Your latest submission passed.');
    expect(html).toContain('0 of 1 curriculum nodes mastered');
    expect(html).not.toMatch(/unlocked|ready for the next/i);
  });
  it('keeps an infrastructure result separate from learner failure', () => {
    const html = render({ submissions: [{ ...receipt, state: 'system_error' }] });
    expect(html).toContain('Actual safe server feedback.');
    expect(html).toContain('This is not a learner failure.');
    expect(html).not.toContain('Your solution needs review.');
  });
  it('uses the latest supplied receipt and escapes feedback without title-based joins', () => {
    const html = render({
      submissions: [
        { ...receipt, feedback: '<script>unsafe()</script>' },
        { ...receipt, id: 'older', title: 'Older receipt', state: 'passed' },
      ],
    });
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('Older receipt');
  });
  it('opens the existing history tab while retaining other authorized query parameters', () => {
    const html = render({
      submissions: [{ ...receipt, href: receipt.href + '?view=actual&tab=subject' }],
    });
    expect(html).toContain('?view=actual&amp;tab=submissions');
    expect(html).not.toContain('tab=subject');
    expect(html).not.toContain('tab=submissions&amp;tab=');
  });
  it('shows supplied milestone status and requirements without creating a restricted work link', () => {
    const checkpoint = {
      ...node,
      key: 'gate',
      kind: 'checkpoint' as const,
      title: 'Actual milestone',
      state: 'locked' as const,
      lockedReason: 'Actual prerequisite requirement',
      href: null,
      roadmapHref: '/app/cohorts/assigned?node=gate',
    };
    const html = render({ checkpoint, checkpointStatus: 'infrastructure_blocked' });
    expect(html).toContain(checkpoint.title);
    expect(html).toContain(checkpoint.lockedReason);
    expect(html).toContain('href="' + checkpoint.roadmapHref + '"');
    expect(html).not.toContain('/checkpoints/gate');
  });
  it('keeps missing history and unassigned or preview states honest', () => {
    expect(render()).toContain('No submission records available.');
    for (const empty of [true, false]) {
      const html = renderToStaticMarkup(
        createElement(HomeWelcome, { name: 'Learner', preview: !empty, empty }),
      );
      expect(html).not.toContain('nodes mastered');
      expect(html).not.toContain('Continue challenge');
      expect(html).toContain(
        empty ? 'No active cohorts assigned.' : 'No learner progress is implied.',
      );
    }
  });
  it('keeps all Hairline icon drawings decorative and outside keyboard navigation', () => {
    for (const name of [
      'home',
      'map',
      'evidence',
      'code',
      'gate',
      'folder',
      'arrow',
      'search',
      'bell',
      'menu',
      'close',
      'logout',
    ]) {
      const html = renderToStaticMarkup(createElement(HairlineIcon, { name }));
      expect(html).toContain('data-hairline-icon="' + name + '"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('focusable="false"');
      expect(html).toContain('<path');
      expect(html).not.toMatch(/<iframe|<script|<text|tabindex/i);
    }
  });
});

describe('Home cancellation and project result copy', () => {
  it('does not describe cancellation as a solution failure or infer a progress change', () => {
    const html = render({ submissions: [{ ...receipt, state: 'cancelled', feedback: null }] });
    expect(html).toContain('Cancelled');
    expect(html).toContain('This submission was cancelled.');
    expect(html).toContain('Cancellation is not a learner failure.');
    expect(html).not.toContain('Your solution needs review.');
    expect(html).toContain('0 of 1 curriculum nodes mastered');
  });
  it.each(['queued', 'running', 'passed'] as const)(
    'keeps project %s separate from completion and stored progression',
    (state) => {
      const project = { ...node, kind: 'project' as const };
      const html = render({
        current: project,
        nodes: [project],
        submissions: [{ ...receipt, state, feedback: null }],
      });
      expect(html).toContain(
        state === 'passed'
          ? 'does not by itself confirm project completion'
          : 'Project completion is not confirmed',
      );
      expect(html).toContain('0 of 1 curriculum nodes mastered');
      expect(html).not.toMatch(
        /Your project passed|project mastered|UNSUPPORTED_MASTERY_KIND|has been unlocked/,
      );
    },
  );
  it('does not guess project identity from a matching title', () => {
    const project = { ...node, kind: 'project' as const };
    const html = render({
      current: project,
      nodes: [project],
      submissions: [
        {
          ...receipt,
          title: project.title,
          state: 'passed',
          href: '/another-authorized-destination',
          feedback: null,
        },
      ],
    });
    expect(html).not.toContain('does not by itself confirm project completion');
  });
});

describe('Home option 1 comparison preserves the actual component contract', () => {
  it.each(['failed', 'passed', 'queued', 'system_error'] as const)(
    'keeps %s receipt facts and destinations in the opt-in presentation',
    (state) => {
      const view = { ...base, submissions: [{ ...receipt, state }] };
      const desk = renderToStaticMarkup(
        createElement(CommandCenter, { name: 'Learner', cohort, view }),
      );
      const focus = renderToStaticMarkup(
        createElement(CommandCenter, {
          name: 'Learner',
          cohort,
          view,
          presentation: 'focus-review',
        }),
      );
      expect(focus).toContain('data-home-layout="focus-review"');
      expect(desk).toContain('data-home-layout="desk"');
      expect(focus.match(/href="[^"]+"/g)?.sort()).toEqual(desk.match(/href="[^"]+"/g)?.sort());
      for (const text of [node.title, node.questTitle, receipt.title, receipt.feedback!])
        expect(focus).toContain(text);
      expect(focus).toContain('Refined Blender artwork pending');
      expect(desk).not.toContain('Refined Blender artwork pending');
      expect(focus).not.toMatch(/<canvas|WebGL|hello\.go|signup|team sign-off/);
    },
  );
});
