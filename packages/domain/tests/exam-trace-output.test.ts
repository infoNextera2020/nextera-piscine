import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { EXAM_TRACE_COMPARATOR_V1, compareExamTraceOutput } from '../exam-trace-output';

const bytes = (text: string) => new TextEncoder().encode(text);
const compare = (a: string, b: string) =>
  compareExamTraceOutput(bytes(a), bytes(b), EXAM_TRACE_COMPARATOR_V1);

describe('versioned Exam1 trace output byte policy', () => {
  it.each([
    ['', ''],
    ['', '\n'],
    ['\r\n', ''],
    ['one\r\ntwo\r\n', 'one\ntwo'],
    ['one\r\ntwo', 'one\ntwo\n'],
    ['one\n\n', 'one\r\n\r\n'],
    ['مرحبا\r\n', 'مرحبا'],
  ])('accepts only approved line-ending/one-terminal-LF equivalence (%j, %j)', (a, b) => {
    expect(compare(a, b)).toBe(true);
    expect(compare(b, a)).toBe(true);
  });
  it.each([
    ['\n\n', ''],
    ['one\n\n', 'one'],
    ['one\n\n', 'one\n'],
    ['one\r', 'one'],
    ['one\rtwo', 'one\ntwo'],
    [' one', 'one'],
    ['one ', 'one'],
    ['a\tb', 'a b'],
    ['\ufeffone', 'one'],
    ['é', 'e\u0301'],
    ['1\n2', '2\n1'],
    ['1', '01'],
    ['a\0', 'a'],
  ])('preserves remaining bytes (%j, %j)', (a, b) => {
    expect(compare(a, b)).toBe(false);
    expect(compare(b, a)).toBe(false);
  });
  it('leaves historical exact_utf8 semantics exact', () => {
    expect(compareExamTraceOutput(bytes('a\r\n'), bytes('a\n'), 'exact_utf8')).toBe(false);
    expect(compareExamTraceOutput(bytes('a\n'), bytes('a'), 'exact_utf8')).toBe(false);
    expect(compareExamTraceOutput(bytes('\ufeffé\0'), bytes('\ufeffé\0'), 'exact_utf8')).toBe(true);
  });
  it.each([
    [0x80],
    [0xc0, 0x80],
    [0xc1, 0xbf],
    [0xc2],
    [0xc2, 0x7f],
    [0xe0, 0x9f, 0xbf],
    [0xe2, 0x82],
    [0xed, 0xa0, 0x80],
    [0xf0, 0x8f, 0xbf, 0xbf],
    [0xf4, 0x90, 0x80, 0x80],
    [0xf5, 0x80, 0x80, 0x80],
    [0xff],
  ])('rejects malformed UTF-8 in either operand without replacement: %j', (...bad) => {
    for (const version of ['exact_utf8', EXAM_TRACE_COMPARATOR_V1] as const) {
      expect(() => compareExamTraceOutput(new Uint8Array(bad), bytes('�'), version)).toThrow(
        'EXAM_TRACE_OUTPUT_INVALID',
      );
      expect(() => compareExamTraceOutput(bytes('�'), new Uint8Array(bad), version)).toThrow(
        'EXAM_TRACE_OUTPUT_INVALID',
      );
    }
  });
  it('accepts valid scalar boundaries, NUL and an explicit replacement character as their own bytes', () => {
    const text = '\u0000\u007f\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}\u{10ffff}�';
    expect(compare(text, text)).toBe(true);
  });
  it('does not mutate inputs or bytes outside subarray boundaries', () => {
    const backing = bytes('prefix:a\r\n:suffix');
    const before = backing.slice();
    const actual = backing.subarray(7, 10);
    const expected = bytes('a');
    expect(compareExamTraceOutput(actual, expected, EXAM_TRACE_COMPARATOR_V1)).toBe(true);
    expect(backing).toEqual(before);
    expect(expected).toEqual(bytes('a'));
  });
  it('requires an explicitly supported comparator and byte inputs', () => {
    expect(() => compareExamTraceOutput(bytes(''), bytes(''), undefined as never)).toThrow(
      'EXAM_TRACE_COMPARATOR_INVALID',
    );
    expect(() =>
      compareExamTraceOutput('a' as never, bytes('a'), EXAM_TRACE_COMPARATOR_V1),
    ).toThrow('EXAM_TRACE_OUTPUT_INVALID');
  });

  it('uses intrinsic view coordinates when own byteLength/length values are shadowed', () => {
    const value = bytes('a');
    Object.defineProperties(value, { byteLength: { value: 2 }, length: { value: 2 } });
    expect(compareExamTraceOutput(value, bytes('a'), 'exact_utf8')).toBe(true);
    expect(compareExamTraceOutput(value, new Uint8Array([0x61, 0]), 'exact_utf8')).toBe(false);
  });
  it('never invokes own coordinate, constructor, tag or iterator getters', () => {
    const value = bytes('a');
    const get = vi.fn(() => {
      throw new Error('must not execute');
    });
    for (const key of [
      'byteLength',
      'length',
      'buffer',
      'byteOffset',
      'constructor',
      Symbol.toStringTag,
      Symbol.iterator,
    ])
      Object.defineProperty(value, key, { get });
    expect(compareExamTraceOutput(value, bytes('a'), EXAM_TRACE_COMPARATOR_V1)).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });
  it('supports Buffer views while rejecting shared, resizable, detached and other view kinds', () => {
    const buffer = Buffer.from([
      112, 114, 101, 102, 105, 120, 58, 97, 13, 10, 58, 115, 117, 102, 102, 105, 120,
    ]);
    expect(
      compareExamTraceOutput(buffer.subarray(7, 10), bytes('a'), EXAM_TRACE_COMPARATOR_V1),
    ).toBe(true);
    const invalid = [
      new Uint8Array(new SharedArrayBuffer(1)),
      new Uint8Array(Reflect.construct(ArrayBuffer, [1, { maxByteLength: 2 }]) as ArrayBuffer),
      new Uint8ClampedArray([0x61]),
      new Uint16Array([0x61]),
      new DataView(new ArrayBuffer(1)),
    ];
    const detached = new Uint8Array([0x61]);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    invalid.push(detached);
    for (const view of invalid)
      expect(() =>
        compareExamTraceOutput(view as Uint8Array, bytes('a'), EXAM_TRACE_COMPARATOR_V1),
      ).toThrow('EXAM_TRACE_OUTPUT_INVALID');
  });
});
