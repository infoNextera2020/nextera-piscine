import { checkpointFixture } from '../../../tests/fixtures/checkpoints';
import candidate from '../../../infra/runner/catalog/candidate.json';
import { parseCurriculum } from '../load';
import { resolveEvaluations } from '../evaluation';
import { sha256, scoredExamFramedDigest, type SourceFile } from '../digest';

/** In-memory NON-RUNNABLE synthetic metadata. IDs below are not owner approval receipts. */
export function scoredExamFixture() {
  const original = checkpointFixture(),
    folder = 'content/piscine-v1/checkpoints/transfer-checkpoint';
  const files: SourceFile[] = original.files
    .filter((f) => !f.path.startsWith(folder + '/tasks/'))
    .map((f) => ({ ...f, bytes: Buffer.from(f.bytes) }));
  const write = (path: string, value: unknown) => {
    const source = {
      path,
      bytes: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
    };
    const at = files.findIndex((f) => f.path === path);
    if (at < 0) files.push(source);
    else files[at] = source;
  };
  const checkpoint = JSON.parse(
    JSON.stringify(original.curriculum.nodes.find((n) => n.kind === 'checkpoint')!.checkpoint),
  ) as {
    tasks: { declaredLimits: { timeout_ms: number; memory_mb: number; output_kb: number } }[];
  };
  const limits = checkpoint.tasks[0]!.declaredLimits;
  const packs: Record<string, Record<string, unknown>> = Object.fromEntries(
    Object.entries(candidate.catalog.test_packs).map(([key, value]) => [
      key,
      {
        ...structuredClone(value),
        test_pack_artifact:
          'oci://test.invalid/non-runnable/' + key + '@sha256:' + value.test_pack_digest,
      },
    ]),
  );
  const questions = Array.from({ length: 8 }, (_, i) => {
    const taskKey = 'q' + (i + 1),
      kind = i < 5 ? 'coding' : i < 7 ? 'trace_with_reason' : 'debug_with_reason';
    const isTrace = kind === 'trace_with_reason',
      testPack = 'fixture-exam-' + taskKey;
    const task: Record<string, unknown> = {
      id: taskKey,
      title: 'Synthetic question ' + taskKey,
      language: 'go',
      submission: {
        required_files: isTrace ? [] : [taskKey + '.go'],
        allowed_extensions: isTrace ? [] : ['.go'],
        max_size_kb: 4,
      },
      answer_format: { version: 1, kind },
      skills: ['synthetic'],
    };
    if (!isTrace) {
      task.limits = limits;
      task.judge = { testpack: testPack };
      const pack = structuredClone(
        candidate.catalog.test_packs['checkpoint-normalize-label-v1'],
      ) as unknown as Record<string, unknown>;
      pack.execution_contract = {
        version: 3,
        item_key: taskKey,
        learner_file: taskKey + '.go',
        function: 'Fixture' + (i + 1),
        input_type: 'int_int',
        output_type: 'int',
      };
      pack.test_pack_artifact =
        'oci://test.invalid/non-runnable/' + testPack + '@sha256:' + String(pack.test_pack_digest);
      packs[testPack] = pack;
    }
    if (kind === 'coding')
      task.scored_submission_policy = {
        version: 1,
        gradedAcceptanceAllowance: 7,
        rateWindowMs: 1234,
        maxAcceptancesPerWindow: 2,
        maxCodeBytes: 4096,
        resourcePolicyDigest: scoredExamFramedDigest(
          packs[testPack]!.resource_limits,
          '01coding-exam-resource-limits',
        ),
      };
    else {
      task.answer_contract = { version: 1, kind, maxBytes: 4096 };
      task.official_answer_policy = { version: 1, gradedAllowance: 9 };
      task.answer_evaluator = {
        family: 'checkpoint_structured_answer',
        version: 1,
        kind,
        taskKey,
        evaluatorKey: 'fixture-' + taskKey,
        evaluatorDigest: sha256('non-runnable-' + taskKey),
      };
    }
    write(folder + '/tasks/' + taskKey + '/task.yaml', task);
    write(
      folder + '/tasks/' + taskKey + '/subject.md',
      'Synthetic published subject ' + taskKey + '. Not production content.',
    );
    return {
      questionKey: taskKey,
      kind,
      publishedCriteriaDigest: sha256('synthetic-criteria-' + taskKey),
      groupBasis: 'fixed_semantic',
      functionalGroups: isTrace
        ? []
        : [
            {
              key: 'synthetic-functional',
              points: kind === 'coding' ? 13 : 9,
              criteriaDigest: sha256('synthetic-group-' + taskKey),
            },
          ],
    };
  });
  const header = original.files.find((f) => f.path === folder + '/checkpoint.yaml')!;
  const titleMatch = Buffer.from(header.bytes)
    .toString()
    .match(/^title: (.+)$/m);
  if (!titleMatch) throw new Error('Fixture title missing');
  write(folder + '/checkpoint.yaml', {
    id: 'transfer-checkpoint',
    title: titleMatch[1],
    policy_version: 3,
    duration_seconds: 10800,
    tasks: questions.map((q) => q.questionKey),
    exam_scoring: { version: 1, form: 'A', rubric_profile: 'fixture-a' },
  });
  const draftSha256 = sha256('synthetic-draft-not-owner-authority');
  const template = {
    version: 1,
    form: 'A',
    questions,
    source_binding: {
      draftSha256,
      paperSha256: sha256('synthetic-paper'),
      decisions: {
        weightsOwnerMessageId: 'Sentinel_' + '0'.repeat(32),
        approvedDraftSha256: draftSha256,
        traceComparatorOwnerMessageId: 'Sentinel_' + '1'.repeat(32),
        traceComparator: 'exact_utf8',
        manualCriteriaSha256: sha256('synthetic-manual-criteria'),
      },
    },
  };
  const catalog = {
    format_version: 1,
    test_packs: packs,
    scored_exam_rubrics: { 'fixture-a': template },
  };
  const curriculum = parseCurriculum(files, undefined, { allowScoredExams: true });
  return { files, catalog, curriculum, folder, write, template };
}
export function scoredProjection(fixture = scoredExamFixture()) {
  const projection = resolveEvaluations(fixture.curriculum, fixture.catalog).find(
    (r) => r.nodeKey === 'transfer-checkpoint',
  );
  if (!projection || !('scoringRubric' in projection))
    throw new Error('Expected marked source projection');
  return projection;
}
