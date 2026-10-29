import { describe, expect, it, vi } from 'vitest';
import { questReleaseAccess } from '@nextera/domain';
import {
  prepareQuestReview,
  submitQuestReview,
  type QuestReviewContext,
  type QuestReviewRepository,
  type QuestReviewRuntime,
  type QuestReviewScope,
  type QuestReviewTransaction,
  type StoredQuestReview,
} from '../operations/quest-reviews';

const scope = { cohortId: 'cohort', questKey: 'quest-2', learnerId: 'learner-1' };
const policy = {
  version: 1 as const,
  revision: 'review-fixture-1',
  peerCount: 1,
  peerGate: 'submitted' as const,
  rankingPolicyVersion: 'rank-fixture-1',
};
const bank = {
  version: 'bank-fixture-1',
  digest: 'b'.repeat(64),
  questionIds: ['a', 'b', 'c', 'd', 'e', 'f'],
};
const candidate = (
  id: string,
  role: 'learner' | 'operator' | 'admin' = 'learner',
  changes = {},
) => ({ id, role, cohortId: scope.cohortId, active: true, eligible: true, ...changes });
const key = (value: QuestReviewScope) =>
  JSON.stringify([value.cohortId, value.questKey, value.learnerId]);

/** Synthetic atomic repository: verifies service orchestration only. This is not
 * PostgreSQL, a security adapter, catalog readiness or live persistence evidence. */
class Fixture implements QuestReviewRepository {
  records = new Map<string, StoredQuestReview>();
  contexts = new Map<string, Partial<QuestReviewContext>>();
  completeGraph = true;
  writes: string[] = [];
  events: string[] = [];
  failAssignmentWrite = false;
  private tail = Promise.resolve();
  private sequence = 0;
  private clock = 100;
  sample = vi.fn(async () => ['e', 'c', 'a', 'b', 'f']);
  runtime: QuestReviewRuntime = {
    nowMs: () => ++this.clock,
    nextId: () => `generated-${++this.sequence}`,
    sampler: { policyVersion: 'sampling-fixture-1', select: this.sample },
  };
  context(subjectId: string, currentScope: QuestReviewScope): QuestReviewContext {
    const actorId = subjectId.replace(/^auth:/, '');
    return {
      actor: candidate(actorId, actorId.startsWith('mentor') ? 'operator' : 'learner'),
      learnerAccess: true,
      evidence: {
        contentVersion: 'content-fixture-1',
        evidenceVersion: 'evidence-fixture-1',
        evidenceDigest: 'a'.repeat(64),
      },
      policy,
      bank,
      selectionPolicyVersion: 'sampling-fixture-1',
      rubricVersion: 'rubric-fixture-1',
      initialAssignmentAllowed: true,
      peerCandidates: [
        candidate(currentScope.learnerId === 'learner-1' ? 'learner-2' : 'learner-1'),
      ],
      mentorCandidates: [candidate('mentor-1', 'operator')],
      ...this.contexts.get(actorId),
    };
  }
  async transaction<T>(
    input: Parameters<QuestReviewRepository['transaction']>[0],
    work: (tx: QuestReviewTransaction) => Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const before = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await before;
    this.events.push('locked');
    const records = structuredClone(this.records),
      pending: string[] = [];
    const scopeKey = key(input.scope);
    const read = () => records.get(scopeKey) ?? null;
    const replace = (record: StoredQuestReview) => records.set(scopeKey, record);
    try {
      const result = await work({
        context: async () => {
          this.events.push('context');
          return structuredClone(this.context(input.subjectId, input.scope));
        },
        read: async () => read(),
        peerGraph: async () => ({
          complete: this.completeGraph,
          edges: [...records.values()].flatMap((record) =>
            record.assignments
              .filter((assignment) => assignment.kind === 'peer')
              .map((assignment) => ({
                cohortId: record.cycle.cohortId,
                questKey: record.cycle.questKey,
                learnerId: record.cycle.learnerId,
                reviewerId: assignment.reviewerId,
              })),
          ),
        }),
        receipt: async (requestId) =>
          [...records.values()]
            .flatMap((record) => record.receipts)
            .find((receipt) => receipt.id === requestId) ?? null,
        insertCycle: async (cycle, frozenPolicy) => {
          if (read()) throw new Error('unique initial scope');
          pending.push('cycle');
          replace({ cycle, policy: frozenPolicy, assignments: [], receipts: [] });
        },
        insertAssignments: async (assignments) => {
          if (this.failAssignmentWrite) throw new Error('private database password');
          pending.push(...assignments.map((assignment) => assignment.kind));
          replace({ ...read()!, assignments: [...read()!.assignments, ...assignments] });
        },
        insertReceipt: async (receipt) => {
          pending.push('receipt');
          replace({ ...read()!, receipts: [...read()!.receipts, receipt] });
        },
      });
      this.records = records;
      this.writes.push(...pending);
      this.events.push('commit');
      return result;
    } finally {
      release();
    }
  }
  state(currentScope = scope) {
    return this.records.get(key(currentScope))!;
  }
  prepare(learnerId = 'learner-1') {
    return prepareQuestReview(this, this.runtime, {
      scope: { ...scope, learnerId },
      subjectId: `auth:${learnerId}`,
    });
  }
  submit(
    reviewerId = 'learner-2',
    decision: 'submitted' | 'approved' | 'changes_requested' = 'submitted',
    requestId = 'request-peer',
  ) {
    const state = this.state(),
      assignment = state.assignments.find((a) => a.reviewerId === reviewerId)!;
    return submitQuestReview(this, this.runtime, {
      scope,
      subjectId: `auth:${reviewerId}`,
      cycleId: state.cycle.cycleId,
      assignmentId: assignment?.id ?? 'unassigned',
      requestId,
      decision,
    });
  }
}

describe('Quest initial-cycle persistence orchestration (injected fixture)', () => {
  it('commits one five-question sample and automatic peer assignment; reload/concurrency cannot reroll', async () => {
    const f = new Fixture();
    const results = await Promise.all([f.prepare(), f.prepare(), f.prepare()]);
    expect(f.sample).toHaveBeenCalledOnce();
    expect(f.records.size).toBe(1);
    expect(f.state().cycle.questionIds).toEqual(['e', 'c', 'a', 'b', 'f']);
    expect(f.writes).toEqual(['cycle', 'peer']);
    expect(results.every((r) => r.cycle.cycleId === results[0]!.cycle.cycleId)).toBe(true);
    expect(results[0]!.eligibility).toMatchObject({
      state: 'awaiting_peers',
      masteryEligible: false,
      xpEligible: false,
    });
    expect(f.events.slice(0, 3)).toEqual(['locked', 'context', 'commit']);
    f.runtime = { ...f.runtime, sampler: null };
    await expect(f.prepare()).resolves.toMatchObject({ cycle: f.state().cycle });
  });
  it.each([
    { policy: null },
    { policy: { ...policy, peerCount: 0 } },
    { policy: { ...policy, peerGate: 'approved' as const } },
    { bank: null },
    { selectionPolicyVersion: null },
    { rubricVersion: null },
    { initialAssignmentAllowed: false },
  ])('does not persist or infer missing/incompatible policy %o', async (patch) => {
    const f = new Fixture();
    f.contexts.set('learner-1', patch);
    await expect(f.prepare()).rejects.toMatchObject({ code: 'configuration_required' });
    expect(f.records.size).toBe(0);
    expect(f.writes).toEqual([]);
  });
  it('requires a matching configured sampler and rejects four, duplicate or foreign questions', async () => {
    for (const questions of [
      ['a', 'b', 'c', 'd'],
      ['a', 'b', 'c', 'd', 'd'],
      ['a', 'b', 'c', 'd', 'unknown'],
    ]) {
      const f = new Fixture();
      f.sample.mockResolvedValue(questions);
      await expect(f.prepare()).rejects.toMatchObject({ code: 'configuration_required' });
      expect(f.records.size).toBe(0);
    }
    const f = new Fixture();
    f.runtime = { ...f.runtime, sampler: { policyVersion: 'different', select: f.sample } };
    await expect(f.prepare()).rejects.toMatchObject({ code: 'configuration_required' });
    expect(f.sample).not.toHaveBeenCalled();
  });
  it('keeps no-peer state queued and filters self, inactive, wrong role/cohort and ineligible candidates', async () => {
    const f = new Fixture();
    f.contexts.set('learner-1', {
      peerCandidates: [
        candidate('learner-1'),
        candidate('inactive', 'learner', { active: false }),
        candidate('ineligible', 'learner', { eligible: false }),
        candidate('wrong-cohort', 'learner', { cohortId: 'other' }),
        candidate('staff', 'operator'),
      ],
    });
    await expect(f.prepare()).resolves.toMatchObject({
      assignmentState: 'queued_peers',
      eligibility: { state: 'awaiting_peers', masteryEligible: false, xpEligible: false },
    });
    expect(f.state().assignments).toEqual([]);
    expect(f.sample).toHaveBeenCalledOnce();
    f.contexts.set('learner-1', {});
    await expect(f.prepare()).resolves.toMatchObject({ assignmentState: 'assigned' });
    expect(f.sample).toHaveBeenCalledOnce();
  });
  it('rechecks the full graph under the injected lock when opposite initial allocations race', async () => {
    const f = new Fixture();
    const results = await Promise.all([f.prepare('learner-1'), f.prepare('learner-2')]);
    expect(results.map((result) => result.assignmentState)).toEqual(['assigned', 'queued_peers']);
    expect([...f.records.values()].flatMap((record) => record.assignments)).toHaveLength(1);
  });
  it('rolls back a sampled cycle if graph completeness or assignment persistence fails', async () => {
    const f = new Fixture();
    f.completeGraph = false;
    await expect(f.prepare()).rejects.toMatchObject({ code: 'unavailable' });
    expect(f.records.size).toBe(0);
    f.completeGraph = true;
    f.failAssignmentWrite = true;
    await expect(f.prepare()).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
    expect(f.records.size).toBe(0);
    expect(f.writes).toEqual([]);
  });
  it('rejects changed evidence, policy or bank without mutating the frozen record or resampling', async () => {
    for (const patch of [
      {
        evidence: {
          contentVersion: 'other',
          evidenceVersion: 'evidence-fixture-1',
          evidenceDigest: 'a'.repeat(64),
        },
      },
      { policy: { ...policy, peerCount: 2 } },
      { bank: { ...bank, digest: 'c'.repeat(64) } },
      { selectionPolicyVersion: 'other' },
      { rubricVersion: 'other' },
    ]) {
      const f = new Fixture();
      await f.prepare();
      const before = structuredClone(f.state());
      f.contexts.set('learner-1', patch);
      await expect(f.prepare()).rejects.toMatchObject({
        code: patch.evidence ? 'evidence_conflict' : 'policy_conflict',
      });
      expect(f.state()).toEqual(before);
      expect(f.sample).toHaveBeenCalledOnce();
    }
  });
  it('rechecks learner ownership and current access rather than accepting caller flags', async () => {
    for (const patch of [
      { actor: candidate('other') },
      { actor: candidate('learner-1', 'admin') },
      { actor: candidate('learner-1', 'learner', { active: false }) },
      { learnerAccess: false },
    ]) {
      const f = new Fixture();
      f.contexts.set('learner-1', patch);
      await expect(f.prepare()).rejects.toMatchObject({ code: 'forbidden' });
      expect(f.sample).not.toHaveBeenCalled();
      expect(f.records.size).toBe(0);
    }
  });
});

describe('Quest immutable receipt intake and automatic mentor allocation', () => {
  it('requires completed peer review before assigning an operator/admin mentor; only mentor approval enables mastery/XP eligibility', async () => {
    const f = new Fixture();
    await f.prepare();
    expect(f.state().assignments.map((a) => a.kind)).toEqual(['peer']);
    await expect(f.submit()).resolves.toMatchObject({
      replayed: false,
      eligibility: { state: 'awaiting_mentor', masteryEligible: false, xpEligible: false },
    });
    expect(f.writes).toEqual(['cycle', 'peer', 'receipt', 'mentor']);
    expect(f.state().assignments[1]!.assignedAtMs).toBeGreaterThanOrEqual(
      f.state().receipts[0]!.submittedAtMs,
    );
    const result = await f.submit('mentor-1', 'approved', 'request-mentor');
    expect(result.eligibility).toEqual({
      state: 'completion_eligible',
      masteryEligible: true,
      xpEligible: true,
    });
    expect(Object.keys(result.eligibility)).not.toContain('xpAmount');
    expect(f.writes).toEqual(['cycle', 'peer', 'receipt', 'mentor', 'receipt']);
    expect(
      questReleaseAccess({
        cohortId: scope.cohortId,
        questKey: 'quest-3',
        currentAccess: true,
        serverNowMs: 100,
        release: {
          version: 1,
          revision: 'schedule-fixture',
          cohortId: scope.cohortId,
          questKey: 'quest-3',
          cohortStartsAtMs: 100,
          openingOffsetSeconds: 0,
        },
      }).canAccess,
    ).toBe(true);
  });
  it('queues without a valid mentor and preserves the completed peer receipt', async () => {
    const f = new Fixture();
    await f.prepare();
    f.contexts.set('learner-2', {
      mentorCandidates: [
        candidate('learner-1', 'admin'),
        candidate('learner-3'),
        candidate('mentor-inactive', 'operator', { active: false }),
      ],
    });
    await expect(f.submit()).resolves.toMatchObject({
      eligibility: {
        state: 'mentor_assignment_required',
        masteryEligible: false,
        xpEligible: false,
      },
    });
    expect(f.state().receipts).toHaveLength(1);
    expect(f.state().assignments).toHaveLength(1);
    await expect(f.prepare()).resolves.toMatchObject({
      assignmentState: 'assigned',
      eligibility: { state: 'awaiting_mentor' },
    });
    expect(f.sample).toHaveBeenCalledOnce();
  });
  it('serializes exact request replays and rejects conflicting decisions/new receipt IDs without rewriting history', async () => {
    const f = new Fixture();
    await f.prepare();
    const results = await Promise.all([f.submit(), f.submit(), f.submit()]);
    expect(results.map((result) => result.replayed)).toEqual([false, true, true]);
    expect(f.state().receipts).toHaveLength(1);
    expect(f.state().assignments).toHaveLength(2);
    await f.submit('mentor-1', 'approved', 'mentor-request');
    const before = structuredClone(f.state());
    await expect(f.submit('mentor-1', 'changes_requested', 'mentor-request')).rejects.toMatchObject(
      { code: 'idempotency_conflict' },
    );
    await expect(f.submit('mentor-1', 'approved', 'other-request')).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(f.state()).toEqual(before);
  });
  it('rejects reuse of a request ID across actors/assignments', async () => {
    const f = new Fixture();
    await f.prepare();
    await f.submit();
    await expect(f.submit('mentor-1', 'approved', 'request-peer')).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(f.state().receipts).toHaveLength(1);
  });
  it('retains revision-required evidence and blocks approval replacement or silent new cycles', async () => {
    const f = new Fixture();
    await f.prepare();
    await f.submit();
    await expect(
      f.submit('mentor-1', 'changes_requested', 'mentor-revision'),
    ).resolves.toMatchObject({
      eligibility: { state: 'revision_required', masteryEligible: false, xpEligible: false },
    });
    await expect(f.prepare()).resolves.toMatchObject({
      eligibility: { state: 'revision_required' },
    });
    await expect(f.submit('mentor-1', 'approved', 'mentor-new')).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(f.records.size).toBe(1);
    expect(f.sample).toHaveBeenCalledOnce();
  });
  it('rechecks current actor/access/evidence even for an exact duplicate receipt request', async () => {
    const f = new Fixture();
    await f.prepare();
    await f.submit();
    const before = structuredClone(f.state());
    for (const patch of [
      { actor: candidate('learner-2', 'learner', { active: false }) },
      { actor: candidate('learner-2', 'learner', { eligible: false }) },
      { actor: candidate('learner-2', 'learner', { cohortId: 'other' }) },
      { learnerAccess: false },
      { evidence: null },
    ]) {
      f.contexts.set('learner-2', patch);
      await expect(f.submit()).rejects.toMatchObject({
        code: patch.evidence === null ? 'evidence_conflict' : 'forbidden',
      });
      expect(f.state()).toEqual(before);
    }
  });
  it('rejects self, unassigned reviewers, stale cycle IDs and peer attempts to issue mentor approval', async () => {
    const f = new Fixture();
    await f.prepare();
    await expect(f.submit('learner-1')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(f.submit('unassigned')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(f.submit('learner-2', 'approved')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      submitQuestReview(f, f.runtime, {
        scope,
        subjectId: 'auth:learner-2',
        cycleId: 'stale',
        assignmentId: f.state().assignments[0]!.id,
        requestId: 'stale-request',
        decision: 'submitted',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(f.state().receipts).toEqual([]);
  });
  it('rejects an unrelated admin and rejects learner-role mentor intake', async () => {
    const f = new Fixture();
    await f.prepare();
    await f.submit();
    f.contexts.set('admin', { actor: candidate('admin', 'admin') });
    await expect(f.submit('admin', 'approved')).rejects.toMatchObject({ code: 'forbidden' });
    f.contexts.set('mentor-1', { actor: candidate('mentor-1', 'learner') });
    await expect(f.submit('mentor-1', 'approved')).rejects.toMatchObject({ code: 'forbidden' });
    expect(f.state().receipts).toHaveLength(1);
  });
  it('atomically rolls back peer intake when the automatic mentor write fails, then permits a clean retry', async () => {
    const f = new Fixture();
    await f.prepare();
    f.failAssignmentWrite = true;
    await expect(f.submit()).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
    expect(f.state().receipts).toEqual([]);
    expect(f.state().assignments).toHaveLength(1);
    f.failAssignmentWrite = false;
    await expect(f.submit()).resolves.toMatchObject({
      replayed: false,
      eligibility: { state: 'awaiting_mentor' },
    });
    expect(f.state().receipts).toHaveLength(1);
  });
});

it('rejects an adapter lookup that returns a receipt for a different request ID', async () => {
  const f = new Fixture();
  await f.prepare();
  await f.submit();
  const state = f.state();
  const repository: QuestReviewRepository = {
    transaction: (key, work) =>
      f.transaction(key, (tx) => work({ ...tx, receipt: async () => state.receipts[0]! })),
  };
  await expect(
    submitQuestReview(repository, f.runtime, {
      scope,
      subjectId: 'auth:learner-2',
      cycleId: state.cycle.cycleId,
      assignmentId: state.assignments[0]!.id,
      requestId: 'different-request',
      decision: 'submitted',
    }),
  ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  expect(f.state()).toEqual(state);
});
