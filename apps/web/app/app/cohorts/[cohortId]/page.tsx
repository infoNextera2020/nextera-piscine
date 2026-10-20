import { Suspense } from 'react';
import LearningLoading from '../../../../components/learning/loading';
import { authorizeCohortPage } from '../../../../lib/cohorts/server';
import { readLearningOverview } from '../../../../lib/learning/server';
import { AppShell } from '../../../../components/learning/app-shell';
import { Roadmap } from '../../../../components/learning/roadmap';
import { Icon } from '../../../../components/learning/icon';
import Link from 'next/link';
import s from '../../../../components/learning/learning.module.css';
export default async function CohortPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string }>;
  searchParams: Promise<{ node?: string; quest?: string; kind?: string }>;
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
      view.modules.find((m) => m.key === (selectedNode?.questKey ?? query.quest)) ??
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
        <main>
          <section className={s.hero + ' ' + s.roadmapHero}>
            <div className={s.heroCopy}>
              <p className={s.eyebrow}>PROGRAM ROADMAP</p>
              <h1>From fundamentals to real-world engineering.</h1>
              <p className={s.heroSub}>
                Complete challenges, produce evidence, pass checkpoints, and unlock your next step.
              </p>
              <div className={s.roadmapContext}>
                <span>{cohort.name}</span>
                <span>Curriculum {cohort.version}</span>
                <Link href="/app">
                  Your cohorts <Icon name="arrow" size={13} />
                </Link>
              </div>
            </div>
          </section>
          {user.role !== 'learner' && (
            <p className={s.notice}>
              Read-only curriculum preview. No learner progress is implied.
            </p>
          )}
          <Roadmap
            key={
              (kind ?? 'all') + ':' + (selectedModule?.key ?? '') + ':' + (selectedNode?.key ?? '')
            }
            view={{ nodes: view.nodes, modules: view.modules, counts: view.counts }}
            initialModule={selectedModule?.key ?? null}
            initialNode={selectedNode?.key ?? null}
            kind={kind}
            base={'/app/cohorts/' + cohort.id}
            preview={user.role !== 'learner'}
          />
        </main>
      </AppShell>
    );
  }
}
