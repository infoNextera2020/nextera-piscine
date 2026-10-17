/** ISOLATED TEST FIXTURES ONLY. These identities do not describe trusted Judge artifacts.
 * Never use this module, its projections, or its metadata as a publication catalog.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadGitCurriculum, parseCurriculum } from '../../scripts/curriculum/load';
import { sha256, evaluationDigest } from '../../scripts/curriculum/digest';

const source = () => loadGitCurriculum(fileURLToPath(new URL('../../', import.meta.url)));
export function testCurriculum() {
  const original = source();
  const id = randomUUID();
  const files = original.files.map((f) =>
    f.path.endsWith('/manifest.yaml')
      ? {
          ...f,
          bytes: Buffer.from(
            Buffer.from(f.bytes)
              .toString()
              .replace('id: nextera-piscine', `id: foundation-test-only-${id}`)
              .replace('version: 0.1.0', `version: 0.1.0-test-${id}`),
          ),
        }
      : f,
  );
  const curriculum = parseCurriculum(files);
  const limits = {
    cpu_limit: 1,
    memory_bytes: 67108864,
    pid_limit: 32,
    timeout_ms: 2000,
    output_bytes: 65536,
    temporary_filesystem_bytes: 16777216,
    temporary_filesystem_inodes: 1024,
  };
  const evaluations = curriculum.nodes.map((node) => {
    const digest = sha256(`NON-RUNNABLE-TEST-PACK-${node.key}`);
    const spec = {
      test_only: true,
      curriculum_key: curriculum.key,
      curriculum_version: curriculum.version,
      content_digest: curriculum.contentDigest,
      node_key: node.key,
      subject_digest: node.subjectDigest,
      configuration_digest: node.configurationDigest,
      test_pack_id: `TEST-ONLY-${node.testPackId}`,
      test_pack_digest: digest,
      test_pack_artifact: `oci://test.invalid/non-runnable@sha256:${digest}`,
      runner_image_digest: `sha256:${sha256('NON-RUNNABLE-TEST-RUNNER')}`,
      sandbox_image_digest: `sha256:${sha256('NON-RUNNABLE-TEST-SANDBOX')}`,
      toolchain_version: 'go0.0.0',
      target_platform: 'linux/amd64',
      build_flags: [] as string[],
      dependency_policy: 'offline',
      protocol_version: 1,
      snapshot_format_version: 1,
      resource_profile: 'TEST-ONLY-NON-RUNNABLE',
      resource_limits: {
        compilation: { ...limits, memory_bytes: 536870912, timeout_ms: 20000 },
        execution: { ...limits },
      },
      case_generation: { mode: 'static' },
    };
    return { nodeKey: node.key, spec, digest: evaluationDigest(spec) };
  });
  return { curriculum, gitCommitSha: original.gitCommitSha, evaluations, files };
}
