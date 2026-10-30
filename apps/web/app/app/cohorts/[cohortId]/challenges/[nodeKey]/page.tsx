import { logout } from '../../../../../login/actions';
import { readRaid } from '@nextera/db/raids';
import { RaidPanel } from '../../../../../../lib/raids/panel';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { readAccessibleSubject } from '@nextera/db/cohorts';
import { readSubmissions, submissionContext } from '@nextera/db/submissions';
import { isRequestId, type SubmissionRules } from '@nextera/domain';
import { getDatabase } from '../../../../../../lib/auth/server';
import { authorizeCohortPage } from '../../../../../../lib/cohorts/server';
import { readLearningOverview } from '../../../../../../lib/learning/server';
import { AppShell } from '../../../../../../components/learning/app-shell';
import { Challenge } from '../../../../../../components/learning/challenge';
import { Subject } from '../../../../../../components/learning/workspace-parts';
import { ChallengeHeading } from '../../../../../../components/learning/challenge-heading';
import LearningLoading from '../../../../../../components/learning/loading';
import s from '../../../../../../components/learning/challenge.module.css';

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string; nodeKey: string }>;
  searchParams: Promise<{ tab?: string; team?: string; view?: string }>;
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
      user.role === 'learner' && subject!.kind !== 'project'
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
    if (query.team && !isRequestId(query.team)) notFound();
    const raid =
      subject!.kind === 'project'
        ? await readRaid(getDatabase(), user.authUserId, cohort.id, nodeKey, query.team).catch(
            (error) => {
              if (
                user.role === 'operator' ||
                (error instanceof Error && error.message === 'RAID_NOT_READY')
              )
                return null;
              throw error;
            },
          )
        : null;
    const rules = subject!.submissionRules as unknown as SubmissionRules;
    const focused =
      subject!.kind === 'challenge' && (nodeKey === 'greeting-card' || query.view === 'focused');
    const challenge = (
      <Challenge
        key={cohort.id + ':' + nodeKey}
        focused={
          focused
            ? {
                cohort: { id: cohort.id, name: cohort.name, version: cohort.version },
                current: { ...current, title: subject!.title },
                role: user.role,
                notice:
                  user.role !== 'learner' ? (
                    <p>
                      {user.role === 'admin' ? 'Administrative' : 'Assigned operator'} read-only
                      subject preview.
                    </p>
                  ) : undefined,
                account: (
                  <form action={logout}>
                    <button type="submit">Sign out</button>
                  </form>
                ),
              }
            : undefined
        }
        cohort={cohort.id}
        node={nodeKey}
        rules={rules}
        submittable={submittable && subject!.kind !== 'project'}
        initialHistory={history}
        initialTab={query.tab}
        subject={<Subject>{subject!.subjectMarkdown}</Subject>}
        context={view.nodes.filter((n) => n.questKey === current.questKey)}
      />
    );
    if (focused) return challenge;
    return (
      <AppShell
        user={user}
        cohort={cohort}
        active="challenge"
        nodes={view.nodes}
        updates={view.updates}
      >
        <main className={s.page}>
          <ChallengeHeading
            cohort={cohort}
            current={{ ...current, title: subject!.title }}
            rules={rules}
          />
          {user.role !== 'learner' && subject!.kind !== 'project' && (
            <p className={s.notice}>
              {user.role === 'admin' ? 'Administrative' : 'Assigned operator'} read-only subject
              preview.
            </p>
          )}
          {subject!.kind === 'project' ? (
            <RaidPanel
              key={cohort.id + ':' + nodeKey + ':' + (query.team ?? '')}
              cohort={cohort.id}
              node={nodeKey}
              team={query.team}
              initial={raid}
              rules={rules}
              brief={<Subject>{subject!.subjectMarkdown}</Subject>}
            />
          ) : (
            challenge
          )}
        </main>
      </AppShell>
    );
  }
}
