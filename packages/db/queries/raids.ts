import { sql } from 'drizzle-orm';
import type { OperationalDatabase } from '../operations/curriculum';
import type { RaidView, RaidReviewDecision } from '@nextera/domain';

export async function readRaid(
  db: OperationalDatabase,
  authId: string,
  cohort: string,
  node: string,
  team?: string,
) {
  const [installed] = await db.execute(
    sql`SELECT to_regprocedure('app.read_raid(uuid,uuid,text,uuid)') IS NOT NULL AS available`,
  );
  if (!installed?.available) throw new Error('RAID_MIGRATION_REQUIRED');
  const [row] = await db.execute(
    sql`SELECT app.read_raid(${authId}::uuid,${cohort}::uuid,${node},${team ?? null}::uuid) AS data`,
  );
  return row!.data as RaidView;
}
export async function acceptRaidSubmission(
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
  const [row] = await db.execute(
    sql`SELECT app.accept_raid_submission(${input.authId}::uuid,${input.cohort}::uuid,${input.node},${input.requestId}::uuid,${input.filename},${input.size}::bigint,${input.digest}) AS id`,
  );
  return String(row!.id);
}
export async function assignRaidTeam(
  db: OperationalDatabase,
  authId: string,
  input: {
    cohort: string;
    node: string;
    requestId: string;
    name: string;
    mentor: string;
    members: string[];
  },
) {
  const [row] = await db.execute(
    sql`SELECT app.assign_raid_team(${authId}::uuid,${input.cohort}::uuid,${input.node},${input.requestId}::uuid,${input.name},${input.mentor}::uuid,${input.members}::uuid[]) AS id`,
  );
  return String(row!.id);
}
export async function reviewRaid(
  db: OperationalDatabase,
  authId: string,
  input: { attempt: string; requestId: string; decision: RaidReviewDecision; feedback: string },
) {
  const [row] = await db.execute(
    sql`SELECT app.review_raid(${authId}::uuid,${input.attempt}::uuid,${input.requestId}::uuid,${input.decision},${input.feedback}) AS data`,
  );
  return row!.data as {
    review_id?: string;
    outcome_id?: string | null;
    status?: 'owner_decision_required';
  };
}
export type RaidQueueItem = {
  team_id: string;
  team: string;
  cohort_id: string;
  cohort: string;
  node: string;
  title: string;
  owner_hold: boolean;
  can_review: boolean;
};
export async function readRaidQueue(db: OperationalDatabase, authId: string) {
  const [installed] = await db.execute(
    sql`SELECT to_regprocedure('app.raid_review_queue(uuid)') IS NOT NULL AS available`,
  );
  if (!installed?.available) return null;
  const [row] = await db.execute(sql`SELECT app.raid_review_queue(${authId}::uuid) AS data`);
  return row!.data as RaidQueueItem[];
}
export async function raidArtifactContext(
  db: OperationalDatabase,
  authId: string,
  attempt: string,
) {
  const [row] = await db.execute(
    sql`SELECT app.raid_artifact_context(${authId}::uuid,${attempt}::uuid) AS data`,
  );
  return row!.data as {
    bucket: string;
    key: string;
    filename: string;
    digest: string;
    size: number;
  };
}
