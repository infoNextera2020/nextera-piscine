import { Suspense } from 'react';
import { listCohorts } from '@nextera/db/cohorts';
import { authorizePage, getDatabase } from '../../../lib/auth/server';
import { AppShell } from '../../../components/learning/app-shell';
import LearningLoading from '../../../components/learning/loading';
import { QuestReviewsView } from '../../../components/learning/quest-reviews-view';

export const dynamic = 'force-dynamic';

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ cohort?: string }>;
}) {
  const user = await authorizePage();
  const [cohorts, query] = await Promise.all([listCohorts(getDatabase(), user), searchParams]);
  const cohort = query.cohort ? cohorts.find((c) => c.id === query.cohort) : cohorts[0];

  return (
    <Suspense fallback={<LearningLoading />}>
      <AppShell user={user} cohort={cohort ?? null} active="reviews">
        <QuestReviewsView role={user.role} defaultCohortId={cohort?.id} />
      </AppShell>
    </Suspense>
  );
}
