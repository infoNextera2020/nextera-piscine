vi.mock('server-only', () => ({}));
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createManualInvitationIssuer,
  type IssueScope,
  type ManualInvitationSettings,
} from './issuance';
import { createPostgresInvitationIssuer } from './issuance-postgres';
import { createInvitationIssuanceAssembly } from './issuance-assembly';
import { POST as productionPost } from '../../app/api/invitations/issue/route';
import { readFileSync } from 'node:fs';

const owner = '10000000-0000-4000-8000-000000000001';
const cohort = '20000000-0000-4000-8000-000000000001';
const invitation = '30000000-0000-4000-8000-000000000001';
const requestId = '40000000-0000-4000-8000-000000000001';
const version = '50000000-0000-4000-8000-000000000001';
// Fixed synthetic fixture bytes. No CSPRNG, real invitation, provider or database in this suite.
const token = 'T'.repeat(43);
const form = () => ({
  requestId,
  cohortId: cohort,
  email: 'learner@example.test',
  displayName: 'Learner',
  expiresAt: 2000,
});
function fixture() {
  const issue = vi.fn(async (scope: IssueScope) => ({
    kind: 'issued' as const,
    ...scope,
    curriculumVersionId: version,
  }));
  const settings: ManualInvitationSettings = {
    enabled: true,
    repository: { issue },
    identity: vi.fn(async () => ({ id: owner, active: true, role: 'admin' })),
    rate: { consume: vi.fn(async () => true) },
    policy: { ownerIds: [owner], maxLifetimeMs: 2000, signupOrigin: 'http://localhost:3150' },
    canonicalEmail: (email) => (/^[^@\s]+@[^@\s]+$/.test(email) ? email.toLowerCase() : null),
    capability: vi.fn(async () => ({ invitationId: invitation, token })),
    now: () => 1000,
  };
  return { settings, issue, service: createManualInvitationIssuer(settings) };
}
describe('manual invitation issuance source contract', () => {
  it.each([
    'repository',
    'identity',
    'rate',
    'policy',
    'canonicalEmail',
    'capability',
    'now',
  ] as const)('requires explicit %s with no side effects', async (key) => {
    const f = fixture();
    expect(
      await createManualInvitationIssuer({ ...f.settings, [key]: null }).issue(form()),
    ).toEqual({ status: 'unavailable' });
    expect(f.issue).not.toHaveBeenCalled();
    expect(f.settings.capability).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { id: owner, active: false, role: 'admin' },
    { id: owner, active: true, role: 'learner' },
    { id: cohort, active: true, role: 'admin' },
  ])('denies a non-owner identity %j', async (identity) => {
    const f = fixture();
    vi.mocked(f.settings.identity!).mockResolvedValue(identity);
    expect(await f.service.issue(form())).toEqual({ status: 'forbidden' });
    expect(f.issue).not.toHaveBeenCalled();
    expect(f.settings.capability).not.toHaveBeenCalled();
  });
  it.each([
    { role: 'admin' },
    { issuerId: owner },
    { admissionId: invitation },
    { token },
    { curriculumVersionId: version },
  ])('rejects authority/capability injection %j', async (extra) => {
    const f = fixture();
    expect(await f.service.issue({ ...form(), ...extra })).toEqual({ status: 'invalid_input' });
    expect(f.issue).not.toHaveBeenCalled();
  });
  it.each([
    { expiresAt: 1000 },
    { expiresAt: 3001 },
    { expiresAt: NaN },
    { expiresAt: 2000.5 },
    { cohortId: 'bad' },
    { requestId: 'bad' },
    { email: 'bad' },
    { email: 'a\nb@example.test' },
    { displayName: ' ' },
  ])('rejects invalid scope %j', async (patch) => {
    const f = fixture();
    expect(await f.service.issue({ ...form(), ...patch })).toEqual({ status: 'invalid_input' });
    expect(f.issue).not.toHaveBeenCalled();
  });
  it('returns only a one-time fragment link after an exact durable scope acknowledgement', async () => {
    const f = fixture();
    expect(f.issue).not.toHaveBeenCalled();
    const result = await f.service.issue(form());
    expect(result).toEqual({
      status: 'issued',
      link: `http://localhost:3150/signup#invitation=${token}`,
      expiresAt: 2000,
    });
    const stored = f.issue.mock.calls[0]![0];
    expect(stored.tokenDigest).toBe(createHash('sha256').update(token).digest('hex'));
    expect(stored).toMatchObject({
      issuerId: owner,
      invitationId: invitation,
      email: form().email,
      cohortId: cohort,
    });
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored).not.toHaveProperty('role');
  });
  it('requires the configured canonical provider email and does not accept caller identity changes', async () => {
    const f = fixture();
    await f.service.issue({ ...form(), email: 'Learner@Example.test' });
    expect(f.issue.mock.calls[0]![0].email).toBe('learner@example.test');
  });
  it('does not adopt a mutable caller owner allowlist after construction', async () => {
    const f = fixture();
    (f.settings.policy!.ownerIds as string[]).push(cohort);
    vi.mocked(f.settings.identity!).mockResolvedValue({ id: cohort, active: true, role: 'admin' });
    expect(await f.service.issue(form())).toEqual({ status: 'forbidden' });
  });
  it('respects the explicit issuer rate decision before generating capabilities', async () => {
    const f = fixture();
    vi.mocked(f.settings.rate!.consume).mockResolvedValue(false);
    expect(await f.service.issue(form())).toEqual({ status: 'rate_limited' });
    expect(f.settings.capability).not.toHaveBeenCalled();
  });
  it('does not return or rotate a token after a lost acknowledgement or same-request replay', async () => {
    const f = fixture();
    f.issue.mockRejectedValueOnce(new Error('private provider/password/token detail'));
    expect(await f.service.issue(form())).toEqual({ status: 'uncertain' });
    f.issue.mockResolvedValueOnce({ kind: 'already_issued' } as never);
    expect(await f.service.issue(form())).toEqual({ status: 'already_issued' });
    expect(f.issue).toHaveBeenCalledTimes(2);
  });
  it.each(['email', 'cohortId', 'issuerId', 'tokenDigest', 'expiresAt', 'requestId'] as const)(
    'rejects mismatched committed receipt %s without capability disclosure',
    async (key) => {
      const f = fixture();
      f.issue.mockImplementationOnce(async (scope) => ({
        kind: 'issued',
        ...scope,
        [key]: key === 'expiresAt' ? 2001 : 'different',
        curriculumVersionId: version,
      }));
      expect(await f.service.issue(form())).toEqual({ status: 'uncertain' });
    },
  );
  it.each(['already_issued', 'conflict', 'forbidden', 'unknown'] as const)(
    'returns allowlisted repository result %s without a link',
    async (kind) => {
      const f = fixture();
      f.issue.mockResolvedValueOnce({ kind } as never);
      expect(await f.service.issue(form())).toEqual({
        status: kind === 'unknown' ? 'uncertain' : kind,
      });
    },
  );
});
function request(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3150/api/invitations/issue', {
    method: 'POST',
    headers: {
      host: 'localhost:3150',
      origin: 'http://localhost:3150',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ ...form(), ...extra }),
  });
}
describe('private issuance repository and HTTP assembly', () => {
  function assembly() {
    const f = fixture();
    const unsafe = vi.fn(async (_sql: string, values: unknown[]) => [
      {
        result: {
          kind: 'issued',
          invitation_id: values[0],
          request_id: values[1],
          issuer_id: values[2],
          token_digest: values[3],
          email: values[4],
          display_name: values[5],
          cohort_id: values[6],
          expires_at_ms: values[7],
          curriculum_version_id: version,
        },
      },
    ]);
    const ingress = { consume: vi.fn(async () => true) };
    const settings = {
      ...f.settings,
      client: { unsafe } as never,
      http: {
        enabled: true,
        allowedOrigins: ['http://localhost:3150'],
        maxBodyBytes: 4096,
        bodyTimeoutMs: 100,
        ingress,
      },
    };
    return {
      ...f,
      unsafe,
      ingress,
      settings,
      POST: createInvitationIssuanceAssembly(settings).POST,
    };
  }
  it('production endpoint remains503 and source construction does not query', async () => {
    const f = assembly();
    expect(f.unsafe).not.toHaveBeenCalled();
    expect(await (await productionPost(request())).json()).toEqual({ status: 'unavailable' });
  });
  it('uses one parameterized atomic SQL capability, never a raw token/password or automatic email', async () => {
    const f = assembly(),
      response = await f.POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      status: 'issued',
      link: `http://localhost:3150/signup#invitation=${token}`,
      expiresAt: 2000,
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(f.unsafe).toHaveBeenCalledTimes(1);
    const [sql, args] = f.unsafe.mock.calls[0]!;
    expect(sql).toContain('app.invitation_issue($1::uuid');
    expect(JSON.stringify(args)).not.toContain(token);
    expect(f.settings.identity).toHaveBeenCalledTimes(1);
  });
  it('denies non-owner before any SQL or capability generation', async () => {
    const f = assembly();
    vi.mocked(f.settings.identity!).mockResolvedValue({ id: owner, role: 'mentor', active: true });
    expect((await f.POST(request())).status).toBe(403);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('rejects cross-origin and role injection without SQL', async () => {
    const f = assembly();
    expect((await f.POST(request({}, { origin: 'http://untrusted.test' }))).status).toBe(403);
    expect((await f.POST(request({ role: 'admin' }))).status).toBe(422);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('handles malformed/oversize bodies and rate denial without SQL', async () => {
    const f = assembly();
    expect((await f.POST(request({}, { 'content-length': '5000' }))).status).toBe(413);
    vi.mocked(f.ingress.consume).mockResolvedValue(false);
    expect((await f.POST(request())).status).toBe(429);
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('strips database errors and does not retry an uncertain transaction', async () => {
    const f = assembly();
    f.unsafe.mockRejectedValueOnce(new Error('credential=secret private details'));
    const response = await f.POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'uncertain' });
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed SQL response and reflected scope', async () => {
    const f = assembly();
    f.unsafe.mockResolvedValueOnce([
      { result: { kind: 'issued', email: 'other@example.test' } },
    ] as never);
    expect(await (await f.POST(request())).json()).toEqual({ status: 'uncertain' });
  });
  it('requires configured repository and rejects invalid direct scope before querying', async () => {
    const f = assembly();
    expect(createPostgresInvitationIssuer(null)).toBeNull();
    const repo = createPostgresInvitationIssuer({
      enabled: true,
      client: { unsafe: f.unsafe } as never,
    })!;
    await expect(repo.issue({ invitationId: 'invalid' } as never)).rejects.toThrow(
      'Invitation issuance unavailable',
    );
    expect(f.unsafe).not.toHaveBeenCalled();
  });
});
describe('invitation draft static safeguards (not SQL execution)', () => {
  const draft = (n: string) =>
    readFileSync(new URL(`../../../../packages/db/migration-drafts/${n}`, import.meta.url), 'utf8');
  it('keeps the private acceptance hook before0016 and pins curriculum/current owner policy', () => {
    const text = draft('0020_invitation_issuance.DRAFT.sql');
    expect(text).toContain('nextera-invitation-admission-v1');
    expect(text).toContain('FOR SHARE');
    expect(text).toContain('c.curriculum_version_id=a.curriculum_version_id');
    expect(text).toContain('p.issuer_login=session_user');
    expect(text).toContain("u.active AND u.role='admin'");
    expect(text).toContain('UNIQUE(cohort_id,email)');
    expect(text).not.toMatch(/CREATE ROLE|INSERT INTO app\.invitation_issuance_policy/);
    expect(text).not.toContain('raw_token');
    expect(text).not.toContain('TO nextera_web');
  });
  it.each([
    '0016_invitation_operations.DRAFT.sql',
    '0018_invitation_admission.DRAFT.sql',
    '0020_invitation_issuance.DRAFT.sql',
  ])('finishes PUBLIC/explicit EXECUTE ACLs before ownership transfers in %s', (name) => {
    const text = draft(name),
      transfer = text.indexOf(' OWNER TO nextera_invitation_owner');
    expect(transfer).toBeGreaterThan(text.lastIndexOf('REVOKE ALL ON FUNCTION'));
    expect(transfer).toBeGreaterThan(text.lastIndexOf('GRANT EXECUTE ON FUNCTION'));
    expect(text.indexOf('GRANT CREATE ON SCHEMA app TO nextera_invitation_owner')).toBeLessThan(
      transfer,
    );
    expect(
      text.lastIndexOf('REVOKE CREATE ON SCHEMA app FROM nextera_invitation_owner'),
    ).toBeGreaterThan(transfer);
  });
});

describe('canonical UUID receipt binding', () => {
  it('canonicalizes alphabetic owner/request/cohort/generated IDs before issuing', async () => {
    const f = fixture();
    const alpha = 'ABCDEFAB-0000-4000-8000-000000000001';
    const settings = {
      ...f.settings,
      policy: { ...f.settings.policy!, ownerIds: [alpha] },
      identity: async () => ({ id: alpha, role: 'admin', active: true }),
      capability: async () => ({ invitationId: alpha, token }),
    };
    expect(
      (
        await createManualInvitationIssuer(settings).issue({
          ...form(),
          requestId: alpha,
          cohortId: alpha,
        })
      ).status,
    ).toBe('issued');
    expect(f.issue.mock.calls[0]![0]).toMatchObject({
      invitationId: alpha.toLowerCase(),
      requestId: alpha.toLowerCase(),
      cohortId: alpha.toLowerCase(),
      issuerId: alpha.toLowerCase(),
    });
  });
  it('canonicalizes a direct repository scope before SQL/receipt matching', async () => {
    const alpha = 'ABCDEFAB-0000-4000-8000-000000000001';
    const unsafe = vi.fn(async (_text: string, values: unknown[]) => [
      {
        result: {
          kind: 'issued',
          invitation_id: values[0],
          request_id: values[1],
          issuer_id: values[2],
          token_digest: values[3],
          email: values[4],
          display_name: values[5],
          cohort_id: values[6],
          expires_at_ms: values[7],
          curriculum_version_id: version,
        },
      },
    ]);
    const repository = createPostgresInvitationIssuer({
      enabled: true,
      client: { unsafe } as never,
    })!;
    const result = await repository.issue({
      invitationId: alpha,
      requestId: alpha,
      issuerId: alpha,
      cohortId: alpha,
      tokenDigest: 'a'.repeat(64),
      email: form().email,
      displayName: form().displayName,
      expiresAt: 2000,
    });
    expect(result).toMatchObject({
      kind: 'issued',
      invitationId: alpha.toLowerCase(),
      requestId: alpha.toLowerCase(),
      issuerId: alpha.toLowerCase(),
      cohortId: alpha.toLowerCase(),
    });
    expect(unsafe.mock.calls[0]![1].slice(0, 3)).toEqual(Array(3).fill(alpha.toLowerCase()));
  });
});

describe('cohort admission serialization (static SQL assertion only)', () => {
  it('takes the cohort UPDATE lock before enrollment can upgrade a shared lock', () => {
    const sql = readFileSync(
      new URL(
        '../../../../packages/db/migration-drafts/0020_invitation_issuance.DRAFT.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const hook = sql.slice(
      sql.indexOf('CREATE FUNCTION app.invitation_admission_current'),
      sql.indexOf('COMMENT ON FUNCTION app.invitation_admission_current'),
    );
    expect(hook).toContain('FOR UPDATE OF c');
    expect(hook).not.toContain('FOR SHARE OF c');
    expect(hook.indexOf('FOR UPDATE OF c')).toBeLessThan(
      hook.indexOf("u.active AND u.role='admin'"),
    );
  });
});
