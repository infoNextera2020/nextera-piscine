import type { Sql } from 'postgres';

export type InvitationRuntimeSqlClient = Pick<Sql, 'unsafe'>;
export type InvitationRuntimeReaderBinding = Readonly<{
  profile: string;
  publicPolicySha256: string;
  issuerId: string;
  cohortId: string;
  curriculumVersionId: string;
}>;
export type InvitationRuntimeRate = Readonly<{
  profile: string;
  windowMs: number;
  maxRequests: number;
  retentionMs: number;
}>;
export type InvitationRuntimePolicyRow = Readonly<{
  id: string;
  action: string;
  window_ms: number;
  max_requests: number;
  retention_ms: string;
}>;
export type InvitationRuntimeAuthorityRow = Readonly<{
  issuer_id: string;
  cohort_id: string;
  curriculum_version_id: string;
  issuer_login: string;
  max_lifetime_ms: string;
  enabled: boolean;
}>;
export class InvitationRuntimeReaderError extends Error {
  constructor() {
    super('INVITATION_RUNTIME_READER_UNAVAILABLE');
  }
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const profile = /^[a-z][a-z0-9-]{0,99}$/;
const rateId = /^[a-z][a-z0-9_-]{0,63}$/;
const login = /^[a-z][a-z0-9_]{0,62}$/;
function fail(): never {
  throw new InvitationRuntimeReaderError();
}
function data(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value),
    keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== names.length ||
    !names.every((name) => Object.hasOwn(descriptors, name)) ||
    keys.some((name) => typeof name !== 'string' || !Object.hasOwn(descriptors[name]!, 'value'))
  )
    return fail();
  return Object.fromEntries(names.map((name) => [name, descriptors[name]!.value]));
}
function positive(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647
  );
}
function decimal(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 9007199254740991n
  );
}
function binding(value: InvitationRuntimeReaderBinding) {
  const b = data(value, [
    'profile',
    'publicPolicySha256',
    'issuerId',
    'cohortId',
    'curriculumVersionId',
  ]);
  if (
    typeof b.profile !== 'string' ||
    !profile.test(b.profile) ||
    typeof b.publicPolicySha256 !== 'string' ||
    !hash.test(b.publicPolicySha256) ||
    !['issuerId', 'cohortId', 'curriculumVersionId'].every(
      (name) => typeof b[name] === 'string' && uuid.test(b[name] as string),
    )
  )
    return fail();
  return Object.freeze({
    profile: b.profile,
    publicPolicySha256: b.publicPolicySha256,
    issuerId: b.issuerId as string,
    cohortId: b.cohortId as string,
    curriculumVersionId: b.curriculumVersionId as string,
  });
}
function rate(value: InvitationRuntimeRate) {
  const r = data(value, ['profile', 'windowMs', 'maxRequests', 'retentionMs']);
  if (
    typeof r.profile !== 'string' ||
    !rateId.test(r.profile) ||
    !positive(r.windowMs) ||
    !positive(r.maxRequests) ||
    !positive(r.retentionMs) ||
    r.retentionMs < r.windowMs
  )
    return fail();
  return Object.freeze({
    profile: r.profile,
    windowMs: r.windowMs,
    maxRequests: r.maxRequests,
    retentionMs: r.retentionMs,
  });
}
const params = (b: InvitationRuntimeReaderBinding) => [
  b.profile,
  b.publicPolicySha256,
  b.issuerId,
  b.cohortId,
  b.curriculumVersionId,
];
export const INVITATION_RUNTIME_POLICY_ROWS_SQL =
  'SELECT id,action,window_ms,max_requests,retention_ms FROM app.invitation_runtime_policy_rows($1,$2,$3::uuid,$4::uuid,$5::uuid)';
export const INVITATION_RUNTIME_AUTHORITY_ROWS_SQL =
  'SELECT issuer_id::text,cohort_id::text,curriculum_version_id::text,issuer_login,max_lifetime_ms,enabled FROM app.invitation_runtime_authority_rows($1,$2,$3::uuid,$4::uuid,$5::uuid)';
export const INVITATION_RUNTIME_LIMIT_CONSUME_SQL =
  'SELECT profile_id,action,operation_id::text,allowed,replayed,window_number FROM app.invitation_runtime_limit_consume($1,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9::integer,$10::integer,$11::bigint)';

/** Existing injected client only; no construction, connection, configuration, secret or default. */
export async function readInvitationRuntimePolicyRows(
  client: InvitationRuntimeSqlClient,
  value: InvitationRuntimeReaderBinding,
): Promise<readonly InvitationRuntimePolicyRow[]> {
  const b = binding(value);
  const rows = await client.unsafe(INVITATION_RUNTIME_POLICY_ROWS_SQL, params(b) as never[]);
  if (!Array.isArray(rows) || rows.length !== 3) return fail();
  const actions = new Set<string>(),
    ids = new Set<string>();
  const result = rows.map((value) => {
    const r = data(value, ['id', 'action', 'window_ms', 'max_requests', 'retention_ms']);
    if (
      typeof r.id !== 'string' ||
      !rateId.test(r.id) ||
      typeof r.action !== 'string' ||
      !['ingress', 'inspect', 'activate'].includes(r.action) ||
      !positive(r.window_ms) ||
      !positive(r.max_requests) ||
      !decimal(r.retention_ms) ||
      BigInt(r.retention_ms) < BigInt(r.window_ms) ||
      BigInt(r.retention_ms) > 2147483647n ||
      ids.has(r.id) ||
      actions.has(r.action)
    )
      return fail();
    ids.add(r.id);
    actions.add(r.action);
    return Object.freeze({
      id: r.id,
      action: r.action,
      window_ms: r.window_ms,
      max_requests: r.max_requests,
      retention_ms: r.retention_ms,
    });
  });
  return Object.freeze(result);
}
export async function readInvitationRuntimeAuthorityRows(
  client: InvitationRuntimeSqlClient,
  value: InvitationRuntimeReaderBinding,
): Promise<readonly InvitationRuntimeAuthorityRow[]> {
  const b = binding(value);
  const rows = await client.unsafe(INVITATION_RUNTIME_AUTHORITY_ROWS_SQL, params(b) as never[]);
  if (!Array.isArray(rows) || rows.length !== 1) return fail();
  const r = data(rows[0], [
    'issuer_id',
    'cohort_id',
    'curriculum_version_id',
    'issuer_login',
    'max_lifetime_ms',
    'enabled',
  ]);
  if (
    r.issuer_id !== b.issuerId ||
    r.cohort_id !== b.cohortId ||
    r.curriculum_version_id !== b.curriculumVersionId ||
    typeof r.issuer_login !== 'string' ||
    !login.test(r.issuer_login) ||
    !decimal(r.max_lifetime_ms) ||
    BigInt(r.max_lifetime_ms) > 3600000n ||
    r.enabled !== true
  )
    return fail();
  return Object.freeze([
    Object.freeze({
      issuer_id: b.issuerId,
      cohort_id: b.cohortId,
      curriculum_version_id: b.curriculumVersionId,
      issuer_login: r.issuer_login,
      max_lifetime_ms: r.max_lifetime_ms,
      enabled: true,
    }),
  ]);
}
async function consume(
  client: InvitationRuntimeSqlClient,
  value: InvitationRuntimeReaderBinding,
  operationId: string,
  action: 'issuer' | 'issue_ingress',
  requestedRate: InvitationRuntimeRate,
): Promise<boolean> {
  // Snapshot before native I/O. The native boundary generates this nonce once per incoming
  // request, before parsing. Never use a browser requestId, cache settings, or retry ambiguity.
  const b = binding(value),
    r = rate(requestedRate),
    operation = operationId;
  if (typeof operation !== 'string' || !uuid.test(operation)) return fail();
  const rows = await client.unsafe(INVITATION_RUNTIME_LIMIT_CONSUME_SQL, [
    ...params(b),
    operation,
    action,
    r.profile,
    r.windowMs,
    r.maxRequests,
    r.retentionMs,
  ] as never[]);
  if (!Array.isArray(rows) || rows.length !== 1) return fail();
  const reply = data(rows[0], [
    'profile_id',
    'action',
    'operation_id',
    'allowed',
    'replayed',
    'window_number',
  ]);
  if (
    reply.profile_id !== r.profile ||
    reply.action !== action ||
    reply.operation_id !== operation ||
    typeof reply.allowed !== 'boolean' ||
    typeof reply.replayed !== 'boolean' ||
    typeof reply.window_number !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(reply.window_number) ||
    BigInt(reply.window_number) > 9007199254740991n
  )
    return fail();
  return reply.allowed;
}
/** Limiter acceptance is not issuance authorization. invitation_issue rechecks authority itself. */
export async function consumeInvitationRuntimeIssuer(
  client: InvitationRuntimeSqlClient,
  value: InvitationRuntimeReaderBinding,
  operationId: string,
  issuerId: string,
  requestedRate: InvitationRuntimeRate,
) {
  const b = binding(value);
  if (issuerId !== b.issuerId) return fail();
  return consume(client, b, operationId, 'issuer', requestedRate);
}
export async function consumeInvitationRuntimeIssueIngress(
  client: InvitationRuntimeSqlClient,
  value: InvitationRuntimeReaderBinding,
  operationId: string,
  requestedRate: InvitationRuntimeRate,
) {
  return consume(client, value, operationId, 'issue_ingress', requestedRate);
}
