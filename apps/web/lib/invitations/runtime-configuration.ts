import 'server-only';
import { createInvitationRequestConfiguration } from './runtime-configuration-core';

/** No native protected loader/client binding is approved or installed.
 * Routes call these getters on EVERY request. Missing bindings always return null;
 * an environment JSON value cannot enable them. No file/client/secret is accessed.
 * A separately reviewed native binding must replace this null dependency, preserve
 * descriptor-based protected loading, independent source/lease anchors and bounded
 * client disposal, and supply narrow native policy/issuer-cohort-version readers without new grants. */
export async function getInvitationActivationSettings(request: Request) {
  return createInvitationRequestConfiguration(null).activation(request);
}
export async function getInvitationIssuanceSettings(request: Request) {
  return createInvitationRequestConfiguration(null).issuance(request);
}
export async function getInvitationSignupPublicPolicy() {
  return createInvitationRequestConfiguration(null).publicPolicy();
}
