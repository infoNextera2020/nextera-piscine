import { describe, expect, it, vi } from 'vitest';
import { CheckpointEditorSession } from './editor-session';
import { EditorRecoveryStore, recoveryKey } from './editor-recovery';
import { parseEditorBootstrap, type EditorBootstrap } from './editor-bootstrap';
import { sendDraftIntent, type DraftWriteOutcome } from './editor-sync';
const learnerId = '00000000-0000-4000-8000-000000000001',
  cohortId = '00000000-0000-4000-8000-000000000002',
  attemptId = '00000000-0000-4000-8000-000000000003',
  requestId = '00000000-0000-4000-8000-000000000004';
const digest = 'a'.repeat(64),
  serverNow = '2026-10-27T10:00:00Z',
  deadline = '2026-10-27T11:00:00Z';
function boot(taskKey = 'a', policy = false): EditorBootstrap {
  return {
    schema: 1,
    window: {
      scope: { learnerId, cohortId, attemptId, taskKey, definitionDigest: digest },
      access: 'confirmed',
      attempt: 'active',
      serverNow,
      deadline,
      capabilities: { draftsV1: true, officialSubmit: false, visibleRun: null },
    },
    filename: 'answer.go',
    sourceBytes: 1024,
    draft: { source: 'server ' + taskKey, version: 1, requestId },
    offlineRecovery: policy ? { retentionMs: 60000 } : null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup(policy = false) {
  let now = 0,
    sequence = 0;
  const timers = new Map<number, () => void>(),
    stored = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => stored.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      stored.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      stored.delete(key);
    }),
  };
  const load = vi.fn(async (expected: { taskKey: string }) => ({
    kind: 'available' as const,
    bootstrap: boot(expected.taskKey, policy),
  }));
  const write = vi.fn<typeof sendDraftIntent>(
      async () => ({ kind: 'saved', version: 2 }) as DraftWriteOutcome,
    ),
    accessRemoved = vi.fn();
  const deps = {
    now: () => now,
    requestId: () => requestId,
    load,
    write,
    schedule: (fn: () => void) => {
      timers.set(++sequence, fn);
      return sequence;
    },
    cancel: (timer: unknown) => {
      timers.delete(timer as number);
    },
    recovery: new EditorRecoveryStore(() => storage),
    accessRemoved,
  };
  const make = () => new CheckpointEditorSession({ learnerId, cohortId, attemptId }, deps),
    session = make();
  session.setAvailability(false, false, { serverNow, deadline, active: true });
  return {
    session,
    make,
    deps,
    load,
    write,
    stored,
    storage,
    accessRemoved,
    timers,
    clock: (n: number) => {
      now = n;
    },
    flush: async () => {
      const list = [...timers.values()];
      timers.clear();
      list.forEach((f) => f());
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}
describe('Checkpoint component lifecycle owner', () => {
  it('retains separate buffers when freely switching questions', async () => {
    const f = setup();
    await f.session.load('a');
    f.session.edit('a', 'local a');
    await f.session.load('b');
    f.session.edit('b', 'local b');
    await f.session.load('a');
    expect(f.session.getSnapshot().a!.source).toBe('local a');
    expect(f.session.getSnapshot().b!.source).toBe('local b');
    expect(f.load).toHaveBeenCalledTimes(2);
  });
  it('preserves edits made before bootstrap completes', async () => {
    const f = setup(),
      pending = deferred<Awaited<ReturnType<typeof f.load>>>();
    f.load.mockReturnValue(pending.promise);
    const read = f.session.load('a');
    f.session.edit('a', 'typed while loading');
    pending.resolve({ kind: 'available', bootstrap: boot() });
    await read;
    expect(f.session.getSnapshot().a!.source).toBe('typed while loading');
  });
  it('ignores an older bootstrap response after a replacement request', async () => {
    const f = setup(),
      old = deferred<Awaited<ReturnType<typeof f.load>>>();
    f.load.mockReturnValueOnce(old.promise);
    const first = f.session.load('a');
    await f.session.load('a', true);
    f.session.edit('a', 'latest');
    old.resolve({
      kind: 'available',
      bootstrap: { ...boot(), draft: { source: 'stale', version: 1, requestId } },
    });
    await first;
    expect(f.session.getSnapshot().a!.source).toBe('latest');
  });
  it('suppresses a bootstrap response after unmount/reactivation', async () => {
    const f = setup(),
      old = deferred<Awaited<ReturnType<typeof f.load>>>();
    f.load.mockReturnValueOnce(old.promise);
    const read = f.session.load('a');
    f.session.dispose();
    f.session.activate();
    await f.session.load('b');
    old.resolve({ kind: 'available', bootstrap: boot() });
    await read;
    expect(f.session.getSnapshot()).not.toHaveProperty('a');
    expect(f.session.getSnapshot()).toHaveProperty('b');
  });
  it('publishes saving/saved and leaves later edits unsaved until their own acknowledgement', async () => {
    const f = setup();
    await f.session.load('a');
    const waiting = deferred<DraftWriteOutcome>();
    f.write.mockReturnValueOnce(waiting.promise);
    f.session.edit('a', 'one');
    const save = f.session.save('a');
    expect(f.session.getSnapshot().a!.status).toBe('saving');
    f.session.edit('a', 'two');
    waiting.resolve({ kind: 'saved', version: 2 });
    await save;
    expect(f.session.getSnapshot().a).toMatchObject({ source: 'two', status: 'unsaved' });
    f.write.mockResolvedValue({ kind: 'saved', version: 3 });
    await f.flush();
    expect(f.session.getSnapshot().a!.status).toBe('saved');
  });
  it('shows failed uncertainty and retries the exact old source before later edits', async () => {
    const f = setup();
    await f.session.load('a');
    f.write.mockResolvedValueOnce({ kind: 'uncertain', reason: 'network' });
    f.session.edit('a', 'first');
    await f.session.save('a');
    expect(f.session.getSnapshot().a!.status).toBe('failed');
    const original = f.write.mock.calls[0];
    f.session.edit('a', 'later');
    await f.session.save('a');
    expect(f.write.mock.calls[1]).toEqual(original);
    expect(f.session.getSnapshot().a!.source).toBe('later');
  });
  it('requires explicit conflict resolution and never overwrites on reconnect', async () => {
    const f = setup();
    await f.session.load('a');
    f.write.mockResolvedValue({ kind: 'conflict', source: 'newer remote', version: 3 });
    f.session.edit('a', 'local');
    await f.session.save('a');
    await f.session.load('a', true);
    expect(f.session.getSnapshot().a).toMatchObject({
      source: 'local',
      status: 'conflict',
      conflict: { source: 'newer remote' },
    });
    expect(f.write).toHaveBeenCalledTimes(1);
    f.session.resolve('a', 'use_server');
    expect(f.session.getSnapshot().a).toMatchObject({ source: 'newer remote', status: 'saved' });
  });
  it('explicit keep-local choice saves against the acknowledged server version', async () => {
    const f = setup();
    await f.session.load('a');
    f.write.mockResolvedValueOnce({ kind: 'conflict', source: 'remote', version: 3 });
    f.session.edit('a', 'local');
    await f.session.save('a');
    f.session.resolve('a', 'keep_local');
    f.write.mockResolvedValue({ kind: 'saved', version: 4 });
    await f.flush();
    expect(f.write.mock.calls.at(-1)![0]).toMatchObject({ source: 'local', baseVersion: 3 });
  });
  it('pauses writes during a failed outer read without discarding an editable draft', async () => {
    const f = setup(true);
    await f.session.load('a');
    f.session.setAvailability(true, false, { serverNow, deadline, active: true });
    f.session.edit('a', 'offline edit');
    await f.flush();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().a!.source).toBe('offline edit');
    expect(f.stored.size).toBe(1);
  });
  it('cancels debounced saves and recovery at the deadline', async () => {
    const f = setup(true);
    await f.session.load('a');
    f.session.edit('a', 'local');
    f.session.setAvailability(false, true, { serverNow: deadline, deadline, active: true });
    await f.flush();
    await f.session.save('a');
    expect(f.write).not.toHaveBeenCalled();
    expect(f.stored.size).toBe(0);
    expect(f.session.getSnapshot().a!.status).toBe('closed');
  });
  it('does not schedule endless retries when its own monotonic deadline closes', async () => {
    const f = setup();
    await f.session.load('a');
    f.session.edit('a', 'local');
    f.clock(3600001);
    await f.flush();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.timers.size).toBe(0);
  });
  it('older repeated hints cannot extend the original monotonic deadline', async () => {
    const f = setup();
    await f.session.load('a');
    f.clock(3599000);
    f.session.setAvailability(false, false, { serverNow, deadline, active: true });
    f.session.edit('a', 'last second');
    f.clock(3600001);
    await f.session.save('a');
    expect(f.write).not.toHaveBeenCalled();
  });
  it('purges known recovery scopes and ignores late saves on access removal', async () => {
    const f = setup(true);
    await f.session.load('a');
    f.session.edit('a', 'local');
    const waiting = deferred<DraftWriteOutcome>();
    f.write.mockReturnValueOnce(waiting.promise);
    const save = f.session.save('a');
    f.load.mockResolvedValueOnce({ kind: 'blocked', reason: 'removed' } as never);
    await f.session.load('a', true);
    waiting.resolve({ kind: 'saved', version: 2 });
    await save;
    expect(f.session.getSnapshot()).toEqual({});
    expect(f.stored.size).toBe(0);
    expect(f.accessRemoved).toHaveBeenCalledOnce();
  });
  it('keeps a page-memory fallback when the real adapter returns unavailable', async () => {
    const f = setup();
    f.load.mockResolvedValue({ kind: 'blocked', reason: 'unavailable' } as never);
    f.session.edit('a', 'page only');
    await f.session.load('a');
    await f.flush();
    expect(f.session.getSnapshot().a).toMatchObject({ source: 'page only', phase: 'unavailable' });
    expect(f.write).not.toHaveBeenCalled();
  });
});
describe('Explicit-policy same-device recovery', () => {
  it('does not touch source storage without an explicit retention capability', async () => {
    const f = setup();
    await f.session.load('a');
    f.session.edit('a', 'secret draft');
    await f.session.save('a');
    expect(f.storage.getItem).not.toHaveBeenCalled();
    expect(f.storage.setItem).not.toHaveBeenCalled();
    expect(boot().offlineRecovery).toBeNull();
  });
  it('keeps an unexpired draft on normal unmount and requires an explicit restore choice on reload', async () => {
    const f = setup(true);
    await f.session.load('a');
    f.session.edit('a', 'device source');
    f.session.dispose();
    expect(f.stored.size).toBe(1);
    const again = f.make();
    again.setAvailability(false, false, { serverNow, deadline, active: true });
    await again.load('a');
    expect(again.getSnapshot().a).toMatchObject({
      source: 'server a',
      recovery: { source: 'device source' },
    });
    expect(f.write).not.toHaveBeenCalled();
    again.chooseRecovery('a', 'use_device');
    expect(again.getSnapshot().a!.source).toBe('device source');
  });
  it('flags a changed server version and does not silently resync a cached draft', async () => {
    const f = setup(true);
    await f.session.load('a');
    f.session.edit('a', 'device');
    f.session.dispose();
    const again = f.make();
    again.setAvailability(false, false, { serverNow, deadline, active: true });
    f.load.mockResolvedValue({
      kind: 'available',
      bootstrap: { ...boot('a', true), draft: { source: 'new server', version: 4, requestId } },
    });
    await again.load('a');
    expect(again.getSnapshot().a).toMatchObject({
      source: 'new server',
      recovery: { conflict: true, source: 'device' },
    });
    await f.flush();
    expect(f.write).not.toHaveBeenCalled();
    again.chooseRecovery('a', 'keep_current');
    expect(again.getSnapshot().a!.source).toBe('new server');
  });
  it.each(['learnerId', 'cohortId', 'attemptId', 'taskKey', 'definitionDigest'] as const)(
    'rejects recovery under the wrong %s',
    (key) => {
      const f = setup(true),
        b = boot('a', true);
      const local = {
        schema: 1,
        scope: { ...b.window.scope, [key]: 'different' },
        source: 'foreign',
        baseVersion: 1,
        expiresAt: '2026-10-27T10:01:00Z',
      };
      f.stored.set(recoveryKey(b.window.scope), JSON.stringify(local));
      expect(f.deps.recovery.read(b.window, { source: 'server', version: 1 }, 1024)).toBeNull();
      expect(f.stored.size).toBe(0);
    },
  );
  it.each([
    'bad json',
    '{}',
    JSON.stringify({
      schema: 1,
      scope: boot().window.scope,
      source: 'expired',
      baseVersion: 1,
      expiresAt: serverNow,
    }),
  ])('removes malformed/expired recovery without exposing it', (raw) => {
    const f = setup(true),
      b = boot();
    f.stored.set(recoveryKey(b.window.scope), raw);
    expect(f.deps.recovery.read(b.window, { source: 'server', version: 1 }, 1024)).toBeNull();
    expect(f.stored.size).toBe(0);
  });
  it('fails safely when browser source storage is disabled', () => {
    const store = new EditorRecoveryStore(() => {
      throw new Error('disabled');
    });
    expect(store.read(boot().window, { source: '', version: 0 }, 1024)).toBeNull();
    expect(
      store.write(
        {
          schema: 1,
          scope: boot().window.scope,
          source: 'local',
          baseVersion: 0,
          expiresAt: deadline,
        },
        1024,
      ),
    ).toBe(false);
  });
  it('accepts a configured positive policy but rejects invalid settings without choosing defaults', () => {
    expect(parseEditorBootstrap(boot('a', true), boot().window.scope).offlineRecovery).toEqual({
      retentionMs: 60000,
    });
    for (const retentionMs of [0, -1, NaN, 1.5, '60000'])
      expect(() =>
        parseEditorBootstrap({ ...boot(), offlineRecovery: { retentionMs } }, boot().window.scope),
      ).toThrow();
  });
});

describe('Draftless official bootstrap stays honest', () => {
  function noDrafts(taskKey = 'a') {
    const value = boot(taskKey);
    return {
      ...value,
      draft: null,
      offlineRecovery: null,
      window: {
        ...value.window,
        capabilities: { draftsV1: false, officialSubmit: true, visibleRun: null },
      },
    };
  }
  it('preserves page buffers but labels autosave unavailable and performs no write/recovery', async () => {
    const f = setup();
    f.load.mockResolvedValue({ kind: 'available', bootstrap: noDrafts() } as never);
    f.session.edit('a', 'page-only code');
    await f.session.load('a');
    expect(f.session.getSnapshot().a).toMatchObject({
      phase: 'unavailable',
      source: 'page-only code',
      localStatus: 'disabled',
      recovery: null,
    });
    f.session.edit('a', 'new page-only code');
    await f.session.save('a');
    await f.flush();
    expect(f.session.getSnapshot().a!.source).toBe('new page-only code');
    expect(f.write).not.toHaveBeenCalled();
    expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it('retains existing local source when draft capability is withdrawn', async () => {
    const f = setup();
    await f.session.load('a');
    f.session.edit('a', 'local draft');
    f.load.mockResolvedValueOnce({ kind: 'available', bootstrap: noDrafts() } as never);
    await f.session.load('a', true);
    await f.flush();
    expect(f.session.getSnapshot().a).toMatchObject({
      phase: 'unavailable',
      source: 'local draft',
      localStatus: 'disabled',
    });
    expect(f.write).not.toHaveBeenCalled();
  });
  it('rejects a changed immutable definition even when neither bootstrap supports drafts', async () => {
    const f = setup();
    f.load.mockResolvedValueOnce({ kind: 'available', bootstrap: noDrafts() } as never);
    await f.session.load('a');
    const next = noDrafts();
    f.load.mockResolvedValueOnce({
      kind: 'available',
      bootstrap: {
        ...next,
        window: {
          ...next.window,
          scope: { ...next.window.scope, definitionDigest: 'b'.repeat(64) },
        },
      },
    } as never);
    await f.session.load('a', true);
    expect(f.accessRemoved).toHaveBeenCalledTimes(1);
  });
});
