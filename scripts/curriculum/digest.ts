import { createHash } from 'node:crypto';
export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
export type SourceFile = { path: string; bytes: Uint8Array };

/** v1: header, sorted UTF-8 paths (u32 length), exact file bytes (u64 length). */
export function contentDigest(files: readonly SourceFile[]): string {
  const hash = createHash('sha256').update('nextera-curriculum\0v1\0');
  const seen = new Set<string>();
  for (const file of [...files].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
  )) {
    if (
      !file.path ||
      file.path.includes('\\') ||
      file.path.split('/').some((p) => !p || p === '.' || p === '..') ||
      seen.has(file.path)
    )
      throw new Error('Invalid or duplicate curriculum file path.');
    seen.add(file.path);
    const path = Buffer.from(file.path, 'utf8');
    const pathLength = Buffer.alloc(4);
    const dataLength = Buffer.alloc(8);
    pathLength.writeUInt32BE(path.length);
    dataLength.writeBigUInt64BE(BigInt(file.bytes.length));
    hash.update(pathLength).update(path).update(dataLength).update(file.bytes);
  }
  return hash.digest('hex');
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  throw new Error('Evaluation specification must contain only finite JSON values.');
}
export const evaluationDigest = (spec: unknown) =>
  sha256(`nextera-evaluation-spec\0v1\0${canonicalJson(spec)}`);
