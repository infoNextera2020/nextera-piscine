import { describe, it, expect } from 'vitest';
import { assessConnectedLearnerPlan } from './learner-plan';
import { checkpointFixture } from '../../tests/fixtures/checkpoints';
import { testCurriculum } from '../../tests/fixtures/curriculum';
describe('connected real learner rehearsal planning is not a runtime pass', () => {
  const practice = [
    { nodeKey: 'hello-go', kind: 'challenge' },
    { nodeKey: 'even-or-odd', kind: 'challenge' },
  ] as const;
  it('reports actual sample inventory without fabricating missing exam/Raid content', () => {
    const report = assessConnectedLearnerPlan(testCurriculum().curriculum, [
      ...practice,
      { nodeKey: 'transfer-checkpoint', kind: 'checkpoint' },
      { nodeKey: 'reviewed-raid-required', kind: 'project' },
    ]);
    expect(report.sourceConnected).toBe(false);
    expect(report.problems).toContain('MISSING_NODE:transfer-checkpoint');
    expect(report.problems).toContain('MISSING_NODE:reviewed-raid-required');
    expect(report.inventory).toMatchObject({
      quests: 1,
      challenges: 2,
      checkpoints: 0,
      projects: 0,
      edges: 1,
    });
  });
  it('does not confuse display order with a prerequisite path in the existing exam fixture', () => {
    const report = assessConnectedLearnerPlan(checkpointFixture().curriculum, [
      ...practice,
      { nodeKey: 'transfer-checkpoint', kind: 'checkpoint' },
    ]);
    expect(report.sourceConnected).toBe(false);
    expect(report.problems).toContain(
      'NO_COMMITTED_PREREQUISITE_PATH:even-or-odd->transfer-checkpoint',
    );
  });
  it('accepts existing explicit fixture gates but never authorizes publication/runtime or seeded success', () => {
    const report = assessConnectedLearnerPlan(
      checkpointFixture({ prerequisites: true }).curriculum,
      [...practice, { nodeKey: 'transfer-checkpoint', kind: 'checkpoint' }],
    );
    expect(report.sourceConnected).toBe(true);
    expect(report.runtimeVerified).toBe(false);
    expect(report.publicationAuthorized).toBe(false);
    expect(report.seedMasteryAllowed).toBe(false);
  });
  it('rejects wrong node kinds and duplicate steps rather than granting eligibility', () => {
    expect(
      assessConnectedLearnerPlan(testCurriculum().curriculum, [
        { nodeKey: 'hello-go', kind: 'checkpoint' },
        practice[0],
      ]).problems,
    ).toContain('NODE_KIND_MISMATCH:hello-go');
    expect(
      assessConnectedLearnerPlan(testCurriculum().curriculum, [practice[0], practice[0]]).problems,
    ).toContain('PLAN_STEPS_INVALID');
  });
  it('does not mutate source metadata or graph', () => {
    const source = checkpointFixture({ prerequisites: true }).curriculum;
    const before = JSON.stringify(source);
    assessConnectedLearnerPlan(source, [
      ...practice,
      { nodeKey: 'transfer-checkpoint', kind: 'checkpoint' },
    ]);
    expect(JSON.stringify(source)).toBe(before);
  });
});
