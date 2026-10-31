import { describe, expect, it, vi } from 'vitest';
const driver = vi.hoisted(() => {
  const unsafe = vi.fn(async () => [{ data: 'synthetic' }]);
  return {
    unsafe,
    end: vi.fn(async () => {}),
    begin: vi.fn(
      async (action: (client: { unsafe: typeof unsafe }) => Promise<unknown>) =>
        await action({ unsafe }),
    ),
  };
});
const open = vi.hoisted(() => vi.fn(() => driver));
vi.mock('postgres', () => ({ default: open }));
import { openAtmEvidencePostgres } from '../queries/atm-evidence';
describe('explicit existing-driver ATM worker provider (fake only)', () => {
  it('uses one worker connection, explicit budget, no prepare/debug/notices, and bounded close', async () => {
    open.mockClear();
    driver.end.mockClear();
    const provider = openAtmEvidencePostgres(
      'postgres://restricted_fixture@127.0.0.1/fake_only',
      1500,
    );
    expect(open).toHaveBeenCalledOnce();
    const options = (open.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(options).toMatchObject({
      prepare: false,
      max: 1,
      connect_timeout: 2,
      idle_timeout: 2,
      debug: false,
    });
    expect(typeof options.onnotice).toBe('function');
    const log = vi.spyOn(console, 'log');
    (options.onnotice as () => void)();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
    expect(await provider.client.unsafe('safe fake query', [])).toEqual([{ data: 'synthetic' }]);
    expect(driver.begin).toHaveBeenCalledOnce();
    await provider.close();
    expect(driver.end).toHaveBeenCalledExactlyOnceWith({ timeout: 2 });
  });
  it('cannot read a default/ambient DSN or accept invalid timeout configuration', () => {
    open.mockClear();
    for (const [dsn, timeout] of [
      ['', 1000],
      ['postgres://fixture@127.0.0.1/fake', 0],
      ['http://fixture.invalid/fake', 1000],
    ] as const)
      expect(() => openAtmEvidencePostgres(dsn, timeout)).toThrow('ATM_EVIDENCE_UNAVAILABLE');
    expect(open).not.toHaveBeenCalled();
  });
});
