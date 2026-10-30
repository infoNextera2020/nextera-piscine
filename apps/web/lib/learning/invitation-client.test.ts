import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInvitationClient, type InvitationClientSettings } from './invitation-client';

const token = 'a'.repeat(43); // Non-issued fixture capability; no randomness/provider involved.
const operation = '10000000-0000-4000-8000-000000000001';
const location = { pathname: '/signup', search: '', hash: '#invitation=' + token };
const fields = { password: '  exact bytes\t', confirmation: '  exact bytes\t' };
function fixture(overrides: Partial<InvitationClientSettings> = {}) {
  const replace = vi.fn<(url: '/signup') => void>(() => {});
  const requestId = vi.fn(() => operation);
  const transport = vi.fn<InvitationClientSettings['transport']>(async (path) =>
    path.endsWith('/inspect')
      ? Response.json({
          status: 'valid',
          email: 'accepted@example.test',
          displayName: 'Accepted Learner',
        })
      : Response.json({ status: 'activated' }),
  );
  const settings: InvitationClientSettings = {
    enabled: true,
    transport,
    requestId,
    timeoutMs: 100,
    maxResponseBytes: 2048,
    maxPasswordBytes: 1024,
    ...overrides,
  };
  const client = createInvitationClient(location, replace, settings);
  return { client, replace, requestId, transport, settings };
}
afterEach(() => vi.useRealTimers());

describe('invitation browser lifecycle — fake transport only, no live Auth', () => {
  it('removes the capability before any transport and makes no request on construction', async () => {
    const events: string[] = [];
    const f = fixture();
    const client = createInvitationClient(
      location,
      () => {
        events.push('removed');
      },
      {
        ...f.settings,
        transport: async (path, init) => {
          events.push('transport');
          return f.transport(path, init);
        },
      },
    );
    expect(events).toEqual(['removed']);
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.requestId).not.toHaveBeenCalled();
    expect(client.snapshot()).toEqual({ status: 'unverified' });
    expect(await client.inspect()).toEqual({
      status: 'ready',
      email: 'accepted@example.test',
      displayName: 'Accepted Learner',
    });
    expect(events).toEqual(['removed', 'transport']);
    expect(JSON.stringify(client.snapshot())).not.toContain(token);
  });
  it('stays unavailable without configured bounds/dependencies, while still stripping the URL', async () => {
    const f = fixture();
    for (const settings of [
      null,
      { ...f.settings, enabled: false },
      { ...f.settings, timeoutMs: 0 },
      { ...f.settings, maxResponseBytes: 0 },
      { ...f.settings, maxResponseBytes: 1_048_577 },
      { ...f.settings, maxPasswordBytes: 0 },
    ]) {
      const replace = vi.fn();
      const client = createInvitationClient(location, replace, settings);
      expect(replace).toHaveBeenCalledExactlyOnceWith('/signup');
      expect(await client.inspect()).toEqual({ status: 'unavailable' });
      expect(await client.activate(fields)).toEqual({ status: 'unavailable' });
    }
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.requestId).not.toHaveBeenCalled();
  });
  it('does not transport if URL removal fails or query authority is present', async () => {
    const f = fixture();
    const failed = createInvitationClient(
      location,
      () => {
        throw new Error('private history error');
      },
      f.settings,
    );
    expect(await failed.inspect()).toEqual({ status: 'unavailable' });
    const query = createInvitationClient(
      { ...location, search: '?token=private' },
      () => {},
      f.settings,
    );
    expect(await query.inspect()).toEqual({ status: 'invalid' });
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('uses only fixed same-origin JSON POST targets with redirect/referrer/cache restrictions', async () => {
    const f = fixture();
    await f.client.inspect();
    await f.client.activate(fields);
    expect(f.transport.mock.calls.map(([path]) => path)).toEqual([
      '/api/invitations/inspect',
      '/api/invitations/activate',
    ]);
    for (const [path, init] of f.transport.mock.calls) {
      expect(path).not.toContain(token);
      expect(path).not.toContain(fields.password);
      expect(init).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
    }
    expect(JSON.parse(f.transport.mock.calls[0]![1].body as string)).toEqual({ token });
    expect(JSON.parse(f.transport.mock.calls[1]![1].body as string)).toEqual({
      token,
      requestId: operation,
      ...fields,
    });
  });
  it('does not activate before server inspection or create any local verification authority', async () => {
    const f = fixture();
    expect(await f.client.activate(fields)).toEqual({ status: 'unverified' });
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.requestId).not.toHaveBeenCalled();
  });
  it('single-flights duplicate inspection and keeps snapshots stable until a state update', async () => {
    const f = fixture();
    let release!: (r: Response) => void;
    f.transport.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const original = f.client.snapshot();
    expect(f.client.snapshot()).toBe(original);
    const first = f.client.inspect();
    expect(f.client.snapshot()).toEqual({ status: 'checking' });
    expect(f.client.inspect()).toBe(first);
    await Promise.resolve();
    expect(f.transport).toHaveBeenCalledTimes(1);
    release(
      Response.json({
        status: 'valid',
        email: 'accepted@example.test',
        displayName: 'Accepted Learner',
      }),
    );
    expect(await first).toEqual({
      status: 'ready',
      email: 'accepted@example.test',
      displayName: 'Accepted Learner',
    });
    expect(Object.isFrozen(f.client.snapshot())).toBe(true);
  });
  it('does not open a duplicate request through a reentrant state subscriber', async () => {
    const f = fixture();
    let nested: ReturnType<typeof f.client.inspect> | undefined;
    f.client.subscribe(() => {
      if (f.client.snapshot().status === 'checking') nested = f.client.inspect();
    });
    const first = f.client.inspect();
    expect(nested).toBe(first);
    await first;
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('does not start a request if the view disposes during the checking notification', async () => {
    const f = fixture();
    f.client.subscribe(() => {
      if (f.client.snapshot().status === 'checking') f.client.dispose();
    });
    expect(await f.client.inspect()).toEqual({ status: 'unavailable' });
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('single-flights activation and does not inspect or allocate a second operation while pending', async () => {
    const f = fixture();
    await f.client.inspect();
    let release!: (r: Response) => void;
    f.transport.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = f.client.activate(fields);
    expect(f.client.activate(fields)).toBe(first);
    expect(f.client.inspect()).toBe(first);
    await Promise.resolve();
    expect(f.transport).toHaveBeenCalledTimes(2);
    expect(f.requestId).toHaveBeenCalledTimes(1);
    release(Response.json({ status: 'activated' }));
    expect(await first).toEqual({ status: 'activated' });
    expect(await f.client.activate(fields)).toEqual({ status: 'activated' });
    expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it('keeps one operation ID for an explicit retry after uncertain activation, without automatic retry', async () => {
    const f = fixture();
    await f.client.inspect();
    f.transport.mockRejectedValueOnce(new Error('private provider result lost'));
    expect(await f.client.activate(fields)).toEqual({ status: 'recovery_required' });
    await Promise.resolve();
    expect(f.transport).toHaveBeenCalledTimes(2);
    expect(await f.client.activate(fields)).toEqual({ status: 'activated' });
    const bodies = f.transport.mock.calls
      .slice(1)
      .map(([, init]) => JSON.parse(init.body as string) as { requestId: string });
    expect(bodies.map((b) => b.requestId)).toEqual([operation, operation]);
    expect(f.requestId).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.client.snapshot())).not.toContain('private');
  });
  it('preserves the same operation for explicit in-progress retry', async () => {
    const f = fixture();
    await f.client.inspect();
    f.transport.mockResolvedValueOnce(Response.json({ status: 'in_progress' }, { status: 202 }));
    expect(await f.client.activate(fields)).toEqual({ status: 'in_progress' });
    expect(await f.client.activate(fields)).toEqual({ status: 'activated' });
    expect(f.requestId).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    {},
    { ...fields, email: 'other@example.test' },
    { ...fields, role: 'admin' },
    { ...fields, cohortId: 'other' },
    { ...fields, name: 'changed' },
    { ...fields, confirmation: 'different' },
    { password: '', confirmation: '' },
  ])('rejects invalid input and client authority fields without transport: %j', async (input) => {
    const f = fixture();
    await f.client.inspect();
    expect((await f.client.activate(input)).status).toBe('invalid_input');
    expect(f.client.snapshot().status).toBe('invalid_input');
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.requestId).not.toHaveBeenCalled();
  });
  it('uses the explicit password byte bound, preserving exact bytes without inventing strength policy', async () => {
    const f = fixture({ maxPasswordBytes: 3 });
    await f.client.inspect();
    expect((await f.client.activate({ password: 'éé', confirmation: 'éé' })).status).toBe(
      'invalid_input',
    );
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect((await f.client.activate({ password: ' ', confirmation: ' ' })).status).toBe(
      'activated',
    );
  });
  it('fails closed if injected operation identity is invalid', async () => {
    const f = fixture({ requestId: () => 'not-an-operation-id' });
    await f.client.inspect();
    expect((await f.client.activate(fields)).status).toBe('unavailable');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['invalid', 404],
    ['expired', 410],
    ['used', 409],
    ['existing', 409],
    ['forbidden', 403],
    ['rate_limited', 429],
    ['unavailable', 503],
  ] as const)(
    'projects inspection %s honestly and never adopts an account',
    async (status, code) => {
      const f = fixture();
      f.transport.mockResolvedValueOnce(
        Response.json({ status, email: 'private@example.test', role: 'admin' }, { status: code }),
      );
      expect(await f.client.inspect()).toEqual({ status });
      expect(await f.client.activate(fields)).toEqual({ status });
      expect(f.transport).toHaveBeenCalledTimes(1);
      expect(f.requestId).not.toHaveBeenCalled();
    },
  );
  it('ignores nonallowlisted private response fields even for valid inspection', async () => {
    const f = fixture();
    f.transport.mockResolvedValueOnce(
      Response.json({
        status: 'valid',
        email: 'accepted@example.test',
        displayName: 'Accepted Learner',
        token: 'secret',
        role: 'admin',
        cohortId: 'other',
      }),
    );
    expect(await f.client.inspect()).toEqual({
      status: 'ready',
      email: 'accepted@example.test',
      displayName: 'Accepted Learner',
    });
  });
  it.each([
    () => Response.json({ status: 'activated' }),
    () =>
      Response.json(
        { status: 'valid', email: 'accepted@example.test', displayName: 'Accepted Learner' },
        { status: 403 },
      ),
    () => Response.json({ status: 'valid' }),
    () => Response.json({ status: 'valid', email: 'a'.repeat(321) }),
    () => Response.json({ status: 'valid', email: 'private\n@example.test' }),
    () => new Response('private HTML error', { headers: { 'content-type': 'text/html' } }),
    () =>
      new Response(new Uint8Array([0xff, 0xfe]), {
        headers: { 'content-type': 'application/json' },
      }),
  ])('does not treat malformed or mismatched inspection responses as valid', async (response) => {
    const f = fixture();
    f.transport.mockResolvedValueOnce(response());
    expect(await f.client.inspect()).toEqual({ status: 'unavailable' });
  });
  it('treats malformed activation acknowledgement as uncertain, never as success', async () => {
    const f = fixture();
    await f.client.inspect();
    f.transport.mockResolvedValueOnce(Response.json({ status: 'activated' }, { status: 503 }));
    expect(await f.client.activate(fields)).toEqual({ status: 'recovery_required' });
    expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it('enforces actual response bytes, even without or with understated content-length', async () => {
    for (const headers of [{}, { 'content-length': '1' }]) {
      const f = fixture({ maxResponseBytes: 64 });
      f.transport.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ status: 'valid', email: 'x'.repeat(100) + '@example.test' }),
          { headers: { 'content-type': 'application/json', ...headers } },
        ),
      );
      expect(await f.client.inspect()).toEqual({ status: 'unavailable' });
    }
  });
  it('aborts a stalled transport within the explicit timeout without retry', async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 5 });
    f.transport.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const pending = f.client.inspect();
    await vi.advanceTimersByTimeAsync(6);
    expect(await pending).toEqual({ status: 'unavailable' });
    expect(f.transport.mock.calls[0]![1].signal!.aborted).toBe(true);
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('classifies activation timeout as uncertain and keeps the mounted operation for retry', async () => {
    const f = fixture({ timeoutMs: 5 });
    await f.client.inspect();
    vi.useFakeTimers();
    f.transport.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const pending = f.client.activate(fields);
    await vi.advanceTimersByTimeAsync(6);
    expect(await pending).toEqual({ status: 'recovery_required' });
    expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it('releases a stalled response reader even if cancellation never acknowledges', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream({ cancel });
    const response = new Response(body, { headers: { 'content-type': 'application/json' } });
    const f = fixture({ timeoutMs: 5 });
    f.transport.mockResolvedValueOnce(response);
    vi.useFakeTimers();
    const pending = f.client.inspect();
    await vi.advanceTimersByTimeAsync(6);
    expect(await pending).toEqual({ status: 'unavailable' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body!.locked).toBe(false);
  });
  it('aborts/discards stale inspection completion on dispose and clears subscribers', async () => {
    const f = fixture();
    let release!: (r: Response) => void;
    f.transport.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const statuses: string[] = [];
    f.client.subscribe(() => {
      statuses.push(f.client.snapshot().status);
    });
    const pending = f.client.inspect();
    await Promise.resolve();
    f.client.dispose();
    expect(f.transport.mock.calls[0]![1].signal!.aborted).toBe(true);
    expect(await pending).toEqual({ status: 'unavailable' });
    release(Response.json({ status: 'valid', email: 'private@example.test' }));
    await Promise.resolve();
    expect(f.client.snapshot()).toEqual({ status: 'unavailable' });
    expect(statuses).toEqual(['checking', 'unavailable']);
    expect(await f.client.activate(fields)).toEqual({ status: 'unavailable' });
    expect(await f.client.inspect()).toEqual({ status: 'unavailable' });
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('a fresh mount with the stripped URL has no capability or silent activation recovery', async () => {
    const f = fixture();
    const second = createInvitationClient({ ...location, hash: '' }, () => {}, f.settings);
    expect(await second.inspect()).toEqual({ status: 'missing' });
    expect(await second.activate(fields)).toEqual({ status: 'missing' });
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.requestId).not.toHaveBeenCalled();
  });
  it.each(['different', 'x'.repeat(4096)])(
    'transports only the validated immutable credential snapshot after immediate caller mutation',
    async (changed) => {
      const f = fixture({ maxPasswordBytes: 16 });
      await f.client.inspect();
      const input = { password: 'original', confirmation: 'original' };
      const pending = f.client.activate(input);
      input.password = changed;
      input.confirmation = changed;
      expect(await pending).toEqual({ status: 'activated' });
      expect(JSON.parse(f.transport.mock.calls[1]![1].body as string)).toEqual({
        token,
        requestId: operation,
        password: 'original',
        confirmation: 'original',
      });
    },
  );
  it('reads getter-backed credentials once before validating or deferring work', async () => {
    const f = fixture({ maxPasswordBytes: 16 });
    await f.client.inspect();
    let reads = 0;
    const input = {
      get password() {
        reads++;
        return reads === 1 ? 'original' : 'x'.repeat(4096);
      },
      confirmation: 'original',
    };
    expect(await f.client.activate(input)).toEqual({ status: 'activated' });
    expect(reads).toBe(1);
    expect(JSON.parse(f.transport.mock.calls[1]![1].body as string).password).toBe('original');
  });
  it('disposes once even when a terminal subscriber reenters disposal', () => {
    const f = fixture();
    let notified = 0;
    f.client.subscribe(() => {
      notified++;
      expect(f.client.snapshot()).toEqual({ status: 'unavailable' });
      f.client.dispose();
    });
    f.client.dispose();
    f.client.dispose();
    expect(notified).toBe(1);
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.requestId).not.toHaveBeenCalled();
  });
  it('repeated disposal aborts an active request and notifies terminal state exactly once', async () => {
    const f = fixture();
    const aborted = vi.fn();
    f.transport.mockImplementationOnce(async (_path, init) => {
      void _path;
      init.signal!.addEventListener('abort', aborted);
      return new Promise<Response>(() => {});
    });
    const statuses: string[] = [];
    f.client.subscribe(() => {
      statuses.push(f.client.snapshot().status);
    });
    const pending = f.client.inspect();
    await Promise.resolve();
    f.client.dispose();
    f.client.dispose();
    expect(await pending).toEqual({ status: 'unavailable' });
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['checking', 'unavailable']);
  });
  it('late activation acknowledgement cannot revive a disposed lifecycle', async () => {
    const f = fixture();
    await f.client.inspect();
    let release!: (response: Response) => void;
    f.transport.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const pending = f.client.activate(fields);
    await Promise.resolve();
    f.client.dispose();
    expect(await pending).toEqual({ status: 'unavailable' });
    release(Response.json({ status: 'activated' }));
    await Promise.resolve();
    expect(f.client.snapshot()).toEqual({ status: 'unavailable' });
    expect(await f.client.activate(fields)).toEqual({ status: 'unavailable' });
    expect(f.transport).toHaveBeenCalledTimes(2);
    expect(f.requestId).toHaveBeenCalledTimes(1);
  });
  it.each([
    undefined,
    '',
    '   ',
    'x'.repeat(121),
    'Accepted\nLearner',
    'Accepted' + String.fromCharCode(127),
  ])('rejects an incomplete or out-of-contract accepted name', async (displayName) => {
    const f = fixture();
    f.transport.mockResolvedValueOnce(
      Response.json({ status: 'valid', email: 'accepted@example.test', displayName }),
    );
    expect(await f.client.inspect()).toEqual({ status: 'unavailable' });
    expect(await f.client.activate(fields)).toEqual({ status: 'unavailable' });
    expect(f.requestId).not.toHaveBeenCalled();
  });
  it('preserves exact accepted-name bytes and never sends a client name in activation', async () => {
    const f = fixture();
    f.transport.mockResolvedValueOnce(
      Response.json({
        status: 'valid',
        email: 'accepted@example.test',
        displayName: ' Accepted Learner ',
      }),
    );
    expect(await f.client.inspect()).toEqual({
      status: 'ready',
      email: 'accepted@example.test',
      displayName: ' Accepted Learner ',
    });
    await f.client.activate(fields);
    expect(Object.keys(JSON.parse(f.transport.mock.calls[1]![1].body as string)).sort()).toEqual([
      'confirmation',
      'password',
      'requestId',
      'token',
    ]);
  });
  it('supports unsubscribing without a hidden view callback or request', async () => {
    const f = fixture();
    const listener = vi.fn();
    const unsubscribe = f.client.subscribe(listener);
    unsubscribe();
    await f.client.inspect();
    expect(listener).not.toHaveBeenCalled();
  });
});
