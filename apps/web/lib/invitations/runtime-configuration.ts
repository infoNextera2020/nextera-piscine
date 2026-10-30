import 'server-only';
import { createInvitationRequestConfiguration } from './runtime-configuration-core';
import { createNativeInvitationDependenciesResolver } from './runtime-native-binding';

// Reads only a public startup digest at construction. No file, credential or client opens here.
// Missing/invalid configuration remains unavailable; a future approved broker must supply the
// protected externally pinned anchor. Every request reloads and validates its active lease.
const nativeDependencies = createNativeInvitationDependenciesResolver();

export async function getInvitationActivationSettings(request: Request) {
  return createInvitationRequestConfiguration(await nativeDependencies()).activation(request);
}
export async function getInvitationIssuanceSettings(request: Request) {
  return createInvitationRequestConfiguration(await nativeDependencies()).issuance(request);
}
export async function getInvitationSignupPublicPolicy() {
  return createInvitationRequestConfiguration(await nativeDependencies()).publicPolicy();
}
