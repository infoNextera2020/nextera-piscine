import { checkpointFixture } from '../../../tests/fixtures/checkpoints';
import { describe, expect, it } from 'vitest';
import { parseCurriculum } from '../load';
import { resolveEvaluations } from '../evaluation';
import {
  canonicalJson,
  scoredExamRubricDigest,
  scoredExamFramedDigest,
  evaluationDigest,
  checkpointCanonicalJson,
  scoredExamDefinitionCoreDigest,
  scoredExamEvaluationDigest,
  prepareScoredExamPublication,
} from '../digest';
import { scoredExamFixture, scoredProjection } from './scored-exam-fixture';

function rebindProjection(p: ReturnType<typeof scoredProjection>) {
  const definitionDigest = scoredExamDefinitionCoreDigest(p.spec);
  p.definitionDigest = definitionDigest;
  const body = {
    version: p.scoringRubric.version,
    form: p.scoringRubric.form,
    definitionDigest,
    questions: p.scoringRubric.questions,
  };
  p.scoringRubric = { ...body, digest: scoredExamRubricDigest(body) };
  p.checkpoint.examScoring.rubricDigest = p.scoringRubric.digest;
  for (const task of p.checkpoint.tasks.slice(5))
    task.answerEvaluator = { ...task.answerEvaluator, definitionDigest };
  p.scoringSourceBinding = { ...p.scoringSourceBinding, rubric: body };
  p.scoringSourceBindingDigest = scoredExamFramedDigest(
    p.scoringSourceBinding,
    'nextera-exam1-rubric-source-binding',
  );
  p.digest = scoredExamEvaluationDigest(p.spec);
}

describe('constructible marked Exam1 source/compiler boundary', () => {
  it('keeps legacy source readers closed to scored content until explicitly opted in', () => {
    const f = scoredExamFixture();
    expect(() => parseCurriculum(f.files)).toThrow(/explicit opt-in/);
    expect(() => parseCurriculum(f.files, undefined, { allowScoredExams: true })).not.toThrow();
  });
  it('parses five code, two trace and one debug tasks without recursive source bindings', () => {
    const f = scoredExamFixture(),
      node = f.curriculum.nodes.find((n) => n.kind === 'checkpoint')!;
    expect(node.checkpoint).toMatchObject({
      policyVersion: 3,
      durationSeconds: 10800,
      examScoring: { form: 'A', rubricProfile: 'fixture-a' },
    });
    expect(node.checkpoint!.tasks.slice(5, 7)).toMatchObject([
      { testPackId: null, declaredLimits: null },
      { testPackId: null, declaredLimits: null },
    ]);
    expect(node.checkpoint!.tasks[5]!.submissionRules.required_files).toEqual([]);
    expect(node.checkpoint).not.toHaveProperty('examScoring.rubricDigest');
    expect(node.checkpoint!.tasks[5]).not.toHaveProperty('answerEvaluator.definitionDigest');
  });
  it('derives a stable core, then full rubric/routes/evaluation identities without a fixed point', () => {
    const p = scoredProjection();
    expect(p.definitionDigest).toBe(scoredExamDefinitionCoreDigest(p.spec));
    expect(p.digest).toBe(scoredExamEvaluationDigest(p.spec));
    expect(p.checkpoint.examScoring.rubricDigest).toBe(p.scoringRubric.digest);
    expect(p.scoringRubric.definitionDigest).toBe(p.definitionDigest);
    expect(p.checkpoint.tasks.slice(5).map((t) => t.answerEvaluator!.definitionDigest)).toEqual(
      Array(3).fill(p.definitionDigest),
    );
    expect(() => prepareScoredExamPublication(p)).not.toThrow();
    expect(p.checkpoint.tasks[5]).not.toHaveProperty('evaluationSpec');
    expect(p.checkpoint.tasks[7]).toHaveProperty('evaluationSpec.execution_contract.version', 3);
  });
  it('core omits only the four recursive leaves; full identity retains them', () => {
    const p = scoredProjection(),
      other = structuredClone(p);
    other.checkpoint.examScoring.rubricDigest = 'a'.repeat(64);
    other.checkpoint.tasks[5]!.answerEvaluator = {
      ...other.checkpoint.tasks[5]!.answerEvaluator,
      definitionDigest: 'b'.repeat(64),
    };
    // Structured clone retains the original shared checkpoint/spec definition reference.
    expect(scoredExamDefinitionCoreDigest(other.spec)).toBe(p.definitionDigest);
    expect(scoredExamEvaluationDigest(other.spec)).not.toBe(p.digest);
    expect(() => prepareScoredExamPublication(other)).toThrow();
    other.checkpoint.tasks[4]!.subjectMarkdown += ' changed';
    expect(scoredExamDefinitionCoreDigest(other.spec)).not.toBe(p.definitionDigest);
  });
  it('changing protected rubric metadata changes full projection even with the same source/core', () => {
    const f = scoredExamFixture(),
      first = scoredProjection(f);
    f.template.questions[0]!.functionalGroups[0]!.criteriaDigest = 'd'.repeat(64);
    const second = scoredProjection(f);
    expect(second.definitionDigest).toBe(first.definitionDigest);
    expect(second.scoringRubric.digest).not.toBe(first.scoringRubric.digest);
    expect(second.digest).not.toBe(first.digest);
    expect(second.scoringSourceBindingDigest).not.toBe(first.scoringSourceBindingDigest);
  });
  it.each(['exam_scoring', 'scored_submission_policy', 'answer_evaluator'])(
    'never infers missing policy/registry metadata: %s',
    (field) => {
      const f = scoredExamFixture();
      const path =
        field === 'exam_scoring'
          ? f.folder + '/checkpoint.yaml'
          : f.folder +
            '/tasks/' +
            (field === 'scored_submission_policy' ? 'q1' : 'q6') +
            '/task.yaml';
      const file = f.files.find((x) => x.path === path)!;
      const data = JSON.parse(Buffer.from(file.bytes).toString()) as Record<string, unknown>;
      delete data[field];
      f.write(path, data);
      expect(() => parseCurriculum(f.files, undefined, { allowScoredExams: true })).toThrow();
    },
  );
  it('rejects derived route/marker hashes in Git source and missing publication provenance', () => {
    const f = scoredExamFixture(),
      path = f.folder + '/tasks/q6/task.yaml';
    const data = JSON.parse(
      Buffer.from(f.files.find((x) => x.path === path)!.bytes).toString(),
    ) as { answer_evaluator: Record<string, unknown> };
    data.answer_evaluator.definitionDigest = 'a'.repeat(64);
    f.write(path, data);
    expect(() => parseCurriculum(f.files, undefined, { allowScoredExams: true })).toThrow();
    const valid = scoredExamFixture();
    delete (valid.template.source_binding.decisions as unknown as Record<string, unknown>)
      .weightsOwnerMessageId;
    expect(() => scoredProjection(valid)).toThrow();
    expect(() =>
      resolveEvaluations(valid.curriculum, {
        format_version: 1,
        test_packs: valid.catalog.test_packs,
      }),
    ).toThrow();
  });
  it('binds explicit coding policy to the actual separate compilation/execution limits', () => {
    const f = scoredExamFixture();
    const resources = f.catalog.test_packs['fixture-exam-q1']!.resource_limits as {
      compilation: { cpu_limit: number };
    };
    resources.compilation.cpu_limit += 0.125;
    expect(() => scoredProjection(f)).toThrow();
    const p = structuredClone(scoredProjection());
    p.checkpoint.tasks[0]!.scoredSubmissionPolicy = {
      ...p.checkpoint.tasks[0]!.scoredSubmissionPolicy,
      resourcePolicyDigest: 'f'.repeat(64),
    };
    rebindProjection(p);
    expect(p.definitionDigest).toBe(scoredExamDefinitionCoreDigest(p.spec));
    expect(p.digest).toBe(scoredExamEvaluationDigest(p.spec));
    expect(() => prepareScoredExamPublication(p)).toThrow();
  });
  it('uses the native marked OCI contract while preserving the legacy URI boundary', () => {
    const f = scoredExamFixture(),
      pack = f.catalog.test_packs['fixture-exam-q1']!;
    pack.test_pack_artifact = 'oci:///non-runnable@sha256:' + String(pack.test_pack_digest);
    expect(() => scoredProjection(f)).toThrow(/OCI/);
    const legacy = checkpointFixture().curriculum;
    const oldPack = f.catalog.test_packs['checkpoint-normalize-label-v1']!;
    oldPack.test_pack_artifact =
      'oci:///legacy-non-runnable@sha256:' + String(oldPack.test_pack_digest);
    expect(() => resolveEvaluations(legacy, f.catalog)).not.toThrow();
    const p = structuredClone(scoredProjection()),
      task = p.checkpoint.tasks[0]!;
    if (!('evaluationSpec' in task)) throw new Error('Expected synthetic code spec');
    task.evaluationSpec.test_pack_artifact =
      'oci://_invalid@sha256:' + String(task.evaluationSpec.test_pack_digest);
    task.evaluationDigest = scoredExamEvaluationDigest(task.evaluationSpec);
    rebindProjection(p);
    expect(() => prepareScoredExamPublication(p)).toThrow();
  });
  it('keeps the existing native integer bound for the marked protocol identity', () => {
    const f = scoredExamFixture();
    f.catalog.test_packs['fixture-exam-q1']!.protocol_version = 2147483648;
    expect(() => scoredProjection(f)).toThrow();
  });
  it('requires ABI3 for the marked function packs without altering legacy profiles', () => {
    const f = scoredExamFixture();
    const contract = f.catalog.test_packs['fixture-exam-q1']!.execution_contract as Record<
      string,
      unknown
    >;
    contract.version = 1;
    contract.input_type = 'int64';
    contract.output_type = 'string';
    expect(() => scoredProjection(f)).toThrow(/ABI3/);
  });
});

describe('new v3 canonical framing (source model, not native SQL proof)', () => {
  it.each([
    [1e-7, '0.0000001'],
    [1e21, '1000000000000000000000'],
    [-2.5e-8, '-0.000000025'],
    [-0, '0'],
  ])('uses PostgreSQL-style decimal JSON for %s', (value, expected) =>
    expect(checkpointCanonicalJson(value)).toBe(expected),
  );
  it('sorts keys by UTF8 bytes, not UTF16 code units', () => {
    expect(checkpointCanonicalJson({ '\u{10000}': 2, '\uE000': 1 })).toBe(
      '{"\uE000":1,"\u{10000}":2}',
    );
  });
  it.each(['\0', '\ud800', '\udfff', Infinity, NaN, undefined, new Date(0)])(
    'rejects non-PostgreSQL JSON material %#',
    (value) => expect(() => checkpointCanonicalJson(value)).toThrow(),
  );
  it('leaves the legacy canonical/digest behavior unchanged', () => {
    expect(canonicalJson(1e-7)).toBe('1e-7');
    expect(evaluationDigest({ number: 1e-7 })).not.toBe(
      scoredExamEvaluationDigest({ number: 1e-7 }),
    );
  });
});
