/** Dependency-injected request-time core. No environment, filesystem, client or process is
 * accessed on import. The native protected loader/client binding is deliberately absent. */
import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import type { InvitationAssemblySettings } from './assembly';
import type { InvitationIssuanceAssemblySettings } from './issuance-assembly';
import type { InvitationSignupPublicPolicy } from './signup-settings';

const ROOT = '/home/anas/.local/share/nextera-judge/week1-auth-20261031-smtp1/run-001';
const PROFILE = 'week1-auth-20261031-smtp1';
const TOKEN = '20261031_smtp1';
/** Public source binding, shared by exact runtime validation and pre-reservation proof. */
export const INVITATION_RUNTIME_SOURCE_BINDING = Object.freeze({
  profile: PROFILE,
  target: Object.freeze({
    root: ROOT,
    project: '01coding-' + PROFILE,
    database: 'foundation_test_week1_auth_' + TOKEN,
    origin: 'http://127.0.0.1:3151',
    authOrigin: 'http://127.0.0.1:56531',
    dbHost: '127.0.0.1',
    dbPort: 56532,
    roles: Object.freeze({
      issuer: 'week1_auth_issuer_' + TOKEN,
      activation: 'week1_auth_activate_' + TOKEN,
      web: 'week1_auth_web_' + TOKEN,
    }),
  }),
});
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const CLOSED_MESSAGES = new Set([
  'Sentinel_7b5ec1bcc1cc819187d19f16ccc96f4a',
  'Sentinel_754d4f4bf350819194caab16f4119f8b',
  'Sentinel_86aebfe913e48191b51fc427a33efe78',
  'Sentinel_6c15d89054c08191b4923a8313c5552b',
]);
type RecordValue = Record<string, unknown>;
type SqlClient = Pick<Sql, 'unsafe'>;
type Stat = Readonly<{ uid: number; mode: number; kind: 'file' | 'directory' | 'symlink' }>;
export type ProtectedFile = Readonly<{ path: string; bytes: Uint8Array; stat: Stat }>;
/** Future native loader must open NOFOLLOW descriptors, fstat/read/fstat the same file,
 * reject replacement/races and enforce byte ceilings before allocation. Metadata supplied
 * by an HTTP caller is never an implementation of this privileged port. */
export type ProtectedInput = Readonly<{
  root: Readonly<{ path: string; stat: Stat }>;
  ancestors: readonly Readonly<{ path: string; stat: Stat }>[];
  configuration: ProtectedFile;
  lease: ProtectedFile;
  sourceLock: ProtectedFile;
}>;
type Rate = Readonly<{
  profile: string;
  windowMs: number;
  maxRequests: number;
  retentionMs: number;
}>;
export type InvitationRuntimePolicy = Readonly<{
  emailConfirmed: boolean;
  passwordContract: 'ascii-synthetic-v1';
  minPasswordBytes: number;
  maxPasswordBytes: number;
  maxTokenBytes: number;
  claimLeaseMs: number;
  maxLifetimeMs: number;
  maxBodyBytes: number;
  bodyTimeoutMs: number;
  publicTimeoutMs: number;
  maxResponseBytes: number;
  publicMaxPasswordBytes: number;
  rates: Readonly<{
    ingress: Rate;
    inspect: Rate;
    activate: Rate;
    issueIngress: Rate;
    issuer: Rate;
  }>;
}>;
export type InvitationRuntimeConfiguration = Readonly<{
  version: 1;
  profile: string;
  scopeSha256: string;
  sourceLockSha256: string;
  reviewedHead: string;
  target: Readonly<{
    root: string;
    project: string;
    database: string;
    origin: string;
    authOrigin: string;
    dbHost: string;
    dbPort: number;
    roles: Readonly<{ issuer: string; activation: string; web: string }>;
  }>;
  issuerId: string;
  cohortId: string;
  curriculumVersionId: string;
  learners: readonly Readonly<{ email: string; displayName: string }>[];
  policy: InvitationRuntimePolicy;
}>;
export type ImmutableInvitationLease = Readonly<{
  ownerMessageId: string;
  ownerApprovedAt: string;
  started: number;
  deadline: number;
  cleanupAt: number;
  monotonicStarted: number;
  monotonicDeadline: number;
  parentPid: number;
  parentTicks: string;
  guardPid: number;
  guardTicks: string;
}>;
export type ReviewedInvitationBinding = Readonly<{
  scopeSha256: string;
  sourceLockSha256: string;
  reviewedHead: string;
  configurationSha256: string;
  lease: ImmutableInvitationLease;
}>;
export type BoundSqlClient = Readonly<{
  client: SqlClient;
  host: string;
  port: number;
  database: string;
  username: string;
}>;
export type InvitationOperationBudget = Readonly<{
  wallCutoffMs: number;
  monotonicCutoffMs: number;
  remainingMs: number;
}>;
export type InvitationRuntimeClients = Readonly<{
  issuer: BoundSqlClient;
  activation: BoundSqlClient;
  web: BoundSqlClient;
  authOrigin: string;
  /** Required native operation boundary: apply absolute cutoffs, bounded driver
   * cancellation/AbortSignal and disposal. Receiving a duration once at pool
   * creation is insufficient. An ambiguous sent mutation stays unknown.
   * This port is unimplemented in production; fake tests do not prove cancellation. */
  runBounded<T>(budget: InvitationOperationBudget, operation: () => Promise<T>): Promise<T>;
  readAuthorityRows(client: SqlClient): Promise<
    readonly {
      issuer_id: string;
      cohort_id: string;
      curriculum_version_id: string;
      issuer_login: string;
      max_lifetime_ms: string;
      enabled: boolean;
    }[]
  >;
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  admin: NonNullable<InvitationAssemblySettings['admin']>;
  consumeIssuer(id: string, rate: Rate): Promise<boolean>;
  consumeIssueIngress(request: Request, rate: Rate): Promise<boolean>;
  capability: NonNullable<InvitationIssuanceAssemblySettings['capability']>;
  /** Raw native policy rows, never a boolean receipt. No current restricted client
   * can SELECT the private table; an independently reviewed narrow native reader
   * remains a real-binding prerequisite. No grant is added by this port. */
  readPolicyRows(client: SqlClient): Promise<
    readonly {
      id: string;
      action: string;
      window_ms: number;
      max_requests: number;
      retention_ms: string;
    }[]
  >;
  /** Called exactly once per acquisition, including failed native readiness checks.
   * Future binding must bound/cancel operations to remainingMs and close every pool.
   * It must never refresh a credential or renew this lease to keep a cache alive. */
  close(): Promise<void>;
}>;
export type InvitationRuntimeDependencies = Readonly<{
  uid: number;
  reviewed: ReviewedInvitationBinding;
  load(): Promise<ProtectedInput>;
  now(): number;
  monotonic(): number;
  process(pid: number): Promise<{ uid: number; ticks: string } | null>;
  /** On rejection, dispose every partially acquired pool/client before throwing.
   * Ownership transfers to the core only when this promise resolves. */
  acquireClients(
    config: InvitationRuntimeConfiguration,
    request: Request,
    remainingMs: number,
  ): Promise<InvitationRuntimeClients>;
}>;
export type AcquiredSettings<T> = Readonly<{ settings: T; close(): Promise<void> }>;

function reject(): never {
  throw new Error('INVITATION_RUNTIME_UNAVAILABLE');
}
function record(value: unknown, keys: readonly string[]): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject();
  const r = value as RecordValue;
  if (Object.keys(r).sort().join() !== [...keys].sort().join()) return reject();
  return r;
}
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function rate(value: unknown): void {
  const r = record(value, ['profile', 'windowMs', 'maxRequests', 'retentionMs']);
  if (
    typeof r.profile !== 'string' ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(r.profile) ||
    !positive(r.windowMs) ||
    !positive(r.maxRequests) ||
    !positive(r.retentionMs) ||
    r.retentionMs < r.windowMs
  )
    reject();
}
function configuration(value: unknown): InvitationRuntimeConfiguration {
  const r = record(value, [
    'version',
    'profile',
    'scopeSha256',
    'sourceLockSha256',
    'reviewedHead',
    'target',
    'issuerId',
    'cohortId',
    'curriculumVersionId',
    'learners',
    'policy',
  ]);
  if (
    r.version !== 1 ||
    r.profile !== INVITATION_RUNTIME_SOURCE_BINDING.profile ||
    ![r.scopeSha256, r.sourceLockSha256].every((v) => typeof v === 'string' && HASH.test(v)) ||
    typeof r.reviewedHead !== 'string' ||
    !/^[a-f0-9]{40}$/.test(r.reviewedHead) ||
    ![r.issuerId, r.cohortId, r.curriculumVersionId].every(
      (v) => typeof v === 'string' && UUID.test(v),
    )
  )
    reject();
  const t = record(r.target, [
    'root',
    'project',
    'database',
    'origin',
    'authOrigin',
    'dbHost',
    'dbPort',
    'roles',
  ]);
  const { roles: expectedRoles, ...expected } = INVITATION_RUNTIME_SOURCE_BINDING.target;
  if (Object.entries(expected).some(([key, v]) => t[key] !== v)) reject();
  const roles = record(t.roles, ['issuer', 'activation', 'web']);
  if (
    roles.issuer !== expectedRoles.issuer ||
    roles.activation !== expectedRoles.activation ||
    roles.web !== expectedRoles.web
  )
    reject();
  if (!Array.isArray(r.learners) || r.learners.length !== 2) reject();
  for (const [i, v] of r.learners.entries()) {
    const learner = record(v, ['email', 'displayName']);
    if (
      learner.email !==
        'week1-' + (i === 0 ? 'a' : 'b') + '-20261030-invitation1@example.invalid' ||
      learner.displayName !== 'Week 1 Synthetic Learner ' + (i === 0 ? 'A' : 'B')
    )
      reject();
  }
  const p = record(r.policy, [
    'emailConfirmed',
    'passwordContract',
    'minPasswordBytes',
    'maxPasswordBytes',
    'maxTokenBytes',
    'claimLeaseMs',
    'maxLifetimeMs',
    'maxBodyBytes',
    'bodyTimeoutMs',
    'publicTimeoutMs',
    'maxResponseBytes',
    'publicMaxPasswordBytes',
    'rates',
  ]);
  if (
    typeof p.emailConfirmed !== 'boolean' ||
    p.passwordContract !== 'ascii-synthetic-v1' ||
    ![
      'minPasswordBytes',
      'maxPasswordBytes',
      'maxTokenBytes',
      'claimLeaseMs',
      'maxLifetimeMs',
      'maxBodyBytes',
      'bodyTimeoutMs',
      'publicTimeoutMs',
      'maxResponseBytes',
      'publicMaxPasswordBytes',
    ].every((key) => positive(p[key]))
  )
    reject();
  const policy = p as unknown as InvitationRuntimePolicy;
  if (
    policy.minPasswordBytes > policy.maxPasswordBytes ||
    policy.maxTokenBytes !== 43 ||
    policy.maxPasswordBytes !== policy.publicMaxPasswordBytes ||
    policy.claimLeaseMs >= policy.maxLifetimeMs ||
    policy.maxLifetimeMs > 3600000 ||
    policy.maxBodyBytes > 1048576 ||
    policy.maxResponseBytes > 1048576 ||
    policy.maxBodyBytes < 138 + 12 * policy.maxPasswordBytes
  )
    reject();
  const rates = record(p.rates, ['ingress', 'inspect', 'activate', 'issueIngress', 'issuer']);
  Object.values(rates).forEach(rate);
  if (new Set(Object.values(rates).map((v) => (v as Rate).profile)).size !== 5) reject();
  return r as unknown as InvitationRuntimeConfiguration;
}
function ownerMicroseconds(value: string): bigint {
  const match =
    /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,6}))?(?:Z|\+00:00)$/.exec(
      value,
    );
  if (!match) return reject();
  const seconds = Date.parse(match[1] + 'Z');
  if (!Number.isSafeInteger(seconds) || new Date(seconds).toISOString().slice(0, 19) !== match[1])
    return reject();
  return BigInt(seconds) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0'));
}
function readJson(file: ProtectedFile, path: string, uid: number): unknown {
  if (
    file.path !== path ||
    file.stat.uid !== uid ||
    file.stat.kind !== 'file' ||
    file.stat.mode !== 0o600 ||
    file.bytes.length === 0 ||
    file.bytes.length > 65536
  )
    reject();
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
  } catch {
    return reject();
  }
}
const ANCESTORS = [
  ...ROOT.split('/')
    .slice(1, -1)
    .map((_, i, a) => '/' + a.slice(0, i + 1).join('/')),
  ROOT + '/adapter-code',
];
/** Source guard only. Native FS/process ports and independently reviewed binding must be supplied. */
export async function validateInvitationRuntimeInput(
  input: ProtectedInput,
  d: InvitationRuntimeDependencies,
): Promise<InvitationRuntimeConfiguration> {
  if (
    !Number.isSafeInteger(d.uid) ||
    d.uid < 0 ||
    input.root.path !== ROOT ||
    input.root.stat.kind !== 'directory' ||
    input.root.stat.mode !== 0o700 ||
    input.root.stat.uid !== d.uid ||
    input.ancestors.length !== ANCESTORS.length ||
    input.ancestors.some(
      (a, i) =>
        a.path !== ANCESTORS[i] ||
        a.stat.kind !== 'directory' ||
        (a.path.startsWith(ROOT + '/') && (a.stat.uid !== d.uid || a.stat.mode !== 0o700)),
    )
  )
    reject();
  const c = configuration(
    readJson(input.configuration, ROOT + '/server-configuration.json', d.uid),
  );
  const reviewed = d.reviewed;
  if (
    !HASH.test(reviewed.configurationSha256) ||
    digest(input.configuration.bytes) !== reviewed.configurationSha256 ||
    c.scopeSha256 !== reviewed.scopeSha256 ||
    c.sourceLockSha256 !== reviewed.sourceLockSha256 ||
    c.reviewedHead !== reviewed.reviewedHead
  )
    reject();
  readJson(input.sourceLock, ROOT + '/adapter-code/week1-auth-source-lock.json', d.uid);
  if (digest(input.sourceLock.bytes) !== reviewed.sourceLockSha256) reject();
  const l = record(readJson(input.lease, ROOT + '/control.json', d.uid), [
    'profile',
    'scopeSha256',
    'configurationSha256',
    'sourceLockSha256',
    'reviewedHead',
    'state',
    'phase',
    ...Object.keys(reviewed.lease),
  ]);
  if (
    l.profile !== PROFILE ||
    l.scopeSha256 !== reviewed.scopeSha256 ||
    l.configurationSha256 !== reviewed.configurationSha256 ||
    l.sourceLockSha256 !== reviewed.sourceLockSha256 ||
    l.reviewedHead !== reviewed.reviewedHead ||
    l.state !== 'active' ||
    l.phase !== 'invitations_active' ||
    Object.entries(reviewed.lease).some(([key, v]) => !equal(l[key], v))
  )
    reject();
  const b = reviewed.lease;
  if (
    !/^Sentinel_[a-f0-9]{32}$/.test(b.ownerMessageId) ||
    CLOSED_MESSAGES.has(b.ownerMessageId) ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)$/.test(
      b.ownerApprovedAt,
    ) ||
    ![b.started, b.deadline, b.cleanupAt, b.monotonicStarted, b.monotonicDeadline].every(
      Number.isSafeInteger,
    ) ||
    b.deadline - b.started !== 3600000 ||
    b.cleanupAt !== b.deadline - 180000 ||
    b.monotonicDeadline - b.monotonicStarted !== 3600000
  )
    reject();
  const approved = ownerMicroseconds(b.ownerApprovedAt),
    now = d.now(),
    mono = d.monotonic();
  // Admission is checked against original start, not renewed or reapplied to later requests.
  if (
    BigInt(b.started) * 1000n < approved ||
    BigInt(b.started) * 1000n - approved > 600000000n ||
    !Number.isFinite(now) ||
    !Number.isFinite(mono) ||
    now < b.started ||
    now >= b.cleanupAt ||
    mono < b.monotonicStarted ||
    mono >= b.monotonicDeadline - 180000 ||
    ![b.parentPid, b.guardPid].every(positive) ||
    b.parentPid === b.guardPid ||
    ![b.parentTicks, b.guardTicks].every((v) => /^[0-9]+$/.test(v))
  )
    reject();
  for (const [pid, ticks] of [
    [b.parentPid, b.parentTicks],
    [b.guardPid, b.guardTicks],
  ] as const) {
    const process = await d.process(pid);
    if (!process || process.uid !== d.uid || process.ticks !== ticks) reject();
  }
  // The native identity reads may have taken time; do not authorize a later
  // operation with the clock sampled before those awaited reads.
  const wallAfter = d.now(),
    monoAfter = d.monotonic();
  if (
    !Number.isFinite(wallAfter) ||
    !Number.isFinite(monoAfter) ||
    wallAfter < b.started ||
    wallAfter >= b.cleanupAt ||
    monoAfter < b.monotonicStarted ||
    monoAfter >= b.monotonicDeadline - 180000
  )
    reject();
  return c;
}
const PROBE = `SELECT current_database()::text AS database,current_user::text AS login,
 session_user::text AS session_login,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication,
 ARRAY(SELECT parent.rolname::text FROM pg_catalog.pg_auth_members m
 JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid ORDER BY parent.rolname) AS memberships,
 pg_catalog.pg_has_role(current_user,'nextera_invitation_owner','MEMBER') AS invitation_owner,
 pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','MEMBER') AS checkpoint_owner
 FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;
async function probe(
  client: SqlClient,
  c: InvitationRuntimeConfiguration,
  key: 'issuer' | 'activation' | 'web',
) {
  const rows = await client.unsafe(PROBE);
  const row = rows[0] as RecordValue | undefined;
  const membership = {
    issuer: 'nextera_invitation_issuer',
    activation: 'nextera_invitation_runtime',
    web: 'nextera_web',
  }[key];
  if (
    rows.length !== 1 ||
    !row ||
    row.database !== c.target.database ||
    row.login !== c.target.roles[key] ||
    row.session_login !== row.login ||
    [
      'rolsuper',
      'rolbypassrls',
      'rolcreatedb',
      'rolcreaterole',
      'rolreplication',
      'invitation_owner',
      'checkpoint_owner',
    ].some((k) => row[k] !== false) ||
    !equal(row.memberships, [membership])
  )
    reject();
}
export function createInvitationRequestConfiguration(
  dependencies: InvitationRuntimeDependencies | null,
) {
  // Copy the independent immutable anchors once; a loader cannot renew them by
  // changing the JSON object originally supplied by its caller.
  const d = dependencies
    ? { ...dependencies, reviewed: structuredClone(dependencies.reviewed) }
    : null;
  async function checked() {
    if (!d) return reject();
    const c = await validateInvitationRuntimeInput(await d.load(), d);
    return { c, d };
  }
  async function acquire(request: Request) {
    const { c, d } = await checked();
    if (new URL(request.url).origin !== c.target.origin) reject();
    const remaining = Math.min(
      d.reviewed.lease.cleanupAt - d.now(),
      d.reviewed.lease.monotonicDeadline - 180000 - d.monotonic(),
    );
    if (!Number.isFinite(remaining) || remaining <= 0) reject();
    const clients = await d.acquireClients(c, request, remaining);
    let closed = false;
    const close = async () => {
      if (!closed) {
        closed = true;
        try {
          await clients.close();
        } catch {
          reject();
        }
      }
    };
    const guard = async () => {
      const current = await checked();
      if (
        closed ||
        digest(new TextEncoder().encode(JSON.stringify(current.c))) !==
          digest(new TextEncoder().encode(JSON.stringify(c)))
      )
        reject();
    };
    const run = async <T>(operation: () => Promise<T>): Promise<T> => {
      await guard();
      const budget = Object.freeze({
        wallCutoffMs: d.reviewed.lease.cleanupAt,
        monotonicCutoffMs: d.reviewed.lease.monotonicDeadline - 180000,
        remainingMs: Math.min(
          d.reviewed.lease.cleanupAt - d.now(),
          d.reviewed.lease.monotonicDeadline - 180000 - d.monotonic(),
        ),
      });
      if (!Number.isFinite(budget.remainingMs) || budget.remainingMs <= 0) reject();
      let result: T;
      try {
        result = await clients.runBounded(budget, async () => {
          // Native queue/setup may await before dispatch; check at actual invocation.
          await guard();
          return operation();
        });
      } catch {
        return reject();
      }
      // A late reply is not success. This cannot undo a sent native mutation:
      // adapters must preserve unknown outcome and the future broker must reconcile it.
      await guard();
      return result;
    };
    try {
      await guard();
      const bound = [clients.issuer, clients.activation, clients.web];
      if (
        new Set(bound.map((v) => v.client)).size !== 3 ||
        clients.authOrigin !== c.target.authOrigin
      )
        reject();
      for (const key of ['issuer', 'activation', 'web'] as const) {
        const b = clients[key];
        if (
          b.host !== c.target.dbHost ||
          b.port !== c.target.dbPort ||
          b.database !== c.target.database ||
          b.username !== c.target.roles[key]
        )
          reject();
        await guard();
        await run(() => probe(b.client, c, key));
      }
      await guard();
      const ready = await run(async () =>
        clients.activation.client.unsafe(
          'SELECT app.invitation_operations_ready() AS operations, app.invitation_admission_ready($1::boolean) AS admission',
          [c.policy.emailConfirmed],
        ),
      );
      if (ready.length !== 1 || ready[0]?.operations !== true || ready[0]?.admission !== true)
        reject();
      await guard();
      const authority = await run(() => clients.readAuthorityRows(clients.issuer.client));
      if (
        !equal(authority, [
          {
            issuer_id: c.issuerId,
            cohort_id: c.cohortId,
            curriculum_version_id: c.curriculumVersionId,
            issuer_login: c.target.roles.issuer,
            max_lifetime_ms: String(c.policy.maxLifetimeMs),
            enabled: true,
          },
        ])
      )
        reject();
      const profiles = await run(() => clients.readPolicyRows(clients.activation.client));
      const expected = (['ingress', 'inspect', 'activate'] as const)
        .map((action) => ({
          id: c.policy.rates[action].profile,
          action,
          window_ms: c.policy.rates[action].windowMs,
          max_requests: c.policy.rates[action].maxRequests,
          retention_ms: String(c.policy.rates[action].retentionMs),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      if (
        !equal(
          profiles
            .map((r) => ({ ...r, retention_ms: String(r.retention_ms) }))
            .sort((a, b) => a.id.localeCompare(b.id)),
          expected,
        )
      )
        reject();
      await guard();
      const client = (key: 'issuer' | 'activation' | 'web'): SqlClient =>
        ({
          unsafe: async (sql: string, params: never[] = []) => {
            await guard();
            if (key === 'issuer' && sql.includes('app.invitation_issue(')) {
              const p = params as unknown[];
              const learner = c.learners.find((l) => l.email === p[4]);
              if (
                !learner ||
                learner.displayName !== p[5] ||
                p[2] !== c.issuerId ||
                p[6] !== c.cohortId ||
                Number(p[7]) > d.reviewed.lease.cleanupAt
              )
                reject();
            }
            const rows = await run(async () => clients[key].client.unsafe(sql, params));
            if (key === 'activation') {
              const records: RecordValue[] = [];
              if (sql.includes('app.invitation_find(') || sql.includes('app.invitation_advance('))
                records.push(...(rows as unknown as RecordValue[]));
              if (sql.includes('app.invitation_claim('))
                for (const row of rows) {
                  const result = row.result as RecordValue | undefined;
                  if (result?.claim_state === 'acquired')
                    records.push(result.record as RecordValue);
                }
              for (const row of records) {
                const learner = c.learners.find((l) => l.email === row?.email);
                if (
                  !row ||
                  !learner ||
                  row.display_name !== learner.displayName ||
                  row.cohort_id !== c.cohortId ||
                  row.accepted_admission_id !== row.id
                )
                  reject();
              }
            }
            return rows;
          },
        }) as SqlClient;
      return { c, clients, guard, run, close, client };
    } catch {
      await close();
      return reject();
    }
  }
  return {
    async activation(
      request: Request,
    ): Promise<AcquiredSettings<InvitationAssemblySettings> | null> {
      let opened: Awaited<ReturnType<typeof acquire>> | undefined;
      try {
        opened = await acquire(request);
        const { c, clients, guard, run, close, client } = opened,
          p = c.policy;
        const acceptsPassword = async (password: string) => {
          await guard();
          const bytes = new TextEncoder().encode(password).byteLength;
          return (
            bytes >= p.minPasswordBytes &&
            bytes <= p.maxPasswordBytes &&
            /^[A-Za-z0-9!#%+,.=@^_~-]+$/.test(password)
          );
        };
        const settings: InvitationAssemblySettings = {
          enabled: true,
          now: () => d!.now(),
          admission: {
            enabled: true,
            client: client('activation'),
            policy: {
              authorityContract: 'nextera-invitation-admission-v1',
              emailConfirmed: p.emailConfirmed,
              rateProfiles: {
                ingress: p.rates.ingress.profile,
                inspect: p.rates.inspect.profile,
                activate: p.rates.activate.profile,
              },
            },
          },
          policy: {
            enabled: true,
            maxTokenBytes: p.maxTokenBytes,
            maxPasswordBytes: p.maxPasswordBytes,
            claimLeaseMs: p.claimLeaseMs,
            acceptsPassword,
          },
          admin: {
            createUser: async (...args) => {
              await guard();
              return run(() => clients.admin.createUser(...args));
            },
            getUserById: async (...args) => {
              await guard();
              return run(() => clients.admin.getUserById(...args));
            },
          },
          http: {
            enabled: true,
            allowedOrigins: [c.target.origin],
            maxBodyBytes: p.maxBodyBytes,
            bodyTimeoutMs: p.bodyTimeoutMs,
            callerKey: async () => {
              await guard();
              return digest(new TextEncoder().encode(PROFILE));
            },
          },
        };
        return { settings, close };
      } catch {
        if (opened) await opened.close();
        return null;
      }
    },
    async issuance(
      request: Request,
    ): Promise<AcquiredSettings<InvitationIssuanceAssemblySettings> | null> {
      let opened: Awaited<ReturnType<typeof acquire>> | undefined;
      try {
        opened = await acquire(request);
        const { c, clients, guard, run, close, client } = opened;
        const settings: InvitationIssuanceAssemblySettings = {
          enabled: true,
          client: client('issuer'),
          now: () => d!.now(),
          identity: async () => {
            await guard();
            const authenticated = await run(() => clients.auth.getUser());
            await guard();
            if (
              authenticated.error ||
              !authenticated.data.user ||
              !UUID.test(authenticated.data.user.id)
            )
              return null;
            // Same verified-user -> current domain-record flow as requireDomainUser,
            // explicitly bound to this fresh web client rather than ambient getDatabase().
            const rows = await client('web').unsafe(
              'SELECT id::text,auth_user_id::text,role::text,active FROM app.users WHERE auth_user_id=$1::uuid LIMIT 1',
              [authenticated.data.user.id] as never[],
            );
            await guard();
            const row = rows[0];
            return rows.length === 1 &&
              row?.id === c.issuerId &&
              row.auth_user_id === authenticated.data.user.id &&
              row.role === 'admin' &&
              row.active === true
              ? { id: c.issuerId, role: 'admin', active: true }
              : null;
          },
          rate: {
            consume: async (id) => {
              await guard();
              return run(() => clients.consumeIssuer(id, c.policy.rates.issuer));
            },
          },
          policy: {
            ownerIds: [c.issuerId],
            maxLifetimeMs: c.policy.maxLifetimeMs,
            signupOrigin: c.target.origin,
          },
          canonicalEmail: (email) => (c.learners.some((l) => l.email === email) ? email : null),
          capability: async () => {
            await guard();
            return run(() => clients.capability());
          },
          http: {
            enabled: true,
            allowedOrigins: [c.target.origin],
            maxBodyBytes: c.policy.maxBodyBytes,
            bodyTimeoutMs: c.policy.bodyTimeoutMs,
            ingress: {
              consume: async (req) => {
                await guard();
                return run(() => clients.consumeIssueIngress(req, c.policy.rates.issueIngress));
              },
            },
          },
        };
        return { settings, close };
      } catch {
        if (opened) await opened.close();
        return null;
      }
    },
    async publicPolicy(): Promise<InvitationSignupPublicPolicy | null> {
      try {
        const { c } = await checked();
        return Object.freeze({
          enabled: true,
          timeoutMs: c.policy.publicTimeoutMs,
          maxResponseBytes: c.policy.maxResponseBytes,
          maxPasswordBytes: c.policy.maxPasswordBytes,
        });
      } catch {
        return null;
      }
    },
  };
}
