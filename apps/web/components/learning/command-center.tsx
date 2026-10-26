import Link from 'next/link';
import type { AuthorizedCohort } from '@nextera/db/cohorts';
import type { LearningOverview, LearningSubmission } from '../../lib/learning/types';
import { displayState, formatMoment } from '../../lib/learning/display';
import { submissionKind, submissionNotices } from '../../lib/learning/submission-presentation';
import { HomeNextAction } from './home-next-action';
import { HairlineIcon } from './hairline-icon';
import s from './home.module.css';

export function CohortLinks({
  cohorts,
  selected,
  kind = null,
}: {
  cohorts: AuthorizedCohort[];
  selected?: string | undefined;
  kind?: 'challenge' | 'checkpoint' | 'project' | null;
}) {
  return (
    <section className={s.cohorts}>
      <h2>Your cohorts</h2>
      <nav aria-label="Your cohorts">
        {cohorts.map((c) => (
          <Link
            key={c.id}
            href={'/app/cohorts/' + c.id + (kind ? '?kind=' + kind : '')}
            aria-current={c.id === selected ? 'true' : undefined}
          >
            <span>{c.name}</span>
            <HairlineIcon name="arrow" size={20} />
          </Link>
        ))}
      </nav>
    </section>
  );
}

export function HomeWelcome({
  name,
  preview,
  empty,
}: {
  name: string;
  preview: boolean;
  empty: boolean;
}) {
  return (
    <main className={s.page}>
      <header className={s.heading}>
        <p className={s.eyebrow}>Home</p>
        <h1>Your Piscine</h1>
        <p>Welcome, {name.trim().split(/\s+/)[0] || name}.</p>
      </header>
      <section className={s.welcome}>
        <HairlineIcon name={empty ? 'folder' : 'map'} size={44} />
        <h2>{empty ? 'Your learning space is ready' : 'Explore your cohort'}</h2>
        <p>
          {empty
            ? 'No active cohorts assigned. Enrollment is controlled by your operator.'
            : 'Choose a cohort below to explore its published curriculum.'}
        </p>
        {preview && (
          <p className={s.preview}>Read-only curriculum preview. No learner progress is implied.</p>
        )}
      </section>
    </main>
  );
}

function recordDestination(record: LearningSubmission) {
  if (!record.href.includes('/challenges/')) return record.href;
  if (/[?&]tab=/.test(record.href)) return record.href.replace(/([?&]tab=)[^&#]*/, '$1submissions');
  return record.href + (record.href.includes('?') ? '&' : '?') + 'tab=submissions';
}
function resultHeading(state: LearningSubmission['state']) {
  if (state === 'queued' || state === 'running') return 'Your evaluation is pending.';
  if (state === 'cancelled') return 'This submission was cancelled.';
  if (state === 'passed') return 'Your latest submission passed.';
  if (state === 'system_error') return 'Evaluation needs attention.';
  return 'Your solution needs review.';
}
function resultFallback(state: LearningSubmission['state']) {
  if (state === 'cancelled') return 'Review history for the recorded state.';
  if (state === 'queued' || state === 'running')
    return 'Open history to check the latest recorded state.';
  if (state === 'system_error') return 'Infrastructure issue. This is not a learner failure.';
  return 'Open the feedback before your next step.';
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
  const base = '/app/cohorts/' + cohort.id;
  const current = view.nodes.length ? view.current : null;
  const latest = view.submissions[0] ?? null;
  const milestone = view.checkpoint;
  return (
    <main className={s.page} data-home-layout="desk">
      <header className={s.heading}>
        <p className={s.eyebrow}>Home</p>
        <h1>Your workspace</h1>
        <p>One next step, with your latest feedback close by.</p>
      </header>
      <div className={s.layout}>
        <HomeNextAction name={name} cohort={cohort} view={view} />
        <aside className={s.contextColumn} aria-label="Your Piscine context">
          <section className={s.latest} aria-labelledby="home-latest-title" data-home-latest>
            <h2 id="home-latest-title" className={s.eyebrow}>
              Latest submission
            </h2>
            {latest ? (
              <div className={s.result} data-state={latest.state}>
                <div className={s.recordTitle}>
                  <span className={s.state} data-state={latest.state}>
                    {displayState(latest.state)}
                  </span>
                  <h3>{latest.title}</h3>
                </div>
                <h4 className={s.srOnly}>{resultHeading(latest.state)}</h4>
                <p>{latest.feedback || resultFallback(latest.state)}</p>
                {submissionNotices(latest.state, submissionKind(latest, view.nodes)).map(
                  (notice) => (
                    <p key={notice}>{notice}</p>
                  ),
                )}
                {latest.state === 'system_error' && latest.feedback && (
                  <p>Infrastructure issue. This is not a learner failure.</p>
                )}
                <time dateTime={latest.at}>{formatMoment(latest.at)}</time>
                <Link className={s.feedbackLink} href={recordDestination(latest)}>
                  {latest.state === 'queued' ||
                  latest.state === 'running' ||
                  latest.state === 'cancelled'
                    ? 'Check history'
                    : 'Review feedback'}
                  <HairlineIcon name="arrow" size={23} />
                </Link>
              </div>
            ) : (
              <div className={s.result}>
                <h3>No submission records available.</h3>
                <p>Your recorded receipts and safe feedback will appear here.</p>
              </div>
            )}
          </section>
          <section className={s.location} aria-labelledby="home-location-title">
            <h2 id="home-location-title" className={s.eyebrow}>
              Where you are
            </h2>
            <div className={s.position}>
              <HairlineIcon name="map" size={30} />
              <div>
                <p>{cohort.name}</p>
                <h3>{current?.questTitle ?? 'No current work selected'}</h3>
                <Link className={s.journeyLink} href={base}>
                  Open Journey
                  <HairlineIcon name="arrow" size={23} />
                </Link>
              </div>
            </div>
            {view.counts.total > 0 && (
              <p
                className={s.srOnly}
                aria-label={`${view.counts.mastered} of ${view.counts.total} curriculum nodes mastered`}
              >
                {view.counts.mastered} / {view.counts.total} nodes mastered
              </p>
            )}
          </section>
        </aside>
      </div>
      {milestone && (
        <section className={s.milestone} aria-labelledby="home-milestone-title" data-home-milestone>
          <p className={s.eyebrow}>Next milestone</p>
          <div className={s.milestoneBody}>
            <HairlineIcon name="gate" size={34} />
            <div>
              <h2 id="home-milestone-title">{milestone.title}</h2>
              <h3 className={s.srOnly}>Readiness &amp; prerequisites</h3>
              <p>
                {milestone.lockedReason ??
                  'See the checkpoint’s recorded requirements and attempt status.'}
              </p>
            </div>
            <div className={s.milestoneAction}>
              <span className={s.state} data-state={view.checkpointStatus ?? milestone.state}>
                {displayState(view.checkpointStatus ?? milestone.state)}
              </span>
              <Link className={s.textLink} href={milestone.href ?? milestone.roadmapHref}>
                View milestone details
                <HairlineIcon name="arrow" size={22} />
              </Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
