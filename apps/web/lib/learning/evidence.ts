import type { CheckpointView } from '@nextera/db/checkpoints';
import type { LearningOverview } from './types';
export type EvidenceCategory = 'mastery' | 'checkpoint' | 'learner' | 'unlock' | 'system';
export type EvidenceRecord = {
  id: string;
  category: EvidenceCategory;
  title: string;
  state: string;
  at: string | null;
  href: string;
  identity: string;
  source: string;
};
export function projectEvidence(
  view: LearningOverview,
  checkpoints: { key: string; title: string; view: CheckpointView }[],
  cohort: string,
): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  for (const node of view.nodes) {
    if (node.masteredAt && node.state === 'mastered')
      records.push({
        id: node.key + ':mastery',
        category: 'mastery',
        title: node.title,
        state: 'mastered',
        at: node.masteredAt,
        href: node.roadmapHref,
        identity: node.key,
        source: 'Stored mastery projection',
      });
    if (node.unlockedAt)
      records.push({
        id: node.key + ':unlock',
        category: 'unlock',
        title: node.title + ' became available',
        state: 'available',
        at: node.unlockedAt,
        href: node.roadmapHref,
        identity: node.key,
        source: 'Stored unlock timestamp',
      });
  }
  for (const sub of view.submissions) {
    const category =
      sub.state === 'system_error'
        ? 'system'
        : ['failed', 'compile_error', 'runtime_error', 'timeout'].includes(sub.state)
          ? 'learner'
          : null;
    if (category)
      records.push({
        id: sub.id,
        category,
        title: sub.title,
        state: sub.state,
        at: sub.at,
        href: sub.href,
        identity: sub.id,
        source: 'Safe submission history',
      });
  }
  for (const cp of checkpoints) {
    for (const attempt of cp.view.history) {
      if (!attempt.outcome_id) continue;
      records.push({
        id: attempt.outcome_id,
        category: 'checkpoint',
        title: cp.title,
        state: attempt.status,
        at: attempt.completed_at,
        href: `/app/cohorts/${cohort}/checkpoints/${cp.key}/result?attempt=${attempt.id}`,
        identity: attempt.outcome_id,
        source: 'Checkpoint outcome · attempt ' + attempt.id,
      });
      if (attempt.status === 'infrastructure_blocked')
        records.push({
          id: attempt.id + ':infra',
          category: 'system',
          title: cp.title + ' requires infrastructure recovery',
          state: attempt.status,
          at: attempt.completed_at,
          href: `/app/cohorts/${cohort}/checkpoints/${cp.key}/result?attempt=${attempt.id}`,
          identity: attempt.outcome_id,
          source: 'Checkpoint infrastructure outcome',
        });
    }
    // Only the latest attempt's safe task history is exposed by the accepted read.
    for (const sub of cp.view.submissions) {
      const category =
        sub.state === 'system_error'
          ? 'system'
          : ['failed', 'compile_error', 'runtime_error', 'timeout'].includes(sub.state)
            ? 'learner'
            : null;
      if (category)
        records.push({
          id: sub.id,
          category,
          title:
            cp.title + ' · ' + (cp.view.tasks.find((t) => t.key === sub.task_key)?.title ?? 'Task'),
          state: sub.state,
          at: sub.created_at,
          href: `/app/cohorts/${cohort}/checkpoints/${cp.key}`,
          identity: sub.id,
          source: 'Safe checkpoint task history',
        });
    }
  }
  // Overview history can include these same checkpoint task submissions.
  // Keep one record per identity, preferring the specific checkpoint projection.
  return [...new Map(records.map((record) => [record.id, record])).values()].sort(
    (a, b) => (b.at ?? '').localeCompare(a.at ?? '') || a.id.localeCompare(b.id),
  );
}
