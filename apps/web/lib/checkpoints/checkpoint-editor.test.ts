import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CheckpointView } from '@nextera/db/checkpoints';
import { checkpointPresentation } from '../learning/checkpoint-presentation';
import { Checkpoint } from './checkpoint';
function view(count = 10, status = 'active'): CheckpointView {
  return {
    server_now: '2026-10-27T09:00:00Z',
    eligible: true,
    replacement_available: false,
    attempt: {
      id: 'attempt',
      status,
      normal_slot: 1,
      kind: 'normal',
      started_at: '2026-10-27T08:00:00Z',
      deadline_at: '2026-10-27T09:30:00Z',
      completed_at: null,
      retake_at: null,
    },
    tasks: Array.from({ length: count }, (_, i) => ({
      key: `question-${i}`,
      title: `Authored question ${i + 1}`,
      passed: false,
      reserved: 0,
      subject: '## Authored brief\n\n```go\nfunc Answer() {}\n```',
      rules: { required_files: ['answer.go'], max_size_kb: 256 },
    })),
    submissions: [],
    history: [],
  };
}
function html(raw: CheckpointView) {
  return renderToStaticMarkup(
    createElement(Checkpoint, {
      cohort: 'cohort',
      node: 'exam',
      title: 'Published checkpoint title',
      initial: checkpointPresentation(raw),
    }),
  );
}
describe('Checkpoint internal editor presentation', () => {
  it.each([1, 4, 10, 12])(
    'renders %i authoritative questions with unrestricted navigation, not a fixed sample exam',
    (count) => {
      const markup = html(view(count));
      expect((markup.match(/class="[^"]*question[^"]*" aria-pressed=/g) ?? []).length).toBe(count);
      expect(markup).toContain(`${count} questions`);
      expect(markup).toContain('Published checkpoint title');
      expect(markup).not.toContain('Pass 3 of 4');
      expect(markup).not.toContain('90 trusted minutes');
      expect(markup).not.toContain('type="file"');
      expect(markup).toContain('<textarea');
    },
  );
  it('keeps saving and Run honestly unavailable without configured production backends', () => {
    const markup = html(view());
    expect(markup).toContain('Autosave unavailable');
    expect(markup).not.toContain('Saved to server');
    expect(markup).toContain('Run unavailable');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="checkpoint-run-status"/);
    expect(markup).toContain('No Run has been started');
    expect(markup).toContain('leaving or refreshing can lose them');
    expect(markup).not.toContain('Saving…');
    expect(markup).not.toContain('Run completed');
  });
  it('retains authored statement and exact filename, history and finish review', () => {
    const markup = html(view());
    expect(markup).toContain('Authored brief');
    expect(markup).toContain('answer.go');
    expect(markup).toContain('Official submission history');
    expect(markup).toContain('Review &amp; finish');
    expect(markup).toContain('Keep working');
    expect(markup).toContain('aria-label="Checkpoint questions"');
    expect(markup).toContain('aria-label="Source code for Authored question 1"');
  });
  it.each(['evaluating', 'passed', 'failed', 'infrastructure_blocked'])(
    'keeps %s source read-only without inventing a new outcome',
    (status) => {
      const markup = html(view(3, status));
      expect(markup).toContain('readOnly=""');
      expect(markup).not.toContain('Review &amp; finish');
      if (status === 'evaluating') expect(markup).not.toContain('View authoritative result');
    },
  );
  it('does not reveal questions before a legitimate attempt', () => {
    const raw = view(0);
    raw.attempt = null;
    raw.eligible = false;
    const markup = html(raw);
    expect(markup).not.toContain('<textarea');
    expect(markup).toContain('This checkpoint is locked');
    expect(markup).not.toContain('Start checkpoint');
  });
});
