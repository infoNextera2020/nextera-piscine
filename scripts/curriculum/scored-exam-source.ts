import {
  checkpointExamAnswerKind,
  checkpointLifecyclePolicy,
  type ScoredExamSourceDefinition,
  type ScoredExamSourceTask,
  type Curriculum,
  type CheckpointDefinition,
  type ExamScoringRubric,
} from '@nextera/domain';
import {
  sha256,
  assertScoredExamExecutionTask,
  scoredExamDefinitionCoreDigest,
  scoredExamRubricDigest,
  scoredExamEvaluationDigest,
  scoredExamFramedDigest,
  assertScoredExamSourceBinding,
  prepareScoredExamPublication,
} from './digest';

export type ScoredExamSourceAccess = {
  yaml(path: string): unknown;
  read(path: string): string;
  bytes(path: string): Uint8Array;
};
const fail = (message: string): never => {
  throw new Error('SCORED_EXAM_SOURCE: ' + message);
};
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(label + ': object required.');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, names: readonly string[], label: string) {
  if (Reflect.ownKeys(value).some((k) => typeof k !== 'string' || !names.includes(k)))
    fail(label + ': unknown metadata.');
}
function exact(value: unknown, names: readonly string[], label: string) {
  const data = object(value, label);
  fields(data, names, label);
  if (names.some((k) => !Object.hasOwn(data, k))) fail(label + ': required metadata missing.');
  return data;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) return fail(label + ': text required.');
  return value;
}
function key(value: unknown, label: string) {
  const result = text(value, label);
  if (!/^[a-z][a-z0-9-]{0,99}$/.test(result)) return fail(label + ': safe key required.');
  return result;
}
function integer(value: unknown, label: string, maximum = 2147483647) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > maximum)
    return fail(label + ': positive integer required.');
  return Number(value);
}
function hash(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    return fail(label + ': SHA256 required.');
  return value;
}
function list(value: unknown, label: string): unknown[] {
  return Array.isArray(value) ? value : fail(label + ': list required.');
}
function evaluator(value: unknown, taskKey: string, kind: string) {
  // The definition binding is derived after the core digest. It must not occur in Git source.
  const route = exact(
    value,
    ['family', 'version', 'kind', 'taskKey', 'evaluatorKey', 'evaluatorDigest'],
    'answer_evaluator',
  );
  if (
    route.family !== 'checkpoint_structured_answer' ||
    route.version !== 1 ||
    route.kind !== kind ||
    route.taskKey !== taskKey
  )
    fail('answer_evaluator identity mismatch.');
  return {
    family: route.family,
    version: 1,
    kind,
    taskKey,
    evaluatorKey: key(route.evaluatorKey, 'evaluatorKey'),
    evaluatorDigest: hash(route.evaluatorDigest, 'evaluatorDigest'),
  };
}

/** Source-only metadata parser. No policy, test pack, grader or publication defaults. */
export function parseScoredExamSource(
  config: Record<string, unknown>,
  folder: string,
  access: ScoredExamSourceAccess,
): ScoredExamSourceDefinition {
  fields(
    config,
    ['id', 'title', 'policy_version', 'duration_seconds', 'tasks', 'exam_scoring'],
    'checkpoint',
  );
  if (config.policy_version !== 3 || config.duration_seconds !== 10800)
    fail('Exam1 duration/version mismatch.');
  key(config.id, 'checkpoint.id');
  text(config.title, 'checkpoint.title');
  const scoring = exact(config.exam_scoring, ['version', 'form', 'rubric_profile'], 'exam_scoring');
  if (
    scoring.version !== 1 ||
    typeof scoring.form !== 'string' ||
    !['A', 'B', 'C', 'D'].includes(scoring.form)
  )
    fail('Exam1 scoring identity mismatch.');
  const rubricProfile = key(scoring.rubric_profile, 'rubric_profile');
  const taskKeys = list(config.tasks, 'checkpoint.tasks');
  if (taskKeys.length !== 8 || taskKeys.some((v, i) => v !== 'q' + (i + 1)))
    fail('Eight ordered Exam1 questions required.');
  const tasks: ScoredExamSourceTask[] = taskKeys.map((value, index) => {
    const taskKey = String(value),
      kind = checkpointExamAnswerKind(index);
    const base = folder + '/tasks/' + taskKey,
      path = base + '/task.yaml';
    const task = object(access.yaml(path), path);
    fields(
      task,
      [
        'id',
        'title',
        'language',
        'submission',
        'limits',
        'judge',
        'skills',
        'answer_format',
        'answer_contract',
        'official_answer_policy',
        'answer_evaluator',
        'scored_submission_policy',
      ],
      path,
    );
    if (task.id !== taskKey || task.language !== 'go') fail('Task identity/language mismatch.');
    const format = exact(task.answer_format, ['version', 'kind'], 'answer_format');
    if (format.version !== 1 || format.kind !== kind) fail('Task answer format mismatch.');
    const submission = exact(
      task.submission,
      ['required_files', 'allowed_extensions', 'max_size_kb'],
      'submission',
    );
    const files = list(submission.required_files, 'required_files').map((v) => text(v, 'filename'));
    const extensions = list(submission.allowed_extensions, 'allowed_extensions');
    const maximum = integer(submission.max_size_kb, 'max_size_kb');
    if (!Number.isSafeInteger(maximum * 1024)) fail('Submission size overflow.');
    if (kind === 'trace_with_reason') {
      if (
        files.length ||
        extensions.length ||
        Object.hasOwn(task, 'judge') ||
        Object.hasOwn(task, 'limits')
      )
        fail('Tracing must not invent a Go source file or execution pack.');
    } else if (
      files.length !== 1 ||
      !/^[A-Za-z0-9_][A-Za-z0-9_]*[.]go$/.test(files[0]!) ||
      files[0] === 'main.go' ||
      extensions.length !== 1 ||
      extensions[0] !== '.go'
    )
      fail('Function question requires one safe Go file.');
    const subjectPath = base + '/subject.md',
      subject = access.read(subjectPath);
    if (!subject.trim()) fail('Empty task subject.');
    const skills = list(task.skills, 'skills').map((v) => key(v, 'skill'));
    if (new Set(skills).size !== skills.length) fail('Duplicate skill.');
    let testPackId: string | null = null,
      declaredLimits: ScoredExamSourceTask['declaredLimits'] = null;
    if (kind !== 'trace_with_reason') {
      const judge = exact(task.judge, ['testpack'], 'judge');
      const limits = exact(task.limits, ['timeout_ms', 'memory_mb', 'output_kb'], 'limits');
      testPackId = key(judge.testpack, 'testpack');
      declaredLimits = {
        timeout_ms: integer(limits.timeout_ms, 'timeout_ms'),
        memory_mb: integer(limits.memory_mb, 'memory_mb'),
        output_kb: integer(limits.output_kb, 'output_kb'),
      };
    }
    const common = {
      key: taskKey,
      title: text(task.title, 'task.title'),
      subjectMarkdown: subject,
      subjectDigest: sha256(access.bytes(subjectPath)),
      configurationDigest: sha256(access.bytes(path)),
      submissionRules: {
        required_files: files,
        allowed_extensions: kind === 'trace_with_reason' ? [] : ['.go'],
        max_size_kb: maximum,
      },
      answerFormat: { version: 1 as const, kind },
      testPackId,
      declaredLimits,
    };
    if (kind === 'coding') {
      if (
        ['answer_contract', 'official_answer_policy', 'answer_evaluator'].some((k) =>
          Object.hasOwn(task, k),
        )
      )
        fail('Coding must not include a typed-answer evaluator.');
      const policy = exact(
        task.scored_submission_policy,
        [
          'version',
          'gradedAcceptanceAllowance',
          'rateWindowMs',
          'maxAcceptancesPerWindow',
          'maxCodeBytes',
          'resourcePolicyDigest',
        ],
        'scored_submission_policy',
      );
      if (policy.version !== 1) fail('Unsupported scored submission policy.');
      const maxCodeBytes = integer(policy.maxCodeBytes, 'maxCodeBytes', 262144);
      if (maxCodeBytes > maximum * 1024) fail('Code byte policy exceeds task submission envelope.');
      return {
        ...common,
        scoredSubmissionPolicy: {
          version: 1,
          gradedAcceptanceAllowance: integer(
            policy.gradedAcceptanceAllowance,
            'gradedAcceptanceAllowance',
          ),
          rateWindowMs: integer(policy.rateWindowMs, 'rateWindowMs'),
          maxAcceptancesPerWindow: integer(
            policy.maxAcceptancesPerWindow,
            'maxAcceptancesPerWindow',
          ),
          maxCodeBytes,
          resourcePolicyDigest: hash(policy.resourcePolicyDigest, 'resourcePolicyDigest'),
        },
      };
    }
    if (Object.hasOwn(task, 'scored_submission_policy'))
      fail('Typed answers cannot inherit coding allowances.');
    const contract = exact(
      task.answer_contract,
      ['version', 'kind', 'maxBytes'],
      'answer_contract',
    );
    const policy = exact(
      task.official_answer_policy,
      ['version', 'gradedAllowance'],
      'official_answer_policy',
    );
    if (contract.version !== 1 || contract.kind !== kind || policy.version !== 1)
      fail('Typed answer identity mismatch.');
    const maxBytes = integer(contract.maxBytes, 'maxBytes', 262144);
    if (maxBytes > maximum * 1024) fail('Answer byte contract exceeds task envelope.');
    return {
      ...common,
      answerContract: { version: 1, kind, maxBytes },
      officialAnswerPolicy: {
        version: 1,
        gradedAllowance: integer(policy.gradedAllowance, 'gradedAllowance'),
      },
      answerEvaluator: evaluator(task.answer_evaluator, taskKey, kind),
    };
  });
  const identities = tasks.map((t) => t.testPackId).filter((v): v is string => v !== null);
  if (new Set(identities).size !== identities.length)
    fail('Duplicate question evaluation identity.');
  const result: ScoredExamSourceDefinition = {
    policyVersion: 3,
    durationSeconds: 10800,
    examScoring: { version: 1, form: scoring.form as 'A' | 'B' | 'C' | 'D', rubricProfile },
    tasks,
  };
  checkpointLifecyclePolicy(result);
  return result;
}

/** Derive all recursive bindings in memory after source content identity is fixed. */
export function resolveScoredExamEvaluation(
  node: Curriculum<CheckpointDefinition>['nodes'][number],
  checkpoint: ScoredExamSourceDefinition,
  templates: unknown,
  resolveTask: (task: ScoredExamSourceTask) => { spec: Record<string, unknown>; digest: string },
) {
  checkpointLifecyclePolicy(checkpoint);
  const templateMap = object(templates, 'scored_exam_rubrics');
  const template = exact(
    templateMap[checkpoint.examScoring.rubricProfile],
    ['version', 'form', 'questions', 'source_binding'],
    'scored rubric template',
  );
  if (template.version !== 1 || template.form !== checkpoint.examScoring.form)
    fail('Scoring template form mismatch.');
  const staticBinding = exact(
    template.source_binding,
    ['draftSha256', 'paperSha256', 'decisions'],
    'source_binding',
  );
  const tasks = checkpoint.tasks.map((task) => {
    if (task.answerFormat.kind === 'trace_with_reason') return { ...task };
    const evaluation = resolveTask(task);
    const resolved = {
      ...task,
      evaluationSpec: evaluation.spec,
      evaluationDigest: evaluation.digest,
    };
    assertScoredExamExecutionTask(resolved);
    return resolved;
  });
  const anchor = tasks[0]!;
  if (!('evaluationSpec' in anchor)) return fail('Coding evaluation anchor required.');
  for (const task of tasks.slice(5)) {
    if (!task.answerEvaluator) return fail('Explicit structured evaluator required.');
    task.answerEvaluator = { ...task.answerEvaluator, definitionDigest: '0'.repeat(64) };
  }
  const definition = {
    policyVersion: 3 as const,
    durationSeconds: 10800 as const,
    examScoring: {
      version: 1 as const,
      form: checkpoint.examScoring.form,
      rubricDigest: '0'.repeat(64),
    },
    tasks,
  };
  const spec = {
    ...anchor.evaluationSpec,
    checkpoint_definition: definition,
    subject_digest: node.subjectDigest,
    configuration_digest: node.configurationDigest,
  };
  const definitionDigest = scoredExamDefinitionCoreDigest(spec);
  const rubricBody: Omit<ExamScoringRubric, 'digest'> = {
    version: 1,
    form: checkpoint.examScoring.form,
    definitionDigest,
    questions: template.questions as ExamScoringRubric['questions'],
  };
  const scoringRubric: ExamScoringRubric = {
    ...rubricBody,
    digest: scoredExamRubricDigest(rubricBody),
  };
  definition.examScoring.rubricDigest = scoringRubric.digest;
  for (const task of tasks.slice(5))
    task.answerEvaluator = { ...task.answerEvaluator, definitionDigest };
  if (scoredExamDefinitionCoreDigest(spec) !== definitionDigest)
    fail('Recursive binding normalization mismatch.');
  const scoringSourceBinding = { ...staticBinding, rubric: rubricBody };
  assertScoredExamSourceBinding(scoringSourceBinding, scoringRubric);
  const result = {
    nodeKey: node.key,
    spec,
    digest: scoredExamEvaluationDigest(spec),
    checkpoint: definition,
    definitionDigest,
    scoringRubric,
    scoringSourceBinding,
    scoringSourceBindingDigest: scoredExamFramedDigest(
      scoringSourceBinding,
      'nextera-exam1-rubric-source-binding',
    ),
  };
  prepareScoredExamPublication(result);
  return result;
}
