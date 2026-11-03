import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import type { Sql } from 'postgres';
import {
  sameQuestReviewCycle,
  questReviewEligibility,
  type QuestReviewCycle,
  type QuestReviewAssignment,
  type QuestReviewReceipt,
  type QuestReviewPolicy,
  type QuestPeerEdge,
} from '@nextera/domain';
import {
  QuestReviewStorageError,
  type QuestReviewContext,
  type QuestReviewRepository,
  type QuestReviewTransaction,
  type StoredQuestReview,
} from '../operations/quest-reviews';

export type QuestReviewPostgresClient = Pick<Sql, 'begin'>;
type Key = Parameters<QuestReviewRepository['transaction']>[0];
type QueryClient = Pick<Sql, 'unsafe'>;
type NativeAuthority = Readonly<{
  version: 1;
  authUserId: string;
  scope: Key['scope'];
  curriculumVersionId: string;
  authorityRevision: string;
  context: QuestReviewContext;
}>;
export type QuestReviewPostgresLimits = Readonly<{
  transactionMs: number;
  statementMs: number;
  lockMs: number;
  maxGraphEdges: number;
  maxMetadataBytes: number;
}>;
export type QuestReviewAuthorityAccess = Readonly<{
  command: Key;
  readNative(): Promise<unknown>;
}>;
export type QuestReviewSelectionAccess = Readonly<{
  command: Key;
  cycle: QuestReviewCycle;
  verifyNative(): Promise<boolean>;
}>;
export type QuestReviewAuthorityPort = Readonly<{
  read(access: QuestReviewAuthorityAccess): Promise<unknown>;
}>;
export type QuestReviewSelectionPort = Readonly<{
  verify(access: QuestReviewSelectionAccess): Promise<boolean>;
}>;
export type QuestReviewPostgresConfiguration = Readonly<{
  client: QuestReviewPostgresClient | null;
  authority: QuestReviewAuthorityPort | null;
  selection: QuestReviewSelectionPort | null;
  limits: QuestReviewPostgresLimits | null;
}>;

// Explicit ports call fixed native entry points. Supplying these is not authority:
// DRAFT0037's private authority/coverage hooks still deny until separately reviewed.
export const nativeQuestReviewAuthority: QuestReviewAuthorityPort = Object.freeze({
  read: (access) => access.readNative(),
});
export const nativeQuestReviewSelection: QuestReviewSelectionPort = Object.freeze({
  verify: (access) => access.verifyNative(),
});
export const QUEST_REVIEW_BOUNDS_SQL =
  "SELECT set_config('statement_timeout',$1,true) AS statement_timeout,set_config('lock_timeout',$2,true) AS lock_timeout,set_config('idle_in_transaction_session_timeout',$3,true) AS idle_timeout";
export const QUEST_REVIEW_LOCK_SQL =
  'SELECT app.quest_review_lock($1::uuid,$2::text,$3::uuid) AS locked';
export const QUEST_REVIEW_CONTEXT_SQL =
  'SELECT app.quest_review_context($1::uuid,$2::uuid,$3::text,$4::uuid) AS data';
export const QUEST_REVIEW_AUTHORITY_LOCK_SQL =
  'SELECT app.quest_review_lock_authority($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid[]) AS data';
export const QUEST_REVIEW_DISPATCH_SQL =
  'SELECT app.quest_review_dispatch($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::text,($7::text)::jsonb) AS data';

export const QUEST_REVIEW_NATIVE_METADATA_CEILING = 1048576;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;
type Code = QuestReviewStorageError['code'];
const fail = (code: Code = 'unavailable'): never => {
  throw new QuestReviewStorageError(code);
};
function data(v: unknown, names: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return fail();
  const fields = Object.getOwnPropertyDescriptors(v);
  if (
    Reflect.ownKeys(fields).length !== names.length ||
    !names.every((name) => Object.hasOwn(fields, name) && Object.hasOwn(fields[name]!, 'value'))
  )
    return fail();
  return Object.fromEntries(names.map((name) => [name, fields[name]!.value]));
}
function scalar(v: unknown): string {
  if (
    typeof v !== 'string' ||
    !v.length ||
    v.trim() !== v ||
    v.includes('\0') ||
    Buffer.from(v, 'utf8').toString('utf8') !== v
  )
    return fail();
  return v;
}
const uuid = (v: unknown) => {
  if (typeof v !== 'string' || v.length !== 36) return fail('forbidden');
  const s = scalar(v);
  if (!uuidPattern.test(s)) return fail('forbidden');
  return s;
};
const hash = (v: unknown) => {
  if (typeof v !== 'string' || v.length !== 64) return fail();
  const s = scalar(v);
  if (!hashPattern.test(s)) return fail();
  return s;
};
function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') return fail();
  return v;
}
function positive(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) return fail();
  return v;
}
function timestamp(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || Math.abs(v) > 8640000000000000)
    return fail();
  return v;
}
function parseTimeoutMs(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const match = /^(\d+)(ms|s|min|h|d)?$/.exec(v.trim());
  if (!match) return null;
  const val = Number(match[1]);
  const unit = match[2] ?? 'ms';
  switch (unit) {
    case 'ms':
      return val;
    case 's':
      return val * 1000;
    case 'min':
      return val * 60000;
    case 'h':
      return val * 3600000;
    case 'd':
      return val * 86400000;
    default:
      return null;
  }
}
function array(v: unknown): unknown[] {
  if (!Array.isArray(v) || Reflect.ownKeys(v).length !== v.length + 1) return fail();
  return Array.from({ length: v.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (!d || !Object.hasOwn(d, 'value')) return fail();
    return d.value;
  });
}
function list(v: unknown, parse = scalar): readonly string[] {
  const values = array(v).map(parse);
  if (new Set(values).size !== values.length) return fail();
  return Object.freeze(values);
}
function scope(v: unknown): Key['scope'] {
  const r = data(v, ['cohortId', 'questKey', 'learnerId']);
  return Object.freeze({
    cohortId: uuid(r.cohortId),
    questKey: scalar(r.questKey),
    learnerId: uuid(r.learnerId),
  });
}
function key(v: unknown): Key {
  const r = data(v, ['scope', 'subjectId', 'requestId']);
  return Object.freeze({
    scope: scope(r.scope),
    subjectId: uuid(r.subjectId),
    requestId: r.requestId === null ? null : uuid(r.requestId),
  });
}
function sameScope(a: Key['scope'], b: Key['scope']) {
  return a.cohortId === b.cohortId && a.questKey === b.questKey && a.learnerId === b.learnerId;
}
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.entries(v)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
      .join(',') +
    '}'
  );
}
function policy(v: unknown): QuestReviewPolicy {
  const r = data(v, ['version', 'revision', 'peerCount', 'peerGate', 'rankingPolicyVersion']);
  if (r.version !== 1 || r.peerGate !== 'submitted') return fail('configuration_required');
  return Object.freeze({
    version: 1,
    revision: scalar(r.revision),
    peerCount: positive(r.peerCount),
    peerGate: 'submitted',
    rankingPolicyVersion: scalar(r.rankingPolicyVersion),
  });
}
function cycle(v: unknown): QuestReviewCycle {
  const r = data(v, [
    'version',
    'cycleId',
    'cohortId',
    'questKey',
    'learnerId',
    'contentVersion',
    'evidenceVersion',
    'evidenceDigest',
    'questionBankVersion',
    'questionBankDigest',
    'questionIds',
    'selectionPolicyVersion',
    'rubricVersion',
  ]);
  if (r.version !== 1) return fail();
  const c = Object.freeze({
    version: 1 as const,
    cycleId: uuid(r.cycleId),
    ...scope({ cohortId: r.cohortId, questKey: r.questKey, learnerId: r.learnerId }),
    contentVersion: scalar(r.contentVersion),
    evidenceVersion: scalar(r.evidenceVersion),
    evidenceDigest: hash(r.evidenceDigest),
    questionBankVersion: scalar(r.questionBankVersion),
    questionBankDigest: hash(r.questionBankDigest),
    questionIds: list(r.questionIds),
    selectionPolicyVersion: scalar(r.selectionPolicyVersion),
    rubricVersion: scalar(r.rubricVersion),
  });
  if (!sameQuestReviewCycle(c, c)) return fail();
  return c;
}
function assignment(v: unknown): QuestReviewAssignment {
  const r = data(v, ['id', 'cycle', 'policyRevision', 'kind', 'reviewerId', 'assignedAtMs']);
  if (r.kind !== 'peer' && r.kind !== 'mentor') return fail();
  return Object.freeze({
    id: uuid(r.id),
    cycle: cycle(r.cycle),
    policyRevision: scalar(r.policyRevision),
    kind: r.kind,
    reviewerId: uuid(r.reviewerId),
    assignedAtMs: timestamp(r.assignedAtMs),
  });
}
function receipt(v: unknown): QuestReviewReceipt {
  const r = data(v, ['id', 'assignmentId', 'cycle', 'reviewerId', 'decision', 'submittedAtMs']);
  if (r.decision !== 'submitted' && r.decision !== 'approved' && r.decision !== 'changes_requested')
    return fail();
  return Object.freeze({
    id: uuid(r.id),
    assignmentId: uuid(r.assignmentId),
    cycle: cycle(r.cycle),
    reviewerId: uuid(r.reviewerId),
    decision: r.decision,
    submittedAtMs: timestamp(r.submittedAtMs),
  });
}
function stored(v: unknown, command: Key): StoredQuestReview | null {
  if (v === null) return null;
  const r = data(v, ['cycle', 'policy', 'assignments', 'receipts']);
  const record = Object.freeze({
    cycle: cycle(r.cycle),
    policy: policy(r.policy),
    assignments: Object.freeze(array(r.assignments).map(assignment)),
    receipts: Object.freeze(array(r.receipts).map(receipt)),
  });
  if (!sameScope(record.cycle, command.scope)) return fail('record_conflict');
  const peers = record.assignments.filter((a) => a.kind === 'peer').length;
  if (peers !== 0 && peers !== record.policy.peerCount) return fail('record_conflict');
  questReviewEligibility({ ...record, currentAccess: true, evidenceCurrent: true });
  return record;
}
function actor(v: unknown) {
  const r = data(v, ['id', 'role', 'cohortId', 'active', 'eligible']);
  if (r.role !== 'learner' && r.role !== 'operator' && r.role !== 'admin') return fail();
  return Object.freeze({
    id: uuid(r.id),
    role: r.role,
    cohortId: uuid(r.cohortId),
    active: bool(r.active),
    eligible: bool(r.eligible),
  });
}
function context(v: unknown): QuestReviewContext {
  const r = data(v, [
    'actor',
    'learnerAccess',
    'evidence',
    'policy',
    'bank',
    'selectionPolicyVersion',
    'rubricVersion',
    'initialAssignmentAllowed',
    'peerCandidates',
    'mentorCandidates',
  ]);
  const evidence =
    r.evidence === null
      ? null
      : (() => {
          const e = data(r.evidence, ['contentVersion', 'evidenceVersion', 'evidenceDigest']);
          return Object.freeze({
            contentVersion: scalar(e.contentVersion),
            evidenceVersion: scalar(e.evidenceVersion),
            evidenceDigest: hash(e.evidenceDigest),
          });
        })();
  const bank =
    r.bank === null
      ? null
      : (() => {
          const b = data(r.bank, ['version', 'digest', 'questionIds']);
          return Object.freeze({
            version: scalar(b.version),
            digest: hash(b.digest),
            questionIds: list(b.questionIds),
          });
        })();
  const peers = array(r.peerCandidates).map(actor),
    mentors = array(r.mentorCandidates).map(actor);
  if (
    new Set(peers.map((c) => c.id)).size !== peers.length ||
    new Set(mentors.map((c) => c.id)).size !== mentors.length
  )
    return fail();
  return Object.freeze({
    actor: actor(r.actor),
    learnerAccess: bool(r.learnerAccess),
    evidence,
    policy: r.policy === null ? null : policy(r.policy),
    bank,
    selectionPolicyVersion:
      r.selectionPolicyVersion === null ? null : scalar(r.selectionPolicyVersion),
    rubricVersion: r.rubricVersion === null ? null : scalar(r.rubricVersion),
    initialAssignmentAllowed: bool(r.initialAssignmentAllowed),
    peerCandidates: Object.freeze(peers),
    mentorCandidates: Object.freeze(mentors),
  });
}
function authority(v: unknown, command: Key): NativeAuthority {
  const r = data(v, [
    'version',
    'authUserId',
    'scope',
    'curriculumVersionId',
    'authorityRevision',
    'context',
  ]);
  if (r.version !== 1 || uuid(r.authUserId) !== command.subjectId) return fail('forbidden');
  const s = scope(r.scope),
    c = context(r.context);
  if (
    !sameScope(s, command.scope) ||
    c.actor.cohortId !== s.cohortId ||
    c.actor.active !== true ||
    c.learnerAccess !== true ||
    [...c.peerCandidates, ...c.mentorCandidates].some((x) => x.cohortId !== s.cohortId)
  )
    return fail('forbidden');
  return Object.freeze({
    version: 1,
    authUserId: command.subjectId,
    scope: s,
    curriculumVersionId: uuid(r.curriculumVersionId),
    authorityRevision: hash(r.authorityRevision),
    context: c,
  });
}
function identities(a: NativeAuthority): readonly string[] {
  return Object.freeze(
    [
      ...new Set([
        a.context.actor.id,
        a.scope.learnerId,
        ...a.context.peerCandidates.map((c) => c.id),
        ...a.context.mentorCandidates.map((c) => c.id),
      ]),
    ].sort(),
  );
}
function configuration(config: QuestReviewPostgresConfiguration | null) {
  if (!config) return null;
  const r = data(config, ['client', 'authority', 'selection', 'limits']);
  // Missing ports deny before any client method lookup, including getters/proxies.
  if (!r.authority || !r.selection || !r.client || !r.limits) return null;
  const a = data(r.authority, ['read']),
    s = data(r.selection, ['verify']);
  if (typeof a.read !== 'function' || typeof s.verify !== 'function')
    return fail('configuration_required');
  const limits = data(r.limits, [
    'transactionMs',
    'statementMs',
    'lockMs',
    'maxGraphEdges',
    'maxMetadataBytes',
  ]);
  const l = Object.freeze(
    Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, positive(v)])),
  ) as QuestReviewPostgresLimits;
  if (
    l.maxMetadataBytes > QUEST_REVIEW_NATIVE_METADATA_CEILING ||
    Object.values(l).some((x) => x > 2147483647) ||
    l.lockMs > l.statementMs ||
    l.statementMs > l.transactionMs
  )
    return fail('configuration_required');
  return Object.freeze({
    client: r.client as QuestReviewPostgresClient,
    readAuthority: a.read as QuestReviewAuthorityPort['read'],
    verifySelection: s.verify as QuestReviewSelectionPort['verify'],
    limits: l,
  });
}
function translate(error: unknown): QuestReviewStorageError {
  if (error instanceof QuestReviewStorageError) return error;
  const field =
    error instanceof Error ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
  const message =
    field && Object.hasOwn(field, 'value') && typeof field.value === 'string' ? field.value : '';
  if (message === 'QUEST_MENTOR_BEFORE_PEERS' || message === 'QUEST_ASSIGNMENT_INPUT_INVALID')
    return new QuestReviewStorageError('record_conflict');
  const match =
    /^QUEST_REVIEW_(FORBIDDEN|CONFIGURATION_REQUIRED|EVIDENCE_CONFLICT|POLICY_CONFLICT|IDEMPOTENCY_CONFLICT|RECORD_CONFLICT|UNAVAILABLE)$/.exec(
      message,
    );
  return new QuestReviewStorageError(match ? (match[1]!.toLowerCase() as Code) : 'unavailable');
}

/** No connection, environment lookup, migration or authority activation on construction.
 * Default-denying SQL hooks remain a second boundary even if an injected JS port lies. */
export function createQuestReviewPostgresRepository(
  config: QuestReviewPostgresConfiguration | null = null,
): QuestReviewRepository {
  const configured = configuration(config);
  return Object.freeze({
    async transaction<T>(input: Key, work: (tx: QuestReviewTransaction) => Promise<T>): Promise<T> {
      if (!configured) return fail('configuration_required');
      const cfg = configured;
      const initial = data(input, ['scope', 'subjectId', 'requestId']),
        initialScope = data(initial.scope, ['cohortId', 'questKey', 'learnerId']);
      if (
        typeof initialScope.questKey !== 'string' ||
        initialScope.questKey.length > cfg.limits.maxMetadataBytes
      )
        return fail('forbidden');
      const command = key(input),
        started = performance.now(),
        deadline = started + cfg.limits.transactionMs;
      if (Buffer.byteLength(JSON.stringify(command), 'utf8') > cfg.limits.maxMetadataBytes)
        return fail('forbidden');
      const pendingQueries = new Set<{ cancel(): unknown }>();
      const cancelledQueries = new WeakSet<object>();
      let open = true,
        methodsOpen = true,
        queryOpen = false,
        inMethod = false,
        poisoned = false,
        entered = false,
        completed = false;
      let result: T;
      let rejectDeadline!: (error: QuestReviewStorageError) => void;
      const expired = new Promise<never>((_, reject) => {
        rejectDeadline = reject;
      });
      void expired.catch(() => undefined);
      const cancel = () => {
        for (const pending of pendingQueries) {
          if (cancelledQueries.has(pending)) continue;
          cancelledQueries.add(pending);
          try {
            void Promise.resolve(pending.cancel()).catch(() => undefined);
          } catch {
            /* uncertain cancellation, never a rollback assertion */
          }
        }
      };
      const timer = setTimeout(() => {
        open = false;
        methodsOpen = false;
        poisoned = true;
        cancel();
        rejectDeadline(new QuestReviewStorageError('unavailable'));
      }, cfg.limits.transactionMs);
      const alive = () => {
        if (!open || poisoned || performance.now() < started || performance.now() >= deadline)
          return fail();
      };
      const copyJson = (value: unknown, depth = 0, budget = { nodes: 0 }): unknown => {
        if (depth > 16 || ++budget.nodes > cfg.limits.maxMetadataBytes) return fail();
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
          if (!Number.isSafeInteger(value)) return fail();
          return value;
        }
        if (typeof value === 'string') {
          if (
            value.length > cfg.limits.maxMetadataBytes ||
            Buffer.from(value, 'utf8').toString('utf8') !== value
          )
            return fail();
          return value;
        }
        if (Array.isArray(value)) {
          if (value.length > cfg.limits.maxMetadataBytes) return fail();
          return Object.freeze(array(value).map((x) => copyJson(x, depth + 1, budget)));
        }
        if (
          !value ||
          typeof value !== 'object' ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(value))
        )
          return fail();
        const fields = Object.getOwnPropertyDescriptors(value);
        const pairs = Reflect.ownKeys(fields).map((k) => {
          if (
            typeof k !== 'string' ||
            !Object.hasOwn(fields[k]!, 'value') ||
            Buffer.from(k, 'utf8').toString('utf8') !== k
          )
            return fail();
          return [k, copyJson(fields[k]!.value, depth + 1, budget)] as const;
        });
        return Object.freeze(Object.fromEntries(pairs));
      };
      const boundedJson = (value: unknown) => {
        const copied = copyJson(value);
        const raw = JSON.stringify(copied);
        if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > cfg.limits.maxMetadataBytes)
          return fail();
        return raw;
      };
      try {
        const begin = cfg.client.begin(async (native) => {
          if (entered) return fail();
          entered = true;
          alive();
          queryOpen = true;
          try {
            const connection: QueryClient = native;
            const raw = async (sql: string, params: readonly unknown[], methodBound = false) => {
              alive();
              if (!queryOpen || (methodBound && (!methodsOpen || !inMethod))) return fail();
              const pending = connection.unsafe(sql, params as never[]);
              if (typeof pending?.cancel !== 'function') return fail();
              pendingQueries.add(pending);
              const waiting = Promise.resolve(pending);
              void waiting.catch(() => undefined);
              try {
                const rows = await Promise.race([waiting, expired]);
                alive();
                if (
                  !queryOpen ||
                  (methodBound && (!methodsOpen || !inMethod)) ||
                  !Array.isArray(rows) ||
                  rows.length > cfg.limits.maxMetadataBytes
                )
                  return fail();
                // Driver RowList metadata is ignored; indexed row values are copied without getters.
                const indexed = Array.from({ length: rows.length }, (_, i) => {
                  const d = Object.getOwnPropertyDescriptor(rows, String(i));
                  if (!d || !Object.hasOwn(d, 'value')) return fail();
                  return d.value;
                });
                const copied = copyJson(indexed) as readonly unknown[];
                boundedJson(copied);
                return copied;
              } finally {
                pendingQueries.delete(pending);
              }
            };
            const query = async (sql: string, params: readonly unknown[], methodBound = false) => {
              alive();
              const remaining = Math.floor(deadline - performance.now());
              if (remaining < 1) return fail();
              const settings = [
                Math.min(cfg.limits.statementMs, remaining),
                Math.min(cfg.limits.lockMs, remaining),
                remaining,
              ].map((x) => x + 'ms');
              const bounds = await raw(QUEST_REVIEW_BOUNDS_SQL, settings, methodBound);
              const b =
                bounds.length === 1
                  ? data(bounds[0], ['statement_timeout', 'lock_timeout', 'idle_timeout'])
                  : null;
              if (
                !b ||
                parseTimeoutMs(b.statement_timeout) !== parseTimeoutMs(settings[0]) ||
                parseTimeoutMs(b.lock_timeout) !== parseTimeoutMs(settings[1]) ||
                parseTimeoutMs(b.idle_timeout) !== parseTimeoutMs(settings[2])
              )
                return fail();
              return raw(sql, params, methodBound);
            };
            const one = async (
              sql: string,
              params: readonly unknown[],
              name = 'data',
              methodBound = false,
            ) => {
              const rows = await query(sql, params, methodBound);
              if (rows.length !== 1) return fail();
              return data(rows[0], [name])[name];
            };
            const base = [
              command.subjectId,
              command.scope.cohortId,
              command.scope.questKey,
              command.scope.learnerId,
            ];
            const port = async <R>(call: () => Promise<R>): Promise<R> => {
              alive();
              const pending = Promise.resolve().then(call);
              void pending.catch(() => undefined);
              const value = await Promise.race([pending, expired]);
              alive();
              return value;
            };
            const read = async () => {
              const value = await port(() =>
                cfg.readAuthority(
                  Object.freeze({ command, readNative: () => one(QUEST_REVIEW_CONTEXT_SQL, base) }),
                ),
              );
              boundedJson(value);
              return authority(copyJson(value), command);
            };
            if (
              (await one(
                QUEST_REVIEW_LOCK_SQL,
                [command.scope.cohortId, command.scope.questKey, command.requestId],
                'locked',
              )) !== true
            )
              return fail();
            const discovered = await read();
            const locked = authority(
              await one(QUEST_REVIEW_AUTHORITY_LOCK_SQL, [...base, identities(discovered)]),
              command,
            );
            if (canonical(discovered) !== canonical(locked)) return fail();
            const recheck = async () => {
              alive();
              if (canonical(await read()) !== canonical(locked)) return fail();
            };
            const dispatch = (operation: string, payload: unknown) =>
              one(
                QUEST_REVIEW_DISPATCH_SQL,
                [...base, command.requestId, operation, boundedJson(payload)],
                'data',
                true,
              );
            const method = <R>(action: () => Promise<R>): Promise<R> => {
              const running = (async () => {
                if (!methodsOpen || inMethod) {
                  poisoned = true;
                  return fail();
                }
                alive();
                inMethod = true;
                try {
                  await recheck();
                  alive();
                  if (!methodsOpen) return fail();
                  return await action();
                } catch (error) {
                  poisoned = true;
                  throw translate(error);
                } finally {
                  inMethod = false;
                }
              })();
              void running.catch(() => undefined);
              return running;
            };
            const sameCycleScope = (c: QuestReviewCycle) => {
              if (!sameScope(c, command.scope)) return fail('record_conflict');
            };
            const capture = <R>(readValue: () => R): R => {
              try {
                alive();
                if (!methodsOpen) return fail();
                return readValue();
              } catch (error) {
                poisoned = true;
                throw translate(error);
              }
            };
            const transaction: QuestReviewTransaction = Object.freeze({
              context: () => method(async () => locked.context),
              read: () => method(async () => stored(await dispatch('read', {}), command)),
              peerGraph: () =>
                method(async () => {
                  const r = data(
                    await dispatch('peer_graph', { maxEdges: cfg.limits.maxGraphEdges }),
                    ['complete', 'edges'],
                  );
                  const edges: QuestPeerEdge[] = array(r.edges).map((v) => {
                    const e = data(v, ['cohortId', 'questKey', 'reviewerId', 'learnerId']);
                    const edge = Object.freeze({
                      cohortId: uuid(e.cohortId),
                      questKey: scalar(e.questKey),
                      reviewerId: uuid(e.reviewerId),
                      learnerId: uuid(e.learnerId),
                    });
                    if (
                      edge.cohortId !== command.scope.cohortId ||
                      edge.questKey !== command.scope.questKey ||
                      edge.reviewerId === edge.learnerId
                    )
                      return fail();
                    return edge;
                  });
                  if (
                    r.complete !== true ||
                    edges.length > cfg.limits.maxGraphEdges ||
                    new Set(edges.map((e) => e.learnerId + ':' + e.reviewerId)).size !==
                      edges.length
                  )
                    return fail();
                  return Object.freeze({ complete: true, edges: Object.freeze(edges) });
                }),
              receipt: (requestId: string) =>
                method(async () => {
                  if (uuid(requestId) !== command.requestId) return fail('idempotency_conflict');
                  const r = await dispatch('receipt', { requestId });
                  return r === null ? null : receipt(r);
                }),
              insertCycle: async (value: QuestReviewCycle, snapshot: QuestReviewPolicy) => {
                const { c, p } = capture(() => {
                  boundedJson(value);
                  boundedJson(snapshot);
                  const c = cycle(copyJson(value)),
                    p = policy(copyJson(snapshot));
                  sameCycleScope(c);
                  return { c, p };
                });
                return method(async () => {
                  if (command.requestId !== null) return fail('forbidden');
                  const verified = await port(() =>
                    cfg.verifySelection(
                      Object.freeze({
                        command,
                        cycle: c,
                        verifyNative: async () =>
                          (await dispatch('validate_selection', { cycle: c })) === true,
                      }),
                    ),
                  );
                  if (verified !== true) return fail('configuration_required');
                  await recheck();
                  if ((await dispatch('insert_cycle', { cycle: c, policy: p })) !== true)
                    return fail();
                });
              },
              insertAssignments: async (values: readonly QuestReviewAssignment[]) => {
                const assignments = capture(() => {
                  boundedJson(values);
                  const a = Object.freeze(array(copyJson(values)).map(assignment));
                  a.forEach((x) => sameCycleScope(x.cycle));
                  return a;
                });
                return method(async () => {
                  if ((await dispatch('insert_assignments', { assignments })) !== true)
                    return fail();
                });
              },
              insertReceipt: async (value: QuestReviewReceipt) => {
                const r = capture(() => {
                  boundedJson(value);
                  const r = receipt(copyJson(value));
                  sameCycleScope(r.cycle);
                  return r;
                });
                return method(async () => {
                  if (command.requestId !== r.id || r.reviewerId !== locked.context.actor.id)
                    return fail('forbidden');
                  if ((await dispatch('insert_receipt', { receipt: r })) !== true) return fail();
                });
              },
            });
            const working = Promise.resolve().then(() => work(transaction));
            void working.catch(() => undefined);
            result = await Promise.race([working, expired]);
            methodsOpen = false;
            if (inMethod || pendingQueries.size) return fail();
            await recheck();
            alive();
            completed = true;
          } finally {
            queryOpen = false;
            methodsOpen = false;
          }
        });
        void Promise.resolve(begin).catch(() => undefined);
        await Promise.race([begin, expired]);
        alive();
        if (!entered || !completed || inMethod || pendingQueries.size) return fail();
        return result!;
      } catch (error) {
        throw translate(error);
      } finally {
        open = false;
        methodsOpen = false;
        clearTimeout(timer);
        cancel();
      }
    },
  });
}
