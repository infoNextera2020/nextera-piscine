import { createHash } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { ActivationScope, AuthResult, ManagedAuthPort } from './activation';

type AdminClient = Pick<SupabaseClient['auth']['admin'], 'createUser' | 'getUserById'>;
export type ManagedAuthSettings = Readonly<{
  enabled: boolean;
  admin: AdminClient | null;
  /** Explicit reviewed policy. No default auto-confirmation or verification flow is inferred. */
  emailConfirmed: boolean;
  passwordAccepted(password: string): Promise<boolean>;
  /** Must check current stored admission, invitation expiry/revocation and exact scope. */
  authorize(scope: ActivationScope): Promise<boolean>;
}>;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const MARKER = 'nextera_invitation_activation';
function validScope(s: ActivationScope) {
  return (
    s.role === 'learner' &&
    [s.operationReference, s.admissionId, s.cohortId].every((id) => UUID.test(id)) &&
    !!s.email &&
    s.email.length <= 320 &&
    !!s.displayName.trim() &&
    s.displayName.length <= 120
  );
}
export function invitationOwnershipProof(scope: ActivationScope) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'nextera-invitation-v1',
        scope.operationReference,
        scope.admissionId,
        scope.email,
        scope.displayName,
        scope.cohortId,
        'learner',
      ]),
    )
    .digest('hex');
}
function owns(user: User, scope: ActivationScope, confirmed: boolean) {
  const marker: unknown = user.app_metadata?.[MARKER];
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return false;
  const proof = marker as Record<string, unknown>;
  return (
    user.id === scope.operationReference &&
    user.email === scope.email &&
    (!confirmed || !!user.email_confirmed_at) &&
    proof.version === 1 &&
    proof.operation_reference === scope.operationReference &&
    proof.scope_digest === invitationOwnershipProof(scope)
  );
}
/**
 * Prepared factory only; receives an already-authorized SDK-shaped client.
 * Constructing it never creates a client, reads environment, sends mail or makes a request.
 * SDK evidence: installed @supabase/auth-js2.118.0 AdminUserAttributes.id/app_metadata,
 * GoTrueAdminApi.createUser POSTs those attributes; getUserById reads the exact ID.
 * Provider support is integration-unverified. Recovery resumes ORIGINAL credential creation;
 * a password entered on a retry does not reset/update the existing password. No update API exists here.
 */
export function createManagedAuthAdapter(
  settings: ManagedAuthSettings | null,
): ManagedAuthPort | null {
  if (
    !settings?.enabled ||
    !settings.admin ||
    typeof settings.emailConfirmed !== 'boolean' ||
    typeof settings.authorize !== 'function' ||
    typeof settings.passwordAccepted !== 'function'
  )
    return null;
  const config = settings,
    admin = settings.admin;
  type Found = { kind: 'owned'; user: User } | { kind: 'missing' | 'existing' | 'unknown' };
  async function find(scope: ActivationScope): Promise<Found> {
    try {
      const result = await admin.getUserById(scope.operationReference);
      if (result.error)
        return result.error.code === 'user_not_found' && result.error.status === 404
          ? { kind: 'missing' }
          : { kind: 'unknown' };
      if (!result.data.user) return { kind: 'unknown' };
      return owns(result.data.user, scope, config.emailConfirmed)
        ? { kind: 'owned', user: result.data.user }
        : { kind: 'existing' };
    } catch {
      return { kind: 'unknown' };
    }
  }
  function outcome(found: Found, scope: ActivationScope): AuthResult {
    return found.kind === 'owned'
      ? {
          kind: 'owned',
          operationReference: scope.operationReference,
          authUserId: found.user.id,
          email: scope.email,
        }
      : { kind: found.kind === 'existing' ? 'existing' : 'unknown' };
  }
  return {
    async begin(scope, password) {
      try {
        if (
          !validScope(scope) ||
          !(await config.authorize(scope)) ||
          typeof password !== 'string' ||
          !password ||
          !(await config.passwordAccepted(password))
        )
          return { kind: 'unknown' };
        const before = await find(scope);
        if (before.kind !== 'missing') return outcome(before, scope);
        if (!(await config.authorize(scope))) return { kind: 'unknown' };
        const created = await admin.createUser({
          id: scope.operationReference,
          email: scope.email,
          password,
          email_confirm: config.emailConfirmed,
          app_metadata: {
            [MARKER]: {
              version: 1,
              operation_reference: scope.operationReference,
              scope_digest: invitationOwnershipProof(scope),
            },
          },
        });
        if (
          !created.error &&
          created.data.user &&
          owns(created.data.user, scope, config.emailConfirmed)
        )
          return outcome({ kind: 'owned', user: created.data.user }, scope);
        // An error/ambiguous response may follow a committed create. Read exact ID only, never create again.
        const recovered = await find(scope);
        if (
          recovered.kind === 'missing' &&
          created.error &&
          ['email_exists', 'user_already_exists'].includes(created.error.code ?? '')
        )
          return { kind: 'existing' };
        return outcome(recovered, scope);
      } catch {
        return { kind: 'unknown' };
      }
    },
    async recover(scope) {
      try {
        if (!validScope(scope) || !(await config.authorize(scope))) return { kind: 'unknown' };
        return outcome(await find(scope), scope);
      } catch {
        return { kind: 'unknown' };
      }
    },
  };
}
