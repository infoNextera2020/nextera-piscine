import 'server-only';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { ScoredExamReviewAnswer } from '@nextera/db/scored-exam-review-context';
import { answerContractDigest } from './answer-server-contract';
import { captureMixedAnswer } from './checkpoint-answer';

export class ScoredExamReviewArtifactError extends Error {
  constructor() {
    super('SCORED_EXAM_REVIEW_ARTIFACT_UNAVAILABLE');
  }
}
const fail = (): never => {
  throw new ScoredExamReviewArtifactError();
};
export type ScoredExamReviewArtifactPort = Readonly<{
  read(answer: ScoredExamReviewAnswer, signal?: AbortSignal): Promise<Uint8Array>;
}>;
export type ScoredExamReviewArtifactConfiguration = Readonly<{
  version: 1;
  origin: string;
  token: string;
  publishableKey: string;
  timeoutMs: number;
  expiresAt: number;
}>;
function jwtPayload(token: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]{43}$/.test(token)) return fail();
  const [h, p] = token.split('.');
  const header = JSON.parse(Buffer.from(h!, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  const payload = JSON.parse(Buffer.from(p!, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  if (
    header.alg !== 'HS256' ||
    header.typ !== 'JWT' ||
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  )
    return fail();
  return payload;
}
function readerExpiry(config: ScoredExamReviewArtifactConfiguration, now: number) {
  // Decoding only rejects obvious wrong-token configuration. Storage verifies the signature.
  const p = jwtPayload(config.token);
  if (
    p.role !== 'authenticated' ||
    p.aud !== 'authenticated' ||
    p.nextera_artifact_reader !== true ||
    typeof p.sub !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p.sub) ||
    typeof p.exp !== 'number' ||
    !Number.isSafeInteger(p.exp) ||
    !Number.isSafeInteger(p.exp * 1000) ||
    typeof p.iat !== 'number' ||
    !Number.isSafeInteger(p.iat) ||
    p.iat * 1000 > now ||
    p.exp * 1000 <= now ||
    p.exp * 1000 > config.expiresAt
  )
    return fail();
  return p.exp * 1000;
}
/** Explicit private reader only. Never mints a JWT or substitutes a learner cookie. */
export function createScoredExamReviewArtifactPort(
  configuration: ScoredExamReviewArtifactConfiguration,
  fetcher: typeof fetch,
  now: () => number = Date.now,
): ScoredExamReviewArtifactPort {
  try {
    const config = Object.freeze({ ...configuration });
    const origin = new URL(config.origin);
    if (
      config.version !== 1 ||
      origin.origin !== config.origin ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      !['https:', 'http:'].includes(origin.protocol) ||
      (origin.protocol === 'http:' &&
        origin.hostname !== '127.0.0.1' &&
        origin.hostname !== '[::1]') ||
      !Number.isSafeInteger(config.timeoutMs) ||
      config.timeoutMs <= 0 ||
      config.timeoutMs > 2147483647 ||
      !Number.isSafeInteger(config.expiresAt) ||
      config.expiresAt <= now() ||
      typeof config.token !== 'string' ||
      typeof config.publishableKey !== 'string' ||
      /\s/.test(config.publishableKey)
    )
      return fail();
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) {
      const publicClaims = jwtPayload(config.publishableKey);
      if (publicClaims.role !== 'anon' || publicClaims.nextera_artifact_reader === true)
        return fail();
    }
    readerExpiry(config, now());
    return Object.freeze({
      async read(answer: ScoredExamReviewAnswer, outer?: AbortSignal) {
        if (
          answer.source.kind !== 'stored_source' ||
          answer.source.bucket !== 'nextera-submissions' ||
          ![answer.ownerAuthUserId, answer.cohortId, answer.requestId].every(
            (v) => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v),
          ) ||
          !/^[0-9a-f]{64}$/.test(answer.answerSha256) ||
          (answer.source.objectKey !==
            `${answer.ownerAuthUserId}/${answer.cohortId}/${answer.requestId}/${answer.answerSha256}` &&
            !(
              typeof answer.attemptId === 'string' &&
              /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(answer.attemptId) &&
              /^q[1-5]$/.test(answer.questionKey) &&
              answer.answerKind === 'coding' &&
              answer.source.objectKey ===
                `${answer.ownerAuthUserId}/${answer.cohortId}/scored-exam-v1/${answer.attemptId}/${answer.questionKey}/${answer.requestId}/${answer.answerSha256}`
            )) ||
          !Number.isSafeInteger(answer.byteLength) ||
          answer.byteLength < 1 ||
          answer.byteLength > 262144 ||
          outer?.aborted
        )
          return fail();
        const expiry = readerExpiry(config, now());
        const controller = new AbortController();
        const abort = () => controller.abort();
        outer?.addEventListener('abort', abort, { once: true });
        let rejectAbort!: () => void;
        const aborted = new Promise<never>((_, reject) => {
          rejectAbort = () => reject(new ScoredExamReviewArtifactError());
        });
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
        const timer = setTimeout(abort, Math.min(config.timeoutMs, expiry - now()));
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let response: Response | undefined;
        let complete = false;
        try {
          const path =
            '/storage/v1/object/nextera-submissions/' +
            answer.source.objectKey.split('/').map(encodeURIComponent).join('/');
          const pending = fetcher(new URL(path, origin), {
            method: 'GET',
            redirect: 'error',
            cache: 'no-store',
            credentials: 'omit',
            headers: { authorization: 'Bearer ' + config.token, apikey: config.publishableKey },
            signal: controller.signal,
          }).then((reply) => {
            if (controller.signal.aborted) {
              void reply.body?.cancel().catch(() => {});
              return fail();
            }
            return reply;
          });
          const reply = (response = await Promise.race([pending, aborted]));
          if (reply.status !== 200 || !reply.body) return fail();
          const declared = reply.headers.get('content-length');
          if (
            declared !== null &&
            (!/^[1-9][0-9]*$/.test(declared) || Number(declared) !== answer.byteLength)
          )
            return fail();
          reader = reply.body.getReader();
          const chunks: Uint8Array[] = [];
          let count = 0;
          while (true) {
            const next = await Promise.race([reader.read(), aborted]);
            if (next.done) {
              complete = true;
              break;
            }
            count += next.value.byteLength;
            if (count > answer.byteLength) return fail();
            chunks.push(next.value);
          }
          const bytes = new Uint8Array(count);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          if (
            controller.signal.aborted ||
            outer?.aborted ||
            now() >= expiry ||
            count !== answer.byteLength ||
            createHash('sha256').update(bytes).digest('hex') !== answer.answerSha256
          )
            return fail();
          return bytes;
        } catch {
          return fail();
        } finally {
          clearTimeout(timer);
          outer?.removeEventListener('abort', abort);
          controller.signal.removeEventListener('abort', rejectAbort);
          controller.abort();
          if (reader && !complete) void reader.cancel().catch(() => {});
          else if (!reader && response?.body) void response.body.cancel().catch(() => {});
          try {
            reader?.releaseLock();
          } catch {
            /* Cancelled pending read settles independently. */
          }
        }
      },
    });
  } catch {
    return fail();
  }
}
/** Request-time explicit configuration; missing secrets mean no coding reader. */
export function configuredScoredExamReviewArtifactPort(
  environment: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch,
  now: () => number = Date.now,
): ScoredExamReviewArtifactPort | null {
  if (environment.NEXTERA_SCORED_EXAM_REVIEW_V1 !== '1') return null;
  try {
    const raw = JSON.parse(environment.NEXTERA_SCORED_EXAM_REVIEW_ARTIFACT_POLICY ?? '') as Record<
      string,
      unknown
    >;
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 4 ||
      !['version', 'origin', 'timeoutMs', 'expiresAt'].every((k) => Object.hasOwn(raw, k)) ||
      raw.version !== 1 ||
      typeof raw.origin !== 'string' ||
      typeof raw.timeoutMs !== 'number' ||
      typeof raw.expiresAt !== 'number' ||
      raw.origin !== new URL(environment.NEXT_PUBLIC_SUPABASE_URL ?? '').origin
    )
      return null;
    return createScoredExamReviewArtifactPort(
      {
        version: 1,
        origin: raw.origin,
        timeoutMs: raw.timeoutMs,
        expiresAt: raw.expiresAt,
        token: environment.NEXTERA_SCORED_EXAM_REVIEW_ARTIFACT_TOKEN ?? '',
        publishableKey: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
      },
      fetcher,
      now,
    );
  } catch {
    return null;
  }
}

/** Hash and canonical-text verification happens before any answer is returned. */
export async function readScoredExamReviewArtifact(
  answer: ScoredExamReviewAnswer,
  port: ScoredExamReviewArtifactPort | null,
  signal?: AbortSignal,
) {
  try {
    if (signal?.aborted) return fail();
    const bytes =
      answer.source.kind === 'structured_payload'
        ? Buffer.from(answer.source.payloadBase64, 'base64')
        : port
          ? await port.read(answer, signal)
          : fail();
    if (
      signal?.aborted ||
      bytes.byteLength !== answer.byteLength ||
      createHash('sha256').update(bytes).digest('hex') !== answer.answerSha256
    )
      return fail();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const binding = Object.freeze({
      attemptId: answer.attemptId,
      submissionId: answer.submissionId,
      questionKey: answer.questionKey,
      learnerId: answer.learnerId,
      cohortId: answer.cohortId,
      definitionDigest: answer.definitionDigest,
      snapshotDigest: answer.snapshotDigest,
      rubricDigest: answer.rubricDigest,
      answerSha256: answer.answerSha256,
      byteLength: answer.byteLength,
    });
    if (answer.source.kind === 'stored_source')
      return Object.freeze({
        binding,
        kind: 'coding' as const,
        filename: answer.source.filename,
        source: text,
      });
    const scope = {
      learnerId: answer.learnerId,
      cohortId: answer.cohortId,
      attemptId: answer.attemptId,
      taskKey: answer.questionKey,
      definitionDigest: answer.definitionDigest,
    };
    if (
      answer.source.answerContract.digest !==
      answerContractDigest(scope, answer.source.answerContract)
    )
      return fail();
    const prepared = captureMixedAnswer(
      scope,
      JSON.parse(text),
      answer.source.answerContract.maxBytes,
    );
    if (
      prepared.payload !== text ||
      prepared.byteLength !== bytes.byteLength ||
      prepared.answer.kind !== answer.answerKind
    )
      return fail();
    return Object.freeze({ binding, kind: prepared.answer.kind, answer: prepared.answer });
  } catch {
    return fail();
  }
}
