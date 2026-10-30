import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FocusedChallenge } from '../../components/learning/focused-challenge';
import { Subject } from '../../components/learning/workspace-parts';
import { SubmissionForm } from '../submissions/form';
import { Challenge, ChallengeHistory } from '../../components/learning/challenge';
import type { ComponentProps } from 'react';

const current = {
  key: 'hello-go',
  title: 'Hello Go',
  questKey: 'go-basics',
  questTitle: 'Go Basics',
  state: 'available' as const,
};
const rules = { required_files: ['hello.go'], allowed_extensions: ['.go'], max_size_kb: 256 };
const subject = readFileSync('content/piscine-v1/challenges/hello-go/subject.md', 'utf8');
const base: ComponentProps<typeof FocusedChallenge> = {
  cohort: { id: 'test-cohort', name: 'Source test cohort', version: 'source-test-version' },
  current,
  rules,
  role: 'learner',
  subject: createElement(Subject, { children: subject }),
  submission: createElement(SubmissionForm, {
    cohort: 'test-cohort',
    node: current.key,
    filename: 'hello.go',
    maxSizeKb: 256,
  }),
  history: createElement(ChallengeHistory, { items: [] }),
  context: [],
};
const render = (props: Partial<ComponentProps<typeof FocusedChallenge>> = {}) =>
  renderToStaticMarkup(createElement(FocusedChallenge, { ...base, ...props }));

describe('Opt-in focused Challenge presentation', () => {
  it('renders supplied X01 mark only and real existing navigation without a sidebar', () => {
    const html = render();
    expect(html).toContain('/branding/01-coding/mark.svg');
    expect(html).toContain('aria-label="01 coding Piscine home"');
    expect(html).toContain('aria-label="Learner navigation"');
    expect(html).toContain('href="/app?cohort=test-cohort"');
    expect(html).toContain('href="/app/cohorts/test-cohort/evidence"');
    expect(html).toContain('href="/app/cohorts/test-cohort?quest=go-basics"');
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(header).not.toMatch(/NextEra|>01 coding</);
    expect(html).not.toMatch(/<aside[^>]*sidebar/);
  });
  it('uses published subject bytes through the existing semantic Markdown component', () => {
    const html = render();
    expect(html).toContain('Hello Go');
    expect(html).toContain('func Hello(name string) string');
    expect(html).toContain('aria-label="Examples"');
    expect(html).toContain('Hello, &lt;name&gt;!');
    expect(html).not.toMatch(/hello\.sh|Run your first script|<textarea|contenteditable/);
    expect(readFileSync('content/piscine-v1/challenges/hello-go/subject.md', 'utf8')).toBe(subject);
  });
  it('reuses the actual file intake and history components without changing their contract', () => {
    const html = render();
    expect(html).toContain('type="file"');
    expect(html).toContain('Solution file (hello.go)');
    expect(html).toContain('Submit solution');
    expect(html).toContain('Your result comes from server evaluation.');
    expect(html).toContain('No submissions yet');
    expect(html).toContain('Submission history');
    expect(html).toContain('hello.go');
    expect(html).toContain('.go');
    expect(html).toContain('256 KiB');
  });
  it('keeps permission and history error surfaces supplied by the controller without adding intake', () => {
    const html = render({
      submission: createElement('p', { role: 'status' }, 'Submission unavailable: access changed.'),
      history: createElement(
        'p',
        { role: 'alert' },
        'History is hidden until access can be confirmed.',
      ),
      notice: createElement('p', null, 'Administrative read-only subject preview.'),
    });
    expect(html).toContain('Submission unavailable: access changed.');
    expect(html).toContain('History is hidden until access can be confirmed.');
    expect(html).toContain('Administrative read-only subject preview.');
    expect(html).not.toContain('type="file"');
  });
  it('collapses supporting material natively and never fabricates hints, resources or review rules', () => {
    const html = render();
    expect(html).toContain('<summary>Check your work');
    expect(html).toContain('<summary>Submission guidance');
    expect(html).toContain('No separate resources are attached.');
    expect(html).not.toContain('Need a hint?');
    expect(html).not.toContain('Review &amp; understanding');
    expect(html).not.toMatch(/id="focused-resources"[^>]*open/);
    expect(html).not.toMatch(/\b(?:mentor approval|XP|points|pass to unlock)\b/i);
  });
  it('reveals only explicitly supplied optional material and supports resources deep links', () => {
    const html = render({
      resourcesOpen: true,
      resources: createElement('p', null, 'Authored reference'),
      hint: createElement('p', null, 'Authored hint'),
      review: createElement('p', null, 'Authored review guidance'),
    });
    expect(html).toMatch(/id="focused-resources"[^>]*open/);
    expect(html).toContain('Authored reference');
    expect(html).toContain('Authored hint');
    expect(html).toContain('Authored review guidance');
    expect(html).not.toContain('No separate resources are attached.');
  });
  it('preserves authoritative context links and leaves unavailable siblings unlinked', () => {
    const entry = {
      ...current,
      kind: 'challenge' as const,
      assessmentState: null,
      label: 'AVAILABLE',
      lockedReason: null,
      prerequisites: [],
      skills: [],
      href: '/app/cohorts/test-cohort/challenges/hello-go',
      roadmapHref: '/app/cohorts/test-cohort',
      startedAt: null,
      unlockedAt: null,
      masteredAt: null,
    };
    const html = render({
      context: [
        entry,
        {
          ...entry,
          key: 'later',
          title: 'Later task',
          state: 'locked',
          label: 'LOCKED',
          href: null,
        },
      ],
    });
    const currentLink = html.match(
      /<a\b[^>]*href="\/app\/cohorts\/test-cohort\/challenges\/hello-go"[^>]*>/,
    )?.[0];
    expect(currentLink).toContain('aria-current="page"');
    expect(html).toContain('<span>Later task</span>');
    expect(html).not.toContain('challenges/later');
    expect(html).toContain('LOCKED');
  });
  it('keeps role navigation consistent and renders exact long code without an internal editor', () => {
    const line = 'a'.repeat(400);
    const html = render({
      role: 'operator',
      subject: createElement(Subject, { children: '```go\n' + line + '\n```' }),
    });
    expect(html).toContain('/operator/raids');
    expect(html).not.toContain('/test-cohort/evidence');
    expect(html).toContain(line);
    expect(html).toContain('aria-label="go code block"');
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain('<textarea');
  });
});

describe('Existing Challenge controller in focused view', () => {
  const renderController = (options: { enabled?: boolean; focused?: boolean; tab?: string } = {}) =>
    renderToStaticMarkup(
      createElement(Challenge, {
        cohort: base.cohort.id,
        node: current.key,
        rules,
        submittable: options.enabled ?? true,
        initialHistory: [
          {
            id: 'source-test-receipt',
            node_key: current.key,
            created_at: '2026-10-28T00:00:00Z',
            state: 'failed',
            feedback: { verdict: 'failed', message: 'Required checks did not pass.' },
          },
        ],
        subject: base.subject,
        context: [],
        initialTab: options.tab,
        focused:
          options.focused === false ? undefined : { cohort: base.cohort, current, role: 'learner' },
      }),
    );
  it('wires actual file intake and current receipt into the new frame', () => {
    const html = renderController();
    expect(html).toContain('data-focused-challenge');
    expect(html).toContain('Solution file (hello.go)');
    expect(html).toContain('data-verdict="failed"');
    expect(html).toContain('Required checks did not pass.');
    expect(html).not.toContain('aria-label="Challenge sections"');
  });
  it('never gains intake when the server has marked the brief read-only', () => {
    const html = renderController({ enabled: false });
    expect(html).toContain('Submission unavailable');
    expect(html).not.toContain('type="file"');
    expect(html).toContain('data-verdict="failed"');
  });
  it('opens only the requested resources disclosure on initial deep links', () => {
    expect(renderController({ tab: 'resources' })).toMatch(/id="focused-resources"[^>]*open/);
    expect(renderController({ tab: 'submissions' })).not.toMatch(/id="focused-resources"[^>]*open/);
  });
  it('keeps the existing brief/resources layout as the default', () => {
    const html = renderController({ focused: false });
    expect(html).not.toContain('data-focused-challenge');
    expect(html).toContain('aria-label="Challenge sections"');
    expect(html).toContain('Solution file (hello.go)');
    expect(html).toContain('data-verdict="failed"');
  });
});
