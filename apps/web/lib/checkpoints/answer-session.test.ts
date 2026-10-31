import { describe, expect, it } from 'vitest';
import { CheckpointMixedAnswerSession } from './answer-session';
import { createCheckpointAnswerApi } from './answer-api';
import {
  answerContractDigest,
  prepareAnswer,
  type AnswerDraftRecord,
  type AnswerServerContext,
  type AnswerDraftWrite,
} from './answer-server-contract';
import { serializeMixedAnswer, type MixedCheckpointAnswer } from './checkpoint-answer';
import { SubmissionIntents } from '../submissions/retry-intent';

const id = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const identity = { learnerId: id(1), cohortId: id(3), attemptId: id(4) };
const user = {
  id: identity.learnerId,
  authUserId: id(2),
  displayName: 'Synthetic',
  role: 'learner' as const,
  active: true,
};
const trace = (reason = 'because') => ({
  version: 1 as const,
  kind: 'trace_with_reason' as const,
  output: 'hello\n',
  reason,
});
const debug = {
  version: 1 as const,
  kind: 'debug_with_reason' as const,
  source: 'func Fix() {}',
  explanation: 'reason',
  counterexample: 'example',
};
function harness(officialSubmit = true) {
  let serial = 10,
    elapsed = 0,
    lostSave = false,
    lostSubmit = false,
    revoked = false;
  let hold: 'load' | 'save' | 'submit' | null = null;
  let notifyHeld: (() => void) | undefined;
  let deliver: ((response: Response) => void) | undefined;
  let held = Promise.resolve();
  const records = new Map<string, AnswerDraftRecord>(),
    saveReceipts = new Map<string, AnswerDraftRecord>();
  const official = new Map<string, string>();
  const sent: { url: string; body: string | undefined; headers: Headers }[] = [];
  const callbacks = { changed: 0, removed: 0 };
  function context(taskKey: string): AnswerServerContext & { submitAllowed: boolean } {
    const kind = taskKey === 'q8' ? ('debug_with_reason' as const) : ('trace_with_reason' as const);
    const scope = { ...identity, taskKey, definitionDigest: 'a'.repeat(64) };
    return {
      scope,
      readAllowed: true,
      status: 'active',
      serverNow: '2026-10-31T10:00:00Z',
      deadline: '2026-10-31T13:00:00Z',
      answerContract: {
        version: 1,
        kind,
        maxBytes: 4096,
        digest: answerContractDigest(scope, { version: 1, kind, maxBytes: 4096 }),
      },
      submitAllowed: officialSubmit,
    };
  }
  const backend = {
    context: async (_actor: unknown, task: { taskKey: string }) => context(task.taskKey),
    read: async (_actor: unknown, scope: { taskKey: string }) => records.get(scope.taskKey) ?? null,
    save: async (input: AnswerDraftWrite) => {
      const replay = saveReceipts.get(input.requestId);
      if (replay) return { kind: 'saved' as const, record: replay };
      const current = records.get(input.scope.taskKey);
      if ((current?.version ?? 0) !== input.baseVersion)
        return { kind: 'conflict' as const, current: current! };
      const record: AnswerDraftRecord = {
        scope: input.scope,
        answerContractDigest: input.answerContractDigest,
        payload: input.payload,
        sha256: input.sha256,
        byteLength: input.byteLength,
        version: input.baseVersion + 1,
        requestId: input.requestId,
      };
      records.set(input.scope.taskKey, record);
      saveReceipts.set(input.requestId, record);
      return { kind: 'saved' as const, record };
    },
  };
  const api = createCheckpointAnswerApi({
    authenticate: async () => user,
    drafts: backend,
    bootstrap: async (_actor, task) => context(task.taskKey),
    bodyPolicy: { maxBodyBytes: 4096, bodyTimeoutMs: 1000 },
    officialSubmission: {
      submit: async (_actor, command) => {
        const c = command as { requestId: string; answer: MixedCheckpointAnswer };
        const replayed = official.has(c.requestId);
        official.set(c.requestId, JSON.stringify(c.answer));
        return {
          kind: 'accepted',
          id: id(100),
          requestId: c.requestId,
          replayed,
          evaluation: 'pending',
        };
      },
    },
  });
  const storage = new Map<string, string>();
  const intents = new SubmissionIntents(() => ({
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  }));
  const send: typeof fetch = async (url, init) => {
    const name = String(url);
    const headers = new Headers(init?.headers);
    headers.set('origin', 'http://localhost:3150');
    headers.set('host', 'localhost:3150');
    sent.push({ url: name, headers, body: typeof init?.body === 'string' ? init.body : undefined });
    if (revoked) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    const operation = name.includes('/submissions')
      ? 'submit'
      : init?.method === 'POST'
        ? 'save'
        : 'load';
    if (hold === operation) {
      hold = null;
      notifyHeld?.();
      return await new Promise<Response>((resolve) => {
        deliver = resolve;
      });
    }

    const request = new Request('http://localhost:3150' + name, { ...init, headers });
    const result = name.includes('/submissions')
      ? await api.submit(request)
      : init?.method === 'POST'
        ? await api.drafts.POST(request)
        : await api.drafts.GET(request);
    if (name.includes('/submissions') && lostSubmit) {
      lostSubmit = false;
      throw Error('fake lost submit acknowledgement');
    }
    if (init?.method === 'POST' && !name.includes('/submissions') && lostSave) {
      lostSave = false;
      throw Error('fake lost save acknowledgement');
    }
    return result;
  };
  const session = new CheckpointMixedAnswerSession(identity, {
    send,
    now: () => elapsed,
    requestId: () => id(++serial),
    intents,
    changed: () => callbacks.changed++,
    accessRemoved: () => callbacks.removed++,
  });
  return {
    session,
    sent,
    records,
    official,
    callbacks,
    context,
    hold: (operation: 'load' | 'save' | 'submit') => {
      hold = operation;
      held = new Promise<void>((resolve) => {
        notifyHeld = resolve;
      });
    },
    held: () => held,
    releaseForbidden: () => deliver?.(Response.json({ error: 'FORBIDDEN' }, { status: 403 })),
    loseSave: () => {
      lostSave = true;
    },
    loseSubmit: () => {
      lostSubmit = true;
    },
    revoke: () => {
      revoked = true;
    },
    advance: (ms: number) => {
      elapsed += ms;
    },
  };
}
describe('actual mixed-answer transport uses the existing CAS machine without source/Run fallbacks', () => {
  it('does not let a display hint grant Submit when the verified bootstrap withheld it', async () => {
    const f = harness(false);
    await f.session.load('q6', 'trace_with_reason');
    f.session.edit('q6', trace());
    await f.session.save('q6');
    expect(f.session.state('q6', 'trace_with_reason').status).toBe('saved');
    f.session.setSubmitCapability('q6', true);
    expect(f.session.state('q6', 'trace_with_reason').canSubmit).toBe(false);
    await f.session.submit('q6');
    expect(f.sent.some((call) => call.url.includes('/submissions'))).toBe(false);
    f.session.dispose();
  });

  it('keeps question/kind drafts separate, restores saved answers, and Save never submits', async () => {
    const f = harness();
    await f.session.load('q6', 'trace_with_reason');
    f.session.edit('q6', trace());
    await f.session.save('q6');
    await f.session.load('q8', 'debug_with_reason');
    f.session.edit('q8', debug);
    await f.session.save('q8');
    expect(f.session.state('q6', 'trace_with_reason').answer).toEqual(trace());
    expect(f.session.state('q8', 'debug_with_reason').answer).toEqual(debug);
    expect(f.session.state('q6', 'trace_with_reason').status).toBe('saved');
    expect(f.official.size).toBe(0);
    expect(f.sent.every((call) => call.url.startsWith('/api/checkpoints/answers/'))).toBe(true);
    expect(f.sent.every((call) => !call.headers.has('x-filename'))).toBe(true);
    f.session.dispose();
    f.session.mount();
    await f.session.load('q6', 'trace_with_reason');
    expect(f.session.state('q6', 'trace_with_reason').answer).toEqual(trace());
  });
  it('unknown save acknowledgements retry the original body/id before later edits', async () => {
    const f = harness();
    await f.session.load('q6', 'trace_with_reason');
    f.session.edit('q6', trace('original'));
    f.loseSave();
    await f.session.save('q6');
    expect(f.session.state('q6', 'trace_with_reason').status).toBe('failed');
    f.session.edit('q6', trace('later'));
    await f.session.save('q6');
    const writes = f.sent.filter((x) => x.body);
    expect(writes[0]?.body).toBe(writes[1]?.body);
    expect(writes[0]?.headers.get('idempotency-key')).toBe(
      writes[1]?.headers.get('idempotency-key'),
    );
    expect(f.records.get('q6')?.version).toBe(1);
    expect(f.session.state('q6', 'trace_with_reason').answer).toEqual(trace('later'));
    expect(f.session.state('q6', 'trace_with_reason').status).toBe('unsaved');
    await f.session.save('q6');
    expect(f.records.get('q6')?.version).toBe(2);
  });
  it('preserves both conflicting drafts and requires an explicit resolution', async () => {
    const f = harness();
    await f.session.load('q6', 'trace_with_reason');
    f.session.edit('q6', trace('local'));
    const remote = prepareAnswer(trace('remote'), f.context('q6'));
    f.records.set('q6', {
      scope: f.context('q6').scope,
      answerContractDigest: f.context('q6').answerContract.digest,
      payload: remote.payload,
      sha256: remote.sha256,
      byteLength: remote.byteLength,
      version: 1,
      requestId: id(90),
    });
    await f.session.save('q6');
    expect(f.session.state('q6', 'trace_with_reason')).toMatchObject({
      status: 'conflict',
      answer: trace('local'),
      conflict: trace('remote'),
    });
    await f.session.resolve('q6', 'use_server');
    expect(f.session.state('q6', 'trace_with_reason')).toMatchObject({
      status: 'saved',
      answer: trace('remote'),
      conflict: null,
    });
    expect(f.records.get('q6')?.version).toBe(1);
  });
  it('unknown official receipts retain the immutable original snapshot across edits and repeat clicks', async () => {
    const f = harness();
    await f.session.load('q6', 'trace_with_reason');
    f.session.edit('q6', trace('original'));
    f.loseSubmit();
    await f.session.submit('q6');
    f.session.edit('q6', trace('later'));
    expect(f.session.state('q6', 'trace_with_reason').submitPending).toBe(true);
    f.session.setSubmitCapability('q6', false);
    await f.session.submit('q6');
    const submits = f.sent.filter((x) => x.url.includes('/submissions'));
    expect(submits[0]?.body).toBe(submits[1]?.body);
    expect(submits[0]?.headers.get('idempotency-key')).toBe(
      submits[1]?.headers.get('idempotency-key'),
    );
    expect(f.official.size).toBe(1);
    expect(f.session.state('q6', 'trace_with_reason')).toMatchObject({
      submitPending: false,
      answer: trace('later'),
    });
    expect(f.sent.some((call) => call.url === '/api/checkpoints')).toBe(false);
    await f.session.submit('q6');
    expect(f.sent.filter((call) => call.url.includes('/submissions'))).toHaveLength(2);
  });
  it('deadline/access loss stops save/resync without submitting drafts or accepting stale load data', async () => {
    const f = harness();
    await f.session.load('q6', 'trace_with_reason');
    f.session.edit('q6', trace());
    const before = f.sent.length;
    f.advance(3 * 3600000);
    await f.session.save('q6');
    await f.session.submit('q6');
    expect(f.sent).toHaveLength(before);
    expect(f.official.size).toBe(0);
    const g = harness();
    g.revoke();
    await g.session.load('q6', 'trace_with_reason');
    expect(g.callbacks.removed).toBe(1);
    expect(g.session.all()).toEqual({});
    await g.session.save('q6');
    await g.session.submit('q6');
    expect(g.sent).toHaveLength(1);
  });
  it('paused writes stay local and invalid Unicode/size is rejected before allocating an HTTP save', async () => {
    const f = harness();
    await f.session.load('q6', 'trace_with_reason');
    f.session.updateWindow(true, false, '2026-10-31T10:00:00Z', '2026-10-31T13:00:00Z');
    f.session.edit('q6', trace());
    await f.session.save('q6');
    expect(f.sent).toHaveLength(1);
    f.session.updateWindow(false, false, '2026-10-31T10:00:00Z', '2026-10-31T13:00:00Z');
    f.session.edit('q6', trace('\ud800'));
    await f.session.save('q6');
    expect(f.sent).toHaveLength(1);
    f.session.edit('q6', trace('fixed'));
    await f.session.save('q6');
    expect(f.sent).toHaveLength(2);
  });
  it('accepts near-limit canonical answers plus bounded framing on save/reload and prevents duplicate pending clicks', async () => {
    const f = harness();
    await f.session.load('q6', 'trace_with_reason');
    const size = serializeMixedAnswer(trace(''), 4096).byteLength;
    const answer = trace('x'.repeat(4096 - size));
    expect(serializeMixedAnswer(answer, 4096).byteLength).toBe(4096);
    f.session.edit('q6', answer);
    await f.session.save('q6');
    expect(f.session.state('q6', 'trace_with_reason').status).toBe('saved');
    f.session.dispose();
    f.session.mount();
    await f.session.load('q6', 'trace_with_reason');
    expect(f.session.state('q6', 'trace_with_reason').answer).toEqual(answer);
    await Promise.all([f.session.submit('q6'), f.session.submit('q6')]);
    expect(f.sent.filter((call) => call.url.includes('/submissions'))).toHaveLength(1);
    expect(f.official.size).toBe(1);
  });
  for (const operation of ['load', 'save', 'submit'] as const) {
    it('ignores a delayed403 from a disposed identity during ' + operation, async () => {
      const f = harness();
      if (operation !== 'load') {
        await f.session.load('q6', 'trace_with_reason');
        f.session.edit('q6', trace());
      }
      f.hold(operation);
      const pending =
        operation === 'load'
          ? f.session.load('q6', 'trace_with_reason')
          : operation === 'save'
            ? f.session.save('q6')
            : f.session.submit('q6');
      await f.held();
      f.session.dispose();
      f.releaseForbidden();
      await pending;
      expect(f.callbacks.removed).toBe(0);
      expect(f.session.all()).toEqual({});
    });
  }
});
