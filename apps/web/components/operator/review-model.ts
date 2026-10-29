import type { RaidQueueItem } from '@nextera/db/raids';
import type { RaidAttemptView, RaidView } from '@nextera/domain';

/** Resolve only a row already returned by the server-authorized queue. */
export function selectedRaidTeam(queue: RaidQueueItem[] | null, candidate: unknown) {
  if (typeof candidate !== 'string') return null;
  return queue?.find((item) => item.team_id === candidate) ?? null;
}

export function latestRaidAttempt(attempts: readonly RaidAttemptView[]) {
  return attempts.reduce<RaidAttemptView | null>(
    (latest, item) => (!latest || item.ordinal > latest.ordinal ? item : latest),
    null,
  );
}

/** A queue selection cannot expand the already authorized team scope. */
export function confirmsSelectedTeam(view: RaidView, teamId: string) {
  return view.team?.id === teamId;
}
