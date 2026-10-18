import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '../supabase/server';

export const sourceDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Authenticated object INSERT + SELECT only. Never upsert, update, or delete. */
export async function storeSource(
  authId: string,
  cohort: string,
  requestId: string,
  bytes: Uint8Array,
) {
  const digest = sourceDigest(bytes);
  const key = `${authId}/${cohort}/${requestId}/${digest}`;
  const bucket = (await createClient()).storage.from('nextera-submissions');
  const { error } = await bucket.upload(key, bytes, {
    contentType: 'application/octet-stream',
    upsert: false,
  });
  // Always read authoritative bytes, including a concurrent/previous immutable upload.
  const { data, error: readError } = await bucket.download(key);
  if (readError || !data || data.size !== bytes.byteLength || data.size > 262144)
    throw new Error(error ? 'STORAGE_UNAVAILABLE' : 'ARTIFACT_MISMATCH');
  if (sourceDigest(new Uint8Array(await data.arrayBuffer())) !== digest)
    throw new Error('ARTIFACT_MISMATCH');
  return digest;
}
