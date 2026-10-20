import { describe, expect, it } from 'vitest';
import type { LearningOverview } from './types';
import type { CheckpointView } from '@nextera/db/checkpoints';
import { projectEvidence } from './evidence';
const at = '2026-10-20T09:00:00Z';
function overview(): LearningOverview {
  return {
    nodes: [],
    modules: [],
    current: null,
    checkpoint: null,
    checkpointStatus: null,
    currentDescription: null,
    updates: [],
    submissions: [],
    counts: {
      total: 0,
      mastered: 0,
      challenges: 0,
      challengesPassed: 0,
      checkpoints: 0,
      checkpointsPassed: 0,
      projects: 0,
      projectsActive: 0,
      available: 0,
      started: 0,
    },
  };
}
function checkpoint(): CheckpointView {
  return {
    server_now: at,
    eligible: false,
    attempt: null,
    tasks: [],
    submissions: [],
    history: [],
    replacement_available: false,
  };
}
describe('evidence projections', () => {
  it('does not invent mastery from a passed submission', () => {
    const v = overview();
    v.submissions = [{ id: 's', title: 'Challenge', state: 'passed', at, href: '/subject' }];
    expect(projectEvidence(v, [], 'cohort')).toEqual([]);
  });
  it('keeps all learner verdicts distinct from infrastructure', () => {
    const v = overview();
    v.submissions = ['failed', 'compile_error', 'runtime_error', 'timeout', 'system_error'].map(
      (state, i) => ({
        id: String(i),
        title: 'Challenge',
        state: state as LearningOverview['submissions'][number]['state'],
        at,
        href: '/subject',
      }),
    );
    const records = projectEvidence(v, [], 'cohort');
    expect(records.filter((r) => r.category === 'learner').map((r) => r.state)).toEqual([
      'failed',
      'compile_error',
      'runtime_error',
      'timeout',
    ]);
    expect(records.filter((r) => r.category === 'system').map((r) => r.state)).toEqual([
      'system_error',
    ]);
  });
  it('requires an actual outcome identity before rendering a checkpoint outcome', () => {
    const cp = checkpoint();
    cp.history = [
      {
        id: 'attempt',
        status: 'passed',
        points: 3,
        normal_slot: 1,
        kind: 'normal',
        started_at: at,
        deadline_at: at,
        completed_at: at,
        outcome_id: null,
      },
    ];
    expect(
      projectEvidence(overview(), [{ key: 'gate', title: 'Gate', view: cp }], 'cohort'),
    ).toEqual([]);
    cp.history[0]!.outcome_id = 'receipt';
    const records = projectEvidence(
      overview(),
      [{ key: 'gate', title: 'Gate', view: cp }],
      'cohort',
    );
    expect(records[0]).toMatchObject({
      category: 'checkpoint',
      identity: 'receipt',
      state: 'passed',
    });
    expect(records.some((r) => r.category === 'mastery' || r.category === 'unlock')).toBe(false);
  });
  it('keeps infrastructure-blocked outcome history separate from learner failure', () => {
    const cp = checkpoint();
    cp.history = [
      {
        id: 'attempt',
        status: 'infrastructure_blocked',
        points: 2,
        normal_slot: 1,
        kind: 'normal',
        started_at: at,
        deadline_at: at,
        completed_at: at,
        outcome_id: 'receipt',
      },
    ];
    const records = projectEvidence(
      overview(),
      [{ key: 'gate', title: 'Gate', view: cp }],
      'cohort',
    );
    expect(records.map((r) => r.category).sort()).toEqual(['checkpoint', 'system']);
    expect(records.some((r) => r.category === 'learner')).toBe(false);
  });
});

it('deduplicates task submissions shared by overview and checkpoint history', () => {
  const v = overview();
  v.submissions = [{ id: 'shared', title: 'Gate', state: 'system_error', at, href: '/gate' }];
  const cp = checkpoint();
  cp.submissions = [{ id: 'shared', task_key: 'task', state: 'system_error', created_at: at }];
  const records = projectEvidence(v, [{ key: 'gate', title: 'Gate', view: cp }], 'cohort');
  expect(records).toHaveLength(1);
  expect(records[0]?.source).toBe('Safe checkpoint task history');
});
