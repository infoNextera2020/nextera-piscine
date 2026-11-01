/** Versioned, pure byte comparison. This does not evaluate a program or authorize grading. */
export const EXAM_TRACE_COMPARATOR_V1 = 'crlf_lf_optional_terminal_lf_v1' as const;
export type ExamTraceComparator = 'exact_utf8' | typeof EXAM_TRACE_COMPARATOR_V1;

const typedArrayPrototype: object = Object.getPrototypeOf(Uint8Array.prototype);
function getter(prototype: object, key: PropertyKey) {
  const get = Object.getOwnPropertyDescriptor(prototype, key)?.get;
  if (!get) throw new Error('EXAM_TRACE_OUTPUT_INVALID');
  return (value: unknown): unknown => get.call(value);
}
const typedTag = getter(typedArrayPrototype, Symbol.toStringTag);
const typedLength = getter(typedArrayPrototype, 'length');
const typedByteLength = getter(typedArrayPrototype, 'byteLength');
const typedBuffer = getter(typedArrayPrototype, 'buffer');
const typedOffset = getter(typedArrayPrototype, 'byteOffset');
const bufferLength = getter(ArrayBuffer.prototype, 'byteLength');
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const setBytes = Uint8Array.prototype.set;

function snapshot(value: Uint8Array): Uint8Array {
  try {
    // Intrinsics inspect the actual view, never caller-owned getters, lengths or iterators.
    if (typedTag(value) !== 'Uint8Array') throw new Error('invalid');
    const length = typedLength(value);
    const byteLength = typedByteLength(value);
    const buffer = typedBuffer(value) as ArrayBuffer;
    const offset = typedOffset(value);
    const capacity = bufferLength(buffer); // Also rejects SharedArrayBuffer.
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      byteLength !== length ||
      typeof offset !== 'number' ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      typeof capacity !== 'number' ||
      offset + length > capacity ||
      resizable?.call(buffer)
    )
      throw new Error('invalid');
    // Construction rejects detached buffers; no species constructor or input iterator runs.
    const source = new Uint8Array(buffer, offset, length);
    const bytes = new Uint8Array(length);
    setBytes.call(bytes, source);
    return bytes;
  } catch {
    throw new Error('EXAM_TRACE_OUTPUT_INVALID');
  }
}

function utf8(value: Uint8Array): Uint8Array {
  // Snapshot before comparison; never decode with replacement or mutate caller bytes.
  const bytes = snapshot(value);
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++]!;
    if (a <= 0x7f) continue;
    let rest: number;
    let lower = 0x80;
    let upper = 0xbf;
    if (a >= 0xc2 && a <= 0xdf) rest = 1;
    else if (a >= 0xe0 && a <= 0xef) {
      rest = 2;
      if (a === 0xe0) lower = 0xa0; // No overlong scalar.
      if (a === 0xed) upper = 0x9f; // No UTF-16 surrogate scalar.
    } else if (a >= 0xf0 && a <= 0xf4) {
      rest = 3;
      if (a === 0xf0) lower = 0x90;
      if (a === 0xf4) upper = 0x8f; // At most U+10FFFF.
    } else throw new Error('EXAM_TRACE_OUTPUT_INVALID');
    if (i + rest > bytes.length || bytes[i]! < lower || bytes[i]! > upper)
      throw new Error('EXAM_TRACE_OUTPUT_INVALID');
    i++;
    for (let j = 1; j < rest; j++, i++)
      if (bytes[i]! < 0x80 || bytes[i]! > 0xbf) throw new Error('EXAM_TRACE_OUTPUT_INVALID');
  }
  return bytes;
}

function approvedLines(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) i++;
    result[length++] = bytes[i]!;
  }
  if (length > 0 && result[length - 1] === 0x0a) length--;
  return result.subarray(0, length);
}

/**
 * Both inputs must be valid UTF-8, including under the historical exact comparator.
 * V1 converts CRLF to LF, then removes at most one final LF on each side.
 * Lone CR, BOM, spaces, tabs, blank lines, Unicode representation and all other bytes remain exact.
 * The version must be supplied explicitly from an independently verified frozen binding.
 */
export function compareExamTraceOutput(
  actual: Uint8Array,
  expected: Uint8Array,
  comparator: ExamTraceComparator,
): boolean {
  if (comparator !== 'exact_utf8' && comparator !== EXAM_TRACE_COMPARATOR_V1)
    throw new Error('EXAM_TRACE_COMPARATOR_INVALID');
  let a = utf8(actual);
  let b = utf8(expected);
  if (comparator === EXAM_TRACE_COMPARATOR_V1) {
    a = approvedLines(a);
    b = approvedLines(b);
  }
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
