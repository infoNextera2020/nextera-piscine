import Link from 'next/link';
import type { AuthorizedCohort } from '@nextera/db/cohorts';
import type { LearningOverview } from '../../lib/learning/types';
import { displayState, formatMoment } from '../../lib/learning/display';
import { EmptyState, Panel, ProgressBar, ProgressRing, StatusBadge } from './primitives';
import { Icon } from './icon';
import s from './learning.module.css';

export function CohortLinks({
  cohorts,
  selected,
  kind = null,
}: {
  cohorts: AuthorizedCohort[];
  selected?: string | undefined;
  kind?: 'challenge' | 'checkpoint' | null;
}) {
  return (
    <section className={s.cohortStrip}>
      <h2>Your cohorts</h2>
      <nav aria-label="Your cohorts">
        {cohorts.map((c) => (
          <Link
            key={c.id}
            href={'/app/cohorts/' + c.id + (kind ? '?kind=' + kind : '')}
            aria-current={c.id === selected ? 'true' : undefined}
          >
            {c.name}
            <Icon name="arrow" size={13} />
          </Link>
        ))}
      </nav>
    </section>
  );
}
export function CommandCenter({
  name,
  cohort,
  view,
}: {
  name: string;
  cohort: AuthorizedCohort;
  view: LearningOverview;
}) {
  const c = view.counts;
  const roadmap = '/app/cohorts/' + cohort.id;
  const active = view.submissions
    .filter((item) => item.state === 'queued' || item.state === 'running')
    .slice(0, 4);
  const latestMastery = view.nodes
    .filter((n) => n.masteredAt)
    .sort((a, b) => b.masteredAt!.localeCompare(a.masteredAt!))[0];
  return (
    <main className={s.dashboard}>
      <section className={s.hero + ' ' + s.homeHero}>
        <div className={s.heroCopy}>
          <p className={s.eyebrow}>NEXTERA PISCINE</p>
          <h1>Welcome back, {name.trim().split(/\s+/)[0]}.</h1>
          <p className={s.heroSub}>
            Keep building. Every step forward starts with your next challenge.
          </p>
          <div className={s.heroMeta}>
            <div>
              <Icon name="map" />
              <span>
                <b>{cohort.name}</b>
                <small>Your Piscine</small>
              </span>
            </div>
            <div>
              <Icon name="folder" />
              <span>
                <b>Curriculum {cohort.version}</b>
                <small>
                  {view.modules.length} quests · {c.total} nodes
                </small>
              </span>
            </div>
            <div>
              <Icon name="clock" />
              <span>
                <b>
                  {new Intl.DateTimeFormat('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    timeZone: 'Africa/Cairo',
                  }).format(cohort.startsAt)}
                </b>
                <small>Cohort start date</small>
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className={s.kpis} aria-label="Piscine progress">
        <article className={s.card + ' ' + s.kpi}>
          <h2>Piscine Progress</h2>
          <div className={s.ringLayout}>
            <ProgressRing done={c.mastered} total={c.total} />
            <div>
              <strong>
                {view.modules.filter((m) => m.state === 'mastered').length} / {view.modules.length}
              </strong>
              <small>Quests complete</small>
              <Link className={s.textLink} href={roadmap}>
                Your roadmap <Icon name="arrow" size={13} />
              </Link>
            </div>
          </div>
        </article>
        <article className={s.card + ' ' + s.kpi}>
          <h2>Challenges Completed</h2>
          <div className={s.kpiValue}>
            {c.challengesPassed}
            <small> / {c.challenges}</small>
          </div>
          <p>Mastered challenge nodes</p>
          <ProgressBar done={c.challengesPassed} total={c.challenges} label="Challenges mastered" />
        </article>
        <article className={s.card + ' ' + s.kpi}>
          <h2>Checkpoints Passed</h2>
          <div className={s.kpiValue}>
            {c.checkpointsPassed}
            <small> / {c.checkpoints}</small>
          </div>
          <p>
            {c.checkpoints ? 'Permanent checkpoint passes' : 'No checkpoints in this curriculum'}
          </p>
          {c.checkpoints > 0 && (
            <ProgressBar
              done={c.checkpointsPassed}
              total={c.checkpoints}
              label="Checkpoint nodes mastered"
            />
          )}
        </article>
        <article className={s.card + ' ' + s.kpi}>
          <h2>Current Work</h2>
          <div className={s.kpiValue}>
            {c.started}
            <small> in progress</small>
          </div>
          <p>{c.projects ? c.projectsActive + ' active projects' : 'Keep your momentum'}</p>
          <div className={s.kpiSymbol}>
            <Icon name="code" size={26} />
          </div>
        </article>
        <article className={s.card + ' ' + s.kpi}>
          <h2>Ready to Start</h2>
          <div className={s.kpiValue}>
            {c.available}
            <small> nodes</small>
          </div>
          <p>Available on your roadmap</p>
          <Link className={s.textLink} href={roadmap}>
            Find your next step <Icon name="arrow" size={13} />
          </Link>
        </article>
      </section>
      <section className={s.homeMid}>
        <Panel
          title={view.current?.kind === 'project' ? 'Current Project' : 'Current Challenge'}
          action={
            <Link className={s.textLink} href={view.current?.href ?? roadmap}>
              Open <Icon name="arrow" size={13} />
            </Link>
          }
        >
          {view.current ? (
            <>
              <div className={s.summaryRow}>
                <span className={s.iconBox}>
                  <Icon name={view.current.kind === 'project' ? 'folder' : 'code'} size={26} />
                </span>
                <div>
                  <h3>{view.current.title}</h3>
                  <StatusBadge state={view.current.state} />
                </div>
              </div>
              <p className={s.description}>
                {view.currentDescription ??
                  'Explore the requirements, write your solution locally, and submit your work.'}
              </p>
              <ul className={s.checklist}>
                <li>
                  <Icon name="map" size={15} />
                  {view.current.questTitle}
                </li>
                <li>
                  <Icon name="evidence" size={15} />
                  {view.current.prerequisites.length
                    ? 'Requires: ' + view.current.prerequisites.join(', ')
                    : 'Foundation challenge — no prerequisites'}
                </li>
                <li>
                  <Icon name="code" size={15} />
                  {view.current.skills.join(' · ') || 'Practice through building'}
                </li>
              </ul>
              <Link className={s.primaryButton} href={view.current.href!}>
                Continue {view.current.kind === 'project' ? 'Project' : 'Challenge'}{' '}
                <Icon name="arrow" size={15} />
              </Link>
            </>
          ) : (
            <EmptyState title="No challenge ready right now">
              Explore your roadmap for your next step.
            </EmptyState>
          )}
        </Panel>
        <Panel
          title="Upcoming Checkpoint"
          action={
            <Link className={s.textLink} href={view.checkpoint?.roadmapHref ?? roadmap}>
              View <Icon name="arrow" size={13} />
            </Link>
          }
        >
          {view.checkpoint ? (
            <>
              <div className={s.summaryRow}>
                <span className={s.iconBox + ' ' + s.goldIcon}>
                  <Icon name="gate" size={26} />
                </span>
                <div>
                  <h3>{view.checkpoint.title}</h3>
                  <StatusBadge state={view.checkpointStatus} />
                </div>
              </div>
              <p className={s.description}>
                A transfer gate. Four checkpoint-specific tasks, 90 minutes, and three task passes
                to continue.
              </p>
              <ul className={s.checklist}>
                <li>
                  <Icon name="gate" size={15} />
                  Pass 3 of 4 tasks
                </li>
                <li>
                  <Icon name="clock" size={15} />
                  90-minute attempt
                </li>
                <li>
                  <Icon name="evidence" size={15} />
                  {view.checkpoint.lockedReason ??
                    'Open your checkpoint to view attempt availability.'}
                </li>
              </ul>
              <Link
                className={s.primaryButton + ' ' + s.outlineGold}
                href={view.checkpoint.href ?? view.checkpoint.roadmapHref}
              >
                View Checkpoint <Icon name="arrow" size={15} />
              </Link>
            </>
          ) : (
            <EmptyState
              title={c.checkpoints ? 'All checkpoints passed' : 'No checkpoint scheduled'}
            >
              {c.checkpoints
                ? 'Your recorded passes are permanent.'
                : 'Checkpoint gates appear when included in your curriculum.'}
            </EmptyState>
          )}
        </Panel>
        <Panel
          title="Roadmap Preview"
          action={
            <Link className={s.textLink} href={roadmap}>
              Full Roadmap <Icon name="arrow" size={13} />
            </Link>
          }
        >
          <div className={s.routePreview}>
            {view.modules.slice(0, 4).map((m, i) => (
              <Link
                key={m.key}
                href={roadmap + '?quest=' + encodeURIComponent(m.key)}
                data-state={m.state}
              >
                <span>
                  {m.state === 'mastered' ? (
                    <Icon name="check" size={17} />
                  ) : (
                    String(i + 1).padStart(2, '0')
                  )}
                </span>
                <strong>{m.title}</strong>
                <small>{displayState(m.state)}</small>
              </Link>
            ))}
          </div>
          <ul className={s.checklist}>
            {view.modules.slice(0, 4).map((m) => (
              <li key={m.key}>
                <span className={s.statusDot} data-state={m.state} />
                <span>{m.title}</span>
                <small>
                  {m.mastered} / {m.nodes.length}
                </small>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
      <section className={s.homeBottom}>
        <Panel
          title="Recent Activity"
          action={
            <Link className={s.textLink} href={roadmap}>
              Roadmap <Icon name="arrow" size={13} />
            </Link>
          }
        >
          {view.updates.length ? (
            <ul className={s.feed}>
              {view.updates.slice(0, 4).map((u) => (
                <li key={u.id}>
                  <span className={s.statusDot} data-state={u.state} />
                  <div>
                    <Link href={u.href}>{u.title}</Link>
                    <small>{formatMoment(u.at)}</small>
                  </div>
                  <StatusBadge state={u.state} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Your activity starts here">
              Accepted work and progression will appear here.
            </EmptyState>
          )}
        </Panel>
        <Panel title="Active Submissions">
          {active.length ? (
            <ul className={s.feed}>
              {active.map((item) => (
                <li key={item.id}>
                  <Icon name="code" size={15} />
                  <div>
                    <Link href={item.href}>{item.title}</Link>
                    <small>Submitted {formatMoment(item.at)}</small>
                  </div>
                  <StatusBadge state={item.state} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing currently evaluating">
              No queued or running submissions in your recent history.
            </EmptyState>
          )}
        </Panel>
        <Panel title="Evidence Snapshot">
          <ul className={s.feed}>
            <li>
              <Icon name="evidence" size={16} />
              <span>{c.mastered} mastered nodes</span>
              <small>PROOF</small>
            </li>
            <li>
              <Icon name="gate" size={16} />
              <span>{c.checkpointsPassed} checkpoint passes</span>
              <small>GATE</small>
            </li>
            {latestMastery ? (
              <li>
                <span className={s.statusDot} data-state="mastered" />
                <div>
                  <Link href={latestMastery.roadmapHref}>{latestMastery.title}</Link>
                  <small>Mastered {formatMoment(latestMastery.masteredAt!)}</small>
                </div>
              </li>
            ) : (
              <li>
                <span className={s.muted}>Your first mastery will appear here.</span>
              </li>
            )}
          </ul>
        </Panel>
      </section>
    </main>
  );
}
