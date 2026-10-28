import { approvedPiscinePilotPolicy } from './piscine-pilot-policy';
/** Versioned, pure proposals only. Callers must supply current server-owned facts and
 * persist/recheck proposals atomically; these functions grant no database authority. */
export type QuestRelease = Readonly<{
  version: 1;
  revision: string;
  cohortId: string;
  questKey: string;
  cohortStartsAtMs: number;
  openingOffsetSeconds: number;
}>;
export type QuestReleaseAccess =
  | Readonly<{ state: 'forbidden' | 'unconfigured'; canAccess: false }>
  | Readonly<{ state: 'scheduled'; canAccess: false; opensAtMs: number }>
  | Readonly<{ state: 'open'; canAccess: true; opensAtMs: number }>;

function fail(code: string): never {
  throw new Error(code);
}
function id(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.trim() === value && !value.includes('\0')
  );
}
function timestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Math.abs(Number(value)) <= 8640000000000000;
}
function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function ids(values: readonly string[]) {
  return Array.isArray(values) && values.every(id) && new Set(values).size === values.length;
}

/** Release is relative to an explicit cohort instant. Review/mastery is deliberately
 * absent from this input: it cannot become a hidden gate on a later scheduled quest. */
export function questReleaseAccess(input: {
  cohortId: string;
  questKey: string;
  currentAccess: boolean;
  serverNowMs: number;
  release: QuestRelease | null;
}): QuestReleaseAccess {
  if (input.currentAccess !== true) return Object.freeze({ state: 'forbidden', canAccess: false });
  const release = input.release;
  if (release === null) return Object.freeze({ state: 'unconfigured', canAccess: false });
  if (
    release.version !== 1 ||
    !id(release.revision) ||
    !id(input.cohortId) ||
    !id(input.questKey) ||
    release.cohortId !== input.cohortId ||
    release.questKey !== input.questKey ||
    !timestamp(release.cohortStartsAtMs) ||
    !timestamp(input.serverNowMs) ||
    !Number.isSafeInteger(release.openingOffsetSeconds)
  )
    fail('QUEST_RELEASE_INVALID');
  const opensAtMs = release.cohortStartsAtMs + release.openingOffsetSeconds * 1000;
  if (!timestamp(opensAtMs)) fail('QUEST_RELEASE_INVALID');
  return input.serverNowMs < opensAtMs
    ? Object.freeze({ state: 'scheduled', canAccess: false, opensAtMs })
    : Object.freeze({ state: 'open', canAccess: true, opensAtMs });
}

export type QuestReviewCycle = Readonly<{
  version: 1;
  cycleId: string;
  cohortId: string;
  questKey: string;
  learnerId: string;
  contentVersion: string;
  evidenceVersion: string;
  evidenceDigest: string;
  questionBankVersion: string;
  questionBankDigest: string;
  questionIds: readonly string[];
  selectionPolicyVersion: string;
  rubricVersion: string;
}>;
type CycleIdentity = Pick<
  QuestReviewCycle,
  | 'cycleId'
  | 'cohortId'
  | 'questKey'
  | 'learnerId'
  | 'contentVersion'
  | 'evidenceVersion'
  | 'evidenceDigest'
>;

/** Selection is supplied by an explicitly configured server-side sampler, never
 * sampled here. Return value must be persisted before displaying questions. */
export function freezeQuestReviewCycle(input: {
  identity: CycleIdentity;
  bank: Readonly<{ version: string; digest: string; questionIds: readonly string[] }>;
  selection: Readonly<{
    policyVersion: string;
    count: typeof approvedPiscinePilotPolicy.peerReviewQuestionCount;
    questionIds: readonly string[];
    rubricVersion: string;
  }>;
}): QuestReviewCycle {
  const { identity, bank, selection } = input;
  if (
    ![
      identity.cycleId,
      identity.cohortId,
      identity.questKey,
      identity.learnerId,
      identity.contentVersion,
      identity.evidenceVersion,
    ].every(id) ||
    !digest(identity.evidenceDigest) ||
    !id(bank.version) ||
    !digest(bank.digest) ||
    !ids(bank.questionIds) ||
    !id(selection.policyVersion) ||
    !id(selection.rubricVersion) ||
    selection.count !== approvedPiscinePilotPolicy.peerReviewQuestionCount ||
    !ids(selection.questionIds) ||
    selection.questionIds.length !== selection.count ||
    selection.questionIds.some((question) => !bank.questionIds.includes(question))
  )
    fail('QUEST_REVIEW_SELECTION_INVALID');
  return Object.freeze({
    version: 1,
    cycleId: identity.cycleId,
    cohortId: identity.cohortId,
    questKey: identity.questKey,
    learnerId: identity.learnerId,
    contentVersion: identity.contentVersion,
    evidenceVersion: identity.evidenceVersion,
    evidenceDigest: identity.evidenceDigest,
    questionBankVersion: bank.version,
    questionBankDigest: bank.digest,
    questionIds: Object.freeze([...selection.questionIds]),
    selectionPolicyVersion: selection.policyVersion,
    rubricVersion: selection.rubricVersion,
  });
}

function validCycle(cycle: QuestReviewCycle) {
  return (
    cycle.version === 1 &&
    [
      cycle.cycleId,
      cycle.cohortId,
      cycle.questKey,
      cycle.learnerId,
      cycle.contentVersion,
      cycle.evidenceVersion,
      cycle.questionBankVersion,
      cycle.selectionPolicyVersion,
      cycle.rubricVersion,
    ].every(id) &&
    digest(cycle.evidenceDigest) &&
    digest(cycle.questionBankDigest) &&
    ids(cycle.questionIds) &&
    cycle.questionIds.length === approvedPiscinePilotPolicy.peerReviewQuestionCount
  );
}
export function sameQuestReviewCycle(left: QuestReviewCycle, right: QuestReviewCycle) {
  return (
    validCycle(left) &&
    validCycle(right) &&
    left.version === right.version &&
    left.cycleId === right.cycleId &&
    left.cohortId === right.cohortId &&
    left.questKey === right.questKey &&
    left.learnerId === right.learnerId &&
    left.contentVersion === right.contentVersion &&
    left.evidenceVersion === right.evidenceVersion &&
    left.evidenceDigest === right.evidenceDigest &&
    left.questionBankVersion === right.questionBankVersion &&
    left.questionBankDigest === right.questionBankDigest &&
    left.selectionPolicyVersion === right.selectionPolicyVersion &&
    left.rubricVersion === right.rubricVersion &&
    left.questionIds.length === right.questionIds.length &&
    left.questionIds.every((question, index) => question === right.questionIds[index])
  );
}

export type QuestReviewPolicy = Readonly<{
  version: 1;
  revision: string;
  peerCount: number;
  /** Owner must decide whether completion alone or positive peer verdict is required. */
  peerGate: 'submitted' | 'approved';
  rankingPolicyVersion: string;
}>;
function validPolicy(policy: QuestReviewPolicy | null): policy is QuestReviewPolicy {
  return (
    policy !== null &&
    policy.version === 1 &&
    id(policy.revision) &&
    id(policy.rankingPolicyVersion) &&
    Number.isSafeInteger(policy.peerCount) &&
    policy.peerCount > 0 &&
    (policy.peerGate === 'submitted' || policy.peerGate === 'approved')
  );
}
export type QuestReviewCandidate = Readonly<{
  id: string;
  cohortId: string;
  active: boolean;
  eligible: boolean;
}>;
export type QuestPeerEdge = Readonly<{
  cohortId: string;
  questKey: string;
  reviewerId: string;
  learnerId: string;
}>;
export type QuestReviewerProposal = Readonly<{
  state: 'policy_required' | 'context_required' | 'queued' | 'proposed';
  reviewerIds: readonly string[];
}>;
const proposal = (
  state: QuestReviewerProposal['state'],
  reviewers: readonly string[] = [],
): QuestReviewerProposal => Object.freeze({ state, reviewerIds: Object.freeze([...reviewers]) });

/** Candidate order/ranking and pool eligibility are explicit server policy inputs.
 * The complete same-cohort/quest graph must be locked and rechecked when persisting.
 * This initial-assignment proposal never reassigns or retries an existing cycle. */
export function proposeQuestPeers(input: {
  cycle: QuestReviewCycle;
  policy: QuestReviewPolicy | null;
  currentAccess: boolean;
  cycleUnassigned: boolean;
  graphComplete: boolean;
  edges: readonly QuestPeerEdge[];
  orderedCandidates: readonly QuestReviewCandidate[];
}): QuestReviewerProposal {
  if (!validPolicy(input.policy)) return proposal('policy_required');
  if (
    !validCycle(input.cycle) ||
    input.currentAccess !== true ||
    input.graphComplete !== true ||
    input.cycleUnassigned !== true
  )
    return proposal('context_required');
  if (
    !ids(input.orderedCandidates.map((candidate) => candidate.id)) ||
    input.edges.some(
      (edge) =>
        ![edge.cohortId, edge.questKey, edge.reviewerId, edge.learnerId].every(id) ||
        edge.reviewerId === edge.learnerId,
    )
  )
    fail('QUEST_ASSIGNMENT_INPUT_INVALID');
  const reviewers = input.orderedCandidates
    .filter(
      (candidate) =>
        candidate.active === true &&
        candidate.eligible === true &&
        candidate.cohortId === input.cycle.cohortId &&
        candidate.id !== input.cycle.learnerId &&
        !input.edges.some(
          (edge) =>
            edge.cohortId === input.cycle.cohortId &&
            edge.questKey === input.cycle.questKey &&
            edge.reviewerId === input.cycle.learnerId &&
            edge.learnerId === candidate.id,
        ),
    )
    .slice(0, input.policy.peerCount)
    .map((candidate) => candidate.id);
  return reviewers.length === input.policy.peerCount
    ? proposal('proposed', reviewers)
    : proposal('queued');
}

export type QuestReviewAssignment = Readonly<{
  id: string;
  cycle: QuestReviewCycle;
  policyRevision: string;
  kind: 'peer' | 'mentor';
  reviewerId: string;
  assignedAtMs: number;
}>;
export type QuestReviewReceipt = Readonly<{
  id: string;
  assignmentId: string;
  cycle: QuestReviewCycle;
  reviewerId: string;
  decision: 'submitted' | 'approved' | 'changes_requested';
  submittedAtMs: number;
}>;
export type QuestReviewFacts = Readonly<{
  cycle: QuestReviewCycle;
  policy: QuestReviewPolicy | null;
  currentAccess: boolean;
  evidenceCurrent: boolean;
  assignments: readonly QuestReviewAssignment[];
  receipts: readonly QuestReviewReceipt[];
}>;
export type QuestReviewEligibility = Readonly<{
  state:
    | 'policy_required'
    | 'blocked'
    | 'awaiting_peers'
    | 'mentor_assignment_required'
    | 'awaiting_mentor'
    | 'revision_required'
    | 'completion_eligible';
  masteryEligible: boolean;
  xpEligible: boolean;
}>;
function eligibility(state: QuestReviewEligibility['state']): QuestReviewEligibility {
  return Object.freeze({
    state,
    masteryEligible: state === 'completion_eligible',
    xpEligible: state === 'completion_eligible',
  });
}
function checkedFacts(facts: QuestReviewFacts, policy: QuestReviewPolicy) {
  if (
    !ids(facts.assignments.map((assignment) => assignment.id)) ||
    !ids(facts.receipts.map((receipt) => receipt.id))
  )
    fail('QUEST_REVIEW_RECORD_CONFLICT');
  const peers = facts.assignments.filter((assignment) => assignment.kind === 'peer');
  const mentors = facts.assignments.filter((assignment) => assignment.kind === 'mentor');
  if (
    peers.length > policy.peerCount ||
    mentors.length > 1 ||
    !ids(peers.map((peer) => peer.reviewerId))
  )
    fail('QUEST_REVIEW_RECORD_CONFLICT');
  for (const assignment of facts.assignments) {
    if (
      !id(assignment.id) ||
      !id(assignment.reviewerId) ||
      assignment.reviewerId === facts.cycle.learnerId ||
      !['peer', 'mentor'].includes(assignment.kind) ||
      !timestamp(assignment.assignedAtMs) ||
      assignment.policyRevision !== policy.revision ||
      !sameQuestReviewCycle(assignment.cycle, facts.cycle)
    )
      fail('QUEST_REVIEW_RECORD_CONFLICT');
  }
  const byAssignment = new Map<string, QuestReviewReceipt>();
  for (const receipt of facts.receipts) {
    const assignment = facts.assignments.find((candidate) => candidate.id === receipt.assignmentId);
    if (
      !assignment ||
      byAssignment.has(receipt.assignmentId) ||
      receipt.reviewerId !== assignment.reviewerId ||
      !sameQuestReviewCycle(receipt.cycle, facts.cycle) ||
      !timestamp(receipt.submittedAtMs) ||
      receipt.submittedAtMs < assignment.assignedAtMs ||
      !['submitted', 'approved', 'changes_requested'].includes(receipt.decision)
    )
      fail('QUEST_REVIEW_RECORD_CONFLICT');
    byAssignment.set(receipt.assignmentId, receipt);
  }
  const peerReceipts = peers.map((peer) => byAssignment.get(peer.id));
  const peersReady =
    peers.length === policy.peerCount &&
    peerReceipts.every(
      (receipt) => receipt && (policy.peerGate === 'submitted' || receipt.decision === 'approved'),
    );
  const mentor = mentors[0];
  if (
    mentor &&
    (!peersReady || peerReceipts.some((receipt) => receipt!.submittedAtMs > mentor.assignedAtMs))
  )
    fail('QUEST_MENTOR_BEFORE_PEERS');
  return { peersReady, mentor, byAssignment };
}

/** Eligibility only, never an award or persisted mastery. Existing receipts must
 * already be verified immutable server records. Actor authority is rechecked on intake. */
export function questReviewEligibility(facts: QuestReviewFacts): QuestReviewEligibility {
  if (!validPolicy(facts.policy)) return eligibility('policy_required');
  if (!validCycle(facts.cycle) || facts.currentAccess !== true || facts.evidenceCurrent !== true)
    return eligibility('blocked');
  const checked = checkedFacts(facts, facts.policy);
  if (!checked.peersReady) return eligibility('awaiting_peers');
  if (!checked.mentor) return eligibility('mentor_assignment_required');
  const decision = checked.byAssignment.get(checked.mentor.id)?.decision;
  return eligibility(
    decision === 'approved'
      ? 'completion_eligible'
      : decision === 'changes_requested'
        ? 'revision_required'
        : 'awaiting_mentor',
  );
}

export function proposeQuestMentor(input: {
  facts: QuestReviewFacts;
  orderedCandidates: readonly QuestReviewCandidate[];
}): QuestReviewerProposal {
  const state = questReviewEligibility(input.facts).state;
  if (state === 'policy_required') return proposal('policy_required');
  if (state !== 'mentor_assignment_required') return proposal('context_required');
  if (!ids(input.orderedCandidates.map((candidate) => candidate.id)))
    fail('QUEST_ASSIGNMENT_INPUT_INVALID');
  const mentor = input.orderedCandidates.find(
    (candidate) =>
      candidate.active === true &&
      candidate.eligible === true &&
      candidate.cohortId === input.facts.cycle.cohortId &&
      candidate.id !== input.facts.cycle.learnerId,
  );
  return mentor ? proposal('proposed', [mentor.id]) : proposal('queued');
}

/** Validate a proposed receipt before storage, never authenticate a caller here.
 * Conflicting/repeated receipts require server idempotency, not last-write-wins. */
export function assertQuestReviewReceipt(input: {
  facts: QuestReviewFacts;
  receipt: QuestReviewReceipt;
  actorId: string;
  actorActive: boolean;
  actorEligible: boolean;
}) {
  if (
    input.actorActive !== true ||
    input.actorEligible !== true ||
    input.actorId !== input.receipt.reviewerId ||
    input.actorId === input.facts.cycle.learnerId ||
    input.facts.currentAccess !== true ||
    input.facts.evidenceCurrent !== true ||
    !validPolicy(input.facts.policy) ||
    !validCycle(input.facts.cycle)
  )
    fail('QUEST_REVIEW_FORBIDDEN');
  checkedFacts(
    { ...input.facts, receipts: [...input.facts.receipts, input.receipt] },
    input.facts.policy,
  );
}
