import { Suspense } from 'react';
import LearningLoading from '../../../../components/learning/loading';
import { authorizeCohortPage } from '../../../../lib/cohorts/server';
import { readLearningOverview } from '../../../../lib/learning/server';
import { AppShell } from '../../../../components/learning/app-shell';
import { Roadmap } from '../../../../components/learning/roadmap';
export default async function CohortPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string }>;
  searchParams: Promise<{
    node?: string;
    quest?: string;
    kind?: string;
    layout?: string;
    mapQuest?: string;
  }>;
}) {
  const { cohortId } = await params;
  const { user, cohort } = await authorizeCohortPage(cohortId);
  return (
    <Suspense fallback={<LearningLoading />}>
      <Content />
    </Suspense>
  );

  async function Content() {
    const [view, query] = await Promise.all([readLearningOverview(user, cohort), searchParams]);
    const kind =
      query.kind === 'challenge' || query.kind === 'checkpoint' || query.kind === 'project'
        ? query.kind
        : null;
    const selectedNode = view.nodes.find((n) => n.key === query.node);
    const selectedModule =
      view.modules.find(
        (m) => m.key === (selectedNode?.questKey ?? query.quest ?? query.mapQuest),
      ) ??
      view.modules.find((m) => m.state === 'in_progress' || m.state === 'available') ??
      view.modules[0];
    return (
      <AppShell
        user={user}
        cohort={cohort}
        active={
          kind === 'challenge' ? 'challenge' : kind === 'checkpoint' ? 'checkpoint' : 'roadmap'
        }
        nodes={view.nodes}
        updates={view.updates}
      >
        <Roadmap
          key={
            (kind ?? 'all') +
            ':' +
            (selectedModule?.key ?? '') +
            ':' +
            (selectedNode?.key ?? '') +
            ':' +
            (query.layout ?? '') +
            ':' +
            (query.quest ?? '')
          }
          view={{
            nodes: view.nodes,
            modules: view.modules,
            counts: view.counts,
            current: view.current,
            submissions: view.submissions,
          }}
          initialModule={selectedModule?.key ?? null}
          initialNode={selectedNode?.key ?? null}
          initialLayout={query.layout === 'tree' ? 'tree' : 'list'}
          questDetail={!!query.quest}
          cohortName={cohort.name}
          version={cohort.version}
          kind={kind}
          base={'/app/cohorts/' + cohort.id}
          preview={user.role !== 'learner'}
        />
      </AppShell>
    );
  }
}
