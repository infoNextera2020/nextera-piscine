/** A result destination needs a stored final outcome, never task-score inference. */
export function checkpointResultHref(
  cohort: string,
  node: string,
  attempt: { id: string; status: string; outcome_id: string | null },
) {
  if (
    !attempt.outcome_id ||
    !['passed', 'failed', 'infrastructure_blocked'].includes(attempt.status)
  )
    return null;
  return `/app/cohorts/${encodeURIComponent(cohort)}/checkpoints/${encodeURIComponent(node)}/result?attempt=${encodeURIComponent(attempt.id)}`;
}
