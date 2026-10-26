import { describe, expect, it, vi } from 'vitest';
import {
  createVisibleRunBackend,
  type ReservedVisibleRun,
  type VisibleRunReservations,
  type RunAuthority,
} from './visible-run-backend';
import {
  EditorApiError,
  createCheckpointRunHandlers,
  type EditorServerContext,
  type EditorSourceWrite,
} from './editor-http';
import {
  exactRunBytes,
  parseVisibleExampleManifest,
  parseVisibleRunPolicy,
  prepareVisibleRunWork,
  projectVisibleRunOutcome,
  runIntentDigest,
  runSourceDigest,
  visibleManifestDigest,
  visiblePolicyDigest,
  type IsolatedVisibleRunExecutor,
} from './visible-run-spec';

const ids = {
  user: '00000000-0000-4000-8000-000000000001',
  auth: '00000000-0000-4000-8000-000000000002',
  cohort: '00000000-0000-4000-8000-000000000003',
  attempt: '00000000-0000-4000-8000-000000000004',
  request: '00000000-0000-4000-8000-000000000005',
  run: '00000000-0000-4000-8000-000000000006',
};
const definition = 'a'.repeat(64),
  actor = { id: ids.user, authUserId: ids.auth };
const editor: EditorServerContext = {
  scope: {
    learnerId: ids.user,
    cohortId: ids.cohort,
    attemptId: ids.attempt,
    taskKey: 'question-a',
    definitionDigest: definition,
  },
  readAllowed: true,
  status: 'active',
  serverNow: '2026-10-27T10:00:00Z',
  deadline: '2026-10-27T11:00:00Z',
  sourceBytes: 128,
  filename: 'answer.go',
};
function manifest() {
  return {
    version: 1,
    visibility: 'visible_examples',
    language: 'go',
    taskKey: 'question-a',
    definitionDigest: definition,
    filename: 'answer.go',
    harness: {
      kind: 'go_function_v1',
      packageName: 'piscine',
      functionName: 'NormalizeLabel',
      argument: 'string',
      returns: 'string',
    },
    examples: [{ key: 'sample-one', input: ' A ', expectedOutput: 'a' }],
  };
}
function policy() {
  return {
    version: 1,
    key: 'synthetic-test-policy',
    enabled: true,
    visibility: 'visible_examples',
    graded: false,
    consumesGradedAttempts: false,
    limits: {
      timeoutMs: 1000,
      memoryMb: 64,
      outputBytes: 64,
      sourceBytes: 128,
      requestsPerWindow: 2,
      windowMs: 10000,
      concurrency: 1,
    },
    maxExamples: 2,
    isolation: {
      imageDigest: 'sha256:' + 'b'.repeat(64),
      network: 'none',
      hostAccess: 'none',
      filesystem: 'disposable',
      processUser: 'unprivileged',
      resourceEnforcement: 'external',
    },
  };
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function fixture() {
  const raw: RunAuthority = {
    editor: copy(editor),
    manifest: manifest(),
    manifestDigest: visibleManifestDigest(manifest()),
    policy: policy(),
  };
  const load = vi.fn(async () => raw);
  const reserve = vi.fn<VisibleRunReservations['reserve']>(async (input) => ({
    intent: input.intent,
    record: {
      id: ids.run,
      requestId: input.intent.requestId,
      sourceDigest: input.intent.sourceDigest,
      state: 'queued',
      output: null,
    },
  }));
  const read = vi.fn<VisibleRunReservations['read']>(async () => null);
  const backend = createVisibleRunBackend({ authority: { load }, reservations: { reserve, read } });
  const source = '\uFEFFpackage piscine\r\n// caf\u00e9\u0000';
  const input: EditorSourceWrite & {
    filename: string;
    visibleExamplesDigest: string;
    limits: ReturnType<typeof parseVisibleRunPolicy>['limits'];
  } = {
    actor,
    scope: copy(editor.scope),
    requestId: ids.request,
    source,
    sha256: runSourceDigest(source),
    byteLength: Buffer.byteLength(source),
    filename: 'answer.go',
    visibleExamplesDigest: raw.manifestDigest,
    limits: parseVisibleRunPolicy(raw.policy).limits,
  };
  return { raw, load, reserve, read, backend, input };
}
async function accepted() {
  const f = fixture();
  await f.backend.accept(f.input);
  const payload = f.reserve.mock.calls[0]![0];
  const saved: ReservedVisibleRun = {
    intent: payload.intent,
    record: {
      id: ids.run,
      requestId: ids.request,
      sourceDigest: f.input.sha256,
      state: 'completed',
      output: 'a',
    },
  };
  f.read.mockResolvedValue(saved);
  return { ...f, payload, saved };
}

describe('Data-only visible example manifest', () => {
  it('normalizes stable key order and deeply freezes only public data', () => {
    const m = manifest(),
      result = parseVisibleExampleManifest(m);
    expect(
      visibleManifestDigest({
        ...m,
        harness: { ...m.harness },
        examples: m.examples.map((e) => ({
          expectedOutput: e.expectedOutput,
          input: e.input,
          key: e.key,
        })),
      }),
    ).toBe(visibleManifestDigest(m));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.harness)).toBe(true);
    expect(Object.isFrozen(result.examples[0])).toBe(true);
    m.examples[0]!.input = 'mutated';
    expect(result.examples[0]!.input).toBe(' A ');
  });
  it.each([
    { testPack: 'private-pack' },
    { visibility: 'hidden' },
    { language: 'python' },
    { version: 2 },
    { definitionDigest: 'unknown' },
    { taskKey: '../task' },
    { filename: '../answer.go' },
    { filename: 'answer.go\n' },
    { harness: { ...manifest().harness, command: 'go test' } },
    { harness: { ...manifest().harness, kind: 'private_testpack' } },
    { harness: { ...manifest().harness, functionName: 'func' } },
    { harness: { ...manifest().harness, packageName: 'main; exit' } },
    { examples: [] },
    { examples: [{ key: 'a', input: '', expectedOutput: '', hidden: true }] },
    {
      examples: [
        { key: 'a', input: '', expectedOutput: '' },
        { key: 'a', input: 'other', expectedOutput: '' },
      ],
    },
    { examples: [{ key: 'a', input: '\ud800', expectedOutput: '' }] },
    { examples: [{ key: 'a', input: 'x'.repeat(262145), expectedOutput: '' }] },
  ])('rejects unsupported, private or malformed manifest %#', (patch) => {
    expect(() => parseVisibleExampleManifest({ ...manifest(), ...patch })).toThrow(
      'VISIBLE_RUN_SPEC_UNAVAILABLE',
    );
  });
  it('bounds the whole manifest and preserves exact visible input/output bytes', () => {
    const m = manifest();
    m.examples = [{ key: 'a', input: '\uFEFF\r\n\u0000\u00e9', expectedOutput: '' }];
    expect(parseVisibleExampleManifest(m).examples).toEqual(m.examples);
    m.examples = [
      { key: 'a', input: 'a'.repeat(140000), expectedOutput: '' },
      { key: 'b', input: 'b'.repeat(140000), expectedOutput: '' },
    ];
    expect(() => parseVisibleExampleManifest(m)).toThrow();
  });
  it.each(['-9223372036854775808', '9223372036854775807', '0'])(
    'preserves an exact int64 example %s',
    (input) => {
      const m = manifest();
      m.harness.argument = 'int64';
      m.examples[0]!.input = input;
      expect(parseVisibleExampleManifest(m).examples[0]!.input).toBe(input);
    },
  );
  it.each(['9223372036854775808', '-9223372036854775809', '01', '-0', '1.0', '1e3', '+1'])(
    'rejects ambiguous or overflowing int64 %s',
    (input) => {
      const m = manifest();
      m.harness.argument = 'int64';
      m.examples[0]!.input = input;
      expect(() => parseVisibleExampleManifest(m)).toThrow();
    },
  );
  it('changes its digest when any visible example or harness changes', () => {
    const m = manifest(),
      original = visibleManifestDigest(m);
    m.examples[0]!.expectedOutput = 'different';
    expect(visibleManifestDigest(m)).not.toBe(original);
    m.harness.functionName = 'Different';
    expect(visibleManifestDigest(m)).not.toBe(original);
  });
});

describe('Explicit separate Run policy', () => {
  it('requires all resource, rate, concurrency and isolation settings and has stable identity', () => {
    const p = policy(),
      result = parseVisibleRunPolicy(p);
    expect(Object.isFrozen(result.limits)).toBe(true);
    expect(
      visiblePolicyDigest({
        ...p,
        limits: { ...p.limits },
        isolation: Object.fromEntries(Object.entries(p.isolation).reverse()),
      }),
    ).toBe(visiblePolicyDigest(p));
    p.limits.requestsPerWindow = 3;
    expect(visiblePolicyDigest(p)).not.toBe(visiblePolicyDigest(result));
  });
  it.each([
    { enabled: false },
    { graded: true },
    { consumesGradedAttempts: true },
    { visibility: 'hidden' },
    { limits: null },
    { maxExamples: 0 },
    { limits: { ...policy().limits, windowMs: 0 } },
    { limits: { ...policy().limits, concurrency: NaN } },
    { limits: { ...policy().limits, outputBytes: 262145 } },
    { isolation: { ...policy().isolation, network: 'host' } },
    { isolation: { ...policy().isolation, imageDigest: 'latest' } },
    { isolation: { ...policy().isolation, hostAccess: 'mounted' } },
    { privatePack: 'anything' },
  ])('fails closed without a usable explicit policy %#', (patch) => {
    expect(() => parseVisibleRunPolicy({ ...policy(), ...patch })).toThrow();
  });
  it('does not supply defaults for an omitted limit', () => {
    for (const key of Object.keys(policy().limits)) {
      const p = copy(policy()) as { limits: Record<string, unknown> };
      delete p.limits[key];
      expect(() => parseVisibleRunPolicy(p)).toThrow();
    }
  });
  it('strictly bounds exact source and rejects replacement-code ambiguity', () => {
    expect(exactRunBytes('\uFEFF\r\n\u0000\u00e9', 128)).toEqual(
      Buffer.from('\uFEFF\r\n\u0000\u00e9'),
    );
    for (const source of ['', '\ud800', 'x'.repeat(129)])
      expect(() => exactRunBytes(source, 128)).toThrow();
  });
});

describe('Prepared Run authority and reservation backend / injected ports only', () => {
  it('resolves only server configuration and queues the immutable exact source through a separate port', async () => {
    const f = fixture(),
      record = await f.backend.accept(f.input),
      p = f.reserve.mock.calls[0]![0];
    expect(record).toMatchObject({ id: ids.run, state: 'queued', output: null });
    expect(p.intent).toMatchObject({
      source: f.input.source,
      sourceDigest: f.input.sha256,
      manifestDigest: f.raw.manifestDigest,
      deadline: editor.deadline,
    });
    expect(p.intentDigest).toBe(runIntentDigest(p.intent));
    expect(p.intent.policyDigest).toBe(visiblePolicyDigest(policy()));
    expect(Object.isFrozen(p.intent.scope)).toBe(true);
    expect(p).not.toHaveProperty('testPack');
    expect(p).not.toHaveProperty('submission');
    expect(p).not.toHaveProperty('command');
    expect(p.policy.consumesGradedAttempts).toBe(false);
  });
  it.each([
    { manifest: null },
    { manifest: { ...manifest(), hiddenPack: 'secret' } },
    { manifestDigest: 'c'.repeat(64) },
    { policy: null },
    { policy: { ...policy(), enabled: false } },
    { policy: { ...policy(), maxExamples: 0 } },
    { editor: { ...editor, filename: 'different.go' } },
    { editor: { ...editor, sourceBytes: 16 } },
  ])('does not reserve under unresolved or mismatched authority %#', async (patch) => {
    const f = fixture();
    f.load.mockResolvedValue({ ...f.raw, ...patch });
    await expect(f.backend.accept(f.input)).rejects.toThrow();
    expect(f.reserve).not.toHaveBeenCalled();
  });
  it('denies foreign actor/scope, removed access and attempts closed or expired before intake', async () => {
    for (const change of [
      { readAllowed: false },
      { scope: { ...editor.scope, learnerId: ids.auth } },
      { status: 'closed' as const },
      { serverNow: editor.deadline },
    ]) {
      const f = fixture();
      f.load.mockResolvedValue({ ...f.raw, editor: { ...editor, ...change } });
      await expect(f.backend.accept(f.input)).rejects.toBeInstanceOf(EditorApiError);
      expect(f.reserve).not.toHaveBeenCalled();
    }
  });
  it.each([
    { sha256: 'd'.repeat(64) },
    { byteLength: 1 },
    { filename: 'steal.go' },
    { visibleExamplesDigest: 'e'.repeat(64) },
    { requestId: 'bad' },
    { limits: { ...policy().limits, concurrency: 999 } },
  ])('rejects manipulated intake metadata %#', async (patch) => {
    const f = fixture();
    await expect(f.backend.accept({ ...f.input, ...patch })).rejects.toThrow();
    expect(f.reserve).not.toHaveBeenCalled();
  });
  it('does not reuse a foreign question scope even when the actor matches', async () => {
    const f = fixture();
    await expect(
      f.backend.accept({ ...f.input, scope: { ...f.input.scope, cohortId: ids.auth } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.reserve).not.toHaveBeenCalled();
  });
  it('surfaces atomic commit-time access, deadline, duplicate and rate failures without execution', async () => {
    for (const code of ['FORBIDDEN', 'CLOSED', 'IDEMPOTENCY_CONFLICT', 'RATE_LIMITED'] as const) {
      const f = fixture();
      f.reserve.mockRejectedValue(new EditorApiError(code, 5));
      await expect(f.backend.accept(f.input)).rejects.toMatchObject({ code });
      expect(f.reserve).toHaveBeenCalledOnce();
    }
  });
  it('rejects an incoherent accepted receipt instead of claiming success', async () => {
    const f = await accepted();
    for (const patch of [
      { scope: { ...f.saved.intent.scope, learnerId: ids.auth } },
      { source: 'other' },
      { sourceDigest: 'f'.repeat(64) },
      { policyDigest: 'f'.repeat(64) },
      { deadline: '2026-10-28T00:00:00Z' },
    ]) {
      f.reserve.mockResolvedValue({ ...f.saved, intent: { ...f.saved.intent, ...patch } });
      await expect(f.backend.accept(f.input)).rejects.toThrow();
    }
  });
  it('reconciles an original request after intake closes without reserving or consuming another allowance', async () => {
    const f = await accepted();
    f.load.mockResolvedValue({
      ...f.raw,
      editor: { ...editor, status: 'closed', serverNow: editor.deadline },
    });
    f.reserve.mockClear();
    expect(await f.backend.readByRequest!(actor, editor.scope, ids.request)).toEqual(
      f.saved.record,
    );
    expect(f.read).toHaveBeenCalledWith(actor, editor.scope, { requestId: ids.request });
    expect(f.reserve).not.toHaveBeenCalled();
    await expect(f.backend.accept(f.input)).rejects.toMatchObject({ code: 'CLOSED' });
  });
  it('rechecks current authority for each read and does not serve cached results after access removal', async () => {
    const f = await accepted();
    expect(await f.backend.read(actor, editor.scope, ids.run)).toEqual(f.saved.record);
    f.read.mockClear();
    f.load.mockResolvedValue({ ...f.raw, editor: { ...editor, readAllowed: false } });
    await expect(f.backend.read(actor, editor.scope, ids.run)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(f.read).not.toHaveBeenCalled();
  });
  it('rejects foreign run/query receipts and bounds projected learner output', async () => {
    const f = await accepted();
    for (const patch of [
      { id: ids.auth },
      { requestId: ids.auth },
      { sourceDigest: 'c'.repeat(64) },
      { output: 'x'.repeat(65) },
      { state: 'passed' },
      { state: 'running', output: 'premature' },
    ]) {
      f.read.mockResolvedValue({ ...f.saved, record: { ...f.saved.record, ...patch } as never });
      await expect(f.backend.read(actor, editor.scope, ids.run)).rejects.toThrow();
    }
  });
  it('returns no arbitrary grading fields or operational system-error diagnostics', async () => {
    const f = await accepted();
    f.read.mockResolvedValue({
      ...f.saved,
      record: {
        ...f.saved.record,
        state: 'system_error',
        output: 'host /secret/password',
        grade: 'passed',
        privateTests: ['secret'],
      } as never,
    });
    const result = await f.backend.read(actor, editor.scope, ids.run);
    expect(result).toEqual({ ...f.saved.record, state: 'system_error', output: '' });
    expect(result).not.toHaveProperty('grade');
  });
  it('returns missing results honestly and requires a matching request receipt', async () => {
    const f = fixture();
    expect(await f.backend.read(actor, editor.scope, ids.run)).toBeNull();
    const g = await accepted();
    g.read.mockResolvedValue({ ...g.saved, record: { ...g.saved.record, requestId: ids.auth } });
    await expect(g.backend.readByRequest!(actor, editor.scope, ids.request)).rejects.toThrow();
  });
});

describe('Isolated executor contract / fake execution only', () => {
  it('builds a frozen public-only work item and allowlists a bounded fake outcome', async () => {
    const f = await accepted(),
      work = prepareVisibleRunWork(ids.run, f.payload.intent, f.payload.manifest, f.payload.policy);
    const fake: IsolatedVisibleRunExecutor = {
      execute: vi.fn(async () => ({
        runId: ids.run,
        intentDigest: runIntentDigest(work.intent),
        state: 'completed',
        output: 'a',
        grade: 'passed',
        privatePack: 'ignored',
      })),
    };
    const outcome = projectVisibleRunOutcome(
      work,
      await fake.execute(work, new AbortController().signal),
    );
    expect(outcome).toEqual({
      runId: ids.run,
      intentDigest: runIntentDigest(work.intent),
      state: 'completed',
      output: 'a',
    });
    expect(Object.isFrozen(work)).toBe(true);
    expect(Object.isFrozen(work.intent.scope)).toBe(true);
    expect(work.policy.isolation.network).toBe('none');
    expect(work).not.toHaveProperty('environment');
  });
  it('rejects substituted work source, policy, manifest, deadline and scope before dispatch', async () => {
    const f = await accepted();
    for (const patch of [
      { source: 'changed' },
      { manifestDigest: 'd'.repeat(64) },
      { policyDigest: 'e'.repeat(64) },
      { deadline: 'invalid' },
      { scope: { ...f.payload.intent.scope, definitionDigest: 'f'.repeat(64) } },
    ]) {
      expect(() =>
        prepareVisibleRunWork(
          ids.run,
          { ...f.payload.intent, ...patch },
          f.payload.manifest,
          f.payload.policy,
        ),
      ).toThrow();
    }
  });
  it.each([
    { runId: ids.auth },
    { intentDigest: 'f'.repeat(64) },
    { state: 'passed' },
    { output: 'x'.repeat(65) },
    { output: '\ud800' },
  ])('rejects a mismatched, graded or unsafe executor result %#', async (patch) => {
    const f = await accepted(),
      work = prepareVisibleRunWork(ids.run, f.payload.intent, f.payload.manifest, f.payload.policy);
    expect(() =>
      projectVisibleRunOutcome(work, {
        runId: ids.run,
        intentDigest: runIntentDigest(work.intent),
        state: 'completed',
        output: 'a',
        ...patch,
      }),
    ).toThrow();
  });
  it('never publishes host diagnostics for an infrastructure failure', async () => {
    const f = await accepted(),
      work = prepareVisibleRunWork(ids.run, f.payload.intent, f.payload.manifest, f.payload.policy);
    expect(
      projectVisibleRunOutcome(work, {
        runId: ids.run,
        intentDigest: runIntentDigest(work.intent),
        state: 'system_error',
        output: 'token=secret /host/path',
      }).output,
    ).toBe('');
  });
});

describe('Run lost-acknowledgement HTTP reconciliation', () => {
  const base =
    'http://localhost:3118/api/checkpoints/runs?attempt=' + ids.attempt + '&task=question-a';
  const authenticate = async () => ({
    id: ids.user,
    authUserId: ids.auth,
    displayName: 'Synthetic test',
    role: 'learner' as const,
    active: true,
  });
  it('reads by the original request after expiry without creating a run and returns no private fields', async () => {
    const f = await accepted();
    f.load.mockResolvedValue({
      ...f.raw,
      editor: { ...editor, status: 'closed', serverNow: editor.deadline },
    });
    f.reserve.mockClear();
    const handlers = createCheckpointRunHandlers({ authenticate, backend: f.backend });
    const response = await handlers.GET(new Request(base + '&request=' + ids.request));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(f.saved.record);
    expect(f.reserve).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it.each(['', '&run=' + ids.run + '&request=' + ids.request, '&request=bad', '&request='])(
    'rejects absent, ambiguous or malformed lookups %s',
    async (suffix) => {
      const f = fixture();
      const response = await createCheckpointRunHandlers({ authenticate, backend: f.backend }).GET(
        new Request(base + suffix),
      );
      expect(response.status).toBe(400);
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it('fails closed if an older backend lacks request lookup', async () => {
    const f = fixture();
    const backend = { context: f.backend.context, read: f.backend.read, accept: f.backend.accept };
    expect(
      (
        await createCheckpointRunHandlers({ authenticate, backend }).GET(
          new Request(base + '&request=' + ids.request),
        )
      ).status,
    ).toBe(503);
  });
});

it('never dispatches extra storage metadata and measures output bounds in UTF-8 bytes', async () => {
  const f = await accepted();
  const polluted = {
    ...f.payload.intent,
    privatePack: 'must-not-cross',
    scope: { ...f.payload.intent.scope, privatePath: '/private' },
  };
  const work = prepareVisibleRunWork(ids.run, polluted, f.payload.manifest, f.payload.policy);
  expect(work.intent).not.toHaveProperty('privatePack');
  expect(work.intent.scope).not.toHaveProperty('privatePath');
  expect(() =>
    projectVisibleRunOutcome(work, {
      runId: ids.run,
      intentDigest: runIntentDigest(work.intent),
      state: 'completed',
      output: '\u00e9'.repeat(33),
    }),
  ).toThrow();
});
