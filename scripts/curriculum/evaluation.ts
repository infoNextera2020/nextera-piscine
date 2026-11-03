import {
  APPROVED_ATM_SEMANTIC_PROFILE_DIGEST,
  assertApprovedAtmProjectSource,
} from './atm-project-source';
import {
  checkpointScoringPolicy,
  type Curriculum,
  type CheckpointDefinition,
  type CheckpointTask,
  type ScoredExamSourceTask,
} from '@nextera/domain';
import { parseDocument } from 'yaml';
import { evaluationDigest, scoredExamEvaluationDigest } from './digest';
import { resolveScoredExamEvaluation } from './scored-exam-source';
import { object, positive, text } from './load';

export class EvaluationBoundaryError extends Error {}
export function parseEvaluationCatalog(source: string): unknown {
  JSON.parse(source); // Require JSON syntax; YAML's unique-key check prevents last-key-wins parsing.
  const document = parseDocument(source, {
    uniqueKeys: true,
    strict: true,
    stringKeys: true,
    prettyErrors: false,
  });
  if (document.errors.length || document.warnings.length)
    throw new EvaluationBoundaryError('Catalog contains duplicate or invalid JSON keys.');
  return document.toJS({ maxAliasCount: 0 }) as unknown;
}
const hash = (value: unknown, name: string) => {
  const result = text(value, name);
  if (!/^[a-f0-9]{64}$/.test(result))
    throw new EvaluationBoundaryError(`${name}: SHA-256 required.`);
  return result;
};
const image = (value: unknown, name: string) => {
  const result = text(value, name);
  if (!/^sha256:[a-f0-9]{64}$/.test(result))
    throw new EvaluationBoundaryError(`${name}: immutable image digest required.`);
  return result;
};
const fields = (value: Record<string, unknown>, names: string[], context: string) => {
  if (Object.keys(value).some((key) => !names.includes(key)))
    throw new EvaluationBoundaryError(
      `${context}: unknown metadata field; hidden content is forbidden.`,
    );
};

/** Input is a protected, metadata-only catalog supplied by the trusted Judge build owner. */
function resolveEvaluationCatalog(curriculum: Curriculum<CheckpointDefinition>, catalog?: unknown) {
  if (!catalog)
    throw new EvaluationBoundaryError(
      'PUBLICATION_BLOCKED: approved test-pack/artifact/image digests, exact toolchain, complete compilation/execution resource limits, and protocol identities are missing. Validated draft receipt only.',
    );
  const root = object(catalog, 'catalog');
  fields(root, ['format_version', 'test_packs', 'scored_exam_rubrics'], 'catalog');
  if (root.format_version !== 1)
    throw new EvaluationBoundaryError('Unsupported metadata catalog format.');
  const packs = object(root.test_packs, 'catalog.test_packs');
  const resolve = (
    node: Curriculum<CheckpointDefinition>['nodes'][number] | CheckpointTask | ScoredExamSourceTask,
    nodeKey: string,
    scored = false,
  ) => {
    if (!node.testPackId || !node.declaredLimits)
      throw new EvaluationBoundaryError('A real execution pack and limits are required for code.');
    const pack = object(packs[node.testPackId], `Missing approved test pack ${node.testPackId}`);
    fields(
      pack,
      [
        'test_pack_digest',
        'test_pack_artifact',
        'runner_image_digest',
        'sandbox_image_digest',
        'toolchain_version',
        'target_platform',
        'build_flags',
        'dependency_policy',
        'resource_profile',
        'resource_limits',
        'protocol_version',
        'snapshot_format_version',
        'case_generation',
        'execution_contract',
        'semantic_profile_digest',
      ],
      node.testPackId,
    );
    const packDigest = hash(pack.test_pack_digest, 'test_pack_digest');
    const artifact = text(pack.test_pack_artifact, 'test_pack_artifact');
    if (
      !/^oci:\/\/[a-zA-Z0-9./_:-]+@sha256:[a-f0-9]{64}$/.test(artifact) ||
      !artifact.endsWith(`@sha256:${packDigest}`)
    )
      throw new EvaluationBoundaryError(
        'Test-pack artifact must be an immutable OCI reference matching its digest.',
      );
    if (
      scored &&
      !new RegExp('^oci://[A-Za-z0-9][A-Za-z0-9./_:-]*@sha256:' + packDigest + '$').test(artifact)
    )
      throw new EvaluationBoundaryError(
        'Marked Exam1 requires the exact native OCI artifact contract.',
      );
    const toolchain = text(pack.toolchain_version, 'toolchain_version');
    if (
      !/^go[0-9]+\.[0-9]+\.[0-9]+$/.test(toolchain) ||
      !/^linux\/(amd64|arm64)$/.test(text(pack.target_platform, 'target_platform'))
    )
      throw new EvaluationBoundaryError('Exact Go toolchain and target platform required.');
    if (
      pack.dependency_policy !== 'offline' ||
      !Array.isArray(pack.build_flags) ||
      !pack.build_flags.every((v) => typeof v === 'string')
    )
      throw new EvaluationBoundaryError(
        'Trusted build flags and offline dependency policy required.',
      );
    const resources = object(pack.resource_limits, 'resource_limits');
    fields(resources, ['compilation', 'execution'], 'resource_limits');
    for (const phase of ['compilation', 'execution']) {
      const limits = object(resources[phase], phase);
      const names = [
        'cpu_limit',
        'memory_bytes',
        'pid_limit',
        'timeout_ms',
        'output_bytes',
        'temporary_filesystem_bytes',
        'temporary_filesystem_inodes',
      ];
      fields(limits, names, phase);
      for (const name of names) {
        if (name === 'cpu_limit') {
          if (
            typeof limits[name] !== 'number' ||
            !Number.isFinite(limits[name]) ||
            limits[name] <= 0
          )
            throw new EvaluationBoundaryError('Positive finite CPU limit required.');
        } else positive(limits[name], `${phase}.${name}`);
      }
    }
    const execution = object(resources.execution, 'execution');
    if (
      execution.timeout_ms !== node.declaredLimits.timeout_ms ||
      execution.memory_bytes !== node.declaredLimits.memory_mb * 1024 * 1024 ||
      execution.output_bytes !== node.declaredLimits.output_kb * 1024
    )
      throw new EvaluationBoundaryError(
        `${node.key}: resolved execution limits conflict with Git configuration.`,
      );
    const generation = object(pack.case_generation, 'case_generation');
    fields(generation, ['mode', 'seed', 'generator_version'], 'case_generation');
    if (generation.mode !== 'static' && generation.mode !== 'generated')
      throw new EvaluationBoundaryError('Explicit test case generation policy required.');
    if (generation.mode === 'generated') {
      text(generation.seed, 'seed');
      text(generation.generator_version, 'generator_version');
    }
    let contract: Record<string, unknown> | undefined;
    if (pack.execution_contract !== undefined) {
      contract = object(pack.execution_contract, 'execution_contract');
      fields(
        contract,
        ['version', 'item_key', 'learner_file', 'function', 'input_type', 'output_type'],
        'execution_contract',
      );
      const functionName =
        typeof contract.function === 'string' &&
        /^[A-Z][A-Za-z0-9_]{0,63}$/.test(contract.function);
      const v1 =
        contract.version === 1 &&
        functionName &&
        ['string', 'int64'].includes(String(contract.input_type)) &&
        contract.output_type === 'string' &&
        contract.learner_file !== 'main.go' &&
        /^[A-Za-z0-9_][A-Za-z0-9_]*[.]go$/.test(String(contract.learner_file));
      const v2 =
        contract.version === 2 &&
        contract.function === '' &&
        contract.input_type === 'stdin_utf8' &&
        contract.output_type === 'stdout_utf8_exact' &&
        contract.learner_file === 'main.go';
      const v4 =
        contract.version === 4 &&
        contract.function === '' &&
        contract.input_type === 'stdin_utf8' &&
        contract.output_type === 'atm_report_events_v1' &&
        contract.learner_file === 'main.go';
      const v3 =
        contract.version === 3 &&
        functionName &&
        contract.learner_file !== 'main.go' &&
        (((contract.input_type === 'int_int' || contract.input_type === 'string') &&
          contract.output_type === 'int') ||
          ((contract.input_type === 'pointer_int_int' || contract.input_type === 'pointer_int') &&
            contract.output_type === 'pointer_int') ||
          (contract.input_type === 'pointer_pair' && contract.output_type === 'swap') ||
          (contract.input_type === 'int_int' && contract.output_type === 'div_mod') ||
          ((contract.input_type === 'int_slice_int_int' || contract.input_type === 'int_slice') &&
            contract.output_type === 'int_slice_preserved'));
      if (
        !(v1 || v2 || v3 || v4) ||
        contract.item_key !== node.key ||
        typeof contract.item_key !== 'string' ||
        contract.item_key.length > 100 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contract.item_key) ||
        typeof contract.learner_file !== 'string' ||
        contract.learner_file.length > 100 ||
        !/^[A-Za-z0-9_][A-Za-z0-9_.-]*[.]go$/.test(contract.learner_file) ||
        ((contract.version === 2 || contract.version === 3 || contract.version === 4) &&
          ['hello-go-v1', 'even-or-odd-v1'].includes(node.testPackId)) ||
        node.submissionRules.required_files.length !== 1 ||
        node.submissionRules.required_files[0] !== contract.learner_file
      )
        throw new EvaluationBoundaryError(
          'Trusted execution contract conflicts with curriculum task.',
        );
    }
    const projectSource = 'projectSource' in node ? node.projectSource : undefined;
    if (contract?.version === 4) {
      if (generation.mode !== 'static' || Reflect.ownKeys(generation).length !== 1)
        throw new EvaluationBoundaryError(
          'ABI4 requires explicit exact static input-only case generation.',
        );
      if (projectSource) assertApprovedAtmProjectSource(projectSource);
      if (
        !('kind' in node) ||
        node.kind !== 'project' ||
        !projectSource ||
        projectSource.semanticProfileDigest !== APPROVED_ATM_SEMANTIC_PROFILE_DIGEST ||
        !Object.hasOwn(pack, 'semantic_profile_digest') ||
        hash(pack.semantic_profile_digest, 'semantic_profile_digest') !==
          projectSource.semanticProfileDigest
      )
        throw new EvaluationBoundaryError(
          'ABI4 requires the exact approved ATM source package and semantic profile digest.',
        );
    } else if (Object.hasOwn(pack, 'semantic_profile_digest') || projectSource) {
      throw new EvaluationBoundaryError(
        'ATM semantic profile metadata is forbidden for legacy ABI1/2/3 or implicit contracts.',
      );
    }
    if (scored && contract?.version !== 3)
      throw new EvaluationBoundaryError(
        'Marked Exam1 code requires the restricted function ABI3 profile.',
      );
    const spec = {
      curriculum_key: curriculum.key,
      curriculum_version: curriculum.version,
      content_digest: curriculum.contentDigest,
      node_key: nodeKey,
      subject_digest: node.subjectDigest,
      configuration_digest: node.configurationDigest,
      test_pack_id: node.testPackId,
      test_pack_digest: packDigest,
      test_pack_artifact: artifact,
      runner_image_digest: image(pack.runner_image_digest, 'runner_image_digest'),
      sandbox_image_digest: image(pack.sandbox_image_digest, 'sandbox_image_digest'),
      toolchain_version: toolchain,
      target_platform: pack.target_platform,
      build_flags: pack.build_flags,
      dependency_policy: 'offline',
      resource_profile: text(pack.resource_profile, 'resource_profile'),
      resource_limits: resources,
      protocol_version: positive(pack.protocol_version, 'protocol_version'),
      snapshot_format_version: positive(pack.snapshot_format_version, 'snapshot_format_version'),
      case_generation: generation,
      ...(contract?.version === 4 ? { semantic_profile_digest: pack.semantic_profile_digest } : {}),
      ...(contract ? { execution_contract: contract } : {}),
    };
    return {
      nodeKey,
      spec,
      digest: scored ? scoredExamEvaluationDigest(spec) : evaluationDigest(spec),
    };
  };
  return curriculum.nodes.map((node) => {
    if (node.kind !== 'checkpoint') return resolve(node, node.key);
    if (!node.checkpoint) throw new EvaluationBoundaryError('Checkpoint definition required.');
    if (node.checkpoint.policyVersion === 3)
      return resolveScoredExamEvaluation(node, node.checkpoint, root.scored_exam_rubrics, (task) =>
        resolve(task, node.key, true),
      );
    checkpointScoringPolicy(node.checkpoint);
    const tasks = node.checkpoint.tasks.map((task) => {
      const resolved = resolve(task, node.key);
      if (!('execution_contract' in resolved.spec))
        throw new EvaluationBoundaryError(
          'Checkpoint task requires explicit trusted execution contract.',
        );
      return { ...task, evaluationSpec: resolved.spec, evaluationDigest: resolved.digest };
    });
    // Keep v1's exact serialized shape; v2 commits the explicit exam threshold.
    const definition =
      node.checkpoint.policyVersion === 1
        ? { policyVersion: 1 as const, durationSeconds: 5400 as const, tasks }
        : {
            policyVersion: 2 as const,
            durationSeconds: 5400 as const,
            passPoints: node.checkpoint.passPoints,
            tasks,
          };
    const spec = {
      ...tasks[0]!.evaluationSpec,
      checkpoint_definition: definition,
      subject_digest: node.subjectDigest,
      configuration_digest: node.configurationDigest,
    };
    return { nodeKey: node.key, spec, digest: evaluationDigest(spec), checkpoint: definition };
  });
}

type AllResolvedEvaluations = ReturnType<typeof resolveEvaluationCatalog>;
type LegacyResolvedEvaluations = Exclude<
  AllResolvedEvaluations[number],
  ReturnType<typeof resolveScoredExamEvaluation>
>[];
export function resolveEvaluations(
  curriculum: Curriculum,
  catalog?: unknown,
): LegacyResolvedEvaluations;
export function resolveEvaluations(
  curriculum: Curriculum<CheckpointDefinition>,
  catalog?: unknown,
): AllResolvedEvaluations;
export function resolveEvaluations(
  curriculum: Curriculum<CheckpointDefinition>,
  catalog?: unknown,
) {
  return resolveEvaluationCatalog(curriculum, catalog);
}
