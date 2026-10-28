import { describe, it, expect, vi } from 'vitest';
import {
  executeQueuedVisibleRun,
  publicExecutionBinding,
  visibleRunExecutionId,
  type PublicExecutionRequest,
  type QueueHint,
  type VisibleRunWorkerStore,
  type FencedPublicExecutor,
} from './visible-run-worker';
import { visibleManifestDigest, visiblePolicyDigest, runSourceDigest } from './visible-run-spec';
const id = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
function fixture() {
  const scope = {
    learnerId: id(1),
    cohortId: id(2),
    attemptId: id(3),
    taskKey: 'question-a',
    definitionDigest: 'a'.repeat(64),
  };
  const manifest = {
    version: 1,
    visibility: 'visible_examples',
    language: 'go',
    taskKey: 'question-a',
    definitionDigest: scope.definitionDigest,
    filename: 'work.go',
    harness: {
      kind: 'go_function_v1',
      packageName: 'main',
      functionName: 'Work',
      argument: 'string',
      returns: 'string',
    },
    examples: [{ key: 'one', input: 'a', expectedOutput: 'a' }],
  };
  // Explicit synthetic policy values. No production allowance is configured by a test.
  const policy = {
    version: 1,
    key: 'test-only',
    enabled: true,
    visibility: 'visible_examples',
    graded: false,
    consumesGradedAttempts: false,
    limits: {
      timeoutMs: 2000,
      memoryMb: 64,
      outputBytes: 65536,
      sourceBytes: 1024,
      requestsPerWindow: 3,
      windowMs: 60000,
      concurrency: 1,
    },
    budgets: { compilationMs: 20000, startupMs: 1000, leaseMs: 40000 },
    storage: { maxRunsPerAttempt: 4, maxSourceBytesPerAttempt: 8192, readAfterDeadlineSeconds: 0 },
    maxExamples: 2,
    isolation: {
      imageDigest: 'sha256:' + 'b'.repeat(64),
      network: 'none',
      hostAccess: 'none',
      filesystem: 'disposable',
      processUser: 'unprivileged',
      resourceEnforcement: 'external',
    },
  };
  const source = 'package main\nfunc Work(s string) string { return s }\n';
  const intent = {
    scope,
    requestId: id(4),
    filename: 'work.go',
    source,
    sourceDigest: runSourceDigest(source),
    byteLength: Buffer.byteLength(source),
    manifestDigest: visibleManifestDigest(manifest),
    policyDigest: visiblePolicyDigest(policy),
    deadline: '2099-01-01T00:00:00Z',
  };
  const hint: QueueHint = { runId: id(5), scope, generation: 0, state: 'queued' };
  const claim = {
    run: { intent, record: { id: hint.runId } },
    manifest,
    policy,
    lease: { runId: hint.runId, generation: 1, token: id(6) },
    leaseExpiresAt: '2099-01-01T00:00:00Z',
  };
  const store = {
    claim: vi.fn<VisibleRunWorkerStore['claim']>().mockResolvedValue(claim),
    pulse: vi.fn<VisibleRunWorkerStore['pulse']>().mockResolvedValue({
      kind: 'authorized',
      state: 'running',
      leaseExpiresAt: claim.leaseExpiresAt,
    }),
    complete: vi.fn<VisibleRunWorkerStore['complete']>().mockResolvedValue(undefined),
  };
  const result = (request: PublicExecutionRequest, patch: Record<string, unknown> = {}) => ({
    ...publicExecutionBinding(request),
    state: 'completed',
    output: '["a"]',
    stoppedProof: 'c'.repeat(64),
    ...patch,
  });
  const executor = {
    execute: vi.fn<FencedPublicExecutor['execute']>(async (request) => result(request)),
  };
  const delay = async (ms: number, signal: AbortSignal) => {
    void ms;
    return new Promise<void>((_resolve, reject) => {
      if (signal.aborted) reject(new Error('abort'));
      else signal.addEventListener('abort', () => reject(new Error('abort')), { once: true });
    });
  };
  return {
    hint,
    claim,
    store,
    executor,
    result,
    delay,
    deps: { store, executor, delay },
  };
}
describe('public-only fenced Run worker', () => {
  it('records only after running authorization and bound verified-stop result', async () => {
    const f = fixture();
    expect(await executeQueuedVisibleRun(f.hint, f.deps)).toMatchObject({
      kind: 'recorded',
      generation: 1,
    });
    expect(f.store.pulse).toHaveBeenCalledWith(f.claim.lease, true);
    expect(f.store.complete).toHaveBeenCalledOnce();
    const request = f.executor.execute.mock.calls[0]![0];
    expect(Object.keys(request)).toEqual(['version', 'generation', 'executionId', 'work']);
    expect(JSON.stringify(request)).not.toContain(f.claim.lease.token);
    expect(request.work).not.toHaveProperty('privatePack');
    expect(f.store.complete.mock.calls[0]![0].outcome.state).toBe('completed');
  });
  it('does nothing for already-owned queue hints or shutdown before claim', async () => {
    const f = fixture(),
      stop = new AbortController();
    stop.abort();
    expect((await executeQueuedVisibleRun(f.hint, f.deps, stop.signal)).kind).toBe('not_claimed');
    expect(
      (await executeQueuedVisibleRun({ ...f.hint, state: 'running', generation: 1 }, f.deps)).kind,
    ).toBe('not_claimed');
    expect(f.store.claim).not.toHaveBeenCalled();
  });
  it('does not execute an intent that another worker claimed', async () => {
    const f = fixture();
    f.store.claim.mockResolvedValue(null);
    expect((await executeQueuedVisibleRun(f.hint, f.deps)).kind).toBe('not_claimed');
    expect(f.executor.execute).not.toHaveBeenCalled();
  });
  it('does not start after server deadline/access/start permission is refused', async () => {
    const f = fixture();
    f.store.pulse.mockResolvedValue({ kind: 'stop_required' });
    expect((await executeQueuedVisibleRun(f.hint, f.deps)).kind).toBe('recovery_required');
    expect(f.executor.execute).not.toHaveBeenCalled();
    expect(f.store.complete).not.toHaveBeenCalled();
  });
  it('rejects source, definition and lease substitution before dispatch', async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.claim.run.intent.source = 'changed';
      },
      (f: ReturnType<typeof fixture>) => {
        f.claim.run.intent.scope = {
          ...f.claim.run.intent.scope,
          definitionDigest: 'f'.repeat(64),
        };
      },
      (f: ReturnType<typeof fixture>) => {
        f.claim.lease.runId = id(8);
      },
    ]) {
      const f = fixture();
      mutate(f);
      expect((await executeQueuedVisibleRun(f.hint, f.deps)).kind).toBe('recovery_required');
      expect(f.executor.execute).not.toHaveBeenCalled();
      expect(f.store.complete).not.toHaveBeenCalled();
    }
  });
  it.each([
    { stoppedProof: null },
    { stoppedProof: 'bad' },
    { executionId: id(8) },
    { generation: 2 },
    { runId: id(8) },
    { intentDigest: 'f'.repeat(64) },
    { state: 'passed' },
    { output: 'x'.repeat(65537) },
  ])('does not release capacity for an unbound/unsafe result %#', async (patch) => {
    const f = fixture();
    f.executor.execute.mockImplementation(async (request) => f.result(request, patch));
    expect((await executeQueuedVisibleRun(f.hint, f.deps)).kind).toBe('recovery_required');
    expect(f.store.complete).not.toHaveBeenCalled();
  });
  it('strips infrastructure diagnostics instead of exposing host/token details', async () => {
    const f = fixture();
    f.executor.execute.mockImplementation(async (request) =>
      f.result(request, { state: 'system_error', output: 'secret /host/path' }),
    );
    expect((await executeQueuedVisibleRun(f.hint, f.deps)).kind).toBe('recorded');
    expect(f.store.complete.mock.calls[0]![0].outcome.output).toBe('');
  });
  it('aborts on failed renewal and retains capacity even with a verified-stop receipt', async () => {
    const f = fixture();
    f.store.pulse
      .mockResolvedValueOnce({
        kind: 'authorized',
        state: 'running',
        leaseExpiresAt: f.claim.leaseExpiresAt,
      })
      .mockResolvedValue({ kind: 'stop_required' });
    const deps = { ...f.deps, delay: async () => {} };
    f.executor.execute.mockImplementation(async (request, signal) => {
      if (!signal.aborted)
        await new Promise<void>((r) => signal.addEventListener('abort', () => r(), { once: true }));
      return f.result(request);
    });
    expect(await executeQueuedVisibleRun(f.hint, deps)).toMatchObject({
      kind: 'recovery_required',
      stoppedProof: 'c'.repeat(64),
    });
    expect(f.store.complete).not.toHaveBeenCalled();
    expect(f.store.pulse).toHaveBeenCalledTimes(2);
  });
  it('does not manufacture cleanup proof after executor transport loss', async () => {
    const f = fixture();
    f.executor.execute.mockRejectedValue(new Error('lost supervisor'));
    expect((await executeQueuedVisibleRun(f.hint, f.deps)).kind).toBe('recovery_required');
    expect(f.store.complete).not.toHaveBeenCalled();
  });
  it('keeps completion acknowledgement loss uncertain and never retries execution in-place', async () => {
    const f = fixture();
    f.store.complete.mockRejectedValue(new Error('lost ack'));
    expect((await executeQueuedVisibleRun(f.hint, f.deps)).kind).toBe('recovery_required');
    expect(f.executor.execute).toHaveBeenCalledOnce();
    f.store.claim.mockResolvedValue(null);
    await executeQueuedVisibleRun(f.hint, f.deps);
    expect(f.executor.execute).toHaveBeenCalledOnce();
  });
  it('requires stopped proof after an external worker shutdown, not a new learner cancellation verdict', async () => {
    const f = fixture(),
      stop = new AbortController();
    f.executor.execute.mockImplementation(async (request) => {
      stop.abort();
      return f.result(request);
    });
    const result = await executeQueuedVisibleRun(f.hint, f.deps, stop.signal);
    expect(result.kind).toBe('recovery_required');
    expect(f.store.complete).not.toHaveBeenCalled();
  });
});

describe('durable public execution identity', () => {
  it('reconstructs identity without process memory and separates lease generations', () => {
    expect(visibleRunExecutionId(id(1), 1)).toBe(visibleRunExecutionId(id(1).toUpperCase(), 1));
    expect(visibleRunExecutionId(id(1), 1)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(visibleRunExecutionId(id(1), 1)).not.toBe(visibleRunExecutionId(id(1), 2));
    expect(visibleRunExecutionId(id(1), 1)).not.toBe(visibleRunExecutionId(id(2), 1));
  });
  it('refuses invalid recovery identifiers or generations', () => {
    for (const g of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => visibleRunExecutionId(id(1), g)).toThrow();
    expect(() => visibleRunExecutionId('x', 1)).toThrow();
  });
});
