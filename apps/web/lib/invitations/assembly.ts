import { createHash } from 'node:crypto';
import { createInvitationActivation, type ActivationPolicy } from './activation';
import { createPostgresInvitationAdmission, type InvitationAdmissionSettings } from './admission';
import { createInvitationActivationHandler, type InvitationHttpSettings } from './http';
import { createInvitationInspectionHandler } from './inspection-http';
import { createManagedAuthAdapter, type ManagedAuthSettings } from './managed-auth';
import { createPostgresInvitationLedger } from './postgres-ledger';

export type InvitationAssemblySettings = Readonly<{
  enabled: boolean;
  admission: InvitationAdmissionSettings | null;
  policy: ActivationPolicy | null;
  admin: ManagedAuthSettings['admin'];
  now: (() => number) | null;
  http: Omit<InvitationHttpSettings, 'activation' | 'ingress'> | null;
}>;
function unavailable() {
  return {
    POST: createInvitationActivationHandler(null),
    INSPECT: createInvitationInspectionHandler(null),
  };
}
/** Source assembly only. No default password/expiry/rate/origin/confirmation policy or client. */
export function createInvitationAssembly(settings: InvitationAssemblySettings | null) {
  if (
    !settings?.enabled ||
    !settings.admission ||
    !settings.policy?.enabled ||
    ![
      settings.policy.maxTokenBytes,
      settings.policy.maxPasswordBytes,
      settings.policy.claimLeaseMs,
    ].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647) ||
    typeof settings.policy.acceptsPassword !== 'function' ||
    !settings.http ||
    !settings.now
  )
    return unavailable();
  const admission = createPostgresInvitationAdmission(settings.admission);
  const ledger = createPostgresInvitationLedger(settings.admission);
  const auth = createManagedAuthAdapter({
    enabled: settings.enabled,
    admin: settings.admin,
    emailConfirmed: settings.admission.policy?.emailConfirmed as boolean,
    passwordAccepted: settings.policy.acceptsPassword,
    authorize: async (scope) => (admission ? admission.eligibility.current(scope) : false),
  });
  if (!admission || !ledger || !auth) return unavailable();
  const activation = createInvitationActivation({
    policy: settings.policy,
    ledger,
    auth,
    enrollment: admission.enrollment,
    eligibility: admission.eligibility,
    rate: admission.rate,
    digestToken: async (token) => createHash('sha256').update(token, 'utf8').digest('hex'),
    now: settings.now,
  });
  return {
    POST: createInvitationActivationHandler({
      ...settings.http,
      ingress: admission.ingress,
      activation,
    }),
    INSPECT: createInvitationInspectionHandler({
      ...settings.http,
      ingress: admission.ingress,
      inspection: activation,
    }),
  };
}
