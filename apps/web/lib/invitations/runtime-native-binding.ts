import 'server-only';
import {
  readInvitationRuntimePolicyRows,
  readInvitationRuntimeAuthorityRows,
  consumeInvitationRuntimeIssuer,
  consumeInvitationRuntimeIssueIngress,
} from '@nextera/db/invitation-runtime-readers';
import {
  readNativeInvitationStartupAnchor,
  createNativeInvitationLoader,
} from './runtime-protected-loader';
import { createNativeInvitationClientFactory } from './runtime-native-clients';
import { createNativeInvitationProcessReader } from './runtime-process';
import type { InvitationRuntimeDependencies } from './runtime-configuration-core';

export type NativeInvitationSources = Readonly<{
  startupDigest(): string | undefined;
  platform(): string;
  uid(): number | undefined;
  anchor: typeof readNativeInvitationStartupAnchor;
  loader: typeof createNativeInvitationLoader;
  clients: typeof createNativeInvitationClientFactory;
  processes: typeof createNativeInvitationProcessReader;
  now(): number;
  monotonic(): number;
}>;
const sources: NativeInvitationSources = {
  startupDigest: () => process.env.NEXTERA_WEEK1_INVITATION_STARTUP_SHA256,
  platform: () => process.platform,
  uid: () => process.getuid?.(),
  anchor: readNativeInvitationStartupAnchor,
  loader: createNativeInvitationLoader,
  clients: createNativeInvitationClientFactory,
  processes: createNativeInvitationProcessReader,
  now: () => Date.now(),
  monotonic: () => Number(process.hrtime.bigint() / 1000000n),
};
/** Captures a PUBLIC startup digest once; no file/client at module/factory import. The first
 * configured request verifies the externally pinned protected anchor, never self-derives a hash.
 * A failed startup cannot silently refresh/renew credentials in this process. Settings themselves
 * are NOT cached: existing core reloads control/config/lock and rechecks authority every request.
 */
export function createNativeInvitationDependenciesResolver(s: NativeInvitationSources = sources) {
  const expected = s.startupDigest(),
    platform = s.platform(),
    uid = s.uid();
  const eligible =
    platform === 'linux' &&
    typeof expected === 'string' &&
    /^[a-f0-9]{64}$/.test(expected) &&
    Number.isSafeInteger(uid) &&
    uid! >= 0;
  let captured: Promise<InvitationRuntimeDependencies | null> | undefined;
  return async (): Promise<InvitationRuntimeDependencies | null> => {
    if (!eligible) return null;
    captured ??= Promise.resolve()
      .then(() => {
        const anchor = s.anchor(expected!, uid!);
        const loader = s.loader(anchor);
        if (loader.uid !== uid) throw new Error('INVITATION_NATIVE_UNAVAILABLE');
        const processReader = s.processes(loader.uid, loader.reviewed.lease);
        const acquireClients = s.clients({
          loader,
          now: s.now,
          monotonic: s.monotonic,
          rpc: {
            readInvitationRuntimePolicyRows,
            readInvitationRuntimeAuthorityRows,
            consumeInvitationRuntimeIssuer,
            consumeInvitationRuntimeIssueIngress,
          },
        });
        return Object.freeze({
          uid: loader.uid,
          reviewed: loader.reviewed,
          load: loader.load,
          now: s.now,
          monotonic: s.monotonic,
          process: processReader,
          acquireClients,
        });
      })
      .catch(() => null);
    return captured;
  };
}
