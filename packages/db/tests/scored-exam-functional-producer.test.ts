import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { scoredProjection } from '../../../scripts/curriculum/tests/scored-exam-fixture';
import { scoredExamFramedDigest } from '../operations/scored-exam-publication';
import {
  RECORD_EXAM_SCORING_EVENT_SQL,
  examScoringEventDigest,
  type ExamScoringReviewClient,
} from '../queries/exam-scoring-review';
import {
  prepareScoredExamFunctionalManifest,
  createScoredExamFunctionalProducer,
  readScoredExamFunctionalContext,
  buildScoredExamFunctionalEvidence,
  READ_SCORED_EXAM_FUNCTIONAL_CONTEXT_SQL,
  type ScoredExamFunctionalContext,
  type ScoredExamFunctionalReport,
} from '../queries/scored-exam-functional-producer';
const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const h = (v: string) => v.repeat(64),
  id = (n: number) => '00000000-0000-0000-0000-' + n.toString(16).padStart(12, '0');
function publication() {
  const p = scoredProjection(),
    publicText = '[ {"input": [1,2], "expected": 3} ]',
    privateText = '[{"input":[0,0],"expected":0}]';
  const group = p.scoringRubric.questions[0]!.functionalGroups[0]!;
  const manifest = {
    version: 1,
    failureSemantics: 'complete-observations-only-v1',
    caseFiles: { publicSha256: hash(publicText), privateSha256: hash(privateText) },
    groups: [
      {
        groupKey: group.key,
        criteriaDigest: group.criteriaDigest,
        cases: [
          { index: 0, caseSha256: hash('{"input": [1,2], "expected": 3}') },
          { index: 1, caseSha256: hash('{"input":[0,0],"expected":0}') },
        ],
      },
    ],
  };
  const input = {
    evaluatorKey: 'official-code' as const,
    evaluatorDigest: h('e'),
    testPackId: 'synthetic-pack',
    testPackDigest: h('f'),
    questionKey: 'q1',
    rubric: p.scoringRubric,
    sourceBinding: p.scoringSourceBinding,
    sourceBindingDigest: p.scoringSourceBindingDigest,
    manifestBytes: Buffer.from(JSON.stringify(manifest)),
    publicCasesBytes: Buffer.from(publicText),
    privateCasesBytes: Buffer.from(privateText),
  };
  return { input, manifest };
}
function fixture() {
  const { input } = publication(),
    prepared = prepareScoredExamFunctionalManifest(input),
    b = prepared.binding;
  const context: ScoredExamFunctionalContext = {
    version: 1,
    submissionId: id(1),
    jobId: id(2),
    attemptId: id(3),
    learnerId: id(4),
    cohortId: id(5),
    questionKey: 'q1',
    answerSha256: h('a'),
    definitionDigest: b.definitionDigest,
    snapshotDigest: h('b'),
    rubricDigest: b.rubricDigest,
    rubricSourceBindingDigest: b.rubricSourceBindingDigest,
    publishedCriteriaDigest: input.rubric.questions[0]!.publishedCriteriaDigest,
    evaluatorKey: 'official-code',
    evaluatorDigest: b.evaluatorDigest,
    evaluationSnapshotDigest: h('c'),
    evaluationSpecDigest: b.evaluatorDigest,
    testPackId: b.testPackId,
    testPackDigest: b.testPackDigest,
    manifestSha256: b.manifestSha256,
    publicCasesSha256: b.publicCasesSha256,
    privateCasesSha256: b.privateCasesSha256,
    caseCount: b.caseCount,
    manifestBindingDigest: prepared.manifestBindingDigest,
    expectedRevision: '9007199254740993',
    groups: prepared.manifest.groups.map((g) => ({
      groupKey: g.groupKey,
      criteriaDigest: g.criteriaDigest,
    })),
  };
  const report: ScoredExamFunctionalReport = {
    version: 1,
    jobId: context.jobId,
    submissionId: context.submissionId,
    itemKey: context.questionKey,
    evaluationSnapshotDigest: context.evaluationSnapshotDigest,
    evaluationSpecDigest: context.evaluationSpecDigest,
    artifactSha256: context.answerSha256,
    testPackId: context.testPackId,
    testPackDigest: context.testPackDigest,
    manifestSha256: context.manifestSha256,
    publicCasesSha256: context.publicCasesSha256,
    privateCasesSha256: context.privateCasesSha256,
    caseCount: context.caseCount,
    groups: context.groups.map((g) => ({ ...g, passed: false })),
  };
  return { context, report };
}
function client(
  context = fixture().context,
  options: { lost?: boolean; malformed?: boolean } = {},
) {
  const calls: { sql: string; parameters: unknown[] }[] = [];
  let lost = options.lost ?? false;
  const unsafe = vi.fn(async (sql: string, parameters: unknown[] = []): Promise<unknown> => {
    calls.push({ sql, parameters: structuredClone(parameters) });
    if (sql === READ_SCORED_EXAM_FUNCTIONAL_CONTEXT_SQL)
      return [{ data: structuredClone(context) }];
    if (sql !== RECORD_EXAM_SCORING_EVENT_SQL) throw new Error('unexpected SQL');
    if (lost) {
      lost = false;
      throw new Error('acknowledgement lost');
    }
    if (options.malformed) return [{ data: { kind: 'recorded' } }];
    return [
      {
        data: {
          kind: 'recorded',
          eventId: id(8),
          operationId: parameters[1],
          submissionId: parameters[2],
          revision: (BigInt(String(parameters[3])) + 1n).toString(),
          payloadDigest: parameters[6],
          replayed: calls.filter((c) => c.sql === RECORD_EXAM_SCORING_EVENT_SQL).length > 1,
        },
      },
    ];
  });
  return { client: { unsafe } as unknown as ExamScoringReviewClient, calls, unsafe };
}
describe('private complete-observations manifest preparation, synthetic bytes only', () => {
  it('binds exact raw manifest/case bytes and existing approved-source envelope without enabling runtime', () => {
    const f = publication(),
      p = prepareScoredExamFunctionalManifest(f.input);
    expect(p.runtimeEnabled).toBe(false);
    expect(Object.hasOwn(p, 'manifestSha256')).toBe(false);
    expect(p.binding.manifestSha256).toBe(hash(f.input.manifestBytes));
    expect(p.manifestBindingDigest).toBe(
      scoredExamFramedDigest(p.binding, '01coding-exam-functional-manifest-binding'),
    );
    expect(p.manifest.failureSemantics).toBe('complete-observations-only-v1');
    expect(p.manifest.groups[0]!.cases.map((c) => c.index)).toEqual([0, 1]);
  });
  it.each([
    'missing-profile',
    'weights',
    'duplicate',
    'partial',
    'wrong-case',
    'wrong-file',
    'wrong-criterion',
  ] as const)('rejects %s without inferring approval, weights or coverage', (fault) => {
    const f = publication(),
      m = structuredClone(f.manifest) as Record<string, unknown>,
      groups = m.groups as {
        criteriaDigest: string;
        cases: { index: number; caseSha256: string }[];
        points?: number;
      }[];
    if (fault === 'missing-profile') delete m.failureSemantics;
    if (fault === 'weights') groups[0]!.points = 13;
    if (fault === 'duplicate') groups[0]!.cases[1]!.index = 0;
    if (fault === 'partial') groups[0]!.cases.pop();
    if (fault === 'wrong-case') groups[0]!.cases[0]!.caseSha256 = h('0');
    if (fault === 'wrong-file') (m.caseFiles as Record<string, unknown>).privateSha256 = h('0');
    if (fault === 'wrong-criterion') groups[0]!.criteriaDigest = h('0');
    expect(() =>
      prepareScoredExamFunctionalManifest({
        ...f.input,
        manifestBytes: Buffer.from(JSON.stringify(m)),
      }),
    ).toThrow();
  });
  it('rejects changed approved source binding and retains no supplied mutable manifest buffer', () => {
    const f = publication();
    expect(() =>
      prepareScoredExamFunctionalManifest({ ...f.input, sourceBindingDigest: h('0') }),
    ).toThrow();
    const p = prepareScoredExamFunctionalManifest(f.input),
      base64 = p.manifestBase64;
    f.input.manifestBytes.fill(0);
    expect(p.manifestBase64).toBe(base64);
    expect(Object.isFrozen(p.manifest.groups[0]!.cases)).toBe(true);
  });
});
describe('restricted native context to existing0024 functional event writer', () => {
  it('reads exact job/acceptance identity with decimal head revision and no role claim', async () => {
    const f = fixture(),
      db = client(f.context),
      c = await readScoredExamFunctionalContext(db.client, f.context.submissionId, f.context.jobId);
    expect(c).toEqual(f.context);
    expect(c.expectedRevision).toBe('9007199254740993');
    expect(db.calls).toEqual([
      { sql: READ_SCORED_EXAM_FUNCTIONAL_CONTEXT_SQL, parameters: [id(1), id(2)] },
    ]);
  });
  it.each([
    'jobId',
    'submissionId',
    'itemKey',
    'evaluationSnapshotDigest',
    'evaluationSpecDigest',
    'artifactSha256',
    'testPackId',
    'testPackDigest',
    'manifestSha256',
    'publicCasesSha256',
    'privateCasesSha256',
    'caseCount',
    'groups',
  ] as const)('rejects %s report substitution before any functional write', async (field) => {
    const f = fixture(),
      db = client(f.context),
      producer = createScoredExamFunctionalProducer(db.client),
      r = {
        ...f.report,
        [field]:
          field === 'groups'
            ? []
            : field === 'caseCount'
              ? 9
              : field === 'itemKey'
                ? 'q2'
                : field === 'testPackId'
                  ? 'different-pack'
                  : field.endsWith('Id')
                    ? id(99)
                    : h('0'),
      };
    await expect(producer.prepare(r, id(7))).rejects.toThrow();
    expect(db.calls.every((c) => c.sql !== RECORD_EXAM_SCORING_EVENT_SQL)).toBe(true);
  });
  it('uses native rubric identity and records real false groups without deriving a score from binary verdict', async () => {
    const f = fixture(),
      db = client(f.context),
      producer = createScoredExamFunctionalProducer(db.client),
      envelope = await producer.prepare(f.report, id(7));
    expect(await producer.record(envelope)).toMatchObject({ kind: 'recorded' });
    const call = db.calls.at(-1)!;
    expect(call.sql).toBe(RECORD_EXAM_SCORING_EVENT_SQL);
    expect(call.parameters.slice(0, 5)).toEqual([
      null,
      id(7),
      id(1),
      f.context.expectedRevision,
      'functional',
    ]);
    const payload = JSON.parse(String(call.parameters[5]));
    expect(payload.evidence).toMatchObject({
      rubricDigest: f.context.rubricDigest,
      publishedCriteriaDigest: f.context.publishedCriteriaDigest,
      outcomes: [{ passed: false }],
    });
    expect(call.parameters[6]).toBe(examScoringEventDigest(payload));
    expect(JSON.stringify(payload)).not.toContain('points');
    expect(JSON.stringify(payload)).not.toContain('expected');
  });
  it('returns unknown once and retries only identical operation/revision/body after caller explicitly requests it', async () => {
    const f = fixture(),
      db = client(f.context, { lost: true }),
      producer = createScoredExamFunctionalProducer(db.client),
      envelope = await producer.prepare(f.report, id(7));
    expect(await producer.record(envelope)).toEqual({
      kind: 'uncertain',
      operationId: id(7),
      retry: 'same_envelope_only',
    });
    expect(db.calls.filter((c) => c.sql === RECORD_EXAM_SCORING_EVENT_SQL)).toHaveLength(1);
    expect(await producer.retry(envelope)).toMatchObject({ kind: 'recorded', replayed: true });
    const writes = db.calls.filter((c) => c.sql === RECORD_EXAM_SCORING_EVENT_SQL);
    expect(writes[1]).toEqual(writes[0]);
    expect(db.calls.filter((c) => c.sql === READ_SCORED_EXAM_FUNCTIONAL_CONTEXT_SQL)).toHaveLength(
      1,
    );
    await expect(producer.retry({ ...envelope })).rejects.toThrow();
  });
  it('treats malformed acknowledgements as uncertain and missing/incomplete reports as no-write', async () => {
    const f = fixture(),
      db = client(f.context, { malformed: true }),
      producer = createScoredExamFunctionalProducer(db.client),
      envelope = await producer.prepare(f.report, id(7));
    expect(await producer.record(envelope)).toMatchObject({ kind: 'uncertain' });
    const before = db.calls.length;
    await expect(producer.prepare(null, id(9))).rejects.toThrow();
    expect(db.calls).toHaveLength(before);
    await expect(producer.prepare({ ...f.report, verdict: 'passed' }, id(9))).rejects.toThrow();
    expect(db.calls).toHaveLength(before);
  });
  it('rejects accessors without invoking them and proves exact group criteria/order', () => {
    const f = fixture(),
      getter = vi.fn(() => 1),
      r = { ...f.report };
    Object.defineProperty(r, 'version', { get: getter });
    expect(() => buildScoredExamFunctionalEvidence(f.context, r)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      buildScoredExamFunctionalEvidence(f.context, {
        ...f.report,
        groups: [{ ...f.report.groups[0]!, criteriaDigest: h('0') }],
      }),
    ).toThrow();
  });
});
const sql = readFileSync(
  new URL('../migration-drafts/0032_scored_exam_functional_producer.DRAFT.sql', import.meta.url),
  'utf8',
);
describe('0032 protected producer reader proposal, no native proof', () => {
  it('does not create identities, enable an evaluator or seed a private manifest', () => {
    expect(sql).toContain('exam-functional-0032-bootstrap-dba-v1');
    expect(sql).not.toMatch(
      /CREATE ROLE|CREATE USER|ALTER ROLE|INSERT INTO app.scored_exam_functional_manifests/i,
    );
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON TABLE app.scored_exam_functional_manifests');
  });
  it('requires exact registered evaluator and frozen job/acceptance/rubric provenance', () => {
    expect(sql).toContain('evaluator.evaluator_digest IS DISTINCT FROM acc.evaluator_digest');
    expect(sql).toContain('WHERE login_name=session_user AND enabled FOR SHARE');
    expect(sql).toContain("acc.evaluator_key IS DISTINCT FROM 'official-code'");
    expect(sql).toContain('id=code.active_judge_job_id');
    expect(sql).toContain("result.verdict::text IN('passed','failed')");
    expect(sql).toContain(
      'm.rubric_source_binding_digest IS DISTINCT FROM r.source_binding_digest',
    );
    expect(sql).toContain('m.test_pack_digest IS DISTINCT FROM');
    expect(sql).toContain('Exact functional context owner/OID/ACL readback failed');
    expect(sql).toContain(
      "'nextera_result_application','nextera_runner','nextera_judge_owner','nextera_judge_maintenance'",
    );
  });
  it('keeps context read-only and the existing writer unchanged while no incomplete profile can be registered', () => {
    const body = sql
      .split('CREATE FUNCTION app.scored_exam_functional_context')[1]!
      .split('END $$;')[0]!;
    expect(body).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|GRANT|set_config)\b/i);
    expect(sql).toContain("'complete-observations-only-v1'");
    expect(sql).toContain('RETURN cardinality(seen)=case_count');
    expect(sql).toContain("manifest_sha256=encode(sha256(manifest_bytes),'hex')");
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION app.scored_exam_functional_context(uuid,uuid) TO nextera_exam_evaluator',
    );
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION app.record_exam_scoring_event/);
  });
});
