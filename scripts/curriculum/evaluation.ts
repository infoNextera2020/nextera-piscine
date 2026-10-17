import type { Curriculum } from '@nextera/domain';
import { parseDocument } from 'yaml';
import { evaluationDigest } from './digest';
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
export function resolveEvaluations(curriculum: Curriculum, catalog?: unknown) {
  if (!catalog)
    throw new EvaluationBoundaryError(
      'PUBLICATION_BLOCKED: approved test-pack/artifact/image digests, exact toolchain, complete compilation/execution resource limits, and protocol identities are missing. Validated draft receipt only.',
    );
  const root = object(catalog, 'catalog');
  fields(root, ['format_version', 'test_packs'], 'catalog');
  if (root.format_version !== 1)
    throw new EvaluationBoundaryError('Unsupported metadata catalog format.');
  const packs = object(root.test_packs, 'catalog.test_packs');
  return curriculum.nodes.map((node) => {
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
    const spec = {
      curriculum_key: curriculum.key,
      curriculum_version: curriculum.version,
      content_digest: curriculum.contentDigest,
      node_key: node.key,
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
    };
    return { nodeKey: node.key, spec, digest: evaluationDigest(spec) };
  });
}
