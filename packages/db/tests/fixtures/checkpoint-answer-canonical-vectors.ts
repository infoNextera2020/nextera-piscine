import type { AnswerKind } from '../../queries/checkpoint-answer-drafts';

/** Synthetic source-only vectors. Reusable by a separately authorized native rehearsal;
 * generating or checking these vectors opens no database connection. */
export const answerKinds = ['trace_with_reason', 'debug_with_reason'] as const;
const fields = {
  trace_with_reason: ['output', 'reason'],
  debug_with_reason: ['source', 'explanation', 'counterexample'],
} as const;
export function tokenAnswerPayload(kind: AnswerKind, token: string) {
  return (
    '{"version":1,"kind":' +
    JSON.stringify(kind) +
    ',' +
    fields[kind].map((key) => JSON.stringify(key) + ':' + token).join(',') +
    '}'
  );
}
export function canonicalAnswerPayload(kind: AnswerKind, text: string) {
  return tokenAnswerPayload(kind, JSON.stringify(text));
}
export function* canonicalAnswerVectors(kind: AnswerKind) {
  const token = (name: string, value: string, valid: boolean) => ({
    name,
    kind,
    payload: tokenAnswerPayload(kind, value),
    valid,
  });
  for (const [name, text] of [
    ['empty', ''],
    ['exact-text', '\uFEFF  ب\r\n\u0000'],
    ['literal-escape-text', '\\u0000\\uD800\\n'],
    ['embedded-shape', '"},"reason":"other","extra":true,{"'],
    ['all-controls', Array.from({ length: 32 }, (_, n) => String.fromCharCode(n)).join('')],
    ['all-ASCII', Array.from({ length: 128 }, (_, n) => String.fromCharCode(n)).join('')],
  ])
    yield token(name!, JSON.stringify(text), true);
  for (const point of [
    0x20, 0x22, 0x5c, 0x7f, 0x80, 0x9f, 0xa0, 0x2028, 0x2029, 0xd7ff, 0xe000, 0xfeff, 0xfffd,
    0xfffe, 0xffff, 0x10000, 0x1ffff, 0xe0001, 0x10ffff,
  ])
    yield token('scalar-' + point.toString(16), JSON.stringify(String.fromCodePoint(point)), true);
  for (let point = 0; point < 32; point++) {
    const text = String.fromCharCode(point);
    yield token('control-canonical-' + point, JSON.stringify(text), true);
    yield token('control-raw-' + point, '"' + text + '"', false);
    const upper = '\\u' + point.toString(16).padStart(4, '0').toUpperCase();
    yield token(
      'control-upper-alias-' + point,
      '"' + upper + '"',
      JSON.stringify(text) === '"' + upper + '"',
    );
  }
  // Every four-hex lowercase Unicode escape, including all 2048 lone surrogates.
  // JSON.stringify emits Unicode escapes only for C0 controls without a short escape.
  const short = new Set([8, 9, 10, 12, 13]);
  for (let point = 0; point <= 0xffff; point++)
    yield token(
      'unicode-escape-' + point.toString(16).padStart(4, '0'),
      '"\\u' + point.toString(16).padStart(4, '0') + '"',
      point < 32 && !short.has(point),
    );
  // Every ASCII character after a single backslash: all permitted short escapes,
  // quote/backslash, and every invalid/simple/short-octal/unfinished Unicode form.
  for (let point = 0; point < 128; point++) {
    const suffix = String.fromCharCode(point);
    yield token('backslash-ASCII-' + point, '"\\' + suffix + '"', '"\\bfnrt'.includes(suffix));
  }
  for (const spelling of [
    '\\ud800\\udc00',
    '\\udbff\\udfff',
    '\\uD800\\uDC00',
    '\\udc00\\ud800',
    '\\u000',
    '\\u00gg',
    '\\U00000000',
    '\\x00',
    '\\u{0}',
    '\\u{1f600}',
  ])
    yield token('noncanonical-escape-' + spelling, '"' + spelling + '"', false);
  for (let point = 0xd800; point <= 0xdfff; point++)
    yield token(
      'raw-lone-surrogate-' + point.toString(16),
      '"' + String.fromCharCode(point) + '"',
      false,
    );
  const empty = canonicalAnswerPayload(kind, '');
  for (const [name, payload] of [
    ['leading-space', ' ' + empty],
    ['trailing-space', empty + ' '],
    ['leading-newline', '\n' + empty],
    ['trailing-newline', empty + '\n'],
    ['outer-BOM', '\uFEFF' + empty],
    ['extra-object', empty + empty],
    ['extra-key', empty.slice(0, -1) + ',"extra":true}'],
    ['duplicate-key', empty.replace('"version":1', '"version":1,"version":1')],
    [
      'reordered-keys',
      empty.replace('"version":1,"kind":"' + kind + '"', '"kind":"' + kind + '","version":1'),
    ],
    ['escaped-key', empty.replace('"version"', '"\\u0076ersion"')],
    ['missing-field', empty.replace(',"' + fields[kind][0] + '":""', '')],
    ['unknown-field', empty.replace('"' + fields[kind][0] + '"', '"unknown"')],
    [
      'kind-substitution',
      empty.replace(kind, kind === 'trace_with_reason' ? 'debug_with_reason' : 'trace_with_reason'),
    ],
  ])
    yield { name: name!, kind, payload: payload!, valid: false };
  for (const version of ['1.0', '1e0', '2', '-0', '"1"', 'true', 'null'])
    yield {
      name: 'version-' + version,
      kind,
      payload: empty.replace('"version":1', '"version":' + version),
      valid: false,
    };
  for (const value of ['null', 'true', '0', '[]', '{}'])
    yield token('non-string-' + value, value, false);
  // Fixed LCG and scalar alphabet make this differential corpus reproducible.
  const alphabet = [
    'x',
    '"',
    '\\',
    '\u0000',
    '\b',
    '\t',
    '\n',
    '\r',
    '\u001f',
    '\u007f',
    '\uFEFF',
    'ب',
    '😀',
    '\u2028',
    '\u2029',
  ];
  let state = 0x21c0ffee;
  for (let sample = 0; sample < 256; sample++) {
    let text = '';
    for (let n = 0; n < 32; n++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      text += alphabet[state % alphabet.length];
    }
    yield token('deterministic-mixed-' + sample, JSON.stringify(text), true);
  }
}
/** Invalid UTF-8 scalar encodings, truncation, bad continuation and raw NUL text.
 * Insert each byte sequence inside a quoted answer field in an otherwise frozen shape. */
export const invalidTextFieldHex = [
  '00',
  '80',
  'bf',
  'c0af',
  'c1bf',
  'e080af',
  'eda080',
  'edb080',
  'f08080af',
  'f4908080',
  'f5808080',
  'fe',
  'ff',
  'c2',
  'e282',
  'f09f92',
  'e228a1',
  'f0288cbc',
] as const;
