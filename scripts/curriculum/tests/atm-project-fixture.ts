/** TEST-ONLY NON-RUNNABLE METADATA. Never a catalog, schedule or publication source. */
import { fileURLToPath } from 'node:url';
import {
  readLocalAtmProjectFiles,
  APPROVED_ATM_SOURCE_DIRECTORY,
  APPROVED_ATM_SEMANTIC_PROFILE_DIGEST,
} from '../atm-project-source';
import { parseCurriculum } from '../load';
import { testCurriculum } from '../../../tests/fixtures/curriculum';
import type { SourceFile } from '../digest';
export const repo = fileURLToPath(new URL('../../../', import.meta.url));
export const folder = 'content/piscine-v1/projects/fixture-atm-project';
export function atmFixture() {
  const old = testCurriculum(),
    legacy = old.curriculum.nodes[0]!,
    limits = legacy.declaredLimits;
  const files: SourceFile[] = readLocalAtmProjectFiles(repo).map((file) => ({
    path: folder + file.path.slice(APPROVED_ATM_SOURCE_DIRECTORY.length),
    bytes: file.bytes,
  }));
  files.push(
    {
      path: 'content/piscine-v1/manifest.yaml',
      bytes: Buffer.from(
        `id: fixture-atm-source\nversion: fixture-only\ntitle: Fixture ATM\nstatus: development\ndefault_language: go\nquests:\n  - id: fixture\n    title: Fixture\n    order: 1\nnodes:\n  - id: fixture-atm-project\n    quest: fixture\n    type: project\n    title: Fixture ATM\n    order: 1\n    difficulty: 1\nedges: []\n`,
      ),
    },
    {
      path: folder + '/project.yaml',
      bytes: Buffer.from(
        `id: fixture-atm-project\ntitle: Fixture ATM\nlanguage: go\nsource_package: source-package.json\nsubmission:\n  required_files: [main.go]\n  allowed_extensions: [.go]\n  max_size_kb: ${legacy.submissionRules.max_size_kb}\nlimits:\n  timeout_ms: ${limits.timeout_ms}\n  memory_mb: ${limits.memory_mb}\n  output_kb: ${limits.output_kb}\njudge:\n  testpack: fixture-atm-pack\nskills: [go-control-flow]\n`,
      ),
    },
  );
  const curriculum = parseCurriculum(files),
    spec = old.evaluations[0]!.spec;
  const names = [
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
  ];
  const pack: Record<string, unknown> = Object.fromEntries(
    names.map((name) => [name, spec[name as keyof typeof spec]]),
  );
  pack.semantic_profile_digest = APPROVED_ATM_SEMANTIC_PROFILE_DIGEST;
  pack.execution_contract = {
    version: 4,
    item_key: 'fixture-atm-project',
    learner_file: 'main.go',
    function: '',
    input_type: 'stdin_utf8',
    output_type: 'atm_report_events_v1',
  };
  const catalog = { format_version: 1, test_packs: { 'fixture-atm-pack': pack } };
  return {
    files,
    curriculum,
    catalog,
    pack,
    contract: pack.execution_contract as Record<string, unknown>,
    node: curriculum.nodes[0]!,
  };
}
