import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  getExam1RubricDraft,
  prepareExam1ScoringRubric,
  type Exam1RubricPreparation,
} from '../exam1-rubric';
import { validateExamScoringRubric } from '@nextera/domain';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const forms = ['A', 'B', 'C', 'D'] as const;
function input(form: 'A' | 'B' | 'C' | 'D' = 'A'): Exam1RubricPreparation {
  const draft = getExam1RubricDraft(form);
  return {
    form,
    definitionDigest: 'a'.repeat(64),
    publishedPaperSha256: draft.paperSha256,
    decisions: {
      weightsOwnerMessageId: 'Sentinel_' + 'b'.repeat(32),
      approvedDraftSha256: draft.draftSha256,
      traceComparatorOwnerMessageId: 'Sentinel_' + 'c'.repeat(32),
      traceComparator: 'exact_utf8',
      manualCriteriaSha256: 'd'.repeat(64),
    },
  };
}
describe('Exam1 source-only frozen rubric preparation', () => {
  it('maps all four exact learner sources without claiming weight or comparator approval', () => {
    for (const form of forms) {
      const draft = getExam1RubricDraft(form);
      expect(draft.questions.map((q) => q.questionKey)).toEqual([
        'q1',
        'q2',
        'q3',
        'q4',
        'q5',
        'q6',
        'q7',
        'q8',
      ]);
      expect(draft.status).toBe('source-reviewed-draft');
      expect(draft.weightsOwnerApproved).toBe(false);
      expect(draft.traceComparator).toBeNull();
      expect(draft.questions.every((q) => q.publishedCriteriaDigest !== null)).toBe(true);
    }
    const b = getExam1RubricDraft('B');
    expect(b.questions.map((q) => q.functionName)).toEqual([
      'TicketCredit',
      'LowerLevel',
      'CountInside',
      'CountVisibleMarkers',
      'ReadMeasure',
      null,
      null,
      'SumAll',
    ]);
    expect(b.questions.map((q) => q.learnerFile)).toEqual([
      'ticketcredit.go',
      'lowerlevel.go',
      'countinside.go',
      'countvisiblemarkers.go',
      'readmeasure.go',
      null,
      null,
      'sumall.go',
    ]);
  });
  it('pins the independently verified learner-source provenance', () => {
    expect(getExam1RubricDraft('B').paperSha256).toBe(
      '0476b7427bb0263d4315a0f003ca9ec02c4da6b86c847138c0e7c0e0c9cdc30f',
    );
    expect(getExam1RubricDraft('A').paperSha256).toBe(
      'b39bd12cd76e3f5e8a41399bc74fed5d4ebaa1949e2b21df0b27bb620b8b76f0',
    );
    expect(getExam1RubricDraft('C').paperSha256).toBe(
      'a528401ba443b7101568919c3b5de5625ed48f140ad52ff59859648a03cf0c97',
    );
    expect(getExam1RubricDraft('D').paperSha256).toBe(
      'a6246dab869f14c60bfda3ed896865c1fa64c90176e7f7d3f5f9877410cd8151',
    );
  });
  it.each(forms)(
    'verifies the frozen %s draft digest over its complete immutable payload',
    (form) => {
      const { draftSha256, ...body } = getExam1RubricDraft(form);
      const canonical = (value: unknown): string => {
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        if (value !== null && typeof value === 'object')
          return (
            '{' +
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
              .join(',') +
            '}'
          );
        const text = JSON.stringify(value);
        if (text === undefined) throw new Error('Invalid static draft');
        return text;
      };
      expect(hash('nextera-exam1-rubric-draft-v1\0' + canonical(body))).toBe(draftSha256);
    },
  );
  it.each(forms)('prepares %s from explicit reviewed bindings only', (form) => {
    const result = prepareExam1ScoringRubric(input(form), hash);
    expect(result.available).toBe(true);
    expect(result.runtimeEnabled).toBe(false);
    if (!result.available) throw new Error('Expected synthetic approval fixture');
    expect(() => validateExamScoringRubric(result.rubric)).not.toThrow();
    expect(result.rubric.definitionDigest).toBe('a'.repeat(64));
    expect(
      result.rubric.questions.map((q) => q.functionalGroups.reduce((n, g) => n + g.points, 0)),
    ).toEqual([13, 13, 13, 13, 13, 0, 0, 9]);
    expect(result.traceComparator).toBe('exact_utf8');
    expect(result.rubric.digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it('does not infer approved exact weights from the approved scoring categories', () => {
    const f = input();
    const result = prepareExam1ScoringRubric({ ...f, decisions: null }, hash);
    expect(result).toMatchObject({ available: false, runtimeEnabled: false });
    if (result.available) throw new Error('Unexpected rubric');
    expect(result.reasons).toContain('exact_draft_weights_not_approved');
    expect(result.reasons).toContain('trace_comparator_not_approved');
    expect(result.reasons).toContain('manual_criteria_not_bound');
  });
  it.each([
    { publishedPaperSha256: 'e'.repeat(64) },
    { definitionDigest: 'bad' },
    { decisions: { ...input().decisions!, approvedDraftSha256: 'e'.repeat(64) } },
    { decisions: { ...input().decisions!, weightsOwnerMessageId: 'not-owner-proof' } },
    { decisions: { ...input().decisions!, traceComparator: null } },
    { decisions: { ...input().decisions!, traceComparatorOwnerMessageId: null } },
    { decisions: { ...input().decisions!, manualCriteriaSha256: null } },
  ])('fails closed for incomplete or mismatched binding %j', (change) => {
    const digest = vi.fn(hash);
    expect(prepareExam1ScoringRubric({ ...input(), ...change }, digest).available).toBe(false);
    expect(digest).not.toHaveBeenCalled();
  });
  it('rejects substituting another form paper or approved draft for B', () => {
    const f = input('B');
    const result = prepareExam1ScoringRubric(
      { ...f, publishedPaperSha256: getExam1RubricDraft('A').paperSha256 },
      hash,
    );
    expect(result.available).toBe(false);
    if (result.available) throw new Error('Unexpected rebound candidate');
    expect(result.reasons).toContain('published_paper_not_bound');
    expect(
      prepareExam1ScoringRubric(
        {
          ...f,
          decisions: { ...f.decisions!, approvedDraftSha256: getExam1RubricDraft('A').draftSha256 },
        },
        hash,
      ).available,
    ).toBe(false);
  });
  it('uses exact SQL rubric framing and separately binds source/owner/manual evidence', () => {
    const f = input();
    const first = prepareExam1ScoringRubric(f, hash);
    const second = prepareExam1ScoringRubric(
      { ...f, decisions: { ...f.decisions!, manualCriteriaSha256: 'e'.repeat(64) } },
      hash,
    );
    if (!first.available || !second.available) throw new Error('Expected synthetic candidates');
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
      if (value !== null && typeof value === 'object')
        return (
          '{' +
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
            .join(',') +
          '}'
        );
      const text = JSON.stringify(value);
      if (text === undefined) throw new Error('Invalid test input');
      return text;
    };
    const { digest: rubricDigest, ...body } = first.rubric;
    expect(rubricDigest).toBe(hash('01coding-exam-scoring-rubric\0v1\0' + canonical(body)));
    expect(first.sourceBindingDigest).toBe(
      hash('nextera-exam1-rubric-source-binding\0v1\0' + canonical(first.sourceBinding)),
    );
    expect(first.sourceBinding.rubric).toEqual(body);
    expect(first.rubric.digest).toBe(second.rubric.digest);
    expect(first.sourceBindingDigest).not.toBe(second.sourceBindingDigest);
    expect(first.sourceBindingDigest).not.toBe(first.rubric.digest);
    expect(Object.isFrozen(first.sourceBinding.decisions)).toBe(true);
  });
  it('returns deeply immutable drafts and candidates', () => {
    const draft = getExam1RubricDraft('A');
    expect(Object.isFrozen(draft)).toBe(true);
    expect(Object.isFrozen(draft.questions[0].functionalGroups[0])).toBe(true);
    const result = prepareExam1ScoringRubric(input(), hash);
    if (!result.available) throw new Error('Expected synthetic candidate');
    expect(Object.isFrozen(result.rubric.questions[0]!.functionalGroups[0])).toBe(true);
  });
  it('rejects invalid form and digest implementation instead of creating a default', () => {
    expect(() => getExam1RubricDraft('E' as 'A')).toThrow('EXAM1_RUBRIC_FORM');
    expect(() => prepareExam1ScoringRubric(input(), () => 'bad')).toThrow('EXAM1_RUBRIC_DIGEST');
  });
});
