import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { readCheckpoint } from '@nextera/db/checkpoints';
import { getDatabase } from '../../../../../lib/auth/server';
import { authorizeCohortPage } from '../../../../../lib/cohorts/server';
import { readLearningOverview } from '../../../../../lib/learning/server';
import { projectEvidence } from '../../../../../lib/learning/evidence';
import { AppShell } from '../../../../../components/learning/app-shell';
import { Evidence } from '../../../../../components/learning/evidence';
import {
  Breadcrumbs,
  RecordDetails,
  WorkspaceHero,
} from '../../../../../components/learning/workspace-parts';
import LearningLoading from '../../../../../components/learning/loading';
import s from '../../../../../components/learning/workspace.module.css';
export default async function EvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { cohortId } = await params;
  const { user, cohort } = await authorizeCohortPage(cohortId);
  if (user.role !== 'learner') notFound();
  return (
    <Suspense fallback={<LearningLoading />}>
      <Content />
    </Suspense>
  );
  async function Content() {
    const [view, query] = await Promise.all([readLearningOverview(user, cohort), searchParams]);
    const checkpoints: {
      key: string;
      title: string;
      view: Awaited<ReturnType<typeof readCheckpoint>>;
    }[] = [];
    const nodes = view.nodes.filter((n) => n.kind === 'checkpoint');
    for (let i = 0; i < nodes.length; i += 4)
      checkpoints.push(
        ...(await Promise.all(
          nodes.slice(i, i + 4).map(async (n) => ({
            key: n.key,
            title: n.title,
            view: await readCheckpoint(getDatabase(), user.authUserId, cohort.id, n.key),
          })),
        )),
      );
    const records = projectEvidence(view, checkpoints, cohort.id);
    return (
      <AppShell
        user={user}
        cohort={cohort}
        active="evidence"
        nodes={view.nodes}
        updates={view.updates}
      >
        <main className={s.page}>
          <Breadcrumbs cohort={cohort} title="Progress & Evidence" />
          <WorkspaceHero
            context="Progress & Evidence"
            title="What you can actually prove"
            state={null}
            description="Durable mastery, checkpoint outcomes and safe history. A clear record of your work, without numeric skill scores."
            facts={[
              { label: 'Mastered nodes', value: String(view.counts.mastered) },
              { label: 'Checkpoint passes', value: String(view.counts.checkpointsPassed) },
              {
                label: 'Infrastructure records',
                value: String(records.filter((r) => r.category === 'system').length),
              },
            ]}
          />
          <RecordDetails title="History coverage">
            <p className={s.muted}>
              History coverage: up to 50 ordinary submissions per node, retained checkpoint
              outcomes, and up to 100 task submissions for each latest checkpoint attempt. Older
              private task details and unrestricted event payloads are not included.
            </p>
          </RecordDetails>
          <Evidence records={records} nodes={view.nodes} initialFilter={query.filter ?? 'all'} />
        </main>
      </AppShell>
    );
  }
}
