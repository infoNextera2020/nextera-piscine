'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { SubmissionSummary } from '@nextera/db/submissions';
import type { SubmissionRules } from '@nextera/domain';
import type { LearningNode } from '../../lib/learning/types';
import { SubmissionForm } from '../../lib/submissions/form';
import { StatusBadge } from './primitives';
import { SafeHistory, WorkspaceEmpty } from './workspace-parts';
import s from './workspace.module.css';
const tabs = ['Overview', 'Tasks', 'Submissions', 'Resources', 'Discussion'] as const;
export function Challenge({
  cohort,
  node,
  rules,
  submittable,
  initialHistory,
  subject,
  context,
  initialTab = 'Overview',
}: {
  cohort: string;
  node: string;
  rules: SubmissionRules;
  submittable: boolean;
  initialHistory: SubmissionSummary[];
  subject: ReactNode;
  context: LearningNode[];
  initialTab?: string | undefined;
}) {
  const [tab, setTab] = useState(
    tabs.find((t) => t.toLowerCase() === initialTab.toLowerCase()) ?? 'Overview',
  );
  const [history, setHistory] = useState(initialHistory);
  const [error, setError] = useState('');
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(`/api/submissions/history?cohort=${cohort}&node=${node}`, {
          cache: 'no-store',
          signal: signal ?? null,
        });
        if (!response.ok) throw new Error();
        const data = (await response.json()) as SubmissionSummary[];
        if (!signal?.aborted) {
          setHistory(data);
          setError('');
        }
      } catch {
        if (!signal?.aborted)
          setError(
            'History could not be refreshed. The last confirmed record is shown. Check access and retry.',
          );
      }
    },
    [cohort, node],
  );
  useEffect(() => {
    if (!submittable) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(controller.signal);
    }, 4000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh, submittable]);
  function select(next: (typeof tabs)[number]) {
    setTab(next);
    tabButtons.current[tabs.indexOf(next)]?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant',
    });
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next.toLowerCase());
    window.history.replaceState(null, '', url);
  }
  useEffect(() => {
    const sync = () =>
      setTab(
        tabs.find(
          (t) => t.toLowerCase() === new URL(window.location.href).searchParams.get('tab'),
        ) ?? 'Overview',
      );
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return (
    <div className={s.columns}>
      <section className={s.card} aria-label="Challenge workspace">
        <p className={s.tabHint}>Five sections · swipe to explore</p>
        <div className={s.tabs} role="tablist" aria-label="Challenge sections">
          {tabs.map((name, i) => (
            <button
              key={name}
              ref={(el) => {
                tabButtons.current[i] = el;
              }}
              role="tab"
              id={'challenge-tab-' + name}
              aria-controls={'challenge-panel-' + name}
              aria-selected={tab === name}
              tabIndex={tab === name ? 0 : -1}
              onClick={() => select(name)}
              onKeyDown={(event) => {
                const next =
                  event.key === 'ArrowRight'
                    ? (i + 1) % tabs.length
                    : event.key === 'ArrowLeft'
                      ? (i + tabs.length - 1) % tabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : null;
                if (next !== null) {
                  event.preventDefault();
                  select(tabs[next]!);
                  tabButtons.current[next]?.focus();
                }
              }}
            >
              {name}
            </button>
          ))}
        </div>
        {tabs.map((name) => (
          <div
            key={name}
            id={'challenge-panel-' + name}
            role="tabpanel"
            aria-labelledby={'challenge-tab-' + name}
            hidden={tab !== name}
            tabIndex={0}
          >
            {name === 'Overview' && subject}
            {name === 'Tasks' && (
              <>
                <h2>Submission requirements</h2>
                <p className={s.muted}>
                  The challenge brief defines the work. There are no separate scored subtasks.
                </p>
                <dl className={s.requirements}>
                  <div>
                    <dt>Required files</dt>
                    <dd>{rules.required_files.join(', ')}</dd>
                  </div>
                  <div>
                    <dt>Allowed extensions</dt>
                    <dd>{rules.allowed_extensions.join(', ')}</dd>
                  </div>
                  <div>
                    <dt>Maximum size</dt>
                    <dd>{rules.max_size_kb} KiB</dd>
                  </div>
                </dl>
              </>
            )}
            {name === 'Submissions' && (
              <>
                <div className={s.sectionHead}>
                  <h2>Submission history</h2>
                  {submittable && (
                    <button className={s.button} onClick={() => void refresh()}>
                      Refresh history
                    </button>
                  )}
                </div>
                {error && (
                  <p className={s.notice} role="alert">
                    {error}
                  </p>
                )}
                <SafeHistory items={history} />
              </>
            )}
            {name === 'Resources' && (
              <WorkspaceEmpty title="Start with the challenge brief">
                No separate resources are attached to this challenge. You’ll find the brief in
                Overview.
              </WorkspaceEmpty>
            )}
            {name === 'Discussion' && (
              <WorkspaceEmpty title="Discussion is not available yet">
                Keep your work local and use the challenge brief. No discussion service is connected
                to this challenge.
              </WorkspaceEmpty>
            )}
          </div>
        ))}
      </section>
      <aside className={s.stack} aria-label="Challenge tools">
        <div className={s.card}>
          {submittable ? (
            <SubmissionForm
              cohort={cohort}
              node={node}
              filename={rules.required_files[0]!}
              maxSizeKb={rules.max_size_kb}
              onAccepted={() => {
                select('Submissions');
                void refresh();
              }}
            />
          ) : (
            <>
              <h2>Submission unavailable</h2>
              <p className={s.muted}>
                This is a read-only subject. Current access and an approved runnable evaluation are
                required for intake.
              </p>
            </>
          )}
        </div>
        <section className={s.card} aria-label="Roadmap context">
          <h2>Roadmap context</h2>
          <ol className={s.context}>
            {context.map((n) => (
              <li key={n.key}>
                {n.href ? <Link href={n.href}>{n.title}</Link> : <span>{n.title}</span>}
                <StatusBadge state={n.state} />
              </li>
            ))}
          </ol>
          <div className={s.actions}>
            <Link className={s.button} href={'/app/cohorts/' + cohort}>
              Open Roadmap
            </Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
