import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  createNativeInvitationDependenciesResolver,
  type NativeInvitationSources,
} from './runtime-native-binding';
import type { NativeInvitationStartupAnchor } from './runtime-protected-loader';
function fixture() {
  const handle = { kind: 'native-invitation-startup-anchor' } as NativeInvitationStartupAnchor;
  const loader = {
    uid: 1000,
    reviewed: {
      scopeSha256: 'a'.repeat(64),
      sourceLockSha256: 'b'.repeat(64),
      reviewedHead: 'c'.repeat(40),
      configurationSha256: 'd'.repeat(64),
      lease: {
        ownerMessageId: 'Sentinel_' + 'e'.repeat(32),
        ownerApprovedAt: '2026-10-30T00:00:00.000001+00:00',
        started: 1793318400001,
        deadline: 1793322000001,
        cleanupAt: 1793321820001,
        monotonicStarted: 1000,
        monotonicDeadline: 3601000,
        parentPid: 10,
        parentTicks: '100',
        guardPid: 11,
        guardTicks: '101',
      },
    },
    load: vi.fn(),
    readCredentials: vi.fn(),
  };
  const acquire = vi.fn(),
    process = vi.fn();
  const s: NativeInvitationSources = {
    startupDigest: vi.fn(() => 'f'.repeat(64)),
    platform: () => 'linux',
    uid: () => 1000,
    anchor: vi.fn(() => handle),
    loader: vi.fn(() => loader),
    clients: vi.fn(() => acquire),
    processes: vi.fn(() => process),
    now: () => 1000000,
    monotonic: () => 2000000,
  };
  return { s, handle, loader, acquire, process };
}
describe('native dependency composition — fake factories, no protected/profile I/O', () => {
  it.each(['absent', 'invalid', 'platform', 'uid'] as const)(
    'keeps %s startup disabled before any private read',
    (kind) => {
      const f = fixture();
      const s = {
        ...f.s,
        ...(kind === 'absent'
          ? { startupDigest: () => undefined }
          : kind === 'invalid'
            ? { startupDigest: () => 'not-a-digest' }
            : kind === 'platform'
              ? { platform: () => 'win32' }
              : { uid: () => undefined }),
      };
      const resolve = createNativeInvitationDependenciesResolver(s);
      return resolve().then((v) => {
        expect(v).toBeNull();
        expect(s.anchor).not.toHaveBeenCalled();
        expect(s.clients).not.toHaveBeenCalled();
      });
    },
  );
  it('captures only the original public digest and anchor, with no construction I/O', async () => {
    const f = fixture();
    let digest = 'f'.repeat(64);
    f.s = { ...f.s, startupDigest: () => digest };
    const resolve = createNativeInvitationDependenciesResolver(f.s);
    expect(f.s.anchor).not.toHaveBeenCalled();
    digest = 'a'.repeat(64);
    const first = await resolve(),
      second = await resolve();
    expect(first).toBe(second);
    expect(f.s.anchor).toHaveBeenCalledExactlyOnceWith('f'.repeat(64), 1000);
    expect(f.s.clients).toHaveBeenCalledTimes(1);
    expect(f.loader.load).not.toHaveBeenCalled();
    expect(f.loader.readCredentials).not.toHaveBeenCalled();
    expect(first?.acquireClients).toBe(f.acquire);
    expect(Object.isFrozen(first)).toBe(true);
  });
  it('binds concrete RPC functions and boot-monotonic clock explicitly', async () => {
    const f = fixture();
    const result = await createNativeInvitationDependenciesResolver(f.s)();
    expect(f.s.clients).toHaveBeenCalledWith(
      expect.objectContaining({
        loader: f.loader,
        now: f.s.now,
        monotonic: f.s.monotonic,
        rpc: expect.objectContaining({
          readInvitationRuntimePolicyRows: expect.any(Function),
          readInvitationRuntimeAuthorityRows: expect.any(Function),
          consumeInvitationRuntimeIssuer: expect.any(Function),
          consumeInvitationRuntimeIssueIngress: expect.any(Function),
        }),
      }),
    );
    expect(result?.process).toBe(f.process);
    expect(f.s.processes).toHaveBeenCalledWith(1000, f.loader.reviewed.lease);
  });
  it('never silently retries a failed anchor read in the same process', async () => {
    const f = fixture();
    vi.mocked(f.s.anchor).mockImplementationOnce(() => {
      throw new Error('private file missing');
    });
    const resolve = createNativeInvitationDependenciesResolver(f.s);
    expect(await resolve()).toBeNull();
    expect(await resolve()).toBeNull();
    expect(f.s.anchor).toHaveBeenCalledTimes(1);
    expect(f.s.clients).not.toHaveBeenCalled();
  });
  it('rejects a different UID without creating clients', async () => {
    const f = fixture();
    vi.mocked(f.s.loader).mockReturnValueOnce({ ...f.loader, uid: 0 });
    expect(await createNativeInvitationDependenciesResolver(f.s)()).toBeNull();
    expect(f.s.clients).not.toHaveBeenCalled();
  });
});
