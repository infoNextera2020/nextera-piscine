import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { AnswerApiError, answerContractDigest, type AnswerKind } from './answer-server-contract';
import {
  editMixedAnswer,
  serializeMixedAnswer,
  type MixedCheckpointAnswer,
} from './checkpoint-answer';
import {
  createOfficialAnswerSubmission,
  type AnswerEvaluatorRoute,
  type AnswerSubmissionRepository,
  type AnswerSubmissionCommit,
  type OfficialAnswerContext,
  type OfficialAnswerWrite,
} from './answer-submission';

const actor = {
  id: '10000000-0000-4000-8000-000000000001',
  authUserId: '20000000-0000-4000-8000-000000000001',
};
const cohortId = '30000000-0000-4000-8000-000000000001';
const attemptId = '40000000-0000-4000-8000-000000000001';
const requestId = '50000000-0000-4000-8000-000000000001';
const request2 = '50000000-0000-4000-8000-000000000002';
const trace = {
  version: 1,
  kind: 'trace_with_reason',
  output: '\uFEFF  x\r\nب\n',
  reason: 'Authored reasoning.\r\n',
} as const;
const debug = {
  version: 1,
  kind: 'debug_with_reason',
  source: 'package main\r\n// edited\n',
  explanation: 'Authored explanation',
  counterexample: 'Input and expected behavior',
} as const;

function fixture(kind: AnswerKind = 'trace_with_reason') {
  const taskKey = kind === 'trace_with_reason' ? 'trace-one' : 'debug-one';
  const state = {
    readAllowed: true,
    active: true,
    now: '2026-10-30T12:00:00.000Z',
    deadline: '2026-10-30T13:00:00.000Z',
    remaining: 1,
    intake: true,
    definitionDigest: 'a'.repeat(64),
    kind,
    maxBytes: 4096,
    routeAvailable: true,
  };
  const route: AnswerEvaluatorRoute = {
    family: 'checkpoint_structured_answer',
    version: 1,
    kind,
    definitionDigest: state.definitionDigest,
    taskKey,
    evaluatorKey: 'reviewed-typed-evaluator',
    evaluatorDigest: 'e'.repeat(64),
  };
  function current(): OfficialAnswerContext {
    const scope = {
      learnerId: actor.id,
      cohortId,
      attemptId,
      taskKey,
      definitionDigest: state.definitionDigest,
    };
    const contract = { version: 1 as const, kind: state.kind, maxBytes: state.maxBytes };
    return {
      scope,
      readAllowed: state.readAllowed,
      status: state.active ? 'active' : 'closed',
      serverNow: state.now,
      deadline: state.deadline,
      answerContract: { ...contract, digest: answerContractDigest(scope, contract) },
      submitAllowed: state.intake && state.remaining > 0,
    };
  }
  const writes: OfficialAnswerWrite[] = [];
  const rows = new Map<
    string,
    {
      write: OfficialAnswerWrite;
      receipt: Extract<AnswerSubmissionCommit, { kind: 'accepted' }>['receipt'];
    }
  >();
  let jobs = 0;
  let sequence = 0;
  let tail = Promise.resolve();
  let beforeCommit: null | ((write: OfficialAnswerWrite) => void | Promise<void>) = null;
  const fingerprint = (w: OfficialAnswerWrite) =>
    JSON.stringify([
      w.actor,
      w.scope,
      w.requestId,
      w.answerContractDigest,
      w.payload,
      w.sha256,
      w.byteLength,
      w.answer,
      w.evaluator,
    ]);
  // Deliberately injected transaction simulator. These tests do NOT attest PostgreSQL atomicity.
  async function atomicAccept(write: OfficialAnswerWrite): Promise<AnswerSubmissionCommit> {
    const previous = tail;
    let unlock!: () => void;
    tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      writes.push(write);
      await beforeCommit?.(write);
      const live = current();
      if (
        !state.readAllowed ||
        write.actor.id !== actor.id ||
        write.actor.authUserId !== actor.authUserId ||
        write.scope.learnerId !== actor.id ||
        write.scope.cohortId !== cohortId ||
        write.scope.attemptId !== attemptId ||
        write.scope.taskKey !== taskKey
      )
        return { kind: 'forbidden' };
      if (!state.active || Date.parse(state.now) >= Date.parse(state.deadline))
        return { kind: 'closed' };
      if (write.scope.definitionDigest !== live.scope.definitionDigest)
        return { kind: 'definition_mismatch' };
      if (
        write.answerContractDigest !== live.answerContract.digest ||
        write.answer.kind !== live.answerContract.kind
      )
        return { kind: 'contract_mismatch' };
      if (!state.routeAvailable) return { kind: 'unavailable' };
      const key = JSON.stringify([
        write.actor.id,
        write.scope.cohortId,
        write.scope.attemptId,
        write.scope.taskKey,
        write.requestId,
      ]);
      const prior = rows.get(key);
      if (prior)
        return fingerprint(prior.write) === fingerprint(write)
          ? { kind: 'accepted', receipt: prior.receipt, replayed: true }
          : { kind: 'conflict' };
      if (!write.allowNew || !state.intake || state.remaining <= 0)
        return { kind: 'budget_exhausted' };
      sequence++;
      const receipt = {
        id: '60000000-0000-4000-8000-' + String(sequence).padStart(12, '0'),
        actor: write.actor,
        scope: write.scope,
        requestId: write.requestId,
        answerContractDigest: write.answerContractDigest,
        answerVersion: write.answer.version,
        answerKind: write.answer.kind,
        sha256: write.sha256,
        byteLength: write.byteLength,
        evaluator: write.evaluator,
        evaluation: 'pending' as const,
      };
      rows.set(key, { write, receipt });
      jobs++;
      state.remaining--;
      return { kind: 'accepted', receipt, replayed: false };
    } finally {
      unlock();
    }
  }
  const context = vi.fn<AnswerSubmissionRepository['context']>(async () => current());
  const accept = vi.fn<AnswerSubmissionRepository['accept']>(atomicAccept);
  const repository = { context, accept };
  const settings = { enabled: true, repository, evaluators: [route] };
  const service = createOfficialAnswerSubmission(settings);
  const command = (
    answer: MixedCheckpointAnswer = kind === 'trace_with_reason' ? trace : debug,
  ) => ({
    attemptId,
    taskKey,
    requestId,
    definitionDigest: state.definitionDigest,
    answerContractDigest: current().answerContract.digest,
    answer,
  });
  return {
    state,
    route,
    current,
    writes,
    rows,
    context,
    accept,
    repository,
    settings,
    service,
    command,
    atomicAccept,
    jobCount: () => jobs,
    beforeCommit: (fn: typeof beforeCommit) => {
      beforeCommit = fn;
    },
  };
}

describe('official typed-answer intake — injected source contract only, no SQL/evaluator', () => {
  it.each(['trace_with_reason', 'debug_with_reason'] as const)(
    'accepts a frozen canonical $kind snapshot as pending, never a grade',
    async (kind) => {
      const f = fixture(kind),
        input = f.command();
      const result = await f.service.submit(actor, input);
      expect(result).toEqual({
        kind: 'accepted',
        id: '60000000-0000-4000-8000-000000000001',
        requestId,
        replayed: false,
        evaluation: 'pending',
      });
      const write = f.writes[0]!;
      expect(write.payload).toBe(serializeMixedAnswer(input.answer, 4096).payload);
      expect(write.sha256).toBe(createHash('sha256').update(write.payload, 'utf8').digest('hex'));
      expect(write.byteLength).toBe(new TextEncoder().encode(write.payload).byteLength);
      for (const value of [write, write.answer, write.actor, write.scope, write.evaluator])
        expect(Object.isFrozen(value)).toBe(true);
      expect(result).not.toHaveProperty('grade');
      expect(result).not.toHaveProperty('passed');
      expect(result).not.toHaveProperty('mastery');
      expect(f.jobCount()).toBe(1);
      expect(f.state.remaining).toBe(0);
    },
  );
  it('remains unavailable with zero repository calls when configuration or exact-kind routing is absent', async () => {
    const f = fixture();
    for (const settings of [
      null,
      { ...f.settings, enabled: false },
      { ...f.settings, repository: null },
      { ...f.settings, evaluators: null },
      { ...f.settings, evaluators: [] },
      { ...f.settings, evaluators: [{ ...f.route, family: 'go-runner' } as never] },
      { ...f.settings, evaluators: [{ ...f.route, version: 2 } as never] },
      { ...f.settings, evaluators: [f.route, f.route] },
    ])
      expect(await createOfficialAnswerSubmission(settings).submit(actor, f.command())).toEqual({
        kind: 'unavailable',
      });
    expect(await f.service.submit(actor, f.command(debug))).toEqual({ kind: 'unavailable' });
    expect(f.context).not.toHaveBeenCalled();
    expect(f.accept).not.toHaveBeenCalled();
    expect(f.jobCount()).toBe(0);
  });
  it('requires route binding to the exact frozen definition and task, not only answer kind', async () => {
    const f = fixture();
    for (const evaluator of [
      { ...f.route, taskKey: 'another-task' },
      { ...f.route, definitionDigest: 'b'.repeat(64) },
    ])
      expect(
        await createOfficialAnswerSubmission({ ...f.settings, evaluators: [evaluator] }).submit(
          actor,
          f.command(),
        ),
      ).toEqual({ kind: 'unavailable' });
    expect(f.context).not.toHaveBeenCalled();
    expect(f.accept).not.toHaveBeenCalled();
  });
  it('captures caller-owned scope, registry and exact answer text before asynchronous authorization', async () => {
    const f = fixture();
    let release!: (context: OfficialAnswerContext) => void;
    f.context.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const answer = { ...trace, reason: String(trace.reason), output: String(trace.output) },
      input = { ...f.command(answer) },
      who = { ...actor };
    const pending = f.service.submit(who, input);
    answer.reason = 'later edit';
    answer.output = 'later output';
    input.requestId = request2;
    input.taskKey = 'other-task';
    who.id = '10000000-0000-4000-8000-000000000002';
    (f.route as { evaluatorKey: string }).evaluatorKey = 'later-router';
    release(f.current());
    expect((await pending).kind).toBe('accepted');
    expect(f.writes[0]!.answer).toEqual(trace);
    expect(f.writes[0]!.requestId).toBe(requestId);
    expect(f.writes[0]!.actor).toEqual(actor);
    expect(f.writes[0]!.evaluator.evaluatorKey).toBe('reviewed-typed-evaluator');
  });
  it('concurrent exact request replay creates one immutable receipt/outbox/debit', async () => {
    const f = fixture(),
      input = f.command();
    const results = await Promise.all([
      f.service.submit(actor, input),
      f.service.submit(actor, input),
    ]);
    expect(results.map((r) => r.kind)).toEqual(['accepted', 'accepted']);
    expect(results.map((r) => r.kind === 'accepted' && r.replayed).sort()).toEqual([false, true]);
    expect(f.rows.size).toBe(1);
    expect(f.jobCount()).toBe(1);
    expect(f.state.remaining).toBe(0);
  });
  it('replays an exact accepted request after its own final allowance is exhausted', async () => {
    const f = fixture(),
      input = f.command();
    expect((await f.service.submit(actor, input)).kind).toBe('accepted');
    expect(await f.service.submit(actor, input)).toMatchObject({
      kind: 'accepted',
      replayed: true,
    });
    expect(f.writes[1]!.allowNew).toBe(false);
    expect(f.jobCount()).toBe(1);
    expect(f.state.remaining).toBe(0);
  });
  it('conflicts on different payload under one request key, including after final allowance', async () => {
    const f = fixture(),
      first = f.command(),
      second = { ...first, answer: { ...trace, reason: 'different bytes' } };
    const results = await Promise.all([
      f.service.submit(actor, first),
      f.service.submit(actor, second),
    ]);
    expect(results.map((r) => r.kind)).toEqual(['accepted', 'conflict']);
    expect(f.rows.size).toBe(1);
    expect(f.jobCount()).toBe(1);
    expect(f.rows.values().next().value!.write.answer).toEqual(trace);
  });
  it('two different requests cannot overspend a final graded allowance', async () => {
    const f = fixture(),
      input = f.command();
    const results = await Promise.all([
      f.service.submit(actor, input),
      f.service.submit(actor, { ...input, requestId: request2 }),
    ]);
    expect(results.map((r) => r.kind)).toEqual(['accepted', 'budget_exhausted']);
    expect(f.jobCount()).toBe(1);
    expect(f.state.remaining).toBe(0);
  });
  it('does not create a receipt or job when precheck only allows receipt replay', async () => {
    const f = fixture();
    f.state.remaining = 0;
    expect(await f.service.submit(actor, f.command())).toEqual({ kind: 'budget_exhausted' });
    expect(f.writes[0]!.allowNew).toBe(false);
    expect(f.rows.size).toBe(0);
    expect(f.jobCount()).toBe(0);
  });
  it.each([
    [
      'forbidden',
      (f: ReturnType<typeof fixture>) => {
        f.state.readAllowed = false;
      },
    ],
    [
      'closed',
      (f: ReturnType<typeof fixture>) => {
        f.state.now = f.state.deadline;
      },
    ],
    [
      'budget_exhausted',
      (f: ReturnType<typeof fixture>) => {
        f.state.remaining = 0;
      },
    ],
    [
      'contract_mismatch',
      (f: ReturnType<typeof fixture>) => {
        f.state.kind = 'debug_with_reason';
      },
    ],
    [
      'unavailable',
      (f: ReturnType<typeof fixture>) => {
        f.state.routeAvailable = false;
      },
    ],
  ] as const)(
    'rechecks %s changes between precheck and atomic commit',
    async (expected, change) => {
      const f = fixture();
      f.beforeCommit(() => change(f));
      expect(await f.service.submit(actor, f.command())).toEqual({ kind: expected });
      expect(f.rows.size).toBe(0);
      expect(f.jobCount()).toBe(0);
    },
  );
  it.each(['access', 'deadline'] as const)(
    'does not bypass current %s checks for an old receipt replay',
    async (change) => {
      const f = fixture(),
        input = f.command();
      await f.service.submit(actor, input);
      if (change === 'access') f.state.readAllowed = false;
      else f.state.now = f.state.deadline;
      expect((await f.service.submit(actor, input)).kind).toBe(
        change === 'access' ? 'forbidden' : 'closed',
      );
      expect(f.jobCount()).toBe(1);
    },
  );
  it('rejects stale definitions/contracts and known-kind mismatches without committing', async () => {
    const f = fixture(),
      input = f.command();
    f.state.definitionDigest = 'b'.repeat(64);
    expect(await f.service.submit(actor, input)).toEqual({ kind: 'definition_mismatch' });
    f.state.definitionDigest = 'a'.repeat(64);
    expect(
      await f.service.submit(actor, { ...input, answerContractDigest: 'c'.repeat(64) }),
    ).toEqual({ kind: 'contract_mismatch' });
    const both = createOfficialAnswerSubmission({
      ...f.settings,
      evaluators: [f.route, { ...f.route, kind: 'debug_with_reason' }],
    });
    expect(await both.submit(actor, { ...input, answer: debug })).toEqual({
      kind: 'contract_mismatch',
    });
    expect(f.accept).not.toHaveBeenCalled();
  });
  it('does not launder a malformed authoritative contract into a narrower valid shape', async () => {
    const f = fixture(),
      context = f.current();
    f.context.mockResolvedValueOnce({
      ...context,
      answerContract: { ...context.answerContract, unreviewed: 'extra' } as never,
    });
    expect(await f.service.submit(actor, f.command())).toEqual({ kind: 'unavailable' });
    expect(f.accept).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    'source only',
    { ...trace, kind: 'coding' },
    { ...trace, reason: ' ' },
    { ...trace, reason: '\ud800' },
    { ...trace, unknown: 'field' },
  ])(
    'rejects malformed or incomplete structured responses without official effects %#',
    async (answer) => {
      const f = fixture();
      expect((await f.service.submit(actor, { ...f.command(), answer })).kind).toBe(
        'invalid_input',
      );
      expect(f.accept).not.toHaveBeenCalled();
      expect(f.jobCount()).toBe(0);
    },
  );
  it('does not invoke getter-backed caller fields or treat a Save command as official intake', async () => {
    const f = fixture(),
      getter = vi.fn(() => trace.reason),
      answer = { ...trace };
    Object.defineProperty(answer, 'reason', { get: getter });
    expect((await f.service.submit(actor, { ...f.command(), answer })).kind).toBe('invalid_input');
    expect(getter).not.toHaveBeenCalled();
    expect((await f.service.submit(actor, { ...f.command(), operation: 'save' })).kind).toBe(
      'invalid_input',
    );
    expect(f.context).not.toHaveBeenCalled();
    expect(f.accept).not.toHaveBeenCalled();
  });
  it('local draft edits/serialization have no official repository or graded-budget operation', () => {
    const f = fixture();
    const drafts = editMixedAnswer({}, f.command().taskKey, trace);
    serializeMixedAnswer(drafts[Object.keys(drafts)[0]!]!, 4096);
    expect(f.service).not.toHaveProperty('save');
    expect(f.context).not.toHaveBeenCalled();
    expect(f.accept).not.toHaveBeenCalled();
    expect(f.state.remaining).toBe(1);
    expect(f.jobCount()).toBe(0);
  });
  it('rechecks server identity binding and never accepts an arbitrary matching learner ID alone', async () => {
    const f = fixture();
    expect(
      (
        await f.service.submit(
          { ...actor, id: '10000000-0000-4000-8000-000000000002' },
          f.command(),
        )
      ).kind,
    ).toBe('forbidden');
    expect(
      (
        await f.service.submit(
          { ...actor, authUserId: '20000000-0000-4000-8000-000000000002' },
          f.command(),
        )
      ).kind,
    ).toBe('forbidden');
    expect(f.jobCount()).toBe(0);
  });
  it('returns uncertain if an acceptance acknowledgement disagrees with the immutable payload', async () => {
    const f = fixture();
    f.accept.mockImplementationOnce(async (write) => {
      const result = await f.atomicAccept(write);
      return result.kind === 'accepted'
        ? { ...result, receipt: { ...result.receipt, sha256: 'f'.repeat(64) } }
        : result;
    });
    expect(await f.service.submit(actor, f.command())).toEqual({ kind: 'uncertain', requestId });
    expect(f.jobCount()).toBe(1);
    expect(f.accept).toHaveBeenCalledTimes(1);
  });
  it('treats all thrown commit failures as uncertain, never automatically retries or reports a grade', async () => {
    const f = fixture();
    f.accept.mockRejectedValueOnce(new AnswerApiError('UNAVAILABLE'));
    expect(await f.service.submit(actor, f.command())).toEqual({ kind: 'uncertain', requestId });
    expect(f.accept).toHaveBeenCalledTimes(1);
  });
  it('does not accept a new-receipt acknowledgement when context allowed only exact replay', async () => {
    const f = fixture();
    f.state.remaining = 0;
    f.accept.mockImplementationOnce(async (write) => ({
      kind: 'accepted',
      replayed: false,
      receipt: {
        id: '60000000-0000-4000-8000-000000000001',
        actor: write.actor,
        scope: write.scope,
        requestId: write.requestId,
        answerContractDigest: write.answerContractDigest,
        answerVersion: write.answer.version,
        answerKind: write.answer.kind,
        sha256: write.sha256,
        byteLength: write.byteLength,
        evaluator: write.evaluator,
        evaluation: 'pending',
      },
    }));
    expect(await f.service.submit(actor, f.command())).toEqual({ kind: 'uncertain', requestId });
  });
  it('fails closed on unrecognized sanitized adapter error codes', async () => {
    const f = fixture();
    f.context.mockRejectedValueOnce(new AnswerApiError('toString' as never));
    expect(await f.service.submit(actor, f.command())).toEqual({ kind: 'unavailable' });
  });
  it('sanitizes precheck errors and projects only declared failure/retry fields', async () => {
    const f = fixture();
    f.context.mockRejectedValueOnce(new Error('private DSN and answer key'));
    expect(await f.service.submit(actor, f.command())).toEqual({ kind: 'unavailable' });
    f.context.mockRejectedValueOnce(new AnswerApiError('RATE_LIMITED', 17));
    expect(await f.service.submit(actor, f.command())).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 17,
    });
    expect(f.accept).not.toHaveBeenCalled();
  });
});
