import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { HairlineIcon } from './hairline-icon';
import s from './access.module.css';

export function AccessSurface({ children }: { children: ReactNode }) {
  return (
    <main className={s.page}>
      <header className={s.header}>
        <Link href="/" className={s.brand} aria-label="01 coding Piscine home">
          <Image src="/branding/01-coding/mark.svg" width={42} height={42} alt="" unoptimized />
        </Link>
      </header>
      <section className={s.card}>{children}</section>
    </main>
  );
}
export function AccessRecovery({
  kind,
  onRetry,
}: {
  kind: 'workspace' | 'login';
  onRetry(): void;
}) {
  return (
    <AccessSurface>
      <HairlineIcon name="gate" size={38} />
      <p className={s.eyebrow}>Service unavailable</p>
      <h1>{kind === 'login' ? 'Sign-in service unavailable' : 'Could not load your workspace'}</h1>
      <p className={s.description}>
        Please try again in a moment. Your access could not be checked.
      </p>
      <button className={s.primary} onClick={onRetry}>
        Try again <HairlineIcon name="arrow" />
      </button>
      <p className={s.footer}>
        Access and account permissions remain controlled by your program owner.
      </p>
    </AccessSurface>
  );
}
