import { describe, expect, it } from 'vitest';
import {
  parseScoredExamAdjudicationPolicy,
  captureScoredExamFinalResult,
  parseScoredExamOutcomeState,
  readScoredExamOutcomeState,
  recordScoredExamAdjudication,
  applyScoredExamOutcome,
  scoredExamOutcomeDigest,
  RECORD_SCORED_EXAM_ADJUDICATION_SQL,
  APPLY_SCORED_EXAM_OUTCOME_SQL,
  READ_SCORED_EXAM_OUTCOME_STATE_SQL,
} from '../queries/scored-exam-outcomes';
import {
  adjudicationBodyFixture,
  outcomeStateFixture,
  outcomeClient,
  policyFixture,
  resultFixture,
  id,
  hash,
} from './scored-exam-outcome-fixture';
describe('strict source-bound outcome data', () => {
  it('hashes full projection and rejects a substituted revision without a matching digest', () => {
    const state = outcomeStateFixture();
    expect(parseScoredExamOutcomeState(state, id(3))).toEqual(state);
    const changed = {
      ...state,
      projection: {
        ...state.projection,
        acceptances: state.projection.acceptances.map((a, i) =>
          i === 0 ? { ...a, revision: '9' } : a,
        ),
      },
    };
    expect(() => parseScoredExamOutcomeState(changed, id(3))).toThrow();
  });
  it('rejects a claimed current result with no matching current adjudication', () =>
    expect(() => parseScoredExamOutcomeState(outcomeStateFixture(false, true), id(3))).toThrow());
  it('accepts the separately framed final100point result', () => {
    expect(captureScoredExamFinalResult(resultFixture())).toMatchObject({
      totalPoints: 100,
      codingPoints: 75,
      verdict: 'passed',
    });
    expect(() => captureScoredExamFinalResult({ ...resultFixture(), codingPoints: 44 })).toThrow();
    expect(() => captureScoredExamFinalResult({ ...resultFixture(), verdict: 'failed' })).toThrow();
  });
  it.each([
    { initialThresholdReview: undefined },
    { initialThresholdReview: 'optional' },
    { evidenceDigest: '' },
    { disputed: 'false' },
    { unknown: true },
  ])('does not infer a policy or waiver %#', (patch) =>
    expect(() => parseScoredExamAdjudicationPolicy({ ...policyFixture(), ...patch })).toThrow(),
  );
  it('rejects getters before evaluating their content', () => {
    let ran = false;
    const policy = { ...policyFixture() };
    Object.defineProperty(policy, 'evidenceDigest', {
      get() {
        ran = true;
        return hash('a');
      },
    });
    expect(() => parseScoredExamAdjudicationPolicy(policy)).toThrow();
    expect(ran).toBe(false);
  });
  it('includes every head, closure and source binding in its projection digest', () => {
    const p = outcomeStateFixture().projection;
    for (const other of [
      { ...p, assignmentDigest: hash('b') },
      { ...p, snapshotDigest: hash('b') },
      { ...p, closure: { ...p.closure!, closureOrdinal: '101' } },
      { ...p, acceptances: p.acceptances.map((a, i) => (i === 0 ? { ...a, revision: '3' } : a)) },
    ])
      expect(scoredExamOutcomeDigest(other, '01coding-exam-outcome-projection')).not.toBe(
        scoredExamOutcomeDigest(p, '01coding-exam-outcome-projection'),
      );
  });
});
describe('configured native query adapters use fake SQL only', () => {
  it('checks exact web readiness before the state RPC', async () => {
    const fake = outcomeClient();
    expect(await readScoredExamOutcomeState(fake.client, id(101), id(3))).toEqual(
      outcomeStateFixture(),
    );
    expect(fake.calls.filter((x) => x.sql === READ_SCORED_EXAM_OUTCOME_STATE_SQL)).toHaveLength(1);
    const blocked = outcomeClient(undefined, { ready: false });
    await expect(readScoredExamOutcomeState(blocked.client, id(101), id(3))).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(blocked.calls).toHaveLength(1);
  });
  it('records the exact operation, whole projection and prior-outcome body once', async () => {
    const f = outcomeClient(),
      body = adjudicationBodyFixture();
    const result = await recordScoredExamAdjudication(f.client, {
      authUserId: id(101),
      attemptId: id(3),
      operationId: id(700),
      expectedAdjudicationId: null,
      body,
    });
    expect(result).toMatchObject({
      kind: 'accepted',
      receipt: { operationId: id(700), revision: '1' },
      replayed: false,
    });
    const call = f.calls.find((x) => x.sql === RECORD_SCORED_EXAM_ADJUDICATION_SQL)!;
    expect(call.parameters.slice(0, 4)).toEqual([id(101), id(700), id(3), null]);
    expect(JSON.parse(String(call.parameters[4]))).toEqual(body);
  });
  it('does not write when role/catalog readiness is unavailable', async () => {
    const f = outcomeClient(undefined, { ready: false });
    expect(
      await recordScoredExamAdjudication(f.client, {
        authUserId: id(101),
        attemptId: id(3),
        operationId: id(700),
        expectedAdjudicationId: null,
        body: adjudicationBodyFixture(),
      }),
    ).toEqual({ kind: 'unavailable' });
    expect(f.calls).toHaveLength(1);
  });
  it('preserves uncertainty after a lost adjudication acknowledgement and never retries', async () => {
    const f = outcomeClient(undefined, {
      record: () => {
        throw new Error('transport ended');
      },
    });
    await expect(
      recordScoredExamAdjudication(f.client, {
        authUserId: id(101),
        attemptId: id(3),
        operationId: id(700),
        expectedAdjudicationId: null,
        body: adjudicationBodyFixture(),
      }),
    ).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(f.calls.filter((x) => x.sql === RECORD_SCORED_EXAM_ADJUDICATION_SQL)).toHaveLength(1);
  });
  it('treats malformed mutation readback as unknown, not as proven failure', async () => {
    const f = outcomeClient(undefined, {
      record: () => ({ kind: 'accepted', receipt: { id: id(900) }, replayed: false }),
    });
    await expect(
      recordScoredExamAdjudication(f.client, {
        authUserId: id(101),
        attemptId: id(3),
        operationId: id(700),
        expectedAdjudicationId: null,
        body: adjudicationBodyFixture(),
      }),
    ).rejects.toMatchObject({ code: 'outcome_unknown' });
  });
  it('applies only the exact recomputed result and original operation', async () => {
    const f = outcomeClient(outcomeStateFixture(true)),
      result = resultFixture();
    expect(
      await applyScoredExamOutcome(f.client, {
        attemptId: id(3),
        operationId: id(701),
        adjudicationId: id(900),
        expectedOutcomeId: null,
        implementationDigest: hash('d'),
        result,
      }),
    ).toMatchObject({
      kind: 'accepted',
      receipt: { id: id(901), totalPoints: 100, codingPoints: 75, verdict: 'passed' },
    });
    const call = f.calls.find((x) => x.sql === APPLY_SCORED_EXAM_OUTCOME_SQL)!;
    expect(call.parameters.slice(0, 5)).toEqual([id(701), id(3), id(900), null, hash('d')]);
    expect(JSON.parse(String(call.parameters[5]))).toEqual(result);
  });
  it('returns a known CAS denial only from exact native denial data', async () => {
    const f = outcomeClient(undefined, { apply: () => ({ kind: 'conflict' }) });
    expect(
      await applyScoredExamOutcome(f.client, {
        attemptId: id(3),
        operationId: id(701),
        adjudicationId: id(900),
        expectedOutcomeId: null,
        implementationDigest: hash('d'),
        result: resultFixture(),
      }),
    ).toEqual({ kind: 'conflict' });
  });
  it('does not turn a transport failure into a zero score or a new operation', async () => {
    const f = outcomeClient(undefined, {
      apply: () => {
        throw new Error('ack lost');
      },
    });
    await expect(
      applyScoredExamOutcome(f.client, {
        attemptId: id(3),
        operationId: id(701),
        adjudicationId: id(900),
        expectedOutcomeId: null,
        implementationDigest: hash('d'),
        result: resultFixture(),
      }),
    ).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(f.calls.filter((x) => x.sql === APPLY_SCORED_EXAM_OUTCOME_SQL)).toHaveLength(1);
  });
});
