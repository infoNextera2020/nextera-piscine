import { sql } from 'drizzle-orm';
import type { OperationalDatabase } from './curriculum';

/** Product service only. An attempt ID is the sole caller-selected value. */
export async function finalizeCheckpoint(db: OperationalDatabase, attemptId: string) {
  const [row] = await db.execute(sql`SELECT app.finalize_checkpoint(${attemptId}::uuid) AS id`);
  return row?.id as string | null;
}
/** Restartable, bounded scans run independently of browser and web process. */
export async function reconcileCheckpoints(db: OperationalDatabase, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_BATCH');
  const rows = await db.execute(
    sql`SELECT id FROM app.checkpoint_attempts WHERE status='evaluating' OR (status='active' AND deadline_at<=clock_timestamp()) ORDER BY deadline_at,id LIMIT ${limit}`,
  );
  const outcomes: { id: string; status: string }[] = [];
  for (const row of rows) {
    try {
      const id = await finalizeCheckpoint(db, String(row.id));
      outcomes.push({ id: String(row.id), status: id ? 'applied' : 'pending' });
    } catch {
      outcomes.push({ id: String(row.id), status: 'attention_required' });
    }
  }
  const cooldowns = await db.execute(
    sql`SELECT id FROM app.checkpoint_attempts WHERE status='failed' AND normal_slot=1 AND retake_announced_at IS NULL AND completed_at+interval '24 hours'<=clock_timestamp() ORDER BY completed_at,id LIMIT ${limit}`,
  );
  for (const row of cooldowns)
    await db.execute(sql`SELECT app.announce_checkpoint_retake(${row.id}::uuid)`);
  return outcomes;
}
