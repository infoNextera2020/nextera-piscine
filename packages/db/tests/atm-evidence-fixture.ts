import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  ATM_MODEL_ID,
  ATM_SEMANTIC_PROFILE_DIGEST,
  atmCanonical,
  atmDigest,
  type AtmCaptureContext,
  type AtmEvidenceClient,
  type AtmEvidenceLimits,
} from '../queries/atm-evidence';
export const fixtureId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const CLAIM_TOKEN = fixtureId(99);
export const LIMITS: AtmEvidenceLimits = {
  maxPayloadBytes: 32768,
  maxStdinBytes: 4096,
  maxStdoutBytes: 4096,
  maxStderrBytes: 4096,
  maxCaseCount: 8,
};
export function contextFixture(overrides: Record<string, unknown> = {}): AtmCaptureContext {
  const body = {
    version: 1,
    jobId: fixtureId(1),
    judgeAttemptId: fixtureId(2),
    workerId: fixtureId(3),
    generation: '9007199254740993',
    submissionId: fixtureId(4),
    raidAttemptId: fixtureId(5),
    teamId: fixtureId(6),
    cohortId: fixtureId(7),
    curriculumVersionId: fixtureId(8),
    nodeKey: 'project-1',
    sourceSha256: 'a'.repeat(64),
    evaluationSnapshotDigest: 'b'.repeat(64),
    evaluationSpecDigest: 'c'.repeat(64),
    definitionDigest: 'd'.repeat(64),
    testPackId: 'atm-private-fixture',
    testPackDigest: 'e'.repeat(64),
    semanticProfileDigest: ATM_SEMANTIC_PROFILE_DIGEST,
    runnerImageDigest: 'sha256:' + 'f'.repeat(64),
    resourcePolicyDigest: '1'.repeat(64),
    modelId: ATM_MODEL_ID,
    caseCount: 2,
    ...overrides,
  };
  return {
    ...body,
    contextDigest: atmDigest('nextera-atm-capture-context', body),
  } as AtmCaptureContext;
}
export function resolveFixture(context = contextFixture()) {
  return Object.fromEntries(
    [
      'version',
      'jobId',
      'judgeAttemptId',
      'workerId',
      'generation',
      'submissionId',
      'evaluationSnapshotDigest',
    ].map((k) => [k, context[k as keyof AtmCaptureContext]]),
  );
}
export function captureFixture() {
  const stdin = Buffer.from('0427\n1\n4\n');
  return {
    caseFile: 'cases/public.json',
    caseIndex: 0,
    inputSha256: createHash('sha256').update(stdin).digest('hex'),
    stdinBase64: stdin.toString('base64'),
    stdoutBase64: Buffer.from('["end",100]\nPRIVATE_OUTPUT_SENTINEL').toString('base64'),
    stderrBase64: Buffer.from('PRIVATE_STDERR_SENTINEL').toString('base64'),
    exitCode: 0,
    transportWriteComplete: true,
    stdinHalfClosed: true,
    outputComplete: true,
    termination: 'exited',
    assessment: 'projection_mismatch',
  };
}
export function retainFixture(
  context = contextFixture(),
  captures: unknown[] = [captureFixture()],
) {
  return {
    version: 1,
    operationId: fixtureId(10),
    context,
    captures,
    captureDigest: atmDigest('nextera-atm-capture', { version: 1, context, captures }),
  };
}
/** Fake single-statement native boundary. Tests never execute PostgreSQL or claim native proof. */
export class FakeAtmNative implements AtmEvidenceClient {
  context = contextFixture();
  calls: { query: string; values: unknown[] }[] = [];
  records = new Map<string, { bytes: string; digest: string }>();
  leaseValid = true;
  scopeAllowed = true;
  registered = true;
  loseAck = false;
  readbackFailure = false;
  async unsafe(query: string, parameters: never[]): Promise<unknown> {
    const v = parameters as unknown[],
      token = v.at(-1);
    this.calls.push({ query, values: v });
    if (
      !this.leaseValid ||
      !this.scopeAllowed ||
      !this.registered ||
      token !== CLAIM_TOKEN ||
      v[0] !== this.context.jobId ||
      v[1] !== this.context.judgeAttemptId ||
      v[2] !== this.context.workerId ||
      v[3] !== this.context.generation
    )
      throw new Error('FAKE_NATIVE_DENIAL_' + CLAIM_TOKEN);
    if (query.includes('resolve_atm_capture_context')) {
      if (v[4] !== this.context.submissionId || v[5] !== this.context.evaluationSnapshotDigest)
        throw new Error('snapshot swapped');
      return [{ data: this.context }];
    }
    const operation = String(v[4]),
      context = JSON.parse(String(v[5])),
      digest = String(v[6]);
    if (atmCanonical(context) !== atmCanonical(this.context)) throw new Error('context swapped');
    const existing = this.records.get(operation);
    if (existing && existing.digest !== digest) throw new Error('conflict');
    const ack = (state: string) => [
      {
        data: {
          version: 1,
          operationId: operation,
          contextDigest: this.context.contextDigest,
          captureDigest: digest,
          state,
        },
      },
    ];
    if (query.includes('reconcile_atm_capture')) return ack(existing ? 'retained' : 'not_retained');
    const body = atmCanonical({ version: 1, context, captures: JSON.parse(String(v[7])) });
    if (existing && existing.bytes !== body) throw new Error('byte conflict');
    this.records.set(operation, { bytes: body, digest });
    if (this.readbackFailure) {
      if (existing) this.records.set(operation, existing);
      else this.records.delete(operation);
      throw new Error('FAKE_TRANSACTION_ROLLBACK_' + CLAIM_TOKEN);
    }
    if (this.loseAck) {
      this.loseAck = false;
      throw new Error('FAKE_COMMITTED_UNKNOWN_' + CLAIM_TOKEN);
    }
    return ack('retained');
  }
}
