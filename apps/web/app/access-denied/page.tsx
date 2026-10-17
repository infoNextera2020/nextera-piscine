import Link from 'next/link';
import { logout } from '../login/actions';

const messages = {
  NOT_PROVISIONED:
    'Your identity is authenticated, but a NextEra account has not been provisioned. Contact your operator.',
  INACTIVE: 'Your NextEra account is inactive. Contact your operator.',
  FORBIDDEN: 'Your NextEra role does not allow access to this page.',
};

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const code =
    reason && Object.hasOwn(messages, reason) ? (reason as keyof typeof messages) : 'FORBIDDEN';
  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">Access denied</h1>
      <p>{messages[code]}</p>
      <p className="font-mono text-sm">{code}</p>
      <Link href="/app" className="block text-teal-300">
        Return to app
      </Link>
      <form action={logout}>
        <button className="rounded border px-4 py-2">Sign out</button>
      </form>
    </main>
  );
}
