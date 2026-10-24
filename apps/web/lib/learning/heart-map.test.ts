import { describe, expect, it } from 'vitest';
import { HEART_HEIGHT, HEART_ROUTE, HEART_WIDTH, heartPosition, heartSteps } from './heart-map';
import type { LearningNode, LearningOverview } from './types';
const base = '/app/cohorts/authorized';
function node(
  key: string,
  kind: LearningNode['kind'] = 'challenge',
  questKey = 'group-a',
): LearningNode {
  return {
    key,
    title: 'Published ' + key,
    kind,
    questKey,
    questTitle: 'Published ' + questKey,
    state: 'available',
    assessmentState: null,
    label: 'Available',
    lockedReason: null,
    prerequisites: [],
    skills: [],
    href: base + '/' + (kind === 'checkpoint' ? 'checkpoints' : 'challenges') + '/' + key,
    roadmapHref: base + '?node=' + key,
    startedAt: null,
    unlockedAt: null,
    masteredAt: null,
  };
}
function overview(nodes: LearningNode[]): Pick<LearningOverview, 'nodes' | 'modules'> {
  return {
    nodes,
    modules: [...new Set(nodes.map((n) => n.questKey))].map((key) => ({
      key,
      title: 'Published ' + key,
      nodes: nodes.filter((n) => n.questKey === key),
      mastered: 0,
      state: 'available',
      next: nodes.find((n) => n.questKey === key) ?? null,
    })),
  };
}
describe('Heart map is a presentation of supplied data', () => {
  it('keeps server order while grouping challenges once and retaining real checkpoint/project steps', () => {
    const nodes = [
      node('a'),
      node('b'),
      node('gate', 'checkpoint'),
      node('project', 'project'),
      node('c', 'challenge', 'group-b'),
    ];
    const steps = heartSteps(overview(nodes));
    expect(steps.map((s) => s.id)).toEqual([
      'quest:group-a',
      'node:gate',
      'node:project',
      'quest:group-b',
    ]);
    expect(steps[0]!.nodes.map((n) => n.key)).toEqual(['a', 'b', 'gate', 'project']);
    expect(steps[1]!.next?.href).toBe(nodes[2]!.href);
    expect(steps[2]!.next?.href).toBe(nodes[3]!.href);
  });
  it('does not fill a small or empty catalog with reference-image records', () => {
    expect(heartSteps(overview([]))).toEqual([]);
    const steps = heartSteps(overview([node('real')]));
    expect(steps).toHaveLength(1);
    expect(steps[0]!.title).toBe('Published group-a');
    expect(JSON.stringify(steps)).not.toMatch(/Quadchecker|Sudoku|Week 1|Quest 12/);
  });
  it('preserves recorded states and marks only the supplied current work', () => {
    const nodes = [
      { ...node('mastered'), state: 'mastered' as const },
      {
        ...node('locked', 'project'),
        state: 'locked' as const,
        href: null,
        lockedReason: 'Supplied requirement.',
      },
    ];
    const view = overview(nodes);
    const before = JSON.stringify(view);
    const steps = heartSteps({ ...view, current: nodes[1]! });
    expect(steps[1]!.current).toBe(true);
    expect(steps[0]!.current).toBe(false);
    expect(steps[1]!.state).toBe('locked');
    expect(steps[1]!.next?.href).toBeNull();
    expect(JSON.stringify(view)).toBe(before);
  });
  it('distinguishes pending receipts from mastery and matches destinations exactly', () => {
    const nodes = [node('one'), node('two', 'project')];
    const view = overview(nodes);
    const receipt = {
      id: 'receipt',
      title: 'Safe title',
      state: 'queued' as const,
      at: '2026-10-24T10:00:00Z',
      href: nodes[1]!.href + '?tab=submissions',
    };
    const pending = heartSteps({ ...view, submissions: [receipt] });
    expect(pending[1]!.pending).toBe(true);
    expect(pending[1]!.state).toBe('available');
    const unrelated = heartSteps({
      ...view,
      submissions: [{ ...receipt, href: nodes[1]!.href + '-other' }],
    });
    expect(unrelated[1]!.pending).toBe(false);
    const finished = heartSteps({ ...view, submissions: [{ ...receipt, state: 'passed' }] });
    expect(finished[1]!.pending).toBe(false);
  });
  it('keeps preview states null and does not invent a current position', () => {
    const nodePreview = { ...node('preview'), state: null };
    const view = overview([nodePreview]);
    view.modules[0]!.state = null;
    const step = heartSteps(view)[0]!;
    expect(step.state).toBeNull();
    expect(step.current).toBe(false);
    expect(step.pending).toBe(false);
  });
  it('uses the approved two-lobe heart perimeter and adapts any published count without invalid coordinates', () => {
    expect(HEART_ROUTE[0]).toEqual({ x: 1230, y: 450 });
    expect(HEART_ROUTE.at(-1)).toEqual({ x: 1460, y: 440 });
    expect(heartPosition(11, 19)).toMatchObject({ x: 1340, y: 1690 });
    expect(heartPosition(2, 19).side).toBe('above');
    for (const count of [1, 2, 5, 19, 40])
      for (let i = 0; i < count; i++) {
        const p = heartPosition(i, count);
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(HEART_WIDTH);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThan(HEART_HEIGHT);
      }
  });
});
