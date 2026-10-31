import { describe, it, expect } from 'vitest';
import type { ExecutionContract } from '@nextera/domain';
import { resolveEvaluations } from '../evaluation';
import { APPROVED_ATM_SEMANTIC_PROFILE_DIGEST } from '../atm-project-source';
import { atmFixture } from './atm-project-fixture';
import { testCurriculum } from '../../../tests/fixtures/curriculum';
const legacyNames = [
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
describe('ABI4 raw main.go ATM model profile compiler boundary (fixture catalog only)', () => {
  it('freezes exact6-key execution contract plus one semantic root pin, with actual public source consumption', () => {
    const f = atmFixture(),
      resolved = resolveEvaluations(f.curriculum, f.catalog)[0]!;
    expect(resolved.spec.execution_contract).toEqual(f.contract);
    expect(Object.keys(resolved.spec.execution_contract!)).toHaveLength(6);
    expect(resolved.spec.semantic_profile_digest).toBe(APPROVED_ATM_SEMANTIC_PROFILE_DIGEST);
    expect(resolved.spec.content_digest).toBe(f.curriculum.contentDigest);
    expect(resolved.spec.subject_digest).toBe(f.node.projectSource!.subjectDigest);
    expect(JSON.stringify(resolved.spec)).not.toContain('func Report');
    expect(JSON.stringify(resolved.spec)).not.toContain('expected');
  });
  it('keeps real required catalog/image/artifact and resource configuration blocking rather than inventing defaults', () => {
    const f = atmFixture();
    expect(() => resolveEvaluations(f.curriculum)).toThrow(/PUBLICATION_BLOCKED/);
    for (const key of [
      'test_pack_artifact',
      'runner_image_digest',
      'sandbox_image_digest',
      'resource_limits',
    ]) {
      const copy = structuredClone(f.catalog);
      delete copy.test_packs['fixture-atm-pack']![key];
      expect(() => resolveEvaluations(f.curriculum, copy)).toThrow();
    }
  });
  it.each([undefined, null, '', 'wrong', 'a'.repeat(64)])(
    'requires exact approved semantic profile root value %j',
    (value) => {
      const f = atmFixture();
      if (value === undefined) delete f.pack.semantic_profile_digest;
      else f.pack.semantic_profile_digest = value;
      expect(() => resolveEvaluations(f.curriculum, f.catalog)).toThrow();
    },
  );
  it.each([
    { learner_file: 'other.go' },
    { function: 'Main' },
    { input_type: 'int64' },
    { output_type: 'stdout_utf8_exact' },
    { version: 2 },
    { expected: 'PASS' },
    { semantic_profile_digest: APPROVED_ATM_SEMANTIC_PROFILE_DIGEST },
  ])('rejects ABI4 transport drift, hidden metadata or moved binding %j', (change) => {
    const f = atmFixture();
    Object.assign(f.contract, change);
    expect(() => resolveEvaluations(f.curriculum, f.catalog)).toThrow();
  });
  it('revalidates actual resource bytes instead of trusting a forged descriptor/profile string', () => {
    const f = atmFixture();
    const forged = structuredClone(f.node.projectSource!);
    const changed = {
      ...forged,
      resources: forged.resources.map((item) =>
        item.path === 'learner-en.md' ? { ...item, text: 'unapproved business text' } : item,
      ),
    };
    f.node.projectSource = changed;
    expect(() => resolveEvaluations(f.curriculum, f.catalog)).toThrow(/byte binding/);
  });
  it.each([1, 2, 3])(
    'retains ABI%d exact serialization and rejects optional semantic field presence even null/empty',
    (version) => {
      const f = atmFixture();
      delete f.node.projectSource;
      Object.assign(f.contract, {
        version,
        learner_file: version === 2 ? 'main.go' : 'fixture.go',
        function: version === 2 ? '' : 'Fixture',
        input_type: version === 2 ? 'stdin_utf8' : version === 3 ? 'int_int' : 'string',
        output_type: version === 2 ? 'stdout_utf8_exact' : version === 3 ? 'int' : 'string',
      });
      f.node.submissionRules.required_files = [String(f.contract.learner_file)];
      delete f.pack.semantic_profile_digest;
      expect(() => resolveEvaluations(f.curriculum, f.catalog)).not.toThrow();
      for (const value of [undefined, null, '', APPROVED_ATM_SEMANTIC_PROFILE_DIGEST]) {
        f.pack.semantic_profile_digest = value;
        expect(() => resolveEvaluations(f.curriculum, f.catalog)).toThrow(/forbidden/);
      }
    },
  );
  it.each([
    { mode: 'generated', seed: 'fixture', generator_version: 'fixture' },
    { mode: 'static', seed: '' },
    { mode: 'static', generator_version: null },
  ])(
    'requires ABI4 exact static case metadata without generated/default extras %j',
    (generation) => {
      const f = atmFixture();
      f.pack.case_generation = generation;
      expect(() => resolveEvaluations(f.curriculum, f.catalog)).toThrow(/static input-only/);
    },
  );
  it('does not infer semantic profile from project name/output or permit implicit legacy pack upgrades', () => {
    const f = atmFixture();
    delete f.node.projectSource;
    expect(() => resolveEvaluations(f.curriculum, f.catalog)).toThrow(/source package/);
    const other = atmFixture();
    other.node.testPackId = 'hello-go-v1';
    other.catalog.test_packs = Object.assign(other.catalog.test_packs, {
      'hello-go-v1': other.pack,
    });
    expect(() => resolveEvaluations(other.curriculum, other.catalog)).toThrow();
  });
  it.each([undefined, null, '', APPROVED_ATM_SEMANTIC_PROFILE_DIGEST])(
    'forbids semantic field presence for all legacy implicit identities even %j',
    (value) => {
      const old = testCurriculum(),
        packs = Object.fromEntries(
          old.curriculum.nodes.map((node, index) => [
            node.testPackId,
            Object.fromEntries(
              legacyNames.map((name) => [
                name,
                (old.evaluations[index]!.spec as Record<string, unknown>)[name],
              ]),
            ),
          ]),
        );
      const catalog = { format_version: 1, test_packs: packs };
      const first = old.curriculum.nodes[0]!.testPackId;
      packs[first]!.semantic_profile_digest = value;
      expect(() => resolveEvaluations(old.curriculum, catalog)).toThrow(/forbidden/);
    },
  );
  it('omits the optional field from unchanged legacy resolved JSON and accepts the new domain type only with ABI4 values', () => {
    const old = testCurriculum(),
      packs = Object.fromEntries(
        old.curriculum.nodes.map((node, index) => [
          node.testPackId,
          Object.fromEntries(
            legacyNames.map((name) => [
              name,
              (old.evaluations[index]!.spec as Record<string, unknown>)[name],
            ]),
          ),
        ]),
      );
    const resolved = resolveEvaluations(old.curriculum, { format_version: 1, test_packs: packs });
    expect(JSON.stringify(resolved)).not.toContain('semantic_profile_digest');
    const contract: ExecutionContract = {
      version: 4,
      item_key: 'fixture-atm-project',
      learner_file: 'main.go',
      function: '',
      input_type: 'stdin_utf8',
      output_type: 'atm_report_events_v1',
    };
    expect(contract.version).toBe(4);
  });
});
