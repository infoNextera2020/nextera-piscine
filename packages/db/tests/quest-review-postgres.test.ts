import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createQuestReviewPostgresRepository,
  nativeQuestReviewAuthority,
  nativeQuestReviewSelection,
  QUEST_REVIEW_BOUNDS_SQL,
  QUEST_REVIEW_LOCK_SQL,
  QUEST_REVIEW_CONTEXT_SQL,
  QUEST_REVIEW_AUTHORITY_LOCK_SQL,
  QUEST_REVIEW_DISPATCH_SQL,
  type QuestReviewPostgresClient,
  type QuestReviewPostgresConfiguration,
} from '../queries/quest-review-postgres';
import {
  prepareQuestReview,
  submitQuestReview,
  type QuestReviewContext,
  type QuestReviewRuntime,
  type QuestReviewTransaction,
  type StoredQuestReview,
} from '../operations/quest-reviews';

// Only in-memory state and promise/cancellation handles. No postgres(), sockets,
// environment credentials, SQL execution or publication occurs in these fixtures.
const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
const scope = { cohortId: id(1), questKey: 'quest-2', learnerId: id(2) };
const auth = { learner: id(12), peer: id(13), mentor: id(14) };
const limits = {
  transactionMs: 5000,
  statementMs: 1000,
  lockMs: 100,
  maxGraphEdges: 100,
  maxMetadataBytes: 65536,
};
const key = (subjectId = auth.learner, requestId: string | null = null) => ({
  scope: { ...scope },
  subjectId,
  requestId,
});
const recordKey = (s: typeof scope) => JSON.stringify([s.cohortId, s.questKey, s.learnerId]);
const policy = {
  version: 1 as const,
  revision: 'policy-1',
  peerCount: 1,
  peerGate: 'submitted' as const,
  rankingPolicyVersion: 'rank-1',
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
type FakeTx = { unsafe(sql: string, parameters?: readonly unknown[]): unknown };
class Fixture {
  records = new Map<string, StoredQuestReview>();
  events: string[] = [];
  calls: { sql: string; parameters: readonly unknown[] }[] = [];
  cancels = 0;
  callbacks = 0;
  nativeAuthorityAvailable = true; // Synthetic provider choice, not a runtime default.
  nativeSelectionAvailable = true;
  failOperation: string | null = null;
  failAfterInsert = false;
  loseCommitAck = false;
  hangSql: string | null = null;
  cancellationThrows = false;
  nextContext: (() => void) | null = null;
  rawRow: unknown | undefined;
  overrideContext: Partial<QuestReviewContext> = {};
  authorityRevision = 'd'.repeat(64);
  incompleteGraph = false;
  commitGate: ReturnType<typeof deferred> | null = null;
  commitEntered = deferred();
  private tail = Promise.resolve();
  private sequence = 100;
  private time = 100;
  sample = vi.fn(async () => ['q1', 'q2', 'q3', 'q4', 'q5']);
  runtime: QuestReviewRuntime = {
    nowMs: () => ++this.time,
    nextId: () => id(++this.sequence),
    sampler: { policyVersion: 'selection-1', select: this.sample },
  };
  client = {
    begin: (work: (transaction: FakeTx) => Promise<unknown>) => this.begin(work),
  } as unknown as QuestReviewPostgresClient;
  config: QuestReviewPostgresConfiguration = {
    client: this.client,
    authority: nativeQuestReviewAuthority,
    selection: nativeQuestReviewSelection,
    limits,
  };
  repository() {
    return createQuestReviewPostgresRepository(this.config);
  }
  candidate(user: string, role: 'learner' | 'operator' | 'admin' = 'learner') {
    return { id: user, role, cohortId: scope.cohortId, active: true, eligible: true };
  }
  envelope(subject: string, s = scope) {
    const actor =
      subject === auth.learner
        ? this.candidate(s.learnerId)
        : subject === auth.peer
          ? this.candidate(id(3))
          : this.candidate(id(4), 'operator');
    return {
      version: 1,
      authUserId: subject,
      scope: { ...s },
      curriculumVersionId: id(9),
      authorityRevision: this.authorityRevision,
      context: {
        actor,
        learnerAccess: true,
        evidence: {
          contentVersion: 'content-1',
          evidenceVersion: 'evidence-1',
          evidenceDigest: 'a'.repeat(64),
        },
        policy,
        bank: {
          version: 'bank-1',
          digest: 'b'.repeat(64),
          questionIds: Array.from({ length: 20 }, (_, i) => 'q' + (i + 1)),
        },
        selectionPolicyVersion: 'selection-1',
        rubricVersion: 'rubric-1',
        initialAssignmentAllowed: true,
        peerCandidates: [this.candidate(id(3))],
        mentorCandidates: [this.candidate(id(4), 'operator')],
        ...this.overrideContext,
      },
    };
  }
  private async begin(work: (transaction: FakeTx) => Promise<unknown>) {
    // Fake serialization of all transactions is broader than SQL's graph lock.
    // Command assertions check issued lock keys; these tests prove no native locks.
    let release!: () => void;
    const prior = this.tail;
    this.tail = new Promise<void>((r) => {
      release = r;
    });
    await prior;
    this.events.push('begin');
    this.callbacks++;
    const local = structuredClone(this.records);
    let ended = false,
      committed = false;
    const connection: FakeTx = {
      unsafe: (sql, parameters = []) => {
        if (ended) throw new Error('Late fake query');
        this.calls.push({ sql, parameters: structuredClone(parameters) });
        let reject!: (e: Error) => void;
        const pending = new Promise<unknown[]>((resolve, fail) => {
          reject = fail;
          if (this.hangSql === sql) return;
          try {
            resolve(this.handle(sql, parameters, local));
          } catch (e) {
            fail(e as Error);
          }
        });
        return Object.assign(pending, {
          cancel: () => {
            this.cancels++;
            if (this.cancellationThrows) throw new Error('Synthetic cancel uncertainty');
            reject(new Error('Synthetic pending query cancelled'));
          },
        });
      },
    };
    try {
      const value = await work(connection);
      this.commitEntered.resolve();
      if (this.commitGate) await this.commitGate.promise;
      this.records = local;
      committed = true;
      this.events.push('commit');
      if (this.loseCommitAck) throw new Error('Synthetic lost COMMIT acknowledgement');
      return value;
    } catch (error) {
      if (!committed) this.events.push('rollback');
      throw error;
    } finally {
      ended = true;
      release();
    }
  }
  private handle(
    sql: string,
    p: readonly unknown[],
    records: Map<string, StoredQuestReview>,
  ): unknown[] {
    if (sql === QUEST_REVIEW_BOUNDS_SQL)
      return [{ statement_timeout: p[0], lock_timeout: p[1], idle_timeout: p[2] }];
    if (sql === QUEST_REVIEW_LOCK_SQL) {
      this.events.push(p[2] === null ? 'graph-lock' : 'request-then-graph-lock');
      return [{ locked: true }];
    }
    const s = { cohortId: p[1] as string, questKey: p[2] as string, learnerId: p[3] as string };
    if (sql === QUEST_REVIEW_CONTEXT_SQL || sql === QUEST_REVIEW_AUTHORITY_LOCK_SQL) {
      if (!this.nativeAuthorityAvailable) throw new Error('QUEST_REVIEW_CONFIGURATION_REQUIRED');
      if (sql === QUEST_REVIEW_CONTEXT_SQL) {
        this.events.push('authority-read');
        this.nextContext?.();
      } else {
        this.events.push('authority-row-locks');
        expect(p[4]).toEqual([...new Set([id(2), id(3), id(4)])].sort());
      }
      return this.rawRow === undefined
        ? [{ data: this.envelope(p[0] as string, s) }]
        : [this.rawRow];
    }
    if (sql !== QUEST_REVIEW_DISPATCH_SQL) throw new Error('Unexpected SQL in fake');
    const op = p[5] as string,
      payload = JSON.parse(p[6] as string);
    this.events.push(op);
    if (this.failOperation === op && !this.failAfterInsert)
      throw new Error('Synthetic DB password must not escape');
    const stored = records.get(recordKey(s));
    let value: unknown = true;
    if (op === 'validate_selection') value = this.nativeSelectionAvailable;
    else if (op === 'read') value = stored ?? null;
    else if (op === 'peer_graph') {
      const edges = [...records.values()]
        .filter((r) => r.cycle.cohortId === s.cohortId && r.cycle.questKey === s.questKey)
        .flatMap((r) =>
          r.assignments
            .filter((a) => a.kind === 'peer')
            .map((a) => ({
              cohortId: s.cohortId,
              questKey: s.questKey,
              reviewerId: a.reviewerId,
              learnerId: r.cycle.learnerId,
            })),
        );
      value =
        this.incompleteGraph || edges.length > payload.maxEdges
          ? { complete: false, edges: [] }
          : { complete: true, edges };
    } else if (op === 'receipt') {
      const found = [...records.values()]
        .flatMap((r) => r.receipts)
        .find((r) => r.id === payload.requestId);
      if (
        found &&
        (!stored ||
          found.cycle.cycleId !== stored.cycle.cycleId ||
          found.reviewerId !== this.envelope(p[0] as string, s).context.actor.id)
      )
        throw new Error('QUEST_REVIEW_IDEMPOTENCY_CONFLICT');
      value = found ?? null;
    } else if (op === 'insert_cycle') {
      if (!this.nativeSelectionAvailable) throw new Error('QUEST_REVIEW_CONFIGURATION_REQUIRED');
      if (stored) throw new Error('QUEST_REVIEW_RECORD_CONFLICT');
      records.set(recordKey(s), {
        cycle: payload.cycle,
        policy: payload.policy,
        assignments: [],
        receipts: [],
      });
    } else if (op === 'insert_assignments') {
      if (!stored) throw new Error('QUEST_REVIEW_RECORD_CONFLICT');
      records.set(recordKey(s), {
        ...stored,
        assignments: [...stored.assignments, ...payload.assignments],
      });
    } else if (op === 'insert_receipt') {
      if (!stored) throw new Error('QUEST_REVIEW_RECORD_CONFLICT');
      if (
        [...records.values()].some((r) => r.receipts.some((x) => x.id === payload.receipt.id)) ||
        stored.receipts.some((x) => x.assignmentId === payload.receipt.assignmentId)
      )
        throw new Error('QUEST_REVIEW_IDEMPOTENCY_CONFLICT');
      records.set(recordKey(s), { ...stored, receipts: [...stored.receipts, payload.receipt] });
    } else throw new Error('Unexpected dispatch in fake');
    if (this.failOperation === op && this.failAfterInsert)
      throw new Error('Synthetic failure after write');
    return [{ data: structuredClone(value) }];
  }
  prepare() {
    return prepareQuestReview(this.repository(), this.runtime, {
      scope: { ...scope },
      subjectId: auth.learner,
    });
  }
  submit(
    subject = auth.peer,
    decision: 'submitted' | 'approved' | 'changes_requested' = 'submitted',
    requestId = id(200),
  ) {
    const record = this.records.get(recordKey(scope))!;
    const reviewer = this.envelope(subject).context.actor.id;
    const a = record.assignments.find((x) => x.reviewerId === reviewer)!;
    return submitQuestReview(this.repository(), this.runtime, {
      scope: { ...scope },
      subjectId: subject,
      cycleId: record.cycle.cycleId,
      assignmentId: a.id,
      requestId,
      decision,
    });
  }
}
afterEach(() => vi.useRealTimers());

describe('Explicitly configured quest-review PostgreSQL source adapter', () => {
  it('is unavailable by default and missing ports do not inspect a client', async () => {
    const lookup = vi.fn(() => {
      throw new Error('Client must not be touched');
    });
    const client = new Proxy({}, { get: lookup }) as QuestReviewPostgresClient;
    for (const configuration of [
      null,
      { client, authority: null, selection: nativeQuestReviewSelection, limits },
      { client, authority: nativeQuestReviewAuthority, selection: null, limits },
    ]) {
      await expect(
        createQuestReviewPostgresRepository(configuration).transaction(key(), async () => true),
      ).rejects.toMatchObject({ code: 'configuration_required' });
    }
    expect(lookup).not.toHaveBeenCalled();
  });
  it('keeps default-denying native authority unavailable even when ports are supplied', async () => {
    const f = new Fixture();
    f.nativeAuthorityAvailable = false;
    await expect(f.prepare()).rejects.toMatchObject({ code: 'configuration_required' });
    expect(f.records.size).toBe(0);
    expect(f.events).toContain('rollback');
  });
  it('executes existing prepare/peer/mentor semantics on one fake transaction per operation', async () => {
    const f = new Fixture();
    const result = await f.prepare();
    expect(result.cycle.questionIds).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
    expect(f.events.indexOf('graph-lock')).toBeLessThan(f.events.indexOf('authority-read'));
    expect(f.events.indexOf('authority-read')).toBeLessThan(
      f.events.indexOf('authority-row-locks'),
    );
    expect(f.events.indexOf('authority-row-locks')).toBeLessThan(f.events.indexOf('insert_cycle'));
    await expect(f.submit()).resolves.toMatchObject({
      replayed: false,
      eligibility: { state: 'awaiting_mentor', masteryEligible: false },
    });
    await expect(f.submit(auth.mentor, 'approved', id(201))).resolves.toMatchObject({
      eligibility: { state: 'completion_eligible' },
    });
    expect(f.callbacks).toBe(3);
    expect(f.events.filter((x) => x === 'commit')).toHaveLength(3);
    expect(f.calls.filter((x) => x.sql === QUEST_REVIEW_LOCK_SQL).map((x) => x.parameters)).toEqual(
      [
        [scope.cohortId, scope.questKey, null],
        [scope.cohortId, scope.questKey, id(200)],
        [scope.cohortId, scope.questKey, id(201)],
      ],
    );
  });
  it('serializes same-scope prepare without reroll and exact receipt replay without new rows', async () => {
    const f = new Fixture();
    const results = await Promise.all([f.prepare(), f.prepare()]);
    expect(results[0]!.cycle).toEqual(results[1]!.cycle);
    expect(f.sample).toHaveBeenCalledOnce();
    const first = await f.submit(),
      replay = await f.submit();
    expect(replay.receipt).toEqual(first.receipt);
    expect(replay.replayed).toBe(true);
    expect(f.records.get(recordKey(scope))!.receipts).toHaveLength(1);
  });
  it('uses the same global request lock and rejects cross-actor reuse', async () => {
    const f = new Fixture();
    await f.prepare();
    await f.submit();
    await expect(f.submit(auth.mentor, 'approved', id(200))).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(f.events.filter((x) => x === 'request-then-graph-lock')).toHaveLength(2);
    expect(f.records.get(recordKey(scope))!.receipts).toHaveLength(1);
  });
  it.each(['insert_cycle', 'insert_assignments', 'insert_receipt'])(
    'rolls back even a failure after %s and never leaks raw errors',
    async (operation) => {
      const f = new Fixture();
      if (operation === 'insert_receipt') await f.prepare();
      const before = structuredClone(f.records);
      f.failOperation = operation;
      f.failAfterInsert = true;
      await expect(operation === 'insert_receipt' ? f.submit() : f.prepare()).rejects.toThrow(
        'QUEST_REVIEW_UNAVAILABLE',
      );
      expect(f.records).toEqual(before);
      expect(f.events.at(-1)).toBe('rollback');
    },
  );
  it('lost commit acknowledgement is uncertain and explicit same-ID retry reads stored evidence', async () => {
    const f = new Fixture();
    await f.prepare();
    f.loseCommitAck = true;
    await expect(f.submit()).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
    expect(f.records.get(recordKey(scope))!.receipts).toHaveLength(1);
    const calls = f.callbacks;
    f.loseCommitAck = false;
    await expect(f.submit()).resolves.toMatchObject({ replayed: true });
    expect(f.callbacks).toBe(calls + 1);
    expect(f.records.get(recordKey(scope))!.receipts).toHaveLength(1);
  });
  it('rechecks revocation even before an exact receipt replay', async () => {
    const f = new Fixture();
    await f.prepare();
    await f.submit();
    f.overrideContext = { learnerAccess: false };
    await expect(f.submit()).rejects.toMatchObject({ code: 'forbidden' });
    expect(f.records.get(recordKey(scope))!.receipts).toHaveLength(1);
  });
  it('rejects context drift after discovery without writing or claiming fresh locks', async () => {
    const f = new Fixture();
    let reads = 0;
    f.nextContext = () => {
      if (++reads === 2) f.authorityRevision = 'e'.repeat(64);
    };
    await expect(f.prepare()).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
    expect(f.records.size).toBe(0);
  });
  it('rejects incomplete graph instead of assigning from a truncated graph', async () => {
    const f = new Fixture();
    f.incompleteGraph = true;
    await expect(f.prepare()).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
    expect(f.records.size).toBe(0);
  });
  it('forged JS coverage cannot bypass the independently denying native writer', async () => {
    const f = new Fixture();
    f.nativeSelectionAvailable = false;
    f.config = { ...f.config, selection: { verify: async () => true } };
    await expect(f.prepare()).rejects.toMatchObject({ code: 'configuration_required' });
    expect(f.records.size).toBe(0);
  });
  it('rejects UUID aliases and malformed scalar text before beginning', async () => {
    const f = new Fixture();
    const repository = f.repository();
    for (const invalid of [
      { ...key(), subjectId: auth.learner.toUpperCase().replace('c', 'C') },
      { ...key(), subjectId: auth.learner.replaceAll('-', '') },
      { ...key(), scope: { ...scope, questKey: 'q\ud800' } },
    ]) {
      await expect(repository.transaction(invalid, async () => true)).rejects.toBeInstanceOf(Error);
    }
    expect(f.callbacks).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
  it('rejects accessor response metadata without invoking its getter', async () => {
    const f = new Fixture(),
      getter = vi.fn(() => {
        throw new Error('Private response getter');
      });
    f.rawRow = Object.defineProperty({}, 'data', { get: getter });
    await expect(f.prepare()).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
    expect(getter).not.toHaveBeenCalled();
    expect(f.records.size).toBe(0);
  });
  it('rejects global request reuse across two different quest scopes', async () => {
    const f = new Fixture();
    await f.prepare();
    await f.submit();
    const other = { ...scope, questKey: 'quest-3' };
    await prepareQuestReview(f.repository(), f.runtime, { scope: other, subjectId: auth.learner });
    const r = f.records.get(recordKey(other))!,
      a = r.assignments[0]!;
    await expect(
      submitQuestReview(f.repository(), f.runtime, {
        scope: other,
        subjectId: auth.peer,
        cycleId: r.cycle.cycleId,
        assignmentId: a.id,
        requestId: id(200),
        decision: 'submitted',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const locks = f.calls.filter(
      (c) => c.sql === QUEST_REVIEW_LOCK_SQL && c.parameters[2] === id(200),
    );
    expect(locks.map((c) => c.parameters)).toEqual([
      [scope.cohortId, scope.questKey, id(200)],
      [scope.cohortId, other.questKey, id(200)],
    ]);
    expect(f.records.get(recordKey(other))!.receipts).toHaveLength(0);
  });
  it.each(['evidence', 'policy', 'bank'] as const)(
    'rejects a changed %s binding without replacing stored history',
    async (kind) => {
      const f = new Fixture();
      await f.prepare();
      const old = structuredClone(f.records);
      if (kind === 'evidence')
        f.overrideContext = {
          evidence: {
            contentVersion: 'content-1',
            evidenceVersion: 'changed',
            evidenceDigest: 'a'.repeat(64),
          },
        };
      if (kind === 'policy') f.overrideContext = { policy: { ...policy, revision: 'changed' } };
      if (kind === 'bank')
        f.overrideContext = {
          bank: {
            version: 'changed',
            digest: 'b'.repeat(64),
            questionIds: Array.from({ length: 20 }, (_, i) => 'q' + (i + 1)),
          },
        };
      await expect(f.prepare()).rejects.toMatchObject({
        code: kind === 'evidence' ? 'evidence_conflict' : 'policy_conflict',
      });
      expect(f.records).toEqual(old);
      expect(f.sample).toHaveBeenCalledOnce();
    },
  );
  it('validates explicit native protocol bounds without looking up a client', () => {
    const f = new Fixture();
    expect(() =>
      createQuestReviewPostgresRepository({
        ...f.config,
        limits: { ...limits, maxMetadataBytes: 1048577 },
      }),
    ).toThrow();
    expect(() =>
      createQuestReviewPostgresRepository({
        ...f.config,
        limits: { ...limits, lockMs: limits.statementMs + 1 },
      }),
    ).toThrow();
    expect(f.callbacks).toBe(0);
  });
  it.each(['initial', 'final', 'selection'] as const)(
    'hung %s authority port exits the callback through the original deadline',
    async (phase) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const f = new Fixture(),
        entered = deferred();
      let count = 0;
      if (phase === 'selection')
        f.config = {
          ...f.config,
          selection: {
            verify: () => {
              entered.resolve();
              return new Promise<boolean>(() => {});
            },
          },
        };
      else
        f.config = {
          ...f.config,
          authority: {
            read: (access) => {
              if (++count === (phase === 'initial' ? 1 : 2)) {
                entered.resolve();
                return new Promise<unknown>(() => {});
              }
              return access.readNative();
            },
          },
        };
      const pending =
        phase === 'final' ? f.repository().transaction(key(), async () => true) : f.prepare();
      const assertion = expect(pending).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
      await entered.promise;
      await vi.advanceTimersByTimeAsync(limits.transactionMs + 1);
      await assertion;
      expect(f.events).toContain('rollback');
      expect(f.events).not.toContain('commit');
      expect(f.records.size).toBe(0);
    },
  );
  it('expiry while waiting for a connection prevents all SQL if the callback arrives late', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const gate = deferred(),
      unsafe = vi.fn();
    const f = new Fixture();
    f.config = {
      ...f.config,
      client: {
        begin: async (work: (tx: unknown) => Promise<unknown>) => {
          await gate.promise;
          return work({ unsafe });
        },
      } as unknown as QuestReviewPostgresClient,
    };
    const pending = f.repository().transaction(key(), async () => true);
    const assertion = expect(pending).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
    await vi.advanceTimersByTimeAsync(limits.transactionMs + 1);
    await assertion;
    gate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(unsafe).not.toHaveBeenCalled();
  });
  it('does not accept a client success without callback execution or retry work twice', async () => {
    const f = new Fixture(),
      work = vi.fn(async () => true);
    const idle = {
      ...f.config,
      client: { begin: async () => undefined } as unknown as QuestReviewPostgresClient,
    };
    await expect(
      createQuestReviewPostgresRepository(idle).transaction(key(), work),
    ).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
    expect(work).not.toHaveBeenCalled();
    const repeat = {
      ...f.config,
      client: {
        begin: async (callback: (tx: unknown) => Promise<unknown>) => {
          await f.client.begin(callback as never);
          return f.client.begin(callback as never);
        },
      } as unknown as QuestReviewPostgresClient,
    };
    await expect(
      createQuestReviewPostgresRepository(repeat).transaction(key(), work),
    ).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
    expect(work).toHaveBeenCalledOnce();
  });
  it('closes retained methods before returning and prevents post-commit SQL', async () => {
    const f = new Fixture();
    let retained!: QuestReviewTransaction;
    await f.repository().transaction(key(), async (tx) => {
      retained = tx;
      return tx.context();
    });
    const count = f.calls.length;
    await expect(retained.read()).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
    expect(f.calls).toHaveLength(count);
  });
  it.each([false, true])(
    'deadline cancels only owned pending query once; cancellationThrows=%s',
    async (throws) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const f = new Fixture();
      f.hangSql = QUEST_REVIEW_CONTEXT_SQL;
      f.cancellationThrows = throws;
      const pending = f.prepare();
      const assertion = expect(pending).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
      await vi.advanceTimersByTimeAsync(limits.transactionMs + 1);
      await assertion;
      expect(f.cancels).toBe(1);
      expect(f.records.size).toBe(0);
      expect(f.events).not.toContain('commit');
    },
  );
  it('timeout during COMMIT does not return success or automatically reenter the callback', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = new Fixture();
    f.commitGate = deferred();
    const pending = f.prepare();
    const assertion = expect(pending).rejects.toThrow('QUEST_REVIEW_UNAVAILABLE');
    await f.commitEntered.promise;
    await vi.advanceTimersByTimeAsync(limits.transactionMs + 1);
    await assertion;
    expect(f.callbacks).toBe(1);
    f.commitGate.resolve();
    await Promise.resolve();
    expect(f.callbacks).toBe(1);
  });
});
