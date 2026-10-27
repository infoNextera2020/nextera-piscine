import Link from 'next/link';
import type { RaidQueueItem } from '@nextera/db/raids';
import { HairlineIcon } from '../../components/learning/hairline-icon';
import s from './raid.module.css';
export function RaidQueue({ queue }: { queue: RaidQueueItem[] | null }) {
  if (queue === null)
    return (
      <p className={s.queueEmpty}>
        Team submission and mentor review are unavailable in this environment. Ask the owner to
        complete the approved setup.
      </p>
    );
  if (!queue.length)
    return (
      <p className={s.queueEmpty}>No team assignments are available for your current access.</p>
    );
  return (
    <ul className={s.queueList}>
      {queue.map((item) => (
        <li key={item.team_id}>
          <Link
            href={`/app/cohorts/${encodeURIComponent(item.cohort_id)}/challenges/${encodeURIComponent(item.node)}?team=${encodeURIComponent(item.team_id)}`}
          >
            <strong>{item.team}</strong>
            <p>{item.title}</p>
            <p>
              {item.cohort} · {item.can_review ? 'Assigned mentor' : 'Owner preview'}
            </p>
            {item.owner_hold && (
              <p className={s.hold}>Owner decision required: a frozen member lost access.</p>
            )}
            <span>
              Open Raid workspace <HairlineIcon name="arrow" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
