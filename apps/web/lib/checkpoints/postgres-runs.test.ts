import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import { VISIBLE_RUN_READINESS_SQL } from '@nextera/db/visible-runs';
import { visibleRunStorageFixture } from '../../../../tests/fixtures/visible-runs';
import { createPostgresVisibleRunBackend } from './postgres-runs';
import { parseVisibleRunPolicy } from './visible-run-spec';
vi.mock('server-only', () => ({}));
const f = visibleRunStorageFixture(),
  actor = { id: f.id, authUserId: f.id };
const ready = {
  contract: true,
  isolated_tables: true,
  guards: true,
  private_helpers: true,
  permission_roles: true,
  owner_isolation: true,
  caller_isolation: true,
};
function fixture() {
  const authority = structuredClone(f.authority),
    failures: Record<string, string> = {};
  const execute = vi.fn(async (statement: Parameters<OperationalDatabase['execute']>[0]) => {
    const q = new PgDialect().sqlToQuery(statement as never);
    if (q.sql === VISIBLE_RUN_READINESS_SQL) return [ready];
    if (q.sql.includes('AS permitted')) return [{ permitted: true }];
    for (const [key, code] of Object.entries(failures))
      if (q.sql.includes(key)) throw { code, message: 'private SQL host password' };
    if (q.sql.includes('visible_run_context')) return [{ data: authority }];
    if (q.sql.includes('reserve_visible_run')) return [{ data: f.wire() }];
    if (q.sql.includes('read_visible_run')) return [{ data: f.wire('completed', 'a') }];
    throw new Error('Unexpected query');
  });
  const backend = createPostgresVisibleRunBackend({ execute } as unknown as OperationalDatabase);
  const input = {
    actor,
    scope: f.scope,
    requestId: f.request,
    filename: f.intent.filename,
    source: f.source,
    sha256: f.intent.sourceDigest,
    byteLength: f.intent.byteLength,
    visibleExamplesDigest: f.intent.manifestDigest,
    limits: parseVisibleRunPolicy(f.policy).limits,
  };
  return { authority, failures, execute, backend, input };
}
describe('Prepared PostgreSQL Run port adapter / injected database only', () => {
  it('opens no connection at construction and leaves production adapters unavailable', async () => {
    const d = fixture();
    expect(d.execute).not.toHaveBeenCalled();
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./editor-backends.ts', import.meta.url), 'utf8'),
    );
    expect(source).toContain('checkpointRunBackend: CheckpointRunBackend | null = null');
    expect(source).not.toContain('createPostgresVisibleRunBackend(');
  });
  it('loads validated public authority and reserves only through the dedicated RPC', async () => {
    const d = fixture();
    expect(
      (await d.backend.context(actor, { attemptId: f.id, taskKey: f.scope.taskKey })).policy.limits,
    ).toEqual(f.policy.limits);
    expect(await d.backend.accept(d.input)).toMatchObject({
      id: f.run,
      state: 'queued',
      sourceDigest: f.intent.sourceDigest,
    });
    const queries = d.execute.mock.calls.map(([s]) => new PgDialect().sqlToQuery(s as never).sql);
    expect(queries.some((q) => q.includes('app.reserve_visible_run'))).toBe(true);
    expect(queries.some((q) => q.includes('judge.') || q.includes('app.submissions'))).toBe(false);
  });
  it('supports authorized original-request and run-ID lookup without admission', async () => {
    const d = fixture();
    expect(await d.backend.readByRequest!(actor, f.scope, f.request)).toMatchObject({
      id: f.run,
      state: 'completed',
      output: 'a',
    });
    expect(await d.backend.read(actor, f.scope, f.run)).toMatchObject({ id: f.run });
    expect(
      d.execute.mock.calls.some(([s]) =>
        new PgDialect().sqlToQuery(s as never).sql.includes('app.reserve_visible_run'),
      ),
    ).toBe(false);
  });
  it.each([
    ['42501', 'FORBIDDEN'],
    ['RV001', 'CLOSED'],
    ['RV002', 'DEFINITION_MISMATCH'],
    ['RV003', 'IDEMPOTENCY_CONFLICT'],
    ['RV004', 'RATE_LIMITED'],
    ['RV007', 'UNAVAILABLE'],
    ['XX000', 'UNAVAILABLE'],
  ])('maps atomic %s privately to %s', async (code, expected) => {
    const d = fixture();
    d.failures.reserve_visible_run = code;
    await expect(d.backend.accept(d.input)).rejects.toMatchObject({
      code: expected,
      message: expected,
    });
  });
  it('rejects a different domain learner before reserving', async () => {
    const d = fixture();
    await expect(
      d.backend.accept({ ...d.input, actor: { ...actor, id: f.request } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      d.execute.mock.calls.some(([s]) =>
        new PgDialect().sqlToQuery(s as never).sql.includes('app.reserve_visible_run'),
      ),
    ).toBe(false);
  });
  it('rejects hash-valid noncanonical policy bytes and never falls back to grading', async () => {
    const d = fixture(),
      text = JSON.stringify({
        ...f.policy,
        limits: Object.fromEntries(Object.entries(f.policy.limits).reverse()),
      });
    d.authority.policyBase64 = Buffer.from(text).toString('base64');
    d.authority.policyDigest = f.rawBlobHash('nextera-visible-run-policy', text);
    await expect(d.backend.accept(d.input)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('requires separate compilation/startup/storage settings instead of supplying defaults', async () => {
    const d = fixture(),
      p = { ...f.policy, budgets: undefined },
      text = JSON.stringify(p);
    d.authority.policyBase64 = Buffer.from(text).toString('base64');
    d.authority.policyDigest = f.rawBlobHash('nextera-visible-run-policy', text);
    await expect(d.backend.accept(d.input)).rejects.toThrow();
  });
});
