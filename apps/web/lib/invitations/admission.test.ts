import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createPostgresInvitationAdmission,
  InvitationAdmissionUnavailable,
  type InvitationAdmissionSettings,
} from './admission';
const id = '10000000-0000-4000-8000-000000000001';
const digest = 'a'.repeat(64),
  caller = 'b'.repeat(64);
const scope = {
  operationReference: id,
  admissionId: id,
  email: 'accepted@example.test',
  displayName: 'Accepted learner',
  cohortId: id,
  role: 'learner' as const,
};
const lease = { invitationId: id, fence: '9007199254740993' };
function fixture(result: unknown[] = [{ allowed: true }]) {
  const unsafe = vi.fn(async (text: string, args: unknown[]) => {
    void text;
    void args;
    return result;
  });
  unsafe.mockResolvedValueOnce([{ ready: true }]);
  const settings: InvitationAdmissionSettings = {
    enabled: true,
    client: { unsafe } as never,
    policy: {
      authorityContract: 'nextera-invitation-admission-v1',
      emailConfirmed: false,
      rateProfiles: { ingress: 'test_ingress', inspect: 'test_inspect', activate: 'test_activate' },
    },
  };
  return { unsafe, settings, adapter: createPostgresInvitationAdmission(settings)! };
}
describe('prepared invitation admission/enrollment boundary', () => {
  it('requires explicit authority/confirmation/profile policy without import or constructor queries', () => {
    const f = fixture();
    expect(f.unsafe).not.toHaveBeenCalled();
    expect(createPostgresInvitationAdmission(null)).toBeNull();
    expect(createPostgresInvitationAdmission({ ...f.settings, client: null })).toBeNull();
    expect(createPostgresInvitationAdmission({ ...f.settings, policy: null })).toBeNull();
    expect(
      createPostgresInvitationAdmission({
        ...f.settings,
        policy: { ...f.settings.policy!, emailConfirmed: undefined } as never,
      }),
    ).toBeNull();
    expect(
      createPostgresInvitationAdmission({
        ...f.settings,
        policy: { ...f.settings.policy!, authorityContract: 'browser says accepted' } as never,
      }),
    ).toBeNull();
    expect(
      createPostgresInvitationAdmission({
        ...f.settings,
        policy: {
          ...f.settings.policy!,
          rateProfiles: { ingress: 'same', inspect: 'same', activate: 'same' },
        },
      }),
    ).toBeNull();
  });
  it('checks confirmation/readiness then binds only exact server-held scope', async () => {
    const f = fixture();
    expect(await f.adapter.eligibility.current(scope)).toBe(true);
    expect(f.unsafe.mock.calls[0]![1]).toEqual([false]);
    expect(f.unsafe.mock.calls[1]![1]).toEqual([id, id, scope.email, scope.displayName, id]);
  });
  it('never turns a readiness failure into acceptance or enrollment', async () => {
    const f = fixture();
    f.unsafe.mockReset().mockResolvedValue([{ ready: false }]);
    await expect(f.adapter.eligibility.current(scope)).rejects.toBeInstanceOf(
      InvitationAdmissionUnavailable,
    );
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it.each(['complete', 'blocked', 'unknown'] as const)(
    'preserves %s enrollment without inventing success',
    async (outcome) => {
      const f = fixture([{ outcome }]);
      expect(await f.adapter.enrollment.ensure({ ...scope, authUserId: id }, lease)).toBe(outcome);
      expect(f.unsafe.mock.calls[1]![1]).toEqual([
        id,
        lease.fence,
        id,
        scope.email,
        scope.displayName,
        id,
        id,
      ]);
    },
  );
  it('rejects arbitrary identities/roles and stale or missing fence before SQL', async () => {
    const f = fixture();
    await expect(
      f.adapter.enrollment.ensure({ ...scope, role: 'admin', authUserId: id } as never, lease),
    ).rejects.toBeInstanceOf(InvitationAdmissionUnavailable);
    await expect(
      f.adapter.enrollment.ensure(
        { ...scope, authUserId: '20000000-0000-4000-8000-000000000001' },
        lease,
      ),
    ).rejects.toBeInstanceOf(InvitationAdmissionUnavailable);
    await expect(
      f.adapter.enrollment.ensure(
        { ...scope, authUserId: id },
        { ...lease, fence: '9223372036854775808' },
      ),
    ).rejects.toBeInstanceOf(InvitationAdmissionUnavailable);
    await expect(
      f.adapter.enrollment.ensure({ ...scope, authUserId: id }, undefined as never),
    ).rejects.toBeInstanceOf(InvitationAdmissionUnavailable);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('separates caller-only ingress from per-action caller/token limits', async () => {
    const f = fixture();
    expect(await f.adapter.ingress.consume(caller)).toBe(true);
    expect(f.unsafe.mock.calls[1]![1]).toEqual(['test_ingress', 'ingress', caller, null]);
    f.unsafe.mockResolvedValueOnce([{ ready: true }]).mockResolvedValueOnce([{ allowed: false }]);
    expect(
      await f.adapter.rate.consume({ action: 'activate', tokenDigest: digest, callerKey: caller }),
    ).toBe(false);
    expect(f.unsafe.mock.calls[3]![1]).toEqual(['test_activate', 'activate', caller, digest]);
  });
  it('rejects raw caller/token material instead of persisting it', async () => {
    const f = fixture();
    await expect(f.adapter.ingress.consume('192.0.2.1')).rejects.toBeInstanceOf(
      InvitationAdmissionUnavailable,
    );
    await expect(
      f.adapter.rate.consume({ action: 'inspect', tokenDigest: 'raw-token', callerKey: caller }),
    ).rejects.toBeInstanceOf(InvitationAdmissionUnavailable);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('sanitizes SQL/provider errors and malformed results', async () => {
    const f = fixture([{ outcome: 'maybe' }]);
    await expect(f.adapter.enrollment.ensure({ ...scope, authUserId: id }, lease)).rejects.toThrow(
      'Invitation admission unavailable.',
    );
    f.unsafe.mockRejectedValueOnce(new Error('secret SQL/DSN'));
    await expect(f.adapter.eligibility.current(scope)).rejects.toThrow(
      'Invitation admission unavailable.',
    );
  });
  it('prepares a nonregistered draft, not an accepted-record stub or operational integration proof', () => {
    const sql = readFileSync(
      'packages/db/migration-drafts/0018_invitation_admission.DRAFT.sql',
      'utf8',
    );
    expect(sql).toContain('app._invitation_operations_guard()');
    expect(sql).toContain(
      'app.invitation_admission_current(admission,invited_email,accepted_name,cohort) IS NOT TRUE',
    );
    expect(sql).toContain('i.fence<>generation');
    expect(sql).toContain('invitation_enrollment_receipts');
    expect(sql).toContain('raw_app_meta_data');
    expect(sql).toContain('FOR UPDATE OF c');
    expect(sql).toContain('i.lease_until<=clock_timestamp()');
    expect(sql).toContain('dependent_node_key=n.node_key');
    expect(sql.replace(/^\s*--.*$/gm, '')).not.toMatch(/CREATE\s+ROLE/i);
    expect(sql).not.toContain('CREATE FUNCTION app.invitation_admission_current');
    expect(sql).not.toMatch(/INSERT INTO app\.invitation_(admission_policy|rate_profiles)/);
    expect(sql).not.toContain('TO nextera_web');
    expect(sql).not.toContain('ON CONFLICT DO UPDATE');
    expect(readFileSync('packages/db/migrations/meta/_journal.json', 'utf8')).not.toContain('0018');
  });
});
