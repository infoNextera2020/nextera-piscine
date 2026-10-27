import Link from 'next/link';
import { readRaidQueue } from '@nextera/db/raids';
import { authorizePage, getDatabase } from '../../../lib/auth/server';
import { RaidAssignment } from '../../../lib/raids/assignment';
import { RaidQueue } from '../../../lib/raids/queue';
import { AppShell } from '../../../components/learning/app-shell';
import s from '../../../lib/raids/raid.module.css';
export default async function RaidReviewQueue() {
  const user = await authorizePage(['operator', 'admin']);
  const queue = await readRaidQueue(getDatabase(), user.authUserId);
  return (
    <AppShell user={user} active="reviews">
      <main className={s.queuePage}>
        <Link href="/operator">Operator workspace</Link>
        <h1>Review the accepted revision</h1>
        <section aria-labelledby="raid-queue-heading">
          <h2 className={s.eyebrow} id="raid-queue-heading">
            Assigned teams
          </h2>
          <RaidQueue queue={queue} />
        </section>
        {user.role === 'admin' && queue !== null && <RaidAssignment />}
      </main>
    </AppShell>
  );
}
