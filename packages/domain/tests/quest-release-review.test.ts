import { approvedPiscinePilotPolicy } from '../piscine-pilot-policy';
import { describe, expect, it } from 'vitest';
import {
  assertQuestReviewReceipt,
  freezeQuestReviewCycle,
  proposeQuestMentor,
  proposeQuestPeers,
  questReleaseAccess,
  questReviewEligibility,
  sameQuestReviewCycle,
  type QuestReviewAssignment,
  type QuestReviewFacts,
  type QuestReviewPolicy,
  type QuestReviewReceipt,
} from '../quest-release-review';

const identity = {
  cycleId: 'cycle-1',
  cohortId: 'cohort-1',
  questKey: 'quest-2',
  learnerId: 'learner-1',
  contentVersion: 'content-1',
  evidenceVersion: 'evidence-1',
  evidenceDigest: 'a'.repeat(64),
};
const bank = {
  version: 'bank-1',
  digest: 'b'.repeat(64),
  questionIds: ['a', 'b', 'c', 'd', 'e', 'f'],
};
const selection = {
  policyVersion: 'sampler-explicit-1',
  count: 5 as const,
  questionIds: ['d', 'b', 'a', 'e', 'f'],
  rubricVersion: 'rubric-1',
};
const cycle = () => freezeQuestReviewCycle({ identity, bank, selection });
/** Synthetic policy values are test inputs, never production defaults. */
const policy: QuestReviewPolicy = {
  version: 1,
  revision: 'policy-1',
  peerCount: 2,
  peerGate: 'approved',
  rankingPolicyVersion: 'rank-1',
};
const candidate = (id: string, changes = {}) => ({
  id,
  cohortId: 'cohort-1',
  active: true,
  eligible: true,
  ...changes,
});
function assignment(
  id: string,
  kind: 'peer' | 'mentor',
  reviewerId: string,
  at = 10,
): QuestReviewAssignment {
  return {
    id,
    kind,
    reviewerId,
    cycle: cycle(),
    policyRevision: policy.revision,
    assignedAtMs: at,
  };
}
function receipt(
  a: QuestReviewAssignment,
  decision: QuestReviewReceipt['decision'] = 'approved',
  at = 20,
): QuestReviewReceipt {
  return {
    id: `receipt-${a.id}`,
    assignmentId: a.id,
    reviewerId: a.reviewerId,
    cycle: a.cycle,
    decision,
    submittedAtMs: at,
  };
}
function facts(): QuestReviewFacts {
  return {
    cycle: cycle(),
    policy,
    currentAccess: true,
    evidenceCurrent: true,
    assignments: [],
    receipts: [],
  };
}
function peerComplete(): QuestReviewFacts {
  const peers = [
    assignment('peer-1', 'peer', 'learner-2'),
    assignment('peer-2', 'peer', 'learner-3'),
  ];
  return { ...facts(), assignments: peers, receipts: peers.map((a) => receipt(a)) };
}
function complete(): QuestReviewFacts {
  const peers = peerComplete(),
    mentor = assignment('mentor-1', 'mentor', 'mentor', 30);
  return {
    ...peers,
    assignments: [...peers.assignments, mentor],
    receipts: [...peers.receipts, receipt(mentor, 'approved', 40)],
  };
}
function peerInput() {
  return {
    cycle: cycle(),
    policy,
    currentAccess: true,
    cycleUnassigned: true,
    graphComplete: true,
    edges: [],
    orderedCandidates: [candidate('learner-2'), candidate('learner-3')],
  };
}

describe('explicit scheduled quest release v1', () => {
  const release = {
    version: 1 as const,
    revision: 'schedule-1',
    cohortId: 'cohort-1',
    questKey: 'quest-2',
    cohortStartsAtMs: 100000,
    openingOffsetSeconds: 60,
  };
  const input = {
    cohortId: 'cohort-1',
    questKey: 'quest-2',
    currentAccess: true,
    serverNowMs: 159999,
    release,
  };
  it('opens at the configured relative instant, including the boundary', () => {
    expect(questReleaseAccess(input)).toEqual({
      state: 'scheduled',
      canAccess: false,
      opensAtMs: 160000,
    });
    expect(questReleaseAccess({ ...input, serverNowMs: 160000 })).toEqual({
      state: 'open',
      canAccess: true,
      opensAtMs: 160000,
    });
  });
  it('does not infer cohort schedule or permit removed access', () => {
    expect(questReleaseAccess({ ...input, release: null }).state).toBe('unconfigured');
    expect(questReleaseAccess({ ...input, currentAccess: false, serverNowMs: 900000 }).state).toBe(
      'forbidden',
    );
  });
  it('keeps opening independent of previous quest reviews or XP eligibility', () => {
    expect(questReviewEligibility(facts()).masteryEligible).toBe(false);
    expect(questReleaseAccess({ ...input, serverNowMs: 160000 }).canAccess).toBe(true);
    expect(questReviewEligibility(complete()).masteryEligible).toBe(true);
    expect(questReleaseAccess(input).canAccess).toBe(false);
  });
  it.each([NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER])(
    'rejects invalid release offset %s',
    (openingOffsetSeconds) => {
      expect(() =>
        questReleaseAccess({ ...input, release: { ...release, openingOffsetSeconds } }),
      ).toThrow('QUEST_RELEASE_INVALID');
    },
  );
  it('rejects cross-cohort, cross-quest, invalid clock and unsupported version', () => {
    for (const change of [
      { cohortId: 'other' },
      { questKey: 'other' },
      { serverNowMs: NaN },
      { release: { ...release, version: 2 } },
    ]) {
      expect(() => questReleaseAccess({ ...input, ...change } as unknown as typeof input)).toThrow(
        'QUEST_RELEASE_INVALID',
      );
    }
  });
});

describe('immutable quest review evidence and question selection', () => {
  it.each([5] as const)(
    'freezes an explicitly supplied %s-question selection without sampling',
    (count) => {
      const questions = [...bank.questionIds.slice(0, count)];
      const frozen = freezeQuestReviewCycle({
        identity,
        bank,
        selection: { ...selection, count, questionIds: questions },
      });
      questions.reverse();
      expect(frozen.questionIds).toEqual(bank.questionIds.slice(0, count));
      expect(Object.isFrozen(frozen)).toBe(true);
      expect(Object.isFrozen(frozen.questionIds)).toBe(true);
      expect(
        sameQuestReviewCycle(
          frozen,
          freezeQuestReviewCycle({
            identity,
            bank,
            selection: { ...selection, count, questionIds: bank.questionIds.slice(0, count) },
          }),
        ),
      ).toBe(true);
    },
  );
  it('rejects rerolled order and every changed evidence/definition/rubric identity', () => {
    const original = cycle();
    for (const field of [
      'cycleId',
      'cohortId',
      'questKey',
      'learnerId',
      'contentVersion',
      'evidenceVersion',
      'questionBankVersion',
      'selectionPolicyVersion',
      'rubricVersion',
    ] as const) {
      expect(sameQuestReviewCycle(original, { ...original, [field]: 'different' })).toBe(false);
    }
    expect(sameQuestReviewCycle(original, { ...original, evidenceDigest: 'c'.repeat(64) })).toBe(
      false,
    );
    expect(
      sameQuestReviewCycle(original, { ...original, questionBankDigest: 'c'.repeat(64) }),
    ).toBe(false);
    expect(
      sameQuestReviewCycle(original, {
        ...original,
        questionIds: [...original.questionIds].reverse(),
      }),
    ).toBe(false);
  });
  it('rejects absent sampling policy, wrong count, duplicate and unknown questions', () => {
    for (const change of [
      { count: 3 },
      { count: 4 },
      { policyVersion: '' },
      { questionIds: ['a', 'a', 'b', 'c'] },
      { questionIds: ['a', 'b', 'c', 'unknown'] },
    ]) {
      expect(() =>
        freezeQuestReviewCycle({
          identity,
          bank,
          selection: { ...selection, ...change } as unknown as typeof selection,
        }),
      ).toThrow('QUEST_REVIEW_SELECTION_INVALID');
    }
    expect(() =>
      freezeQuestReviewCycle({ identity: { ...identity, evidenceDigest: 'bad' }, bank, selection }),
    ).toThrow('QUEST_REVIEW_SELECTION_INVALID');
    expect(() =>
      freezeQuestReviewCycle({
        identity: { ...identity, learnerId: undefined } as unknown as typeof identity,
        bank,
        selection,
      }),
    ).toThrow('QUEST_REVIEW_SELECTION_INVALID');
  });
});

describe('server-ranked assignment proposals, never persisted assignments', () => {
  it('filters self, inactive, ineligible and cross-cohort peers while respecting supplied order', () => {
    expect(
      proposeQuestPeers({
        ...peerInput(),
        orderedCandidates: [
          candidate('learner-1'),
          candidate('inactive', { active: false }),
          candidate('ineligible', { eligible: false }),
          candidate('other', { cohortId: 'other' }),
          candidate('learner-3'),
          candidate('learner-2'),
        ],
      }),
    ).toEqual({ state: 'proposed', reviewerIds: ['learner-3', 'learner-2'] });
  });
  it('rejects reciprocal peer proposals and queues rather than bypassing missing peers', () => {
    const input = {
      ...peerInput(),
      edges: [
        {
          cohortId: 'cohort-1',
          questKey: 'quest-2',
          reviewerId: 'learner-1',
          learnerId: 'learner-2',
        },
      ],
    };
    expect(proposeQuestPeers(input)).toEqual({ state: 'queued', reviewerIds: [] });
    expect(proposeQuestPeers({ ...peerInput(), orderedCandidates: [] }).state).toBe('queued');
    // Rechecking after an opposite assignment commits rejects the competing proposal.
    expect(
      proposeQuestPeers({
        ...input,
        policy: { ...policy, peerCount: 1 },
        orderedCandidates: [candidate('learner-2')],
      }).state,
    ).toBe('queued');
  });
  it('requires policy, complete graph, access and a genuinely unassigned cycle', () => {
    expect(proposeQuestPeers({ ...peerInput(), policy: null }).state).toBe('policy_required');
    for (const key of ['graphComplete', 'currentAccess', 'cycleUnassigned'] as const) {
      expect(proposeQuestPeers({ ...peerInput(), [key]: false }).state).toBe('context_required');
    }
  });
  it('does not invent a fallback count/ranking or accept duplicate candidate identities', () => {
    for (const change of [
      { peerCount: 0 },
      { peerCount: 1.5 },
      { rankingPolicyVersion: '' },
      { peerGate: 'anything' },
    ]) {
      expect(
        proposeQuestPeers({ ...peerInput(), policy: { ...policy, ...change } as QuestReviewPolicy })
          .state,
      ).toBe('policy_required');
    }
    expect(() =>
      proposeQuestPeers({
        ...peerInput(),
        orderedCandidates: [candidate('same'), candidate('same')],
      }),
    ).toThrow('QUEST_ASSIGNMENT_INPUT_INVALID');
  });
  it('waits for peers before proposing an eligible mentor and never self-assigns', () => {
    expect(
      proposeQuestMentor({ facts: facts(), orderedCandidates: [candidate('mentor')] }).state,
    ).toBe('context_required');
    expect(
      proposeQuestMentor({
        facts: peerComplete(),
        orderedCandidates: [
          candidate('learner-1'),
          candidate('removed', { active: false }),
          candidate('mentor'),
        ],
      }),
    ).toEqual({ state: 'proposed', reviewerIds: ['mentor'] });
    expect(proposeQuestMentor({ facts: peerComplete(), orderedCandidates: [] })).toEqual({
      state: 'queued',
      reviewerIds: [],
    });
  });
});

describe('peer then mentor completion eligibility, no mastery/XP mutation', () => {
  it('requires an explicit peer completion rule and the exact required count', () => {
    expect(questReviewEligibility({ ...facts(), policy: null }).state).toBe('policy_required');
    const completed = peerComplete();
    expect(
      questReviewEligibility({
        ...completed,
        assignments: completed.assignments.slice(0, 1),
        receipts: completed.receipts.slice(0, 1),
      }).state,
    ).toBe('awaiting_peers');
    const receipts = completed.receipts.map((r) => ({ ...r, decision: 'submitted' as const }));
    expect(questReviewEligibility({ ...completed, receipts }).state).toBe('awaiting_peers');
    expect(
      questReviewEligibility({
        ...completed,
        policy: { ...policy, peerGate: 'submitted' },
        receipts,
      }).state,
    ).toBe('mentor_assignment_required');
  });
  it('does not imply automated PASS or peer completion awards mastery or XP', () => {
    expect(questReviewEligibility(peerComplete())).toEqual({
      state: 'mentor_assignment_required',
      masteryEligible: false,
      xpEligible: false,
    });
    const mentor = assignment('mentor', 'mentor', 'mentor', 30),
      peers = peerComplete();
    expect(
      questReviewEligibility({ ...peers, assignments: [...peers.assignments, mentor] }).state,
    ).toBe('awaiting_mentor');
    const result = questReviewEligibility(complete());
    expect(result).toEqual({
      state: 'completion_eligible',
      masteryEligible: true,
      xpEligible: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).not.toContain('xpAmount');
  });
  it('handles explicit mentor revision without silently reusing approvals after evidence edits', () => {
    const f = complete(),
      last = f.receipts[f.receipts.length - 1]!;
    expect(
      questReviewEligibility({
        ...f,
        receipts: [...f.receipts.slice(0, -1), { ...last, decision: 'changes_requested' }],
      }).state,
    ).toBe('revision_required');
    expect(questReviewEligibility({ ...f, evidenceCurrent: false }).state).toBe('blocked');
    expect(() =>
      questReviewEligibility({ ...f, cycle: { ...f.cycle, evidenceDigest: 'd'.repeat(64) } }),
    ).toThrow('QUEST_REVIEW_RECORD_CONFLICT');
  });
  it('blocks current access removal without rewriting historical receipts', () => {
    const f = complete(),
      before = JSON.stringify(f);
    expect(questReviewEligibility({ ...f, currentAccess: false })).toEqual({
      state: 'blocked',
      masteryEligible: false,
      xpEligible: false,
    });
    expect(JSON.stringify(f)).toBe(before);
  });
  it('rejects mentor assignment or review before required peer completion', () => {
    const mentor = assignment('mentor', 'mentor', 'mentor', 30);
    expect(() => questReviewEligibility({ ...facts(), assignments: [mentor] })).toThrow(
      'QUEST_MENTOR_BEFORE_PEERS',
    );
    const p = peerComplete();
    expect(() =>
      questReviewEligibility({
        ...p,
        assignments: [...p.assignments, { ...mentor, assignedAtMs: 15 }],
      }),
    ).toThrow('QUEST_MENTOR_BEFORE_PEERS');
    expect(() =>
      questReviewEligibility({
        ...p,
        assignments: [...p.assignments, mentor],
        receipts: [...p.receipts, receipt(mentor, 'approved', 25)],
      }),
    ).toThrow('QUEST_REVIEW_RECORD_CONFLICT');
  });
  it('rejects self approval, stale policies, duplicate assignments and conflicting receipts', () => {
    const f = complete();
    expect(() =>
      questReviewEligibility({ ...f, assignments: [...f.assignments, f.assignments[0]!] }),
    ).toThrow('QUEST_REVIEW_RECORD_CONFLICT');
    expect(() =>
      questReviewEligibility({
        ...f,
        receipts: [...f.receipts, { ...f.receipts[0]!, id: 'duplicate-other-id' }],
      }),
    ).toThrow('QUEST_REVIEW_RECORD_CONFLICT');
    expect(() =>
      questReviewEligibility({
        ...f,
        assignments: f.assignments.map((a) => ({ ...a, policyRevision: 'old' })),
      }),
    ).toThrow('QUEST_REVIEW_RECORD_CONFLICT');
    expect(() =>
      questReviewEligibility({
        ...f,
        assignments: f.assignments.map((a) =>
          a.kind === 'mentor' ? { ...a, reviewerId: f.cycle.learnerId } : a,
        ),
      }),
    ).toThrow('QUEST_REVIEW_RECORD_CONFLICT');
  });
  it('rechecks assigned actor and exact evidence when accepting a receipt', () => {
    const p = peerComplete(),
      mentor = assignment('mentor', 'mentor', 'mentor', 30);
    const input = {
      facts: { ...p, assignments: [...p.assignments, mentor] },
      receipt: receipt(mentor, 'approved', 40),
      actorId: 'mentor',
      actorActive: true,
      actorEligible: true,
    };
    expect(() => assertQuestReviewReceipt(input)).not.toThrow();
    for (const change of [{ actorId: 'other' }, { actorActive: false }, { actorEligible: false }]) {
      expect(() => assertQuestReviewReceipt({ ...input, ...change })).toThrow(
        'QUEST_REVIEW_FORBIDDEN',
      );
    }
    expect(() =>
      assertQuestReviewReceipt({
        ...input,
        receipt: { ...input.receipt, cycle: { ...cycle(), evidenceVersion: 'different' } },
      }),
    ).toThrow('QUEST_REVIEW_RECORD_CONFLICT');
    expect(() =>
      assertQuestReviewReceipt({ ...input, facts: { ...input.facts, currentAccess: false } }),
    ).toThrow('QUEST_REVIEW_FORBIDDEN');
  });
});

// These values were explicitly approved by the owner, not inferred technical defaults.
describe('approved pilot settings', () => {
  it('records31days, five questions and three project members without generating a schedule', () => {
    expect(approvedPiscinePilotPolicy).toEqual({
      version: 1,
      durationDays: 31,
      peerReviewQuestionCount: 5,
      projectTeamSize: 3,
    });
    expect(Object.isFrozen(approvedPiscinePilotPolicy)).toBe(true);
    expect(
      questReleaseAccess({
        cohortId: 'cohort',
        questKey: 'quest',
        currentAccess: true,
        serverNowMs: 1000,
        release: null,
      }).state,
    ).toBe('unconfigured');
  });
});
