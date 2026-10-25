import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { OperationalDatabase } from '../operations/curriculum';
import {
  readRaid,
  readRaidQueue,
  assignRaidTeam,
  acceptRaidSubmission,
  reviewRaid,
  raidArtifactContext,
} from '../queries/raids';
import { readRaidReadiness, RAID_READINESS_SQL } from '../queries/raid-readiness';
const id = '10000000-0000-4000-8000-000000000001';
const facts = {
  database_name: 'foundation_test_raid_rehearsal',
  raid_contract: true,
  managed_auth: true,
  managed_storage: true,
  mentor_reader: true,
  mentor_policy: true,
  source_read_guard: true,
};
const input = {
  authId: id,
  cohort: id,
  node: 'test-raid',
  requestId: id,
  filename: 'raid.go',
  size: 10,
  digest: 'a'.repeat(64),
};
const actions = [
  (db: OperationalDatabase) => readRaid(db, id, id, 'test-raid'),
  (db: OperationalDatabase) => acceptRaidSubmission(db, input),
  (db: OperationalDatabase) =>
    assignRaidTeam(db, id, {
      cohort: id,
      node: 'test-raid',
      requestId: id,
      name: 'Test',
      mentor: id,
      members: [id, id, id],
    }),
  (db: OperationalDatabase) =>
    reviewRaid(db, id, { attempt: id, requestId: id, decision: 'approved', feedback: 'Test' }),
  (db: OperationalDatabase) => raidArtifactContext(db, id, id),
];
beforeEach(() => {
  vi.stubEnv('RAID_STORAGE_DATABASE_NAME', 'foundation_test_raid_rehearsal');
  vi.stubEnv('RAID_STORAGE_API_URL', 'http://127.0.0.1:56521');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:56521');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('Raid adapters cannot bypass readiness', () => {
  it.each(actions)(
    'blocks an action before its read/mutation when Storage is absent',
    async (action) => {
      const execute = vi.fn().mockResolvedValue([{ ...facts, managed_storage: false }]);
      await expect(action({ execute } as unknown as OperationalDatabase)).rejects.toThrow(
        'RAID_NOT_READY',
      );
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );
  it('hides owner assignment queue when only app functions are installed', async () => {
    const execute = vi.fn().mockResolvedValue([{ ...facts, mentor_reader: false }]);
    expect(await readRaidQueue({ execute } as unknown as OperationalDatabase, id)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('does not query anything without explicit bindings', async () => {
    vi.stubEnv('RAID_STORAGE_DATABASE_NAME', '');
    const execute = vi.fn();
    await expect(
      readRaid({ execute } as unknown as OperationalDatabase, id, id, 'test-raid'),
    ).rejects.toThrow('RAID_NOT_READY');
    expect(execute).not.toHaveBeenCalled();
  });
  it('fails closed on a catalog error and exposes no private database detail', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('private connection string'));
    const result = await readRaidReadiness({ execute } as unknown as OperationalDatabase);
    expect(result).toEqual({
      ready: false,
      reasons: ['catalog_unavailable'],
      liveStorageVerified: false,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('reaches an authorized query only after all configuration/catalog gates pass', async () => {
    const data = { team: null, attempts: [], can_submit: false, can_review: false };
    const execute = vi.fn().mockResolvedValueOnce([facts]).mockResolvedValueOnce([{ data }]);
    expect(
      await readRaid({ execute } as unknown as OperationalDatabase, id, id, 'test-raid'),
    ).toEqual(data);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('uses a catalog-only probe without executing managed helpers or changing privileges', () => {
    expect(RAID_READINESS_SQL).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/i,
    );
    expect(RAID_READINESS_SQL).toContain('pg_catalog.pg_policy');
    expect(RAID_READINESS_SQL).not.toContain('FROM storage.objects');
    expect(RAID_READINESS_SQL).not.toContain('app.raid_storage_reader(');
  });
});
