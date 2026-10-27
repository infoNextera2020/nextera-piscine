import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RaidAttemptView, RaidView } from '@nextera/domain';
import { RaidPanel, RaidHistory, raidReviewReceiptMessage } from './panel';
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
    expect(html).not.toContain('value="approved"');
    expect(html).not.toContain('same shared completion is recorded');
  });
  it('shows review controls only to the assigned mentor on an eligible exact revision', () => {
    const html = history({}, true);
    expect(html).toContain('Review this exact revision');
    expect(html).toContain('/api/raids/artifact?attempt=attempt');
    expect(html).toContain('accepted source file');
    expect(html).toContain('value="approved"');
    expect(html).toContain('value="changes_requested"');
    expect(html.indexOf('value="changes_requested"')).toBeLessThan(
      html.indexOf('value="approved"'),
    );
  });
  it.each(['superseded', 'owner_decision_required', 'changes_required', 'completed'] as const)(
    'does not offer review for %s',
    (status) => {
      expect(history({ status }, true)).not.toContain('value="approved"');
    },
  );
  it('explains access-removal hold without awarding or silently excluding anyone', () => {
    const html = history({ status: 'owner_decision_required' });
    expect(html).toContain('Completion is blocked for the owner to decide');
    expect(html).not.toContain('value="approved"');
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
  it('does not render approval for a contradictory non-passing check state', () => {
    const html = history({ automated_state: 'failed' }, true);
    expect(html).not.toContain('value="approved"');
    expect(html).not.toContain('/api/raids/artifact');
  });
  it('pauses mentor controls and downloads after an unconfirmed read, retaining feedback fields', () => {
    const html = renderToStaticMarkup(
      createElement(RaidHistory, { attempts: [attempt], canReview: true, paused: true }),
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('Your feedback stays in this form');
    expect(html).toContain('name="feedback"');
    expect(html).not.toContain('/api/raids/artifact');
  });
  it('does not call a changed current team the frozen team of an earlier revision', () => {
    const initial: RaidView = {
      team: {
        id: 'current',
        name: 'Current team name',
        mentor: 'Current mentor',
        members: [
          { id: 'x', displayName: 'New A' },
          { id: 'y', displayName: 'New B' },
          { id: 'z', displayName: 'New C' },
        ],
      },
      attempts: [attempt],
      can_submit: false,
      can_review: false,
    };
    const html = renderToStaticMarkup(
      createElement(RaidPanel, {
        cohort: 'cohort',
        node: 'raid',
        initial,
        rules: { required_files: ['raid.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      }),
    );
    expect(html).toContain('Current team name');
    expect(html).toContain('Frozen members: A, B, C');
    expect(html).not.toContain('Frozen members: New A');
  });
  it('keeps missing backend configuration read-only instead of inventing a team or upload', () => {
    const html = renderToStaticMarkup(
      createElement(RaidPanel, {
        cohort: 'cohort',
        node: 'raid',
        initial: null,
        brief: createElement('p', null, 'Actual authorized published brief'),
        rules: { required_files: ['raid.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
      }),
    );
    expect(html).toContain('Actual authorized published brief');
    expect(html).toContain('unavailable in this environment');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('value="approved"');
  });
  it('does not convert a review-only receipt into completion or a different decision', () => {
    const id = '10000000-0000-4000-8000-000000000001';
    expect(raidReviewReceiptMessage({ review_id: id }, 'approved')).toContain(
      'before treating this Raid as complete',
    );
    expect(raidReviewReceiptMessage({ review_id: id }, 'changes_requested')).toBe(
      'Changes requested for this revision.',
    );
    expect(raidReviewReceiptMessage({ review_id: id, outcome_id: id }, 'approved')).toBe(
      'Shared completion recorded.',
    );
    expect(
      raidReviewReceiptMessage({ review_id: 'unconfirmed', outcome_id: id }, 'approved'),
    ).toBeNull();
    expect(
      raidReviewReceiptMessage({ review_id: id, outcome_id: 'not-an-outcome' }, 'approved'),
    ).toBeNull();
  });
});
