import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, it, expect, vi } from 'vitest';
import { applyResult } from '../operations/results';
import type { OperationalDatabase } from '../operations/curriculum';
const id = (n: number) => '00000000-0000-0000-0000-' + n.toString(16).padStart(12, '0');
const receipt = {
  id: id(1),
  job_id: id(2),
  attempt_id: id(3),
  evaluation_digest: 'a'.repeat(64),
  verdict: 'failed',
  application_status: 'applied',
  processed_at: '2026-10-31T00:00:00Z',
  application_reason: 'scored_exam_binary_result_applied',
};
function fake(
  options: {
    available?: boolean;
    marked?: boolean;
    receipt?: unknown;
    failure?: boolean;
    missingAck?: boolean;
  } = {},
) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let committed = false;
  const execute = vi.fn(async (statement: SQL) => {
    const q = new PgDialect().sqlToQuery(statement);
    calls.push({ sql: q.sql, params: q.params });
    if (q.sql.includes("pg_has_role(session_user,'nextera_result_application'"))
      return [{ allowed: true }];
    if (q.sql.includes("to_regprocedure('app.apply_scored_exam_binary_result"))
      return [{ available: options.available ?? true }];
    if (q.sql.includes('SELECT app.apply_scored_exam_binary_result')) {
      if (options.failure) throw new Error('native receipt transaction failed');
      if (options.missingAck) return [];
      return [
        { receipt: Object.hasOwn(options, 'receipt') ? options.receipt : structuredClone(receipt) },
      ];
    }
    if (q.sql.includes('AS marked')) return [{ marked: options.marked ?? false }];
    if (q.sql.includes("to_regprocedure('app.apply_raid_automated_result"))
      return [{ available: true }];
    if (q.sql.includes('SELECT app.apply_raid_automated_result'))
      return [{ receipt: { ...receipt, application_reason: 'legacy_raid_fixture' } }];
    throw new Error('Unexpected SQL path: ' + q.sql);
  });
  const db = {
    transaction: async (fn: (tx: { execute: typeof execute }) => Promise<unknown>) => {
      const result = await fn({ execute });
      committed = true;
      return result;
    },
  } as unknown as OperationalDatabase;
  return { db, calls, committed: () => committed };
}
describe('actual result operation routes marked binary receipts only through native registrar, fake transaction only', () => {
  it('sends only the native result ID and returns receipt before any legacy progression or finalizer', async () => {
    const f = fake();
    expect(await applyResult(f.db, id(1))).toEqual(receipt);
    expect(f.committed()).toBe(true);
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2]!.params).toEqual([id(1)]);
    expect(f.calls.map((c) => c.sql).join('\n')).not.toMatch(
      /finalize_checkpoint|UPDATE app.learner_node_progress|raid_automated/,
    );
  });
  it('preserves the existing legacy/raid branch only after an explicit not-applicable native response', async () => {
    const f = fake({ receipt: null });
    expect(await applyResult(f.db, id(1))).toMatchObject({
      application_reason: 'legacy_raid_fixture',
    });
    expect(f.calls[3]!.sql).toContain('app.apply_raid_automated_result');
  });
  it('keeps unmarked legacy routing when the optional registrar is absent', async () => {
    const f = fake({ available: false, marked: false });
    expect(await applyResult(f.db, id(1))).toMatchObject({
      application_reason: 'legacy_raid_fixture',
    });
    expect(f.calls.some((c) => c.sql.includes('AS marked'))).toBe(true);
  });
  it('fails closed for marked sources when the registrar is missing', async () => {
    const f = fake({ available: false, marked: true });
    await expect(applyResult(f.db, id(1))).rejects.toThrow(
      'SCORED_EXAM_BINARY_REGISTRAR_UNAVAILABLE',
    );
    expect(f.committed()).toBe(false);
    expect(f.calls.some((c) => c.sql.includes('raid_automated'))).toBe(false);
  });
  it.each([
    { failure: true },
    { missingAck: true },
    { receipt: { ...receipt, id: id(99) } },
    { receipt: { ...receipt, application_status: 'pending' } },
  ])(
    'does not fall through or commit after a registrar failure/malformed receipt %j',
    async (fault) => {
      const f = fake(fault);
      await expect(applyResult(f.db, id(1))).rejects.toThrow();
      expect(f.committed()).toBe(false);
      expect(
        f.calls.some(
          (c) => c.sql.includes('raid_automated') || c.sql.includes('finalize_checkpoint'),
        ),
      ).toBe(false);
    },
  );
  it('allows explicit duplicate delivery to converge on the same native receipt without inventing another identity', async () => {
    const f = fake();
    expect(await applyResult(f.db, id(1))).toEqual(receipt);
    expect(await applyResult(f.db, id(1))).toEqual(receipt);
    expect(
      f.calls
        .filter((c) => c.sql.includes('SELECT app.apply_scored_exam_binary_result'))
        .map((c) => c.params),
    ).toEqual([[id(1)], [id(1)]]);
  });
});
const sql = readFileSync(
  new URL('../migration-drafts/0033_scored_exam_binary_result.DRAFT.sql', import.meta.url),
  'utf8',
);
describe('0033 append-only binary receipt registrar proposal, not native SQL proof', () => {
  it('reuses existing result principal authority without creating roles or table grants', () => {
    expect(sql).toContain('LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog');
    expect(sql).toContain('LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog');
    expect(sql).not.toMatch(
      /CREATE ROLE|ALTER ROLE|GRANT (?:SELECT|INSERT|UPDATE|ALL)|CREATE OR REPLACE/i,
    );
    expect(sql).toContain('Exact binary receipt owner/OID/ACL readback failed');
    expect(sql).toContain("'nextera_runner','nextera_judge_owner','nextera_judge_maintenance'");
  });
  it('verifies core/full-spec, acceptance, source, active job/claim and idempotent native receipt identities', () => {
    expect(sql).toContain('app.scored_exam_attempt_metadata(a)');
    expect(sql).toContain(
      "app.checkpoint_digest(spec,'nextera-evaluation-spec') IS DISTINCT FROM s.evaluation_spec_digest",
    );
    expect(sql).toContain('acc.snapshot_digest IS DISTINCT FROM a.snapshot_digest');
    expect(sql).toContain('art.sha256 IS DISTINCT FROM acc.answer_digest');
    expect(sql).toContain(
      "j.evaluation_digest IS DISTINCT FROM app.checkpoint_digest(j.evaluation_snapshot,'nextera-evaluation-snapshot')",
    );
    expect(sql).toContain('id=r.attempt_id AND job_id=j.id');
    expect(sql).toContain(
      'authoritative:=s.active_judge_job_id=j.id AND j.terminal_result_id=r.id',
    );
    expect(sql).toContain("r.application_status::text<>'pending'");
    expect(sql.indexOf("r.application_status::text<>'pending'")).toBeLessThan(
      sql.indexOf('UPDATE app.submissions SET state=r.verdict'),
    );
  });
  it('mutates only binary display/receipt/audit and never closes attempts, applies score, masters, unlocks or awards XP', () => {
    const body = sql
      .split('CREATE FUNCTION app.apply_scored_exam_binary_result')[1]!
      .split('END $$;')[0]!;
    expect(body).toContain("application_reason='scored_exam_binary_result_applied'");
    expect(body).toContain("jsonb_build_object('version',1,'scoringStatus','provisional'");
    expect(body).not.toMatch(
      /UPDATE app.checkpoint_attempts|UPDATE app.learner_node_progress|finalize_checkpoint\(|exam_scoring_final_outcomes|exam_scoring_events|INSERT INTO app.xp/,
    );
    expect(body).toContain("'scored_exam_binary_result_recorded'");
  });
  it('leaves original registered migration and draft25 bytes exact', () => {
    expect(
      createHash('sha256')
        .update(
          readFileSync(new URL('../migrations/0007_checkpoint_operations.sql', import.meta.url)),
        )
        .digest('hex'),
    ).toBe('99e9d01c77f6eeb9f6f968e903375083531a3d2f112dfaca3249d458aaeeb35c');
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            new URL(
              '../migration-drafts/0025_exam_legacy_finalizer_guard.DRAFT.sql',
              import.meta.url,
            ),
          ),
        )
        .digest('hex'),
    ).toBe('2b628766a1481db5db34d4e156018e381b90975f0b6603af84e30ca642cb00f4');
  });
});
