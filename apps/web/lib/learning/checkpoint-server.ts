import 'server-only';
import { notFound } from 'next/navigation';
import { readCheckpoint } from '@nextera/db/checkpoints';
import { authorizeCohortPage } from '../cohorts/server';
import { getDatabase } from '../auth/server';
import { readLearningOverview } from './server';
import { checkpointPresentation } from './checkpoint-presentation';

export async function authorizedCheckpoint(cohortId: string, nodeKey: string) {
  const { user, cohort } = await authorizeCohortPage(cohortId);
  if (user.role !== 'learner' || !/^[a-z0-9-]{1,100}$/.test(nodeKey)) notFound();
  let raw;
  try {
    raw = await readCheckpoint(getDatabase(), user.authUserId, cohort.id, nodeKey);
  } catch {
    notFound();
  }
  return {
    user,
    cohort,
    checkpoint: checkpointPresentation(raw),
    overview: () => readLearningOverview(user, cohort),
  };
}
