import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  createScoredExamReviewArtifactPort,
  configuredScoredExamReviewArtifactPort,
  readScoredExamReviewArtifact,
} from './scored-exam-review-artifacts';
import { id, reviewAnswerFixture } from '../../../../packages/db/tests/scored-exam-review-fixture';
const now = 1000000;
// Deliberately unsigned/non-authenticating fixture, never a provider credential.
const token = (claims: Record<string, unknown>) =>
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') +
  '.' +
  Buffer.from(JSON.stringify(claims)).toString('base64url') +
  '.' +
  'A'.repeat(43);
const claims = {
  sub: id(9),
  role: 'authenticated',
  aud: 'authenticated',
  nextera_artifact_reader: true,
  iat: 1000,
  exp: 1010,
};
const config = () => ({
  version: 1 as const,
  origin: 'http://127.0.0.1:56531',
  token: token(claims),
  publishableKey: 'sb_publishable_fixture',
  timeoutMs: 30,
  expiresAt: 1010000,
});
describe('explicit private code artifact transport, fake fetch only', () => {
  it('binds exact metadata path and bytes, without cookies, redirect or cache', async () => {
    const f = reviewAnswerFixture(),
      fetcher = vi.fn(async () => new Response(new Uint8Array(f.bytes)));
    const port = createScoredExamReviewArtifactPort(config(), fetcher, () => now);
    const result = await readScoredExamReviewArtifact(f.answer, port);
    expect(result).toMatchObject({ kind: 'coding', source: f.text, filename: 'f.go' });
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(url.origin).toBe(config().origin);
    expect(url.pathname).toBe(
      '/storage/v1/object/nextera-submissions/' +
        (f.answer.source.kind === 'stored_source' ? f.answer.source.objectKey : 'invalid'),
    );
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
    });
    expect(init.headers).toEqual({
      authorization: 'Bearer ' + config().token,
      apikey: 'sb_publishable_fixture',
    });
    expect(JSON.stringify(result)).not.toContain(config().token);
    expect(JSON.stringify(result)).not.toContain('/storage/v1/');
  });
  it('has no ordinary learner-cookie fallback or implicit configuration', async () => {
    const f = reviewAnswerFixture();
    await expect(readScoredExamReviewArtifact(f.answer, null)).rejects.toThrow(
      'SCORED_EXAM_REVIEW_ARTIFACT_UNAVAILABLE',
    );
    expect(configuredScoredExamReviewArtifactPort({}, vi.fn(), () => now)).toBeNull();
    expect(() =>
      createScoredExamReviewArtifactPort(
        { ...config(), token: token({ ...claims, nextera_artifact_reader: false }) },
        vi.fn(),
        () => now,
      ),
    ).toThrow('SCORED_EXAM_REVIEW_ARTIFACT_UNAVAILABLE');
  });
  it.each(['short', 'oversize', 'different', 'redirect', 'forbidden'] as const)(
    'rejects %s transport outcome',
    async (fault) => {
      const f = reviewAnswerFixture();
      const reply =
        fault === 'redirect'
          ? new Response(null, { status: 302, headers: { location: 'http://elsewhere.invalid/' } })
          : fault === 'forbidden'
            ? new Response(null, { status: 403 })
            : new Response(
                fault === 'short'
                  ? 'x'
                  : fault === 'oversize'
                    ? 'x'.repeat(f.bytes.byteLength + 1)
                    : 'x'.repeat(f.bytes.byteLength),
              );
      const port = createScoredExamReviewArtifactPort(
        config(),
        vi.fn(async () => reply),
        () => now,
      );
      await expect(readScoredExamReviewArtifact(f.answer, port)).rejects.toThrow(
        'SCORED_EXAM_REVIEW_ARTIFACT_UNAVAILABLE',
      );
    },
  );
  it('rejects metadata path traversal before fetch', async () => {
    const f = reviewAnswerFixture(),
      fetcher = vi.fn();
    const port = createScoredExamReviewArtifactPort(config(), fetcher, () => now);
    await expect(
      port.read({
        ...f.answer,
        ownerAuthUserId: '..',
        source: {
          kind: 'stored_source',
          bucket: 'nextera-submissions',
          objectKey: '../x',
          filename: 'f.go',
        },
      }),
    ).rejects.toThrow('SCORED_EXAM_REVIEW_ARTIFACT_UNAVAILABLE');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels an unfinished response at the explicit deadline', async () => {
    const f = reviewAnswerFixture();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const port = createScoredExamReviewArtifactPort(
      config(),
      vi.fn(async () => new Response(stream)),
      () => now,
    );
    await expect(port.read(f.answer)).rejects.toThrow('SCORED_EXAM_REVIEW_ARTIFACT_UNAVAILABLE');
    expect(cancelled).toBe(true);
  });
  it('refuses expired private access and mismatched public origin without a request', () => {
    const fetcher = vi.fn();
    expect(() => createScoredExamReviewArtifactPort(config(), fetcher, () => 1010000)).toThrow(
      'SCORED_EXAM_REVIEW_ARTIFACT_UNAVAILABLE',
    );
    const env = {
      NEXTERA_SCORED_EXAM_REVIEW_V1: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56531',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
      NEXTERA_SCORED_EXAM_REVIEW_ARTIFACT_TOKEN: config().token,
      NEXTERA_SCORED_EXAM_REVIEW_ARTIFACT_POLICY: JSON.stringify({
        version: 1,
        origin: 'https://elsewhere.invalid',
        timeoutMs: 30,
        expiresAt: 1010000,
      }),
    };
    expect(configuredScoredExamReviewArtifactPort(env, fetcher, () => now)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('immutable structured answers without Storage access', () => {
  it.each(['trace_with_reason', 'debug_with_reason'] as const)(
    'preserves %s canonical text including escaped NUL',
    async (kind) => {
      const f = reviewAnswerFixture(kind);
      const result = await readScoredExamReviewArtifact(f.answer, null);
      expect(result).toMatchObject({ kind, answer: JSON.parse(f.text) });
      expect(JSON.stringify(result)).not.toContain('payloadBase64');
    },
  );
  it('does not leak malformed answer text in errors', async () => {
    const f = reviewAnswerFixture('trace_with_reason');
    await expect(
      readScoredExamReviewArtifact({ ...f.answer, answerSha256: '0'.repeat(64) }, null),
    ).rejects.toThrow('SCORED_EXAM_REVIEW_ARTIFACT_UNAVAILABLE');
  });
});

describe('approved scored artifact path with private reader only', () => {
  it('fetches only the exact attempt/question/request/hash bound seven-part path', async () => {
    const f = reviewAnswerFixture();
    const key = `${f.answer.ownerAuthUserId}/${f.answer.cohortId}/scored-exam-v1/${f.answer.attemptId}/${f.answer.questionKey}/${f.answer.requestId}/${f.answer.answerSha256}`;
    const answer = {
      ...f.answer,
      source: {
        kind: 'stored_source' as const,
        bucket: 'nextera-submissions' as const,
        filename: 'f.go',
        objectKey: key,
      },
    };
    const fetcher = vi.fn(async () => new Response(new Uint8Array(f.bytes))),
      port = createScoredExamReviewArtifactPort(config(), fetcher, () => now);
    expect(await readScoredExamReviewArtifact(answer, port)).toMatchObject({
      kind: 'coding',
      source: f.text,
    });
    expect((fetcher.mock.calls[0] as unknown as [URL])[0].pathname).toBe(
      '/storage/v1/object/nextera-submissions/' + key,
    );
  });
  it.each(['attempt', 'task', 'extra', 'namespace', 'owner', 'hash'])(
    'denies %s cross-scope key before fetch',
    async (fault) => {
      const f = reviewAnswerFixture();
      const parts = [
        f.answer.ownerAuthUserId,
        f.answer.cohortId,
        'scored-exam-v1',
        f.answer.attemptId,
        f.answer.questionKey,
        f.answer.requestId,
        f.answer.answerSha256,
      ];
      if (fault === 'attempt') parts[3] = id(99);
      else if (fault === 'task') parts[4] = 'q2';
      else if (fault === 'extra') parts.push('extra');
      else if (fault === 'namespace') parts[2] = 'scored-exam-v2';
      else if (fault === 'owner') parts[0] = id(99);
      else parts[6] = 'f'.repeat(64);
      const answer = {
        ...f.answer,
        source: {
          kind: 'stored_source' as const,
          bucket: 'nextera-submissions' as const,
          filename: 'f.go',
          objectKey: parts.join('/'),
        },
      };
      const fetcher = vi.fn(),
        port = createScoredExamReviewArtifactPort(config(), fetcher, () => now);
      await expect(port.read(answer)).rejects.toThrow('SCORED_EXAM_REVIEW_ARTIFACT_UNAVAILABLE');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
