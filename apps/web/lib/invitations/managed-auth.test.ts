import { describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { ActivationScope } from './activation';
import {
  createManagedAuthAdapter,
  invitationOwnershipProof,
  type ManagedAuthSettings,
} from './managed-auth';
const id = '10000000-0000-4000-8000-000000000001',
  other = '10000000-0000-4000-8000-000000000002';
const scope: ActivationScope = {
  operationReference: id,
  admissionId: other,
  cohortId: id,
  email: 'accepted@example.test',
  displayName: 'Accepted learner',
  role: 'learner',
};
function user(overrides: Partial<User> = {}): User {
  return {
    id,
    email: scope.email,
    aud: 'authenticated',
    created_at: '2026-10-28T00:00:00Z',
    email_confirmed_at: '2026-10-28T00:00:00Z',
    user_metadata: {},
    app_metadata: {
      nextera_invitation_activation: {
        version: 1,
        operation_reference: id,
        scope_digest: invitationOwnershipProof(scope),
      },
    },
    ...overrides,
  };
}
const absent = () => ({ data: { user: null }, error: { code: 'user_not_found', status: 404 } });
function fixture() {
  const getUserById = vi.fn(async (requestedId: string) => {
    void requestedId;
    return { data: { user: user() as User | null }, error: null as unknown };
  });
  const createUser = vi.fn(async (attributes: Record<string, unknown>) => ({
    data: {
      user: user({
        id: attributes.id as string,
        email: attributes.email as string,
        app_metadata: attributes.app_metadata as User['app_metadata'],
      }),
    },
    error: null as unknown,
  }));
  const forbidden = {
    listUsers: vi.fn(),
    updateUserById: vi.fn(),
    deleteUser: vi.fn(),
    inviteUserByEmail: vi.fn(),
    generateLink: vi.fn(),
  };
  const settings: ManagedAuthSettings = {
    enabled: true,
    emailConfirmed: true,
    admin: { getUserById, createUser, ...forbidden } as unknown as ManagedAuthSettings['admin'],
    authorize: vi.fn(async () => true),
    passwordAccepted: vi.fn(async () => true),
  };
  return {
    getUserById,
    createUser,
    forbidden,
    settings,
    adapter: createManagedAuthAdapter(settings)!,
  };
}
describe('prepared deterministic managed Auth adapter', () => {
  it('is unavailable without explicit dependencies and makes no construction-time request', () => {
    const f = fixture();
    expect(createManagedAuthAdapter(null)).toBeNull();
    expect(createManagedAuthAdapter({ ...f.settings, admin: null })).toBeNull();
    expect(
      createManagedAuthAdapter({ ...f.settings, emailConfirmed: undefined } as never),
    ).toBeNull();
    expect(f.getUserById).not.toHaveBeenCalled();
    expect(f.createUser).not.toHaveBeenCalled();
  });
  it('requires current admission authority and exact learner scope before API calls', async () => {
    const f = fixture();
    vi.mocked(f.settings.authorize).mockResolvedValue(false);
    expect(await f.adapter.begin(scope, 'test-password')).toEqual({ kind: 'unknown' });
    expect(await f.adapter.recover(scope)).toEqual({ kind: 'unknown' });
    expect(f.createUser).not.toHaveBeenCalled();
    expect(f.getUserById).not.toHaveBeenCalled();
  });
  it('does not let caller metadata or role upgrade the account', async () => {
    const f = fixture();
    expect(await f.adapter.begin({ ...scope, role: 'admin' } as never, 'x')).toEqual({
      kind: 'unknown',
    });
    expect(f.getUserById).not.toHaveBeenCalled();
  });
  it('creates exactly the pinned ID/email and server-only ownership marker, preserving password bytes', async () => {
    const f = fixture();
    f.getUserById.mockResolvedValueOnce(absent());
    expect(await f.adapter.begin(scope, ' exact bytes ')).toEqual({
      kind: 'owned',
      operationReference: id,
      authUserId: id,
      email: scope.email,
    });
    expect(f.createUser).toHaveBeenCalledTimes(1);
    expect(f.createUser.mock.calls[0]![0]).toEqual({
      id,
      email: scope.email,
      password: ' exact bytes ',
      email_confirm: true,
      app_metadata: {
        nextera_invitation_activation: {
          version: 1,
          operation_reference: id,
          scope_digest: invitationOwnershipProof(scope),
        },
      },
    });
    for (const fn of Object.values(f.forbidden)) expect(fn).not.toHaveBeenCalled();
  });
  it('does not infer email confirmation or a password policy', async () => {
    const f = fixture();
    f.getUserById.mockResolvedValueOnce(absent());
    const a = createManagedAuthAdapter({ ...f.settings, emailConfirmed: false })!;
    await a.begin(scope, 'p');
    expect(f.createUser.mock.calls[0]![0].email_confirm).toBe(false);
    vi.mocked(f.settings.passwordAccepted).mockResolvedValue(false);
    expect(await f.adapter.begin(scope, 'rejected')).toEqual({ kind: 'unknown' });
    expect(f.createUser).toHaveBeenCalledTimes(1);
  });
  it('recovers the exact owned operation by ID without writing or resetting its password', async () => {
    const f = fixture();
    expect(await f.adapter.recover(scope)).toEqual({
      kind: 'owned',
      operationReference: id,
      authUserId: id,
      email: scope.email,
    });
    expect(f.getUserById).toHaveBeenCalledWith(id);
    expect(f.createUser).not.toHaveBeenCalled();
  });
  it.each([
    { email: 'other@example.test' },
    { id: other },
    { app_metadata: {} },
    { app_metadata: {}, user_metadata: user().app_metadata },
    {
      app_metadata: {
        nextera_invitation_activation: {
          version: 1,
          operation_reference: other,
          scope_digest: invitationOwnershipProof(scope),
        },
      },
    },
  ])('refuses unrelated identity %j', async (patch) => {
    const f = fixture();
    f.getUserById.mockResolvedValue({ data: { user: user(patch) }, error: null });
    expect(await f.adapter.recover(scope)).toEqual({ kind: 'existing' });
    expect(await f.adapter.begin(scope, 'p')).toEqual({ kind: 'existing' });
    expect(f.createUser).not.toHaveBeenCalled();
  });
  it('does not create when a lookup response is uncertain rather than user_not_found', async () => {
    const f = fixture();
    f.getUserById.mockResolvedValue({
      data: { user: null },
      error: { code: 'unexpected_failure', status: 500 },
    });
    expect(await f.adapter.begin(scope, 'p')).toEqual({ kind: 'unknown' });
    expect(f.createUser).not.toHaveBeenCalled();
  });
  it('rejects a server that ignores the requested deterministic ID', async () => {
    const f = fixture();
    f.getUserById.mockResolvedValue(absent());
    f.createUser.mockResolvedValueOnce({ data: { user: user({ id: other }) }, error: null });
    expect(await f.adapter.begin(scope, 'p')).toEqual({ kind: 'unknown' });
    expect(f.createUser).toHaveBeenCalledTimes(1);
  });
  it('returns unknown after an uncertain create, then only reads on recovery', async () => {
    const f = fixture();
    f.getUserById.mockResolvedValueOnce(absent());
    f.createUser.mockRejectedValueOnce(new Error('private token/host'));
    expect(await f.adapter.begin(scope, 'p')).toEqual({ kind: 'unknown' });
    expect(await f.adapter.recover(scope)).toMatchObject({ kind: 'owned' });
    expect(f.createUser).toHaveBeenCalledTimes(1);
  });
  it('checks current authority again after the pre-create read', async () => {
    const f = fixture();
    f.getUserById.mockResolvedValueOnce(absent());
    vi.mocked(f.settings.authorize).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await f.adapter.begin(scope, 'p')).toEqual({ kind: 'unknown' });
    expect(f.createUser).not.toHaveBeenCalled();
  });
  it('identifies an existing email only from a definitive create rejection plus missing exact ID', async () => {
    const f = fixture();
    f.getUserById.mockResolvedValue(absent());
    f.createUser.mockResolvedValueOnce({
      data: { user: null } as never,
      error: { code: 'email_exists', status: 422 },
    });
    expect(await f.adapter.begin(scope, 'p')).toEqual({ kind: 'existing' });
    expect(f.createUser).toHaveBeenCalledTimes(1);
    expect(f.forbidden.listUsers).not.toHaveBeenCalled();
  });
});
