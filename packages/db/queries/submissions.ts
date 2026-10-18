import 'server-only';
import { sql } from 'drizzle-orm';
import type { OperationalDatabase } from '../operations/curriculum';
import type { SubmissionRules, SubmissionState } from '@nextera/domain';

export async function submissionContext(
  db: OperationalDatabase,
  authId: string,
  cohort: string,
  node: string,
) {
  const rows = await db.execute(
    sql`SELECT app.submission_context(${authId}::uuid,${cohort}::uuid,${node}) AS context`,
  );
  return rows[0]!.context as { user_id: string; rules: SubmissionRules; kind: string };
}
export async function acceptSubmission(
  db: OperationalDatabase,
  input: {
    authId: string;
    cohort: string;
    node: string;
    requestId: string;
    filename: string;
    size: number;
    digest: string;
  },
) {
  const rows = await db.execute(
    sql`SELECT app.accept_submission(${input.authId}::uuid,${input.cohort}::uuid,${input.node},${input.requestId}::uuid,${input.filename},${input.size}::bigint,${input.digest}) AS id`,
  );
  return String(rows[0]!.id);
}
export type SubmissionSummary = {
  id: string;
  node_key: string;
  created_at: string;
  state: SubmissionState;
  feedback: { verdict: string; message: string } | null;
};
export async function readSubmissions(
  db: OperationalDatabase,
  authId: string,
  cohort: string,
  node: string,
) {
  const rows = await db.execute(
    sql`SELECT app.read_submissions(${authId}::uuid,${cohort}::uuid,${node}) AS history`,
  );
  return rows[0]!.history as SubmissionSummary[];
}
