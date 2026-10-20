import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { listCohorts } from '@nextera/db/cohorts';
import { authorizePage, getDatabase } from '../../../lib/auth/server';
import { AppShell } from '../../../components/learning/app-shell';
import { WorkspaceEmpty } from '../../../components/learning/workspace-parts';
import s from '../../../components/learning/workspace.module.css';
export default async function EvidenceEntry() {
  const user = await authorizePage();
  if (user.role !== 'learner') notFound();
  const cohorts = await listCohorts(getDatabase(), user);
  if (cohorts.length === 1) redirect('/app/cohorts/' + cohorts[0]!.id + '/evidence');
  return (
    <AppShell user={user} active="evidence">
      <main className={s.page}>
        <section className={s.card}>
          <h1>Progress & Evidence</h1>
          {cohorts.length ? (
            <>
              <p>Choose an authorized cohort.</p>
              <ul className={s.context}>
                {cohorts.map((c) => (
                  <li key={c.id}>
                    <Link className={s.button} href={'/app/cohorts/' + c.id + '/evidence'}>
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <WorkspaceEmpty title="Your evidence record starts with enrollment">
              No active cohorts are assigned. Your operator controls enrollment.
            </WorkspaceEmpty>
          )}
        </section>
      </main>
    </AppShell>
  );
}
