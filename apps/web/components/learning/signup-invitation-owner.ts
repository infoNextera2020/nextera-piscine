import {
  createInvitationClient,
  type InvitationClientSettings,
  type InvitationClientState,
} from '../../lib/learning/invitation-client';
import type { InvitationLocation } from '../../lib/learning/invitation-fragment';

export type AcceptedInvitationIdentity = Readonly<{ email: string; displayName: string }>;
export type SignupInvitationSnapshot = Readonly<{
  client: InvitationClientState;
  identity?: AcceptedInvitationIdentity;
}>;
const EMPTY: SignupInvitationSnapshot = Object.freeze({
  client: Object.freeze({ status: 'unavailable' }),
});
const terminal = new Set<InvitationClientState['status']>([
  'invalid',
  'expired',
  'used',
  'existing',
  'forbidden',
  'activated',
  'missing',
]);

/**
 * A single component's effect ownership, with no browser globals or work during construction.
 * The deferred first setup can be cancelled by React StrictMode's synchronous effect replay before
 * it reads/consumes the fragment. A genuine unmount disposes the client and its in-memory capability.
 */
export function createSignupInvitationOwner(
  dependencies: Readonly<{
    readLocation(): InvitationLocation;
    replaceUrl(safeRelativeUrl: '/signup'): void;
    settings: InvitationClientSettings | null;
  }>,
) {
  let epoch = 0;
  let active: number | null = null;
  let client: ReturnType<typeof createInvitationClient> | null = null;
  let unsubscribe: (() => void) | null = null;
  let identity: AcceptedInvitationIdentity | undefined;
  let state = EMPTY;
  const listeners = new Set<() => void>();
  const snapshot = () => state;
  function publish(next: SignupInvitationSnapshot) {
    state = Object.freeze(next);
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* View callbacks cannot change identity or create requests. */
      }
    }
  }
  function synchronize(mine: number, owned: ReturnType<typeof createInvitationClient>) {
    if (active !== mine || client !== owned) return;
    const current = owned.snapshot();
    if (current.status === 'ready' && current.email && current.displayName) {
      identity = Object.freeze({ email: current.email, displayName: current.displayName });
    } else if (terminal.has(current.status)) identity = undefined;
    publish(identity ? { client: current, identity } : { client: current });
  }
  return {
    snapshot,
    serverSnapshot: () => EMPTY,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount() {
      if (active !== null) return () => undefined;
      const mine = ++epoch;
      active = mine;
      let closed = false;
      queueMicrotask(() => {
        if (closed || active !== mine) return;
        try {
          const owned = createInvitationClient(
            dependencies.readLocation(),
            dependencies.replaceUrl,
            dependencies.settings,
          );
          if (closed || active !== mine) {
            owned.dispose();
            return;
          }
          client = owned;
          unsubscribe = owned.subscribe(() => synchronize(mine, owned));
          synchronize(mine, owned);
          void owned.inspect().catch(() => {
            if (active === mine && client === owned) {
              identity = undefined;
              publish(EMPTY);
            }
          });
        } catch {
          identity = undefined;
          publish(EMPTY);
        }
      });
      return () => {
        if (closed) return;
        closed = true;
        if (active !== mine) return;
        active = null;
        const owned = client;
        client = null;
        unsubscribe?.();
        unsubscribe = null;
        identity = undefined;
        owned?.dispose();
        publish(EMPTY);
      };
    },
    inspect() {
      return client ? client.inspect() : Promise.resolve(state.client);
    },
    activate(input: unknown) {
      return client ? client.activate(input) : Promise.resolve(state.client);
    },
  };
}
