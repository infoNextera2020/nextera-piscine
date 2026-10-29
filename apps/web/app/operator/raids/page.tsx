import Link from 'next/link';
import { readRaid, readRaidQueue } from '@nextera/db/raids';
import { authorizePage, getDatabase } from '../../../lib/auth/server';
import { RaidAssignment } from '../../../lib/raids/assignment';
import { StaffShell } from '../../../components/operator/staff-shell';
import { ReviewNavigation, StaffRaidQueue } from '../../../components/operator/staff-overview';
import { StaffRaidReviewDetail } from '../../../components/operator/raid-review-detail';
import { confirmsSelectedTeam, selectedRaidTeam } from '../../../components/operator/review-model';
import s from '../../../components/operator/staff.module.css';

export default async function RaidReviewQueue({
  searchParams,
}: {
  searchParams: Promise<{ team?: string | string[] }>;
}) {
  const user = await authorizePage(['operator', 'admin']);
  const db = getDatabase();
  const queue = await readRaidQueue(db, user.authUserId).catch(() => null);
  const { team } = await searchParams;
  const selected = selectedRaidTeam(queue, team);
  const detail = selected
    ? await readRaid(
        db,
        user.authUserId,
        selected.cohort_id,
        selected.node,
        selected.team_id,
      ).catch(() => null)
    : null;
  const initial =
    detail && selected && confirmsSelectedTeam(detail, selected.team_id) ? detail : null;
  return (
    <StaffShell
      user={{ displayName: user.displayName, role: user.role === 'admin' ? 'admin' : 'operator' }}
      active="raids"
    >
      {selected ? (
        <>
          <Link className={s.backLink} href="/operator/raids">
            Return to Raid queue
          </Link>
          <StaffRaidReviewDetail
            key={selected.team_id}
            cohort={selected.cohort_id}
            node={selected.node}
            team={selected.team_id}
            title={selected.title}
            initial={initial}
          />
        </>
      ) : (
        <>
          <div className={s.intro}>
            <span className={s.eyebrow}>
              {user.role === 'admin' ? 'Admin / authorized teams' : 'Mentor / assigned teams'}
            </span>
            <h1>Raid approvals</h1>
            <p>Automated checks and mentor review, for one exact accepted revision.</p>
          </div>
          {user.role === 'operator' ? (
            <ReviewNavigation active="raids" />
          ) : (
            <Link className={s.backLink} href="/operator">
              Return to overview
            </Link>
          )}
          <StaffRaidQueue queue={queue} />
          {team !== undefined && (
            <p className={s.alert} role="alert">
              This team is not available in your authorized queue. No review detail has been loaded.
            </p>
          )}
          {user.role === 'admin' && queue !== null && (
            <details id="assignments" className={s.disclosure}>
              <summary>Assign a Raid team</summary>
              <p>
                Use existing provisioned accounts. This operation does not grant roles, resolve an
                owner hold or award completion.
              </p>
              <RaidAssignment />
            </details>
          )}
        </>
      )}
    </StaffShell>
  );
}
