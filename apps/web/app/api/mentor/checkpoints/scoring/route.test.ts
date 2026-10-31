import {
  manualEvidenceDocument,
  manualEvidenceDigest,
  MANUAL_EVIDENCE_READINESS_SQL,
  RECORD_MANUAL_EVIDENCE_SQL,
  type ManualEvidenceCommand,
} from '@nextera/db/scored-exam-manual-evidence';
import { checkpointCanonicalJson } from '../../../../../../../packages/db/operations/scored-exam-publication';
import { examScoringEventDigest } from '@nextera/db/exam-scoring-review';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  acceptance,
  contextFixture,
  id,
  reviewClient,
  hash,
  eventFixture,
  historyFixture,
  reviewAnswerFixture,
} from '../../../../../../../packages/db/tests/scored-exam-review-fixture';
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  database: vi.fn(),
  origin: vi.fn(),
  createDatabase: vi.fn(),
}));
vi.mock('../../../../../lib/auth/server', () => ({
  requireDomainUser: mocks.user,
  getDatabase: mocks.database,
}));
vi.mock('../../../../../lib/submissions/origin', () => ({ sameOrigin: mocks.origin }));
vi.mock('@nextera/db/connection', () => ({ createDatabase: mocks.createDatabase }));
import {
  combinedWebClient,
  outcomeClient,
  outcomeStateFixture,
  policyFixture,
} from '../../../../../../../packages/db/tests/scored-exam-outcome-fixture';
import {
  RECORD_SCORED_EXAM_ADJUDICATION_SQL,
  APPLY_SCORED_EXAM_OUTCOME_SQL,
} from '@nextera/db/scored-exam-outcomes';
import { GET, POST } from './route';
const url = 'http://127.0.0.1:3151/api/mentor/checkpoints/scoring';
const body = () => {
  const c = contextFixture();
  return {
    version: 1,
    review: 'primary',
    attemptId: id(3),
    write: { operationId: id(700), submissionId: id(1001), expectedRevision: '0' },
    payload: {
      answerSha256: hash('1'),
      rubricDigest: c.rubric.digest,
      assignmentDigest: c.assignment.digest,
      evidenceDigest: hash('e'),
      marks: { contract: 2 },
    },
  };
};
const post = (value: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:3151', 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
const originalFlag = process.env.NEXTERA_SCORED_EXAM_REVIEW_V1;
const originalPolicy = process.env.NEXTERA_SCORED_EXAM_REVIEW_POLICY;
const outcomeKeys = [
  'NEXTERA_SCORED_EXAM_OUTCOMES_V1',
  'NEXTERA_SCORED_EXAM_OUTCOME_POLICIES',
  'NEXTERA_SCORED_EXAM_OUTCOME_IMPLEMENTATION_DIGEST',
  'NEXTERA_SCORED_EXAM_OUTCOME_APPLIER_DATABASE_URL',
] as const;
const originalOutcomeEnvironment = Object.fromEntries(
  outcomeKeys.map((key) => [key, process.env[key]]),
);
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of outcomeKeys) delete process.env[key];
  mocks.user.mockResolvedValue({
    id: id(4),
    authUserId: id(101),
    role: 'operator',
    active: true,
    displayName: 'Synthetic mentor',
  });
  mocks.origin.mockReturnValue(true);
  process.env.NEXTERA_SCORED_EXAM_REVIEW_V1 = '1';
  process.env.NEXTERA_SCORED_EXAM_REVIEW_POLICY = JSON.stringify({
    version: 1,
    maxBodyBytes: 4096,
    bodyTimeoutMs: 30,
  });
  mocks.database.mockReturnValue({ $client: reviewClient(contextFixture()).client });
});
afterEach(() => {
  for (const key of outcomeKeys) {
    const value = originalOutcomeEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (originalFlag === undefined) delete process.env.NEXTERA_SCORED_EXAM_REVIEW_V1;
  else process.env.NEXTERA_SCORED_EXAM_REVIEW_V1 = originalFlag;
  if (originalPolicy === undefined) delete process.env.NEXTERA_SCORED_EXAM_REVIEW_POLICY;
  else process.env.NEXTERA_SCORED_EXAM_REVIEW_POLICY = originalPolicy;
});
describe('actual mentor scoring API with injected SQL only', () => {
  it('keeps legitimate primary rollover readable and accepts replacement secondary review', async () => {
    const original = contextFixture(),
      a = acceptance(1, 1, '4');
    const p2 = eventFixture(original, a, 'primary', 2, 0),
      p4 = eventFixture(original, a, 'primary', 4, 2);
    const events = [
      eventFixture(original, a, 'functional', 1),
      p2,
      eventFixture(original, a, 'secondary', 3, 0, p2.eventId),
      p4,
    ];
    const context = { ...original, authUserId: id(102), actorUserId: id(5), acceptances: [a] };
    const fake = reviewClient(context, [historyFixture(context, a, events)]);
    mocks.user.mockResolvedValue({
      id: id(5),
      authUserId: id(102),
      role: 'operator',
      active: true,
      displayName: 'Secondary mentor',
    });
    mocks.database.mockReturnValue({ $client: fake.client });
    expect((await GET(new Request(url + '?attempt=' + id(3)))).status).toBe(200);
    const updated = {
      ...body(),
      review: 'secondary',
      write: { operationId: id(701), submissionId: a.submissionId, expectedRevision: '4' },
      payload: { ...body().payload, primaryEventId: p4.eventId },
    };
    const result = await POST(post(updated));
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({ kind: 'recorded', revision: '5' });
  });
  it('reports missing private code access and can return assigned canonical structured answers', async () => {
    const metadata = await (await GET(new Request(url + '?attempt=' + id(3)))).json();
    expect(metadata.answerReadAvailable).toBe(false);
    const f = reviewAnswerFixture('trace_with_reason');
    mocks.database.mockReturnValue({
      $client: reviewClient(contextFixture(), [], { answer: () => f.answer }).client,
    });
    const response = await GET(new Request(url + '?attempt=' + id(3) + '&submission=' + id(1001)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: 'trace_with_reason',
      answer: JSON.parse(f.text),
    });
  });
  it('loads assigned context and provisional score without manufacturing finalization', async () => {
    const response = await GET(new Request(url + '?attempt=' + id(3)));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const result = await response.json();
    expect(result.score.status).toBe('provisional');
    expect(result.finalOutcomePersisted).toBe(false);
    expect(result.adjudicationPending).toBe(true);
  });
  it('requires existing staff role, then exact database assignment even for admin', async () => {
    mocks.user.mockResolvedValue({
      id: id(1),
      authUserId: id(101),
      role: 'learner',
      active: true,
      displayName: 'Learner',
    });
    expect((await GET(new Request(url + '?attempt=' + id(3)))).status).toBe(403);
    expect(mocks.database).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({
      id: id(999),
      authUserId: id(101),
      role: 'admin',
      active: true,
      displayName: 'Unassigned admin',
    });
    mocks.database.mockReturnValue({
      $client: {
        unsafe: async () => {
          throw Object.assign(new Error('private SQL denied'), { code: '42501' });
        },
      },
    });
    expect((await GET(new Request(url + '?attempt=' + id(3)))).status).toBe(403);
  });
  it('disabled or incomplete server config stays unavailable without constructing a client', async () => {
    delete process.env.NEXTERA_SCORED_EXAM_REVIEW_POLICY;
    expect((await GET(new Request(url + '?attempt=' + id(3)))).status).toBe(503);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('posts a scoped primary review using authenticated actor and preserved operation/revision', async () => {
    const c = { ...contextFixture(), acceptances: [acceptance(1)] },
      fake = reviewClient(c);
    mocks.database.mockReturnValue({ $client: fake.client });
    const response = await POST(post(body()));
    expect(response.status).toBe(202);
    const recorded = await response.json();
    expect(recorded.operationId).toBe(id(700));
    expect(fake.calls.at(-1)?.parameters.slice(0, 5)).toEqual([
      id(101),
      id(700),
      id(1001),
      '0',
      'primary',
    ]);
  });
  it('rejects CSRF and browser evaluator events', async () => {
    mocks.origin.mockReturnValue(false);
    expect((await POST(post(body()))).status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
    mocks.origin.mockReturnValue(true);
    expect((await POST(post({ ...body(), review: 'functional' }))).status).toBe(400);
    expect((await POST(post({ ...body(), actorUserId: id(5) }))).status).toBe(400);
  });
  it('bounds streaming JSON and times out before any write', async () => {
    expect((await POST(post({ padding: 'x'.repeat(5000) }))).status).toBe(413);
    let cancelled = false;
    const stream = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect((await POST(request)).status).toBe(408);
    expect(cancelled).toBe(true);
  });
  it('returns explicit same-operation-only ambiguity rather than retrying a write', async () => {
    const c = { ...contextFixture(), acceptances: [acceptance(1)] },
      fake = reviewClient(c, [], {
        record: () => {
          throw new Error('connection ended');
        },
      });
    mocks.database.mockReturnValue({ $client: fake.client });
    const response = await POST(post(body()));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'SCORING_WRITE_OUTCOME_UNKNOWN',
      retry: 'same_operation_only',
    });
    expect(fake.calls).toHaveLength(3);
  });
});

function configureOutcomes(state = outcomeStateFixture()) {
  const web = combinedWebClient(state);
  mocks.database.mockReturnValue({ $client: web.client });
  process.env.NEXTERA_SCORED_EXAM_OUTCOMES_V1 = '1';
  process.env.NEXTERA_SCORED_EXAM_OUTCOME_POLICIES = JSON.stringify([policyFixture()]);
  process.env.NEXTERA_SCORED_EXAM_OUTCOME_IMPLEMENTATION_DIGEST = hash('d');
  return web;
}
const actionBody = (action: 'adjudicate' | 'apply') => ({
  version: 1,
  action,
  attemptId: id(3),
  operationId: id(700),
});
describe('actual mentor API persisted outcome integration with injected clients only', () => {
  it('loads current native adjudication and outcome rather than declaring all reviews provisional', async () => {
    configureOutcomes(outcomeStateFixture(true, true));
    const response = await GET(new Request(url + '?attempt=' + id(3)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      finalOutcomePersisted: true,
      adjudicationPending: false,
      score: { status: 'passed' },
      currentOutcome: { id: id(901), current: true },
    });
    expect(mocks.createDatabase).not.toHaveBeenCalled();
  });
  it('records server-computed adjudication from a strict action envelope, never browser decisions', async () => {
    const web = configureOutcomes();
    const response = await POST(post(actionBody('adjudicate')));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ kind: 'accepted' });
    expect(
      web.outcomes.calls.filter((c) => c.sql === RECORD_SCORED_EXAM_ADJUDICATION_SQL),
    ).toHaveLength(1);
    expect(
      (
        await POST(
          post({ ...actionBody('adjudicate'), policy: policyFixture(), verdict: 'passed' }),
        )
      ).status,
    ).toBe(400);
    expect(
      web.outcomes.calls.filter((c) => c.sql === RECORD_SCORED_EXAM_ADJUDICATION_SQL),
    ).toHaveLength(1);
  });
  it('requires explicitly configured scoped policy and applier before any apply connection', async () => {
    configureOutcomes(outcomeStateFixture(true));
    expect((await POST(post(actionBody('apply')))).status).toBe(503);
    expect(mocks.createDatabase).not.toHaveBeenCalled();
    delete process.env.NEXTERA_SCORED_EXAM_OUTCOME_POLICIES;
    expect((await POST(post(actionBody('adjudicate')))).status).toBe(503);
  });
  it('uses only the explicit configured restricted applier and closes it after acknowledgement', async () => {
    const web = configureOutcomes(outcomeStateFixture(true)),
      applier = outcomeClient(),
      close = vi.fn().mockResolvedValue(undefined);
    process.env.NEXTERA_SCORED_EXAM_OUTCOME_APPLIER_DATABASE_URL =
      'postgres://synthetic:synthetic@127.0.0.1:1/source_only';
    mocks.createDatabase.mockReturnValue({ db: { $client: applier.client }, close });
    const response = await POST(post(actionBody('apply')));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ kind: 'accepted', current: false });
    expect(applier.calls.filter((c) => c.sql === APPLY_SCORED_EXAM_OUTCOME_SQL)).toHaveLength(1);
    expect(web.outcomes.calls.some((c) => c.sql === APPLY_SCORED_EXAM_OUTCOME_SQL)).toBe(false);
    expect(mocks.createDatabase).toHaveBeenCalledWith(
      process.env.NEXTERA_SCORED_EXAM_OUTCOME_APPLIER_DATABASE_URL,
    );
    expect(close).toHaveBeenCalledOnce();
  });
  it('reports uncertain application with the original operation ID and performs no retry', async () => {
    configureOutcomes(outcomeStateFixture(true));
    const applier = outcomeClient(undefined, {
        apply: () => {
          throw new Error('ack lost');
        },
      }),
      close = vi.fn().mockRejectedValue(new Error('close failed'));
    process.env.NEXTERA_SCORED_EXAM_OUTCOME_APPLIER_DATABASE_URL =
      'postgres://synthetic:synthetic@127.0.0.1:1/source_only';
    mocks.createDatabase.mockReturnValue({ db: { $client: applier.client }, close });
    const response = await POST(post(actionBody('apply')));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: 'uncertain',
      operationId: id(700),
      retry: 'same_operation_only',
    });
    expect(applier.calls.filter((c) => c.sql === APPLY_SCORED_EXAM_OUTCOME_SQL)).toHaveLength(1);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('documented V2 review route compatibility', () => {
  async function setup(outcome: 'recorded' | 'missing_reference' | 'failure' = 'recorded') {
    const c = { ...contextFixture(), acceptances: [acceptance(1)] },
      base = body();
    let command: ManualEvidenceCommand = {
      ...base,
      version: 2,
      review: 'primary',
      evidence: { version: 1, manualCriteriaSha256: hash('c'), notes: 'Exact saved note' },
    };
    const document = manualEvidenceDocument(c, command);
    command = {
      ...command,
      payload: { ...command.payload, evidenceDigest: manualEvidenceDigest(document) },
    };
    const old = reviewClient(c),
      calls: readonly unknown[][] = [];
    const written: unknown[][] = [];
    const unsafe = vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
      if (sql === MANUAL_EVIDENCE_READINESS_SQL) return [{ ready: true }];
      if (sql === RECORD_MANUAL_EVIDENCE_SQL) {
        written.push([...parameters]);
        if (outcome === 'failure') throw Error('transaction evidence insert failed');
        const receipt = {
          kind: 'recorded',
          eventId: id(810),
          operationId: command.write.operationId,
          submissionId: command.write.submissionId,
          revision: '1',
          payloadDigest: examScoringEventDigest(command.payload),
          replayed: true,
        };
        return [
          {
            data:
              outcome === 'missing_reference'
                ? receipt
                : {
                    ...receipt,
                    evidenceReference: {
                      version: 1,
                      eventId: id(810),
                      digest: command.payload.evidenceDigest,
                      byteLength: Buffer.byteLength(checkpointCanonicalJson(document)),
                      notesStored: true,
                    },
                  },
          },
        ];
      }
      return old.client.unsafe(sql, parameters as never[]);
    });
    void calls;
    mocks.database.mockReturnValue({ $client: { unsafe } });
    return { command, written };
  }
  it('returns only a durable native V2 reference and can replay an original command when criteria config is absent', async () => {
    const { command, written } = await setup();
    delete process.env.NEXTERA_SCORED_EXAM_MANUAL_CRITERIA_V1;
    const response = await POST(post(command));
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      kind: 'recorded',
      replayed: true,
      evidenceReference: { notesStored: true, digest: command.payload.evidenceDigest },
    });
    expect(written[0]?.slice(0, 6)).toEqual([id(101), id(3), id(700), id(1001), '0', 'primary']);
    expect(written[0]?.[8]).toBeNull();
  });
  it.each(['missing_reference', 'failure'] as const)(
    'keeps %s uncertain and same-operation-only',
    async (outcome) => {
      const { command, written } = await setup(outcome);
      const response = await POST(post(command));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'SCORING_WRITE_OUTCOME_UNKNOWN',
        retry: 'same_operation_only',
      });
      expect(written).toHaveLength(1);
    },
  );
  it.each(['bad\0note', 'bad\ud800note'])(
    'rejects notes format before native writer: %j',
    async (notes) => {
      const { command, written } = await setup();
      const response = await POST(post({ ...command, evidence: { ...command.evidence, notes } }));
      expect(response.status).toBe(400);
      expect(written).toHaveLength(0);
    },
  );
});
