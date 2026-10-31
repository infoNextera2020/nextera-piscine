import type { AnswerBodyPolicy } from './answer-http';
/** Explicit infrastructure bounds, never an implicit grading or retention policy. */
export function checkpointAnswerHttpPolicy(value: unknown): AnswerBodyPolicy | null {
  try {
    if (typeof value !== 'string') return null;
    const parsed = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(',') !== 'bodyTimeoutMs,maxBodyBytes,version' ||
      parsed.version !== 1 ||
      !Number.isSafeInteger(parsed.maxBodyBytes) ||
      parsed.maxBodyBytes <= 0 ||
      parsed.maxBodyBytes > 262144 ||
      !Number.isSafeInteger(parsed.bodyTimeoutMs) ||
      parsed.bodyTimeoutMs <= 0 ||
      parsed.bodyTimeoutMs > 2147483647
    )
      return null;
    return Object.freeze({
      maxBodyBytes: parsed.maxBodyBytes,
      bodyTimeoutMs: parsed.bodyTimeoutMs,
    });
  } catch {
    return null;
  }
}
