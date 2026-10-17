import Link from 'next/link';
import { authorizePage } from '../../lib/auth/server';
import { logout } from '../login/actions';

export default async function AppPage() {
  const user = await authorizePage();
  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">NextEra Piscine</h1>
      <p>Foundation 002A: identity and access online</p>
      <dl>
        <dt>Display name</dt>
        <dd>{user.displayName}</dd>
        <dt>Role</dt>
        <dd>{user.role}</dd>
      </dl>
      <Link href="/operator" className="block text-teal-300">
        Operator access
      </Link>
      <form action={logout}>
        <button className="rounded border px-4 py-2">Sign out</button>
      </form>
    </main>
  );
}
