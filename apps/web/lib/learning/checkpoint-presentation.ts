import type { CheckpointView } from '@nextera/db/checkpoints';

/** Server presentation hints only. PostgreSQL rechecks every action at intake. */
export function checkpointPresentation(view: CheckpointView) {
  const attempt = view.attempt;
  const beforeDeadline = !!attempt && Date.parse(view.server_now) < Date.parse(attempt.deadline_at);
  const intakeOpen = attempt?.status === 'active' && beforeDeadline;
  const startAvailable =
    view.eligible &&
    (!attempt ||
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
        const state = task.passed
          ? 'passed'
          : latest === 'system_error'
            ? 'system_error'
            : latest === 'queued' || latest === 'running'
              ? latest
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
          submitAvailable: intakeOpen && !task.passed && task.reserved < 3,
        };
      }),
    },
  };
}
export type CheckpointPresentation = ReturnType<typeof checkpointPresentation>;
