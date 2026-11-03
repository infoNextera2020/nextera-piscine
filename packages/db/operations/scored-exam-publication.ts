import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { TextDecoder, TextEncoder } from 'node:util';
import {
  EXAM_TRACE_COMPARATOR_V1,
  validateExamScoringRubric,
  type ExamScoringRubric,
  type ExamTraceComparator,
} from '@nextera/domain';

const hash = /^[a-f0-9]{64}$/;
const fail = (): never => {
  throw new Error('SCORED_EXAM_PUBLICATION_INVALID');
};
function data(value: unknown, names?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value),
    keys = Reflect.ownKeys(descriptors);
  if (
    (names &&
      (keys.length !== names.length || !names.every((k) => Object.hasOwn(descriptors, k)))) ||
    keys.some((k) => typeof k !== 'string' || !Object.hasOwn(descriptors[k]!, 'value'))
  )
    return fail();
  return Object.fromEntries((keys as string[]).map((k) => [k, descriptors[k]!.value]));
}
function string(value: string) {
  if (
    value.includes('\0') ||
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      new TextEncoder().encode(value),
    ) !== value
  )
    return fail();
  return JSON.stringify(value);
}
function number(value: number) {
  if (!Number.isFinite(value)) return fail();
  const text = JSON.stringify(value);
  if (!/[eE]/.test(text)) return text;
  const [coefficient, exponent] = text.toLowerCase().split('e');
  const negative = coefficient!.startsWith('-'),
    unsigned = negative ? coefficient!.slice(1) : coefficient!;
  const [whole, fraction = ''] = unsigned.split('.');
  const digits = whole! + fraction,
    point = whole!.length + Number(exponent);
  const expanded =
    point <= 0
      ? '0.' + '0'.repeat(-point) + digits
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : digits.slice(0, point) + '.' + digits.slice(point);
  return (negative ? '-' : '') + expanded;
}
/** Mirrors checkpoint_canonical for JSON material produced by this compiler; native parity remains a separate test. */
export function checkpointCanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return string(value);
  if (typeof value === 'number') return number(value);
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1 ||
      keys.some((k) => k !== 'length' && (typeof k !== 'string' || !/^(0|[1-9][0-9]*)$/.test(k)))
    )
      return fail();
    return (
      '[' +
      Array.from({ length: value.length }, (_, i) => {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !Object.hasOwn(d, 'value')) return fail();
        return checkpointCanonicalJson(d.value);
      }).join(',') +
      ']'
    );
  }
  if (
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    const record = data(value);
    return (
      '{' +
      Object.keys(record)
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map((k) => string(k) + ':' + checkpointCanonicalJson(record[k]))
        .join(',') +
      '}'
    );
  }
  return fail();
}
export function scoredExamFramedDigest(value: unknown, domain: string): string {
  if (!/^[a-z0-9-]+$/.test(domain)) return fail();
  return createHash('sha256')
    .update(domain + '\0v1\0' + checkpointCanonicalJson(value))
    .digest('hex');
}
export const scoredExamEvaluationDigest = (spec: unknown) =>
  scoredExamFramedDigest(spec, 'nextera-evaluation-spec');

/** Only the four recursive digest leaves are omitted. Every actual leaf is bound by full evaluation/snapshot hashes. */
export function scoredExamDefinitionCoreDigest(spec: unknown): string {
  const value = JSON.parse(checkpointCanonicalJson(spec)) as Record<string, unknown>;
  const definition = data(value.checkpoint_definition),
    marker = data(definition.examScoring, ['version', 'form', 'rubricDigest']);
  if (
    definition.policyVersion !== 3 ||
    definition.durationSeconds !== 10800 ||
    marker.version !== 1 ||
    typeof marker.form !== 'string' ||
    !['A', 'B', 'C', 'D'].includes(marker.form) ||
    typeof marker.rubricDigest !== 'string' ||
    !hash.test(marker.rubricDigest) ||
    !Array.isArray(definition.tasks) ||
    definition.tasks.length !== 8
  )
    return fail();
  const tasks = definition.tasks;
  for (let i = 0; i < 8; i++) {
    const task = data(tasks[i]),
      format = data(task.answerFormat, ['version', 'kind']);
    const kind = i < 5 ? 'coding' : i < 7 ? 'trace_with_reason' : 'debug_with_reason';
    if (task.key !== 'q' + (i + 1) || format.version !== 1 || format.kind !== kind) return fail();
    if (i >= 5) {
      const route = data(task.answerEvaluator, [
        'family',
        'version',
        'kind',
        'definitionDigest',
        'taskKey',
        'evaluatorKey',
        'evaluatorDigest',
      ]);
      if (
        route.family !== 'checkpoint_structured_answer' ||
        route.version !== 1 ||
        route.kind !== kind ||
        route.taskKey !== task.key ||
        typeof route.definitionDigest !== 'string' ||
        !hash.test(route.definitionDigest) ||
        typeof route.evaluatorKey !== 'string' ||
        !/^[a-z0-9-]{1,100}$/.test(route.evaluatorKey) ||
        typeof route.evaluatorDigest !== 'string' ||
        !hash.test(route.evaluatorDigest)
      )
        return fail();
      delete (task.answerEvaluator as Record<string, unknown>).definitionDigest;
    }
  }
  delete (definition.examScoring as Record<string, unknown>).rubricDigest;
  return scoredExamFramedDigest(value, 'nextera-scored-exam-definition-core');
}
export function scoredExamRubricDigest(body: Omit<ExamScoringRubric, 'digest'>): string {
  validateExamScoringRubric({ ...body, digest: '0'.repeat(64) });
  return scoredExamFramedDigest(body, '01coding-exam-scoring-rubric');
}
export type ScoredExamSourceBinding = Readonly<{
  draftSha256: string;
  paperSha256: string;
  decisions: Readonly<{
    weightsOwnerMessageId: string;
    approvedDraftSha256: string;
    traceComparatorOwnerMessageId: string;
    /** Historical exact_utf8 bindings retain their original semantics. */
    traceComparator: ExamTraceComparator;
    manualCriteriaSha256: string;
  }>;
  rubric: Omit<ExamScoringRubric, 'digest'>;
}>;
export function assertScoredExamSourceBinding(
  binding: unknown,
  rubric: ExamScoringRubric,
): asserts binding is ScoredExamSourceBinding {
  const b = data(binding, ['draftSha256', 'paperSha256', 'decisions', 'rubric']);
  const decisions = data(b.decisions, [
    'weightsOwnerMessageId',
    'approvedDraftSha256',
    'traceComparatorOwnerMessageId',
    'traceComparator',
    'manualCriteriaSha256',
  ]);
  const body = {
    version: rubric.version,
    form: rubric.form,
    definitionDigest: rubric.definitionDigest,
    questions: rubric.questions,
  };
  if (
    typeof b.draftSha256 !== 'string' ||
    !hash.test(b.draftSha256) ||
    typeof b.paperSha256 !== 'string' ||
    !hash.test(b.paperSha256) ||
    typeof decisions.weightsOwnerMessageId !== 'string' ||
    !/^Sentinel_[a-f0-9]{32}$/.test(decisions.weightsOwnerMessageId) ||
    typeof decisions.traceComparatorOwnerMessageId !== 'string' ||
    !/^Sentinel_[a-f0-9]{32}$/.test(decisions.traceComparatorOwnerMessageId) ||
    decisions.approvedDraftSha256 !== b.draftSha256 ||
    (decisions.traceComparator !== 'exact_utf8' &&
      decisions.traceComparator !== EXAM_TRACE_COMPARATOR_V1) ||
    typeof decisions.manualCriteriaSha256 !== 'string' ||
    !hash.test(decisions.manualCriteriaSha256) ||
    checkpointCanonicalJson(b.rubric) !== checkpointCanonicalJson(body)
  )
    return fail();
}
/** Match the existing0026 frozen execution/resource contract, not an inferred grading policy. */
export function assertScoredExamExecutionTask(value: unknown): void {
  const task = data(value),
    format = data(task.answerFormat, ['version', 'kind']);
  if (
    format.version !== 1 ||
    !['coding', 'debug_with_reason'].includes(String(format.kind)) ||
    typeof task.key !== 'string' ||
    (format.kind === 'coding' ? !/^q[1-5]$/.test(task.key) : task.key !== 'q8')
  )
    return fail();
  const rules = data(task.submissionRules),
    spec = data(task.evaluationSpec);
  const positive = (value: unknown, max = Number.MAX_SAFE_INTEGER) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max;
  if (
    !Array.isArray(rules.required_files) ||
    rules.required_files.length !== 1 ||
    typeof rules.required_files[0] !== 'string' ||
    rules.required_files[0].length > 100 ||
    !/^[A-Za-z0-9_][A-Za-z0-9_]*[.]go$/.test(rules.required_files[0]) ||
    rules.required_files[0] === 'main.go' ||
    !positive(rules.max_size_kb) ||
    !Array.isArray(rules.allowed_extensions) ||
    !rules.allowed_extensions.includes('.go') ||
    spec.dependency_policy !== 'offline' ||
    !positive(spec.protocol_version, 2147483647) ||
    !positive(spec.snapshot_format_version) ||
    task.evaluationDigest !== scoredExamEvaluationDigest(spec) ||
    task.testPackId !== spec.test_pack_id ||
    task.subjectDigest !== spec.subject_digest ||
    task.configurationDigest !== spec.configuration_digest ||
    typeof spec.test_pack_digest !== 'string' ||
    !hash.test(spec.test_pack_digest) ||
    typeof spec.test_pack_artifact !== 'string' ||
    !new RegExp('^oci://[A-Za-z0-9][A-Za-z0-9./_:-]*@sha256:' + spec.test_pack_digest + '$').test(
      spec.test_pack_artifact,
    )
  )
    return fail();
  const contract = data(spec.execution_contract, [
    'version',
    'item_key',
    'learner_file',
    'function',
    'input_type',
    'output_type',
  ]);
  const profile =
    ((contract.input_type === 'int_int' || contract.input_type === 'string') &&
      contract.output_type === 'int') ||
    ((contract.input_type === 'pointer_int_int' || contract.input_type === 'pointer_int') &&
      contract.output_type === 'pointer_int') ||
    (contract.input_type === 'pointer_pair' && contract.output_type === 'swap') ||
    (contract.input_type === 'int_int' && contract.output_type === 'div_mod') ||
    ((contract.input_type === 'int_slice_int_int' || contract.input_type === 'int_slice') &&
      contract.output_type === 'int_slice_preserved');
  if (
    contract.version !== 3 ||
    contract.item_key !== task.key ||
    contract.learner_file !== rules.required_files[0] ||
    typeof contract.function !== 'string' ||
    !/^[A-Z][A-Za-z0-9_]{0,63}$/.test(contract.function) ||
    !profile
  )
    return fail();
  const resources = data(spec.resource_limits, ['compilation', 'execution']);
  for (const phase of ['compilation', 'execution']) {
    const limits = data(resources[phase], [
      'cpu_limit',
      'memory_bytes',
      'pid_limit',
      'timeout_ms',
      'output_bytes',
      'temporary_filesystem_bytes',
      'temporary_filesystem_inodes',
    ]);
    if (
      typeof limits.cpu_limit !== 'number' ||
      !Number.isFinite(limits.cpu_limit) ||
      limits.cpu_limit <= 0 ||
      Object.keys(limits).some((k) => k !== 'cpu_limit' && !positive(limits[k]))
    )
      return fail();
  }
  const declared = data(task.declaredLimits, ['timeout_ms', 'memory_mb', 'output_kb']),
    execution = data(resources.execution);
  if (
    !positive(declared.timeout_ms) ||
    !positive(declared.memory_mb) ||
    !positive(declared.output_kb) ||
    execution.timeout_ms !== declared.timeout_ms ||
    execution.memory_bytes !== Number(declared.memory_mb) * 1024 * 1024 ||
    execution.output_bytes !== Number(declared.output_kb) * 1024
  )
    return fail();
  if (format.kind === 'coding') {
    const policy = data(task.scoredSubmissionPolicy, [
      'version',
      'gradedAcceptanceAllowance',
      'rateWindowMs',
      'maxAcceptancesPerWindow',
      'maxCodeBytes',
      'resourcePolicyDigest',
    ]);
    if (
      policy.version !== 1 ||
      !positive(policy.gradedAcceptanceAllowance, 2147483647) ||
      !positive(policy.rateWindowMs, 2147483647) ||
      !positive(policy.maxAcceptancesPerWindow, 2147483647) ||
      !positive(policy.maxCodeBytes, 262144) ||
      Number(policy.maxCodeBytes) > Number(rules.max_size_kb) * 1024 ||
      policy.resourcePolicyDigest !==
        scoredExamFramedDigest(resources, '01coding-exam-resource-limits')
    )
      return fail();
  }
}

export type ScoredExamPublication = Readonly<{
  nodeKey: string;
  spec: Record<string, unknown>;
  digest: string;
  checkpoint: Record<string, unknown>;
  definitionDigest: string;
  scoringRubric: ExamScoringRubric;
  scoringSourceBinding: ScoredExamSourceBinding;
  scoringSourceBindingDigest: string;
}>;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Validate/capture marked metadata before any transaction or await. Does not construct a client or authorize publication. */
export function prepareScoredExamPublication(input: unknown): ScoredExamPublication {
  const projection = data(input, [
    'nodeKey',
    'spec',
    'digest',
    'checkpoint',
    'definitionDigest',
    'scoringRubric',
    'scoringSourceBinding',
    'scoringSourceBindingDigest',
  ]);
  const captured = JSON.parse(
    checkpointCanonicalJson(projection),
  ) as unknown as ScoredExamPublication;
  const marker = data(captured.checkpoint.examScoring, ['version', 'form', 'rubricDigest']);
  const core = scoredExamDefinitionCoreDigest(captured.spec),
    rubric = captured.scoringRubric;
  validateExamScoringRubric(rubric);
  if (!Array.isArray(captured.checkpoint.tasks)) return fail();
  for (const index of [0, 1, 2, 3, 4, 7])
    assertScoredExamExecutionTask(captured.checkpoint.tasks[index]);
  if (captured.spec.node_key !== captured.nodeKey) return fail();
  const { digest: rubricDigest, ...rubricBody } = rubric;
  if (
    typeof captured.nodeKey !== 'string' ||
    !/^[a-z0-9-]{1,100}$/.test(captured.nodeKey) ||
    captured.definitionDigest !== core ||
    captured.digest !== scoredExamEvaluationDigest(captured.spec) ||
    checkpointCanonicalJson(captured.spec.checkpoint_definition) !==
      checkpointCanonicalJson(captured.checkpoint) ||
    marker.rubricDigest !== rubricDigest ||
    marker.form !== rubric.form ||
    rubric.definitionDigest !== core ||
    scoredExamRubricDigest(rubricBody) !== rubricDigest ||
    !Array.isArray(captured.checkpoint.tasks)
  )
    return fail();
  for (const task of captured.checkpoint.tasks.slice(5)) {
    if (data(data(task).answerEvaluator).definitionDigest !== core) return fail();
  }
  assertScoredExamSourceBinding(captured.scoringSourceBinding, rubric);
  if (
    captured.scoringSourceBindingDigest !==
    scoredExamFramedDigest(captured.scoringSourceBinding, 'nextera-exam1-rubric-source-binding')
  )
    return fail();
  return freeze(captured);
}
