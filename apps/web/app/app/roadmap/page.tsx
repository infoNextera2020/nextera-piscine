import { redirect } from 'next/navigation';
import { listCohorts } from '@nextera/db/cohorts';
import { authorizePage, getDatabase } from '../../../lib/auth/server';
import { AppShell } from '../../../components/learning/app-shell';
import { CohortLinks } from '../../../components/learning/command-center';
import { JourneyEntry } from '../../../components/learning/roadmap';
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
        <JourneyEntry empty={!cohorts.length} />
        {!!cohorts.length && <CohortLinks cohorts={cohorts} kind={kind} />}
      </main>
    </AppShell>
  );
}
