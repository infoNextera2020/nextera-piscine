import 'server-only';
import * as fs from 'node:fs';
import type { ImmutableInvitationLease } from './runtime-configuration-core';

type Identity = Readonly<{ uid: number; ticks: string }>;
type Directory = Readonly<{ uid: number; dev: number; ino: number; directory: boolean }>;
export type InvitationProcessSource = Readonly<{
  directory(pid: number): Directory;
  text(pid: number, expectedUid: number): string;
}>;
const MAXIMUM = 8192;
const nativeSource: InvitationProcessSource = {
  directory(pid) {
    const s = fs.lstatSync('/proc/' + pid);
    return { uid: s.uid, dev: s.dev, ino: s.ino, directory: s.isDirectory() };
  },
  text(pid, expectedUid) {
    const fd = fs.openSync(
      '/proc/' + pid + '/stat',
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.uid !== expectedUid) throw new Error('UNAVAILABLE');
      const bytes = Buffer.alloc(MAXIMUM + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
        if (count === 0) break;
        length += count;
      }
      const after = fs.fstatSync(fd);
      if (
        length === 0 ||
        length > MAXIMUM ||
        before.uid !== after.uid ||
        before.ino !== after.ino ||
        before.dev !== after.dev ||
        before.mode !== after.mode
      )
        throw new Error('UNAVAILABLE');
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    } finally {
      fs.closeSync(fd);
    }
  },
};
/** /proc/<pid>/stat field22; comm can contain spaces and parentheses. No command line/env read. */
export function parseInvitationProcessStat(text: string, expectedPid: number): string | null {
  if (
    typeof text !== 'string' ||
    Buffer.byteLength(text) > MAXIMUM ||
    !text.startsWith(expectedPid + ' (')
  )
    return null;
  const close = text.lastIndexOf(') ');
  if (close < 3) return null;
  const fields = text
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  if (
    fields.length < 20 ||
    !['R', 'S', 'D', 'I'].includes(fields[0]!) ||
    !/^[1-9][0-9]*$/.test(fields[19]!)
  )
    return null;
  return fields[19]!;
}
/** Reads only the two startup-pinned process identities. A stopped/dead/reused process is unavailable.
 * This is liveness identity, not proof that a guardian successfully stopped Docker; cleanup needs its
 * separate native receipt. No I/O at construction; no process is started/stopped/signalled here.
 */
export function createNativeInvitationProcessReader(
  uid: number,
  lease: Pick<ImmutableInvitationLease, 'parentPid' | 'parentTicks' | 'guardPid' | 'guardTicks'>,
  source: InvitationProcessSource = nativeSource,
) {
  if (
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    ![lease.parentPid, lease.guardPid].every(
      (p) => Number.isSafeInteger(p) && p > 0 && p <= 2147483647,
    ) ||
    lease.parentPid === lease.guardPid ||
    ![lease.parentTicks, lease.guardTicks].every((t) => /^[1-9][0-9]*$/.test(t))
  )
    throw new Error('INVITATION_PROCESS_UNAVAILABLE');
  const allowed = new Map([
    [lease.parentPid, lease.parentTicks],
    [lease.guardPid, lease.guardTicks],
  ]);
  return async (pid: number): Promise<Identity | null> => {
    if (!allowed.has(pid) || (source === nativeSource && process.platform !== 'linux')) return null;
    try {
      const before = source.directory(pid);
      if (!before.directory || before.uid !== uid) return null;
      const ticks = parseInvitationProcessStat(source.text(pid, uid), pid);
      const after = source.directory(pid);
      if (
        ticks !== allowed.get(pid) ||
        !after.directory ||
        after.uid !== uid ||
        before.dev !== after.dev ||
        before.ino !== after.ino
      )
        return null;
      return Object.freeze({ uid, ticks });
    } catch {
      return null;
    }
  };
}
