import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listCohorts } from '@nextera/db/cohorts';
import { authorizePage, getDatabase } from '../../../lib/auth/server';
import { AppShell } from '../../../components/learning/app-shell';
import { CohortLinks } from '../../../components/learning/command-center';
import { EmptyState } from '../../../components/learning/primitives';
import s from '../../../components/learning/learning.module.css';
export default async function RoadmapEntry({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const user = await authorizePage();
  const [cohorts, query] = await Promise.all([listCohorts(getDatabase(), user), searchParams]);
  const kind = query.kind === 'challenge' || query.kind === 'checkpoint' ? query.kind : null;
  if (cohorts.length === 1)
    redirect('/app/cohorts/' + cohorts[0]!.id + (kind ? '?kind=' + kind : ''));
  return (
    <AppShell user={user} active="roadmap">
      <main>
        <section className={s.hero + ' ' + s.roadmapHero}>
          <div className={s.heroCopy}>
            <p className={s.eyebrow}>PROGRAM ROADMAP</p>
            <h1>Your path forward.</h1>
            <p className={s.heroSub}>Choose a cohort to explore your curriculum and next steps.</p>
          </div>
        </section>
        {cohorts.length ? (
          <CohortLinks cohorts={cohorts} kind={kind} />
        ) : (
          <div className={s.card + ' ' + s.panel}>
            <EmptyState title="No active cohort assigned">
              Enrollment is controlled by your operator.
            </EmptyState>
            <Link className={s.textLink} href="/app">
              Return to Command Center
            </Link>
          </div>
        )}
      </main>
    </AppShell>
  );
}
