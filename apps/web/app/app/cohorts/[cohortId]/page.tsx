import Link from 'next/link';
import { readCohortNodes, readPrerequisites } from '@nextera/db/cohorts';
import { presentNode } from '@nextera/domain';
import { getDatabase } from '../../../../lib/auth/server';
import { authorizeCohortPage } from '../../../../lib/cohorts/server';

export default async function CohortPage({ params }: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await params;
  const { user, cohort } = await authorizeCohortPage(cohortId);
  const [nodes, edges] = await Promise.all([
    readCohortNodes(getDatabase(), user, cohort.id),
    readPrerequisites(getDatabase(), user, cohort.id),
  ]);
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-16">
      <Link href="/app" className="text-teal-300">
        Your cohorts
      </Link>
      <h1 className="text-3xl font-semibold">{cohort.name}</h1>
      <p>
        Curriculum {cohort.curriculumKey} · {cohort.version}
      </p>
      {user.role !== 'learner' && (
        <p>Read-only curriculum preview. No learner progress is implied.</p>
      )}
      <ul className="space-y-4">
        {nodes.map((node) => {
          if (!node.state && user.role === 'learner')
            throw new Error('Enrolled learner has incomplete progress.');
          const prerequisiteKeys = edges
            .filter((edge) => edge.to === node.nodeKey)
            .map((edge) => edge.from);
          const view = node.state
            ? presentNode(
                node.state,
                prerequisiteKeys.map((key) => nodes.find((n) => n.nodeKey === key)?.title ?? key),
              )
            : null;
          const accessible = view?.accessible || user.role !== 'learner';
          return (
            <li key={node.nodeKey} className="space-y-2 rounded border border-slate-700 p-4">
              <h2 className="text-xl">{node.title}</h2>
              <p className="font-mono text-sm">{view?.label ?? 'PREVIEW'}</p>
              <p className="text-sm text-slate-400">{node.questTitle}</p>
              {view?.lockedReason && <p>{view.lockedReason}</p>}
              {accessible && (
                <Link
                  className="text-teal-300"
                  href={`/app/cohorts/${cohort.id}/${node.kind === 'checkpoint' && user.role === 'learner' ? 'checkpoints' : 'challenges'}/${node.nodeKey}`}
                >
                  Read {node.title}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
