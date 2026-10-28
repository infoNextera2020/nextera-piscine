import { describe, it, expect } from 'vitest';
import {
  parseCheckpointView,
  checkpointScoringMetadata,
  type CheckpointView,
} from '../checkpoint-view';
function fixture(count = 10): CheckpointView {
  const attempt = {
    id: 'current',
    status: 'active',
    normal_slot: 1,
    kind: 'normal',
    started_at: '2026-10-28T09:00:00Z',
    deadline_at: '2026-10-28T10:30:00Z',
    completed_at: null,
    retake_at: null,
  };
  return {
    server_now: '2026-10-28T09:10:00Z',
    eligible: true,
    replacement_available: false,
    attempt,
    tasks: Array.from({ length: count }, (_, i) => ({
      key: 'q-' + i,
      title: 'Task ' + i,
      passed: false,
      reserved: 0,
      subject: 'Published subject',
      rules: { required_files: ['answer.go'], max_size_kb: 256 },
    })),
    submissions: [],
    history: [],
  };
}
describe('versioned checkpoint read projection', () => {
  it('preserves legacy unknown policy without assigning a threshold', () => {
    const f = fixture();
    expect(parseCheckpointView(f)).toEqual(f);
    expect(parseCheckpointView(f).policy).toBeUndefined();
    expect(checkpointScoringMetadata(undefined)).toBeNull();
  });
  it('accepts explicit dynamic policy bound to current task count', () => {
    const f = fixture();
    f.policy = { policy_version: 2, task_count: 10, pass_points: 7 };
    expect(parseCheckpointView(f).policy?.pass_points).toBe(7);
  });
  it('keeps a historical policy independent from the current frozen policy', () => {
    const f = fixture();
    f.policy = { policy_version: 2, task_count: 10, pass_points: 7 };
    f.history = [
      {
        id: 'older',
        status: 'passed',
        normal_slot: 1,
        kind: 'normal',
        started_at: f.attempt!.started_at,
        deadline_at: f.attempt!.deadline_at,
        completed_at: '2026-10-28T10:30:00Z',
        points: 3,
        outcome_id: 'outcome',
        policy: { policy_version: 1, task_count: 4, pass_points: 3 },
      },
    ];
    expect(parseCheckpointView(f).history[0]!.policy?.task_count).toBe(4);
  });
  it('accepts metadata before an attempt without inventing task subjects', () => {
    const f = fixture();
    f.attempt = null;
    f.tasks = [];
    f.policy = { policy_version: 2, task_count: 10, pass_points: 7 };
    expect(parseCheckpointView(f).tasks).toEqual([]);
  });
  it.each([
    {},
    { policy_version: 2, task_count: 10 },
    { policy_version: 2, task_count: 10, pass_points: null },
    { policy_version: 2, task_count: 10, pass_points: 11 },
    { policy_version: 2, task_count: 0, pass_points: 1 },
    { policy_version: 2, task_count: 10, pass_points: 1.5 },
    { policy_version: 1, task_count: 10, pass_points: 3 },
    { policy_version: 3, task_count: 10, pass_points: 7 },
    { policy_version: 2, task_count: 10, pass_points: 7, extra: true },
  ])('rejects absent/unsafe explicit metadata %#', (p) =>
    expect(() => checkpointScoringMetadata(p)).toThrow('CHECKPOINT_VIEW_UNAVAILABLE'),
  );
  it('rejects current count mismatch or substituted current historical policy', () => {
    const f = fixture();
    f.policy = { policy_version: 2, task_count: 9, pass_points: 7 };
    expect(() => parseCheckpointView(f)).toThrow();
    f.policy = { policy_version: 2, task_count: 10, pass_points: 7 };
    f.history = [
      {
        ...f.attempt!,
        id: 'current',
        points: null,
        outcome_id: null,
        policy: { policy_version: 2, task_count: 10, pass_points: 8 },
      },
    ];
    expect(() => parseCheckpointView(f)).toThrow();
  });
  it.each([
    { points: 11, status: 'passed' },
    { points: 6, status: 'passed' },
    { points: 7, status: 'failed' },
    { points: 7, status: 'infrastructure_blocked' },
  ])('rejects inconsistent authoritative score metadata %#', (value) => {
    const f = fixture();
    f.history = [
      {
        ...f.attempt!,
        ...value,
        id: 'older',
        outcome_id: 'outcome',
        policy: { policy_version: 2, task_count: 10, pass_points: 7 },
      },
    ];
    expect(() => parseCheckpointView(f)).toThrow();
  });
  it.each(['tasks', 'history', 'submissions'])('rejects malformed arrays %s', (key) => {
    const f = { ...fixture(), [key]: null };
    expect(() => parseCheckpointView(f)).toThrow();
  });
  it('rejects duplicate tasks, invalid clocks and nonboolean eligibility', () => {
    const f = fixture();
    f.tasks[1]!.key = f.tasks[0]!.key;
    expect(() => parseCheckpointView(f)).toThrow();
    expect(() => parseCheckpointView({ ...fixture(), server_now: 'invalid' })).toThrow();
    expect(() => parseCheckpointView({ ...fixture(), eligible: 'true' })).toThrow();
  });
  it('validates feedback text while allowing the real no-result null feedback', () => {
    const f = fixture();
    f.submissions = [
      { id: 'receipt', task_key: 'q-1', state: 'queued', created_at: f.server_now, feedback: null },
    ];
    expect(parseCheckpointView(f).submissions[0]!.feedback).toBeNull();
    expect(() =>
      parseCheckpointView({
        ...f,
        submissions: [{ ...f.submissions[0], feedback: { message: 1 } }],
      }),
    ).toThrow();
  });
});
