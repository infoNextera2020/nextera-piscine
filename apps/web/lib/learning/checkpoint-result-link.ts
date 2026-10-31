import { checkpointScoredExamMetadata, checkpointScoredExamResult } from '@nextera/domain';
/** Bind result navigation to an exact attempt and its native lifecycle, never inferred task scores. */
export function checkpointResultHref(
  cohort: string,
  node: string,
  attempt: {
    id: string;
    status: string;
    outcome_id: string | null;
    scored_exam?: unknown;
    scored_result?: unknown;
  },
) {
  const marked = checkpointScoredExamMetadata(attempt.scored_exam);
  if (marked) {
    const result = checkpointScoredExamResult(attempt.scored_result);
    if (
      result?.status === 'provisional' ||
      result?.status === 'passed' ||
      result?.status === 'failed' ||
      ['evaluating', 'passed', 'failed', 'infrastructure_blocked'].includes(attempt.status)
    )
      return `/app/cohorts/${encodeURIComponent(cohort)}/checkpoints/${encodeURIComponent(node)}/result?attempt=${encodeURIComponent(attempt.id)}`;
    return null;
  }
  if (attempt.scored_result !== undefined && attempt.scored_result !== null) return null;
  if (
    !attempt.outcome_id ||
    !['passed', 'failed', 'infrastructure_blocked'].includes(attempt.status)
  )
    return null;
  return `/app/cohorts/${encodeURIComponent(cohort)}/checkpoints/${encodeURIComponent(node)}/result?attempt=${encodeURIComponent(attempt.id)}`;
}
