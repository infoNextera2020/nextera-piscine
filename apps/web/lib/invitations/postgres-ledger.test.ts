import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createPostgresInvitationLedger,
  InvitationLedgerUnavailable,
  type InvitationPostgresSettings,
} from './postgres-ledger';
const id = '10000000-0000-4000-8000-000000000001',
  request = '20000000-0000-4000-8000-000000000001',
  digest = 'a'.repeat(64),
  fence = '9007199254740993';
const lease = { invitationId: id, fence };
const scope = {
  operationReference: id,
  admissionId: id,
  email: 'accepted@example.test',
  displayName: 'Accepted learner',
  cohortId: id,
  role: 'learner' as const,
};
function row() {
  return {
    id,
    token_digest: digest,
    accepted_admission_id: id,
    email: scope.email,
    display_name: scope.displayName,
    cohort_id: id,
    expires_at: '2026-11-01T00:00:00Z',
    revoked_at: null,
    phase: 'issued',
    request_id: null,
    auth_user_id: null,
  };
}
function fixture(result: unknown[] = []) {
  const unsafe = vi.fn(async (text: string, params: unknown[]) => {
    void text;
    void params;
    return result;
  });
  unsafe.mockResolvedValueOnce([{ ready: true }]);
  const client = { unsafe } as unknown as InvitationPostgresSettings['client'];
  return { unsafe, adapter: createPostgresInvitationLedger({ enabled: true, client })! };
}
describe('prepared Postgres invitation ledger', () => {
  it('does not create a connection or query at construction', () => {
    expect(createPostgresInvitationLedger(null)).toBeNull();
    expect(createPostgresInvitationLedger({ enabled: true, client: null })).toBeNull();
    const f = fixture();
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('checks hook/schema/runtime readiness before private reads', async () => {
    const f = fixture();
    f.unsafe.mockReset().mockResolvedValue([{ ready: false }]);
    await expect(f.adapter.find(digest)).rejects.toBeInstanceOf(InvitationLedgerUnavailable);
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it('binds only the digest on lookup and decodes exact server values', async () => {
    const f = fixture([row()]);
    expect(await f.adapter.find(digest)).toMatchObject({
      id,
      tokenDigest: digest,
      email: scope.email,
      phase: 'issued',
    });
    expect(f.unsafe.mock.calls[1]![1]).toEqual([digest]);
  });
  it('keeps server clock authoritative and carries bigint fence as text', async () => {
    const f = fixture([
      { result: { claim_state: 'acquired', record: { ...row(), request_id: request }, fence } },
    ]);
    expect(
      await f.adapter.claim({
        tokenDigest: digest,
        requestId: request,
        now: -999999999,
        leaseMs: 1000,
      }),
    ).toMatchObject({ kind: 'acquired', lease });
    expect(f.unsafe.mock.calls[1]![1]).toEqual([digest, request, 1000]);
    expect(f.unsafe.mock.calls[1]![0]).toBe(
      'SELECT app.invitation_claim($1::text,$2::uuid,$3::integer) AS result',
    );
  });
  it.each(['busy', 'conflict', 'missing'] as const)(
    'preserves %s without fabricating a lease',
    async (kind) => {
      const f = fixture([{ result: { claim_state: kind } }]);
      expect(
        await f.adapter.claim({ tokenDigest: digest, requestId: request, now: 1, leaseMs: 1000 }),
      ).toEqual({ kind });
    },
  );
  it('rejects invalid input/fence before a query', async () => {
    const f = fixture();
    await expect(f.adapter.find('bad')).rejects.toBeInstanceOf(InvitationLedgerUnavailable);
    await expect(
      f.adapter.release({ ...lease, fence: '9223372036854775808' }),
    ).rejects.toBeInstanceOf(InvitationLedgerUnavailable);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('keeps CAS misses distinct from successful advances', async () => {
    const f = fixture([]);
    expect(await f.adapter.advance(lease, 'issued', { phase: 'auth_pending' })).toBeNull();
    expect(f.unsafe.mock.calls[1]![1]).toEqual([id, fence, 'issued', 'auth_pending', null]);
  });
  it('does not permit skipped states or caller-selected finalization role', async () => {
    const f = fixture();
    await expect(
      f.adapter.advance(lease, 'issued', { phase: 'auth_ready', authUserId: id }),
    ).rejects.toBeInstanceOf(InvitationLedgerUnavailable);
    await expect(
      f.adapter.complete(lease, { ...scope, role: 'admin' } as never),
    ).rejects.toBeInstanceOf(InvitationLedgerUnavailable);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('binds exact pinned scope at finalization and preserves false boundary results', async () => {
    const f = fixture([{ completed: false }]);
    expect(await f.adapter.complete(lease, scope)).toBe(false);
    expect(f.unsafe.mock.calls[1]![1]).toEqual([id, fence, id, scope.email, scope.displayName, id]);
  });
  it('sanitizes SQL errors without exposing source, connection or credentials', async () => {
    const f = fixture();
    f.unsafe
      .mockReset()
      .mockRejectedValue({ code: '42501', message: 'password secret database host' });
    await expect(f.adapter.find(digest)).rejects.toThrow('Invitation storage unavailable.');
  });
  it('rejects malformed or ambiguous server rows', async () => {
    const f = fixture([row(), row()]);
    await expect(f.adapter.find(digest)).rejects.toBeInstanceOf(InvitationLedgerUnavailable);
    const g = fixture([{ ...row(), phase: 'not-a-state' }]);
    await expect(g.adapter.find(digest)).rejects.toBeInstanceOf(InvitationLedgerUnavailable);
  });
  it('prepares secure admission-hook/CAS SQL without registering or executing it', () => {
    const sql = readFileSync(
      'packages/db/migration-drafts/0016_invitation_operations.DRAFT.sql',
      'utf8',
    );
    expect(sql).toContain('invitation_admission_current(uuid,text,text,uuid)');
    expect(sql).toContain('p.proowner<>owner_oid');
    expect(sql).toContain('aclexplode');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('IS NOT TRUE');
    expect(sql).toContain('p.proretset');
    expect(sql).toContain('r.fence=generation');
    expect(sql).toContain('clock_timestamp()');
    expect(sql).not.toContain('CREATE ROLE');
    expect(sql).not.toContain('TO nextera_web');
    expect(readFileSync('packages/db/migrations/meta/_journal.json', 'utf8')).not.toContain('0016');
  });
});
