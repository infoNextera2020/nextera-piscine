import { describe, expect, it } from 'vitest';
import type { CheckpointView } from '@nextera/db/checkpoints';
import { checkpointPresentation } from './checkpoint-presentation';
function view(status = 'active'): CheckpointView {
  return {
    server_now: '2026-10-20T09:00:00Z',
    eligible: true,
    replacement_available: false,
    attempt: {
      id: 'attempt',
      status,
      normal_slot: 1,
      kind: 'normal',
      started_at: '2026-10-20T08:00:00Z',
      deadline_at: '2026-10-20T09:30:00Z',
      completed_at: null,
      retake_at: null,
    },
    tasks: ['a', 'b', 'c', 'd'].map((key) => ({
      key,
      title: key,
      passed: false,
      reserved: 0,
      subject: 'Task',
      rules: { required_files: ['task.go'], max_size_kb: 256 },
    })),
    submissions: [],
    history: [],
  };
}
describe('trusted checkpoint presentation', () => {
  it('never infers a final outcome from task passes', () => {
    const v = view();
    v.tasks.forEach((t) => {
      t.passed = true;
    });
    const result = checkpointPresentation(v);
    expect(result.attempt?.status).toBe('active');
    expect(result.display.startAvailable).toBe(false);
  });
  it('closes the display action at trusted expiry without finalizing accepted work', () => {
    const v = view();
    v.server_now = v.attempt!.deadline_at;
    const result = checkpointPresentation(v);
    expect(result.display.intakeOpen).toBe(false);
    expect(result.display.expiredAwaitingEvaluation).toBe(true);
    expect(result.attempt?.status).toBe('active');
    expect(result.display.tasks.every((t) => !t.submitAvailable)).toBe(true);
  });
  it('uses server reservation counts, not a truncated history, for action hints', () => {
    const v = view();
    v.tasks[0]!.reserved = 3;
    const result = checkpointPresentation(v);
    expect(result.display.tasks[0]?.submitAvailable).toBe(false);
    expect(result.display.tasks[1]?.submitAvailable).toBe(true);
  });
  it('keeps infrastructure separate and preserves the server quota', () => {
    const v = view();
    v.submissions = [{ id: 's', task_key: 'a', state: 'system_error', created_at: v.server_now }];
    const result = checkpointPresentation(v);
    expect(result.display.tasks[0]?.state).toBe('system_error');
    expect(result.tasks[0]?.reserved).toBe(0);
    expect(result.display.tasks[0]?.submitAvailable).toBe(true);
  });
  it('does not invent replacement access for an infrastructure block', () => {
    const v = view('infrastructure_blocked');
    expect(checkpointPresentation(v).display.startAvailable).toBe(false);
    v.replacement_available = true;
    expect(checkpointPresentation(v).display.startAvailable).toBe(true);
    v.eligible = false;
    expect(checkpointPresentation(v).display.startAvailable).toBe(false);
  });
  it('uses trusted read time for retake hints and denies exhausted attempts', () => {
    const v = view('failed');
    v.attempt!.retake_at = '2026-10-21T09:00:00Z';
    expect(checkpointPresentation(v).display.startAvailable).toBe(false);
    v.server_now = v.attempt!.retake_at;
    expect(checkpointPresentation(v).display.startAvailable).toBe(true);
    v.attempt!.normal_slot = 2;
    expect(checkpointPresentation(v).display.startAvailable).toBe(false);
  });
  it('never regresses a stored task pass because of later failure history', () => {
    const v = view();
    v.tasks[0]!.passed = true;
    v.submissions = [{ id: 'later', task_key: 'a', state: 'failed', created_at: v.server_now }];
    expect(checkpointPresentation(v).display.tasks[0]).toMatchObject({
      state: 'passed',
      submitAvailable: false,
    });
  });
});
