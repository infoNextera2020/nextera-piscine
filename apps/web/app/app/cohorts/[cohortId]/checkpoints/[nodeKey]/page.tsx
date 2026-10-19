import Link from 'next/link';
import { readCheckpoint } from '@nextera/db/checkpoints';
import { getDatabase, requireDomainUser } from '../../../../../../lib/auth/server';
import { Checkpoint } from '../../../../../../lib/checkpoints/checkpoint';
import { notFound } from 'next/navigation';
export default async function CheckpointPage({
  params,
}: {
  params: Promise<{ cohortId: string; nodeKey: string }>;
}) {
  const { cohortId, nodeKey } = await params;
  const user = await requireDomainUser();
  if (
    user.role !== 'learner' ||
    !/^[a-z0-9-]{1,100}$/.test(nodeKey) ||
    !/^[a-f0-9-]{36}$/.test(cohortId)
  )
    notFound();
  let view;
  try {
    view = await readCheckpoint(getDatabase(), user.authUserId, cohortId, nodeKey);
  } catch {
    notFound();
  }
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-16">
      <Link href={`/app/cohorts/${cohortId}`}>Cohort map</Link>
      <h1>Checkpoint</h1>
      <Checkpoint cohort={cohortId} node={nodeKey} initial={view} />
    </main>
  );
}
