import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { authorizedCheckpoint } from '../../../../../../../lib/learning/checkpoint-server';
import { AppShell } from '../../../../../../../components/learning/app-shell';
import { CheckpointResult } from '../../../../../../../components/learning/checkpoint-result';
import { Breadcrumbs } from '../../../../../../../components/learning/workspace-parts';
import LearningLoading from '../../../../../../../components/learning/loading';
import s from '../../../../../../../components/learning/workspace.module.css';
export default async function ResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string; nodeKey: string }>;
  searchParams: Promise<{ attempt?: string }>;
}) {
  const { cohortId, nodeKey } = await params;
  const { user, cohort, checkpoint, overview } = await authorizedCheckpoint(cohortId, nodeKey);
  const query = await searchParams;
  if (query.attempt && !checkpoint.history.some((h) => h.id === query.attempt)) notFound();
  return (
    <Suspense fallback={<LearningLoading />}>
      <Content />
    </Suspense>
  );
  async function Content() {
    const view = await overview();
    return (
      <AppShell
        user={user}
        cohort={cohort}
        active="checkpoint"
        nodes={view.nodes}
        updates={view.updates}
      >
        <main className={s.page}>
          <Breadcrumbs cohort={cohort} title="Checkpoint result" />
          <CheckpointResult
            view={checkpoint}
            overview={view}
            cohort={cohort.id}
            node={nodeKey}
            attemptId={query.attempt}
          />
        </main>
      </AppShell>
    );
  }
}
