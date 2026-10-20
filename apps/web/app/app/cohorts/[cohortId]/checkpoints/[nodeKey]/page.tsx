import { Suspense } from 'react';
import { authorizedCheckpoint } from '../../../../../../lib/learning/checkpoint-server';
import { Checkpoint } from '../../../../../../lib/checkpoints/checkpoint';
import { AppShell } from '../../../../../../components/learning/app-shell';
import { Breadcrumbs, WorkspaceHero } from '../../../../../../components/learning/workspace-parts';
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
          <WorkspaceHero
            context={node.questTitle}
            title={node.title}
            state={checkpoint.attempt?.status ?? node.state}
            description="Four checkpoint-specific tasks feed one authoritative progression gate. Demonstrate transfer through trusted evaluation."
            facts={[
              { label: 'Duration', value: '90 minutes' },
              { label: 'Tasks', value: '4' },
              { label: 'Pass threshold', value: '3 / 4' },
              { label: 'Learner results', value: 'Up to 3 per task' },
            ]}
          />
          <Checkpoint cohort={cohort.id} node={nodeKey} initial={checkpoint} />
        </main>
      </AppShell>
    );
  }
}
