/** Configuration and catalog readiness is not proof of a successful live Storage request. */
export const RAID_READINESS_CAPABILITIES = [
  'raid_contract',
  'managed_auth',
  'managed_storage',
  'mentor_reader',
  'mentor_policy',
  'source_read_guard',
] as const;
export type RaidReadinessCapability = (typeof RAID_READINESS_CAPABILITIES)[number];
export type RaidReadinessFacts = { database_name: unknown } & Record<
  RaidReadinessCapability,
  unknown
>;
export type RaidStorageBinding = {
  databaseName?: string | undefined;
  storageApiUrl?: string | undefined;
  applicationApiUrl?: string | undefined;
};
export type RaidReadiness = { ready: boolean; reasons: string[]; liveStorageVerified: false };

function apiIdentity(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname))
      return null;
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export function raidBindingProblems(binding: RaidStorageBinding): string[] {
  const reasons: string[] = [];
  if (!binding.databaseName || !/^[a-zA-Z0-9_]+$/.test(binding.databaseName))
    reasons.push('storage_database_binding_missing');
  const storage = apiIdentity(binding.storageApiUrl),
    application = apiIdentity(binding.applicationApiUrl);
  if (!storage || !application) reasons.push('storage_api_binding_missing');
  else if (storage !== application) reasons.push('storage_api_binding_mismatch');
  return reasons;
}
export function evaluateRaidReadiness(
  facts: RaidReadinessFacts | null,
  binding: RaidStorageBinding,
): RaidReadiness {
  const reasons = raidBindingProblems(binding);
  if (!facts) reasons.push('catalog_not_verified');
  else {
    if (typeof facts.database_name !== 'string' || facts.database_name !== binding.databaseName)
      reasons.push('storage_database_binding_mismatch');
    for (const capability of RAID_READINESS_CAPABILITIES)
      if (facts[capability] !== true) reasons.push(capability + '_missing');
  }
  return { ready: reasons.length === 0, reasons, liveStorageVerified: false };
}
