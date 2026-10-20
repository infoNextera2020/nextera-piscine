'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import localFont from 'next/font/local';
import type { UserRole } from '@nextera/domain';
import { logout } from '../../app/login/actions';
import { formatMoment } from '../../lib/learning/display';
import type { LearningNode, LearningUpdate } from '../../lib/learning/types';
import { StatusBadge } from './primitives';
import { Icon } from './icon';
import s from './learning.module.css';
const poppins = localFont({
  src: [
    { path: '../../public/fonts/poppins/Poppins-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../../public/fonts/poppins/Poppins-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../../public/fonts/poppins/Poppins-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: '../../public/fonts/poppins/Poppins-Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-poppins',
  display: 'swap',
});
type ShellProps = {
  user: { displayName: string; role: UserRole };
  cohort?: { id: string; name: string; version: string } | null;
  nodes?: LearningNode[];
  updates?: LearningUpdate[];
  active: 'command' | 'roadmap' | 'challenge' | 'checkpoint';
  children: ReactNode;
};
export function AppShell({
  user,
  cohort = null,
  nodes = [],
  updates = [],
  active,
  children,
}: ShellProps) {
  const search = useRef<HTMLDialogElement>(null),
    drawer = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const base = cohort ? '/app/cohorts/' + cohort.id : '/app/roadmap';
  const initials = user.displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
  function openSearch() {
    setQuery('');
    search.current?.showModal();
    requestAnimationFrame(() => input.current?.focus());
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!search.current?.open) {
          search.current?.showModal();
          input.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const navItems = [
    {
      key: 'command',
      title: 'Command Center',
      icon: 'home',
      href: cohort ? '/app?cohort=' + cohort.id : '/app',
    },
    { key: 'roadmap', title: 'Roadmap', icon: 'map', href: base },
    { key: 'challenge', title: 'Challenges', icon: 'code', href: base + '?kind=challenge' },
    { key: 'checkpoint', title: 'Checkpoints', icon: 'gate', href: base + '?kind=checkpoint' },
  ];
  const navigation = () => (
    <nav aria-label="Learner navigation" className={s.nav}>
      {navItems.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? 'page' : undefined}
          onClick={() => drawer.current?.close()}
        >
          <Icon name={item.icon} />
          <span>{item.title}</span>
        </Link>
      ))}
      {[
        ['evidence', 'Progress & Evidence'],
        ['community', 'Community'],
        ['resource', 'Resources'],
      ].map(([icon, title]) => (
        <span className={s.navDisabled} key={title} aria-disabled="true">
          <Icon name={icon!} />
          <span>{title}</span>
          <small>Soon</small>
        </span>
      ))}
    </nav>
  );
  const brand = (
    <Link
      href="/app"
      className={s.brand}
      aria-label="NextEra Piscine home"
      onClick={() => drawer.current?.close()}
    >
      <span className={s.brandMark} aria-hidden="true" />
      <span>
        <strong>NextEra</strong>
        <small>Piscine</small>
      </span>
    </Link>
  );
  const results = nodes
    .filter(
      (n) =>
        n.title.toLowerCase().includes(query.toLowerCase()) ||
        n.skills.some((skill) => skill.toLowerCase().includes(query.toLowerCase())),
    )
    .slice(0, 12);
  return (
    <div className={poppins.variable + ' ' + s.shell}>
      <a className={s.skip} href="#learning-main">
        Skip to main content
      </a>
      <aside className={s.sidebar}>
        {brand}
        {navigation()}
        <div className={s.sidebarArt} aria-hidden="true" />
        <div className={s.sidebarNote}>
          <strong>Build what’s next.</strong>
          <p>
            Real skills. Real projects.
            <br />
            Real opportunities.
          </p>
        </div>
      </aside>
      <div className={s.main}>
        <header className={s.topbar}>
          <button
            type="button"
            className={s.mobileMenu}
            aria-label="Open navigation"
            onClick={() => drawer.current?.showModal()}
          >
            <Icon name="menu" />
          </button>
          <button
            type="button"
            className={s.searchTrigger}
            aria-label="Search your roadmap"
            aria-keyshortcuts="Control+K Meta+K"
            onClick={openSearch}
          >
            <Icon name="search" size={17} />
            <span>Search your roadmap…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className={s.userActions}>
            <details className={s.popover}>
              <summary className={s.bell} aria-label="Recent updates">
                <Icon name="bell" />
                {updates.length > 0 && <span className={s.updateDot} aria-hidden="true" />}
              </summary>
              <div className={s.popoverContent}>
                <h2>Recent updates</h2>
                {!updates.length ? (
                  <p>No recent learning updates.</p>
                ) : (
                  <ul>
                    {updates.slice(0, 4).map((u) => (
                      <li key={u.id}>
                        <Link href={u.href}>{u.title}</Link>
                        <StatusBadge state={u.state} />
                        <small>{formatMoment(u.at)}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
            <details className={s.popover}>
              <summary className={s.userChip} aria-label="Open account menu">
                <span className={s.avatar}>{initials}</span>
                <span>
                  <strong>{user.displayName}</strong>
                  <small>{user.role}</small>
                </span>
                <Icon name="chevron" size={14} />
              </summary>
              <div className={s.popoverContent}>
                <h2>Your account</h2>
                <p>Signed in as {user.displayName}</p>
                <p>Role: {user.role}</p>
                {cohort && <p>{cohort.name}</p>}
                {user.role !== 'learner' && (
                  <Link className={s.textLink} href="/operator">
                    Operator access <Icon name="arrow" size={15} />
                  </Link>
                )}
                <form action={logout}>
                  <button type="submit" className={s.outlineButton}>
                    <Icon name="logout" size={16} />
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <div id="learning-main" tabIndex={-1}>
          {children}
        </div>
      </div>
      <dialog
        ref={drawer}
        className={s.drawer}
        aria-labelledby="navigation-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) drawer.current?.close();
        }}
      >
        <header>
          <h2 id="navigation-title">Navigation</h2>
          <button aria-label="Close navigation" onClick={() => drawer.current?.close()}>
            <Icon name="close" />
          </button>
        </header>
        {brand}
        {navigation()}
      </dialog>
      <dialog
        ref={search}
        className={s.searchDialog}
        aria-labelledby="search-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) search.current?.close();
        }}
      >
        <header>
          <h2 id="search-title">Search your roadmap</h2>
          <button aria-label="Close search" onClick={() => search.current?.close()}>
            <Icon name="close" />
          </button>
        </header>
        <label className={s.searchInput}>
          <Icon name="search" />
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Challenge, checkpoint, or skill"
            aria-label="Search curriculum"
          />
        </label>
        <p className={s.muted}>{cohort?.name ?? 'Choose a cohort to explore its roadmap.'}</p>
        <ul className={s.searchResults}>
          {results.map((n) => (
            <li key={n.key}>
              <Link href={n.roadmapHref} onClick={() => search.current?.close()}>
                <Icon name={n.kind === 'checkpoint' ? 'gate' : 'code'} />
                <span>
                  <strong>{n.title}</strong>
                  <small>{n.questTitle}</small>
                </span>
                <StatusBadge state={n.state} label={n.label} />
              </Link>
            </li>
          ))}
        </ul>
        {!results.length && <p className={s.empty}>No matching curriculum nodes.</p>}
        <footer>Search by title or skill · Escape to close</footer>
      </dialog>
    </div>
  );
}
