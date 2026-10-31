import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { OperationalDatabase } from '../operations/curriculum';
import {
  createScoredExamIntakeClient,
  parseCheckpointTaskContext,
  checkpointTaskContext,
} from '../queries/checkpoints';
import {
  SCORED_EXAM_INTAKE_CONTEXT_SQL,
  ACCEPT_SCORED_EXAM_SUBMISSION_SQL,
} from '../queries/scored-exam-intake';
import {
  parseScoredExamContextMarker,
  readCheckpointEditorContext,
} from '../queries/checkpoint-editor-context';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const marker = { version: 1, form: 'A', rubricDigest: 'a'.repeat(64) };
const base = {
  user_id: id(1),
  cohort_id: id(2),
  rules: { required_files: ['answer.go'], max_size_kb: 4 },
};
const capability = {
  version: 1,
  allowed: true,
  status: 'open',
  authority: 'scored_exam_intake_v1',
};
const coding = {
  ...base,
  scoredExam: marker,
  answerFormat: { version: 1, kind: 'coding' },
  submission: capability,
};
const typed = {
  ...base,
  rules: { required_files: [], max_size_kb: 4 },
  scoredExam: marker,
  answerFormat: { version: 1, kind: 'trace_with_reason' },
  submission: { ...capability, authority: 'checkpoint_answers_v1' },
  answerContract: { version: 1, kind: 'trace_with_reason', maxBytes: 4096, digest: 'b'.repeat(64) },
  officialAnswerPolicy: { version: 1, gradedAllowance: 7 },
  answerEvaluator: {
    family: 'checkpoint_structured_answer',
    version: 1,
    kind: 'trace_with_reason',
    definitionDigest: 'c'.repeat(64),
    taskKey: 'q6',
    evaluatorKey: 'reviewed-evaluator',
    evaluatorDigest: 'd'.repeat(64),
  },
};
describe('marked Exam1 native task projection, never inferred from a browser task name', () => {
  it('preserves a legacy task without fabricating a scoring marker or new quota', () => {
    expect(parseCheckpointTaskContext(base, 'a')).toEqual(base);
    expect(parseCheckpointTaskContext(base, 'q1').scoredExam).toBeUndefined();
  });
  it('accepts source-only marked coding capability even when that task already passed elsewhere', () => {
    expect(parseCheckpointTaskContext(coding, 'q1')).toMatchObject(coding);
    const closed = { ...coding, submission: { ...capability, allowed: false, status: 'closed' } };
    expect(parseCheckpointTaskContext(closed, 'q1').submission?.allowed).toBe(false);
  });
  it('keeps exact typed contract/evaluator and explicit allowance from native context', () => {
    expect(parseCheckpointTaskContext(typed, 'q6')).toMatchObject(typed);
    expect(Object.isFrozen(parseCheckpointTaskContext(typed, 'q6').answerContract)).toBe(true);
  });
  it.each([
    { ...coding, scoredExam: null },
    { ...coding, scoredExam: { ...marker, form: 'E' } },
    { ...coding, scoredExam: { ...marker, other: 'claim' } },
    { ...coding, answerFormat: { version: 1, kind: 'trace_with_reason' } },
    { ...coding, submission: { ...capability, status: 'allowance_exhausted' } },
    { ...coding, submission: { ...capability, authority: 'checkpoint_answers_v1' } },
  ])('rejects malformed marker/capability instead of falling back to legacy %#', (row) => {
    expect(() => parseCheckpointTaskContext(row, 'q1')).toThrow();
  });
  it.each([
    { ...typed, answerContract: { ...typed.answerContract, maxBytes: 0 } },
    { ...typed, officialAnswerPolicy: { version: 1 } },
    { ...typed, answerEvaluator: { ...typed.answerEvaluator, taskKey: 'q7' } },
    { ...typed, answerEvaluator: { ...typed.answerEvaluator, evaluatorDigest: 'unknown' } },
  ])('rejects missing or rebound typed authority %#', (row) => {
    expect(() => parseCheckpointTaskContext(row, 'q6')).toThrow();
  });
  it('does not execute source getters or accept an invented trace Go file', () => {
    const getter = vi.fn();
    expect(() =>
      parseScoredExamContextMarker(Object.defineProperty({ ...marker }, 'form', { get: getter })),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => parseCheckpointTaskContext({ ...typed, rules: base.rules }, 'q6')).toThrow();
  });
  it('parameterizes native task lookup using authenticated identity', async () => {
    const execute = vi.fn().mockResolvedValue([{ data: coding }]);
    const db = { execute } as unknown as OperationalDatabase;
    expect((await checkpointTaskContext(db, id(9), id(10), 'q1')).scoredExam).toEqual(marker);
    const rendered = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(rendered.params).toEqual([id(9), id(10), 'q1']);
    expect(rendered.sql).not.toContain(id(9));
  });
});
describe('closed OperationalDatabase bridge for reviewed0026 adapters', () => {
  it('permits only exact reviewed RPC strings and binds every value as a parameter', async () => {
    const rows = [{ data: { kind: 'closed' } }];
    const execute = vi.fn().mockResolvedValue(rows);
    const client = createScoredExamIntakeClient({ execute } as unknown as OperationalDatabase);
    await client.unsafe(SCORED_EXAM_INTAKE_CONTEXT_SQL, [id(1), id(2), 'q1']);
    const one = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(one.params).toEqual([id(1), id(2), 'q1']);
    await client.unsafe(ACCEPT_SCORED_EXAM_SUBMISSION_SQL, [
      id(1),
      id(2),
      'q1',
      id(3),
      'answer.go',
      40,
      'a'.repeat(64),
    ]);
    const two = new PgDialect().sqlToQuery(execute.mock.calls[1]![0]);
    expect(two.params).toEqual([id(1), id(2), 'q1', id(3), 'answer.go', 40, 'a'.repeat(64)]);
    expect(two.sql).toContain('::integer');
    await expect(client.unsafe('SELECT arbitrary_private_data', [])).rejects.toThrow(
      'SCORED_EXAM_RPC_UNAVAILABLE',
    );
    await expect(client.unsafe(SCORED_EXAM_INTAKE_CONTEXT_SQL, [id(1)])).rejects.toThrow(
      'SCORED_EXAM_RPC_UNAVAILABLE',
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
describe('optional native editor marker', () => {
  const value = {
    scope: {
      learnerId: id(1),
      cohortId: id(2),
      attemptId: id(3),
      taskKey: 'q1',
      definitionDigest: 'a'.repeat(64),
    },
    readAllowed: true,
    status: 'active',
    serverNow: '2026-11-01T12:00:00Z',
    deadline: '2026-11-01T15:00:00Z',
    sourceBytes: 4096,
    filename: 'answer.go',
    submitAllowed: true,
    scoredExam: marker,
  };
  const dbFor = (data: unknown) =>
    ({
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ contract: true, caller_isolation: true }])
        .mockResolvedValueOnce([{ data }]),
    }) as unknown as OperationalDatabase;
  it('preserves authoritative scored marker alongside existing source editor scope', async () => {
    expect(
      (await readCheckpointEditorContext(dbFor(value), id(9), id(3), 'q1')).scoredExam,
    ).toEqual(marker);
  });
  it('does not swallow malformed marker as a legacy response', async () => {
    await expect(
      readCheckpointEditorContext(dbFor({ ...value, scoredExam: null }), id(9), id(3), 'q1'),
    ).rejects.toThrow();
  });
});

describe('strict native submission status', () => {
  it('rejects JSON array coercion as an open capability', () => {
    expect(() =>
      parseCheckpointTaskContext(
        { ...coding, submission: { ...capability, allowed: false, status: ['open'] } },
        'q1',
      ),
    ).toThrow();
  });
  it('never evaluates a non-string status coercion hook', () => {
    const toString = vi.fn(() => 'open');
    expect(() =>
      parseCheckpointTaskContext(
        { ...coding, submission: { ...capability, allowed: false, status: { toString } } },
        'q1',
      ),
    ).toThrow();
    expect(toString).not.toHaveBeenCalled();
  });
});
