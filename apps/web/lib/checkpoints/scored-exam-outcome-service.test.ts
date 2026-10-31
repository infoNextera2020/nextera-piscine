import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createScoredExamReviewService } from './scored-exam-review-service';
import {
  createScoredExamOutcomeService,
  configuredScoredExamOutcomeService,
} from './scored-exam-outcome-service';
import {
  APPLY_SCORED_EXAM_OUTCOME_SQL,
  RECORD_SCORED_EXAM_ADJUDICATION_SQL,
  scoredExamOutcomeDigest,
  type ScoredExamOutcomeState,
  type ScoredExamAdjudicationPolicy,
} from '@nextera/db/scored-exam-outcomes';
import {
  combinedWebClient,
  outcomeClient,
  outcomeStateFixture,
  policyFixture,
  id,
  hash,
} from '../../../../packages/db/tests/scored-exam-outcome-fixture';
const bodyPolicy = { version: 1 as const, maxBodyBytes: 4096, bodyTimeoutMs: 50 };
function fixture(
  state = outcomeStateFixture(),
  policies: readonly ScoredExamAdjudicationPolicy[] = [policyFixture()],
  applier = outcomeClient(),
) {
  const web = combinedWebClient(state),
    review = createScoredExamReviewService({ client: web.client, bodyPolicy });
  const service = createScoredExamOutcomeService({
    review,
    webClient: web.client,
    applierClient: applier.client,
    implementationDigest: hash('d'),
    policies,
  });
  return { web, review, applier, service };
}
function withPolicy(
  state: ScoredExamOutcomeState,
  policy: ScoredExamAdjudicationPolicy,
): ScoredExamOutcomeState {
  const existing = state.adjudication!;
  const body = {
    ...existing.body,
    policy,
    decision: {
      ...existing.body.decision,
      initialThresholdReview: policy.initialThresholdReview,
      disputed: policy.disputed,
      affectedSubmissionIds: policy.affectedSubmissionIds,
    },
  };
  return {
    ...state,
    adjudication: {
      ...existing,
      body,
      bodyDigest: scoredExamOutcomeDigest(body, '01coding-exam-adjudication'),
      policyDigest: scoredExamOutcomeDigest(policy, '01coding-exam-adjudication-policy'),
    },
  };
}
describe('native persisted snapshot to explicit adjudication/outcome service', () => {
  it('keeps completed answers provisional without an explicit scoped policy', async () => {
    const f = fixture(undefined, []);
    expect((await f.service.read(id(101), id(3))).score.status).toBe('provisional');
    expect(await f.service.adjudicate(id(101), id(3), id(700))).toEqual({
      kind: 'policy_unavailable',
    });
    expect(f.web.outcomes.calls.some((x) => x.sql === RECORD_SCORED_EXAM_ADJUDICATION_SQL)).toBe(
      false,
    );
  });
  it('computes selection and proposed verdict from full native records, not browser points', async () => {
    const f = fixture();
    expect(await f.service.adjudicate(id(101), id(3), id(700))).toMatchObject({ kind: 'accepted' });
    const call = f.web.outcomes.calls.find((x) => x.sql === RECORD_SCORED_EXAM_ADJUDICATION_SQL)!;
    const body = JSON.parse(String(call.parameters[4]));
    expect(body.decision.proposedVerdict).toBe('passed');
    expect(body.decision.selection).toHaveLength(8);
    expect(body.priorOutcomeId).toBeNull();
    await expect(
      f.service.adjudicate(id(101), id(3), { points: 100 } as never),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('binds the actual prior final outcome and never resets it to null', async () => {
    const state = {
      ...outcomeStateFixture(),
      currentOutcome: {
        id: id(800),
        revision: '1',
        verdict: 'failed' as const,
        totalPoints: 0,
        codingPoints: 0,
        projectionDigest: hash('b'),
        adjudicationId: id(799),
        resultDigest: hash('c'),
        implementationDigest: hash('d'),
        current: false,
      },
    };
    const f = fixture(state);
    await f.service.adjudicate(id(101), id(3), id(700));
    const body = JSON.parse(
      String(
        f.web.outcomes.calls.find((x) => x.sql === RECORD_SCORED_EXAM_ADJUDICATION_SQL)!
          .parameters[4],
      ),
    );
    expect(body.priorOutcomeId).toBe(id(800));
    expect(body.decision.priorFinalVerdict).toBe('failed');
  });
  it('requires current-primary-linked independent review when policy requires it', async () => {
    const policy = {
      ...policyFixture(),
      initialThresholdReview: 'required' as const,
      affectedSubmissionIds: [id(1001)],
    };
    const f = fixture(withPolicy(outcomeStateFixture(true), policy), [policy]);
    expect(await f.service.apply(id(101), id(3), id(701))).toEqual({ kind: 'provisional' });
    expect(f.applier.calls.some((x) => x.sql === APPLY_SCORED_EXAM_OUTCOME_SQL)).toBe(false);
  });
  it('does not turn an unresolved initial-threshold policy into a waiver', async () => {
    const policy = { ...policyFixture(), initialThresholdReview: 'unresolved' as const };
    const f = fixture(withPolicy(outcomeStateFixture(true), policy), [policy]);
    expect(await f.service.apply(id(101), id(3), id(701))).toEqual({ kind: 'provisional' });
  });
  it('rejects a revised vector between context/history and outcome projection', async () => {
    const state = outcomeStateFixture();
    const projection = {
      ...state.projection,
      acceptances: state.projection.acceptances.map((a, i) =>
        i === 0 ? { ...a, revision: '3' } : a,
      ),
    };
    const f = fixture({
      ...state,
      projection,
      projectionDigest: scoredExamOutcomeDigest(projection, '01coding-exam-outcome-projection'),
    });
    await expect(f.service.read(id(101), id(3))).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('sends exact verified100point result only to the configured restricted applier', async () => {
    const f = fixture(outcomeStateFixture(true));
    const result = await f.service.apply(id(101), id(3), id(701));
    expect(result).toMatchObject({
      kind: 'accepted',
      receipt: { totalPoints: 100, codingPoints: 75, verdict: 'passed' },
      current: false,
    });
    const call = f.applier.calls.find((x) => x.sql === APPLY_SCORED_EXAM_OUTCOME_SQL)!;
    expect(call.parameters.slice(0, 5)).toEqual([id(701), id(3), id(900), null, hash('d')]);
    expect(JSON.parse(String(call.parameters[5]))).toMatchObject({
      totalPoints: 100,
      codingPoints: 75,
      verdict: 'passed',
    });
  });
  it('does not claim current final success without native readback of the applied head', async () => {
    const web = combinedWebClient(outcomeStateFixture(true));
    const applier = outcomeClient(undefined, {
      apply: (parameters) => {
        web.outcomes.setState(outcomeStateFixture(true, true));
        return {
          kind: 'accepted',
          receipt: {
            id: id(901),
            attemptId: id(3),
            operationId: parameters[0],
            revision: '1',
            adjudicationId: id(900),
            projectionDigest: outcomeStateFixture().projectionDigest,
            resultDigest: parameters[6],
            verdict: 'passed',
            totalPoints: 100,
            codingPoints: 75,
          },
          replayed: false,
        };
      },
    });
    const service = createScoredExamOutcomeService({
      review: createScoredExamReviewService({ client: web.client, bodyPolicy }),
      webClient: web.client,
      applierClient: applier.client,
      implementationDigest: hash('d'),
      policies: [policyFixture()],
    });
    expect(await service.apply(id(101), id(3), id(701))).toMatchObject({
      kind: 'accepted',
      current: true,
    });
  });
  it('does not apply again when current native outcome and recomputed score agree', async () => {
    const f = fixture(outcomeStateFixture(true, true));
    expect(await f.service.apply(id(101), id(3), id(701))).toEqual({
      kind: 'already_final',
      outcomeId: id(901),
    });
    expect(f.applier.calls).toHaveLength(0);
  });
  it('preserves a lost acknowledgement as uncertain with the original operation ID', async () => {
    const applier = outcomeClient(undefined, {
      apply: () => {
        throw new Error('ack lost');
      },
    });
    const f = fixture(outcomeStateFixture(true), undefined, applier);
    expect(await f.service.apply(id(101), id(3), id(701))).toEqual({
      kind: 'uncertain',
      operationId: id(701),
    });
    expect(applier.calls.filter((x) => x.sql === APPLY_SCORED_EXAM_OUTCOME_SQL)).toHaveLength(1);
  });
  it('constructs no enabled service from missing/malformed policy settings', () => {
    const f = fixture();
    const input = {
      review: f.review,
      webClient: f.web.client,
      applierClient: f.applier.client,
      implementationDigest: hash('d'),
    };
    expect(configuredScoredExamOutcomeService(input, {})).toBeNull();
    expect(
      configuredScoredExamOutcomeService(input, { NEXTERA_SCORED_EXAM_OUTCOMES_V1: '1' }),
    ).toBeNull();
    expect(f.web.outcomes.calls).toHaveLength(0);
    expect(f.applier.calls).toHaveLength(0);
  });
});

describe('configured persisted policy remains part of the finalization proof', () => {
  it('keeps even a persisted final head provisional when its explicit scoped policy is absent', async () => {
    const f = fixture(outcomeStateFixture(true, true), []);
    const loaded = await f.service.read(id(101), id(3));
    expect(loaded.score.status).toBe('provisional');
    expect(loaded.finalOutcomePersisted).toBe(false);
    expect(loaded.state.currentOutcome?.verdict).toBe('passed');
    expect(await f.service.apply(id(101), id(3), id(701))).toEqual({ kind: 'policy_unavailable' });
    expect(f.applier.calls).toHaveLength(0);
  });
  it('does not accept an old adjudication after configured dispute evidence changes', async () => {
    const f = fixture(outcomeStateFixture(true, true), [
      { ...policyFixture(), evidenceDigest: hash('f') },
    ]);
    const loaded = await f.service.read(id(101), id(3));
    expect(loaded.score.status).toBe('provisional');
    expect(loaded.finalOutcomePersisted).toBe(false);
    expect(await f.service.apply(id(101), id(3), id(701))).toEqual({ kind: 'policy_unavailable' });
  });
});

describe('adjudication policies obey the effective domain review requirement', () => {
  it('rejects affected IDs for an initial non-disputed not-required decision before immutable recording', async () => {
    const policy = {
      ...policyFixture(),
      initialThresholdReview: 'not_required' as const,
      disputed: false,
      affectedSubmissionIds: [id(1001)],
    };
    const f = fixture(undefined, [policy]);
    await expect(f.service.adjudicate(id(101), id(3), id(700))).rejects.toThrow(
      'EXAM_ADJUDICATION_BINDING',
    );
    expect(f.web.outcomes.calls.some((c) => c.sql === RECORD_SCORED_EXAM_ADJUDICATION_SQL)).toBe(
      false,
    );
    expect(f.applier.calls).toHaveLength(0);
  });
  it('still records an explicit required review with affected submissions while the result remains provisional', async () => {
    const policy = {
      ...policyFixture(),
      initialThresholdReview: 'required' as const,
      affectedSubmissionIds: [id(1001)],
    };
    const f = fixture(undefined, [policy]);
    expect(await f.service.adjudicate(id(101), id(3), id(700))).toMatchObject({ kind: 'accepted' });
    expect(
      f.web.outcomes.calls.filter((c) => c.sql === RECORD_SCORED_EXAM_ADJUDICATION_SQL),
    ).toHaveLength(1);
    expect(f.applier.calls).toHaveLength(0);
  });
});
