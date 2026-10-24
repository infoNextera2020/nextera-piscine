import { describe, expect, it, vi } from 'vitest';
import { SubmissionIntents } from './retry-intent';
import { historyFailureMessage, uploadFailureMessage } from './messages';

const first = '10000000-0000-4000-8000-000000000001';
const second = '10000000-0000-4000-8000-000000000002';
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
describe('submission upload intent', () => {
  it('reuses an unconfirmed ID across retries and a remount', () => {
    const saved = storage();
    const generate = vi.fn().mockReturnValue(first);
    const intents = new SubmissionIntents(() => saved, generate);
    expect(intents.requestId('file-digest')).toBe(first);
    expect(intents.requestId('file-digest')).toBe(first);
    expect(new SubmissionIntents(() => saved, generate).requestId('file-digest')).toBe(first);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('starts a fresh attempt for the same file only after a confirmed receipt', () => {
    const saved = storage();
    const generate = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const intents = new SubmissionIntents(() => saved, generate);
    expect(intents.requestId('file-digest')).toBe(first);
    intents.confirm('file-digest');
    expect(saved.getItem('file-digest')).toBeNull();
    expect(intents.requestId('file-digest')).toBe(second);
    expect(intents.requestId('file-digest')).toBe(second);
  });
  it('retains safe in-memory retries if browser storage access is blocked', () => {
    const intents = new SubmissionIntents(() => {
      throw new Error('Storage blocked');
    }, vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second));
    expect(intents.requestId('file-digest')).toBe(first);
    expect(intents.requestId('file-digest')).toBe(first);
    expect(() => intents.confirm('file-digest')).not.toThrow();
    expect(intents.requestId('file-digest')).toBe(second);
  });
  it('does not reuse a confirmed stored ID when storage removal is blocked', () => {
    const saved = {
      getItem: () => first,
      setItem: () => {},
      removeItem: () => {
        throw new Error();
      },
    };
    const intents = new SubmissionIntents(
      () => saved,
      () => second,
    );
    expect(intents.requestId('file-digest')).toBe(first);
    intents.confirm('file-digest');
    expect(intents.requestId('file-digest')).toBe(second);
  });
  it('ignores corrupted stored IDs and separates different source digests', () => {
    const saved = storage();
    saved.setItem('a', 'invalid');
    const intents = new SubmissionIntents(
      () => saved,
      vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
    );
    expect(intents.requestId('a')).toBe(first);
    expect(intents.requestId('b')).toBe(second);
  });
});
describe('safe integration feedback', () => {
  it('distinguishes expired sessions, denied access, rejected files and service outages', () => {
    expect(uploadFailureMessage(401)).toContain('Sign in again');
    expect(uploadFailureMessage(403)).toContain('access');
    expect(uploadFailureMessage(400)).toContain('filename');
    expect(uploadFailureMessage(413)).toContain('file size');
    expect(uploadFailureMessage(409)).toContain('conflicts');
    expect(uploadFailureMessage(503)).toContain('temporarily unavailable');
    expect(uploadFailureMessage(500)).toContain('not be confirmed');
    expect(historyFailureMessage(401)).toContain('Sign in again');
    expect(historyFailureMessage(403)).toContain('access');
    expect(historyFailureMessage(401)).not.toContain('last confirmed record');
    expect(historyFailureMessage(403)).not.toContain('last confirmed record');
    expect(historyFailureMessage(400)).toContain('Reopen the challenge');
    expect(historyFailureMessage(503)).toContain('temporarily unavailable');
    expect(historyFailureMessage()).toContain('last confirmed record');
  });
});
