import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { OperationalDatabase } from '../operations/curriculum';
import { visibleRunStorageFixture } from '../../../tests/fixtures/visible-runs';
import {
  VISIBLE_RUN_READINESS_SQL,
  VisibleRunStorageError,
  readVisibleRunReadiness,
  readVisibleRunAuthority,
  reserveVisibleRun,
  readVisibleRun,
  claimVisibleRun,
  pulseVisibleRun,
  completeVisibleRun,
  reconcileVisibleRun,
  purgeExpiredVisibleRunPayloads,
  storedRunIntentDigest,
  listQueuedVisibleRuns,
  listRecoverableVisibleRuns,
} from '../queries/visible-runs';

const ready = {
  contract: true,
  isolated_tables: true,
  guards: true,
  private_helpers: true,
  permission_roles: true,
  owner_isolation: true,
  caller_isolation: true,
};
function database(data: unknown) {
  const execute = vi.fn(async (statement: Parameters<OperationalDatabase['execute']>[0]) => {
    const query = new PgDialect().sqlToQuery(statement as never);
    if (query.sql === VISIBLE_RUN_READINESS_SQL) return [ready];
    if (query.sql.includes('AS permitted')) return [{ permitted: true }];
    return [{ data }];
  });
  return { execute, db: { execute } as unknown as OperationalDatabase };
}
const f = visibleRunStorageFixture();
const input = { authId: f.id, intent: f.intent, intentDigest: storedRunIntentDigest(f.intent) };
const fenced = { runId: f.run, generation: 1, token: f.lease };
describe('Run catalog-only readiness and least privilege', () => {
  it.each(Object.keys(ready))('fails closed without %s before a write RPC', async (key) => {
    const d = database(f.wire());
    d.execute.mockResolvedValueOnce([{ ...ready, [key]: false }] as never);
    await expect(reserveVisibleRun(d.db, input)).rejects.toMatchObject({ code: 'unavailable' });
    const calls = d.execute.mock.calls.map(([s]) => new PgDialect().sqlToQuery(s as never).sql);
    expect(calls.some((sql) => sql.includes('SELECT app.reserve_visible_run'))).toBe(false);
  });
  it('requires exact true, catches unavailable catalogs and never asserts live execution', async () => {
    const d = database(f.wire());
    expect(await readVisibleRunReadiness(d.db)).toEqual({ ready: true, liveRunVerified: false });
    d.execute.mockResolvedValueOnce([{ ...ready, contract: 'true' }] as never);
    expect((await readVisibleRunReadiness(d.db)).ready).toBe(false);
    d.execute.mockRejectedValue(new Error('password=private'));
    expect(await readVisibleRunReadiness(d.db)).toEqual({ ready: false, liveRunVerified: false });
  });
  it('rejects missing caller usage and uses a bound capability-specific role', async () => {
    const d = database(null);
    d.execute.mockResolvedValueOnce([ready]).mockResolvedValueOnce([{ permitted: false }] as never);
    expect((await readVisibleRunReadiness(d.db, 'worker')).ready).toBe(false);
    const q = new PgDialect().sqlToQuery(d.execute.mock.calls[1]![0] as never);
    expect(q.params).toContain('nextera_visible_run_worker');
    expect(q.sql).not.toContain('CREATE');
  });
  it('is read-only and checks hardened web/worker/maintenance ACLs and private helpers', () => {
    expect(VISIBLE_RUN_READINESS_SQL).not.toMatch(
      /\b(CREATE |ALTER |INSERT INTO|UPDATE app\.|DELETE FROM|GRANT |REVOKE )/i,
    );
    for (const value of [
      'search_path=pg_catalog',
      'nextera_visible_run_maintenance',
      'private_helpers',
      'permission_roles',
      'has_table_privilege',
      'relrowsecurity',
    ])
      expect(VISIBLE_RUN_READINESS_SQL).toContain(value);
  });
});
describe('Run durable admission/read repository - injected execution only', () => {
  it('binds exact source bytes and immutable identities without embedding source in SQL', async () => {
    const d = database(f.wire()),
      result = await reserveVisibleRun(d.db, input);
    expect(result.intent.source).toBe(f.source);
    expect(result.record.state).toBe('queued');
    const q = new PgDialect().sqlToQuery(d.execute.mock.calls[2]![0] as never);
    expect(q.sql).toContain('app.reserve_visible_run');
    expect(q.sql).not.toContain(f.source);
    expect(q.params).toContain(Buffer.from(f.source).toString('base64'));
    expect(q.params).toContain(input.intentDigest);
    expect(q.sql).not.toMatch(/app\.submissions|judge\./);
  });
  it('projects exact manifest/policy bytes and validates raw digest binding', async () => {
    const d = database(f.authority),
      result = await readVisibleRunAuthority(d.db, f.id, f.id, f.scope.taskKey);
    expect(result.manifest).toEqual(f.manifest);
    expect(result.policy).toEqual(f.policy);
    expect(result.editor).toEqual(f.editor);
  });
  it.each([
    { manifestDigest: 'f'.repeat(64) },
    { policyDigest: 'e'.repeat(64) },
    { manifestBase64: 'invalid==' },
    { policyBase64: 'invalid==' },
  ])('rejects damaged configuration %#', async (patch) => {
    const d = database({ ...f.authority, ...patch });
    await expect(readVisibleRunAuthority(d.db, f.id, f.id, f.scope.taskKey)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it('rejects hash-valid invalid JSON and scope/clock mismatch rather than inventing context', async () => {
    const raw = 'not-json';
    for (const patch of [
      {
        manifestBase64: Buffer.from(raw).toString('base64'),
        manifestDigest: f.rawBlobHash('nextera-visible-examples', raw),
      },
      { editor: { ...f.editor, scope: { ...f.scope, attemptId: f.request } } },
      { editor: { ...f.editor, deadline: 'unknown' } },
    ]) {
      const d = database({ ...f.authority, ...patch });
      await expect(
        readVisibleRunAuthority(d.db, f.id, f.id, f.scope.taskKey),
      ).rejects.toMatchObject({ code: 'unavailable' });
    }
  });
  it('rejects malformed or changed source before querying', async () => {
    for (const source of ['', '\ud800', 'x'.repeat(262145)]) {
      const d = database(null);
      await expect(
        reserveVisibleRun(d.db, { ...input, intent: { ...input.intent, source } }),
      ).rejects.toBeInstanceOf(VisibleRunStorageError);
      expect(d.execute).not.toHaveBeenCalled();
    }
  });
  it.each(['intentDigest', 'sourceDigest', 'manifestDigest', 'policyDigest'] as const)(
    'rejects a corrupt %s in returned receipt',
    async (key) => {
      const wire = f.wire();
      const data =
        key === 'intentDigest'
          ? { ...wire, intentDigest: 'f'.repeat(64) }
          : { ...wire, intent: { ...wire.intent, [key]: 'f'.repeat(64) } };
      const d = database(data);
      await expect(reserveVisibleRun(d.db, input)).rejects.toMatchObject({ code: 'unavailable' });
    },
  );
  it('rejects foreign scope, wrong request, malformed bytes, premature output and grading verdicts', async () => {
    for (const patch of [
      { intent: { ...f.wire().intent, scope: { ...f.scope, learnerId: f.request } } },
      { record: { ...f.wire().record, requestId: f.run } },
      { intent: { ...f.wire().intent, sourceBase64: '//8=' } },
      { record: { ...f.wire().record, outputBase64: 'eA==' } },
      { record: { ...f.wire().record, state: 'passed' } },
    ]) {
      const d = database({ ...f.wire(), ...patch });
      await expect(readVisibleRun(d.db, f.id, f.scope, { runId: f.run })).rejects.toMatchObject({
        code: 'unavailable',
      });
    }
  });
  it('supports original-intent reconciliation without reserve, and preserves missing records', async () => {
    const d = database(f.wire('completed', '\u00e9\u0000'));
    expect(
      (await readVisibleRun(d.db, f.id, f.scope, { requestId: f.request }))?.record.output,
    ).toBe('\u00e9\u0000');
    const q = new PgDialect().sqlToQuery(d.execute.mock.calls[2]![0] as never);
    expect(q.sql).toContain('read_visible_run');
    expect(q.params).toContain(null);
    expect(q.params).toContain(f.request);
    expect(await readVisibleRun(database(null).db, f.id, f.scope, { runId: f.run })).toBeNull();
  });
  it('does not accept an acknowledgement for another request or source', async () => {
    const wire = f.wire();
    const d = database({ ...wire, record: { ...wire.record, id: f.request } });
    await expect(readVisibleRun(d.db, f.id, f.scope, { runId: f.run })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it.each([
    ['42501', 'forbidden'],
    ['RV001', 'closed'],
    ['RV002', 'definition_mismatch'],
    ['RV003', 'idempotency_conflict'],
    ['RV004', 'rate_limited'],
    ['RV006', 'stale_lease'],
    ['RV007', 'storage_limit'],
    ['XX000', 'unavailable'],
  ])('maps %s privately to %s', async (code, expected) => {
    const d = database(null);
    d.execute
      .mockResolvedValueOnce([ready])
      .mockResolvedValueOnce([{ permitted: true }] as never)
      .mockRejectedValueOnce({ cause: { code, message: 'SQL password=secret' } });
    await expect(reserveVisibleRun(d.db, input)).rejects.toMatchObject({
      code: expected,
      message: 'VISIBLE_RUN_' + expected.toUpperCase(),
    });
  });
});
describe('Fenced outbox/crash/expiry interfaces - injected only', () => {
  it('validates a claim and its frozen config/lease identities; does not launch execution', async () => {
    const d = database({
      run: f.wire(),
      manifestBase64: f.authority.manifestBase64,
      policyBase64: f.authority.policyBase64,
      leaseGeneration: 1,
      leaseToken: f.lease,
      leaseExpiresAt: f.editor.deadline,
    });
    const result = await claimVisibleRun(d.db, f.run, f.scope);
    expect(result?.lease).toEqual(fenced);
    expect(result?.run.intent.source).toBe(f.source);
    const q = new PgDialect().sqlToQuery(d.execute.mock.calls[2]![0] as never);
    expect(q.sql).toContain('claim_visible_run');
    expect(q.sql).not.toContain('exec');
    expect(await claimVisibleRun(database(null).db, f.run, f.scope)).toBeNull();
  });
  it('rejects a stale/corrupt claim, policy or source', async () => {
    const base = {
      run: f.wire(),
      manifestBase64: f.authority.manifestBase64,
      policyBase64: f.authority.policyBase64,
      leaseGeneration: 1,
      leaseToken: f.lease,
      leaseExpiresAt: f.editor.deadline,
    };
    for (const patch of [
      { leaseGeneration: 0 },
      { leaseToken: 'bad' },
      { leaseExpiresAt: 'bad' },
      { policyBase64: f.authority.manifestBase64 },
      { run: f.wire('running') },
    ])
      await expect(
        claimVisibleRun(database({ ...base, ...patch }).db, f.run, f.scope),
      ).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('honors stop-required without fabricating authorization or releasing a slot', async () => {
    const d = database({ kind: 'stop_required' });
    expect(await pulseVisibleRun(d.db, fenced, false)).toEqual({ kind: 'stop_required' });
    const query = new PgDialect().sqlToQuery(d.execute.mock.calls[2]![0] as never);
    expect(query.params).toEqual([f.run, 1, f.lease, false]);
    expect(query.sql).not.toContain('reconcile');
  });
  it('validates an authorized pulse and rejects malformed lease/response', async () => {
    expect(
      await pulseVisibleRun(
        database({ kind: 'authorized', state: 'running', leaseExpiresAt: f.editor.deadline }).db,
        fenced,
        true,
      ),
    ).toMatchObject({ kind: 'authorized', state: 'running' });
    await expect(
      pulseVisibleRun(
        database({ kind: 'authorized', state: 'terminal', leaseExpiresAt: f.editor.deadline }).db,
        fenced,
        true,
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
    const d = database(null);
    await expect(pulseVisibleRun(d.db, { ...fenced, generation: 0 }, true)).rejects.toThrow();
    expect(d.execute).not.toHaveBeenCalled();
  });
  it('requires a valid trusted stop evidence reference and fenced result before completion', async () => {
    const proof = 'c'.repeat(64),
      d = database(f.wire('completed', 'ok'));
    expect(
      (await completeVisibleRun(d.db, fenced, f.scope, 'completed', 'ok', proof)).record.output,
    ).toBe('ok');
    const q = new PgDialect().sqlToQuery(d.execute.mock.calls[2]![0] as never);
    expect(q.params).toContain(proof);
    expect(q.params).toContain(f.lease);
    const bad = database(null);
    await expect(
      completeVisibleRun(bad.db, fenced, f.scope, 'completed', 'ok', ''),
    ).rejects.toThrow();
    expect(bad.execute).not.toHaveBeenCalled();
  });
  it('reconciles an expired or uncertain run only through the maintenance port', async () => {
    const d = database(false);
    expect(await reconcileVisibleRun(d.db, f.run, 1, null)).toBe(false);
    const q = new PgDialect().sqlToQuery(d.execute.mock.calls[1]![0] as never);
    expect(q.params).toContain('nextera_visible_run_maintenance');
    expect(await reconcileVisibleRun(database(true).db, f.run, 1, 'd'.repeat(64))).toBe(true);
    await expect(reconcileVisibleRun(database('true').db, f.run, 1, null)).rejects.toThrow();
  });
  it('requires an explicit bounded purge with trusted cutoff and validates returned count', async () => {
    const d = database(2);
    expect(await purgeExpiredVisibleRunPayloads(d.db, f.editor.deadline, 2)).toBe(2);
    for (const batch of [0, 1001, NaN]) {
      const d = database(null);
      await expect(
        purgeExpiredVisibleRunPayloads(d.db, f.editor.deadline, batch),
      ).rejects.toThrow();
      expect(d.execute).not.toHaveBeenCalled();
    }
    await expect(
      purgeExpiredVisibleRunPayloads(database(3).db, f.editor.deadline, 2),
    ).rejects.toThrow();
  });
});
describe('Unapplied SQL source boundaries - not SQL execution', () => {
  it('stays outside migration registration and provisions no live roles, rows or scheduler', async () => {
    const text = await readFile(
      fileURLToPath(new URL('../migration-drafts/0012_visible_runs.DRAFT.sql', import.meta.url)),
      'utf8',
    );
    expect(text).not.toMatch(
      /CREATE ROLE|CREATE USER|PASSWORD|INSERT INTO app\.visible_run_profiles|INSERT INTO app\.visible_run_principals|cron\./i,
    );
    expect(text).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(app\.(?:submissions|learner_node_progress|checkpoint_attempts)|judge\.)/i,
    );
    const journal = await readFile(
      fileURLToPath(new URL('../migrations/meta/_journal.json', import.meta.url)),
      'utf8',
    );
    expect(journal).not.toContain('0012_visible_runs');
  });
  it('records atomic source/outbox intake and separate quota, conflict, expiry and recovery guards', async () => {
    const text = await readFile(
      fileURLToPath(new URL('../migration-drafts/0012_visible_runs.DRAFT.sql', import.meta.url)),
      'utf8',
    );
    for (const pattern of [
      'UNIQUE(user_id,request_id)',
      'hashtextextended(u::text,13)',
      'INSERT INTO app.visible_run_sources',
      'INSERT INTO app.visible_run_outbox',
      'old.intent_digest IS DISTINCT FROM expected',
      "o.state<>'terminal'",
      'requestsPerWindow',
      'maxRunsPerAttempt',
      'maxSourceBytesPerAttempt',
      'at_time>=a.deadline_at',
      'Stale Run lease',
      "state='recovery_required'",
      'IF stopped_proof IS NULL THEN',
      "o.state='terminal'",
      'least(cutoff,clock_timestamp())',
      'DELETE FROM app.visible_run_outputs',
    ])
      expect(text).toContain(pattern);
    expect(text).not.toMatch(/SET state='queued'/); // no automatic redispatch on lease expiry
  });
});

it('bounds queue/recovery hints and rejects malformed or duplicate fenced identities', async () => {
  const hint = { runId: f.run, scope: f.scope, generation: 0, state: 'queued' };
  expect(await listQueuedVisibleRuns(database([hint]).db, 1)).toEqual([hint]);
  expect(
    await listRecoverableVisibleRuns(
      database([{ ...hint, generation: 1, state: 'recovery_required' }]).db,
      1,
    ),
  ).toHaveLength(1);
  for (const data of [
    [hint, hint],
    [{ ...hint, runId: 'bad' }],
    [{ ...hint, generation: -1 }],
    [{ ...hint, generation: 0, state: 'claimed' }],
  ])
    await expect(listQueuedVisibleRuns(database(data).db, 1)).rejects.toThrow();
  const d = database([]);
  await expect(listRecoverableVisibleRuns(d.db, 101)).rejects.toThrow();
  expect(d.execute).not.toHaveBeenCalled();
});
