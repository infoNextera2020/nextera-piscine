import {
  assertQuestReviewReceipt,
  freezeQuestReviewCycle,
  proposeQuestMentor,
  proposeQuestPeers,
  questReviewEligibility,
  sameQuestReviewCycle,
  type QuestPeerEdge,
  type QuestReviewAssignment,
  type QuestReviewCandidate,
  type QuestReviewCycle,
  type QuestReviewEligibility,
  type QuestReviewFacts,
  type QuestReviewPolicy,
  type QuestReviewReceipt,
} from '@nextera/domain';

export type QuestReviewScope = Readonly<{
  cohortId: string;
  questKey: string;
  learnerId: string;
}>;
type Role = 'learner' | 'operator' | 'admin';
type Candidate = QuestReviewCandidate & Readonly<{ role: Role }>;
type Bank = Readonly<{ version: string; digest: string; questionIds: readonly string[] }>;
export type StoredQuestReview = Readonly<{
  cycle: QuestReviewCycle;
  policy: QuestReviewPolicy;
  assignments: readonly QuestReviewAssignment[];
  receipts: readonly QuestReviewReceipt[];
}>;

/** All fields are resolved from current server records under the transaction lock.
 * These are adapter facts, never request body authorization or browser policy. */
export type QuestReviewContext = Readonly<{
  actor: Readonly<{ id: string; role: Role; cohortId: string; active: boolean; eligible: boolean }>;
  learnerAccess: boolean;
  evidence: Readonly<{
    contentVersion: string;
    evidenceVersion: string;
    evidenceDigest: string;
  }> | null;
  policy: QuestReviewPolicy | null;
  bank: Bank | null;
  selectionPolicyVersion: string | null;
  rubricVersion: string | null;
  /** Explicit server trigger permission; no retry/reassignment policy is supplied here. */
  initialAssignmentAllowed: boolean;
  peerCandidates: readonly Candidate[];
  mentorCandidates: readonly Candidate[];
}>;

export interface QuestReviewTransaction {
  context(): Promise<QuestReviewContext>;
  read(): Promise<StoredQuestReview | null>;
  peerGraph(): Promise<Readonly<{ complete: boolean; edges: readonly QuestPeerEdge[] }>>;
  /** Request IDs are globally unique receipt IDs, including across scopes/actors. */
  receipt(requestId: string): Promise<QuestReviewReceipt | null>;
  insertCycle(cycle: QuestReviewCycle, policy: QuestReviewPolicy): Promise<void>;
  insertAssignments(assignments: readonly QuestReviewAssignment[]): Promise<void>;
  insertReceipt(receipt: QuestReviewReceipt): Promise<void>;
}

export interface QuestReviewRepository {
  /** MUST atomically commit/rollback all writes and serialize the complete cohort/quest
   * peer graph (across learners), cycle, subject/request identity and current access/
   * eligibility/policy/evidence facts. Unique initial scope, assignment and receipt
   * constraints are required. A per-cycle lock alone permits reciprocal races.
   * No SQL adapter is implemented or enabled by this interface. */
  transaction<T>(
    key: Readonly<{ scope: QuestReviewScope; subjectId: string; requestId: string | null }>,
    work: (tx: QuestReviewTransaction) => Promise<T>,
  ): Promise<T>;
}

export type QuestReviewRuntime = Readonly<{
  nowMs(): number;
  nextId(): string;
  sampler: Readonly<{
    policyVersion: string;
    select(bank: Bank): Promise<readonly string[]>;
  }> | null;
}>;
export type QuestReviewSummary = Readonly<{
  cycle: QuestReviewCycle;
  eligibility: QuestReviewEligibility;
  assignmentState: 'queued_peers' | 'queued_mentor' | 'assigned' | 'unchanged';
}>;
type Code =
  | 'forbidden'
  | 'configuration_required'
  | 'evidence_conflict'
  | 'policy_conflict'
  | 'idempotency_conflict'
  | 'record_conflict'
  | 'unavailable';
export class QuestReviewStorageError extends Error {
  constructor(readonly code: Code) {
    super('QUEST_REVIEW_' + code.toUpperCase());
  }
}
function fail(code: Code): never {
  throw new QuestReviewStorageError(code);
}
function id(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.trim() === value && !value.includes('\0')
  );
}
function samePolicy(a: QuestReviewPolicy, b: QuestReviewPolicy) {
  return (
    a.version === b.version &&
    a.revision === b.revision &&
    a.peerCount === b.peerCount &&
    a.peerGate === b.peerGate &&
    a.rankingPolicyVersion === b.rankingPolicyVersion
  );
}
type Command = Readonly<{ scope: QuestReviewScope; subjectId: string }>;
type SubmissionCommand = Command &
  Readonly<{
    cycleId: string;
    assignmentId: string;
    requestId: string;
    decision: QuestReviewReceipt['decision'];
  }>;

function ownData(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('forbidden');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('forbidden');
  const result: Record<string, unknown> = {};
  for (const name of names) {
    const field = Object.getOwnPropertyDescriptor(value, name);
    if (!field || !Object.hasOwn(field, 'value')) fail('forbidden');
    result[name] = field.value;
  }
  return result;
}

/** Snapshot caller data before the first repository call/await. Freeze only our
 * copies, so a queued request cannot change the lock scope or receipt identity. */
function captureCommand(value: unknown): Command {
  const fields = ownData(value, ['scope', 'subjectId']);
  const { cohortId, questKey, learnerId } = ownData(fields.scope, [
    'cohortId',
    'questKey',
    'learnerId',
  ]);
  const subjectId = fields.subjectId;
  if (!id(cohortId) || !id(questKey) || !id(learnerId) || !id(subjectId)) fail('forbidden');
  return Object.freeze({ scope: Object.freeze({ cohortId, questKey, learnerId }), subjectId });
}

function captureSubmission(value: unknown): SubmissionCommand {
  const command = captureCommand(value);
  const { cycleId, assignmentId, requestId, decision } = ownData(value, [
    'cycleId',
    'assignmentId',
    'requestId',
    'decision',
  ]);
  if (
    !id(cycleId) ||
    !id(assignmentId) ||
    !id(requestId) ||
    (decision !== 'submitted' && decision !== 'approved' && decision !== 'changes_requested')
  )
    fail('forbidden');
  return Object.freeze({ ...command, cycleId, assignmentId, requestId, decision });
}

async function run<T>(
  repository: QuestReviewRepository,
  input: Command,
  requestId: string | null,
  work: (tx: QuestReviewTransaction, context: QuestReviewContext) => Promise<T>,
): Promise<T> {
  if (
    ![input.subjectId, input.scope.cohortId, input.scope.questKey, input.scope.learnerId].every(
      id,
    ) ||
    (requestId !== null && !id(requestId))
  )
    fail('forbidden');
  try {
    return await repository.transaction(
      Object.freeze({ scope: input.scope, subjectId: input.subjectId, requestId }),
      async (tx) => {
        const context = await tx.context();
        if (
          !id(context.actor.id) ||
          context.actor.active !== true ||
          context.actor.cohortId !== input.scope.cohortId ||
          context.learnerAccess !== true
        )
          fail('forbidden');
        return work(tx, context);
      },
    );
  } catch (error) {
    if (error instanceof QuestReviewStorageError) throw error;
    if (
      error instanceof Error &&
      /^(QUEST_REVIEW_RECORD_CONFLICT|QUEST_MENTOR_BEFORE_PEERS|QUEST_ASSIGNMENT_INPUT_INVALID)$/.test(
        error.message,
      )
    )
      fail('record_conflict');
    fail('unavailable');
  }
}
function configured(context: QuestReviewContext) {
  const policy = context.policy;
  // This service implements completed peer review, then an assigned mentor verdict.
  // No peer-count, pool, ranking, bank, sampler, rubric or trigger default is selected.
  if (
    !policy ||
    policy.version !== 1 ||
    !id(policy.revision) ||
    !id(policy.rankingPolicyVersion) ||
    !Number.isSafeInteger(policy.peerCount) ||
    policy.peerCount < 1 ||
    policy.peerGate !== 'submitted' ||
    !context.bank ||
    !id(context.selectionPolicyVersion) ||
    !id(context.rubricVersion)
  )
    fail('configuration_required');
  return policy;
}
function facts(record: StoredQuestReview): QuestReviewFacts {
  return { ...record, currentAccess: true, evidenceCurrent: true };
}
function checked(record: StoredQuestReview, context: QuestReviewContext, scope: QuestReviewScope) {
  const policy = configured(context),
    cycle = record.cycle;
  if (
    !samePolicy(record.policy, policy) ||
    cycle.questionBankVersion !== context.bank!.version ||
    cycle.questionBankDigest !== context.bank!.digest ||
    cycle.selectionPolicyVersion !== context.selectionPolicyVersion ||
    cycle.rubricVersion !== context.rubricVersion
  )
    fail('policy_conflict');
  if (
    cycle.cohortId !== scope.cohortId ||
    cycle.questKey !== scope.questKey ||
    cycle.learnerId !== scope.learnerId ||
    !sameQuestReviewCycle(cycle, cycle)
  )
    fail('record_conflict');
  if (
    !context.evidence ||
    context.evidence.contentVersion !== cycle.contentVersion ||
    context.evidence.evidenceVersion !== cycle.evidenceVersion ||
    context.evidence.evidenceDigest !== cycle.evidenceDigest
  )
    fail('evidence_conflict');
  questReviewEligibility(facts(record));
  const peers = record.assignments.filter((assignment) => assignment.kind === 'peer');
  if (peers.length !== 0 && peers.length !== policy.peerCount) fail('record_conflict');
  return record;
}
async function advance(
  tx: QuestReviewTransaction,
  runtime: QuestReviewRuntime,
  context: QuestReviewContext,
  initial: StoredQuestReview,
): Promise<QuestReviewSummary> {
  let record = initial;
  let assignmentState: QuestReviewSummary['assignmentState'] = 'unchanged';
  const assign = async (kind: 'peer' | 'mentor', reviewerIds: readonly string[]) => {
    if (context.initialAssignmentAllowed !== true) fail('configuration_required');
    const assignedAtMs = runtime.nowMs();
    const assignments = reviewerIds.map((reviewerId) => ({
      id: runtime.nextId(),
      cycle: record.cycle,
      policyRevision: record.policy.revision,
      kind,
      reviewerId,
      assignedAtMs,
    }));
    const next = { ...record, assignments: [...record.assignments, ...assignments] };
    questReviewEligibility(facts(next));
    await tx.insertAssignments(assignments);
    record = next;
    assignmentState = 'assigned';
  };
  if (record.assignments.length === 0) {
    if (context.initialAssignmentAllowed !== true) fail('configuration_required');
    const graph = await tx.peerGraph();
    const proposal = proposeQuestPeers({
      cycle: record.cycle,
      policy: record.policy,
      currentAccess: true,
      cycleUnassigned: true,
      graphComplete: graph.complete,
      edges: graph.edges,
      orderedCandidates: context.peerCandidates.filter((candidate) => candidate.role === 'learner'),
    });
    if (proposal.state === 'queued') assignmentState = 'queued_peers';
    else if (proposal.state === 'proposed') await assign('peer', proposal.reviewerIds);
    else fail('unavailable');
  }
  if (questReviewEligibility(facts(record)).state === 'mentor_assignment_required') {
    if (context.initialAssignmentAllowed !== true) fail('configuration_required');
    const proposal = proposeQuestMentor({
      facts: facts(record),
      orderedCandidates: context.mentorCandidates.filter(
        (candidate) => candidate.role === 'operator' || candidate.role === 'admin',
      ),
    });
    if (proposal.state === 'queued') assignmentState = 'queued_mentor';
    else if (proposal.state === 'proposed') await assign('mentor', proposal.reviewerIds);
    else fail('unavailable');
  }
  return Object.freeze({
    cycle: record.cycle,
    eligibility: questReviewEligibility(facts(record)),
    assignmentState,
  });
}

/** Initial-cycle only. A reload reads the durable sample; evidence/policy changes
 * fail closed until explicit revision/retry rules and a separate path exist. */
export async function prepareQuestReview(
  repository: QuestReviewRepository,
  runtime: QuestReviewRuntime,
  input: Command,
): Promise<QuestReviewSummary> {
  const command = captureCommand(input);
  return run(repository, command, null, async (tx, context) => {
    if (context.actor.role !== 'learner' || context.actor.id !== command.scope.learnerId)
      fail('forbidden');
    const policy = configured(context);
    let record = await tx.read();
    if (!record) {
      if (!context.evidence) fail('evidence_conflict');
      if (!runtime.sampler || runtime.sampler.policyVersion !== context.selectionPolicyVersion)
        fail('configuration_required');
      const questionIds = await runtime.sampler.select(context.bank!);
      let cycle: QuestReviewCycle;
      try {
        cycle = freezeQuestReviewCycle({
          identity: { ...command.scope, ...context.evidence, cycleId: runtime.nextId() },
          bank: context.bank!,
          selection: {
            policyVersion: context.selectionPolicyVersion!,
            count: 5,
            questionIds,
            rubricVersion: context.rubricVersion!,
          },
        });
      } catch {
        fail('configuration_required');
      }
      record = { cycle, policy: Object.freeze({ ...policy }), assignments: [], receipts: [] };
      checked(record, context, command.scope);
      await tx.insertCycle(cycle, record.policy);
    }
    return advance(tx, runtime, context, checked(record, context, command.scope));
  });
}

/** Immutable intake, then automatic initial mentor allocation after peer completion.
 * Returns eligibility only; never writes mastery, XP, a later-quest gate or an award. */
export async function submitQuestReview(
  repository: QuestReviewRepository,
  runtime: QuestReviewRuntime,
  input: Command &
    Readonly<{
      cycleId: string;
      assignmentId: string;
      requestId: string;
      decision: QuestReviewReceipt['decision'];
    }>,
): Promise<
  Readonly<{ receipt: QuestReviewReceipt; replayed: boolean; eligibility: QuestReviewEligibility }>
> {
  const command = captureSubmission(input);
  return run(repository, command, command.requestId, async (tx, context) => {
    const stored = await tx.read();
    if (!stored) fail('forbidden');
    const record = checked(stored, context, command.scope);
    const assignment = record.assignments.find(
      (candidate) => candidate.id === command.assignmentId,
    );
    if (
      !assignment ||
      record.cycle.cycleId !== command.cycleId ||
      assignment.reviewerId !== context.actor.id ||
      context.actor.eligible !== true ||
      context.actor.id === command.scope.learnerId ||
      (assignment.kind === 'peer'
        ? context.actor.role !== 'learner' || command.decision !== 'submitted'
        : !['operator', 'admin'].includes(context.actor.role) ||
          !['approved', 'changes_requested'].includes(command.decision))
    )
      fail('forbidden');
    const previous = await tx.receipt(command.requestId);
    if (previous) {
      if (
        previous.id !== command.requestId ||
        previous.assignmentId !== assignment.id ||
        previous.reviewerId !== context.actor.id ||
        previous.decision !== command.decision ||
        !sameQuestReviewCycle(previous.cycle, record.cycle) ||
        !record.receipts.some(
          (receipt) =>
            receipt.id === previous.id &&
            receipt.assignmentId === previous.assignmentId &&
            receipt.reviewerId === previous.reviewerId &&
            receipt.decision === previous.decision &&
            receipt.submittedAtMs === previous.submittedAtMs &&
            sameQuestReviewCycle(receipt.cycle, previous.cycle),
        )
      )
        fail('idempotency_conflict');
      return Object.freeze({
        receipt: previous,
        replayed: true,
        eligibility: questReviewEligibility(facts(record)),
      });
    }
    if (record.receipts.some((receipt) => receipt.assignmentId === assignment.id))
      fail('idempotency_conflict');
    const receipt: QuestReviewReceipt = Object.freeze({
      id: command.requestId,
      assignmentId: assignment.id,
      cycle: record.cycle,
      reviewerId: context.actor.id,
      decision: command.decision,
      submittedAtMs: runtime.nowMs(),
    });
    assertQuestReviewReceipt({
      facts: facts(record),
      receipt,
      actorId: context.actor.id,
      actorActive: context.actor.active,
      actorEligible: context.actor.eligible,
    });
    await tx.insertReceipt(receipt);
    const summary = await advance(tx, runtime, context, {
      ...record,
      receipts: [...record.receipts, receipt],
    });
    return Object.freeze({ receipt, replayed: false, eligibility: summary.eligibility });
  });
}
