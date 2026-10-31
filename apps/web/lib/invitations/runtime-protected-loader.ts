import 'server-only';
import * as nodeFs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  INVITATION_RUNTIME_SOURCE_BINDING,
  type ProtectedInput,
  type ReviewedInvitationBinding,
} from './runtime-configuration-core';

export const INVITATION_ROOT = INVITATION_RUNTIME_SOURCE_BINDING.target.root;
export type NativeFileStat = Readonly<{
  dev: bigint;
  ino: bigint;
  uid: bigint;
  mode: bigint;
  size: bigint;
  nlink: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}>;
export type NativeDescriptorFs = Readonly<{
  open(path: string, flags: number): number;
  stat(fd: number): NativeFileStat;
  read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
  close(fd: number): void;
}>;
const nativeFs: NativeDescriptorFs = {
  open: (path, flags) => nodeFs.openSync(path, flags),
  stat: (fd) => nodeFs.fstatSync(fd, { bigint: true }),
  read: (fd, b, o, n, p) => nodeFs.readSync(fd, b, o, n, p),
  close: (fd) => nodeFs.closeSync(fd),
};
const C = nodeFs.constants;
const DIRECTORY = C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW;
const FILE = C.O_RDONLY | C.O_NOFOLLOW;
const HASH = /^[a-f0-9]{64}$/;
const fail = (): never => {
  throw new Error('INVITATION_PROTECTED_INPUT_UNAVAILABLE');
};
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function same(a: NativeFileStat, b: NativeFileStat, content = false) {
  const keys: (keyof NativeFileStat)[] = ['dev', 'ino', 'uid', 'mode', 'nlink'];
  if (content) keys.push('size', 'mtimeNs', 'ctimeNs');
  return keys.every((k) => a[k] === b[k]);
}
function directory(s: NativeFileStat, uid: number, privateDirectory: boolean) {
  if (
    (s.mode & 0o170000n) !== 0o040000n ||
    s.nlink < 2n ||
    s.ino <= 0n ||
    (s.uid !== 0n && s.uid !== BigInt(uid)) ||
    (s.mode & 0o022n) !== 0n ||
    (privateDirectory && (s.uid !== BigInt(uid) || (s.mode & 0o7777n) !== 0o700n))
  )
    fail();
}
function file(s: NativeFileStat, uid: number) {
  if (
    (s.mode & 0o170000n) !== 0o100000n ||
    s.uid !== BigInt(uid) ||
    (s.mode & 0o7777n) !== 0o600n ||
    s.nlink !== 1n ||
    s.ino <= 0n ||
    s.size <= 0n ||
    s.size > 65536n
  )
    fail();
}
function publicStat(s: NativeFileStat, kind: 'file' | 'directory') {
  const uid = Number(s.uid);
  if (!Number.isSafeInteger(uid)) fail();
  return { uid, mode: Number(s.mode & 0o7777n), kind };
}
type Held = { fd: number; path: string; stat: NativeFileStat; parent: number | null; leaf: string };
/** Node has no openat. Every relative open below goes through an already held
 * directory descriptor, never a mutable absolute path. O_NOFOLLOW protects each
 * leaf; O_DIRECTORY protects directory components. /proc/self/fd is the kernel
 * descriptor namespace, deliberately followed only for the held parent fd.
 * Re-open every parent/leaf edge before release to detect rename/replacement.
 * fstat/read/fstat on one descriptor prevents check-then-open and size races. */
function readProtected(path: string, uid: number, fs: NativeDescriptorFs) {
  if (
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    !path.startsWith(INVITATION_ROOT + '/') ||
    ![
      'server-configuration.json',
      'control.json',
      'credentials.json',
      'startup-anchor.json',
      'adapter-code/week1-auth-source-lock.json',
    ].includes(path.slice(INVITATION_ROOT.length + 1))
  )
    fail();
  const parts = path.split('/').slice(1),
    held: Held[] = [];
  const opened: number[] = [];
  try {
    let fd = fs.open('/', DIRECTORY);
    opened.push(fd);
    let stat = fs.stat(fd);
    directory(stat, uid, false);
    held.push({ fd, path: '/', stat, parent: null, leaf: '' });
    for (let i = 0; i < parts.length; i++) {
      const leaf = parts[i]!;
      if (!/^[A-Za-z0-9._-]+$/.test(leaf) || leaf === '.' || leaf === '..') fail();
      const parent = fd,
        absolute = '/' + parts.slice(0, i + 1).join('/');
      const last = i === parts.length - 1;
      fd = fs.open('/proc/self/fd/' + parent + '/' + leaf, last ? FILE : DIRECTORY);
      opened.push(fd);
      stat = fs.stat(fd);
      if (last) file(stat, uid);
      else
        directory(
          stat,
          uid,
          absolute === INVITATION_ROOT || absolute.startsWith(INVITATION_ROOT + '/'),
        );
      held.push({ fd, path: absolute, stat, parent, leaf });
    }
    const leaf = held.at(-1)!;
    // Allocate only after the descriptor's bounded size is verified.
    const bytes = new Uint8Array(Number(leaf.stat.size));
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.read(leaf.fd, bytes, offset, bytes.length - offset, offset);
      if (!Number.isSafeInteger(n) || n <= 0 || n > bytes.length - offset) fail();
      offset += n;
    }
    if (!same(leaf.stat, fs.stat(leaf.fd), true)) fail();
    for (const item of held) {
      if (!same(item.stat, fs.stat(item.fd), item === leaf)) fail();
      if (item.parent !== null) {
        const check = fs.open(
          '/proc/self/fd/' + item.parent + '/' + item.leaf,
          item === leaf ? FILE : DIRECTORY,
        );
        opened.push(check);
        if (!same(item.stat, fs.stat(check), item === leaf)) fail();
      }
    }
    const directories = held.filter((h) => h !== leaf);
    const rootIdentity = held.find((h) => h.path === INVITATION_ROOT)?.stat;
    if (!rootIdentity) return fail();
    return {
      rootIdentity,
      file: { path, bytes, stat: publicStat(leaf.stat, 'file') },
      directories: directories.map((h) => ({
        path: h.path,
        stat: publicStat(h.stat, 'directory'),
      })),
    };
  } catch {
    return fail();
  } finally {
    let failed = false;
    for (const fd of opened.reverse())
      try {
        fs.close(fd);
      } catch {
        failed = true;
      }
    if (failed) fail();
  }
}
function json(bytes: Uint8Array): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail();
    return parsed as Record<string, unknown>;
  } catch {
    return fail();
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
type AnchorData = Readonly<{
  version: 1;
  profile: typeof INVITATION_RUNTIME_SOURCE_BINDING.profile;
  root: string;
  uid: number;
  reviewed: ReviewedInvitationBinding;
  credentialsSha256: string;
}>;
const anchors = new WeakMap<object, { data: AnchorData; rootIdentity: NativeFileStat }>();
export type NativeInvitationStartupAnchor = Readonly<{
  readonly kind: 'native-invitation-startup-anchor';
}>;
/** Invoke ONCE at independently reviewed startup with an externally pinned digest.
 * Never derive expectedSha256 from this file or mutable control.json.
 * No I/O occurs at module import or factory construction. */
export function readNativeInvitationStartupAnchor(
  expectedSha256: string,
  uid: number,
  fs: NativeDescriptorFs = nativeFs,
): NativeInvitationStartupAnchor {
  if ((fs === nativeFs && process.platform !== 'linux') || !HASH.test(expectedSha256))
    return fail();
  const result = readProtected(INVITATION_ROOT + '/startup-anchor.json', uid, fs);
  if (sha(result.file.bytes) !== expectedSha256) return fail();
  const a = json(result.file.bytes);
  if (
    Object.keys(a).sort().join() !== 'credentialsSha256,profile,reviewed,root,uid,version' ||
    a.version !== 1 ||
    a.profile !== INVITATION_RUNTIME_SOURCE_BINDING.profile ||
    a.root !== INVITATION_ROOT ||
    a.uid !== uid ||
    typeof a.credentialsSha256 !== 'string' ||
    !HASH.test(a.credentialsSha256)
  )
    return fail();
  const r = a.reviewed as ReviewedInvitationBinding;
  if (
    !r ||
    ![r.scopeSha256, r.sourceLockSha256, r.configurationSha256].every(
      (v) => typeof v === 'string' && HASH.test(v),
    ) ||
    typeof r.reviewedHead !== 'string' ||
    !/^[a-f0-9]{40}$/.test(r.reviewedHead) ||
    !r.lease ||
    typeof r.lease.ownerApprovedAt !== 'string'
  )
    return fail();
  const handle = Object.freeze({ kind: 'native-invitation-startup-anchor' as const });
  anchors.set(handle, {
    data: freeze(structuredClone(a) as unknown as AnchorData),
    rootIdentity: result.rootIdentity,
  });
  return handle;
}
export function createNativeInvitationLoader(
  anchor: NativeInvitationStartupAnchor,
  fs: NativeDescriptorFs = nativeFs,
) {
  const captured = anchors.get(anchor);
  if (!captured) return fail();
  const a = captured.data;
  // The reviewed snapshot remains this closure's original data for its lifetime.
  const get = (name: string, expected?: string) => {
    const result = readProtected(INVITATION_ROOT + '/' + name, a.uid, fs);
    if (!same(result.rootIdentity, captured.rootIdentity)) return fail();
    if (expected && sha(result.file.bytes) !== expected) return fail();
    return result;
  };
  return Object.freeze({
    uid: a.uid,
    reviewed: a.reviewed,
    async load(): Promise<ProtectedInput> {
      const configuration = get('server-configuration.json', a.reviewed.configurationSha256);
      const sourceLock = get(
        'adapter-code/week1-auth-source-lock.json',
        a.reviewed.sourceLockSha256,
      );
      const lease = get('control.json');
      const root = sourceLock.directories.find((d) => d.path === INVITATION_ROOT);
      if (!root) return fail();
      return {
        root,
        ancestors: sourceLock.directories.filter(
          (d) => d.path !== '/' && d.path !== INVITATION_ROOT,
        ),
        configuration: configuration.file,
        lease: lease.file,
        sourceLock: sourceLock.file,
      };
    },
    async readCredentials(): Promise<Readonly<Record<string, unknown>>> {
      return freeze(json(get('credentials.json', a.credentialsSha256).file.bytes));
    },
  });
}
