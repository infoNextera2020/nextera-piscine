import { describe, it, expect } from 'vitest';
import {
  parseCheckpointView,
  checkpointAnswerFormat,
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

describe('explicit Checkpoint answer formats preserve source-only legacy reads', () => {
  it('accepts explicit coding, trace and debugging shapes without adding assessment policy', () => {
    const current = fixture(3);
    current.tasks[0]!.answer_format = { version: 1, kind: 'coding' };
    current.tasks[1]!.answer_format = { version: 1, kind: 'trace_with_reason' };
    current.tasks[1]!.rules.required_files = [];
    current.tasks[2]!.answer_format = { version: 1, kind: 'debug_with_reason' };
    expect(parseCheckpointView(current)).toEqual(current);
    expect(parseCheckpointView(current).policy).toBeUndefined();
    expect(checkpointAnswerFormat(undefined)).toEqual({ version: 1, kind: 'coding' });
  });
  it.each([
    null,
    {},
    { version: 2, kind: 'trace_with_reason' },
    { version: 1, kind: 'trace' },
    { version: 1, kind: 'trace_with_reason', grader: true },
  ])('rejects unsupported answer format %#', (answer_format) => {
    const current = fixture(1);
    expect(() =>
      parseCheckpointView({
        ...current,
        tasks: [{ ...current.tasks[0], answer_format }],
      }),
    ).toThrow('CHECKPOINT_VIEW_UNAVAILABLE');
  });
  it('does not give trace responses a source file or accept a missing debug file', () => {
    const current = fixture(1);
    current.tasks[0]!.answer_format = { version: 1, kind: 'trace_with_reason' };
    expect(() => parseCheckpointView(current)).toThrow();
    current.tasks[0]!.answer_format = { version: 1, kind: 'debug_with_reason' };
    current.tasks[0]!.rules.required_files = [];
    expect(() => parseCheckpointView(current)).toThrow();
  });
});

describe('answer format accepts exact own fields without kind coercion', () => {
  it.each([
    ['coding'],
    ['trace_with_reason'],
    ['debug_with_reason'],
    [],
    {},
    { toString: () => 'coding' },
    1,
    true,
    null,
  ])('rejects a non-string kind %#', (kind) => {
    expect(() => checkpointAnswerFormat({ version: 1, kind })).toThrow(
      'CHECKPOINT_VIEW_UNAVAILABLE',
    );
  });
  it.each(['version', 'kind'])(
    'rejects inherited %s even with the expected own-key count',
    (field) => {
      const format: Record<string, unknown> = { version: 1, kind: 'coding' };
      const inherited = { [field]: format[field] };
      delete format[field];
      const candidate = Object.assign(Object.create(inherited), format, { unknown: true });
      expect(() => checkpointAnswerFormat(candidate)).toThrow('CHECKPOINT_VIEW_UNAVAILABLE');
    },
  );
  it('rejects unknown non-enumerable and symbol own fields', () => {
    for (const key of ['unknown', Symbol('unknown')]) {
      const candidate = Object.defineProperty({ version: 1, kind: 'coding' }, key, { value: true });
      expect(() => checkpointAnswerFormat(candidate)).toThrow('CHECKPOINT_VIEW_UNAVAILABLE');
    }
  });
});
