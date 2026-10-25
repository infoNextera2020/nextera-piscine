import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RaidAttemptView, RaidView } from '@nextera/domain';
import { RaidPanel, RaidHistory } from './panel';
const attempt: RaidAttemptView = {
  id: 'attempt',
  ordinal: 1,
  created_at: '2026-10-25T10:00:00Z',
  filename: 'raid.go',
  artifact_digest: 'a'.repeat(64),
  uploader: 'Learner',
  members: [
    { id: 'a', displayName: 'A' },
    { id: 'b', displayName: 'B' },
    { id: 'c', displayName: 'C' },
  ],
  automated_state: 'passed',
  feedback: { message: 'All required checks passed.' },
  review: null,
  outcome_id: null,
  status: 'awaiting_review',
};
const history = (a: Partial<RaidAttemptView> = {}, reviewer = false) =>
  renderToStaticMarkup(
    createElement(RaidHistory, { attempts: [{ ...attempt, ...a }], canReview: reviewer }),
  );
describe('shared Raid UI follows durable server evidence', () => {
  it('does not claim automatic PASS is completion and hides mentor actions from learners', () => {
    const html = history();
    expect(html).toContain('Automated PASS does not complete this Raid');
    expect(html).toContain('Awaiting mentor review');
    expect(html).not.toContain('Record review');
    expect(html).not.toContain('same shared completion is recorded');
  });
  it('shows review controls only to the assigned mentor on an eligible exact revision', () => {
    const html = history({}, true);
    expect(html).toContain('Review this exact revision');
    expect(html).toContain('/api/raids/artifact?attempt=attempt');
    expect(html).toContain('accepted source file');
  });
  it.each(['superseded', 'owner_decision_required', 'changes_required', 'completed'] as const)(
    'does not offer review for %s',
    (status) => {
      expect(history({ status }, true)).not.toContain('Record review');
    },
  );
  it('explains access-removal hold without awarding or silently excluding anyone', () => {
    const html = history({ status: 'owner_decision_required' });
    expect(html).toContain('Completion is blocked for the owner to decide');
    expect(html).not.toContain('Record review');
  });
  it('shows the same completion only from a durable outcome and retains the frozen roster', () => {
    const html = history({
      status: 'completed',
      outcome_id: 'outcome',
      review: {
        decision: 'approved',
        feedback: 'Approved exact attempt',
        created_at: attempt.created_at,
      },
    });
    expect(html).toContain('same shared completion is recorded for all three');
    expect(html).toContain('Frozen members: A, B, C');
    expect(html).not.toContain('Automated PASS does not complete');
  });
  it('escapes learner-safe mentor feedback as text', () => {
    const html = history({
      review: {
        decision: 'changes_requested',
        feedback: '<script>attack()</script>',
        created_at: attempt.created_at,
      },
      status: 'changes_required',
    });
    expect(html).not.toContain('<script>attack()');
    expect(html).toContain('&lt;script&gt;');
  });
  it('keeps no-assignment and unavailable intake honest', () => {
    const initial: RaidView = { team: null, attempts: [], can_submit: false, can_review: false };
    const html = renderToStaticMarkup(
      createElement(RaidPanel, {
        cohort: 'cohort',
        node: 'raid',
        initial,
        rules: { required_files: ['raid.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      }),
    );
    expect(html).toContain('Team assignment pending');
    expect(html).toContain('No shared upload yet');
    expect(html).not.toContain('Submit solution');
  });
});
