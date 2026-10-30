import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const draft = readFileSync(
  new URL('../migration-drafts/0023_invitation_runtime_readers.DRAFT.sql', import.meta.url),
  'utf8',
);
const journal = readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8');
const guard = draft.slice(
  draft.indexOf('CREATE FUNCTION app._invitation_runtime_binding'),
  draft.indexOf('CREATE FUNCTION app.invitation_runtime_policy_rows'),
);
const consume = draft.slice(
  draft.indexOf('CREATE FUNCTION app.invitation_runtime_limit_consume'),
  draft.indexOf('-- Private owner policies'),
);
describe('Unregistered invitation runtime readers DRAFT0023 (static source only)', () => {
  it('seeds no credentials, accounts, policies, limits or live activation', () => {
    expect(draft).toContain('SOURCE REVIEW DRAFT ONLY');
    expect(journal).not.toContain('0023_invitation_runtime_readers');
    expect(draft).not.toMatch(
      /CREATE ROLE|CREATE USER|PASSWORD\s*=|INSERT INTO app\.(invitation_runtime_profiles|invitation_runtime_rate_bindings|invitation_issuance_policy|invitation_activations|invitation_acceptances)/i,
    );
    expect(draft).not.toMatch(
      /DEFAULT\s+[0-9]|CREATE OR REPLACE|ALTER TABLE app\.(users|invitation_issuance_policy|invitation_rate_profiles)/,
    );
    expect(draft).toContain('max_limiter_receipts integer NOT NULL CHECK(max_limiter_receipts>0)');
    expect(draft).toContain('max_lifetime_ms>0 AND max_lifetime_ms<=3600000');
    expect(draft).toContain("expires_at>starts_at AND expires_at<=starts_at+interval '1 hour'");
    expect(draft).toContain('The public configuration hash does not include lease timestamps');
    expect(draft).toContain('the broker must read back the exact starts_at/immutable cleanupAt');
  });
  it('preserves all earlier invitation draft bytes', () => {
    for (const [file, hash] of [
      [
        '0013_invitations.DRAFT.sql',
        'e20c9938753ddd7b0660f7240006fb65bb28a79ac1687f1629c1ce763ef4a675',
      ],
      [
        '0016_invitation_operations.DRAFT.sql',
        'b2033271518a5079ca46f6678da3b103c0f05b17f137ee3437a2225358b58b49',
      ],
      [
        '0018_invitation_admission.DRAFT.sql',
        '731047b27dfee25c017480ebe7ea5b499832fca771dc63d43d8aafdffaeaebf5',
      ],
      [
        '0020_invitation_issuance.DRAFT.sql',
        '3bba54e13b61b4bf76d33e65cc2446a34b09bef7e53984281914eef3cbefada4',
      ],
    ])
      expect(
        createHash('sha256')
          .update(readFileSync(new URL('../migration-drafts/' + file, import.meta.url)))
          .digest('hex'),
      ).toBe(hash);
  });
  it('requires approved owner/DBA context and strips default ACLs without static broad role grants', () => {
    expect(draft).toContain("NOT pg_has_role(current_user,'nextera_invitation_owner','SET')");
    expect(draft).toContain("current_setting('role')<>'none'");
    expect(draft).toContain("has_schema_privilege('nextera_invitation_owner','app','CREATE')");
    expect(draft).toContain('aclexplode');
    expect(draft).not.toMatch(/GRANT\s+nextera_/);
    expect(draft.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(4);
    const grants = draft.split('\n').filter((line) => line.startsWith('GRANT EXECUTE'));
    expect(grants).toHaveLength(2);
    expect(grants[0]).toContain('invitation_runtime_policy_rows');
    expect(grants[0]).toContain('TO nextera_invitation_runtime');
    expect(grants[1]).toContain('TO nextera_invitation_issuer');
    expect(grants.join()).not.toMatch(/guard_|_invitation_runtime_binding|TO nextera_web/);
    expect(draft).not.toMatch(/GRANT SELECT|GRANT INSERT|GRANT UPDATE|GRANT DELETE/);
  });
  it('binds original current-user identity through role-none/exact-session login and restrictive catalog checks', () => {
    expect(guard).toContain("current_user<>'nextera_invitation_owner'");
    expect(guard).toContain("current_setting('role')<>'none'");
    expect(guard).toContain('session_user<>required_login');
    expect(guard).toContain("pg_has_role(session_user,permission_role,'USAGE')");
    expect(guard).toContain('NOT m.admin_option');
    expect(guard).toContain('AND NOT r.rolsuper AND NOT r.rolbypassrls');
    expect(guard).toContain('has_any_column_privilege');
    expect(guard).toContain('p.database_name<>current_database()');
    expect(guard).toContain('p.public_policy_sha256 IS DISTINCT FROM expected_hash');
    expect(guard).toContain(
      '(p.issuer_id,p.cohort_id,p.curriculum_version_id) IS DISTINCT FROM (issuer,cohort,version)',
    );
    expect(guard).toContain('u.auth_user_id=p.issuer_auth_user_id');
    expect(guard).toContain("u.active AND u.role='admin'");
    expect(guard).toContain("c.status='active' AND v.status='published'");
    expect(guard).toContain('s.max_lifetime_ms=p.max_lifetime_ms AND s.enabled');
    expect(guard).toContain('FOR SHARE OF r');
    expect(guard).toContain('GET DIAGNOSTICS matched_rates=ROW_COUNT');
  });
  it('returns raw strict whitelists instead of readiness booleans or unrelated private invitation data', () => {
    const readers = draft.slice(
      draft.indexOf('CREATE FUNCTION app.invitation_runtime_policy_rows'),
      draft.indexOf('CREATE FUNCTION app.invitation_runtime_limit_consume'),
    );
    expect(readers).toContain(
      'RETURNS TABLE(id text,action text,window_ms integer,max_requests integer,retention_ms text)',
    );
    expect(readers).toContain(
      'RETURNS TABLE(issuer_id uuid,cohort_id uuid,curriculum_version_id uuid,issuer_login text,max_lifetime_ms text,enabled boolean)',
    );
    expect(readers).not.toMatch(/email|token|digest|acceptance|SELECT \*/);
    expect(readers).toContain("version,'activation'");
    expect(readers).toContain(
      'RETURN QUERY SELECT r.id,r.action,r.window_ms,r.max_requests,r.retention_ms::text',
    );
    expect(readers).toContain(
      'FROM app.invitation_rate_profiles r JOIN app.invitation_runtime_rate_bindings b',
    );
    expect(readers).toContain("version,'issuer'");
  });
  it('serializes cross-instance idempotent nonce receipts, bounds storage and debits only under explicit policy', () => {
    expect(draft).toContain('PRIMARY KEY(action,operation_id)');
    expect(consume.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      consume.indexOf('SELECT * INTO old'),
    );
    expect(consume.indexOf('SELECT * INTO old')).toBeLessThan(
      consume.indexOf('INSERT INTO app.invitation_runtime_limit_counters'),
    );
    expect(consume.indexOf('>=p.max_limiter_receipts')).toBeLessThan(
      consume.indexOf('INSERT INTO app.invitation_runtime_limit_counters'),
    );
    for (const name of [
      'runtime_profile',
      'public_policy_sha256',
      'issuer_id',
      'cohort_id',
      'curriculum_version_id',
      'caller_login',
      'rate_profile_id',
      'window_ms',
      'max_requests',
      'retention_ms',
    ])
      expect(consume).toContain('old.' + name);
    expect(consume).toContain('app.invitation_runtime_limit_counters.requests<rate.max_requests');
    expect(consume).toContain('ON CONFLICT ON CONSTRAINT invitation_runtime_limit_counters_pkey');
    expect(consume.match(/INSERT INTO app.invitation_runtime_limit_receipts/g)).toHaveLength(1);
    expect(consume).not.toContain('WHEN OTHERS');
  });
  it('keeps false receipts false, rechecks current lifecycle/window and never renews expiry on replay/upsert', () => {
    expect(consume).toContain('old.allowed AND old.window_number=w AND old.expires_at>instant');
    expect(consume).toContain('IF clock_timestamp()>=p.expires_at');
    expect(consume).toContain(
      'least(p.expires_at,to_timestamp((w::numeric*rate.window_ms+rate.retention_ms)/1000))',
    );
    expect(consume).not.toMatch(
      /DO UPDATE SET[^;]*expires_at|UPDATE app\.invitation_runtime_limit_receipts|DELETE FROM/,
    );
    expect(draft).toContain('BEFORE UPDATE OR DELETE ON app.invitation_runtime_limit_receipts');
    expect(draft).toContain('Sealed runtime profile identity is immutable');
    expect(draft).toContain('Sealed runtime rate binding is immutable');
  });
});
