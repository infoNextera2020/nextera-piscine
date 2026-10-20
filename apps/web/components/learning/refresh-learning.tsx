'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import s from './workspace.module.css';
export function RefreshLearning({ label = 'Refresh result' }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className={s.button}
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? 'Refreshing…' : label}
    </button>
  );
}
