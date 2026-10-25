import { Suspense } from 'react';
import LearningLoading from '../../components/learning/loading';
import { notFound } from 'next/navigation';
import { listCohorts } from '@nextera/db/cohorts';
import { authorizePage, getDatabase } from '../../lib/auth/server';
import { readLearningOverview } from '../../lib/learning/server';
import { AppShell } from '../../components/learning/app-shell';
import { CohortLinks, CommandCenter, HomeWelcome } from '../../components/learning/command-center';

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
          <HomeWelcome
            name={user.displayName}
            preview={user.role !== 'learner'}
            empty={!cohorts.length}
          />
        )}
        {!!cohorts.length && <CohortLinks cohorts={cohorts} selected={cohort?.id} />}
      </AppShell>
    );
  }
}
