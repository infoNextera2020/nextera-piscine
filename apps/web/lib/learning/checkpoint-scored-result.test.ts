import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CheckpointView } from '@nextera/domain';
import { CheckpointResult } from '../../components/learning/checkpoint-result';
import { checkpointPresentation } from './checkpoint-presentation';
import { checkpointResultHref } from './checkpoint-result-link';
import type { LearningOverview } from './types';
vi.mock('../../components/learning/refresh-learning', () => ({ RefreshLearning: () => null }));
vi.mock('../../components/learning/hairline-figure', () => ({ HairlineFigure: () => null }));
vi.mock('../../components/learning/design-exploration', () => ({
  LearningSurface: ({ children }: { children: ReactNode }) =>
    createElement('section', null, children),
}));
const id = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const metadata = (form: 'A' | 'B') => ({
  version: 1 as const,
  form,
  rubric_digest: (form === 'A' ? 'b' : 'c').repeat(64),
  duration_seconds: 10800 as const,
  normal_attempts: 1 as const,
});
function fixture(): CheckpointView {
  const common = {
    kind: 'normal' as const,
    normal_slot: 1,
    started_at: '2026-10-31T08:00:00Z',
    deadline_at: '2026-10-31T11:00:00Z',
    completed_at: '2026-10-31T11:00:00Z',
    retake_at: null,
  };
  const current = {
    ...common,
    id: id(1),
    status: 'passed',
    points: null,
    outcome_id: null,
    scored_exam: metadata('A'),
    scored_result: {
      version: 1 as const,
      status: 'passed' as const,
      total_points: 80,
      coding_points: 60,
      outcome_id: id(101),
    },
  };
  const historical = {
    ...common,
    id: id(2),
    status: 'failed',
    points: null,
    outcome_id: null,
    scored_exam: metadata('B'),
    scored_result: {
      version: 1 as const,
      status: 'failed' as const,
      total_points: 50,
      coding_points: 40,
      outcome_id: id(102),
    },
  };
  return {
    server_now: '2026-10-31T12:00:00Z',
    eligible: true,
    replacement_available: false,
    scored_exam: current.scored_exam,
    scored_result: current.scored_result,
    attempt: current,
    tasks: Array.from({ length: 8 }, (_, index) => ({
      key: 'q' + (index + 1),
      title: 'Synthetic task',
      subject: 'Synthetic contract',
      passed: false,
      reserved: 1,
      rules: { required_files: index === 5 || index === 6 ? [] : ['answer.go'], max_size_kb: 64 },
      answer_format: {
        version: 1 as const,
        kind:
          index < 5
            ? ('coding' as const)
            : index < 7
              ? ('trace_with_reason' as const)
              : ('debug_with_reason' as const),
      },
      submission: {
        version: 1 as const,
        allowed: false,
        status: 'closed' as const,
        authority:
          index < 5 ? ('scored_exam_intake_v1' as const) : ('checkpoint_answers_v1' as const),
      },
    })),
    submissions: [],
    history: [current, historical],
  };
}
function render(view: CheckpointView, attemptId = id(1)) {
  return renderToStaticMarkup(
    createElement(CheckpointResult, {
      view: checkpointPresentation(view),
      overview: { nodes: [] } as unknown as LearningOverview,
      cohort: id(3),
      node: 'exam-1',
      attemptId,
    }),
  );
}
describe('native scored result selection in the existing result screen', () => {
  it('does not substitute a history copy when the current native result is unavailable', () => {
    const view = fixture();
    delete view.scored_result;
    const html = render(view);
    expect(html).toContain('provisional');
    expect(html).not.toContain('80 / 100');
    expect(html).not.toContain(id(101));
  });
  it('does not substitute any current result for an unknown selected attempt', () => {
    const html = render(fixture(), id(999));
    expect(html).toContain('No matching authoritative attempt result');
    expect(html).not.toContain('80 / 100');
    expect(html).not.toContain(id(101));
  });
  it('does not infer historical grading from a legacy score when marked metadata is missing', () => {
    const view = fixture();
    delete view.history[1]!.scored_result;
    delete view.history[1]!.scored_exam;
    view.history[1]!.points = 4;
    view.history[1]!.outcome_id = id(444);
    const html = render(view, id(2));
    expect(html).toContain('provisional');
    expect(html).not.toContain('80 / 100');
    expect(html).not.toContain('Authoritative task passes');
    expect(html).not.toContain(id(444));
  });
  it('retains the existing task-pass result for an unmarked legacy checkpoint', () => {
    const view = fixture();
    delete view.scored_exam;
    delete view.scored_result;
    view.tasks = view.tasks.slice(0, 4).map((task) => {
      const legacy = { ...task };
      delete legacy.submission;
      return legacy;
    });
    view.history = [
      {
        ...view.history[0]!,
        points: 3,
        outcome_id: id(111),
        policy: { policy_version: 1, task_count: 4, pass_points: 3 },
      },
    ];
    delete view.history[0]!.scored_exam;
    delete view.history[0]!.scored_result;
    const html = render(view);
    expect(html).toContain('3 / 4');
    expect(html).toContain('Authoritative task passes');
    expect(html).toContain('Passing threshold: 3 / 4');
    expect(html).not.toContain('/ 100');
  });

  it('shows finalized weighted total/coding evidence instead of legacy task-pass counts', () => {
    const html = render(fixture());
    expect(html).toContain('80 / 100');
    expect(html).toContain('60 / 75 coding');
    expect(html).toContain(id(101));
    expect(html).not.toContain('Authoritative task passes');
    expect(html).not.toContain('Passing threshold: 3');
  });
  it('cannot substitute current A pass for selected historical B failure', () => {
    const html = render(fixture(), id(2));
    expect(html).toContain('50 / 100');
    expect(html).toContain('40 / 75 coding');
    expect(html).toContain('NOT PASSED');
    expect(html).toContain(id(102));
    expect(html).not.toContain('80 / 100');
    expect(html).not.toContain(id(101));
  });
  it('uses provisional copy when historical native result is unavailable, never current totals or legacy points', () => {
    const view = fixture();
    delete view.history[1]!.scored_result;
    const html = render(view, id(2));
    expect(html).toContain('provisional');
    expect(html).not.toContain('80 / 100');
    expect(html).not.toContain('50 / 100');
    expect(html).not.toContain('Authoritative task passes');
  });
  it('provides an exact-attempt provisional destination after Finish without a legacy outcome id', () => {
    const row = {
      ...fixture().history[1]!,
      status: 'evaluating',
      outcome_id: null,
      scored_result: {
        version: 1 as const,
        status: 'provisional' as const,
        total_points: null,
        coding_points: null,
        outcome_id: null,
      },
    };
    expect(checkpointResultHref(id(3), 'exam-1', row)).toBe(
      `/app/cohorts/${id(3)}/checkpoints/exam-1/result?attempt=${id(2)}`,
    );
    expect(
      checkpointResultHref(id(3), 'legacy', { id: id(1), status: 'passed', outcome_id: null }),
    ).toBeNull();
  });
});
