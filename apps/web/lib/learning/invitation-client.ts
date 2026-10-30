import { consumeInvitationFragment, type InvitationLocation } from './invitation-fragment';

export type InvitationClientStatus =
  | 'missing'
  | 'unverified'
  | 'checking'
  | 'ready'
  | 'activating'
  | 'activated'
  | 'in_progress'
  | 'invalid'
  | 'expired'
  | 'used'
  | 'existing'
  | 'unavailable'
  | 'rate_limited'
  | 'forbidden'
  | 'invalid_input'
  | 'password_rejected'
  | 'recovery_required';
export type InvitationClientState = Readonly<{ status: InvitationClientStatus; email?: string }>;
type Endpoint = '/api/invitations/inspect' | '/api/invitations/activate';
export type InvitationClientSettings = Readonly<{
  enabled: boolean;
  /** Inject a trusted same-origin browser transport. No provider client or credential belongs here. */
  transport(path: Endpoint, init: RequestInit): Promise<Response>;
  /** Independent UUID for one mounted activation operation; never a new ID on uncertain retry. */
  requestId(): string;
  timeoutMs: number;
  maxResponseBytes: number;
  /** Input allocation bound supplied by the reviewed server policy, not a new strength policy. */
  maxPasswordBytes: number;
}>;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const inspectCodes = {
  valid: [200],
  invalid: [404],
  expired: [410],
  used: [409],
  existing: [409],
  unavailable: [503],
  rate_limited: [429],
  forbidden: [403],
  invalid_input: [400, 405, 408, 413, 415, 422],
} as const;
const activateCodes = {
  activated: [200],
  in_progress: [202],
  invalid: [404],
  expired: [410],
  used: [409],
  existing: [409],
  unavailable: [503],
  rate_limited: [429],
  forbidden: [403],
  invalid_input: [400, 405, 408, 413, 415, 422],
  password_rejected: [422],
  recovery_required: [503],
} as const;
const validEmail = (value: unknown): value is string =>
  typeof value === 'string' &&
  !!value &&
  value.length <= 320 &&
  !/\s/.test(value) &&
  ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

async function boundedResponse(response: Response, maxBytes: number, interrupted: Promise<never>) {
  function reject() {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('Unusable response.');
  }
  if (
    response.redirected ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      response.headers.get('content-type') ?? '',
    ) ||
    !response.body
  )
    return reject();
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    (!/^[0-9]+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maxBytes)
  )
    return reject();
  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await Promise.race([reader.read(), interrupted]);
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) throw new Error('Unusable response.');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } finally {
    // A hostile stream cannot make cancellation acknowledgement retain this reader's lock.
    try {
      void reader.cancel().catch(() => undefined);
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * Source-only mounted signup lifecycle: no browser globals, storage, randomness or requests on
 * construction. Raw capability remains inside this closure after URL removal. Dispose on leaving
 * signup. Reload requires reopening the original link; it cannot silently adopt an old activation.
 */
export function createInvitationClient(
  location: InvitationLocation,
  replaceUrl: (safeRelativeUrl: '/signup') => void,
  settings: InvitationClientSettings | null,
) {
  // Strip the fragment even when runtime is unavailable, before any possible transport.
  const fragment = consumeInvitationFragment(location, replaceUrl);
  let token = fragment.status === 'ready' ? fragment.token : null;
  let email: string | null = null;
  let operationId: string | null = null;
  let live = true;
  let controller: AbortController | null = null;
  let pending: Promise<InvitationClientState> | null = null;
  const listeners = new Set<() => void>();
  const configured = !!(
    settings?.enabled &&
    typeof settings.transport === 'function' &&
    typeof settings.requestId === 'function' &&
    settings.maxResponseBytes <= 1_048_576 &&
    [settings.timeoutMs, settings.maxResponseBytes, settings.maxPasswordBytes].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647,
    )
  );
  let state: InvitationClientState = Object.freeze(
    configured
      ? fragment.status === 'ready'
        ? { status: 'unverified' }
        : { status: fragment.status }
      : { status: 'unavailable' },
  );
  const snapshot = () => state;
  function update(next: InvitationClientState) {
    state = Object.freeze({ ...next });
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* A view callback cannot turn a request into another operation. */
      }
    }
  }
  async function request(path: Endpoint, input: unknown): Promise<InvitationClientState> {
    const abort = new AbortController();
    controller = abort;
    let rejectAbort: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error('Request interrupted.'));
    });
    abort.signal.addEventListener('abort', rejectAbort!, { once: true });
    const timer = setTimeout(() => abort.abort(), settings!.timeoutMs);
    try {
      const response = await Promise.race([
        settings!.transport(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          body: JSON.stringify(input),
          signal: abort.signal,
        }),
        interrupted,
      ]);
      const data = await boundedResponse(response, settings!.maxResponseBytes, interrupted);
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('Unusable response.');
      const form = data as Record<string, unknown>;
      const codes: Readonly<Record<string, readonly number[]>> = path.endsWith('/inspect')
        ? inspectCodes
        : activateCodes;
      if (
        typeof form.status !== 'string' ||
        !Object.hasOwn(codes, form.status) ||
        !codes[form.status]!.includes(response.status)
      )
        throw new Error('Unusable response.');
      if (form.status === 'valid') {
        if (!validEmail(form.email)) throw new Error('Unusable response.');
        return { status: 'ready', email: form.email };
      }
      // Never copy token, provider errors, role, cohort or arbitrary response fields into UI state.
      return { status: form.status as InvitationClientStatus };
    } finally {
      clearTimeout(timer);
      abort.signal.removeEventListener('abort', rejectAbort!);
      if (controller === abort) controller = null;
    }
  }
  function flight(status: 'checking' | 'activating', work: () => Promise<InvitationClientState>) {
    if (pending) return pending;
    if (!live || !configured || !token) return Promise.resolve(snapshot());
    // Install the single-flight promise before notifying a possibly reentrant view callback.
    pending = Promise.resolve()
      .then(() => (live ? work() : snapshot()))
      .then((result) => {
        if (live) update(result);
        return snapshot();
      })
      .finally(() => {
        pending = null;
      });
    update(email && status === 'activating' ? { status, email } : { status });
    return pending;
  }
  return {
    snapshot,
    subscribe(listener: () => void) {
      if (!live) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    inspect() {
      return flight('checking', async () => {
        try {
          const result = await request('/api/invitations/inspect', { token });
          if (live) email = result.status === 'ready' ? result.email! : null;
          return result;
        } catch {
          return { status: 'unavailable' };
        }
      });
    },
    activate(input: unknown) {
      if (pending) return pending;
      if (!live || !configured || !token || !email) return Promise.resolve(snapshot());
      const invalid = () => {
        update({ status: 'invalid_input', email: email! });
        return Promise.resolve(snapshot());
      };
      if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
      const form = input as Record<string, unknown>;
      // Read caller-owned properties once. Neither deferred work nor view callbacks may reread
      // mutable/getter-backed fields after validation or change the bytes sent to the server.
      const password = form.password;
      const confirmation = form.confirmation;
      if (
        Object.keys(form).sort().join(',') !== 'confirmation,password' ||
        typeof password !== 'string' ||
        !password ||
        typeof confirmation !== 'string' ||
        new TextEncoder().encode(password).byteLength > settings!.maxPasswordBytes ||
        password !== confirmation
      )
        return invalid();
      const credentials = Object.freeze({ password, confirmation });
      return flight('activating', async () => {
        let mayHaveSent = false;
        try {
          operationId ??= settings!.requestId();
          if (!UUID.test(operationId)) return { status: 'unavailable' };
          mayHaveSent = true;
          const result = await request('/api/invitations/activate', {
            token,
            requestId: operationId,
            ...credentials,
          });
          if (live && result.status === 'activated') {
            token = null;
            email = null;
            operationId = null;
          }
          return result;
        } catch {
          return { status: mayHaveSent ? 'recovery_required' : 'unavailable' };
        }
      });
    },
    dispose() {
      if (!live) return;
      // Be terminal before either abort handlers or view callbacks can reenter this client.
      live = false;
      token = null;
      email = null;
      operationId = null;
      state = Object.freeze({ status: 'unavailable' });
      const detached = [...listeners];
      listeners.clear();
      const active = controller;
      controller = null;
      active?.abort();
      for (const listener of detached) {
        try {
          listener();
        } catch {
          /* Disposal remains terminal even if a view callback fails. */
        }
      }
    },
  };
}
