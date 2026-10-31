import 'server-only';
import { createHash } from 'node:crypto';
import {
  captureScoredExamCodeUploadInput,
  readScoredExamCodeReceipt,
  reserveScoredExamCodeUpload,
  acceptScoredExamCodeUpload,
  ScoredExamCodeUploadError,
  type ScoredExamCodeUploadClient,
  type ScoredExamCodeUploadInput,
  type ScoredExamCodeReservation,
  type ScoredExamCodeUploadResult,
} from '@nextera/db/scored-exam-code-upload';
import { createClient } from '../supabase/server';
export { ScoredExamCodeUploadError };
export type ScoredExamCodeStoragePolicy = Readonly<{ version: 1; timeoutMs: number }>;
export type ScoredExamCodeStoragePort = Readonly<{
  storeAndVerify(
    reservation: ScoredExamCodeReservation,
    source: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void>;
}>;
/** Required explicit operation bound, no implicit timeout or activation default. */
export function scoredExamCodeStoragePolicy(
  raw: string | undefined,
): ScoredExamCodeStoragePolicy | null {
  try {
    const p = JSON.parse(raw ?? '') as Record<string, unknown>;
    if (
      !p ||
      typeof p !== 'object' ||
      Array.isArray(p) ||
      Object.keys(p).length !== 2 ||
      p.version !== 1 ||
      !Number.isSafeInteger(p.timeoutMs) ||
      Number(p.timeoutMs) < 1 ||
      Number(p.timeoutMs) > 2147483647
    )
      return null;
    return Object.freeze({ version: 1, timeoutMs: Number(p.timeoutMs) });
  } catch {
    return null;
  }
}
function unknown(): never {
  throw new ScoredExamCodeUploadError('outcome_unknown');
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
/** Existing authenticated learner cookie client only. INSERT+SELECT, never upsert/delete.
 * A timed-out SDK INSERT can finish later: its immutable reservation remains charged.
 * No late operation can invoke finalization after timeout/abort.
 */
export function createScoredExamCodeStoragePort(
  policy: ScoredExamCodeStoragePolicy,
): ScoredExamCodeStoragePort {
  const parsed = scoredExamCodeStoragePolicy(JSON.stringify(policy));
  if (!parsed) throw new ScoredExamCodeUploadError('unavailable');
  return Object.freeze({
    async storeAndVerify(r: ScoredExamCodeReservation, bytes: Uint8Array, outer?: AbortSignal) {
      if (outer?.aborted || bytes.byteLength !== r.byteLength || sha(bytes) !== r.answerSha256)
        return unknown();
      const controller = new AbortController();
      let rejectAbort!: () => void;
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new ScoredExamCodeUploadError('outcome_unknown'));
      });
      const abort = () => {
        controller.abort();
        rejectAbort();
      };
      const timer = setTimeout(abort, parsed.timeoutMs);
      outer?.addEventListener('abort', abort, { once: true });
      try {
        const client = await Promise.race([createClient(), aborted]);
        if (controller.signal.aborted || outer?.aborted) return unknown();
        const bucket = client.storage.from(r.bucket);
        // Upload errors may mean a prior concurrent immutable INSERT won. Read back
        // exact bytes, never overwrite or choose a fresh key to conceal uncertainty.
        await Promise.race([
          bucket.upload(r.objectKey, bytes, {
            contentType: 'application/octet-stream',
            upsert: false,
          }),
          aborted,
        ]);
        if (controller.signal.aborted || outer?.aborted) return unknown();
        const { data, error } = await Promise.race([
          bucket.download(r.objectKey, {}, { signal: controller.signal }),
          aborted,
        ]);
        if (error || !data || data.size !== r.byteLength || data.size > 262144) return unknown();
        const actual = new Uint8Array(await Promise.race([data.arrayBuffer(), aborted]));
        if (
          controller.signal.aborted ||
          outer?.aborted ||
          actual.byteLength !== r.byteLength ||
          sha(actual) !== r.answerSha256
        )
          return unknown();
      } catch {
        return unknown();
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener('abort', abort);
        controller.abort();
      }
    },
  });
}
/** Receipt-first, reservation-before-upload, exact-source finalization.
 * A proved denial or exact replay never constructs the Storage client.
 * After any uncertain reservation/upload/accept outcome retry the SAME exact input.
 */
export async function submitScoredExamCode(
  client: ScoredExamCodeUploadClient,
  input: ScoredExamCodeUploadInput,
  source: Uint8Array,
  signal?: AbortSignal,
  storage?: ScoredExamCodeStoragePort | null,
): Promise<ScoredExamCodeUploadResult> {
  const i = captureScoredExamCodeUploadInput(input),
    bytes = Uint8Array.from(source);
  if (bytes.byteLength !== i.byteLength || sha(bytes) !== i.answerSha256)
    throw new ScoredExamCodeUploadError('invalid_input');
  if (signal?.aborted) throw new ScoredExamCodeUploadError('unavailable');
  const receipt = await readScoredExamCodeReceipt(client, i);
  if (receipt.kind !== 'absent') return receipt;
  if (signal?.aborted) throw new ScoredExamCodeUploadError('unavailable');
  // Missing policy blocks NEW reservations, but does not suppress exact receipts.
  const p = scoredExamCodeStoragePolicy(process.env.CHECKPOINT_SCORED_CODE_STORAGE_POLICY_V1);
  const port = storage === undefined ? (p ? createScoredExamCodeStoragePort(p) : null) : storage;
  if (!port) return Object.freeze({ kind: 'unavailable' });
  const admission = await reserveScoredExamCodeUpload(client, i);
  if (admission.kind !== 'reserved') return admission;
  if (signal?.aborted) return unknown();
  try {
    await port.storeAndVerify(admission, bytes, signal);
  } catch {
    return unknown();
  }
  if (signal?.aborted) return unknown();
  return acceptScoredExamCodeUpload(client, i);
}
