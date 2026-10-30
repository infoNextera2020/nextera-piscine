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
/** Server call site only. Reads one explicit public-policy value, never dotenv or provider secrets.
 * A future reviewed runtime assembly must bind these bounds to its activation transport policy.
 * Missing/incomplete policy leaves the actual signup path unavailable; nothing is enabled here.
 */
export function getInvitationSignupPolicy(): InvitationSignupPublicPolicy | null {
  return parseInvitationSignupPolicy(process.env.NEXTERA_INVITATION_BROWSER_POLICY);
}
