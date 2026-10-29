import Link from 'next/link';
import type { RaidQueueItem } from '@nextera/db/raids';
import { HairlineIcon } from '../learning/hairline-icon';
import s from './staff.module.css';

export function ReviewNavigation({ active }: { active: 'quests' | 'raids' }) {
  return (
    <nav className={s.reviewNavigation} aria-label="Review type">
      <Link href="/operator" aria-current={active === 'quests' ? 'page' : undefined}>
        Quest reviews
      </Link>
      <Link href="/operator/raids" aria-current={active === 'raids' ? 'page' : undefined}>
        Raid approvals
      </Link>
    </nav>
  );
}

export function QuestReviewUnavailable() {
  return (
    <section className={s.unavailable} aria-labelledby="quest-review-heading">
      <span className={s.eyebrow}>Quest reviews</span>
      <h2 id="quest-review-heading">Quest review is not available yet</h2>
      <p>
        Assigned quest reviews and their evidence cannot be loaded in this environment. No review
        decision can be recorded here.
      </p>
      <details className={s.disclosure}>
        <summary>How quest review works</summary>
        <p>
          Quests open on their configured schedule. Mentor approval determines mastery and XP
          eligibility; it does not open scheduled content.
        </p>
        <p>
          Peer and mentor assignments must come from the server. This page does not create an
          assignment or sample review questions.
        </p>
      </details>
    </section>
  );
}

export function StaffRaidQueue({
  queue,
  selectedTeam,
}: {
  queue: RaidQueueItem[] | null;
  selectedTeam?: string | undefined;
}) {
  if (queue === null)
    return (
      <section className={s.unavailable} aria-labelledby="raid-unavailable-heading">
        <h2 id="raid-unavailable-heading">Raid reviews are unavailable</h2>
        <p>
          Team access and review readiness could not be confirmed. Ask the administrator to check
          this environment, then reload the queue.
        </p>
        <Link className={s.outlineButton} href="/operator/raids">
          Reload queue <HairlineIcon name="arrow" />
        </Link>
      </section>
    );
  if (!queue.length)
    return (
      <section className={s.unavailable} aria-labelledby="raid-empty-heading">
        <h2 id="raid-empty-heading">No assigned teams</h2>
        <p>
          No Raid assignments are available for your current access. An administrator must assign
          the team and reviewing mentor before work appears here.
        </p>
      </section>
    );
  return (
    <ul className={s.queue} aria-label="Authorized Raid teams">
      {queue.map((item) => (
        <li
          key={item.team_id}
          className={s.queueRow}
          data-selected={item.team_id === selectedTeam || undefined}
        >
          <div>
            <h2>{item.team}</h2>
            <p>
              {item.title} · {item.cohort}
            </p>
          </div>
          <p className={s.queueState}>
            {item.owner_hold
              ? 'Owner decision required'
              : item.can_review
                ? 'Assigned mentor'
                : 'Read-only owner preview'}
          </p>
          <Link
            className={s.openLink}
            href={'/operator/raids?team=' + encodeURIComponent(item.team_id)}
            aria-current={item.team_id === selectedTeam ? 'page' : undefined}
          >
            Open team <HairlineIcon name="arrow" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MentorOverview({ queue }: { queue: RaidQueueItem[] | null }) {
  return (
    <>
      <div className={s.intro}>
        <span className={s.eyebrow}>Mentor / assigned work</span>
        <h1>Your review queue</h1>
        <p>Start with the work. Open the detail when you need it.</p>
      </div>
      <ReviewNavigation active="quests" />
      <QuestReviewUnavailable />
      <div className={s.supportGrid}>
        <div>
          <details className={s.disclosure}>
            <summary>Assigned Raid teams</summary>
            <StaffRaidQueue queue={queue} />
          </details>
          <details className={s.disclosure}>
            <summary>How Raid assignment works</summary>
            <p>
              An administrator assigns three learners and a reviewing mentor. A new upload requires
              fresh automated checks and a review of that exact revision.
            </p>
          </details>
        </div>
        <aside className={s.scope}>
          <span className={s.eyebrow}>Your scope</span>
          <p>
            Only authorized records appear here. A review action is available only to the assigned
            mentor.
          </p>
        </aside>
      </div>
    </>
  );
}

export function AdminOverview({ queue }: { queue: RaidQueueItem[] | null }) {
  return (
    <>
      <div className={s.intro}>
        <span className={s.eyebrow}>Admin / workspace</span>
        <h1>Keep the cohort moving.</h1>
        <p>People, schedules and assignments, with their current availability.</p>
      </div>
      <section className={s.management} aria-label="Administration capabilities">
        <div className={s.managementRow}>
          <div>
            <h2>People &amp; roles</h2>
            <p>
              Account and cohort access remain managed through the approved provisioning workflow.
            </p>
          </div>
          <span className={s.availability}>Portal management unavailable</span>
        </div>
        <div className={s.managementRow}>
          <div>
            <h2>Schedule</h2>
            <p>Quest opening times require an authoritative configured calendar.</p>
          </div>
          <span className={s.availability}>Portal management unavailable</span>
        </div>
        <div className={s.managementRow}>
          <div>
            <h2>Raid assignments</h2>
            <p>Inspect authorized teams and use the existing three-member assignment form.</p>
          </div>
          <Link className={s.openLink} href="/operator/raids#assignments">
            View assignments <HairlineIcon name="arrow" />
          </Link>
        </div>
        <div className={s.managementRow}>
          <div>
            <h2>Quest assignments</h2>
            <p>
              Automatic peer and mentor assignment is not connected to a persisted review queue yet.
            </p>
          </div>
          <span className={s.availability}>Unavailable</span>
        </div>
      </section>
      <details className={s.disclosure}>
        <summary>Authorized Raid teams</summary>
        <StaffRaidQueue queue={queue} />
      </details>
      <p className={s.note}>
        Administrator preview does not grant an assigned mentor’s approval or artifact-download
        rights.
      </p>
    </>
  );
}
