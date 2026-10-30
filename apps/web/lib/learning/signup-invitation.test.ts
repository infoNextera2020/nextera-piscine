import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { InvitationClientSettings, InvitationClientState } from './invitation-client';
import { createSignupInvitationOwner } from '../../components/learning/signup-invitation-owner';
import { SignupInvitation } from '../../components/learning/signup-invitation';
import { InvitationSignup } from '../../components/learning/invitation-signup';

const token = 'a'.repeat(43); // Non-issued fixture capability, never a real invitation.
const fields = { password: ' exact input ', confirmation: ' exact input ' };
const operation = '10000000-0000-4000-8000-000000000001';
function fixture(disabled = false) {
  let location = { pathname: '/signup', search: '', hash: '#invitation=' + token };
  const readLocation = vi.fn(() => ({ ...location }));
  const replaceUrl = vi.fn((path: '/signup') => {
    location = { pathname: path, search: '', hash: '' };
  });
  const requestId = vi.fn(() => operation);
  const transport = vi.fn<InvitationClientSettings['transport']>(async (path) =>
    path.endsWith('/inspect')
      ? Response.json({
          status: 'valid',
          email: 'accepted@example.test',
          displayName: ' Accepted Learner ',
        })
      : Response.json({ status: 'activated' }),
  );
  const settings: InvitationClientSettings = {
    enabled: true,
    timeoutMs: 100,
    maxResponseBytes: 2048,
    maxPasswordBytes: 1024,
    transport,
    requestId,
  };
  const owner = createSignupInvitationOwner({
    readLocation,
    replaceUrl,
    settings: disabled ? null : settings,
  });
  return { owner, readLocation, replaceUrl, requestId, transport, settings };
}
async function mount(f: ReturnType<typeof fixture>) {
  const cleanup = f.owner.mount();
  await Promise.resolve();
  await f.owner.inspect();
  return cleanup;
}

describe('signup mounted ownership — actual client with fake transport, not React browser QA', () => {
  it('does not read or consume a fragment during construction/server snapshot', () => {
    const f = fixture();
    expect(f.owner.serverSnapshot()).toEqual({ client: { status: 'unavailable' } });
    expect(f.owner.snapshot()).toBe(f.owner.serverSnapshot());
    expect(f.readLocation).not.toHaveBeenCalled();
    expect(f.replaceUrl).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('simulates StrictMode effect setup/cleanup replay without consuming the fragment twice', async () => {
    const f = fixture();
    const firstCleanup = f.owner.mount();
    firstCleanup();
    const cleanup = f.owner.mount();
    await Promise.resolve();
    expect(await f.owner.inspect()).toEqual({
      status: 'ready',
      email: 'accepted@example.test',
      displayName: ' Accepted Learner ',
    });
    expect(f.readLocation).toHaveBeenCalledTimes(1);
    expect(f.replaceUrl).toHaveBeenCalledExactlyOnceWith('/signup');
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.requestId).not.toHaveBeenCalled();
    expect(f.owner.snapshot().identity).toEqual({
      email: 'accepted@example.test',
      displayName: ' Accepted Learner ',
    });
    cleanup();
  });
  it('cancelled pre-bootstrap setup performs no browser read or request', async () => {
    const f = fixture();
    const cleanup = f.owner.mount();
    cleanup();
    cleanup();
    await Promise.resolve();
    expect(f.readLocation).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.owner.snapshot().identity).toBeUndefined();
  });
  it('removes the fragment while disabled without transport or falsely verified identity', async () => {
    const f = fixture(true);
    const cleanup = await mount(f);
    expect(f.replaceUrl).toHaveBeenCalledExactlyOnceWith('/signup');
    expect(f.owner.snapshot()).toEqual({ client: { status: 'unavailable' } });
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.requestId).not.toHaveBeenCalled();
    cleanup();
  });
  it('actual activation sends only the ledger-bound protocol fields, not visible identity claims', async () => {
    const f = fixture();
    const cleanup = await mount(f);
    expect(
      (
        await f.owner.activate({
          ...fields,
          displayName: 'Changed',
          email: 'other@example.test',
          cohortId: 'other',
          role: 'admin',
        })
      ).status,
    ).toBe('invalid_input');
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(await f.owner.activate(fields)).toEqual({ status: 'activated' });
    expect(JSON.parse(f.transport.mock.calls[1]![1].body as string)).toEqual({
      token,
      requestId: operation,
      ...fields,
    });
    expect(f.owner.snapshot()).toEqual({ client: { status: 'activated' } });
    cleanup();
  });
  it('retains fixed identity and operation for explicit uncertain retry without automatic new requests', async () => {
    const f = fixture();
    const cleanup = await mount(f);
    f.transport.mockRejectedValueOnce(new Error('private outcome lost'));
    expect(await f.owner.activate(fields)).toEqual({ status: 'recovery_required' });
    expect(f.owner.snapshot().identity?.displayName).toBe(' Accepted Learner ');
    expect(f.transport).toHaveBeenCalledTimes(2);
    expect(await f.owner.activate(fields)).toEqual({ status: 'activated' });
    expect(f.requestId).toHaveBeenCalledTimes(1);
    cleanup();
  });
  it.each([
    ['forbidden', 403],
    ['expired', 410],
    ['used', 409],
    ['existing', 409],
  ] as const)('clears fixed identity after authoritative %s', async (status, code) => {
    const f = fixture();
    const cleanup = await mount(f);
    f.transport.mockResolvedValueOnce(Response.json({ status }, { status: code }));
    expect(await f.owner.activate(fields)).toEqual({ status });
    expect(f.owner.snapshot()).toEqual({ client: { status } });
    cleanup();
  });
  it('unmount aborts owned work and rejects a stale successful inspection', async () => {
    const f = fixture();
    let release!: (response: Response) => void;
    f.transport.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const cleanup = f.owner.mount();
    await Promise.resolve();
    const pending = f.owner.inspect();
    await Promise.resolve();
    cleanup();
    expect(await pending).toEqual({ status: 'unavailable' });
    expect(f.transport.mock.calls[0]![1].signal!.aborted).toBe(true);
    release(
      Response.json({
        status: 'valid',
        email: 'private@example.test',
        displayName: 'Private Name',
      }),
    );
    await Promise.resolve();
    expect(f.owner.snapshot()).toEqual({ client: { status: 'unavailable' } });
  });
  it('a genuine later mount cannot recover a capability from the stripped browser URL', async () => {
    const f = fixture();
    (await mount(f))();
    const cleanup = await mount(f);
    expect(f.owner.snapshot()).toEqual({ client: { status: 'missing' } });
    expect(f.transport).toHaveBeenCalledTimes(1);
    cleanup();
  });
  it('owner notifications can reenter cleanup without leaking an active client', async () => {
    const f = fixture();
    const cleanup = f.owner.mount();
    f.owner.subscribe(() => {
      if (f.owner.snapshot().client.status === 'ready') cleanup();
    });
    await Promise.resolve();
    await f.owner.inspect();
    expect(f.owner.snapshot()).toEqual({ client: { status: 'unavailable' } });
    expect(await f.owner.activate(fields)).toEqual({ status: 'unavailable' });
    expect(f.requestId).not.toHaveBeenCalled();
  });
});

describe('real signup presentation binding — SSR markup only', () => {
  const client: InvitationClientState = {
    status: 'ready',
    email: 'accepted@example.test',
    displayName: ' Accepted Learner ',
  };
  it('renders the exact accepted name and fixed email read-only, without client role/cohort controls', () => {
    const submit = vi.fn(async (): Promise<InvitationClientState> => ({ status: 'activated' }));
    const html = renderToStaticMarkup(
      createElement(InvitationSignup, {
        invitation: { status: 'valid', email: 'accepted@example.test' },
        activation: { acceptedName: ' Accepted Learner ', state: client, submit },
      }),
    );
    const input = html.match(/<input[^>]*id="signup-name"[^>]*>/)?.[0];
    expect(input).toContain('value=" Accepted Learner "');
    expect(input).toContain('readOnly=""');
    expect(html).toContain('Accepted name');
    expect(html).toContain('From your accepted invitation');
    expect(html).toContain('Activation does not sign you in automatically');
    expect(html).not.toContain('name="cohort');
    expect(html).not.toContain('name="role');
    expect(html).not.toContain('no account is created');
    expect(submit).not.toHaveBeenCalled();
  });
  it('keeps the intentionally synthetic review fixture editable and non-activating', () => {
    const html = renderToStaticMarkup(
      createElement(InvitationSignup, {
        invitation: { status: 'valid', email: 'fictional@example.test' },
        reviewOnly: true,
      }),
    );
    expect(html.match(/<input[^>]*id="signup-name"[^>]*>/)?.[0]).not.toContain('readOnly');
    expect(html).toContain('no account is created');
  });
  it('renders no active form or browser-derived identity before the mounted effect', () => {
    for (const policy of [
      null,
      { enabled: true as const, timeoutMs: 100, maxResponseBytes: 2048, maxPasswordBytes: 1024 },
    ]) {
      const html = renderToStaticMarkup(createElement(SignupInvitation, { policy }));
      expect(html).toContain('Open your invitation');
      expect(html).not.toContain('<form');
      expect(html).not.toContain('accepted@example.test');
      expect(html).not.toContain(token);
    }
  });
});
