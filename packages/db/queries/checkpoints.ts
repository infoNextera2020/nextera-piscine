import { sql } from 'drizzle-orm';
import type { OperationalDatabase } from '../operations/curriculum';
export type CheckpointView = {
  server_now: string;
  eligible: boolean;
  attempt: null | {
    id: string;
    status: string;
    normal_slot: number;
    kind: string;
    started_at: string;
    deadline_at: string;
    completed_at: string | null;
    retake_at: string | null;
  };
  tasks: {
    key: string;
    title: string;
    passed: boolean;
    reserved: number;
    subject: string;
    rules: { required_files: string[]; max_size_kb: number };
  }[];
  submissions: {
    id: string;
    task_key: string;
    state: string;
    created_at: string;
    feedback?: { message?: string };
  }[];
  history: {
    id: string;
    status: string;
    points: number | null;
    normal_slot: number;
    kind: string;
    started_at: string;
    deadline_at: string;
    completed_at: string | null;
    outcome_id: string | null;
  }[];
  replacement_available: boolean;
};
export async function readCheckpoint(
  db: OperationalDatabase,
  authId: string,
  cohortId: string,
  nodeKey: string,
) {
  const [row] = await db.execute(
    sql`SELECT app.read_checkpoint(${authId}::uuid,${cohortId}::uuid,${nodeKey}) AS data`,
  );
  return row!.data as CheckpointView;
}
export async function startCheckpoint(
  db: OperationalDatabase,
  authId: string,
  cohortId: string,
  nodeKey: string,
  requestId: string,
) {
  const [row] = await db.execute(
    sql`SELECT app.start_checkpoint(${authId}::uuid,${cohortId}::uuid,${nodeKey},${requestId}::uuid) AS id`,
  );
  return String(row!.id);
}
export async function finishCheckpoint(db: OperationalDatabase, authId: string, attemptId: string) {
  await db.execute(sql`SELECT app.finish_checkpoint(${authId}::uuid,${attemptId}::uuid)`);
}
export async function checkpointTaskContext(
  db: OperationalDatabase,
  authId: string,
  attemptId: string,
  taskKey: string,
) {
  const [row] = await db.execute(
    sql`SELECT app.checkpoint_task_context(${authId}::uuid,${attemptId}::uuid,${taskKey}) AS data`,
  );
  return row!.data as {
    user_id: string;
    cohort_id: string;
    rules: { required_files: string[]; max_size_kb: number };
  };
}
export async function acceptCheckpointSubmission(
  db: OperationalDatabase,
  authId: string,
  attemptId: string,
  taskKey: string,
  requestId: string,
  filename: string,
  bytes: number,
  hash: string,
) {
  const [row] = await db.execute(
    sql`SELECT app.accept_checkpoint_submission(${authId}::uuid,${attemptId}::uuid,${taskKey},${requestId}::uuid,${filename},${bytes},${hash}) AS id`,
  );
  return String(row!.id);
}
export async function grantCheckpointReplacement(
  db: OperationalDatabase,
  authId: string,
  attemptId: string,
) {
  const [row] = await db.execute(
    sql`SELECT app.grant_checkpoint_replacement(${authId}::uuid,${attemptId}::uuid) AS id`,
  );
  return String(row!.id);
}
