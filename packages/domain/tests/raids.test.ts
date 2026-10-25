import { describe, expect, it } from 'vitest';
import { assertRaidRoster, assertRaidReview, raidStatus } from '../raids';

const review = {
  reviewer: 'mentor',
  assignedMentor: 'mentor',
  reviewerActive: true,
  memberIds: ['a', 'b', 'c'],
  automated: 'passed' as const,
  accessRemoved: false,
  currentAttempt: true,
};
describe('approved shared Raid contract', () => {
  it.each(
    [[], ['a'], ['a', 'b'], ['a', 'b', 'c', 'd'], ['a', 'a', 'b'], ['a', 'b', '']].map(
      (members) => ({ members }),
    ),
  )('rejects an invalid roster $members', ({ members }) => {
    expect(() => assertRaidRoster(members)).toThrow('RAID_REQUIRES_THREE_MEMBERS');
  });
  it('accepts exactly three distinct members', () =>
    expect(() => assertRaidRoster(['a', 'b', 'c'])).not.toThrow());
  it('allows only the assigned active reviewer outside the frozen roster', () => {
    expect(() => assertRaidReview(review)).not.toThrow();
    expect(() => assertRaidReview({ ...review, reviewer: 'other' })).toThrow(
      'RAID_REVIEW_FORBIDDEN',
    );
    expect(() => assertRaidReview({ ...review, reviewerActive: false })).toThrow(
      'RAID_REVIEW_FORBIDDEN',
    );
    expect(() => assertRaidReview({ ...review, reviewer: 'a', assignedMentor: 'a' })).toThrow(
      'RAID_REVIEW_FORBIDDEN',
    );
  });
  it.each([
    'queued',
    'running',
    'failed',
    'compile_error',
    'runtime_error',
    'timeout',
    'system_error',
    'cancelled',
  ] as const)('rejects review before authoritative automated PASS (%s)', (automated) =>
    expect(() => assertRaidReview({ ...review, automated })).toThrow('RAID_CHECKS_NOT_PASSED'),
  );
  it('blocks all automatic award when any frozen member loses access', () => {
    expect(() => assertRaidReview({ ...review, accessRemoved: true })).toThrow(
      'RAID_OWNER_DECISION_REQUIRED',
    );
    expect(raidStatus({ automated: 'passed', review: 'approved', accessRemoved: true })).toBe(
      'owner_decision_required',
    );
  });
  it('rejects stale review after a new accepted revision', () =>
    expect(() => assertRaidReview({ ...review, currentAttempt: false })).toThrow(
      'RAID_ATTEMPT_SUPERSEDED',
    ));
  it('never infers completion from automated PASS or a projected review', () => {
    expect(raidStatus({ automated: 'passed' })).toBe('awaiting_review');
    expect(raidStatus({ automated: 'passed', review: 'approved' })).toBe('awaiting_review');
    expect(raidStatus({ automated: 'passed', completed: true })).toBe('completed');
  });
  it('preserves historical completion without restoring current access', () =>
    expect(
      raidStatus({ automated: 'failed', completed: true, accessRemoved: true, superseded: true }),
    ).toBe('completed'));
  it('separates infrastructure/cancellation from changes required', () => {
    expect(raidStatus({ automated: 'system_error' })).toBe('attention_required');
    expect(raidStatus({ automated: 'cancelled' })).toBe('attention_required');
    expect(raidStatus({ automated: 'failed' })).toBe('changes_required');
    expect(raidStatus({ automated: 'passed', review: 'changes_requested' })).toBe(
      'changes_required',
    );
  });
});
