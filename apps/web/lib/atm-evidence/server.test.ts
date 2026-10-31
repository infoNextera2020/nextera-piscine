import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@nextera/db/atm-evidence', async (original) => ({
  ...(await original<typeof import('@nextera/db/atm-evidence')>()),
  openAtmEvidencePostgres: vi.fn(() => {
    throw new Error('live connection forbidden in fake HTTP tests');
  }),
}));
import { handleAtmEvidenceRequest, configuredAtmEvidence, type AtmEvidenceOpener } from './server';
import {
  CLAIM_TOKEN,
  LIMITS,
  FakeAtmNative,
  captureFixture,
  contextFixture,
  fixtureId,
  resolveFixture,
  retainFixture,
} from '../../../../packages/db/tests/atm-evidence-fixture';

const NOW = 1900000000000;
const DSN = 'postgres://restricted_fixture@127.0.0.1:5432/not_connected_fake';
function environment(overrides: Record<string, unknown> = {}) {
  return {
    NEXTERA_ATM_EVIDENCE_V1: '1',
    NEXTERA_ATM_EVIDENCE_DB_FIXTURE: DSN,
    NEXTERA_ATM_EVIDENCE_CONFIGURATION: JSON.stringify({
      version: 1,
      expiresAt: NOW + 10000,
      timeoutMs: 1000,
      maxRequestBytes: 65536,
      limits: LIMITS,
      workers: [{ workerId: fixtureId(3), connectionEnv: 'NEXTERA_ATM_EVIDENCE_DB_FIXTURE' }],
      ...overrides,
    }),
  };
}
function request(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request('http://internal.invalid/api/internal/atm-evidence/retain', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + CLAIM_TOKEN,
      ...headers,
    },
    body: raw ?? JSON.stringify(body),
  });
}
function dependencies(native = new FakeAtmNative()) {
  const close = vi.fn(async () => {}),
    open = vi.fn<AtmEvidenceOpener>(() => ({ client: native, close }));
  return { native, open, close, now: () => NOW };
}
afterEach(() => vi.restoreAllMocks());

describe('protected ATM private evidence HTTP assembly (fake DB/clock)', () => {
  it('stays unavailable without explicit worker provider/policy and never falls back to DATABASE_URL', async () => {
    const d = dependencies();
    const reply = await handleAtmEvidenceRequest(
      request(resolveFixture()),
      'resolve',
      { DATABASE_URL: 'must-not-use' },
      d,
    );
    expect(reply.status).toBe(503);
    expect(d.open).not.toHaveBeenCalled();
    for (const changed of [
      { expiresAt: NOW },
      { timeoutMs: 0 },
      { maxRequestBytes: 0 },
      { workers: [] },
      { workers: [{ workerId: fixtureId(3), connectionEnv: 'DATABASE_URL' }] },
    ]) {
      expect(() => configuredAtmEvidence(environment(changed), NOW)).toThrow(
        'ATM_EVIDENCE_UNAVAILABLE',
      );
    }
  });
  it('requires only the claim proof header, denying cookie/JWT/browser/foreign worker substitutes', async () => {
    for (const headers of [
      { authorization: '' },
      { authorization: 'Bearer user-jwt' },
      { cookie: 'synthetic-session-cookie' },
      { origin: 'http://browser.invalid' },
    ]) {
      const d = dependencies(),
        reply = await handleAtmEvidenceRequest(
          request(resolveFixture(), headers),
          'resolve',
          environment(),
          d,
        );
      expect(reply.status).toBe(503);
      expect(d.open).not.toHaveBeenCalled();
    }
    const d = dependencies();
    const reply = await handleAtmEvidenceRequest(
      request({ ...resolveFixture(), workerId: fixtureId(91) }),
      'resolve',
      environment(),
      d,
    );
    expect(reply.status).toBe(503);
    expect(d.open).not.toHaveBeenCalled();
  });
  it('selects only configured worker DSN and returns authoritative digest-only context', async () => {
    const d = dependencies(),
      reply = await handleAtmEvidenceRequest(
        request(resolveFixture()),
        'resolve',
        environment(),
        d,
      );
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual(contextFixture());
    expect(d.open).toHaveBeenCalledExactlyOnceWith(DSN);
    expect(d.close).toHaveBeenCalledOnce();
    expect(reply.headers.get('cache-control')).toBe('private, no-store');
    expect(reply.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('stores full private captures through the native adapter and exposes only the five-key ack', async () => {
    const d = dependencies(),
      input = retainFixture();
    const reply = await handleAtmEvidenceRequest(request(input), 'retain', environment(), d),
      text = await reply.text();
    expect(reply.status).toBe(200);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual([
      'captureDigest',
      'contextDigest',
      'operationId',
      'state',
      'version',
    ]);
    expect(d.native.records.get(input.operationId)!.bytes).toContain(captureFixture().stdoutBase64);
    expect(text).not.toContain(captureFixture().stdoutBase64);
    expect(text).not.toContain(CLAIM_TOKEN);
    expect(text).not.toContain(DSN);
  });
  it('redacts provider errors and never retries unknown retained writes or generates an operation', async () => {
    const d = dependencies(),
      input = retainFixture();
    d.native.loseAck = true;
    const log = vi.spyOn(console, 'error');
    const reply = await handleAtmEvidenceRequest(request(input), 'retain', environment(), d),
      text = await reply.text();
    expect(reply.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      error: 'ATM_EVIDENCE_UNRESOLVED',
      outcome: 'unknown',
      operationId: input.operationId,
    });
    expect(d.native.calls).toHaveLength(1);
    expect(text).not.toContain(CLAIM_TOKEN);
    expect(text).not.toContain(DSN);
    expect(log).not.toHaveBeenCalled();
    const reconcile = {
      version: input.version,
      operationId: input.operationId,
      context: input.context,
      captureDigest: input.captureDigest,
    };
    const readback = await handleAtmEvidenceRequest(
      request(reconcile),
      'reconcile',
      environment(),
      d,
    );
    expect(await readback.json()).toMatchObject({
      operationId: input.operationId,
      state: 'retained',
    });
    expect(d.native.calls).toHaveLength(2);
  });
  it('denies readback after native lease loss even if the full bytes are already retained', async () => {
    const d = dependencies(),
      input = retainFixture();
    await handleAtmEvidenceRequest(request(input), 'retain', environment(), d);
    d.native.leaseValid = false;
    const reconcile = {
      version: input.version,
      operationId: input.operationId,
      context: input.context,
      captureDigest: input.captureDigest,
    };
    const reply = await handleAtmEvidenceRequest(request(reconcile), 'reconcile', environment(), d);
    expect(reply.status).toBe(503);
    expect(await reply.json()).toEqual({ error: 'ATM_EVIDENCE_UNAVAILABLE' });
  });
  it('rejects duplicate JSON, extra token fields, noncanonical framing and bounded-body violations before connecting', async () => {
    const body = JSON.stringify(resolveFixture());
    for (const raw of [
      body.slice(0, -1) + ',"version":1}',
      JSON.stringify({ ...resolveFixture(), token: CLAIM_TOKEN }),
      body + '\n{}',
      ' ' + body,
    ]) {
      const d = dependencies(),
        reply = await handleAtmEvidenceRequest(request(null, {}, raw), 'resolve', environment(), d);
      expect(reply.status).toBe(503);
      expect(d.open).not.toHaveBeenCalled();
    }
    const d = dependencies();
    const reply = await handleAtmEvidenceRequest(
      request(resolveFixture(), { 'content-length': '99999999' }),
      'resolve',
      environment(),
      d,
    );
    expect(reply.status).toBe(503);
    expect(d.open).not.toHaveBeenCalled();
  });
  it('bounds a stalled request body with the same explicit operation budget and cancels its reader', async () => {
    const d = dependencies(),
      cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const req = new Request('http://internal.invalid/api/internal/atm-evidence/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CLAIM_TOKEN },
      body,
      duplex: 'half',
    } as RequestInit);
    const reply = await handleAtmEvidenceRequest(req, 'resolve', environment({ timeoutMs: 5 }), d);
    expect(reply.status).toBe(503);
    expect(cancel).toHaveBeenCalledOnce();
    expect(d.open).not.toHaveBeenCalled();
  });
  it('reports unknown after a sent SQL timeout, closes provider, and never issues a second write', async () => {
    const d = dependencies(),
      input = retainFixture();
    const unsafe = vi.fn(() => new Promise<unknown>(() => {}));
    d.open.mockReturnValue({ client: { unsafe }, close: d.close });
    const reply = await handleAtmEvidenceRequest(
      request(input),
      'retain',
      environment({ timeoutMs: 5 }),
      d,
    );
    expect(reply.status).toBe(503);
    expect(await reply.json()).toMatchObject({
      outcome: 'unknown',
      operationId: input.operationId,
    });
    expect(unsafe).toHaveBeenCalledOnce();
    expect(d.close).toHaveBeenCalledOnce();
  });
  it('cannot turn an expired response or clock rollback into an authoritative ack', async () => {
    const d = dependencies(),
      input = retainFixture();
    let time = NOW;
    const original = d.native.unsafe.bind(d.native);
    d.native.unsafe = async (...args) => {
      const result = await original(...args);
      time = NOW + 10001;
      return result;
    };
    const reply = await handleAtmEvidenceRequest(request(input), 'retain', environment(), {
      ...d,
      now: () => time,
    });
    expect(reply.status).toBe(503);
    expect(await reply.json()).toMatchObject({ outcome: 'unknown' });
  });
});
