import Link from 'next/link';
import { readRaidQueue } from '@nextera/db/raids';
import { authorizePage, getDatabase } from '../../../lib/auth/server';
import { RaidAssignment } from '../../../lib/raids/assignment';
import s from '../../../components/learning/challenge.module.css';
export default async function RaidReviewQueue() {
  const user = await authorizePage(['operator', 'admin']);
  const queue = await readRaidQueue(getDatabase(), user.authUserId);
  return (
    <main className={s.page} style={{ maxWidth: 1100, marginInline: 'auto', padding: 24 }}>
      <Link href="/operator">Operator workspace</Link>
      <h1 style={{ fontSize: 32, marginBlock: '24px' }}>Raid review</h1>
      <section className={s.historyCard}>
        <h2>Assigned teams</h2>
        {queue === null ? (
          <p>
            Team submission and mentor review are unavailable in this environment. Ask the owner to
            complete the approved setup.
          </p>
        ) : !queue.length ? (
          <p>No team assignments are available for your current access.</p>
        ) : (
          <ul className={s.history}>
            {queue.map((item) => (
              <li key={item.team_id}>
                <Link
                  href={`/app/cohorts/${item.cohort_id}/challenges/${item.node}?team=${item.team_id}`}
                >
                  <strong>{item.team}</strong> · {item.title}
                  <p className={s.muted}>
                    {item.cohort} · {item.can_review ? 'Assigned mentor' : 'Owner preview'}
                  </p>
                  {item.owner_hold && <p>Owner decision required: a frozen member lost access.</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {user.role === 'admin' && queue !== null && <RaidAssignment />}
    </main>
  );
}
