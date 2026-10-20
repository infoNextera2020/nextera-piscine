import 'server-only';
import {
  readCohortNodes,
  readPrerequisites,
  readAccessibleSubject,
  type AuthorizedCohort,
} from '@nextera/db/cohorts';
import { readSubmissions } from '@nextera/db/submissions';
import { readCheckpoint } from '@nextera/db/checkpoints';
import type { DomainUser } from '@nextera/domain';
import { getDatabase } from '../auth/server';
import { projectLearning } from './projection';
import type { LearningUpdate } from './types';

/** Reads authorized projections and safe history; never reconciles or changes progress. */
export async function readLearningOverview(user: DomainUser, cohort: AuthorizedCohort) {
  const db = getDatabase();
  const [rows, edges] = await Promise.all([
    readCohortNodes(db, user, cohort.id),
    readPrerequisites(db, user, cohort.id),
  ]);
  const view = projectLearning(rows, edges, user.role, cohort.id);
  if (user.role !== 'learner') return view;
  const histories: Awaited<ReturnType<typeof readSubmissions>>[] = [];
  for (let i = 0; i < view.nodes.length; i += 4) {
    histories.push(
      ...(await Promise.all(
        view.nodes
          .slice(i, i + 4)
          .map((n) => readSubmissions(db, user.authUserId, cohort.id, n.key)),
      )),
    );
  }
  view.submissions = histories
    .flat()
    .map((s) => {
      const node = view.nodes.find((n) => n.key === s.node_key)!;
      return {
        id: s.id,
        title: node.title,
        state: s.state,
        at: new Date(s.created_at).toISOString(),
        href: node.href ?? node.roadmapHref,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const updates: LearningUpdate[] = view.submissions.map((s) => ({
    id: s.id,
    title: 'Submission received: ' + s.title,
    detail: 'Current result',
    state: s.state,
    at: s.at,
    href: s.href,
  }));
  for (const node of view.nodes) {
    if (node.masteredAt)
      updates.push({
        id: node.key + '-mastered',
        title: node.title + ' mastered',
        detail: 'Mastery recorded',
        state: 'mastered',
        at: node.masteredAt,
        href: node.roadmapHref,
      });
    else if (node.unlockedAt)
      updates.push({
        id: node.key + '-available',
        title: node.title + ' available',
        detail: 'Progression recorded',
        state: 'available',
        at: node.unlockedAt,
        href: node.roadmapHref,
      });
  }
  view.updates = updates
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    .slice(0, 6);
  if (view.current?.href) {
    const subject = await readAccessibleSubject(db, user, cohort.id, view.current.key);
    view.currentDescription =
      subject?.subjectMarkdown
        .split('\n')
        .find(
          (line) =>
            line.trim() &&
            !line.startsWith('#') &&
            !line.startsWith(String.fromCharCode(96).repeat(3)),
        )
        ?.replace(/[*_]/g, '')
        .replaceAll(String.fromCharCode(96), '')
        .slice(0, 190) ?? null;
  }
  const checkpoints = view.nodes.filter((n) => n.kind === 'checkpoint' && n.state !== 'mastered');
  for (let i = 0; i < checkpoints.length; i += 4) {
    await Promise.all(
      checkpoints.slice(i, i + 4).map(async (node) => {
        const checkpoint = await readCheckpoint(db, user.authUserId, cohort.id, node.key);
        node.assessmentState = checkpoint.attempt?.status ?? null;
      }),
    );
  }
  view.checkpointStatus = view.checkpoint?.assessmentState ?? view.checkpoint?.state ?? null;
  return view;
}
