import { createHash } from 'node:crypto';
import { constants as C } from 'node:fs';
import * as realFs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  INVITATION_ROOT as ROOT,
  createNativeInvitationLoader,
  readNativeInvitationStartupAnchor,
  type NativeDescriptorFs,
  type NativeFileStat,
} from './runtime-protected-loader';
vi.mock('server-only', () => ({}));
const encode = (x: unknown) => new TextEncoder().encode(JSON.stringify(x));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
type Node = { s: NativeFileStat; children: Map<string, Node>; bytes: Uint8Array };
function fixture() {
  let ino = 0,
    fd = 10;
  const node = (directory: boolean, bytes: Uint8Array = new Uint8Array()): Node => ({
    s: {
      dev: 1n,
      ino: BigInt(++ino),
      uid: 1000n,
      mode: BigInt((directory ? 0o040000 : 0o100000) | (directory ? 0o700 : 0o600)),
      size: BigInt(bytes.length),
      nlink: directory ? 2n : 1n,
      mtimeNs: 1n,
      ctimeNs: 1n,
    },
    children: new Map(),
    bytes,
  });
  const tree = node(true),
    paths = new Map<string, Node>([['/', tree]]),
    fds = new Map<number, Node>(),
    opens: string[] = [];
  const add = (path: string, bytes?: Uint8Array) => {
    let at = tree,
      full = '';
    for (const [i, name] of path.split('/').slice(1).entries()) {
      full += '/' + name;
      let next = at.children.get(name);
      if (!next) {
        next = node(
          i < path.split('/').length - 2 || bytes === undefined,
          bytes ?? new Uint8Array(),
        );
        at.children.set(name, next);
        paths.set(full, next);
      }
      at = next;
    }
    return at;
  };
  const config = encode({ synthetic: true }),
    lock = encode({ files: [] }),
    creds = encode({ synthetic: 'public fake bytes' });
  const reviewed = {
    scopeSha256: 'a'.repeat(64),
    configurationSha256: hash(config),
    sourceLockSha256: hash(lock),
    reviewedHead: 'b'.repeat(40),
    lease: {
      ownerMessageId: 'Sentinel_' + 'c'.repeat(32),
      ownerApprovedAt: '2026-10-30T00:00:00Z',
      started: 1793318401000,
      deadline: 1793322001000,
      cleanupAt: 1793321821000,
      monotonicStarted: 1000,
      monotonicDeadline: 3601000,
      parentPid: 10,
      parentTicks: '1',
      guardPid: 11,
      guardTicks: '2',
    },
  };
  const anchor = encode({
    version: 1,
    profile: 'week1-auth-20261031-smtp1',
    root: ROOT,
    uid: 1000,
    reviewed,
    credentialsSha256: hash(creds),
  });
  add(ROOT + '/startup-anchor.json', anchor);
  add(ROOT + '/server-configuration.json', config);
  add(ROOT + '/adapter-code/week1-auth-source-lock.json', lock);
  add(ROOT + '/credentials.json', creds);
  add(ROOT + '/control.json', encode({ ...reviewed.lease, state: 'active' }));
  let onRead: (n: Node) => void = () => {};
  const fs: NativeDescriptorFs = {
    open(path, flags) {
      opens.push(path);
      let n: Node | undefined;
      if (path === '/') n = tree;
      else {
        const m = /^\/proc\/self\/fd\/([0-9]+)\/([^/]+)$/.exec(path);
        if (!m) throw new Error('absolute child open forbidden');
        n = fds.get(Number(m[1]))?.children.get(m[2]!);
      }
      if (!n || (n.s.mode & 0o170000n) === 0o120000n)
        throw new Error('synthetic symlink or missing');
      expect(flags & C.O_NOFOLLOW).toBe(C.O_NOFOLLOW);
      if (flags & C.O_DIRECTORY) expect(n.s.mode & 0o170000n).toBe(0o040000n);
      fds.set(++fd, n);
      return fd;
    },
    stat(fd) {
      const n = fds.get(fd);
      if (!n) throw new Error('closed');
      return { ...n.s };
    },
    read(fd, b, o, l, p) {
      const n = fds.get(fd)!;
      onRead(n);
      const part = n.bytes.subarray(p, p + Math.min(3, l));
      b.set(part, o);
      return part.length;
    },
    close(fd) {
      if (!fds.delete(fd)) throw new Error('double close');
    },
  };
  return {
    fs,
    paths,
    fds,
    opens,
    hash: hash(anchor),
    reviewed,
    readHook: (fn: typeof onRead) => {
      onRead = fn;
    },
  };
}
describe('Linux protected descriptor loader with fake kernel filesystem only', () => {
  it('holds each directory fd, reads bounded same-file bytes and snapshots the startup anchor once', async () => {
    const f = fixture(),
      anchor = readNativeInvitationStartupAnchor(f.hash, 1000, f.fs);
    const loader = createNativeInvitationLoader(anchor, f.fs);
    expect(Object.isFrozen(loader.reviewed)).toBe(true);
    expect(await loader.readCredentials()).toEqual({ synthetic: 'public fake bytes' });
    const input = await loader.load();
    expect(input.root.path).toBe(ROOT);
    expect(input.ancestors.at(-1)!.path).toBe(ROOT + '/adapter-code');
    expect(f.opens.every((p) => p === '/' || p.startsWith('/proc/self/fd/'))).toBe(true);
    const old = loader.reviewed;
    f.paths.get(ROOT + '/startup-anchor.json')!.bytes = encode({ changed: true });
    expect(loader.reviewed).toBe(old); // never silently reread/renew startup anchors
    expect(f.fds.size).toBe(0);
  });
  it.each(['symlink', 'hardlink', 'mode', 'owner', 'size'] as const)(
    'rejects unsafe file %s without leaking descriptors',
    (kind) => {
      const f = fixture(),
        n = f.paths.get(ROOT + '/startup-anchor.json')!;
      n.s = {
        ...n.s,
        ...{
          symlink: { mode: 0o120600n },
          hardlink: { nlink: 2n },
          mode: { mode: 0o100644n },
          owner: { uid: 999n },
          size: { size: 65537n },
        }[kind],
      };
      expect(() => readNativeInvitationStartupAnchor(f.hash, 1000, f.fs)).toThrow(
        'INVITATION_PROTECTED_INPUT_UNAVAILABLE',
      );
      expect(f.fds.size).toBe(0);
    },
  );
  it('rejects content metadata changes during a partial descriptor read', () => {
    const f = fixture();
    f.readHook((n) => {
      n.s = { ...n.s, ctimeNs: n.s.ctimeNs + 1n };
    });
    expect(() => readNativeInvitationStartupAnchor(f.hash, 1000, f.fs)).toThrow(
      'INVITATION_PROTECTED_INPUT_UNAVAILABLE',
    );
    expect(f.fds.size).toBe(0);
  });
  it('rejects parent-edge replacement despite a still-open old directory', () => {
    const f = fixture(),
      parent = f.paths.get(ROOT.slice(0, ROOT.lastIndexOf('/')))!;
    let once = false;
    f.readHook(() => {
      if (!once) {
        once = true;
        const old = parent.children.get('run-001')!;
        parent.children.set('run-001', { ...old, s: { ...old.s, ino: 99999n } });
      }
    });
    expect(() => readNativeInvitationStartupAnchor(f.hash, 1000, f.fs)).toThrow(
      'INVITATION_PROTECTED_INPUT_UNAVAILABLE',
    );
    expect(f.fds.size).toBe(0);
  });
  it('rejects digest mismatch and unbranded caller metadata', () => {
    const f = fixture();
    expect(() => readNativeInvitationStartupAnchor('0'.repeat(64), 1000, f.fs)).toThrow();
    expect(() =>
      createNativeInvitationLoader({ kind: 'native-invitation-startup-anchor' }, f.fs),
    ).toThrow();
    expect(f.fds.size).toBe(0);
  });
  it('rejects a replaced root identity after one-time startup capture', async () => {
    const f = fixture(),
      loader = createNativeInvitationLoader(
        readNativeInvitationStartupAnchor(f.hash, 1000, f.fs),
        f.fs,
      );
    const parent = f.paths.get(ROOT.slice(0, ROOT.lastIndexOf('/')))!;
    const old = parent.children.get('run-001')!;
    parent.children.set('run-001', { ...old, s: { ...old.s, ino: 99999n } });
    await expect(loader.readCredentials()).rejects.toThrow(
      'INVITATION_PROTECTED_INPUT_UNAVAILABLE',
    );
    expect(f.fds.size).toBe(0);
  });
  it('refuses changed credential bytes while retaining immutable startup bindings', async () => {
    const f = fixture(),
      loader = createNativeInvitationLoader(
        readNativeInvitationStartupAnchor(f.hash, 1000, f.fs),
        f.fs,
      );
    const n = f.paths.get(ROOT + '/credentials.json')!;
    n.bytes = encode({ synthetic: 'changed public fake bytes' });
    n.s = { ...n.s, size: BigInt(n.bytes.length) };
    await expect(loader.readCredentials()).rejects.toThrow(
      'INVITATION_PROTECTED_INPUT_UNAVAILABLE',
    );
    expect(f.fds.size).toBe(0);
  });
});

/** Real Linux kernel descriptors, remapped into one owned /tmp fixture.
 * Only open('/') is remapped. Every subsequent /proc/self/fd/... operation is
 * the actual Node API; no production-root path is ever opened or created. */
async function withRealDescriptorFixture<T>(
  test: (fixture: {
    fs: NativeDescriptorFs;
    uid: number;
    root: string;
    anchorBytes: Uint8Array;
    anchorHash: string;
    opened: Set<number>;
    onRead(fn: () => void): void;
  }) => Promise<T> | T,
): Promise<T> {
  expect(realFs.realpathSync('/tmp')).toBe('/tmp');
  const temporary = realFs.mkdtempSync('/tmp/nextera-native-loader-test-');
  realFs.chmodSync(temporary, 0o700);
  const original = realFs.lstatSync(temporary, { bigint: true });
  const uid = process.getuid!();
  const root = path.join(temporary, ROOT.slice(1));
  const opened = new Set<number>();
  try {
    realFs.mkdirSync(path.join(root, 'adapter-code'), { recursive: true, mode: 0o700 });
    const config = encode({ synthetic: true }),
      lock = encode({ files: [] });
    const credentials = encode({ synthetic: 'public fake bytes' });
    const reviewed = fixture().reviewed;
    const anchorBytes = encode({
      version: 1,
      profile: 'week1-auth-20261031-smtp1',
      root: ROOT,
      uid,
      reviewed,
      credentialsSha256: hash(credentials),
    });
    for (const [name, bytes] of [
      ['startup-anchor.json', anchorBytes],
      ['server-configuration.json', config],
      ['adapter-code/week1-auth-source-lock.json', lock],
      ['credentials.json', credentials],
      ['control.json', encode({ ...reviewed.lease, state: 'active' })],
    ] as const)
      realFs.writeFileSync(path.join(root, name), bytes, { flag: 'wx', mode: 0o600 });
    let afterRead = () => {};
    const fs: NativeDescriptorFs = {
      open(name, flags) {
        expect(name === '/' || /^\/proc\/self\/fd\/[0-9]+\/[^/]+$/.test(name)).toBe(true);
        const fd = realFs.openSync(name === '/' ? temporary : name, flags);
        opened.add(fd);
        return fd;
      },
      stat(fd) {
        return realFs.fstatSync(fd, { bigint: true });
      },
      read(fd, buffer, offset, length, position) {
        const count = realFs.readSync(fd, buffer, offset, Math.min(length, 17), position);
        afterRead();
        return count;
      },
      close(fd) {
        realFs.closeSync(fd);
        opened.delete(fd);
      },
    };
    return await test({
      fs,
      uid,
      root,
      anchorBytes,
      anchorHash: hash(anchorBytes),
      opened,
      onRead(fn) {
        afterRead = fn;
      },
    });
  } finally {
    const leaked = opened.size;
    for (const fd of opened) realFs.closeSync(fd);
    // Delete only this unchanged, owned synthetic fixture. Never derive cleanup
    // from production ROOT, a symlink target, source configuration or test input.
    const current = realFs.lstatSync(temporary, { bigint: true });
    const resolved = realFs.realpathSync(temporary);
    expect(current.isDirectory() && !current.isSymbolicLink()).toBe(true);
    expect(current.uid).toBe(BigInt(uid));
    expect(current.dev).toBe(original.dev);
    expect(current.ino).toBe(original.ino);
    expect(resolved).toBe(temporary);
    expect(path.dirname(resolved)).toBe('/tmp');
    expect(path.basename(resolved).startsWith('nextera-native-loader-test-')).toBe(true);
    realFs.rmSync(resolved, { recursive: true });
    expect(leaked).toBe(0);
  }
}
describe.skipIf(process.platform !== 'linux')(
  'real Node Linux descriptors in owned synthetic /tmp only',
  () => {
    it('reads the mirrored fixture through real held descriptor-relative operations', async () => {
      await withRealDescriptorFixture(async (f) => {
        const anchor = readNativeInvitationStartupAnchor(f.anchorHash, f.uid, f.fs);
        const loader = createNativeInvitationLoader(anchor, f.fs);
        expect(await loader.readCredentials()).toEqual({ synthetic: 'public fake bytes' });
        const input = await loader.load();
        expect(input.root.path).toBe(ROOT);
        expect(input.root.stat.uid).toBe(f.uid);
        expect(f.opened.size).toBe(0);
      });
    });
    it('refuses a real symlink leaf with O_NOFOLLOW', async () => {
      await withRealDescriptorFixture((f) => {
        const anchor = path.join(f.root, 'startup-anchor.json');
        realFs.renameSync(anchor, anchor + '.owned-target');
        realFs.symlinkSync(anchor + '.owned-target', anchor);
        expect(() => readNativeInvitationStartupAnchor(f.anchorHash, f.uid, f.fs)).toThrow(
          'INVITATION_PROTECTED_INPUT_UNAVAILABLE',
        );
        expect(f.opened.size).toBe(0);
      });
    });
    it('refuses a real hardlinked anchor by native link count', async () => {
      await withRealDescriptorFixture((f) => {
        const anchor = path.join(f.root, 'startup-anchor.json');
        realFs.linkSync(anchor, path.join(f.root, 'owned-anchor-hardlink'));
        expect(() => readNativeInvitationStartupAnchor(f.anchorHash, f.uid, f.fs)).toThrow(
          'INVITATION_PROTECTED_INPUT_UNAVAILABLE',
        );
        expect(f.opened.size).toBe(0);
      });
    });
    it('detects an actual parent replacement while old directory descriptors remain open', async () => {
      await withRealDescriptorFixture((f) => {
        let once = false;
        f.onRead(() => {
          if (once) return;
          once = true;
          realFs.renameSync(f.root, f.root + '-owned-moved');
          realFs.mkdirSync(f.root, { mode: 0o700 });
          realFs.writeFileSync(path.join(f.root, 'startup-anchor.json'), f.anchorBytes, {
            flag: 'wx',
            mode: 0o600,
          });
        });
        expect(() => readNativeInvitationStartupAnchor(f.anchorHash, f.uid, f.fs)).toThrow(
          'INVITATION_PROTECTED_INPUT_UNAVAILABLE',
        );
        expect(f.opened.size).toBe(0);
      });
    });
  },
);

it('rejects an exactly rehashed closed-profile startup anchor using only fake descriptors', () => {
  for (const change of [
    { profile: 'week1-auth-20261030-invitation1' },
    { root: '/home/anas/.local/share/nextera-judge/week1-auth-20261030-invitation1/run-002' },
  ]) {
    const f = fixture(),
      n = f.paths.get(ROOT + '/startup-anchor.json')!;
    const old = { ...JSON.parse(new TextDecoder().decode(n.bytes)), ...change };
    n.bytes = encode(old);
    n.s = { ...n.s, size: BigInt(n.bytes.length) };
    expect(() => readNativeInvitationStartupAnchor(hash(n.bytes), 1000, f.fs)).toThrow(
      'INVITATION_PROTECTED_INPUT_UNAVAILABLE',
    );
    expect(f.fds.size).toBe(0);
  }
});

it('imports only public source bindings without private selectors or native ports', async () => {
  const never = vi.fn(() => {
    throw new Error('Unexpected native import action');
  });
  const originalEnvironment = process.env;
  const privateSelectors = new Set([
    'DATABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXTERA_WEEK1_INVITATION_STARTUP_SHA256',
    'NEXTERA_WEEK1_AUTH_PROFILE',
  ]);
  vi.resetModules();
  vi.doMock('node:fs', () => ({
    constants: C,
    openSync: never,
    fstatSync: never,
    readSync: never,
    readFileSync: never,
    closeSync: never,
  }));
  vi.doMock('postgres', () => {
    throw new Error('DB module imported');
  });
  vi.doMock('@supabase/supabase-js', () => {
    throw new Error('Provider module imported');
  });
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(never);
  process.env = new Proxy(originalEnvironment, {
    get(target, key) {
      if (typeof key === 'string' && privateSelectors.has(key))
        throw new Error('Private selector read');
      return Reflect.get(target, key);
    },
  });
  try {
    const core = await import('./runtime-configuration-core');
    const loader = await import('./runtime-protected-loader');
    expect(loader.INVITATION_ROOT).toBe(core.INVITATION_RUNTIME_SOURCE_BINDING.target.root);
    expect(Object.isFrozen(core.INVITATION_RUNTIME_SOURCE_BINDING.target.roles)).toBe(true);
    expect(never).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally {
    process.env = originalEnvironment;
    network.mockRestore();
    vi.doUnmock('node:fs');
    vi.doUnmock('postgres');
    vi.doUnmock('@supabase/supabase-js');
    vi.resetModules();
  }
});
