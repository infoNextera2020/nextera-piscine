import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { projectLearning, type MapRow } from './projection';
const at = new Date('2026-10-19T10:00:00Z');
const row = (key: string, state: MapRow['state'] = 'available', quest = 'go'): MapRow => ({
  nodeKey: key,
  title: key,
  kind: 'challenge',
  questKey: quest,
  questTitle: 'Foundations',
  state,
  skills: ['go'],
  startedAt: state === 'in_progress' || state === 'mastered' ? at : null,
  unlockedAt: state === 'locked' ? null : at,
  masteredAt: state === 'mastered' ? at : null,
});
describe('trusted learning presentation', () => {
  it('keeps a stored locked node locked even when prerequisite display data appears satisfied', () => {
    const view = projectLearning(
      [row('first', 'mastered'), row('second', 'locked')],
      [{ from: 'first', to: 'second', rule: 'requires_pass' }],
      'learner',
      'cohort',
    );
    expect(view.nodes[1]).toMatchObject({ state: 'locked', href: null, prerequisites: ['first'] });
    expect(view.nodes[1]!.lockedReason).toContain('Requires passing all prerequisites: first.');
    expect(view.counts.mastered).toBe(1);
  });
  it('counts checkpoint mastery only from the checkpoint node', () => {
    const cp = { ...row('gate'), kind: 'checkpoint' };
    const view = projectLearning(
      [row('a', 'mastered'), row('b', 'mastered'), row('c', 'mastered'), cp],
      [],
      'learner',
      'cohort',
    );
    expect(view.counts).toMatchObject({ mastered: 3, checkpoints: 1, checkpointsPassed: 0 });
    expect(view.nodes[3]!.href).toBe('/app/cohorts/cohort/checkpoints/gate');
  });
  it('does not imply personal progress or evidence in an operator preview', () => {
    const view = projectLearning([row('done', 'mastered')], [], 'operator', 'cohort');
    expect(view.nodes[0]).toMatchObject({
      state: null,
      label: 'PREVIEW',
      startedAt: null,
      masteredAt: null,
    });
    expect(view.current).toBeNull();
    expect(view.counts.mastered).toBe(0);
    expect(view.nodes[0]!.href).toBe('/app/cohorts/cohort/challenges/done');
  });
  it('groups by committed quest identity rather than a potentially duplicate title', () => {
    const view = projectLearning(
      [row('a', 'available', 'first'), row('b', 'available', 'second')],
      [],
      'learner',
      'cohort',
    );
    expect(view.modules.map((m) => m.key)).toEqual(['first', 'second']);
  });
  it('selects already started work before a merely available node', () => {
    const view = projectLearning([row('a'), row('b', 'in_progress')], [], 'learner', 'cohort');
    expect(view.current?.key).toBe('b');
  });
  it('rejects missing progress instead of presenting fabricated zero progress', () => {
    expect(() => projectLearning([row('a', null)], [], 'learner', 'cohort')).toThrow(
      'incomplete progress',
    );
  });
  it('rejects unsupported node kinds', () => {
    expect(() =>
      projectLearning([{ ...row('a'), kind: 'invented' }], [], 'learner', 'cohort'),
    ).toThrow('Unsupported curriculum');
  });
  it('leaves an empty cohort empty, with no prototype metrics or sample work', () => {
    const view = projectLearning([], [], 'learner', 'cohort');
    expect(view.nodes).toEqual([]);
    expect(view.modules).toEqual([]);
    expect(view.current).toBeNull();
    expect(view.counts.total).toBe(0);
  });
});
