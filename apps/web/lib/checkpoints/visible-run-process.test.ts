import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { visibleRunStorageFixture } from '../../../../tests/fixtures/visible-runs';
import {
  createPublicRunProcessExecutor,
  type PublicRunProcessTransport,
} from './visible-run-process';
import {
  prepareVisibleRunWork,
  runSourceDigest,
  visibleManifestDigest,
  visiblePolicyDigest,
} from './visible-run-spec';
import {
  executeQueuedVisibleRun,
  publicExecutionBinding,
  visibleRunExecutionId,
  type PublicExecutionRequest,
  type VisibleRunWorkerStore,
} from './visible-run-worker';
vi.mock('server-only', () => ({}));
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    throw new Error('Real processes forbidden in this source test');
  }),
}));

function request() {
  const f = visibleRunStorageFixture();
  f.manifest.harness.packageName = 'main';
  f.policy.limits.timeoutMs = 2000;
  f.policy.limits.outputBytes = 65536;
  f.policy.budgets.compilationMs = 20000;
  f.policy.budgets.leaseMs = 40000;
  const source = '\uFEFFpackage main\r\n// café 😀 <>&\u2028\u2029\n';
  const intent = {
    ...f.intent,
    source,
    sourceDigest: runSourceDigest(source),
    byteLength: Buffer.byteLength(source),
    deadline: '2099-01-01T00:00:00Z',
    manifestDigest: visibleManifestDigest(f.manifest),
    policyDigest: visiblePolicyDigest(f.policy),
  };
  return {
    version: 1 as const,
    generation: 1,
    executionId: visibleRunExecutionId(f.run, 1),
    work: prepareVisibleRunWork(f.run, intent, f.manifest, f.policy),
  };
}
const config = {
  executable: '/opt/01-coding/runner',
  executableSha256: 'a'.repeat(64),
  runnerImage: 'sha256:' + 'b'.repeat(64),
  dockerSocket: '/run/test-only.sock',
  cleanupGraceMs: 20000,
  exitGraceMs: 1000,
};
const outcome = (r: PublicExecutionRequest, patch: Record<string, unknown> = {}) => ({
  ...publicExecutionBinding(r),
  state: 'completed',
  output: '["a"]',
  stoppedProof: 'c'.repeat(64),
  ...patch,
});
class FakeChild extends EventEmitter {
  chunks: Buffer[] = [];
  stdin = new Writable({
    write: (chunk: Buffer, _encoding, callback) => {
      this.chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn((_signal?: NodeJS.Signals) => {
    void _signal;
    return true;
  });
  finish(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.emit('close', code, signal);
  }
  reply(value: unknown) {
    this.stdout.write(JSON.stringify(value) + '\n');
    this.finish();
  }
}
function fixture() {
  const child = new FakeChild(),
    close = vi.fn(async () => {});
  const transport: PublicRunProcessTransport = {
    platform: 'linux',
    now: () => Date.parse('2026-10-28T10:00:00Z'),
    openBinary: vi.fn(async () => ({ fd: 42, close })),
    launch: vi.fn(() => child as unknown as ChildProcessWithoutNullStreams),
  };
  return { child, transport, close, executor: createPublicRunProcessExecutor(config, transport) };
}
async function begun(
  f: ReturnType<typeof fixture>,
  r = request(),
  signal = new AbortController().signal,
) {
  const promise = f.executor.execute(r, signal);
  await Promise.resolve();
  await Promise.resolve();
  return { promise, r };
}
afterEach(() => vi.useRealTimers());
describe('protected public Run subprocess transport (fake processes only)', () => {
  it('does no IO on construction and invokes only pinned fd with empty environment/no shell', async () => {
    const f = fixture();
    expect(f.transport.openBinary).not.toHaveBeenCalled();
    expect(f.transport.launch).not.toHaveBeenCalled();
    const { promise, r } = await begun(f);
    expect(f.transport.openBinary).toHaveBeenCalledWith(config.executable, config.executableSha256);
    expect(f.transport.launch).toHaveBeenCalledWith(
      '/proc/self/fd/3',
      [
        'public-run-stdio',
        '--runner-image',
        config.runnerImage,
        '--docker-socket',
        config.dockerSocket,
      ],
      {
        cwd: '/opt/01-coding',
        env: {},
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe', 42],
      },
    );
    expect(f.child.stdin.writableEnded).toBe(true);
    const wire = Buffer.concat(f.child.chunks).toString('utf8');
    expect(JSON.parse(wire)).toEqual(r);
    expect(JSON.parse(wire).work.intent.source).toBe(r.work.intent.source);
    expect(wire).not.toMatch(/leaseToken|DATABASE_URL|privatePack/);
    f.child.reply(outcome(r));
    expect(await promise).toMatchObject({ state: 'completed', stoppedProof: 'c'.repeat(64) });
    expect(f.close).toHaveBeenCalledOnce();
  });
  it.each([
    { executable: 'runner' },
    { executable: '/opt/../runner' },
    { dockerSocket: '/tmp/../x' },
    { executableSha256: 'bad' },
    { runnerImage: 'latest' },
    { cleanupGraceMs: 1000 },
    { cleanupGraceMs: 15000 },
    { exitGraceMs: 0 },
  ])('rejects unsafe/unpinned operator configuration %#', (patch) => {
    const f = fixture();
    expect(() => createPublicRunProcessExecutor({ ...config, ...patch }, f.transport)).toThrow(
      'PUBLIC_EXECUTION_UNAVAILABLE',
    );
    expect(f.transport.launch).not.toHaveBeenCalled();
  });
  it('requires Linux and never silently substitutes a platform or binary', () => {
    const f = fixture();
    expect(() =>
      createPublicRunProcessExecutor(config, { ...f.transport, platform: 'win32' }),
    ).toThrow();
  });
  it('copies configuration and requires successful binary verification before launch', async () => {
    const f = fixture(),
      settings = { ...config },
      adapter = createPublicRunProcessExecutor(settings, f.transport);
    settings.dockerSocket = '/other.sock';
    vi.mocked(f.transport.openBinary).mockRejectedValue(new Error('secret path denied'));
    await expect(adapter.execute(request(), new AbortController().signal)).rejects.toThrow(
      /^PUBLIC_EXECUTION_UNAVAILABLE$/,
    );
    expect(f.transport.launch).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform !== 'linux')(
    'checks actual local file hash/mode/symlink without running its fake bytes',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), '01-coding-run-source-test-')),
        file = join(directory, 'fixture'),
        link = join(directory, 'symlink'),
        bytes = Buffer.from('test data only, not an executable format'),
        hash = createHash('sha256').update(bytes).digest('hex');
      const launch = vi.mocked(spawn);
      launch.mockClear();
      try {
        await writeFile(file, bytes, { mode: 0o500 });
        await symlink(file, link);
        for (const c of [
          { ...config, executable: file, executableSha256: '0'.repeat(64) },
          { ...config, executable: link, executableSha256: hash },
        ])
          await expect(
            createPublicRunProcessExecutor(c).execute(request(), new AbortController().signal),
          ).rejects.toThrow();
        await chmod(file, 0o522);
        await expect(
          createPublicRunProcessExecutor({
            ...config,
            executable: file,
            executableSha256: hash,
          }).execute(request(), new AbortController().signal),
        ).rejects.toThrow();
        expect(launch).not.toHaveBeenCalled();
        await chmod(file, 0o500);
        await expect(
          createPublicRunProcessExecutor({
            ...config,
            executable: file,
            executableSha256: hash,
          }).execute(request(), new AbortController().signal),
        ).rejects.toThrow();
        expect(launch).toHaveBeenCalledOnce(); // Mocked launch throws; fake bytes never execute.
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it('refuses source/digest substitution, expired deadline, image and unsupported ABI before opening a binary', async () => {
    for (const mutate of [
      (r: PublicExecutionRequest) => ({
        ...r,
        work: { ...r.work, intent: { ...r.work.intent, source: 'changed' } },
      }),
      (r: PublicExecutionRequest) => ({
        ...r,
        work: { ...r.work, intent: { ...r.work.intent, deadline: '2000-01-01T00:00:00Z' } },
      }),
      (r: PublicExecutionRequest) => ({ ...r, generation: 0 }),
    ]) {
      const f = fixture();
      await expect(
        f.executor.execute(mutate(request()), new AbortController().signal),
      ).rejects.toThrow('PUBLIC_EXECUTION_UNAVAILABLE');
      expect(f.transport.openBinary).not.toHaveBeenCalled();
    }
    const f = visibleRunStorageFixture(),
      r = request();
    f.policy.limits.timeoutMs = 2000;
    f.policy.limits.outputBytes = 65536;
    f.policy.budgets.compilationMs = 20000;
    const intent = {
      ...r.work.intent,
      manifestDigest: visibleManifestDigest(f.manifest),
      policyDigest: visiblePolicyDigest(f.policy),
    };
    const unsupported = { ...r, work: prepareVisibleRunWork(f.run, intent, f.manifest, f.policy) },
      t = fixture();
    await expect(t.executor.execute(unsupported, new AbortController().signal)).rejects.toThrow();
    expect(t.transport.launch).not.toHaveBeenCalled();
  });
  it('does not launch when cancelled before or during binary verification', async () => {
    const f = fixture(),
      stop = new AbortController();
    stop.abort();
    await expect(f.executor.execute(request(), stop.signal)).rejects.toThrow();
    expect(f.transport.openBinary).not.toHaveBeenCalled();
    const g = fixture(),
      second = new AbortController();
    vi.mocked(g.transport.openBinary).mockImplementation(async () => {
      second.abort();
      return { fd: 42, close: g.close };
    });
    await expect(g.executor.execute(request(), second.signal)).rejects.toThrow();
    expect(g.transport.launch).not.toHaveBeenCalled();
    expect(g.close).toHaveBeenCalledOnce();
  });
  it('rejects noncanonical execution identity and non-RFC3339 deadline before opening a binary', async () => {
    const f = fixture(),
      r = request();
    await expect(
      f.executor.execute(
        { ...r, executionId: visibleRunStorageFixture().id },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    const intent = { ...r.work.intent, deadline: 'January 1, 2099' };
    await expect(
      f.executor.execute(
        { ...r, work: prepareVisibleRunWork(r.work.runId, intent, r.work.manifest, r.work.policy) },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(f.transport.openBinary).not.toHaveBeenCalled();
  });
  it('decodes whole bounded UTF8 bytes and allows Go escaped output beyond the decoded limit', async () => {
    const f = fixture(),
      { promise, r } = await begun(f),
      output = JSON.stringify(['😀' + '<'.repeat(64000)]),
      value = outcome(r, { output });
    const raw = Buffer.from(JSON.stringify(value).replaceAll('<', '\\u003c'));
    expect(raw.length).toBeGreaterThan(65536);
    const emoji = raw.indexOf(Buffer.from('😀'));
    f.child.stdout.write(raw.subarray(0, emoji + 1));
    f.child.stdout.write(raw.subarray(emoji + 1));
    f.child.finish();
    expect(((await promise) as { output: string }).output).toBe(output);
  });
  it.each([
    { runId: 'wrong' },
    { generation: 2 },
    { executionId: 'wrong' },
    { intentDigest: 'd'.repeat(64) },
    { state: 'passed' },
    { output: 'x'.repeat(65537) },
    { stoppedProof: 'bad' },
    { extra: 'unexpected' },
  ])('rejects unsafe/unbound output %#', async (patch) => {
    const f = fixture(),
      { promise, r } = await begun(f);
    f.child.reply(outcome(r, patch));
    await expect(promise).rejects.toThrow('PUBLIC_EXECUTION_UNAVAILABLE');
    expect(f.close).toHaveBeenCalledOnce();
  });
  it.each([
    'duplicate',
    'trailing',
    'truncated',
    'invalid-utf8',
    'null',
    'error-object',
    'nested',
    'raw-control',
  ])('rejects malformed protocol %s', async (kind) => {
    const f = fixture(),
      { promise, r } = await begun(f),
      valid = JSON.stringify(outcome(r));
    const raw =
      kind === 'duplicate'
        ? valid.replace('{', '{"state":"completed",')
        : kind === 'trailing'
          ? valid + '{}'
          : kind === 'truncated'
            ? valid.slice(0, -1)
            : kind === 'invalid-utf8'
              ? Buffer.from([255])
              : kind === 'null'
                ? 'null'
                : kind === 'error-object'
                  ? '{"error":"VISIBLE_RUN_UNAVAILABLE"}'
                  : kind === 'raw-control'
                    ? valid.replace('completed', 'comp\u0000leted')
                    : valid.replace('"output":"[\\"a\\"]"', '"output":[]');
    f.child.stdout.write(raw);
    f.child.finish();
    await expect(promise).rejects.toThrow();
  });
  it('strips infrastructure output but does not fabricate stop proof', async () => {
    const f = fixture(),
      { promise, r } = await begun(f);
    f.child.reply(
      outcome(r, { state: 'system_error', output: 'secret /host/path', stoppedProof: null }),
    );
    expect(await promise).toMatchObject({ state: 'system_error', output: '', stoppedProof: null });
  });
  it('awaits cooperative termination and drains valid cleanup response without automatic AbortSignal rejection', async () => {
    vi.useFakeTimers();
    const f = fixture(),
      stop = new AbortController(),
      { promise, r } = await begun(f, request(), stop.signal);
    let settled = false;
    void promise.finally(() => (settled = true));
    stop.abort();
    expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(15000);
    expect(settled).toBe(false);
    f.child.reply(outcome(r));
    expect(await promise).toMatchObject({ stoppedProof: 'c'.repeat(64) });
    expect(f.child.kill).not.toHaveBeenCalledWith('SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not leave escalation timers after synchronous cooperative close', async () => {
    vi.useFakeTimers();
    const f = fixture(),
      stop = new AbortController(),
      { promise, r } = await begun(f, request(), stop.signal);
    f.child.kill.mockImplementation(() => {
      f.child.reply(outcome(r));
      return true;
    });
    stop.abort();
    await promise;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not infer container cleanup from forced kill, exit, stderr or stream errors', async () => {
    vi.useFakeTimers();
    const f = fixture(),
      stop = new AbortController(),
      { promise } = await begun(f, request(), stop.signal);
    const rejection = expect(promise).rejects.toThrow();
    stop.abort();
    await vi.advanceTimersByTimeAsync(config.cleanupGraceMs + config.exitGraceMs);
    await rejection;
    expect(f.child.kill.mock.calls.map((v) => v[0])).toEqual(['SIGTERM', 'SIGKILL']);
    expect(f.close).toHaveBeenCalledOnce();
    for (const event of ['exit', 'stderr', 'stdin', 'stdout-error', 'stderr-error', 'spawn']) {
      const g = fixture(),
        { promise: pending, r } = await begun(g);
      if (event === 'stderr') g.child.stderr.write('secret');
      if (event === 'stdin') g.child.stdin.emit('error', new Error('secret'));
      if (event === 'stdout-error') g.child.stdout.emit('error', new Error('secret'));
      if (event === 'stderr-error') g.child.stderr.emit('error', new Error('secret'));
      if (event === 'spawn') g.child.emit('error', new Error('secret'));
      else {
        g.child.stdout.write(JSON.stringify(outcome(r)));
        g.child.finish(event === 'exit' ? 1 : 0);
      }
      await expect(pending).rejects.toThrow(/^PUBLIC_EXECUTION_UNAVAILABLE$/);
    }
  });
  it('bounds stdout and escalates only after the configured cleanup grace', async () => {
    vi.useFakeTimers();
    const f = fixture(),
      { promise } = await begun(f);
    const rejection = expect(promise).rejects.toThrow();
    f.child.stdout.write(Buffer.alloc(65536 * 6 + 4097, 65));
    expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(config.cleanupGraceMs);
    expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
    f.child.finish();
    await rejection;
  });
  it('stops on the immutable deadline and never extends it for cleanup', async () => {
    vi.useFakeTimers();
    const f = fixture(),
      r = request(),
      deadline = new Date(f.transport.now() + 100).toISOString(),
      intent = { ...r.work.intent, deadline };
    const short = {
      ...r,
      work: prepareVisibleRunWork(r.work.runId, intent, r.work.manifest, r.work.policy),
    };
    const { promise } = await begun(f, short);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
    f.child.reply(outcome(short, { state: 'system_error', output: '' }));
    await promise;
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([false, true])(
    'integrates with fenced worker; aborted=%s never records a late proof',
    async (aborted) => {
      const f = fixture(),
        r = request(),
        stop = new AbortController();
      const store: VisibleRunWorkerStore = {
        claim: vi.fn(async () => ({
          run: { intent: r.work.intent, record: { id: r.work.runId } },
          manifest: r.work.manifest,
          policy: r.work.policy,
          lease: {
            runId: r.work.runId,
            generation: r.generation,
            token: visibleRunStorageFixture().lease,
          },
          leaseExpiresAt: '2099-01-01T00:00:00Z',
        })),
        pulse: vi.fn(async () => ({
          kind: 'authorized' as const,
          state: 'running' as const,
          leaseExpiresAt: '2099-01-01T00:00:00Z',
        })),
        complete: vi.fn(async () => {}),
      };
      const delay = async (_ms: number, signal: AbortSignal) =>
        new Promise<void>((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }),
        );
      const pending = executeQueuedVisibleRun(
        { runId: r.work.runId, scope: r.work.intent.scope, generation: 0, state: 'queued' },
        { store, executor: f.executor, delay },
        stop.signal,
      );
      for (let i = 0; i < 10; i++) await Promise.resolve();
      if (aborted) stop.abort();
      f.child.reply(outcome(r));
      if (aborted) {
        expect(await pending).toMatchObject({
          kind: 'recovery_required',
          stoppedProof: 'c'.repeat(64),
        });
        expect(store.complete).not.toHaveBeenCalled();
      } else {
        expect(await pending).toMatchObject({ kind: 'recorded' });
        expect(store.complete).toHaveBeenCalledOnce();
        expect(vi.mocked(store.complete).mock.calls[0]![0].outcome.state).toBe('completed');
      }
    },
  );
});
