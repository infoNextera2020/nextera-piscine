import { Suspense } from 'react';
import LearningLoading from '../../components/learning/loading';
import { notFound } from 'next/navigation';
import { listCohorts } from '@nextera/db/cohorts';
import { authorizePage, getDatabase } from '../../lib/auth/server';
import { readLearningOverview } from '../../lib/learning/server';
import { AppShell } from '../../components/learning/app-shell';
import { CohortLinks, CommandCenter } from '../../components/learning/command-center';
import { EmptyState } from '../../components/learning/primitives';
import s from '../../components/learning/learning.module.css';

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ cohort?: string }>;
}) {
  const user = await authorizePage();
  const [cohorts, query] = await Promise.all([listCohorts(getDatabase(), user), searchParams]);
  const cohort = query.cohort ? cohorts.find((c) => c.id === query.cohort) : cohorts[0];
  if (query.cohort && !cohort) notFound();
  return (
    <Suspense fallback={<LearningLoading />}>
      <Content />
    </Suspense>
  );

  async function Content() {
    const view =
      cohort && user.role === 'learner' ? await readLearningOverview(user, cohort) : null;
    return (
      <AppShell
        user={user}
        cohort={cohort ?? null}
        active="command"
        nodes={view?.nodes ?? []}
        updates={view?.updates ?? []}
      >
        {cohort && view ? (
          <CommandCenter name={user.displayName} cohort={cohort} view={view} />
        ) : (
          <main>
            <section className={s.hero + ' ' + s.homeHero}>
              <div className={s.heroCopy}>
                <p className={s.eyebrow}>NEXTERA PISCINE</p>
                <h1>Welcome, {user.displayName.trim().split(/\s+/)[0]}.</h1>
                <p className={s.heroSub}>
                  {user.role === 'learner'
                    ? 'Your next chapter starts here.'
                    : 'Your cohort overview.'}
                </p>
              </div>
            </section>
            {user.role !== 'learner' && (
              <p className={s.notice}>
                Read-only curriculum preview. No learner progress is implied.
              </p>
            )}
            {!cohorts.length && (
              <div className={s.card + ' ' + s.panel}>
                <EmptyState title="Your learning space is ready">
                  No active cohorts assigned. Enrollment is controlled by your operator.
                </EmptyState>
              </div>
            )}
          </main>
        )}
        {!!cohorts.length && <CohortLinks cohorts={cohorts} selected={cohort?.id} />}
      </AppShell>
    );
  }
}
