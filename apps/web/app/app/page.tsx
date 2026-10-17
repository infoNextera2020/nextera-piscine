import Link from 'next/link';
import { listCohorts } from '@nextera/db/cohorts';
import { authorizePage, getDatabase } from '../../lib/auth/server';
import { logout } from '../login/actions';

export default async function AppPage() {
  const user = await authorizePage();
  const cohorts = await listCohorts(getDatabase(), user);
  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">NextEra Piscine</h1>
      <p>Foundation 002B: curriculum and cohort access online</p>
      <dl>
        <dt>Display name</dt>
        <dd>{user.displayName}</dd>
        <dt>Role</dt>
        <dd>{user.role}</dd>
      </dl>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your cohorts</h2>
        {user.role === 'admin' && <p>Administrative read-only cohort access.</p>}
        {!cohorts.length && (
          <p>No active cohorts assigned. Enrollment is controlled by your operator.</p>
        )}
        <ul className="space-y-2">
          {cohorts.map((cohort) => (
            <li key={cohort.id}>
              <Link className="text-teal-300" href={`/app/cohorts/${cohort.id}`}>
                {cohort.name}
              </Link>
              <p className="text-sm text-slate-400">Curriculum {cohort.version}</p>
            </li>
          ))}
        </ul>
      </section>
      <Link href="/operator" className="block text-teal-300">
        Operator access
      </Link>
      <form action={logout}>
        <button className="rounded border px-4 py-2">Sign out</button>
      </form>
    </main>
  );
}
