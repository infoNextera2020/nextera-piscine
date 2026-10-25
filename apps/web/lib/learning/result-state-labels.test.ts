import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CheckpointView } from '@nextera/db/checkpoints';
import { Checkpoint } from '../checkpoints/checkpoint';
import { ChallengeHistory } from '../../components/learning/challenge';
import { SafeHistory } from '../../components/learning/workspace-parts';
import { checkpointPresentation } from './checkpoint-presentation';
import { displayState } from './display';
function raw(reserved = 3): CheckpointView {
  return {
    server_now: '2026-10-25T09:00:00Z',
    eligible: true,
    replacement_available: false,
    attempt: {
      id: 'attempt',
      status: 'active',
      normal_slot: 1,
      kind: 'normal',
      started_at: '2026-10-25T08:00:00Z',
      deadline_at: '2026-10-25T09:30:00Z',
      completed_at: null,
      retake_at: null,
    },
    history: [],
    submissions: [],
    tasks: [
      {
        key: 'task',
        title: 'Task',
        subject: 'Published task',
        rules: { required_files: ['task.go'], max_size_kb: 256 },
        reserved,
        passed: false,
      },
    ],
  };
}
describe('result labels preserve server state and quota facts', () => {
  it('labels the existing cancelled state without classifying it as learner failure', () => {
    expect(displayState('cancelled')).toBe('Cancelled');
    const html = renderToStaticMarkup(
      createElement(SafeHistory, { items: [{ id: 's', state: 'cancelled' }] }),
    );
    expect(html).toContain('Cancellation is not a learner failure.');
    expect(html).not.toContain('Infrastructure issue.');
  });
  it('does not call a quota-full task Open or offer upload', () => {
    const view = checkpointPresentation(raw());
    const html = renderToStaticMarkup(
      createElement(Checkpoint, { cohort: 'assigned', node: 'gate', initial: view }),
    );
    expect(html).toContain('No slots available');
    expect(html).not.toContain('>Open<');
    expect(html).not.toContain('Submit checkpoint task');
    expect(view.tasks[0]?.reserved).toBe(3);
  });
  it('keeps cancellation visible without changing server reservation counts or existing action hints', () => {
    for (const reserved of [2, 3]) {
      const input = raw(reserved);
      input.submissions = [
        { id: 's', task_key: 'task', state: 'cancelled', created_at: input.server_now },
      ];
      const view = checkpointPresentation(input);
      expect(view.display.tasks[0]?.state).toBe('cancelled');
      expect(input.tasks[0]?.reserved).toBe(reserved);
      expect(view.tasks[0]?.reserved).toBe(reserved);
      expect(view.display.tasks[0]?.submitAvailable).toBe(reserved < 3);
    }
  });
  it('does not let cancellation regress an existing stored task pass', () => {
    const input = raw();
    input.tasks[0]!.passed = true;
    input.submissions = [
      { id: 's', task_key: 'task', state: 'cancelled', created_at: input.server_now },
    ];
    expect(checkpointPresentation(input).display.tasks[0]).toMatchObject({
      state: 'passed',
      submitAvailable: false,
    });
  });
  it('shows project passing receipts without claiming project mastery or unlock', () => {
    const html = renderToStaticMarkup(
      createElement(ChallengeHistory, {
        kind: 'project',
        items: [
          {
            id: 's',
            node_key: 'project',
            state: 'passed',
            created_at: '2026-10-25T09:00:00Z',
            feedback: null,
          },
        ],
      }),
    );
    expect(html).toContain('does not by itself confirm project completion or unlock further work');
    expect(html).not.toContain('project mastered');
  });
});

it('does not offer a system retry label when the server action hint is unavailable', () => {
  const input = raw(3);
  input.submissions = [
    { id: 's', task_key: 'task', state: 'system_error', created_at: input.server_now },
  ];
  const view = checkpointPresentation(input);
  const html = renderToStaticMarkup(
    createElement(Checkpoint, { cohort: 'assigned', node: 'gate', initial: view }),
  );
  expect(html).toContain('Infrastructure issue');
  expect(html).not.toContain('System retry');
  expect(html).not.toContain('Submit checkpoint task');
  expect(view.tasks[0]?.reserved).toBe(3);
});
