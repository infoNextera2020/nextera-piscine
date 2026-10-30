import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LearningSurface } from '../learning/design-exploration';
import s from './staff.module.css';

export type StaffUser = { displayName: string; role: 'operator' | 'admin' };

export function StaffShell({
  user,
  active,
  children,
}: {
  user: StaffUser;
  active: 'overview' | 'reviews' | 'raids';
  children: ReactNode;
}) {
  return (
    <LearningSurface page="staff">
      <div className={s.portal}>
        <a className={s.skip} href="#staff-main">
          Skip to workspace
        </a>
        <div className={s.container}>
          <header className={s.header}>
            <Link className={s.brand} href="/operator" aria-label="01 coding staff workspace">
              <Image src="/branding/01-coding/mark.svg" alt="" width={52} height={52} unoptimized />
            </Link>
            <nav className={s.navigation} aria-label="Staff navigation">
              <Link href="/operator" aria-current={active !== 'raids' ? 'page' : undefined}>
                {user.role === 'admin' ? 'Overview' : 'Reviews'}
              </Link>
              <Link href="/operator/raids" aria-current={active === 'raids' ? 'page' : undefined}>
                Raid teams
              </Link>
            </nav>
            <div className={s.account}>
              <span>{user.role === 'admin' ? 'Admin' : 'Mentor'}</span>
              <Link href="/app">Portal</Link>
            </div>
          </header>
          <main id="staff-main" className={s.main} tabIndex={-1}>
            {children}
          </main>
          <footer className={s.footer}>
            <span>{user.displayName}</span>
            <span>{user.role === 'admin' ? 'Administrator access' : 'Assigned cohort access'}</span>
          </footer>
        </div>
      </div>
    </LearningSurface>
  );
}
