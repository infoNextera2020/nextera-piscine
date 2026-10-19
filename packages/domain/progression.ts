import { prerequisitesSatisfied, type Prerequisite } from './curriculum.ts';
import type { ProgressState, SubmissionState } from './states.ts';

/** Inputs are stored, locked projection rows, never a browser-provided graph. */
export function resultProgression(
  node: string,
  verdict: SubmissionState,
  states: ReadonlyMap<string, ProgressState>,
  edges: readonly Prerequisite[],
): { node: string; previous: ProgressState; next: ProgressState }[] {
  const current = states.get(node);
  if (!current || current === 'locked') throw new Error('PROGRESS_IDENTITY_CONFLICT');
  if (verdict !== 'passed' || current === 'mastered') return [];
  const projected = new Map(states);
  projected.set(node, 'mastered');
  const changes: { node: string; previous: ProgressState; next: ProgressState }[] = [
    { node, previous: current, next: 'mastered' },
  ];
  for (const [key, state] of [...projected].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (state === 'locked' && prerequisitesSatisfied(key, edges, projected))
      changes.push({ node: key, previous: state, next: 'available' });
  }
  return changes;
}
