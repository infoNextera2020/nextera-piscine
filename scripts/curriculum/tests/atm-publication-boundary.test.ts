import { describe, expect, it, vi } from 'vitest';
import {
  importCurriculum,
  AtmPublicationPreparationError,
  ATM_PUBLICATION_MISSING_CAPABILITIES,
  type EvaluationProjection,
  type OperationalDatabase,
} from '../../../packages/db/operations/curriculum';
import * as schema from '../../../packages/db/schema';
import { atmFixture } from './atm-project-fixture';
import { testCurriculum } from '../../../tests/fixtures/curriculum';
import { resolveEvaluations } from '../evaluation';
import { readLocalAtmProjectFiles, validateAtmProjectSource } from '../atm-project-source';
import { repo } from './atm-project-fixture';

/** Strict fake: even looking up a DB method is observable and forbidden for blocked input. */
function forbiddenDatabase() {
  const accessed = vi.fn();
  const db = new Proxy(
    {},
    {
      get(_target, key) {
        accessed(key);
        throw Error('fake DB must not be accessed');
      },
    },
  ) as OperationalDatabase;
  return { db, accessed };
}
async function blocked(
  curriculum: Parameters<typeof importCurriculum>[1],
  evaluations?: EvaluationProjection[],
) {
  const d = forbiddenDatabase();
  const pending = importCurriculum(d.db, curriculum, 'a'.repeat(40), evaluations);
  expect(d.accessed).not.toHaveBeenCalled();
  await expect(pending).rejects.toMatchObject({
    code: 'ATM_PUBLICATION_PREPARATION_REQUIRED',
    missingCapabilities: ATM_PUBLICATION_MISSING_CAPABILITIES,
  });
  expect(d.accessed).not.toHaveBeenCalled();
}

/** Pure in-memory legacy fake. No native database, SQL executor or publication exists. */
function legacyDatabase(beforeTransaction?: () => void) {
  let version: Record<string, unknown> | null = null;
  const nodes: unknown[] = [],
    events: string[] = [];
  const tx = {
    async execute() {
      events.push('fake-advisory');
      return [];
    },
    insert(table: unknown) {
      return {
        values(value: unknown) {
          if (table === schema.curriculumVersions)
            version = { ...(value as object), id: 'fixture-version' };
          if (table === schema.curriculumNodes) nodes.push(...(value as unknown[]));
          return Object.assign(Promise.resolve(), { onConflictDoNothing: async () => {} });
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              const rows = table === schema.curriculumVersions ? [version] : nodes;
              return Object.assign(Promise.resolve(rows), { for: async () => rows });
            },
          };
        },
      };
    },
    update() {
      return {
        set(value: unknown) {
          return {
            where() {
              return {
                returning: async () => {
                  events.push('fake-publish');
                  version = { ...version, ...(value as object) };
                  return [version];
                },
              };
            },
          };
        },
      };
    },
  };
  const transaction = vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => {
    events.push('fake-transaction');
    beforeTransaction?.();
    return fn(tx);
  });
  return {
    db: { transaction } as unknown as OperationalDatabase,
    transaction,
    events,
    nodes,
    version: () => version,
  };
}

describe('exact ATM publication preparation boundary (fake DB only)', () => {
  it.each([false, true])(
    'blocks actual parsed ATM source before DB with evaluations=%j',
    async (includeEvaluations) => {
      const f = atmFixture();
      await blocked(
        f.curriculum,
        includeEvaluations ? resolveEvaluations(f.curriculum, f.catalog) : undefined,
      );
    },
  );
  it.each([undefined, null, {}])(
    'does not silently drop an ATM projectSource descriptor even %j',
    async (value) => {
      const f = testCurriculum();
      Object.defineProperty(f.curriculum.nodes[0]!, 'projectSource', { value, enumerable: true });
      await blocked(f.curriculum);
    },
  );
  it('rejects accessor-bearing source/spec input before getter invocation or DB access', async () => {
    for (const marker of ['projectSource', 'spec']) {
      const f = testCurriculum(),
        d = forbiddenDatabase();
      let invoked = false;
      const object = marker === 'projectSource' ? f.curriculum.nodes[0]! : f.evaluations[0]!;
      Object.defineProperty(object, marker, {
        enumerable: true,
        get() {
          invoked = true;
          throw Error('must not invoke publication getter');
        },
      });
      await expect(
        importCurriculum(d.db, f.curriculum, 'a'.repeat(40), f.evaluations),
      ).rejects.toThrow(/plain finite data without accessors/);
      expect(invoked).toBe(false);
      expect(d.accessed).not.toHaveBeenCalled();
    }
  });
  it.each([4, '4'])(
    'blocks ABI%j projection even if the source descriptor and semantic pin are removed',
    async (version) => {
      const f = testCurriculum();
      const projections: EvaluationProjection[] = [
        {
          nodeKey: f.curriculum.nodes[0]!.key,
          digest: 'b'.repeat(64),
          spec: {
            execution_contract: {
              version,
              learner_file: 'main.go',
              function: '',
              input_type: 'stdin_utf8',
              output_type: 'atm_report_events_v1',
            },
          },
        },
      ];
      await blocked(f.curriculum, projections);
    },
  );
  it.each([
    undefined,
    null,
    '',
    'f09da2b66999409f6dc08ea8f54ef5c34ac259d48cccf5b1d66ecb63ad4c1007',
  ])('blocks semantic root field presence even %j independently of ABI/name', async (value) => {
    const f = testCurriculum();
    const projection = {
      ...f.evaluations[0]!,
      spec: { ...f.evaluations[0]!.spec, semantic_profile_digest: value },
    };
    await blocked(f.curriculum, [projection]);
  });
  it.each(['checkpoint', 'checkpoint_definition'])(
    'does not allow nested resolved task metadata through %s publication',
    async (location) => {
      const f = testCurriculum();
      const nested = {
        policyVersion: 1,
        tasks: [{ evaluationSpec: { execution_contract: { version: 4 } } }],
      };
      const projection: EvaluationProjection = {
        nodeKey: f.curriculum.nodes[0]!.key,
        digest: 'b'.repeat(64),
        spec: location === 'checkpoint_definition' ? { checkpoint_definition: nested } : {},
        ...(location === 'checkpoint' ? { checkpoint: nested } : {}),
      };
      await blocked(f.curriculum, [projection]);
    },
  );
  it('cannot be enabled by fabricated ready/publication flags', async () => {
    const f = atmFixture(),
      projections = resolveEvaluations(f.curriculum, f.catalog);
    Object.assign(projections[0]!.spec, {
      activation: { resources_persisted: true, schedule_ready: true, capture_ready: true },
      published: true,
    });
    await blocked(f.curriculum, projections);
  });
  it('leaves standalone source validation executable and returns exact missing capabilities in a preparation error', () => {
    const checked = validateAtmProjectSource(readLocalAtmProjectFiles(repo));
    expect(checked.sourceValidated).toBe(true);
    expect(checked.runtimeReadiness).toBe('not_proven');
    const error = new AtmPublicationPreparationError();
    expect(error.message).toContain('before database access');
    expect(error.missingCapabilities).toEqual([
      'content_addressed_public_resource_persistence_and_authorized_readback',
      'explicit_cohort_schedule_activation_independent_of_exam1_result',
      'abi4_trusted_capture_registration_and_result_activation',
    ]);
  });
  it.each(['node', 'spec'])(
    'captures marker-free legacy input before a delayed caller injects ATM %s metadata',
    async (location) => {
      const f = testCurriculum(),
        before = structuredClone(f.evaluations);
      const d = legacyDatabase(() => {
        if (location === 'node')
          Object.defineProperty(f.curriculum.nodes[0]!, 'projectSource', {
            value: { resources: ['late ATM bytes'] },
            enumerable: true,
          });
        else
          (f.evaluations[0]! as EvaluationProjection).spec = {
            execution_contract: { version: 4 },
            semantic_profile_digest: 'f'.repeat(64),
          };
      });
      await importCurriculum(d.db, f.curriculum, 'a'.repeat(40), f.evaluations);
      expect(d.nodes).toHaveLength(before.length);
      expect(d.nodes[0]).toMatchObject({ resolvedEvaluationSpec: before[0]!.spec });
      expect(JSON.stringify(d.nodes)).not.toContain('semantic_profile_digest');
      expect(JSON.stringify(d.nodes)).not.toContain('projectSource');
      expect(d.events.at(-1)).toBe('fake-publish');
    },
  );
  it('keeps fractional legacy resource values/optional fields and caller mutability intact', async () => {
    const f = testCurriculum(),
      d = legacyDatabase();
    (f.evaluations[0]!.spec.resource_limits.compilation as { cpu_limit: number }).cpu_limit = 0.5;
    (f.evaluations[0]!.spec as Record<string, unknown>).optional_fixture_field = undefined;
    await importCurriculum(d.db, f.curriculum, 'a'.repeat(40), f.evaluations);
    expect(d.nodes[0]).toMatchObject({
      resolvedEvaluationSpec: { resource_limits: { compilation: { cpu_limit: 0.5 } } },
    });
    expect(Object.isFrozen(f.curriculum)).toBe(false);
    expect(Object.isFrozen(f.evaluations[0]!.spec)).toBe(false);
  });
  it('preserves legacy draft-receipt behavior with the in-memory fake and no evaluation projections', async () => {
    const f = testCurriculum(),
      d = legacyDatabase();
    const result = await importCurriculum(d.db, f.curriculum, 'a'.repeat(40));
    expect(result.status).toBe('draft');
    expect(d.transaction).toHaveBeenCalledOnce();
    expect(d.events).not.toContain('fake-publish');
    expect(d.nodes).toEqual([]);
  });
  it('preserves actual legacy publication projection behavior with an in-memory fake', async () => {
    const f = testCurriculum(),
      d = legacyDatabase();
    const result = await importCurriculum(d.db, f.curriculum, 'a'.repeat(40), f.evaluations);
    expect(result.status).toBe('published');
    expect(d.transaction).toHaveBeenCalledOnce();
    expect(d.nodes).toHaveLength(f.curriculum.nodes.length);
    expect(d.events.at(-1)).toBe('fake-publish');
  });
});
