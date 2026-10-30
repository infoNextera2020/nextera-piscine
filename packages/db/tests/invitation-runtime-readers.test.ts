import { describe, expect, it, vi } from 'vitest';
import {
  readInvitationRuntimePolicyRows,
  readInvitationRuntimeAuthorityRows,
  consumeInvitationRuntimeIssuer,
  consumeInvitationRuntimeIssueIngress,
  INVITATION_RUNTIME_POLICY_ROWS_SQL,
  INVITATION_RUNTIME_AUTHORITY_ROWS_SQL,
  INVITATION_RUNTIME_LIMIT_CONSUME_SQL,
  type InvitationRuntimeSqlClient,
  type InvitationRuntimeReaderBinding,
} from '../queries/invitation-runtime-readers';
const id = '10000000-0000-4000-8000-000000000001';
const cohort = '20000000-0000-4000-8000-000000000002';
const version = '30000000-0000-4000-8000-000000000003';
const operation = '40000000-0000-4000-8000-000000000004';
const binding: InvitationRuntimeReaderBinding = {
  profile: 'week1-auth-synthetic-source',
  publicPolicySha256: 'a'.repeat(64),
  issuerId: id,
  cohortId: cohort,
  curriculumVersionId: version,
};
const rate = { profile: 'issuer', windowMs: 60000, maxRequests: 4, retentionMs: 3600000 };
const rows = [
  {
    id: 'activate',
    action: 'activate',
    window_ms: 60000,
    max_requests: 10,
    retention_ms: '3600000',
  },
  {
    id: 'ingress',
    action: 'ingress',
    window_ms: 60000,
    max_requests: 120,
    retention_ms: '3600000',
  },
  { id: 'inspect', action: 'inspect', window_ms: 60000, max_requests: 30, retention_ms: '3600000' },
];
const authority = {
  issuer_id: id,
  cohort_id: cohort,
  curriculum_version_id: version,
  issuer_login: 'synthetic_issuer_login',
  max_lifetime_ms: '900000',
  enabled: true,
};
const receipt = (action = 'issuer', allowed = true, replayed = false) => ({
  profile_id: rate.profile,
  action,
  operation_id: operation,
  allowed,
  replayed,
  window_number: '29890000',
});
function setup(value: unknown) {
  const unsafe = vi.fn().mockResolvedValue(value);
  return { unsafe, client: { unsafe } as unknown as InvitationRuntimeSqlClient };
}
describe('Narrow raw invitation runtime source readers', () => {
  it('returns exact immutable whitelist rows and binds independent source/profile/UUID inputs', async () => {
    const f = setup(rows);
    expect(await readInvitationRuntimePolicyRows(f.client, binding)).toEqual(rows);
    expect(f.unsafe).toHaveBeenCalledWith(INVITATION_RUNTIME_POLICY_ROWS_SQL, [
      binding.profile,
      binding.publicPolicySha256,
      id,
      cohort,
      version,
    ]);
    expect(Object.isFrozen(await readInvitationRuntimePolicyRows(f.client, binding))).toBe(true);
    const g = setup([authority]);
    expect(await readInvitationRuntimeAuthorityRows(g.client, binding)).toEqual([authority]);
    expect(g.unsafe).toHaveBeenCalledWith(INVITATION_RUNTIME_AUTHORITY_ROWS_SQL, [
      binding.profile,
      binding.publicPolicySha256,
      id,
      cohort,
      version,
    ]);
  });
  it.each([
    true,
    [],
    [rows[0]],
    [...rows, rows[0]],
    rows.map((r) => ({ ...r, token_digest: 'private' })),
    rows.map((r) => ({ ...r, window_ms: '60000' })),
    rows.map((r) => ({ ...r, retention_ms: 3600000 })),
    rows.map((r) => ({ ...r, retention_ms: '060000' })),
    [rows[0], rows[1], rows[1]],
    rows.map((r) => ({ ...r, action: 'issuer' })),
    rows.map((r) => ({ ...r, retention_ms: '1' })),
  ])('rejects boolean, incomplete, broad or substituted policy rows %#', async (value) => {
    await expect(readInvitationRuntimePolicyRows(setup(value).client, binding)).rejects.toThrow(
      'INVITATION_RUNTIME_READER_UNAVAILABLE',
    );
  });
  it('accepts the explicit one-hour security ceiling without inventing that lifetime as a default', async () => {
    const f = setup([{ ...authority, max_lifetime_ms: '3600000' }]);
    expect(await readInvitationRuntimeAuthorityRows(f.client, binding)).toEqual([
      { ...authority, max_lifetime_ms: '3600000' },
    ]);
  });
  it.each([
    true,
    [],
    [authority, authority],
    [{ ...authority, issuer_id: cohort }],
    [{ ...authority, cohort_id: id }],
    [{ ...authority, curriculum_version_id: id }],
    [{ ...authority, enabled: 'true' }],
    [{ ...authority, max_lifetime_ms: 900000 }],
    [{ ...authority, email: 'unrelated@example.invalid' }],
    [{ ...authority, max_lifetime_ms: '9007199254740992' }],
    [{ ...authority, max_lifetime_ms: '3600001' }],
  ])('rejects unproven authority reply %#', async (value) => {
    await expect(
      readInvitationRuntimeAuthorityRows(setup(value).client, binding),
    ).rejects.toThrow();
  });
  it.each([
    { ...binding, publicPolicySha256: 'changed' },
    { ...binding, issuerId: 'invalid' },
    { ...binding, profile: '../../other' },
    { ...binding, cohortId: 'A0000000-0000-4000-8000-000000000002' },
  ])('rejects invalid caller binding before native I/O %#', async (value) => {
    const f = setup(rows);
    await expect(readInvitationRuntimePolicyRows(f.client, value)).rejects.toThrow();
    expect(f.unsafe).not.toHaveBeenCalled();
  });
});
describe('Persisted issuer and aggregate ingress limiter RPC mapping', () => {
  it('uses a parameterized single mutation with exact requested policy and trusted operation nonce', async () => {
    const f = setup([receipt()]);
    expect(await consumeInvitationRuntimeIssuer(f.client, binding, operation, id, rate)).toBe(true);
    expect(f.unsafe).toHaveBeenCalledExactlyOnceWith(INVITATION_RUNTIME_LIMIT_CONSUME_SQL, [
      binding.profile,
      binding.publicPolicySha256,
      id,
      cohort,
      version,
      operation,
      'issuer',
      rate.profile,
      rate.windowMs,
      rate.maxRequests,
      rate.retentionMs,
    ]);
    expect(INVITATION_RUNTIME_LIMIT_CONSUME_SQL).not.toContain(binding.publicPolicySha256);
    expect(INVITATION_RUNTIME_LIMIT_CONSUME_SQL).not.toMatch(
      /invitation_issue\(|token_digest|email|caller_digest/,
    );
  });
  it('keeps issuer and aggregate ingress actions separate without caller-controlled request keys', async () => {
    const f = setup([receipt('issue_ingress')]);
    expect(await consumeInvitationRuntimeIssueIngress(f.client, binding, operation, rate)).toBe(
      true,
    );
    expect(f.unsafe.mock.calls[0]?.[1]?.[6]).toBe('issue_ingress');
  });
  it.each([false, true])(
    'returns an exact %s replay without any second mutation/retry',
    async (allowed) => {
      const f = setup([receipt('issuer', allowed, true)]);
      expect(await consumeInvitationRuntimeIssuer(f.client, binding, operation, id, rate)).toBe(
        allowed,
      );
      expect(f.unsafe).toHaveBeenCalledOnce();
    },
  );
  it('captures nested binding/rate primitives before awaited dispatch', async () => {
    const mutable = structuredClone(binding),
      requested = structuredClone(rate),
      f = setup([receipt()]);
    f.unsafe.mockImplementationOnce(async () => {
      (mutable as { issuerId: string }).issuerId = cohort;
      requested.maxRequests = 999;
      return [receipt()];
    });
    expect(await consumeInvitationRuntimeIssuer(f.client, mutable, operation, id, requested)).toBe(
      true,
    );
    expect(f.unsafe.mock.calls[0]?.[1]).toContain(4);
    expect(f.unsafe.mock.calls[0]?.[1]).not.toContain(999);
  });
  it.each([
    true,
    [],
    [receipt(), receipt()],
    [{ ...receipt(), allowed: 'true' }],
    [{ ...receipt(), replayed: 1 }],
    [{ ...receipt(), action: 'issue_ingress' }],
    [{ ...receipt(), operation_id: id }],
    [{ ...receipt(), profile_id: 'other' }],
    [{ ...receipt(), window_number: 1 }],
    [{ ...receipt(), window_number: '-1' }],
    [{ ...receipt(), token_digest: 'private' }],
  ])('rejects malformed or foreign limiter acknowledgement %#', async (value) => {
    const f = setup(value);
    await expect(
      consumeInvitationRuntimeIssuer(f.client, binding, operation, id, rate),
    ).rejects.toThrow();
    expect(f.unsafe).toHaveBeenCalledOnce();
  });
  it('rejects actor/nonce/rate tampering before mutation, with no policy fallback', async () => {
    const f = setup([receipt()]);
    await expect(
      consumeInvitationRuntimeIssuer(f.client, binding, operation, cohort, rate),
    ).rejects.toThrow();
    await expect(
      consumeInvitationRuntimeIssuer(f.client, binding, 'browser-value', id, rate),
    ).rejects.toThrow();
    await expect(
      consumeInvitationRuntimeIssuer(f.client, binding, operation, id, { ...rate, maxRequests: 0 }),
    ).rejects.toThrow();
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('preserves a lost mutation response as uncertainty without retry or replacement nonce', async () => {
    const f = setup(null),
      error = new Error('connection lost after dispatch');
    f.unsafe.mockRejectedValueOnce(error);
    await expect(
      consumeInvitationRuntimeIssuer(f.client, binding, operation, id, rate),
    ).rejects.toBe(error);
    expect(f.unsafe).toHaveBeenCalledOnce();
  });
});
