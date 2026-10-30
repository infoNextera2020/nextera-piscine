import { describe, expect, it } from 'vitest';
import { checkpointAnswerFormat } from '@nextera/domain';
import { selectExamQuestion } from './editor-contract';
import {
  captureMixedAnswer,
  checkpointAnswerActionBlock,
  checkpointSourceTaskKey,
  editMixedAnswer,
  emptyMixedAnswer,
  hasMixedAnswerDrafts,
  mixedAnswerDraft,
  serializeMixedAnswer,
  type MixedAnswerDrafts,
} from './checkpoint-answer';

const scope = {
  learnerId: 'learner',
  cohortId: 'cohort',
  attemptId: 'attempt',
  taskKey: 'trace-one',
  definitionDigest: 'a'.repeat(64),
};
const trace = {
  version: 1,
  kind: 'trace_with_reason',
  output: '\uFEFF  first\r\nب\n',
  reason: 'A brief authored reason.\r\n',
} as const;
const debug = {
  version: 1,
  kind: 'debug_with_reason',
  source: 'package piscine\r\n// corrected draft\n',
  explanation: 'Explanation draft',
  counterexample: 'Input and expected result draft',
} as const;

describe('mixed Checkpoint answers remain explicit local drafts', () => {
  it('freely switches questions while preserving every separate field and kind', () => {
    let drafts: MixedAnswerDrafts = {};
    let navigation = {
      taskKeys: ['trace-one', 'trace-two', 'debug'],
      selectedTaskKey: 'trace-one',
    };
    drafts = editMixedAnswer(drafts, 'trace-one', trace);
    navigation = selectExamQuestion(navigation, 'debug') as typeof navigation;
    drafts = editMixedAnswer(drafts, 'debug', debug);
    navigation = selectExamQuestion(navigation, 'trace-two') as typeof navigation;
    drafts = editMixedAnswer(drafts, 'trace-two', { ...trace, output: 'another output' });
    navigation = selectExamQuestion(navigation, 'trace-one') as typeof navigation;
    expect(navigation.selectedTaskKey).toBe('trace-one');
    expect(mixedAnswerDraft(drafts, 'trace-one', trace.kind)).toEqual(trace);
    expect(mixedAnswerDraft(drafts, 'trace-two', trace.kind).kind).toBe(trace.kind);
    expect(mixedAnswerDraft(drafts, 'debug', debug.kind)).toEqual(debug);
    expect(selectExamQuestion(navigation, 'unknown')).toBe(navigation);
    expect(hasMixedAnswerDrafts(drafts)).toBe(true);
  });
  it('does not reinterpret a previous draft when a task kind changes', () => {
    const drafts = editMixedAnswer({}, 'same-task', trace);
    expect(mixedAnswerDraft(drafts, 'same-task', debug.kind)).toEqual(emptyMixedAnswer(debug.kind));
    expect(mixedAnswerDraft(drafts, 'same-task', trace.kind)).toEqual(trace);
    expect(mixedAnswerDraft({}, 'constructor', trace.kind)).toEqual(emptyMixedAnswer(trace.kind));
    expect(hasMixedAnswerDrafts({ empty: emptyMixedAnswer(trace.kind) })).toBe(false);
  });
  it('excludes mixed responses from legacy source bootstrap, saving, submission and Run', () => {
    expect(checkpointSourceTaskKey(undefined)).toBe('');
    expect(checkpointSourceTaskKey({ key: 'legacy' })).toBe('legacy');
    for (const kind of [trace.kind, debug.kind]) {
      const format = checkpointAnswerFormat({ version: 1, kind });
      expect(checkpointSourceTaskKey({ key: 'mixed', answer_format: format })).toBe('');
      for (const action of ['save', 'submit', 'run'] as const)
        expect(checkpointAnswerActionBlock(format, action)).not.toBeNull();
    }
    expect(checkpointAnswerActionBlock(checkpointAnswerFormat(undefined), 'submit')).toBeNull();
    expect(() =>
      checkpointAnswerActionBlock({ version: 2, kind: trace.kind } as never, 'save'),
    ).toThrow();
  });
  it('retains invalid in-progress Unicode for correction and refuses to capture it', () => {
    const draft = { ...trace, reason: '\ud800' };
    const drafts = editMixedAnswer({}, 'trace', draft);
    expect(mixedAnswerDraft(drafts, 'trace', trace.kind)).toEqual(draft);
    expect(() => serializeMixedAnswer(draft, 1024)).toThrow('CHECKPOINT_ANSWER_INVALID');
  });
});

describe('versioned exact answer snapshot preparation does not imply a transport or grade', () => {
  it.each([trace, debug])(
    'freezes exact fields, identity and canonical payload for $kind',
    (answer) => {
      const identity = { ...scope };
      const snapshot = captureMixedAnswer(identity, answer, 4096);
      expect(JSON.parse(snapshot.payload)).toEqual(answer);
      expect(snapshot.answer).toEqual(answer);
      expect(snapshot.byteLength).toBe(new TextEncoder().encode(snapshot.payload).byteLength);
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.scope)).toBe(true);
      expect(Object.isFrozen(snapshot.answer)).toBe(true);
      identity.taskKey = 'later question';
      expect(snapshot.scope.taskKey).toBe('trace-one');
      expect(snapshot).not.toHaveProperty('grade');
      expect(snapshot).not.toHaveProperty('saved');
    },
  );
  it('uses stable property order without trimming or normalizing answer text', () => {
    const reordered = { reason: trace.reason, output: trace.output, kind: trace.kind, version: 1 };
    expect(serializeMixedAnswer(reordered, 4096).payload).toBe(
      serializeMixedAnswer(trace, 4096).payload,
    );
    const first = captureMixedAnswer(scope, trace, 4096);
    const later = { ...trace, reason: 'later edit' };
    expect(first.answer).toEqual(trace);
    expect(serializeMixedAnswer(later, 4096).payload).not.toBe(first.payload);
  });
  it('enforces the exact encoded payload boundary including JSON escaping and Unicode', () => {
    const prepared = serializeMixedAnswer({ ...trace, output: 'ب\r\n'.repeat(80) }, 4096);
    expect(serializeMixedAnswer(prepared.answer, prepared.byteLength).byteLength).toBe(
      prepared.byteLength,
    );
    expect(() => serializeMixedAnswer(prepared.answer, prepared.byteLength - 1)).toThrow(
      'CHECKPOINT_ANSWER_SIZE',
    );
    for (const maximum of [0, -1, NaN, Infinity, 262145])
      expect(() => serializeMixedAnswer(trace, maximum)).toThrow('CHECKPOINT_ANSWER_SIZE');
  });
  it.each([
    null,
    {},
    { ...trace, version: 2 },
    { ...trace, kind: 'coding' },
    { ...trace, reason: null },
    { version: 1, kind: trace.kind, output: '' },
    { ...trace, expectedOutput: 'private answer' },
    { ...debug, counterexample: 1 },
  ])('rejects unknown, mismatched or incomplete envelope shapes %#', (answer) =>
    expect(() => serializeMixedAnswer(answer, 4096)).toThrow(),
  );
  it('requires reasoning and all debug fields before a complete snapshot without grading text', () => {
    expect(() => captureMixedAnswer(scope, { ...trace, reason: ' ' }, 4096)).toThrow(
      'CHECKPOINT_ANSWER_INCOMPLETE',
    );
    for (const field of ['source', 'explanation', 'counterexample'])
      expect(() => captureMixedAnswer(scope, { ...debug, [field]: '' }, 4096)).toThrow(
        'CHECKPOINT_ANSWER_INCOMPLETE',
      );
    expect(captureMixedAnswer(scope, { ...trace, output: '' }, 4096).answer).toMatchObject({
      output: '',
    });
    expect(() => captureMixedAnswer({ ...scope, definitionDigest: '' }, trace, 4096)).toThrow(
      'CHECKPOINT_ANSWER_SCOPE',
    );
  });
});

describe('mixed-answer envelopes reject coerced kinds and inherited fields', () => {
  it.each([
    ['coding'],
    ['trace_with_reason'],
    ['debug_with_reason'],
    [],
    {},
    { toString: () => 'trace_with_reason' },
    1,
    true,
    null,
  ])('rejects a non-string kind at capture and local-edit boundaries %#', (kind) => {
    const candidate = { ...trace, kind };
    expect(() => serializeMixedAnswer(candidate, 4096)).toThrow();
    expect(() => editMixedAnswer({}, 'trace', candidate as never)).toThrow();
  });
  it.each([trace, debug])('requires every $kind field to be an own property', (answer) => {
    for (const field of Object.keys(answer)) {
      const own: Record<string, unknown> = { ...answer };
      const inherited = { [field]: own[field] };
      delete own[field];
      const candidate = Object.assign(Object.create(inherited), own, { unknown: true });
      expect(() => serializeMixedAnswer(candidate, 4096)).toThrow('CHECKPOINT_ANSWER_INVALID');
      expect(() => editMixedAnswer({}, 'question', candidate)).toThrow('CHECKPOINT_ANSWER_INVALID');
    }
  });
  it('rejects unknown own properties even when they are not enumerable JSON keys', () => {
    for (const key of ['unknown', Symbol('unknown')]) {
      const candidate = Object.defineProperty({ ...trace }, key, { value: true });
      expect(() => serializeMixedAnswer(candidate, 4096)).toThrow('CHECKPOINT_ANSWER_INVALID');
    }
  });
});
