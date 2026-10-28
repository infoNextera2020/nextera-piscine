import type { Curriculum, NodeKind } from '@nextera/domain';

export type RehearsalStep = Readonly<{ nodeKey: string; kind: NodeKind }>;
/** Read-only planning, not publication/provisioning/authorization or runtime evidence. */
export function assessConnectedLearnerPlan(
  curriculum: Curriculum,
  steps: readonly RehearsalStep[],
) {
  const problems: string[] = [];
  const nodes = new Map(curriculum.nodes.map((n) => [n.key, n]));
  const unique = new Set(steps.map((s) => s.nodeKey));
  if (steps.length < 2 || unique.size !== steps.length) problems.push('PLAN_STEPS_INVALID');
  for (const step of steps) {
    const node = nodes.get(step.nodeKey);
    if (!node) problems.push('MISSING_NODE:' + step.nodeKey);
    else if (node.kind !== step.kind) problems.push('NODE_KIND_MISMATCH:' + step.nodeKey);
  }
  function prerequisitePath(from: string, to: string): boolean {
    const visited = new Set<string>();
    const pending = [from];
    while (pending.length) {
      const key = pending.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const edge of curriculum.prerequisites.filter(
        (e) => e.from === key && e.rule === 'requires_pass',
      )) {
        if (edge.to === to) return true;
        pending.push(edge.to);
      }
    }
    return false;
  }
  for (let index = 1; index < steps.length; index++) {
    const before = steps[index - 1]!,
      after = steps[index]!;
    if (
      nodes.has(before.nodeKey) &&
      nodes.has(after.nodeKey) &&
      !prerequisitePath(before.nodeKey, after.nodeKey)
    )
      problems.push('NO_COMMITTED_PREREQUISITE_PATH:' + before.nodeKey + '->' + after.nodeKey);
  }
  return {
    sourceConnected: problems.length === 0,
    runtimeVerified: false as const,
    publicationAuthorized: false as const,
    seedMasteryAllowed: false as const,
    inventory: {
      quests: curriculum.quests.length,
      challenges: curriculum.nodes.filter((n) => n.kind === 'challenge').length,
      checkpoints: curriculum.nodes.filter((n) => n.kind === 'checkpoint').length,
      projects: curriculum.nodes.filter((n) => n.kind === 'project').length,
      edges: curriculum.prerequisites.length,
    },
    steps: steps.map((s) => ({ ...s })),
    problems,
  };
}
