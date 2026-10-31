import {
  CHECKPOINT_CODE_DRAFT_WRITE_SHA256,
  CHECKPOINT_TYPED_DRAFT_WRITE_SHA256,
} from '../queries/checkpoint-write-window';
import {
  CHECKPOINT_DRAFT_READINESS_SQL,
  CHECKPOINT_DRAFT_RETAINED_READINESS_SQL,
} from '../queries/checkpoint-drafts';
import {
  CHECKPOINT_ANSWER_DRAFT_READINESS_SQL,
  CHECKPOINT_ANSWER_DRAFT_RETAINED_READINESS_SQL,
  CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL,
} from '../queries/checkpoint-answer-drafts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const repair = readFileSync(
  new URL('../migration-drafts/0030_checkpoint_draft_write_window.DRAFT.sql', import.meta.url),
  'utf8',
);
const baseline = [
  {
    file: 'packages/db/migration-drafts/0011_checkpoint_drafts.DRAFT.sql',
    fileSha256: 'eaf3f7e95589fddf081f73084700ee994e9d87a775187d76f0d39d8d89e5a1e6',
    function: 'save_checkpoint_draft',
    arguments:
      'auth_id uuid,attempt uuid,task text,definition text,request uuid,base bigint,source bytea,source_hash text',
    beforeBodySha256: '0e63149615758594bcc972a6e8162ad7390e4a23352c9d09e1aa7eb784aa4955',
    afterBodySha256: '6d71f2c99726c7ff48fbdcd7a2d2b8152f59ccf248524edb92dde0fc57c033e2',
  },
  {
    file: 'packages/db/migration-drafts/0021_checkpoint_answer_drafts.DRAFT.sql',
    fileSha256: 'f6a0e4ea96de81648f237bac37a781de9e4005ab8b82f4dcb605927c92c06720',
    function: 'save_checkpoint_answer_draft',
    arguments:
      'auth_id uuid,attempt uuid,task text,definition text,contract text,request uuid,base bigint,payload bytea,payload_hash text',
    beforeBodySha256: '00308c9a6c769d82852155eedecf44f61fe14fc5dd07310d22206270d5bcfe91',
    afterBodySha256: '3e365dc7b40317d902e7bd8aca489df93bcd30020ee045a9e4c523efdf7892c6',
  },
];
const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
/** Static source/byte transformation checks only. Native PostgreSQL remains unverified. */
describe('append-only draft POST write-window repair', () => {
  it.each(baseline)('retains $file and only inserts the replay deadline guard', (expected) => {
    const file = expected.file.split('/').at(-1)!;
    const bytes = readFileSync(new URL('../migration-drafts/' + file, import.meta.url));
    expect(sha(bytes)).toBe(expected.fileSha256);
    const source = bytes.toString();
    const start = source.indexOf('CREATE FUNCTION app.' + expected.function + '(');
    const bodyStart = source.indexOf('AS $$', start) + 5;
    const body = source.slice(bodyStart, source.indexOf('$$;', bodyStart));
    expect(sha(body)).toBe(expected.beforeBodySha256);
    const expiry = body.match(
      / IF old[.]expires_at<=clock_timestamp\(\) THEN RAISE EXCEPTION '[^']+' USING ERRCODE='(?:PD001|PA001)'; END IF;/,
    )![0];
    const guard = body.match(
      / at_time:=clock_timestamp\(\);\n IF a[.]status<>'active' OR at_time>=a[.]deadline_at THEN RAISE EXCEPTION '[^']+' USING ERRCODE='(?:PD001|PA001)'; END IF;/,
    )![0];
    const transformed = body.replace(expiry, guard + '\n' + expiry);
    expect(sha(transformed)).toBe(expected.afterBodySha256);
    const lookup = transformed.indexOf('SELECT * INTO old'),
      cutoff = transformed.indexOf(guard),
      saved = transformed.indexOf("RETURN jsonb_build_object('kind','saved'");
    expect(lookup).toBeLessThan(cutoff);
    expect(cutoff).toBeLessThan(saved);
    expect(transformed.replace(guard + '\n' + expiry, expiry)).toBe(body);
    expect(repair).toContain(expected.beforeBodySha256);
    expect(repair).toContain(expected.afterBodySha256);
  });
  it('fails before replacement on unknown bytes, owner or ACL, and verifies the same OID afterward', () => {
    expect(repair).toContain("current_user<>'nextera_checkpoint_owner'");
    expect(repair).toContain('prior_proc.proowner<>owner_oid');
    expect(repair).toContain('a.grantee<>web_oid');
    expect(repair).toContain('a.is_grantable');
    expect(repair.indexOf('request.before_sha')).toBeLessThan(repair.indexOf('EXECUTE format'));
    expect(repair).toContain('WHERE oid=prior_proc.oid');
    expect(repair).toContain('updated_proc.proacl');
    expect(repair).toContain('updated_proc.proconfig');
    expect(repair).toContain('count_repaired<>2');
    expect(repair).not.toMatch(/\b(?:GRANT|CREATE ROLE|CREATE USER|DROP|ALTER OWNER)\s/i);
  });
  it('keeps retained GET, draft storage policy, official submission and migration registration separate', () => {
    expect(repair).not.toContain('CREATE OR REPLACE FUNCTION app.read_');
    expect(repair).not.toMatch(/INSERT INTO|DELETE FROM|UPDATE app[.]/);
    expect(
      readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8'),
    ).not.toContain('0030_checkpoint_draft_write_window');
  });
});

describe('unrepaired POST storage remains unavailable while retained reads keep their original checks', () => {
  it('pins repaired write bodies only for write readiness, retaining catalog and validator checks for reads', () => {
    expect(CHECKPOINT_CODE_DRAFT_WRITE_SHA256).toBe(baseline[0]!.afterBodySha256);
    expect(CHECKPOINT_TYPED_DRAFT_WRITE_SHA256).toBe(baseline[1]!.afterBodySha256);
    expect(CHECKPOINT_DRAFT_READINESS_SQL).toContain(CHECKPOINT_CODE_DRAFT_WRITE_SHA256);
    expect(CHECKPOINT_ANSWER_DRAFT_READINESS_SQL).toContain(CHECKPOINT_TYPED_DRAFT_WRITE_SHA256);
    expect(CHECKPOINT_DRAFT_READINESS_SQL).toContain('pg_catalog.convert_to(p.prosrc');
    expect(CHECKPOINT_ANSWER_DRAFT_READINESS_SQL).toContain('pg_catalog.convert_to(p.prosrc');
    expect(CHECKPOINT_DRAFT_RETAINED_READINESS_SQL).not.toContain(
      CHECKPOINT_CODE_DRAFT_WRITE_SHA256,
    );
    expect(CHECKPOINT_ANSWER_DRAFT_RETAINED_READINESS_SQL).not.toContain(
      CHECKPOINT_TYPED_DRAFT_WRITE_SHA256,
    );
    for (const sql of [
      CHECKPOINT_DRAFT_RETAINED_READINESS_SQL,
      CHECKPOINT_ANSWER_DRAFT_RETAINED_READINESS_SQL,
    ]) {
      expect(sql).toContain('pg_catalog.pg_proc');
      expect(sql).toContain('has_function_privilege');
      expect(sql).toContain('pg_catalog.aclexplode');
      expect(sql).toContain('isolated_tables');
      expect(sql).toContain('web_caller');
      expect(sql).toContain('guards');
    }
    expect(CHECKPOINT_ANSWER_DRAFT_RETAINED_READINESS_SQL).toContain(
      CHECKPOINT_ANSWER_PAYLOAD_VALIDATOR_READINESS_SQL + ' AS canonical_validator',
    );
  });
});
