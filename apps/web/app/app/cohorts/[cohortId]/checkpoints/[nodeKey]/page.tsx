import { Suspense } from 'react';
import { authorizedCheckpoint } from '../../../../../../lib/learning/checkpoint-server';
import { Checkpoint } from '../../../../../../lib/checkpoints/checkpoint';
import { AppShell } from '../../../../../../components/learning/app-shell';
import { Breadcrumbs } from '../../../../../../components/learning/workspace-parts';
import LearningLoading from '../../../../../../components/learning/loading';
import s from '../../../../../../components/learning/workspace.module.css';
export default async function CheckpointPage({
  params,
}: {
  params: Promise<{ cohortId: string; nodeKey: string }>;
}) {
  const { cohortId, nodeKey } = await params;
  const { user, cohort, checkpoint, overview } = await authorizedCheckpoint(cohortId, nodeKey);
  return (
    <Suspense fallback={<LearningLoading />}>
      <Content />
    </Suspense>
  );
  async function Content() {
    const view = await overview();
    const node = view.nodes.find((n) => n.key === nodeKey)!;
    return (
      <AppShell
        user={user}
        cohort={cohort}
        active="checkpoint"
        nodes={view.nodes}
        updates={view.updates}
      >
        <main className={s.page}>
          <Breadcrumbs cohort={cohort} title={node.title} />
          <Checkpoint cohort={cohort.id} node={nodeKey} title={node.title} initial={checkpoint} />
        </main>
      </AppShell>
    );
  }
}
