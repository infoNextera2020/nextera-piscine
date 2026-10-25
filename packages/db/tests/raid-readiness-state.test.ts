import { describe, it, expect } from 'vitest';
import {
  evaluateRaidReadiness,
  RAID_READINESS_CAPABILITIES,
  type RaidReadinessFacts,
  type RaidStorageBinding,
} from '../queries/raid-readiness-state';
const facts: RaidReadinessFacts = {
  database_name: 'foundation_test_raid_rehearsal',
  raid_contract: true,
  managed_auth: true,
  managed_storage: true,
  mentor_reader: true,
  mentor_policy: true,
  source_read_guard: true,
};
const binding: RaidStorageBinding = {
  databaseName: 'foundation_test_raid_rehearsal',
  storageApiUrl: 'http://127.0.0.1:56521',
  applicationApiUrl: 'http://127.0.0.1:56521/',
};
describe('Raid configuration readiness fails closed', () => {
  it('requires an explicit Storage binding and does not infer live verification', () => {
    expect(evaluateRaidReadiness(facts, {}).ready).toBe(false);
    expect(evaluateRaidReadiness(facts, binding)).toEqual({
      ready: true,
      reasons: [],
      liveStorageVerified: false,
    });
  });
  it('rejects split databases even when app functions exist', () => {
    const result = evaluateRaidReadiness(
      { ...facts, database_name: 'foundation_test_vertical_20261025' },
      binding,
    );
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('storage_database_binding_mismatch');
  });
  it('rejects a different Auth/Storage API even if names match', () => {
    expect(
      evaluateRaidReadiness(facts, { ...binding, applicationApiUrl: 'http://127.0.0.1:54321' })
        .reasons,
    ).toContain('storage_api_binding_mismatch');
  });
  it.each(RAID_READINESS_CAPABILITIES)('requires %s rather than only read_raid', (capability) => {
    expect(evaluateRaidReadiness({ ...facts, [capability]: false }, binding).ready).toBe(false);
  });
  it('rejects partial/unknown catalog values', () => {
    expect(evaluateRaidReadiness({ ...facts, managed_storage: 'true' }, binding).ready).toBe(false);
    expect(evaluateRaidReadiness(null, binding).ready).toBe(false);
  });
  it.each([
    'http://user:password@127.0.0.1:56521',
    'http://127.0.0.1:56521/?token=private',
    'javascript:example',
    'http://untrusted.example',
    'http://127.0.0.1:56521/storage/v1',
  ])('rejects invalid API binding %s', (url) => {
    expect(evaluateRaidReadiness(facts, { ...binding, storageApiUrl: url }).ready).toBe(false);
  });
});
