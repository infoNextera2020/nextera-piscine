import { createHash } from 'node:crypto';

export type IssuingIdentity = Readonly<{ id: string; role: string; active: boolean }>;
export type IssueScope = Readonly<{
  invitationId: string;
  requestId: string;
  issuerId: string;
  tokenDigest: string;
  email: string;
  displayName: string;
  cohortId: string;
  expiresAt: number;
}>;
export type IssuanceReceipt =
  | ({ kind: 'issued'; curriculumVersionId: string } & IssueScope)
  | { kind: 'already_issued' | 'conflict' | 'forbidden' | 'unknown' };
export interface InvitationIssuerRepository {
  /** One transaction: current issuer/cohort policy + acceptance + immutable digest-only ledger. */
  issue(scope: IssueScope): Promise<IssuanceReceipt>;
}
export type ManualInvitationSettings = Readonly<{
  enabled: boolean;
  repository: InvitationIssuerRepository | null;
  /** Resolve verified server identity, never form fields or unverified session metadata. */
  identity: (() => Promise<IssuingIdentity | null>) | null;
  rate: { consume(issuerId: string): Promise<boolean> } | null;
  policy: Readonly<{
    ownerIds: readonly string[];
    maxLifetimeMs: number;
    signupOrigin: string;
  }> | null;
  /** Required provider-compatible canonicalization, not an invented email policy. */
  canonicalEmail: ((email: string) => string | null) | null;
  /** Production must inject a CSPRNG 32-byte base64url capability and independent UUID. */
  capability: (() => Promise<{ invitationId: string; token: string }>) | null;
  now: (() => number) | null;
}>;
export type IssueOutcome =
  | { status: 'issued'; link: string; expiresAt: number }
  | {
      status:
        | 'unavailable'
        | 'forbidden'
        | 'invalid_input'
        | 'rate_limited'
        | 'already_issued'
        | 'conflict'
        | 'uncertain';
    };
const hasControl = (value: string) =>
  [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
function validOrigin(value: string) {
  try {
    const u = new URL(value);
    return u.origin === value && /^https?:$/.test(u.protocol);
  } catch {
    return false;
  }
}
/** Source-only factory: no environment reads, randomness, requests or persistence at construction. */
export function createManualInvitationIssuer(settings: ManualInvitationSettings | null) {
  const owners = settings?.policy?.ownerIds
    ? settings.policy.ownerIds.map((id) => id.toLowerCase())
    : [];
  const maxLifetime = settings?.policy?.maxLifetimeMs;
  const signupOrigin = settings?.policy?.signupOrigin;
  const configured = !!(
    settings?.enabled &&
    settings.repository &&
    settings.identity &&
    settings.rate &&
    settings.canonicalEmail &&
    settings.capability &&
    settings.now &&
    owners.length &&
    owners.every((id) => UUID.test(id)) &&
    new Set(owners).size === owners.length &&
    Number.isSafeInteger(maxLifetime) &&
    maxLifetime! > 0 &&
    typeof signupOrigin === 'string' &&
    validOrigin(signupOrigin)
  );
  return {
    async issue(input: unknown): Promise<IssueOutcome> {
      if (!configured) return { status: 'unavailable' };
      let mayHaveCommitted = false;
      try {
        const actor = await settings!.identity!();
        if (!actor?.active || actor.role !== 'admin' || !owners.includes(actor.id.toLowerCase()))
          return { status: 'forbidden' };
        if (!(await settings!.rate!.consume(actor.id.toLowerCase())))
          return { status: 'rate_limited' };
        if (!input || typeof input !== 'object' || Array.isArray(input))
          return { status: 'invalid_input' };
        const form = input as Record<string, unknown>;
        if (
          Object.keys(form).sort().join(',') !== 'cohortId,displayName,email,expiresAt,requestId' ||
          typeof form.requestId !== 'string' ||
          !UUID.test(form.requestId) ||
          typeof form.cohortId !== 'string' ||
          !UUID.test(form.cohortId) ||
          typeof form.email !== 'string' ||
          !form.email ||
          form.email.length > 320 ||
          /\s/.test(form.email) ||
          hasControl(form.email) ||
          typeof form.displayName !== 'string' ||
          !form.displayName.trim() ||
          form.displayName.length > 120 ||
          hasControl(form.displayName) ||
          typeof form.expiresAt !== 'number' ||
          !Number.isSafeInteger(form.expiresAt)
        )
          return { status: 'invalid_input' };
        const email = settings!.canonicalEmail!(form.email);
        if (!email || email.length > 320 || /\s/.test(email) || hasControl(email))
          return { status: 'invalid_input' };
        const now = settings!.now!();
        if (
          !Number.isSafeInteger(now) ||
          form.expiresAt <= now ||
          form.expiresAt - now > maxLifetime!
        )
          return { status: 'invalid_input' };
        const generated = await settings!.capability!();
        if (!UUID.test(generated.invitationId) || !CAPABILITY.test(generated.token))
          return { status: 'unavailable' };
        const scope: IssueScope = {
          invitationId: generated.invitationId.toLowerCase(),
          requestId: form.requestId.toLowerCase(),
          issuerId: actor.id.toLowerCase(),
          tokenDigest: createHash('sha256').update(generated.token, 'ascii').digest('hex'),
          email,
          displayName: form.displayName,
          cohortId: form.cohortId.toLowerCase(),
          expiresAt: form.expiresAt,
        };
        // The repository rechecks the database clock, issuer, policy and pinned version atomically.
        mayHaveCommitted = true;
        const receipt = await settings!.repository!.issue(scope);
        if (receipt.kind !== 'issued')
          return { status: receipt.kind === 'unknown' ? 'uncertain' : receipt.kind };
        if (
          !UUID.test(receipt.curriculumVersionId) ||
          Object.entries(scope).some(([key, value]) => receipt[key as keyof IssueScope] !== value)
        )
          return { status: 'uncertain' };
        const link = new URL('/signup', signupOrigin);
        link.hash = new URLSearchParams({ invitation: generated.token }).toString();
        return { status: 'issued', link: link.href, expiresAt: scope.expiresAt };
      } catch {
        // No token rotation, silent create retry, provider error or raw capability in diagnostics.
        return { status: mayHaveCommitted ? 'uncertain' : 'unavailable' };
      }
    },
  };
}
