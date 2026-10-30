import { describe, expect, it, vi } from 'vitest';
import type { Outcome } from './activation';
import {
  createInvitationInspectionHandler,
  type InvitationInspectionHttpSettings,
} from './inspection-http';

const token = 'a'.repeat(43); // Synthetic non-issued fixture bytes.
const caller = 'b'.repeat(64);
const origin = 'http://localhost:3118';
function request(
  body: BodyInit = JSON.stringify({ token }),
  headers: Record<string, string> = {},
  url = origin + '/api/invitations/inspect',
) {
  return new Request(url, {
    method: 'POST',
    headers: { origin, host: 'localhost:3118', 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as RequestInit);
}
function fixture() {
  const inspect = vi.fn(async (_token: unknown, _caller: string): Promise<Outcome> => {
    void _token;
    void _caller;
    return { status: 'valid', email: 'accepted@example.test' };
  });
  const consume = vi.fn(async (_caller: string) => {
    void _caller;
    return true;
  });
  const callerKey = vi.fn(async (_request: Request): Promise<string | null> => {
    void _request;
    return caller;
  });
  const settings: InvitationInspectionHttpSettings = {
    enabled: true,
    allowedOrigins: [origin],
    maxBodyBytes: 1024,
    bodyTimeoutMs: 100,
    callerKey,
    ingress: { consume },
    inspection: { inspect },
  };
  return {
    settings,
    inspect,
    consume,
    callerKey,
    POST: createInvitationInspectionHandler(settings),
  };
}

describe('invitation inspection HTTP — injected source boundary only', () => {
  it('stays unavailable when any required capability or explicit bound is missing', async () => {
    const f = fixture();
    for (const settings of [
      null,
      { ...f.settings, enabled: false },
      { ...f.settings, inspection: null },
      { ...f.settings, ingress: null },
      { ...f.settings, allowedOrigins: [] },
      { ...f.settings, allowedOrigins: ['*'] },
      { ...f.settings, maxBodyBytes: 0 },
      { ...f.settings, maxBodyBytes: 1_048_577 },
      { ...f.settings, bodyTimeoutMs: 0 },
      { ...f.settings, bodyTimeoutMs: Number.NaN },
    ]) {
      expect((await createInvitationInspectionHandler(settings)(request())).status).toBe(503);
    }
    expect(f.consume).not.toHaveBeenCalled();
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it('returns only the capability-authorized fixed email and never a cookie or capability', async () => {
    const f = fixture();
    const result = await f.POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: 'valid', email: 'accepted@example.test' });
    expect(f.inspect).toHaveBeenCalledExactlyOnceWith(token, caller);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
    expect(result.headers.get('set-cookie')).toBeNull();
  });
  it.each([{ origin: 'https://evil.test' }, { host: 'evil.test' }, { origin: '' }])(
    'rejects origin or host mismatch before lookup: %j',
    async (headers) => {
      const f = fixture();
      expect((await f.POST(request(undefined, headers))).status).toBe(403);
      expect(f.consume).not.toHaveBeenCalled();
      expect(f.inspect).not.toHaveBeenCalled();
    },
  );
  it('requires the exact configured origin and forbids all query strings', async () => {
    const f = fixture();
    expect(
      (
        await createInvitationInspectionHandler({
          ...f.settings,
          allowedOrigins: ['https://other.test'],
        })(request())
      ).status,
    ).toBe(403);
    expect(
      (await f.POST(request(undefined, {}, origin + '/api/invitations/inspect?token=private')))
        .status,
    ).toBe(403);
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it('never substitutes forwarded values for a missing trusted caller', async () => {
    const f = fixture();
    f.callerKey.mockResolvedValue(null);
    expect((await f.POST(request(undefined, { 'x-forwarded-for': '192.0.2.1' }))).status).toBe(503);
    expect(f.consume).not.toHaveBeenCalled();
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it('uses ingress budget before reading malformed JSON or inspecting a token', async () => {
    const f = fixture();
    f.consume.mockResolvedValue(false);
    expect((await f.POST(request('not json'))).status).toBe(429);
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    {},
    { token: token + 'x' },
    { token: '%' + token.slice(1) },
    { token, email: 'other@example.test' },
    { token, role: 'admin' },
    { token, cohortId: 'other' },
    { token, displayName: 'changed' },
  ])('rejects malformed or authority-bearing input: %j', async (input) => {
    const f = fixture();
    expect((await f.POST(request(JSON.stringify(input)))).status).toBe(422);
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it('bounds bytes and rejects invalid UTF8, encoding and non-JSON content', async () => {
    const f = fixture();
    expect((await f.POST(request('{}', { 'content-length': '99999' }))).status).toBe(413);
    expect((await f.POST(request('x'.repeat(1025), { 'content-length': '1' }))).status).toBe(413);
    expect((await f.POST(request(new Uint8Array([0xff, 0xfe])))).status).toBe(400);
    expect((await f.POST(request('{}', { 'content-encoding': 'gzip' }))).status).toBe(415);
    expect((await f.POST(request('{}', { 'content-type': 'text/plain' }))).status).toBe(415);
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it('rejects unsupported methods without lookup', async () => {
    const f = fixture();
    const response = await f.POST(
      new Request(origin + '/api/invitations/inspect', { method: 'GET' }),
    );
    expect(response.status).toBe(405);
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it('times out stalled bodies and releases the reader without lookup', async () => {
    const f = fixture();
    const body = new ReadableStream({ cancel: () => new Promise<void>(() => {}) });
    const pending = request(body);
    const response = await createInvitationInspectionHandler({ ...f.settings, bodyTimeoutMs: 5 })(
      pending,
    );
    expect(response.status).toBe(408);
    expect(pending.body!.locked).toBe(false);
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it.each([
    ['invalid', 404],
    ['expired', 410],
    ['used', 409],
    ['existing', 409],
    ['forbidden', 403],
    ['invalid_input', 422],
    ['rate_limited', 429],
    ['unavailable', 503],
  ] as const)('maps %s without leaking an optional email', async (status, code) => {
    const f = fixture();
    f.inspect.mockResolvedValue({ status, email: 'private@example.test' });
    const response = await f.POST(request());
    expect(response.status).toBe(code);
    expect(await response.json()).toEqual({ status });
  });
  it.each(['activated', 'in_progress', 'password_rejected', 'recovery_required'] as const)(
    'never mistakes %s for valid inspection',
    async (status) => {
      const f = fixture();
      f.inspect.mockResolvedValue({ status, email: 'private@example.test' });
      const response = await f.POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: 'unavailable' });
    },
  );
  it.each([undefined, '', 'a'.repeat(321), 'private\n@example.test'])(
    'rejects broken valid identity %j',
    async (email) => {
      const f = fixture();
      f.inspect.mockResolvedValue(
        email === undefined ? { status: 'valid' } : { status: 'valid', email },
      );
      const response = await f.POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: 'unavailable' });
    },
  );
  it('does not leak private transport errors', async () => {
    const f = fixture();
    f.inspect.mockRejectedValue(new Error('private token and storage DSN'));
    const response = await f.POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
  });
});
