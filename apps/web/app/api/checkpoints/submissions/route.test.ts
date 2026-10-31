import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../../../../lib/auth/server', () => ({
  getDatabase: vi.fn(),
  requireDomainUser: vi.fn(),
}));
vi.mock('../../../../lib/submissions/storage', () => ({ storeSource: vi.fn() }));
vi.mock('@nextera/db/checkpoints', () => ({
  checkpointTaskContext: vi.fn(),
  acceptCheckpointSubmission: vi.fn(),
  createScoredExamIntakeClient: vi.fn(),
}));
vi.mock('@nextera/db/scored-exam-intake', async (original) => ({
  ...(await original<typeof import('@nextera/db/scored-exam-intake')>()),
  readScoredExamIntakeContext: vi.fn(),
}));
vi.mock('@nextera/db/scored-exam-code-upload', async (original) => ({
  ...(await original<typeof import('@nextera/db/scored-exam-code-upload')>()),
  createScoredExamCodeUploadClient: vi.fn(),
}));
vi.mock('../../../../lib/checkpoints/scored-exam-code-upload', async (original) => ({
  ...(await original<typeof import('../../../../lib/checkpoints/scored-exam-code-upload')>()),
  submitScoredExamCode: vi.fn(),
}));
import { createScoredExamCodeUploadClient } from '@nextera/db/scored-exam-code-upload';
import {
  submitScoredExamCode,
  ScoredExamCodeUploadError,
} from '../../../../lib/checkpoints/scored-exam-code-upload';
import { getDatabase, requireDomainUser } from '../../../../lib/auth/server';
import { storeSource } from '../../../../lib/submissions/storage';
import {
  checkpointTaskContext,
  acceptCheckpointSubmission,
  createScoredExamIntakeClient,
} from '@nextera/db/checkpoints';
import { readScoredExamIntakeContext } from '@nextera/db/scored-exam-intake';
import { POST } from './route';
const id = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const user = {
  id: id(1),
  authUserId: id(2),
  displayName: 'Synthetic learner',
  active: true,
  role: 'learner' as const,
};
const source = 'package piscine\r\n// exact ☃\n';
const sha = createHash('sha256').update(source).digest('hex');
const native = () => ({
  user_id: user.id,
  cohort_id: id(3),
  rules: { required_files: ['answer.go'], max_size_kb: 64 },
  scoredExam: { version: 1, form: 'A', rubricDigest: 'b'.repeat(64) },
  answerFormat: { version: 1, kind: 'coding' },
  submission: { version: 1, allowed: true, status: 'open', authority: 'scored_exam_intake_v1' },
});
function request(task = 'q1', bytes: BodyInit = source, origin = 'http://localhost:3150') {
  return new Request('http://localhost:3150/api/checkpoints/submissions', {
    method: 'POST',
    headers: {
      origin,
      host: 'localhost:3150',
      'x-attempt-id': id(4),
      'x-task-key': task,
      'x-filename': 'answer.go',
      'idempotency-key': id(5),
    },
    body: bytes,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv(
    'CHECKPOINT_ANSWER_HTTP_POLICY_V1',
    JSON.stringify({ version: 1, maxBodyBytes: 4096, bodyTimeoutMs: 1000 }),
  );
  vi.mocked(requireDomainUser).mockResolvedValue(user);
  vi.mocked(getDatabase).mockReturnValue({} as ReturnType<typeof getDatabase>);
  vi.mocked(checkpointTaskContext).mockResolvedValue(
    native() as Awaited<ReturnType<typeof checkpointTaskContext>>,
  );
  vi.mocked(createScoredExamIntakeClient).mockReturnValue(
    {} as ReturnType<typeof createScoredExamIntakeClient>,
  );
  vi.mocked(readScoredExamIntakeContext).mockResolvedValue({
    authUserId: user.authUserId,
    learnerId: user.id,
    cohortId: id(3),
    attemptId: id(4),
    taskKey: 'q1',
    filename: 'answer.go',
    definitionDigest: 'a'.repeat(64),
    snapshotDigest: 'c'.repeat(64),
    maxCodeBytes: 1024,
    policy: {
      version: 1,
      gradedAcceptanceAllowance: 7,
      rateWindowMs: 1000,
      maxAcceptancesPerWindow: 2,
      maxCodeBytes: 1024,
      resourcePolicyDigest: 'd'.repeat(64),
    },
    policyDigest: 'e'.repeat(64),
    status: 'open',
    canSubmit: true,
    serverNow: '2026-10-31T10:00:00Z',
    deadline: '2026-10-31T13:00:00Z',
  });
  vi.mocked(createScoredExamCodeUploadClient).mockReturnValue(
    {} as ReturnType<typeof createScoredExamCodeUploadClient>,
  );
  vi.mocked(storeSource).mockResolvedValue(sha);
  vi.mocked(submitScoredExamCode).mockResolvedValue({
    kind: 'accepted',
    submissionId: id(6),
  } as Awaited<ReturnType<typeof submitScoredExamCode>>);
  vi.mocked(acceptCheckpointSubmission).mockResolvedValue(id(7));
});
afterEach(() => vi.unstubAllEnvs());
describe('actual Checkpoint coding route selects authoritative scored intake', () => {
  it('preserves exact bytes/hash and frozen identity through reserved upload without legacy acceptance', async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ id: id(6) });
    expect(storeSource).not.toHaveBeenCalled();
    expect(submitScoredExamCode).toHaveBeenCalledWith(
      expect.anything(),
      {
        authUserId: user.authUserId,
        learnerId: user.id,
        cohortId: id(3),
        definitionDigest: 'a'.repeat(64),
        snapshotDigest: 'c'.repeat(64),
        attemptId: id(4),
        taskKey: 'q1',
        requestId: id(5),
        filename: 'answer.go',
        byteLength: Buffer.byteLength(source),
        answerSha256: sha,
      },
      Buffer.from(source),
      expect.any(AbortSignal),
    );
    expect(acceptCheckpointSubmission).not.toHaveBeenCalled();
  });
  it('does not reuse legacy pass/quota gates and preserves exact accepted replay response for the existing client', async () => {
    const context = await readScoredExamIntakeContext({} as never, user.authUserId, id(4), 'q1');
    vi.mocked(readScoredExamIntakeContext).mockResolvedValue({ ...context, canSubmit: false });
    vi.mocked(checkpointTaskContext).mockResolvedValue({
      ...native(),
      submission: { ...native().submission, allowed: false, status: 'allowance_exhausted' },
    } as Awaited<ReturnType<typeof checkpointTaskContext>>);
    vi.mocked(submitScoredExamCode).mockResolvedValue({
      kind: 'accepted',
      submissionId: id(6),
      replayed: true,
    } as Awaited<ReturnType<typeof submitScoredExamCode>>);
    expect((await POST(request())).status).toBe(202);
    expect(submitScoredExamCode).toHaveBeenCalledTimes(1);
  });
  it('uses no marker/header/task-name inference for legacy tasks', async () => {
    const legacy = { user_id: user.id, cohort_id: id(3), rules: native().rules };
    vi.mocked(checkpointTaskContext).mockResolvedValue(legacy);
    const input = request();
    input.headers.set('x-scored-exam', 'true');
    expect((await POST(input)).status).toBe(202);
    expect(acceptCheckpointSubmission).toHaveBeenCalledTimes(1);
    expect(readScoredExamIntakeContext).not.toHaveBeenCalled();
  });
  it('fails marked unavailable/malformed/typed requests closed with no source upload or legacy fallback', async () => {
    vi.mocked(readScoredExamIntakeContext).mockRejectedValueOnce(Error('private SQL unavailable'));
    expect((await POST(request())).status).toBe(503);
    vi.mocked(checkpointTaskContext).mockResolvedValueOnce({
      ...native(),
      scoredExam: { version: 2 },
    } as never);
    expect((await POST(request())).status).toBe(503);
    vi.mocked(checkpointTaskContext).mockResolvedValueOnce({
      ...native(),
      answerFormat: { version: 1, kind: 'trace_with_reason' },
      submission: { ...native().submission, authority: 'checkpoint_answers_v1' },
    } as never);
    expect((await POST(request('q6'))).status).toBe(503);
    expect(storeSource).not.toHaveBeenCalled();
    expect(acceptCheckpointSubmission).not.toHaveBeenCalled();
  });
  it('rejects origin, identity mismatch, closed intake and oversize before storing bytes', async () => {
    expect((await POST(request('q1', source, 'https://foreign.invalid'))).status).toBe(403);
    vi.mocked(checkpointTaskContext).mockResolvedValueOnce({
      ...native(),
      user_id: id(99),
    } as never);
    expect((await POST(request())).status).toBe(403);
    const context = await readScoredExamIntakeContext({} as never, user.authUserId, id(4), 'q1');
    vi.mocked(readScoredExamIntakeContext).mockResolvedValueOnce({
      ...context,
      status: 'closed',
      canSubmit: false,
    });
    expect((await POST(request())).status).toBe(409);
    expect((await POST(request('q1', 'x'.repeat(1025)))).status).toBe(413);
    expect(storeSource).not.toHaveBeenCalled();
  });
  it('propagates resource/rate denial without invoking the legacy upload path', async () => {
    vi.mocked(submitScoredExamCode).mockResolvedValueOnce({ kind: 'resource_unavailable' });
    expect((await POST(request())).status).toBe(503);
    vi.mocked(submitScoredExamCode).mockResolvedValueOnce({ kind: 'rate_limited' });
    expect((await POST(request())).status).toBe(429);
    expect(storeSource).not.toHaveBeenCalled();
    expect(acceptCheckpointSubmission).not.toHaveBeenCalled();
  });
  it('rejects invalid UTF8, encoded bodies and mismatched lengths before upload admission', async () => {
    expect((await POST(request('q1', new Uint8Array([0xc0, 0xaf])))).status).toBe(400);
    const compressed = request();
    compressed.headers.set('content-encoding', 'gzip');
    expect((await POST(compressed)).status).toBe(415);
    const mismatched = request();
    mismatched.headers.set('content-length', String(Buffer.byteLength(source) + 1));
    expect((await POST(mismatched)).status).toBe(400);
    expect(submitScoredExamCode).not.toHaveBeenCalled();
    expect(storeSource).not.toHaveBeenCalled();
  });
  it('requires compatible explicit HTTP bounds and cancels stalled/aborted streams without intake', async () => {
    vi.stubEnv('CHECKPOINT_ANSWER_HTTP_POLICY_V1', '');
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv(
      'CHECKPOINT_ANSWER_HTTP_POLICY_V1',
      JSON.stringify({ version: 1, maxBodyBytes: 512, bodyTimeoutMs: 1 }),
    );
    expect((await POST(request())).status).toBe(503);
    let cancelled = 0;
    const stream = new ReadableStream(
      {
        pull: () => new Promise(() => {}),
        cancel: () => {
          cancelled++;
        },
      },
      { highWaterMark: 0 },
    );
    vi.stubEnv(
      'CHECKPOINT_ANSWER_HTTP_POLICY_V1',
      JSON.stringify({ version: 1, maxBodyBytes: 4096, bodyTimeoutMs: 1 }),
    );
    const input = new Request(request().url, {
      method: 'POST',
      headers: request().headers,
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect((await POST(input)).status).toBe(408);
    expect(cancelled).toBeGreaterThan(0);
    const abort = new AbortController();
    const stopped = new Request(request().url, {
      method: 'POST',
      headers: request().headers,
      body: source,
      signal: abort.signal,
    });
    abort.abort();
    expect((await POST(stopped)).status).toBe(408);
    expect(storeSource).not.toHaveBeenCalled();
    expect(submitScoredExamCode).not.toHaveBeenCalled();
  });
  it('reports ambiguous official acceptance with503 and the original request identity', async () => {
    vi.mocked(submitScoredExamCode).mockRejectedValueOnce(
      new ScoredExamCodeUploadError('outcome_unknown'),
    );
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'SUBMISSION_UNCERTAIN', requestId: id(5) });
    expect(acceptCheckpointSubmission).not.toHaveBeenCalled();
  });
});
