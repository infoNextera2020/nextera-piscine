'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { UserRole } from '@nextera/domain';
import { logout } from '../../app/login/actions';
import { formatMoment } from '../../lib/learning/display';
import type { LearningNode, LearningUpdate } from '../../lib/learning/types';
import { StatusBadge } from './primitives';
import { HairlineIcon as Icon } from './hairline-icon';
import s from './app-shell.module.css';
import { LearningSurface } from './design-exploration';

type ShellProps = {
  user: { displayName: string; role: UserRole };
  cohort?: { id: string; name: string; version: string } | null;
  nodes?: LearningNode[];
  updates?: LearningUpdate[];
  active: 'command' | 'roadmap' | 'challenge' | 'checkpoint' | 'evidence' | 'reviews';
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
  const search = useRef<HTMLDialogElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
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
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!search.current?.open) {
          search.current?.showModal();
          input.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const journeyActive = active === 'roadmap' || active === 'challenge' || active === 'checkpoint';
  const navItems = [
    {
      key: 'command',
      title: 'Home',
      icon: 'home',
      href: cohort ? '/app?cohort=' + cohort.id : '/app',
      current: active === 'command',
    },
    { key: 'roadmap', title: 'Journey', icon: 'map', href: base, current: journeyActive },
    {
      key: 'reviews',
      title: 'Team reviews',
      icon: 'folder',
      href: user.role === 'learner' ? '/app/reviews' : '/operator/raids',
      current: active === 'reviews',
    },
    {
      key: 'evidence',
      title: 'Evidence',
      icon: 'evidence',
      href: cohort ? base + '/evidence' : '/app/evidence',
      current: active === 'evidence',
    },
  ];
  const navigation = () => (
    <nav aria-label="Learner navigation" className={s.nav}>
      {navItems
        .filter(
          (item) =>
            (item.key !== 'evidence' || user.role === 'learner') &&
            (item.key !== 'reviews' || user.role !== 'learner'),
        )
        .map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.current ? 'page' : undefined}
            onClick={() => drawer.current?.close()}
          >
            <Icon name={item.icon} size={25} />
            <span>{item.title}</span>
          </Link>
        ))}
    </nav>
  );
  const brand = (
    <Link
      href="/app"
      className={s.brand}
      aria-label="01 coding Piscine home"
      onClick={() => drawer.current?.close()}
    >
      <span className={s.brandMark}>
        <Image src="/branding/01-coding/mark.svg" alt="" width={52} height={52} unoptimized />
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
    <LearningSurface
      page={
        active === 'command'
          ? 'home'
          : active === 'roadmap'
            ? 'journey'
            : active === 'checkpoint'
              ? 'checkpoint'
              : active === 'reviews'
                ? 'staff'
                : 'challenge'
      }
    >
      <div className={s.shell}>
        <a className={s.skip} href="#learning-main">
          Skip to main content
        </a>
        <aside className={s.sidebar}>
          {brand}
          {navigation()}
          <div className={s.sidebarBottom}>
            <button
              ref={searchTrigger}
              type="button"
              className={s.searchTrigger}
              onClick={openSearch}
              aria-keyshortcuts="Control+K Meta+K"
            >
              <Icon name="search" size={17} />
              <span>Search journey</span>
              <kbd>Ctrl K</kbd>
            </button>
            <p>Learn by doing.</p>
          </div>
        </aside>
        <div className={s.main}>
          <header className={s.topbar}>
            <button
              ref={menuTrigger}
              type="button"
              className={s.mobileMenu}
              aria-label="Open navigation"
              onClick={() => drawer.current?.showModal()}
            >
              <Icon name="menu" />
            </button>
            <span className={s.mobileBrand}>
              <Image
                src="/branding/01-coding/mark.svg"
                alt="01 coding"
                width={42}
                height={42}
                unoptimized
              />
            </span>
            <div className={s.userActions}>
              {!!updates.length && (
                <details className={s.popover}>
                  <summary className={s.bell} aria-label="Recent updates">
                    <Icon name="bell" />
                    <span className={s.updateDot} />
                  </summary>
                  <div className={s.popoverContent}>
                    <h2>Recent updates</h2>
                    <ul>
                      {updates.slice(0, 4).map((u) => (
                        <li key={u.id}>
                          <Link href={u.href}>{u.title}</Link>
                          <StatusBadge state={u.state} />
                          <small>{formatMoment(u.at)}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              )}
              <details className={s.popover}>
                <summary className={s.avatar} aria-label="Open account menu">
                  {initials || 'N'}
                </summary>
                <div className={s.popoverContent}>
                  <h2>{user.displayName}</h2>
                  <p>{user.role}</p>
                  {cohort && <p>{cohort.name}</p>}
                  {user.role !== 'learner' && (
                    <Link href="/operator">
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
          onClose={() => menuTrigger.current?.focus()}
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
          <button
            className={s.outlineButton}
            onClick={() => {
              drawer.current?.close();
              openSearch();
            }}
          >
            <Icon name="search" />
            Search journey
          </button>
          <p className={s.drawerNote}>Learn by doing.</p>
        </dialog>
        <dialog
          ref={search}
          className={s.searchDialog}
          aria-labelledby="search-title"
          onClose={() =>
            (searchTrigger.current?.offsetParent
              ? searchTrigger.current
              : menuTrigger.current
            )?.focus()
          }
          onClick={(e) => {
            if (e.target === e.currentTarget) search.current?.close();
          }}
        >
          <header>
            <h2 id="search-title">Search your journey</h2>
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
          <p className={s.muted}>{cohort?.name ?? 'Choose a cohort to explore its journey.'}</p>
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
          {!results.length && (
            <p className={s.empty}>
              {query
                ? `No matches for “${query}”. Try a title or skill.`
                : 'No curriculum nodes are available in this view.'}
            </p>
          )}
          <footer>Search by title or skill · Escape to close</footer>
        </dialog>
      </div>
    </LearningSurface>
  );
}
