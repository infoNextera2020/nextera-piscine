import { createHash } from 'node:crypto';
import { isRequestId } from '@nextera/domain';
import { sameEditorScope, type EditorScope } from './editor-contract';
import {
  prepareVisibleRunWork,
  projectVisibleRunOutcome,
  runIntentDigest,
  type VisibleRunIntent,
  type VisibleRunWork,
  type VisibleRunOutcome,
} from './visible-run-spec';

export type WorkerLease = Readonly<{ runId: string; generation: number; token: string }>;
export type QueueHint = Readonly<{
  runId: string;
  scope: EditorScope;
  generation: number;
  state: 'queued' | 'claimed' | 'running' | 'recovery_required';
}>;
export type ClaimedVisibleRun = Readonly<{
  run: Readonly<{ intent: VisibleRunIntent; record: { id: string } }>;
  manifest: unknown;
  policy: unknown;
  lease: WorkerLease;
  leaseExpiresAt: string;
}>;
export type PublicExecutionRequest = Readonly<{
  version: 1;
  generation: number;
  executionId: string;
  work: VisibleRunWork;
}>;
export interface VisibleRunWorkerStore {
  claim(hint: QueueHint): Promise<ClaimedVisibleRun | null>;
  pulse(
    lease: WorkerLease,
    startExecution: boolean,
  ): Promise<
    | { kind: 'authorized'; state: 'claimed' | 'running'; leaseExpiresAt: string }
    | { kind: 'stop_required' }
  >;
  complete(input: {
    lease: WorkerLease;
    scope: EditorScope;
    outcome: VisibleRunOutcome;
    stoppedProof: string;
  }): Promise<void>;
}
export interface FencedPublicExecutor {
  /** Only public work. Return only after stop verification; throws/unknown cleanup never release capacity. */
  execute(request: PublicExecutionRequest, signal: AbortSignal): Promise<unknown>;
}
export type WorkerResult = Readonly<{
  kind: 'not_claimed' | 'recorded' | 'recovery_required';
  runId: string;
  generation?: number;
  stoppedProof?: string;
}>;
type Dependencies = Readonly<{
  store: VisibleRunWorkerStore;
  executor: FencedPublicExecutor;
  /** Abortable scheduling; no background timer is started by importing/configuring this driver. */
  delay(ms: number, signal: AbortSignal): Promise<void>;
}>;
const hash = /^[0-9a-f]{64}$/;
function terminal(value: unknown, request: PublicExecutionRequest) {
  if (!value || typeof value !== 'object') throw new Error('PUBLIC_EXECUTION_UNAVAILABLE');
  const r = value as Record<string, unknown>;
  if (r.generation !== request.generation || r.executionId !== request.executionId)
    throw new Error('PUBLIC_EXECUTION_UNAVAILABLE');
  const outcome = projectVisibleRunOutcome(request.work, value);
  return {
    outcome,
    stoppedProof:
      typeof r.stoppedProof === 'string' && hash.test(r.stoppedProof) ? r.stoppedProof : null,
  };
}

/** One bounded claimed intent. No graded quota, product result, mastery or private pack API is available. */
export async function executeQueuedVisibleRun(
  hint: QueueHint,
  deps: Dependencies,
  shutdown?: AbortSignal,
): Promise<WorkerResult> {
  if (
    shutdown?.aborted ||
    hint.state !== 'queued' ||
    hint.generation !== 0 ||
    !isRequestId(hint.runId)
  )
    return { kind: 'not_claimed', runId: hint.runId };
  let claimed: ClaimedVisibleRun | null = null;
  let request: PublicExecutionRequest | undefined;
  let stopRequired = false;
  const executeAbort = new AbortController(),
    heartbeatAbort = new AbortController();
  const stop = () => {
    stopRequired = true;
    executeAbort.abort();
  };
  shutdown?.addEventListener('abort', stop, { once: true });
  let heartbeat: Promise<void> | undefined;
  try {
    claimed = await deps.store.claim(hint);
    if (!claimed) return { kind: 'not_claimed', runId: hint.runId };
    const lease = claimed.lease;
    if (
      lease.runId !== hint.runId ||
      !isRequestId(lease.token) ||
      !Number.isSafeInteger(lease.generation) ||
      lease.generation < 1 ||
      claimed.run.record.id !== hint.runId ||
      !sameEditorScope(claimed.run.intent.scope, hint.scope) ||
      !Number.isFinite(Date.parse(claimed.leaseExpiresAt))
    )
      throw new Error('CLAIM_UNAVAILABLE');
    const work = prepareVisibleRunWork(
      hint.runId,
      claimed.run.intent,
      claimed.manifest,
      claimed.policy,
    );
    const executionId = visibleRunExecutionId(hint.runId, lease.generation);
    request = Object.freeze({ version: 1, generation: lease.generation, executionId, work });
    if (shutdown?.aborted) throw new Error('STOP_REQUIRED');
    const started = await deps.store.pulse(lease, true);
    if (started.kind !== 'authorized' || started.state !== 'running')
      throw new Error('STOP_REQUIRED');
    if (shutdown?.aborted) throw new Error('STOP_REQUIRED');
    // Serial renewal; no overlapping pulses. Every permission/time decision remains in SQL.
    heartbeat = (async () => {
      while (!heartbeatAbort.signal.aborted) {
        try {
          await deps.delay(
            Math.max(1, Math.floor(work.policy.budgets.leaseMs / 3)),
            heartbeatAbort.signal,
          );
        } catch {
          if (!heartbeatAbort.signal.aborted) stop();
          return;
        }
        if (heartbeatAbort.signal.aborted) return;
        try {
          const permission = await deps.store.pulse(lease, false);
          if (permission.kind !== 'authorized' || permission.state !== 'running') {
            stop();
            return;
          }
        } catch {
          stop();
          return;
        }
      }
    })();
    let raw: unknown;
    try {
      raw = await deps.executor.execute(request, executeAbort.signal);
    } finally {
      heartbeatAbort.abort();
      await heartbeat;
    }
    const result = terminal(raw, request);
    if (!result.stoppedProof)
      return { kind: 'recovery_required', runId: hint.runId, generation: lease.generation };
    if (stopRequired || shutdown?.aborted)
      return {
        kind: 'recovery_required',
        runId: hint.runId,
        generation: lease.generation,
        stoppedProof: result.stoppedProof,
      };
    // A trusted verified-stop receipt is mandatory even for timeout/runtime/system errors.
    await deps.store.complete({
      lease,
      scope: work.intent.scope,
      outcome: result.outcome,
      stoppedProof: result.stoppedProof,
    });
    return { kind: 'recorded', runId: hint.runId, generation: lease.generation };
  } catch {
    // Claimed/running capacity stays held for separate trusted reconciliation after uncertainty.
    return {
      kind: claimed ? 'recovery_required' : 'not_claimed',
      runId: hint.runId,
      ...(claimed ? { generation: claimed.lease.generation } : {}),
    };
  } finally {
    heartbeatAbort.abort();
    executeAbort.abort();
    await heartbeat;
    shutdown?.removeEventListener('abort', stop);
  }
}

export function publicExecutionBinding(request: PublicExecutionRequest) {
  return {
    runId: request.work.runId,
    intentDigest: runIntentDigest(request.work.intent),
    generation: request.generation,
    executionId: request.executionId,
  };
}

/** Stable crash-recovery namespace. Persisted runId + lease generation reconstruct exact owned labels. */
export function visibleRunExecutionId(runId: string, generation: number): string {
  if (!isRequestId(runId) || !Number.isSafeInteger(generation) || generation < 1)
    throw new Error('EXECUTION_ID_UNAVAILABLE');
  const hex = createHash('sha256')
    .update('nextera-visible-run-execution\0v1\0' + runId.toLowerCase() + '\0' + generation)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '8';
  hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const id = hex.join('');
  return [id.slice(0, 8), id.slice(8, 12), id.slice(12, 16), id.slice(16, 20), id.slice(20)].join(
    '-',
  );
}
