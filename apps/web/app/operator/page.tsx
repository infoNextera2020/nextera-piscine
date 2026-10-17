import Link from 'next/link';
import { authorizePage } from '../../lib/auth/server';

export default async function OperatorPage() {
  const user = await authorizePage(['operator', 'admin']);
  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">Operator access</h1>
      <p>
        {user.displayName} · {user.role}
      </p>
      <p>Foundation 002A authorization verified.</p>
      <Link href="/app" className="text-teal-300">
        Return to app
      </Link>
    </main>
  );
}
