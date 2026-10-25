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
  searchParams: Promise<{ tab?: string; team?: string }>;
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
          {subject!.kind === 'project' && !raid && (
            <p className={s.notice}>
              Shared team workflow is unavailable in this environment. The brief remains read-only.
            </p>
          )}
          {raid ? (
            <div className={s.columns}>
              <section className={s.briefCard}>
                <div className={s.briefBody}>
                  <div className={s.subject}>
                    <Subject>{subject!.subjectMarkdown}</Subject>
                  </div>
                  <section className={s.requirements}>
                    <h2>Shared submission requirements</h2>
                    <dl>
                      <div>
                        <dt>Required file</dt>
                        <dd>{rules.required_files.join(', ')}</dd>
                      </div>
                      <div>
                        <dt>Maximum size</dt>
                        <dd>{rules.max_size_kb} KiB</dd>
                      </div>
                    </dl>
                  </section>
                </div>
              </section>
              <RaidPanel
                key={cohort.id + ':' + nodeKey + ':' + (query.team ?? '')}
                cohort={cohort.id}
                node={nodeKey}
                team={query.team}
                initial={raid}
                rules={rules}
              />
            </div>
          ) : (
            <Challenge
              key={cohort.id + ':' + nodeKey}
              cohort={cohort.id}
              node={nodeKey}
              rules={rules}
              submittable={submittable && subject!.kind !== 'project'}
              initialHistory={history}
              initialTab={query.tab}
              subject={<Subject>{subject!.subjectMarkdown}</Subject>}
              context={view.nodes.filter((n) => n.questKey === current.questKey)}
            />
          )}
        </main>
      </AppShell>
    );
  }
}
