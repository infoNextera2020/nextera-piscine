import { describe, expect, it, vi } from 'vitest';
import { createInvitationActivationHandler, type InvitationHttpSettings } from './http';
import type { Outcome } from './activation';
const caller = 'a'.repeat(64);
const input = {
  token: 'private-token',
  password: 'exact bytes',
  confirmation: 'exact bytes',
  requestId: '10000000-0000-4000-8000-000000000001',
};
function request(
  body: BodyInit = JSON.stringify(input),
  headers: Record<string, string> = {},
  url = 'http://localhost:3118/api/invitations/activate',
) {
  return new Request(url, {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3118',
      host: 'localhost:3118',
      'content-type': 'application/json',
      ...headers,
    },
    body,
    duplex: 'half',
  } as RequestInit);
}
function fixture() {
  const activate = vi.fn(async (form: unknown, key: string): Promise<Outcome> => {
    void form;
    void key;
    return { status: 'activated' };
  });
  const consume = vi.fn(async (key: string) => {
    void key;
    return true;
  });
  const callerKey = vi.fn(async (r: Request) => {
    void r;
    return caller;
  });
  const config: InvitationHttpSettings = {
    enabled: true,
    allowedOrigins: ['http://localhost:3118'],
    maxBodyBytes: 2000,
    bodyTimeoutMs: 100,
    callerKey,
    ingress: { consume },
    activation: { activate },
  };
  return { config, activate, consume, callerKey, POST: createInvitationActivationHandler(config) };
}
describe('bounded invitation activation HTTP boundary', () => {
  it('stays 503 without any required explicit dependency or bounds', async () => {
    const f = fixture();
    for (const config of [
      null,
      { ...f.config, ingress: null },
      { ...f.config, activation: null },
      { ...f.config, allowedOrigins: [] },
      { ...f.config, allowedOrigins: ['*'] },
      { ...f.config, maxBodyBytes: 0 },
      { ...f.config, bodyTimeoutMs: 0 },
      { ...f.config, enabled: false },
    ]) {
      expect((await createInvitationActivationHandler(config)(request())).status).toBe(503);
    }
    expect(f.consume).not.toHaveBeenCalled();
    expect(f.activate).not.toHaveBeenCalled();
  });
  it('rejects an unsafe allocation configuration rather than silently choosing a policy bound', async () => {
    const f = fixture();
    const result = await createInvitationActivationHandler({
      ...f.config,
      maxBodyBytes: 1_048_577,
    })(request());
    expect(result.status).toBe(503);
    expect(f.consume).not.toHaveBeenCalled();
    expect(f.activate).not.toHaveBeenCalled();
  });
  it('preserves exact bytes/request ID and strips optional private fields from response', async () => {
    const f = fixture();
    f.activate.mockResolvedValue({ status: 'activated', email: 'private@example.test' });
    const result = await f.POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: 'activated' });
    expect(f.activate).toHaveBeenCalledWith(input, caller);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it.each([
    { origin: 'https://evil.test', host: 'localhost:3118' },
    { origin: '', host: 'localhost:3118' },
    { origin: 'http://localhost:3118', host: 'evil.test' },
  ])('rejects untrusted origins/hosts before side effects: %j', async (headers) => {
    const f = fixture();
    expect((await f.POST(request(undefined, headers))).status).toBe(403);
    expect(f.consume).not.toHaveBeenCalled();
    expect(f.activate).not.toHaveBeenCalled();
  });
  it('requires exact configured origin in addition to same-origin, and rejects query secrets', async () => {
    const f = fixture();
    expect(
      (
        await createInvitationActivationHandler({
          ...f.config,
          allowedOrigins: ['https://other.test'],
        })(request())
      ).status,
    ).toBe(403);
    expect(
      (
        await f.POST(
          request(undefined, {}, 'http://localhost:3118/api/invitations/activate?token=private'),
        )
      ).status,
    ).toBe(403);
  });
  it('never trusts forwarded caller headers or invents a caller when resolver is unavailable', async () => {
    const f = fixture();
    f.callerKey.mockResolvedValue(null as never);
    expect((await f.POST(request(undefined, { 'x-forwarded-for': '192.0.2.1' }))).status).toBe(503);
    expect(f.consume).not.toHaveBeenCalled();
  });
  it('applies ingress budget before JSON parsing or expensive password work', async () => {
    const f = fixture();
    f.consume.mockResolvedValue(false);
    expect((await f.POST(request('not json'))).status).toBe(429);
    expect(f.activate).not.toHaveBeenCalled();
    expect((await fixture().POST(request('not json'))).status).toBe(400);
  });
  it('bounds actual UTF8 bytes even with missing or understated content-length', async () => {
    const f = fixture(),
      POST = createInvitationActivationHandler({ ...f.config, maxBodyBytes: 8 });
    expect((await POST(request('"éééé"', { 'content-length': '1' }))).status).toBe(413);
    expect((await POST(request('{}', { 'content-length': '10000' }))).status).toBe(413);
    expect(f.activate).not.toHaveBeenCalled();
  });
  it('rejects invalid UTF8, compressed and non-JSON request bodies', async () => {
    const f = fixture();
    expect((await f.POST(request(new Uint8Array([0xff, 0xfe])))).status).toBe(400);
    expect((await f.POST(request('{}', { 'content-encoding': 'gzip' }))).status).toBe(415);
    expect((await f.POST(request('{}', { 'content-type': 'text/plain' }))).status).toBe(415);
    expect(f.activate).not.toHaveBeenCalled();
  });
  it('bounds stalled streams and never calls activation after read timeout', async () => {
    const f = fixture();
    const stream = new ReadableStream({
      start() {
        /* deliberately pending */
      },
    });
    const result = await createInvitationActivationHandler({ ...f.config, bodyTimeoutMs: 5 })(
      request(stream),
    );
    expect(result.status).toBe(408);
    expect(f.activate).not.toHaveBeenCalled();
  });
  it('releases body locks across repeated timeouts even when cancellation never acknowledges', async () => {
    const f = fixture();
    for (let attempt = 0; attempt < 3; attempt++) {
      const cancel = vi.fn(
        () =>
          new Promise<void>(() => {
            /* untrusted pending acknowledgement */
          }),
      );
      const body = new ReadableStream({ cancel });
      const pending = request(body);
      const response = await createInvitationActivationHandler({ ...f.config, bodyTimeoutMs: 5 })(
        pending,
      );
      expect(response.status).toBe(408);
      expect(cancel).toHaveBeenCalledOnce();
      expect(pending.body!.locked).toBe(false);
    }
    expect(f.activate).not.toHaveBeenCalled();
  });
  it('sanitizes stream errors and releases its lock', async () => {
    const f = fixture();
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error('private transport failure'));
      },
    });
    const pending = request(body);
    const response = await f.POST(pending);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
    expect(pending.body!.locked).toBe(false);
    expect(f.activate).not.toHaveBeenCalled();
  });
  it('handles cancellation rejection without retaining the lock or changing timeout outcome', async () => {
    const f = fixture();
    const body = new ReadableStream({
      cancel: () => Promise.reject(new Error('private cancellation failure')),
    });
    const pending = request(body);
    const response = await createInvitationActivationHandler({ ...f.config, bodyTimeoutMs: 5 })(
      pending,
    );
    expect(response.status).toBe(408);
    expect(pending.body!.locked).toBe(false);
    expect(f.activate).not.toHaveBeenCalled();
  });
  it.each([
    ['in_progress', 202],
    ['expired', 410],
    ['invalid', 404],
    ['used', 409],
    ['existing', 409],
    ['forbidden', 403],
    ['invalid_input', 422],
    ['password_rejected', 422],
    ['rate_limited', 429],
    ['recovery_required', 503],
    ['unavailable', 503],
    ['valid', 503],
  ] as const)('maps %s without false activation', async (status, code) => {
    const f = fixture();
    f.activate.mockResolvedValue({ status });
    const result = await f.POST(request());
    expect(result.status).toBe(code);
    expect(await result.json()).toEqual({ status: status === 'valid' ? 'unavailable' : status });
  });
  it('returns generic unavailable for transport/storage/provider exceptions', async () => {
    const f = fixture();
    f.activate.mockRejectedValue(new Error('secret provider or DSN'));
    const response = await f.POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });
});
