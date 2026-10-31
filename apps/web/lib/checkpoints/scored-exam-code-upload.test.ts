import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../supabase/server', () => ({ createClient: vi.fn() }));
import { createClient } from '../supabase/server';
import {
  submitScoredExamCode,
  createScoredExamCodeStoragePort,
  scoredExamCodeStoragePolicy,
} from './scored-exam-code-upload';
import {
  SCORED_EXAM_CODE_RECEIPT_SQL,
  RESERVE_SCORED_EXAM_CODE_UPLOAD_SQL,
  ACCEPT_SCORED_EXAM_CODE_UPLOAD_SQL,
  scoredExamCodeObjectKey,
  type ScoredExamCodeUploadClient,
  type ScoredExamCodeUploadInput,
  type ScoredExamCodeReservation,
} from '@nextera/db/scored-exam-code-upload';
const id = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const source = Buffer.from('package piscine\n// exact source\n');
const input: ScoredExamCodeUploadInput = {
  authUserId: id(1),
  learnerId: id(2),
  cohortId: id(3),
  attemptId: id(4),
  taskKey: 'q1',
  requestId: id(5),
  filename: 'answer.go',
  byteLength: source.byteLength,
  answerSha256: createHash('sha256').update(source).digest('hex'),
  definitionDigest: 'b'.repeat(64),
  snapshotDigest: 'c'.repeat(64),
};
const accepted = (replayed = true) => ({
  kind: 'accepted',
  attemptId: input.attemptId,
  taskKey: input.taskKey,
  definitionDigest: input.definitionDigest,
  snapshotDigest: input.snapshotDigest,
  submissionId: id(6),
  jobId: id(7),
  artifactId: id(8),
  requestId: input.requestId,
  answerSha256: input.answerSha256,
  byteLength: input.byteLength,
  filename: input.filename,
  acceptedOrdinal: '1',
  replayed,
});
const reservation = (): ScoredExamCodeReservation => ({
  kind: 'reserved',
  ...input,
  intakePolicyDigest: 'd'.repeat(64),
  uploadPolicyDigest: 'e'.repeat(64),
  bucket: 'nextera-submissions',
  objectKey: scoredExamCodeObjectKey(input),
  reservedAt: '2026-10-31T05:00:00.000001+00:00',
  serverNow: '2026-10-31T05:00:01.000001+00:00',
  deadline: '2026-10-31T08:00:00.000001+00:00',
  resumed: false,
});
function fake(replies: unknown[], order: string[] = []) {
  const unsafe = vi.fn(async (statement: string, args: unknown[]) => {
    order.push(statement);
    void args;
    const value = replies.shift();
    if (value instanceof Error) throw value;
    return [{ data: value }];
  });
  return { unsafe, client: { unsafe } as unknown as ScoredExamCodeUploadClient };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe('scored code orchestration (fake RPC and Storage ports only)', () => {
  it('returns exact receipt with no reservation/upload even when storage policy absent', async () => {
    const f = fake([accepted()]);
    expect(await submitScoredExamCode(f.client, input, source)).toMatchObject({
      kind: 'accepted',
      replayed: true,
    });
    expect(f.unsafe).toHaveBeenCalledTimes(1);
    expect(createClient).not.toHaveBeenCalled();
  });
  it.each([
    'closed',
    'forbidden',
    'conflict',
    'allowance_exhausted',
    'rate_limited',
    'resource_unavailable',
    'unavailable',
  ])('does not upload on proved receipt denial %s', async (kind) => {
    const f = fake([{ kind }]),
      storeAndVerify = vi.fn();
    expect(
      await submitScoredExamCode(f.client, input, source, undefined, { storeAndVerify }),
    ).toEqual({ kind });
    expect(storeAndVerify).not.toHaveBeenCalled();
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it('missing explicit storage policy fails before NEW reservation', async () => {
    const f = fake([{ kind: 'absent' }]);
    expect(await submitScoredExamCode(f.client, input, source)).toEqual({ kind: 'unavailable' });
    expect(f.unsafe).toHaveBeenCalledTimes(1);
    expect(createClient).not.toHaveBeenCalled();
  });
  it('reserves before upload, then finalizes exact bytes with unchanged request', async () => {
    const order: string[] = [],
      f = fake([{ kind: 'absent' }, reservation(), accepted(false)], order);
    const storeAndVerify = vi.fn(async (r: ScoredExamCodeReservation, b: Uint8Array) => {
      order.push('storage');
      expect(r.objectKey).toBe(scoredExamCodeObjectKey(input));
      expect(Buffer.from(b)).toEqual(source);
    });
    expect(
      await submitScoredExamCode(f.client, input, source, undefined, { storeAndVerify }),
    ).toMatchObject({ kind: 'accepted', replayed: false });
    expect(order).toEqual([
      SCORED_EXAM_CODE_RECEIPT_SQL,
      RESERVE_SCORED_EXAM_CODE_UPLOAD_SQL,
      'storage',
      ACCEPT_SCORED_EXAM_CODE_UPLOAD_SQL,
    ]);
    for (const call of f.unsafe.mock.calls) expect(call[1][3]).toBe(input.requestId);
  });
  it('concurrent accepted receipt returned by reservation skips upload/finalize', async () => {
    const f = fake([{ kind: 'absent' }, accepted()]),
      storeAndVerify = vi.fn();
    expect(
      await submitScoredExamCode(f.client, input, source, undefined, { storeAndVerify }),
    ).toMatchObject({ kind: 'accepted', replayed: true });
    expect(storeAndVerify).not.toHaveBeenCalled();
    expect(f.unsafe).toHaveBeenCalledTimes(2);
  });
  it('resource denial after receipt miss never creates an orphan upload', async () => {
    const f = fake([{ kind: 'absent' }, { kind: 'resource_unavailable' }]),
      storeAndVerify = vi.fn();
    expect(
      await submitScoredExamCode(f.client, input, source, undefined, { storeAndVerify }),
    ).toEqual({ kind: 'resource_unavailable' });
    expect(storeAndVerify).not.toHaveBeenCalled();
  });
  it('unknown reservation outcome never uploads or picks a fresh request', async () => {
    const f = fake([{ kind: 'absent' }, new Error('private details')]),
      storeAndVerify = vi.fn();
    await expect(
      submitScoredExamCode(f.client, input, source, undefined, { storeAndVerify }),
    ).rejects.toThrow('OUTCOME_UNKNOWN');
    expect(storeAndVerify).not.toHaveBeenCalled();
    expect(f.unsafe).toHaveBeenCalledTimes(2);
  });
  it('unknown upload retains same reservation: exact retry resumes and is accepted once', async () => {
    const r = { ...reservation(), resumed: true };
    const f = fake([{ kind: 'absent' }, reservation(), { kind: 'absent' }, r, accepted(false)]);
    const storeAndVerify = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    await expect(
      submitScoredExamCode(f.client, input, source, undefined, { storeAndVerify }),
    ).rejects.toThrow('OUTCOME_UNKNOWN');
    expect(
      await submitScoredExamCode(f.client, input, source, undefined, { storeAndVerify }),
    ).toMatchObject({ kind: 'accepted' });
    expect(storeAndVerify).toHaveBeenCalledTimes(2);
    for (const call of f.unsafe.mock.calls) expect(call[1][3]).toBe(input.requestId);
    expect(
      f.unsafe.mock.calls.filter((c) => c[0] === ACCEPT_SCORED_EXAM_CODE_UPLOAD_SQL),
    ).toHaveLength(1);
  });
  it('clones source before await and refuses a changed source before database IO', async () => {
    const f = fake([accepted()]),
      v = Uint8Array.from(source),
      p = submitScoredExamCode(f.client, input, v);
    v.fill(0);
    await p;
    const g = fake([accepted()]);
    await expect(submitScoredExamCode(g.client, input, Buffer.from('changed'))).rejects.toThrow(
      'INVALID_INPUT',
    );
    expect(g.unsafe).not.toHaveBeenCalled();
  });
  it('abort after reservation never finalizes or auto-refunds', async () => {
    const f = fake([{ kind: 'absent' }, reservation()]),
      controller = new AbortController();
    const storeAndVerify = vi.fn(async () => {
      controller.abort();
    });
    await expect(
      submitScoredExamCode(f.client, input, source, controller.signal, { storeAndVerify }),
    ).rejects.toThrow('OUTCOME_UNKNOWN');
    expect(f.unsafe).toHaveBeenCalledTimes(2);
  });
});
describe('authenticated immutable source port (SDK mocked, not native Storage proof)', () => {
  function sdk(data: Blob | null, error: unknown = null) {
    const upload = vi.fn(async (): Promise<{ data: null; error: Error | null }> => ({
        data: null,
        error: new Error('already exists'),
      })),
      download = vi.fn(async () => ({ data, error }));
    vi.mocked(createClient).mockResolvedValue({
      storage: { from: vi.fn(() => ({ upload, download })) },
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    return { upload, download };
  }
  it('allows exact immutable conflict replay only after authoritative byte readback', async () => {
    const f = sdk(new Blob([source]));
    // Synthetic timeout for this fake only; not an approved runtime policy/default.
    await createScoredExamCodeStoragePort({ version: 1, timeoutMs: 1000 }).storeAndVerify(
      reservation(),
      source,
    );
    expect(f.upload).toHaveBeenCalledExactlyOnceWith(scoredExamCodeObjectKey(input), source, {
      contentType: 'application/octet-stream',
      upsert: false,
    });
    expect(f.download).toHaveBeenCalledTimes(1);
  });
  it('refuses mismatching readback/hash and download failure', async () => {
    sdk(new Blob([Buffer.alloc(source.byteLength)]));
    await expect(
      createScoredExamCodeStoragePort({ version: 1, timeoutMs: 1000 }).storeAndVerify(
        reservation(),
        source,
      ),
    ).rejects.toThrow('OUTCOME_UNKNOWN');
    sdk(null, new Error('private details'));
    await expect(
      createScoredExamCodeStoragePort({ version: 1, timeoutMs: 1000 }).storeAndVerify(
        reservation(),
        source,
      ),
    ).rejects.toThrow('OUTCOME_UNKNOWN');
  });
  it('times out an unresolved upload and ignores late completion without download/finalization', async () => {
    vi.useFakeTimers();
    let resolveUpload!: (v: { data: null; error: null }) => void;
    const f = sdk(new Blob([source]));
    f.upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve as typeof resolveUpload;
        }),
    );
    const p = createScoredExamCodeStoragePort({ version: 1, timeoutMs: 13 }).storeAndVerify(
      reservation(),
      source,
    );
    const assertion = expect(p).rejects.toThrow('OUTCOME_UNKNOWN');
    await vi.advanceTimersByTimeAsync(14);
    await assertion;
    resolveUpload({ data: null, error: null });
    await Promise.resolve();
    expect(f.download).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    '',
    '{}',
    '{"version":1,"timeoutMs":0}',
    '{"version":1,"timeoutMs":1.5}',
    '{"version":1,"timeoutMs":4,"extra":true}',
  ])('requires explicit valid timeout policy %s', (raw) => {
    expect(scoredExamCodeStoragePolicy(raw)).toBeNull();
  });
});
