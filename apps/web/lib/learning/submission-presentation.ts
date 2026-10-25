import type { LearningNode, LearningSubmission } from './types';
/** Identify the authorized node by its supplied destination, never by a title match. */
export function submissionKind(record: LearningSubmission, nodes: LearningNode[]) {
  const path = (href: string) => href.split(/[?#]/, 1)[0];
  return nodes.find(
    (n) => (n.href && path(n.href) === path(record.href)) || n.roadmapHref === record.href,
  )?.kind;
}
/** Presentation only: these notices do not decide quota, result application or progress. */
export function submissionNotices(state: string, kind?: LearningNode['kind']) {
  if (state === 'cancelled') return ['Cancellation is not a learner failure.'];
  if (kind === 'project' && (state === 'queued' || state === 'running'))
    return [
      'Project completion is not confirmed by this pending submission. Check Journey for recorded progress.',
    ];
  if (kind === 'project' && state === 'passed')
    return [
      'A passed submission does not by itself confirm project completion or unlock further work. Check Journey for recorded progress.',
    ];
  return [];
}
