/** Public client transport limits only. No identity, capability, provider client or secret. */
export type InvitationSignupPublicPolicy = Readonly<{
  enabled: true;
  timeoutMs: number;
  maxResponseBytes: number;
  maxPasswordBytes: number;
}>;
const positiveTimer = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
/** The existing transport allocation ceiling is not a product password policy or a default. */
const boundedBytes = (n: unknown): n is number => positiveTimer(n) && n <= 1_048_576;
export function parseInvitationSignupPolicy(value: unknown): InvitationSignupPublicPolicy | null {
  if (typeof value !== 'string' || value.length > 1024) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const p = parsed as Record<string, unknown>;
    if (
      Object.keys(p).sort().join(',') !== 'enabled,maxPasswordBytes,maxResponseBytes,timeoutMs' ||
      p.enabled !== true ||
      !positiveTimer(p.timeoutMs) ||
      !boundedBytes(p.maxResponseBytes) ||
      !boundedBytes(p.maxPasswordBytes)
    )
      return null;
    return Object.freeze({
      enabled: true,
      timeoutMs: p.timeoutMs,
      maxResponseBytes: p.maxResponseBytes,
      maxPasswordBytes: p.maxPasswordBytes,
    });
  } catch {
    return null;
  }
}
/** Request-time public projection from the same protected server configuration.
 * Independent environment JSON cannot enable signup. The parser above remains
 * a pure whitelist utility, never an activation switch. */
export async function getInvitationSignupPolicy(): Promise<InvitationSignupPublicPolicy | null> {
  const { getInvitationSignupPublicPolicy } = await import('./runtime-configuration');
  return getInvitationSignupPublicPolicy();
}
