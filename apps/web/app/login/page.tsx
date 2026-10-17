import Link from 'next/link';
import { login } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Link href="/" className="text-teal-300">
        NextEra Piscine
      </Link>
      <h1 className="my-6 text-3xl font-semibold">Sign in</h1>
      <p className="mb-6 text-slate-400">Use your provisioned Piscine account.</p>
      {error && (
        <p role="alert" className="mb-4 text-amber-300">
          {error === 'logout_failed'
            ? 'Sign out failed. Please try again.'
            : 'Unable to sign in. Check your email and password.'}
        </p>
      )}
      <form action={login} className="flex flex-col gap-4">
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="username"
            maxLength={320}
            required
            className="mt-1 w-full rounded border border-slate-600 p-3"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            required
            className="mt-1 w-full rounded border border-slate-600 p-3"
          />
        </label>
        <button className="rounded bg-teal-300 px-4 py-3 font-semibold text-slate-950">
          Sign in
        </button>
      </form>
    </main>
  );
}
