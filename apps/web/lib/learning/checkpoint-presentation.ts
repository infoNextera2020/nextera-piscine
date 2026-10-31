import {
  parseCheckpointView,
  checkpointScoredExamMetadata,
  checkpointScoredExamResult,
  type CheckpointView,
} from '@nextera/domain';

/** Execution feedback is not a finalized question grade. Native states remain unchanged. */
export function scoredCheckpointExecutionLabel(state: string, finalOutcomeKnown = false) {
  const labels: Record<string, string> = {
    passed: 'Automated checks passed — provisional, pending mentor review',
    failed: 'Automated checks did not pass — provisional, pending mentor review',
    compile_error: 'Compilation issue — provisional, pending mentor review',
    runtime_error: 'Runtime issue — provisional, pending mentor review',
    timeout: 'Execution time limit — provisional, pending mentor review',
    system_error: 'Infrastructure issue — not a learner failure',
    pending: 'Awaiting evaluation and mentor review',
    queued: 'Queued for evaluation',
    running: 'Evaluation running',
    available: 'Open',
    closed: 'Closed',
    cancelled: 'Execution cancelled — no final grade',
  };
  const label = labels[state] ?? 'Result provisional — pending review';
  return finalOutcomeKnown
    ? label
        .replace(' — provisional, pending mentor review', ' — execution feedback only')
        .replace('Awaiting evaluation and mentor review', 'Recorded answer')
    : label;
}

/** Server presentation hints only. PostgreSQL rechecks every action at intake. */
export function checkpointPresentation(view: CheckpointView) {
  view = parseCheckpointView(view);
  const attempt = view.attempt;
  const scoredExam = checkpointScoredExamMetadata(view.scored_exam) !== null;
  const scoredResult = scoredExam ? checkpointScoredExamResult(view.scored_result) : null;
  const finalOutcomeKnown = scoredResult?.status === 'passed' || scoredResult?.status === 'failed';
  const beforeDeadline = !!attempt && Date.parse(view.server_now) < Date.parse(attempt.deadline_at);
  const intakeOpen = attempt?.status === 'active' && beforeDeadline;
  const startAvailable =
    view.eligible &&
    (scoredExam
      ? !attempt
      : !attempt ||
        view.replacement_available ||
        (attempt.status === 'failed' &&
          attempt.normal_slot === 1 &&
          !!attempt.retake_at &&
          Date.parse(attempt.retake_at) <= Date.parse(view.server_now)));
  return {
    ...view,
    display: {
      startAvailable,
      intakeOpen,
      expiredAwaitingEvaluation: attempt?.status === 'active' && !beforeDeadline,
      tasks: view.tasks.map((task) => {
        const history = view.submissions.filter((s) => s.task_key === task.key);
        const latest = history.at(-1)?.state;
        const state =
          scoredExam && latest === 'passed'
            ? 'passed'
            : !scoredExam && task.passed
              ? 'passed'
              : latest === 'system_error'
                ? 'system_error'
                : latest === 'queued' || latest === 'running'
                  ? latest
                  : latest === 'cancelled'
                    ? 'cancelled'
                    : latest === 'failed' ||
                        latest === 'compile_error' ||
                        latest === 'runtime_error' ||
                        latest === 'timeout'
                      ? latest
                      : !intakeOpen
                        ? 'closed'
                        : 'available';
        return {
          key: task.key,
          state,
          ...(scoredExam
            ? {
                stateLabel:
                  state === 'available' && task.submission?.allowed === false
                    ? 'Intake ' + task.submission.status.replaceAll('_', ' ')
                    : scoredCheckpointExecutionLabel(state, finalOutcomeKnown),
              }
            : {}),
          submitAvailable: scoredExam
            ? intakeOpen && task.submission?.allowed === true
            : intakeOpen && !task.passed && task.reserved < 3,
        };
      }),
    },
  };
}
export type CheckpointPresentation = ReturnType<typeof checkpointPresentation>;
