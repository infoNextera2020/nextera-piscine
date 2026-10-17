import { describe, expect, it } from 'vitest';
import {
  canAccessCohort,
  canReadSubject,
  curriculumRoots,
  initialNodeProgress,
  prerequisitesSatisfied,
  presentNode,
  type DomainUser,
  type Prerequisite,
} from '../index';

const edges: Prerequisite[] = [{ from: 'hello-go', to: 'even-or-odd', rule: 'requires_pass' }];
describe('initial progression and visibility', () => {
  it('finds roots deterministically without relying on node/edge ordering', () => {
    expect(curriculumRoots(['other-root', 'even-or-odd', 'hello-go'], edges)).toEqual([
      'hello-go',
      'other-root',
    ]);
  });
  it('initializes every node with exactly the required timestamp matrix', () => {
    const at = new Date('2026-11-20T00:00:00Z');
    expect(initialNodeProgress(['hello-go', 'even-or-odd'], edges, at)).toEqual([
      {
        nodeKey: 'even-or-odd',
        state: 'locked',
        unlockedAt: null,
        startedAt: null,
        masteredAt: null,
        firstPassingSubmissionId: null,
      },
      {
        nodeKey: 'hello-go',
        state: 'available',
        unlockedAt: at,
        startedAt: null,
        masteredAt: null,
        firstPassingSubmissionId: null,
      },
    ]);
  });
  it('requires every prerequisite to be mastered, including missing-state denial', () => {
    const both: Prerequisite[] = [
      ...edges,
      { from: 'second', to: 'even-or-odd', rule: 'requires_pass' },
    ];
    expect(prerequisitesSatisfied('even-or-odd', both, new Map([['hello-go', 'mastered']]))).toBe(
      false,
    );
    expect(
      prerequisitesSatisfied(
        'even-or-odd',
        both,
        new Map([
          ['hello-go', 'mastered'],
          ['second', 'in_progress'],
        ]),
      ),
    ).toBe(false);
    expect(
      prerequisitesSatisfied(
        'even-or-odd',
        both,
        new Map([
          ['hello-go', 'mastered'],
          ['second', 'mastered'],
        ]),
      ),
    ).toBe(true);
  });
  it.each(['available', 'in_progress', 'mastered'] as const)(
    'allows reading %s without changing its state',
    (state) => expect(canReadSubject(state)).toBe(true),
  );
  it('hides locked subjects and explains AND prerequisites', () => {
    expect(presentNode('locked', ['Hello Go', 'Second'])).toEqual({
      label: 'LOCKED',
      accessible: false,
      lockedReason: 'Requires passing all prerequisites: Hello Go, Second.',
    });
  });
  it.each([
    [{ from: 'unknown', to: 'hello-go', rule: 'requires_pass' }],
    [{ from: 'hello-go', to: 'hello-go', rule: 'requires_pass' }],
    [...edges, { from: 'even-or-odd', to: 'hello-go', rule: 'requires_pass' }],
    [...edges, ...edges],
  ])('rejects invalid prerequisite graph %#', (...graph) =>
    expect(() => curriculumRoots(['hello-go', 'even-or-odd'], graph as Prerequisite[])).toThrow(),
  );
});
describe('cohort authorization policy', () => {
  const user: DomainUser = {
    id: 'domain',
    authUserId: 'auth',
    displayName: 'Learner',
    active: true,
    role: 'learner',
  };
  it('requires active membership for learners and operators', () => {
    for (const role of ['learner', 'operator'] as const) {
      expect(canAccessCohort({ ...user, role }, 'active')).toBe(true);
      expect(canAccessCohort({ ...user, role }, 'inactive')).toBe(false);
      expect(canAccessCohort({ ...user, role }, null)).toBe(false);
    }
  });
  it('allows active admins an explicit read-only preview, and denies inactive users', () => {
    expect(canAccessCohort({ ...user, role: 'admin' }, null)).toBe(true);
    expect(canAccessCohort({ ...user, role: 'admin', active: false }, 'active')).toBe(false);
  });
});
