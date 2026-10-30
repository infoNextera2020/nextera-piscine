import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  createNativeInvitationProcessReader,
  parseInvitationProcessStat,
  type InvitationProcessSource,
} from './runtime-process';
function stat(pid: number, ticks = '100', state = 'S', comm = 'python (guard)') {
  const fields = Array<string>(40).fill('0');
  fields[0] = state;
  fields[19] = ticks;
  return pid + ' (' + comm + ') ' + fields.join(' ') + '\n';
}
const lease = { parentPid: 10, parentTicks: '100', guardPid: 11, guardTicks: '101' };
const dir = { uid: 1000, dev: 1, ino: 7, directory: true };
describe('native process identity — bounded metadata only', () => {
  it('parses the closing comm delimiter and exact start tick', () => {
    expect(parseInvitationProcessStat(stat(10), 10)).toBe('100');
    expect(parseInvitationProcessStat(stat(10), 11)).toBeNull();
  });
  it.each(['Z', 'X', 'x', 'T', 't'])('refuses dead/stopped/traced state%s', (state) =>
    expect(parseInvitationProcessStat(stat(10, '100', state), 10)).toBeNull(),
  );
  it('rejects truncated, malformed and oversized metadata', () => {
    for (const s of ['10 () S', '10 (x) S ' + Array(19).fill('0').join(' '), 'x'.repeat(8193)])
      expect(parseInvitationProcessStat(s, 10)).toBeNull();
  });
  it('never enumerates an unpinned PID', async () => {
    const source = { directory: vi.fn(() => dir), text: vi.fn(() => stat(10)) };
    expect(await createNativeInvitationProcessReader(1000, lease, source)(12)).toBeNull();
    expect(source.directory).not.toHaveBeenCalled();
  });
  it('captures both pinned identities without reading commands or environment', async () => {
    const source: InvitationProcessSource = {
      directory: () => dir,
      text: (pid) => stat(pid, pid === 10 ? '100' : '101'),
    };
    const read = createNativeInvitationProcessReader(1000, lease, source);
    expect(await read(10)).toEqual({ uid: 1000, ticks: '100' });
    expect(await read(11)).toEqual({ uid: 1000, ticks: '101' });
  });
  it.each(['uid', 'inode', 'ticks', 'missing'] as const)(
    'refuses changed %s identity',
    async (change) => {
      let calls = 0;
      const source: InvitationProcessSource = {
        directory: () => {
          if (change === 'missing') throw new Error('gone');
          return {
            ...dir,
            uid: change === 'uid' ? 0 : 1000,
            ino: change === 'inode' && calls++ ? 8 : 7,
          };
        },
        text: () => stat(10, change === 'ticks' ? '999' : '100'),
      };
      expect(await createNativeInvitationProcessReader(1000, lease, source)(10)).toBeNull();
    },
  );
  it.skipIf(process.platform !== 'linux')(
    'can read only this test process through actual Linux proc metadata',
    async () => {
      const uid = process.getuid!();
      const ownText = (await import('node:fs')).readFileSync(
        '/proc/' + process.pid + '/stat',
        'utf8',
      );
      const ticks = parseInvitationProcessStat(ownText, process.pid)!;
      const read = createNativeInvitationProcessReader(uid, {
        parentPid: process.pid,
        parentTicks: ticks,
        guardPid: 2147483647,
        guardTicks: '1',
      });
      expect(await read(process.pid)).toEqual({ uid, ticks });
    },
  );
});
