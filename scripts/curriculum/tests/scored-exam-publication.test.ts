import { describe, expect, it } from 'vitest';
import { EXAM_TRACE_COMPARATOR_V1 } from '@nextera/domain';
import {
  assertScoredExamSourceBinding,
  scoredExamFramedDigest,
} from '../../../packages/db/operations/scored-exam-publication';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import * as schema from '../../../packages/db/schema';
import {
  importCurriculum,
  type OperationalDatabase,
  type EvaluationProjection,
} from '../../../packages/db/operations/curriculum';
import { resolveEvaluations } from '../evaluation';
import { evaluationDigest } from '../digest';
import { scoredExamFixture } from './scored-exam-fixture';

type State = {
  version: Record<string, unknown> | null;
  quests: unknown[];
  nodes: Record<string, unknown>[];
  rubrics: Record<string, Record<string, unknown>>;
  definitions: unknown[];
};
function database(fault?: 'permission' | 'definition' | 'rubric-ack', gate?: Promise<void>) {
  let state: State = { version: null, quests: [], nodes: [], rubrics: {}, definitions: [] };
  const events: string[] = [],
    dialect = new PgDialect();
  const tx = {
    async execute(query: SQL) {
      const q = dialect.sqlToQuery(query),
        text = q.sql,
        params = q.params;
      if (text.includes('INSERT INTO app.exam_scoring_rubrics')) {
        events.push('rubric-insert');
        if (fault === 'permission') throw new Error('permission denied (synthetic)');
        const digest = String(params[0]);
        state.rubrics[digest] ??= {
          rubric_digest: digest,
          definition_digest: params[1],
          form: params[2],
          rubric: JSON.parse(String(params[3])),
          source_binding: JSON.parse(String(params[4])),
          source_binding_digest: params[5],
        };
      } else if (text.includes('FROM app.exam_scoring_rubrics')) {
        events.push('rubric-read');
        const row = state.rubrics[String(params[0])];
        return row
          ? [
              {
                ...row,
                ...(fault === 'rubric-ack' ? { source_binding_digest: 'f'.repeat(64) } : {}),
              },
            ]
          : [];
      } else if (text.includes('INSERT INTO app.checkpoint_definitions')) {
        events.push('definition-insert');
        if (fault === 'definition') throw new Error('definition rejected (synthetic)');
        state.definitions.push({
          curriculumVersionId: params[0],
          nodeKey: params[1],
          definitionDigest: params[2],
          definition: JSON.parse(String(params[3])),
        });
      }
      return [];
    },
    insert(table: unknown) {
      return {
        values(value: unknown) {
          if (table === schema.curriculumVersions && !state.version)
            state.version = { ...(value as object), id: '10000000-0000-4000-8000-000000000001' };
          else if (table === schema.quests) state.quests.push(...(value as unknown[]));
          else if (table === schema.curriculumNodes) {
            events.push('nodes-insert');
            state.nodes.push(...(value as Record<string, unknown>[]));
          }
          return Object.assign(Promise.resolve(), { onConflictDoNothing: async () => {} });
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              const rows =
                table === schema.curriculumVersions
                  ? state.version
                    ? [state.version]
                    : []
                  : state.nodes;
              return Object.assign(Promise.resolve(rows), { for: async () => rows });
            },
          };
        },
      };
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              return {
                async returning() {
                  events.push('publish');
                  state.version = { ...state.version, ...values };
                  return [state.version];
                },
              };
            },
          };
        },
      };
    },
  };
  const db = {
    async transaction(fn: (client: unknown) => Promise<unknown>) {
      events.push('transaction');
      if (gate) await gate;
      const before = structuredClone(state);
      try {
        const result = await fn(tx);
        events.push('commit');
        return result;
      } catch (error) {
        state = before;
        events.push('rollback');
        throw error;
      }
    },
  } as unknown as OperationalDatabase;
  return { db, events, state: () => state };
}

describe('configured transaction publication (fake client only)', () => {
  it('captures the entire marked source before a delayed transaction can observe caller mutation', async () => {
    const f = scoredExamFixture(),
      before = structuredClone(f.curriculum);
    let release: () => void = () => {
      throw new Error('Gate not armed');
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const d = database(undefined, gate),
      projections = resolveEvaluations(f.curriculum, f.catalog);
    const projectionBefore = structuredClone(projections);
    const pending = importCurriculum(d.db, f.curriculum, 'a'.repeat(40), projections);
    expect(d.events).toEqual(['transaction']);
    // Keep all identity/digest fields unchanged; native equality guards cannot detect this mutation.
    f.curriculum.quests[0]!.title = 'Mutated quest';
    f.curriculum.nodes[0]!.title = 'Mutated node';
    f.curriculum.nodes[0]!.subjectMarkdown = 'Mutated subject';
    f.curriculum.nodes[0]!.submissionRules.required_files.push('mutated.go');
    const checkpoint = f.curriculum.nodes.find((node) => node.kind === 'checkpoint')!.checkpoint!;
    checkpoint.tasks[0]!.subjectMarkdown = 'Mutated nested task';
    const ordinary: EvaluationProjection = projections.find((p) => !('scoringRubric' in p))!;
    ordinary.spec.resource_profile = 'mutated-after-await';
    ordinary.digest = evaluationDigest(ordinary.spec);
    expect(Object.isFrozen(f.curriculum)).toBe(false);
    release();
    await pending;
    expect(d.state().version).toMatchObject({
      curriculumKey: before.key,
      contentDigest: before.contentDigest,
    });
    expect(d.state().quests).toContainEqual(
      expect.objectContaining({ title: before.quests[0]!.title }),
    );
    expect(d.state().nodes).toContainEqual(
      expect.objectContaining({
        nodeKey: before.nodes[0]!.key,
        title: before.nodes[0]!.title,
        subjectMarkdown: before.nodes[0]!.subjectMarkdown,
        submissionRules: before.nodes[0]!.submissionRules,
      }),
    );
    expect(d.state().nodes).toContainEqual(
      expect.objectContaining({
        nodeKey: ordinary.nodeKey,
        evaluationSpecDigest: projectionBefore.find((p) => p.nodeKey === ordinary.nodeKey)!.digest,
      }),
    );
    expect(d.events.at(-1)).toBe('commit');
  });
  it('uses core definition identity, keeps full node identity and seeds source-bound rubric first', async () => {
    const f = scoredExamFixture(),
      projections = resolveEvaluations(f.curriculum, f.catalog),
      d = database();
    const p = projections.find((x) => 'scoringRubric' in x)!;
    await importCurriculum(d.db, f.curriculum, 'a'.repeat(40), projections);
    expect(d.events.indexOf('rubric-insert')).toBeLessThan(d.events.indexOf('definition-insert'));
    expect(d.state().definitions).toContainEqual(
      expect.objectContaining({
        nodeKey: 'transfer-checkpoint',
        definitionDigest: 'definitionDigest' in p ? p.definitionDigest : 'missing',
      }),
    );
    expect(d.state().nodes).toContainEqual(
      expect.objectContaining({ nodeKey: 'transfer-checkpoint', evaluationSpecDigest: p.digest }),
    );
    expect(d.events.at(-1)).toBe('commit');
  });
  it.each(['permission', 'definition', 'rubric-ack'] as const)(
    'rolls back every newly inserted projection on %s failure without privilege fallback',
    async (fault) => {
      const f = scoredExamFixture(),
        d = database(fault);
      await expect(
        importCurriculum(
          d.db,
          f.curriculum,
          'a'.repeat(40),
          resolveEvaluations(f.curriculum, f.catalog),
        ),
      ).rejects.toThrow();
      expect(d.events.at(-1)).toBe('rollback');
      expect(d.state()).toEqual({
        version: null,
        quests: [],
        nodes: [],
        rubrics: {},
        definitions: [],
      });
      expect(d.events).not.toContain('publish');
    },
  );
  it('rejects a forged core binding before transaction entry', async () => {
    const f = scoredExamFixture(),
      projections = resolveEvaluations(f.curriculum, f.catalog),
      d = database();
    const marked = projections.find((x) => 'definitionDigest' in x)!;
    if (!('definitionDigest' in marked)) throw new Error('Expected fixture');
    marked.definitionDigest = 'e'.repeat(64);
    await expect(
      importCurriculum(d.db, f.curriculum, 'a'.repeat(40), projections),
    ).rejects.toThrow();
    expect(d.events).toEqual([]);
  });
  it('verifies exact private rubric provenance on published idempotent replay', async () => {
    const f = scoredExamFixture(),
      projections = resolveEvaluations(f.curriculum, f.catalog),
      d = database();
    await importCurriculum(d.db, f.curriculum, 'a'.repeat(40), projections);
    const inserts = d.events.filter((x) => x === 'rubric-insert').length;
    await importCurriculum(d.db, f.curriculum, 'a'.repeat(40), projections);
    expect(d.events.filter((x) => x === 'rubric-insert')).toHaveLength(inserts);
    const row = Object.values(d.state().rubrics)[0]!;
    row.source_binding_digest = 'f'.repeat(64);
    await expect(importCurriculum(d.db, f.curriculum, 'a'.repeat(40), projections)).rejects.toThrow(
      /differs/,
    );
  });
});

describe('versioned trace comparator provenance (pure binding checks)', () => {
  it('accepts explicitly bound historical and approved names without conflating their source digests', () => {
    const f = scoredExamFixture();
    const projection = resolveEvaluations(f.curriculum, f.catalog).find(
      (p) => 'scoringRubric' in p,
    )!;
    if (!('scoringRubric' in projection)) throw new Error('Expected synthetic scoring projection');
    const oldBinding = projection.scoringSourceBinding;
    const approvedBinding = {
      ...structuredClone(oldBinding),
      decisions: { ...oldBinding.decisions, traceComparator: EXAM_TRACE_COMPARATOR_V1 },
    };
    expect(() => assertScoredExamSourceBinding(oldBinding, projection.scoringRubric)).not.toThrow();
    expect(() =>
      assertScoredExamSourceBinding(approvedBinding, projection.scoringRubric),
    ).not.toThrow();
    expect(scoredExamFramedDigest(approvedBinding, 'nextera-exam1-rubric-source-binding')).not.toBe(
      scoredExamFramedDigest(oldBinding, 'nextera-exam1-rubric-source-binding'),
    );
    expect(oldBinding.decisions.traceComparator).toBe('exact_utf8');
  });
  it('rejects missing, unknown and getter-backed version labels', () => {
    const f = scoredExamFixture();
    const projection = resolveEvaluations(f.curriculum, f.catalog).find(
      (p) => 'scoringRubric' in p,
    )!;
    if (!('scoringRubric' in projection)) throw new Error('Expected synthetic scoring projection');
    for (const invalid of [
      null,
      undefined,
      'exact_utf8_trimmed',
      'crlf_lf_optional_terminal_lf_v2',
    ]) {
      const b = structuredClone(projection.scoringSourceBinding);
      Object.assign(b.decisions, { traceComparator: invalid });
      expect(() => assertScoredExamSourceBinding(b, projection.scoringRubric)).toThrow(
        'SCORED_EXAM_PUBLICATION_INVALID',
      );
    }
    const b = structuredClone(projection.scoringSourceBinding);
    Object.defineProperty(b.decisions, 'traceComparator', {
      get() {
        throw new Error('must not execute');
      },
      enumerable: true,
    });
    expect(() => assertScoredExamSourceBinding(b, projection.scoringRubric)).toThrow(
      'SCORED_EXAM_PUBLICATION_INVALID',
    );
  });
});
