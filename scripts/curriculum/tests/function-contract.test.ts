import { describe, expect, it } from 'vitest';
import type { ExecutionContract } from '@nextera/domain';
import { checkpointFixture } from '../../../tests/fixtures/checkpoints';
import candidate from '../../../infra/runner/catalog/candidate.json';
import { resolveEvaluations } from '../evaluation';

// In-memory, non-runnable metadata only. No private pack or catalog is published.
function fixture() {
  const { curriculum } = checkpointFixture();
  const task = curriculum.nodes.find((n) => n.kind === 'checkpoint')!.checkpoint!.tasks[0]!;
  const packs: Record<string, Record<string, unknown>> = Object.fromEntries(
    Object.entries(candidate.catalog.test_packs).map(([key, value]) => [
      key,
      {
        ...structuredClone(value),
        test_pack_artifact: `oci://test.invalid/non-runnable/${key}@sha256:${value.test_pack_digest}`,
      },
    ]),
  );
  const catalog = { format_version: 1, test_packs: packs };
  const contract: Record<string, unknown> = {
    version: 3,
    item_key: task.key,
    learner_file: 'original-file.go',
    function: 'Fixture',
    input_type: 'int_int',
    output_type: 'int',
  };
  task.submissionRules.required_files = ['original-file.go'];
  packs[task.testPackId]!.execution_contract = contract;
  return { curriculum, catalog, task, contract };
}

describe('source-only typed function ABI3 catalog boundary', () => {
  it.each([
    ['int_int', 'int'],
    ['pointer_int_int', 'pointer_int'],
    ['int_slice_int_int', 'int_slice_preserved'],
    ['string', 'int'],
    ['int_slice', 'int_slice_preserved'],
  ])('freezes the exact %s / %s contract into the evaluation', (input, output) => {
    const f = fixture();
    f.contract.input_type = input;
    f.contract.output_type = output;
    const resolved = resolveEvaluations(f.curriculum, f.catalog).find((r) => 'checkpoint' in r)!;
    if (!('checkpoint' in resolved)) throw new Error('Expected source fixture checkpoint');
    expect(resolved.checkpoint!.tasks[0]!.evaluationSpec.execution_contract).toEqual(f.contract);
  });

  it.each([
    { version: 4 },
    { input_type: 'any' },
    { output_type: 'string' },
    { input_type: 'int_slice', output_type: 'int' },
    { input_type: 'pointer_int_int', output_type: 'int' },
    { learner_file: '../original-file.go' },
    { function: 'fixture' },
    { learner_file: 'main.go' },
    { learner_file: 'different.go' },
    { oracle: 'forbidden' },
  ])('rejects unsupported or conflicting metadata %j', (change) => {
    const f = fixture();
    Object.assign(f.contract, change);
    expect(() => resolveEvaluations(f.curriculum, f.catalog)).toThrow();
  });

  it('supports the exact program ABI2 without reinterpreting v1', () => {
    const f = fixture();
    Object.assign(f.contract, {
      version: 2,
      learner_file: 'main.go',
      function: '',
      input_type: 'stdin_utf8',
      output_type: 'stdout_utf8_exact',
    });
    f.task.submissionRules.required_files = ['main.go'];
    expect(() => resolveEvaluations(f.curriculum, f.catalog)).not.toThrow();
    f.contract.version = 1;
    expect(() => resolveEvaluations(f.curriculum, f.catalog)).toThrow();
  });

  it('does not permit upgrading the implicit legacy pack identities', () => {
    const f = fixture();
    f.task.testPackId = 'hello-go-v1';
    f.catalog.test_packs['hello-go-v1']!.execution_contract = f.contract;
    expect(() => resolveEvaluations(f.curriculum, f.catalog)).toThrow();
  });

  it('preserves the old v1 metadata and leaves publication guards intact', () => {
    const f = checkpointFixture();
    const packs = Object.fromEntries(
      Object.entries(candidate.catalog.test_packs).map(([key, value]) => [
        key,
        {
          ...value,
          test_pack_artifact: `oci://test.invalid/non-runnable/${key}@sha256:${value.test_pack_digest}`,
        },
      ]),
    );
    const resolved = resolveEvaluations(f.curriculum, {
      format_version: 1,
      test_packs: packs,
    }).find((r) => 'checkpoint' in r)!;
    if (!('checkpoint' in resolved)) throw new Error('Expected source fixture checkpoint');
    expect(resolved.checkpoint!.tasks[0]!.evaluationSpec.execution_contract).toEqual(
      candidate.catalog.test_packs['checkpoint-normalize-label-v1'].execution_contract,
    );
    expect(() => resolveEvaluations(f.curriculum, candidate)).toThrow();
    expect(() => resolveEvaluations(f.curriculum, candidate.catalog)).toThrow();
  });

  it('keeps the domain type limited to the five complete function profiles', () => {
    const valid: ExecutionContract = {
      version: 3,
      item_key: 'fixture',
      learner_file: 'fixture.go',
      function: 'Fixture',
      input_type: 'int_slice',
      output_type: 'int_slice_preserved',
    };
    expect(valid.version).toBe(3);
    // @ts-expect-error A slice profile must declare preservation.
    const invalid: ExecutionContract = {
      version: 3,
      item_key: 'fixture',
      learner_file: 'fixture.go',
      function: 'Fixture',
      input_type: 'int_slice',
      output_type: 'int',
    };
    expect(invalid.output_type).toBe('int');
  });
});
