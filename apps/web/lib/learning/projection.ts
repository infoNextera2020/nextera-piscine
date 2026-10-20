import 'server-only';
import { NODE_KINDS } from '@nextera/domain';
import { presentNode, type NodeKind, type ProgressState, type UserRole } from '@nextera/domain';
import type { LearningNode, LearningModule, LearningOverview } from './types';
export type MapRow = {
  nodeKey: string;
  title: string;
  kind: string;
  questKey: string;
  questTitle: string;
  state: ProgressState | null;
  skills: string[];
  startedAt: Date | null;
  unlockedAt: Date | null;
  masteredAt: Date | null;
};
const iso = (date: Date | null) => date?.toISOString() ?? null;
/** Read-only display aggregation. Stored state is the only progression input. */
export function projectLearning(
  rows: MapRow[],
  edges: { from: string; to: string; rule: string }[],
  role: UserRole,
  cohortId: string,
): LearningOverview {
  const base = '/app/cohorts/' + encodeURIComponent(cohortId);
  const nodes: LearningNode[] = rows.map((row) => {
    const kind = NODE_KINDS.find((value) => value === row.kind);
    if (!kind) throw new Error('Unsupported curriculum node kind.');
    if (role === 'learner' && !row.state)
      throw new Error('Enrolled learner has incomplete progress.');
    const prerequisites = edges
      .filter((e) => e.to === row.nodeKey)
      .map((e) => rows.find((r) => r.nodeKey === e.from)?.title ?? e.from);
    const view = row.state && role === 'learner' ? presentNode(row.state, prerequisites) : null;
    return {
      key: row.nodeKey,
      title: row.title,
      kind,
      questKey: row.questKey,
      questTitle: row.questTitle,
      state: role === 'learner' ? row.state : null,
      assessmentState: null,
      label: view?.label ?? 'PREVIEW',
      lockedReason: view?.lockedReason ?? null,
      prerequisites,
      skills: row.skills,
      href:
        role !== 'learner' || view?.accessible
          ? base +
            '/' +
            (row.kind === 'checkpoint' && role === 'learner' ? 'checkpoints' : 'challenges') +
            '/' +
            encodeURIComponent(row.nodeKey)
          : null,
      roadmapHref: base + '?node=' + encodeURIComponent(row.nodeKey),
      startedAt: role === 'learner' ? iso(row.startedAt) : null,
      unlockedAt: role === 'learner' ? iso(row.unlockedAt) : null,
      masteredAt: role === 'learner' ? iso(row.masteredAt) : null,
    };
  });
  const next = (items: LearningNode[]) =>
    items.find((n) => n.state === 'in_progress') ??
    items.find((n) => n.state === 'available') ??
    null;
  const groups = new Map<string, LearningNode[]>();
  for (const node of nodes) groups.set(node.questKey, [...(groups.get(node.questKey) ?? []), node]);
  const modules: LearningModule[] = [...groups].map(([key, items]) => ({
    key,
    title: items[0]!.questTitle,
    nodes: items,
    mastered: items.filter((n) => n.state === 'mastered').length,
    state:
      role !== 'learner'
        ? null
        : items.every((n) => n.state === 'mastered')
          ? 'mastered'
          : items.some((n) => n.state === 'in_progress')
            ? 'in_progress'
            : items.some((n) => n.state === 'available')
              ? 'available'
              : 'locked',
    next:
      role === 'learner'
        ? (next(items) ?? items.find((n) => n.state === 'mastered') ?? null)
        : (items[0] ?? null),
  }));
  const count = (kind: NodeKind, state?: ProgressState) =>
    nodes.filter((n) => n.kind === kind && (!state || n.state === state)).length;
  return {
    nodes,
    modules,
    current: role === 'learner' ? next(nodes.filter((n) => n.kind !== 'checkpoint')) : null,
    checkpoint:
      role === 'learner'
        ? (nodes.find((n) => n.kind === 'checkpoint' && n.state !== 'mastered') ?? null)
        : null,
    checkpointStatus: null,
    currentDescription: null,
    updates: [],
    submissions: [],
    counts: {
      total: nodes.length,
      mastered: nodes.filter((n) => n.state === 'mastered').length,
      challenges: count('challenge'),
      challengesPassed: count('challenge', 'mastered'),
      checkpoints: count('checkpoint'),
      checkpointsPassed: count('checkpoint', 'mastered'),
      projects: count('project'),
      projectsActive: count('project', 'in_progress'),
      available: nodes.filter((n) => n.state === 'available').length,
      started: nodes.filter((n) => n.state === 'in_progress').length,
    },
  };
}
