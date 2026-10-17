import type { ProgressState } from './states.ts';

export const NODE_KINDS = ['challenge', 'project', 'checkpoint'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
export interface Prerequisite {
  from: string;
  to: string;
  rule: 'requires_pass';
}
export interface SubmissionRules {
  required_files: string[];
  allowed_extensions: string[];
  max_size_kb: number;
}
export interface CurriculumNode {
  key: string;
  questKey: string;
  kind: NodeKind;
  title: string;
  position: number;
  difficulty: number;
  subjectMarkdown: string;
  subjectDigest: string;
  configurationDigest: string;
  skills: string[];
  submissionRules: SubmissionRules;
  testPackId: string;
  declaredLimits: { timeout_ms: number; memory_mb: number; output_kb: number };
}
export interface Curriculum {
  key: string;
  version: string;
  contentDigest: string;
  digestFormatVersion: 1;
  quests: { key: string; title: string; position: number }[];
  nodes: CurriculumNode[];
  prerequisites: Prerequisite[];
  roots: string[];
}

/** Validates references, edge uniqueness, and the DAG; roots use stable key order. */
export function curriculumRoots(keys: readonly string[], edges: readonly Prerequisite[]): string[] {
  const nodes = new Set(keys);
  if (!keys.length || nodes.size !== keys.length)
    throw new Error('Node keys must be unique and nonempty.');
  const incoming = new Map(keys.map((key) => [key, 0]));
  const outgoing = new Map(keys.map((key) => [key, [] as string[]]));
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      throw new Error('Unknown prerequisite endpoint.');
    if (edge.from === edge.to) throw new Error('Self prerequisite edge.');
    if (edge.rule !== 'requires_pass') throw new Error('Unsupported prerequisite rule.');
    const key = `${edge.from}\0${edge.to}`;
    if (seen.has(key)) throw new Error('Duplicate prerequisite edge.');
    seen.add(key);
    incoming.set(edge.to, incoming.get(edge.to)! + 1);
    outgoing.get(edge.from)!.push(edge.to);
  }
  const roots = keys.filter((key) => incoming.get(key) === 0).sort();
  const queue = [...roots];
  let visited = 0;
  while (queue.length) {
    const key = queue.shift()!;
    visited++;
    for (const next of outgoing.get(key)!) {
      incoming.set(next, incoming.get(next)! - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== keys.length) throw new Error('Prerequisite graph contains a cycle.');
  return roots;
}

export function prerequisitesSatisfied(
  node: string,
  edges: readonly Prerequisite[],
  states: ReadonlyMap<string, ProgressState>,
): boolean {
  return edges
    .filter((edge) => edge.to === node)
    .every((edge) => states.get(edge.from) === 'mastered');
}

export function initialNodeProgress(
  keys: readonly string[],
  edges: readonly Prerequisite[],
  at: Date,
) {
  if (!Number.isFinite(at.getTime())) throw new Error('Enrollment time is invalid.');
  const roots = new Set(curriculumRoots(keys, edges));
  return [...keys].sort().map((nodeKey) => ({
    nodeKey,
    state: (roots.has(nodeKey) ? 'available' : 'locked') as ProgressState,
    unlockedAt: roots.has(nodeKey) ? new Date(at) : null,
    startedAt: null,
    masteredAt: null,
    firstPassingSubmissionId: null,
  }));
}

export const canReadSubject = (state: ProgressState) => state !== 'locked';

export function presentNode(state: ProgressState, prerequisites: readonly string[]) {
  return {
    label: state.toUpperCase(),
    accessible: canReadSubject(state),
    lockedReason:
      state === 'locked'
        ? `Requires passing all prerequisites: ${prerequisites.join(', ')}.`
        : null,
  };
}
