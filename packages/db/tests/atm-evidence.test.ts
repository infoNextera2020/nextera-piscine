import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  ATM_RECONCILE_SQL,
  ATM_RETAIN_SQL,
  AtmEvidenceError,
  atmCanonical,
  atmDigest,
  captureAtmContext,
  captureAtmRetain,
  createPostgresAtmEvidenceStore,
} from '../queries/atm-evidence';
import {
  CLAIM_TOKEN,
  LIMITS,
  FakeAtmNative,
  captureFixture,
  contextFixture,
  fixtureId,
  resolveFixture,
  retainFixture,
} from './atm-evidence-fixture';

describe('authoritative ATM capture native adapter (fake SQL only)', () => {
  it('resolves actual Raid/team attempt separately from judge attempt, retaining bigint generation text', async () => {
    const native = new FakeAtmNative(),
      store = createPostgresAtmEvidenceStore(native, LIMITS);
    const context = await store.resolve(resolveFixture(), CLAIM_TOKEN);
    expect(context.raidAttemptId).not.toBe(context.judgeAttemptId);
    expect(context.generation).toBe('9007199254740993');
    expect(native.calls).toHaveLength(1);
    expect(native.calls[0]!.values.at(-1)).toBe(CLAIM_TOKEN);
    expect(JSON.stringify(context)).not.toContain(CLAIM_TOKEN);
  });
  it('rejects absent registration, wrong claim, source/snapshot/submission or cross-cohort context', async () => {
    const native = new FakeAtmNative(),
      store = createPostgresAtmEvidenceStore(native, LIMITS);
    native.registered = false;
    await expect(store.resolve(resolveFixture(), CLAIM_TOKEN)).rejects.toMatchObject({
      code: 'unavailable',
    });
    native.registered = true;
    await expect(store.resolve(resolveFixture(), fixtureId(90))).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(
      store.resolve({ ...resolveFixture(), submissionId: fixtureId(91) }, CLAIM_TOKEN),
    ).rejects.toMatchObject({ code: 'unavailable' });
    for (const change of [{ cohortId: fixtureId(92) }, { sourceSha256: '2'.repeat(64) }]) {
      await expect(
        store.retain(retainFixture(contextFixture(change)), CLAIM_TOKEN),
      ).rejects.toMatchObject({ code: 'unknown_outcome' });
    }
    expect(native.records.size).toBe(0);
  });
  it('writes full immutable private bytes and returns only the exact acknowledgement', async () => {
    const native = new FakeAtmNative(),
      store = createPostgresAtmEvidenceStore(native, LIMITS),
      input = retainFixture();
    const result = await store.retain(input, CLAIM_TOKEN);
    expect(result).toEqual({
      version: 1,
      operationId: input.operationId,
      contextDigest: input.context.contextDigest,
      captureDigest: input.captureDigest,
      state: 'retained',
    });
    expect(native.records.get(input.operationId)!.bytes).toBe(
      atmCanonical({ version: 1, context: input.context, captures: input.captures }),
    );
    expect(native.calls).toHaveLength(1);
    expect(native.calls[0]!.query).toBe(ATM_RETAIN_SQL);
    expect(native.records.get(input.operationId)!.bytes).not.toContain(CLAIM_TOKEN);
    expect(JSON.stringify(result)).not.toContain(captureFixture().stdoutBase64);
  });
  it('preserves unknown operation, performs no automatic retry, and supports explicit readback', async () => {
    const native = new FakeAtmNative(),
      store = createPostgresAtmEvidenceStore(native, LIMITS),
      input = retainFixture();
    native.loseAck = true;
    await expect(store.retain(input, CLAIM_TOKEN)).rejects.toMatchObject({
      code: 'unknown_outcome',
    });
    expect(native.calls).toHaveLength(1);
    expect(native.records.has(input.operationId)).toBe(true);
    const request = {
      version: input.version,
      operationId: input.operationId,
      context: input.context,
      captureDigest: input.captureDigest,
    };
    const readback = await store.reconcile(request, CLAIM_TOKEN);
    expect(readback.state).toBe('retained');
    expect(native.calls[1]!.query).toBe(ATM_RECONCILE_SQL);
    expect(native.calls).toHaveLength(2);
  });
  it('fake transaction readback failure rolls back and never returns a retained ack', async () => {
    const native = new FakeAtmNative(),
      store = createPostgresAtmEvidenceStore(native, LIMITS),
      input = retainFixture();
    native.readbackFailure = true;
    await expect(store.retain(input, CLAIM_TOKEN)).rejects.toMatchObject({
      code: 'unknown_outcome',
    });
    expect(native.records.size).toBe(0);
    const request = {
      version: input.version,
      operationId: input.operationId,
      context: input.context,
      captureDigest: input.captureDigest,
    };
    expect((await store.reconcile(request, CLAIM_TOKEN)).state).toBe('not_retained');
  });
  it.each(['lease', 'scope'])(
    'late replay/readback after %s loss is denied even when immutable evidence exists',
    async (removed) => {
      const native = new FakeAtmNative(),
        store = createPostgresAtmEvidenceStore(native, LIMITS),
        input = retainFixture();
      await store.retain(input, CLAIM_TOKEN);
      if (removed === 'lease') native.leaseValid = false;
      else native.scopeAllowed = false;
      await expect(store.retain(input, CLAIM_TOKEN)).rejects.toMatchObject({
        code: 'unknown_outcome',
      });
      const request = {
        version: input.version,
        operationId: input.operationId,
        context: input.context,
        captureDigest: input.captureDigest,
      };
      await expect(store.reconcile(request, CLAIM_TOKEN)).rejects.toMatchObject({
        code: 'unavailable',
      });
      expect(native.records.size).toBe(1);
    },
  );
  it('idempotent same-operation retry compares exact bytes and rejects changed captures', async () => {
    const native = new FakeAtmNative(),
      store = createPostgresAtmEvidenceStore(native, LIMITS),
      input = retainFixture();
    await store.retain(input, CLAIM_TOKEN);
    expect(await store.retain(input, CLAIM_TOKEN)).toMatchObject({ state: 'retained' });
    const changed = retainFixture(input.context, [
      { ...captureFixture(), stderrBase64: Buffer.from('changed').toString('base64') },
    ]);
    await expect(store.retain(changed, CLAIM_TOKEN)).rejects.toMatchObject({
      code: 'unknown_outcome',
    });
    expect(native.records.size).toBe(1);
  });
  it('requires exact semantic/root/model/image/context framing and rejects legacy/null values', () => {
    const context = contextFixture();
    for (const change of [
      { semanticProfileDigest: null },
      { semanticProfileDigest: '0'.repeat(64) },
      { modelId: 'caller-model' },
      { runnerImageDigest: 'f'.repeat(64) },
      { contextDigest: '0'.repeat(64) },
    ]) {
      expect(() => captureAtmContext({ ...context, ...change })).toThrow(AtmEvidenceError);
    }
    expect(() => captureAtmContext({ ...context, token: CLAIM_TOKEN })).toThrow(AtmEvidenceError);
  });
  it('bounds canonical payload/base64, validates real stdin SHA, order and complete-observation assertions', () => {
    const context = contextFixture(),
      input = retainFixture();
    for (const change of [
      { stdinBase64: 'YQ' },
      { inputSha256: '0'.repeat(64) },
      { caseIndex: 1 },
      { exitCode: 137, termination: 'unknown' },
      { assessment: 'observations_match', outputComplete: false },
      { stdoutBase64: Buffer.alloc(4097).toString('base64') },
    ]) {
      const captures = [{ ...captureFixture(), ...change }],
        request = retainFixture(context, captures);
      expect(() => captureAtmRetain(request, LIMITS)).toThrow(AtmEvidenceError);
    }
    expect(() => captureAtmRetain(input, { ...LIMITS, maxPayloadBytes: 10 })).toThrow(
      AtmEvidenceError,
    );
  });
  it('retains an actual empty/prefix unknown capture without inventing observations or academic PASS', async () => {
    const native = new FakeAtmNative(),
      store = createPostgresAtmEvidenceStore(native, LIMITS);
    const input = retainFixture(contextFixture(), []);
    expect((await store.retain(input, CLAIM_TOKEN)).state).toBe('retained');
    expect(native.records.get(input.operationId)!.bytes).toContain('"captures":[]');
    expect(native.records.get(input.operationId)!.bytes).not.toContain('passed');
  });
  it('uses the agreed NUL-framed canonical digest, not raw arbitrary serialization', () => {
    const input = retainFixture();
    expect(input.captureDigest).toBe(
      atmDigest('nextera-atm-capture', {
        captures: input.captures,
        context: input.context,
        version: 1,
      }),
    );
    expect(atmDigest('another-domain', input.context)).not.toBe(input.context.contextDigest);
  });
});
