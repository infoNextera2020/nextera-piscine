import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { readAccessibleSubject } from '@nextera/db/cohorts';
import { readSubmissions, submissionContext } from '@nextera/db/submissions';
import type { SubmissionRules } from '@nextera/domain';
import { getDatabase } from '../../../../../../lib/auth/server';
import { authorizeCohortPage } from '../../../../../../lib/cohorts/server';
import { readLearningOverview } from '../../../../../../lib/learning/server';
import { AppShell } from '../../../../../../components/learning/app-shell';
import { Challenge } from '../../../../../../components/learning/challenge';
import {
  Breadcrumbs,
  Subject,
  WorkspaceHero,
} from '../../../../../../components/learning/workspace-parts';
import LearningLoading from '../../../../../../components/learning/loading';
import s from '../../../../../../components/learning/workspace.module.css';
export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string; nodeKey: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { cohortId, nodeKey } = await params;
  const { user, cohort } = await authorizeCohortPage(cohortId);
  const subject = await readAccessibleSubject(getDatabase(), user, cohort.id, nodeKey);
  if (!subject || subject.kind === 'checkpoint') notFound();
  return (
    <Suspense fallback={<LearningLoading />}>
      <Content />
    </Suspense>
  );
  async function Content() {
    const [view, history, query] = await Promise.all([
      readLearningOverview(user, cohort),
      user.role === 'learner'
        ? readSubmissions(getDatabase(), user.authUserId, cohort.id, nodeKey)
        : Promise.resolve([]),
      searchParams,
    ]);
    const current = view.nodes.find((n) => n.key === nodeKey);
    if (!current) notFound();
    let submittable = false;
    if (user.role === 'learner') {
      try {
        await submissionContext(getDatabase(), user.authUserId, cohort.id, nodeKey);
        submittable = true;
      } catch {
        /* Readable drafts do not imply runnable intake. */
      }
    }
    const rules = subject!.submissionRules as unknown as SubmissionRules;
    return (
      <AppShell
        user={user}
        cohort={cohort}
        active="challenge"
        nodes={view.nodes}
        updates={view.updates}
      >
        <main className={s.page}>
          <Breadcrumbs cohort={cohort} title={subject!.title} />
          <WorkspaceHero
            context={current.questTitle}
            title={subject!.title}
            state={current.state}
            description="Understand the brief, build locally, and submit your solution for trusted evaluation."
            facts={[
              {
                label: 'Type',
                value: current.kind === 'project' ? 'Project' : 'Individual challenge',
              },
              { label: 'Required file', value: rules.required_files.join(', ') },
              { label: 'Curriculum', value: cohort.version },
            ]}
          />
          {user.role !== 'learner' && (
            <p className={s.notice}>
              {user.role === 'admin' ? 'Administrative' : 'Assigned operator'} read-only subject
              preview.
            </p>
          )}
          <Challenge
            cohort={cohort.id}
            node={nodeKey}
            rules={rules}
            submittable={submittable}
            initialHistory={history}
            initialTab={query.tab}
            subject={<Subject>{subject!.subjectMarkdown}</Subject>}
            context={view.nodes.filter((n) => n.questKey === current.questKey)}
          />
        </main>
      </AppShell>
    );
  }
}
