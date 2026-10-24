import type { LearningModule, LearningNode, LearningOverview } from './types';

export type MapKind = 'quest' | 'checkpoint' | 'project';
export type HeartView = Pick<LearningOverview, 'nodes' | 'modules'> &
  Partial<Pick<LearningOverview, 'current' | 'submissions'>>;
export type HeartStep = {
  id: string;
  key: string;
  kind: MapKind;
  title: string;
  ordinal: number;
  state: LearningNode['state'];
  nodes: LearningNode[];
  next: LearningNode | null;
  current: boolean;
  pending: boolean;
};

/** Read-only grouping of the server's ordered rows. Lines never imply prerequisite edges. */
export function heartSteps(view: HeartView): HeartStep[] {
  const groups = new Map(view.modules.map((m) => [m.key, m]));
  const seen = new Set<string>();
  const counters = { quest: 0, checkpoint: 0, project: 0 };
  const steps: HeartStep[] = [];
  const path = (href: string) => href.split(/[?#]/, 1)[0];
  function pending(nodes: LearningNode[]) {
    const destinations = new Set(nodes.flatMap((n) => (n.href ? [path(n.href)] : [])));
    return (
      nodes.some((n) => n.assessmentState === 'evaluating') ||
      !!view.submissions?.some(
        (s) => (s.state === 'queued' || s.state === 'running') && destinations.has(path(s.href)),
      )
    );
  }
  for (const node of view.nodes) {
    if (node.kind === 'challenge') {
      if (seen.has(node.questKey)) continue;
      seen.add(node.questKey);
      const questGroup: LearningModule | undefined = groups.get(node.questKey);
      const nodes = questGroup?.nodes ?? view.nodes.filter((n) => n.questKey === node.questKey);
      steps.push({
        id: 'quest:' + node.questKey,
        key: node.questKey,
        kind: 'quest',
        title: questGroup?.title ?? node.questTitle,
        ordinal: ++counters.quest,
        state: questGroup?.state ?? null,
        nodes,
        next: questGroup?.next ?? null,
        current: view.current?.kind === 'challenge' && view.current.questKey === node.questKey,
        pending: pending(nodes),
      });
    } else {
      const kind = node.kind;
      steps.push({
        id: 'node:' + node.key,
        key: node.key,
        kind,
        title: node.title,
        ordinal: ++counters[kind],
        state: node.state,
        nodes: [node],
        next: node,
        current: view.current?.key === node.key,
        pending: pending([node]),
      });
    }
  }
  return steps;
}

export type MapPoint = { x: number; y: number };
export const HEART_WIDTH = 2620;
export const HEART_HEIGHT = 1800;
// Traced from the approved 3000 × 2200 heart reference, relative to its map area.
// The cleft stays open at the logo; the path follows one angular perimeter.
const rawRoute: readonly MapPoint[] = [
  { x: 1230, y: 390 },
  { x: 1200, y: 360 },
  { x: 1060, y: 220 },
  { x: 920, y: 80 },
  { x: 720, y: 80 },
  { x: 540, y: 260 },
  { x: 360, y: 440 },
  { x: 360, y: 650 },
  { x: 540, y: 830 },
  { x: 720, y: 1010 },
  { x: 900, y: 1190 },
  { x: 1080, y: 1370 },
  { x: 1340, y: 1630 },
  { x: 1520, y: 1450 },
  { x: 1700, y: 1270 },
  { x: 1880, y: 1090 },
  { x: 2060, y: 910 },
  { x: 2240, y: 730 },
  { x: 2240, y: 400 },
  { x: 2070, y: 230 },
  { x: 1910, y: 70 },
  { x: 1770, y: 70 },
  { x: 1460, y: 380 },
];
export const HEART_ROUTE = rawRoute.map((p) => ({ x: p.x, y: p.y + 60 }));
const slotIndices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 22];
const distance = HEART_ROUTE.map((_, index) =>
  HEART_ROUTE.slice(1, index + 1).reduce(
    (total, p, i) => total + Math.hypot(p.x - HEART_ROUTE[i]!.x, p.y - HEART_ROUTE[i]!.y),
    0,
  ),
);
function pointAt(target: number): MapPoint {
  for (let i = 1; i < HEART_ROUTE.length; i++) {
    if (target > distance[i]!) continue;
    const from = HEART_ROUTE[i - 1]!,
      to = HEART_ROUTE[i]!;
    const t = (target - distance[i - 1]!) / (distance[i]! - distance[i - 1]!);
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
  return HEART_ROUTE[HEART_ROUTE.length - 1]!;
}
export function heartPosition(index: number, count: number) {
  const slot = count > 1 ? (index / (count - 1)) * (slotIndices.length - 1) : 0;
  const low = Math.floor(slot),
    high = Math.min(slotIndices.length - 1, Math.ceil(slot));
  const a = distance[slotIndices[low]!]!,
    b = distance[slotIndices[high]!]!;
  const point = pointAt(a + (b - a) * (slot - low));
  return {
    ...point,
    side: (Math.abs(slot - 2) < 0.35 ? 'above' : slot <= 11 ? 'left' : 'right') as
      'above' | 'left' | 'right',
  };
}
export const HEART_ARROWS = HEART_ROUTE.slice(1).map((p, index) => {
  const from = HEART_ROUTE[index]!;
  return {
    x: (p.x + from.x) / 2,
    y: (p.y + from.y) / 2,
    angle: (Math.atan2(p.y - from.y, p.x - from.x) * 180) / Math.PI,
  };
});
