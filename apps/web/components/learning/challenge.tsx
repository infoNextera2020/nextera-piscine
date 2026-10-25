'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { SubmissionSummary } from '@nextera/db/submissions';
import type { SubmissionRules } from '@nextera/domain';
import type { LearningNode } from '../../lib/learning/types';
import { displayState, formatMoment } from '../../lib/learning/display';
import { historyFailureMessage } from '../../lib/submissions/messages';
import { SubmissionForm } from '../../lib/submissions/form';
import { Icon } from './icon';
import { EditorHairline } from './editor-hairline';
import s from './challenge.module.css';

const tabs = ['Brief', 'Resources'] as const;
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
  const [tab, setTab] = useState<(typeof tabs)[number]>(
    initialTab.toLowerCase() === 'resources' ? 'Resources' : 'Brief',
  );
  const [history, setHistory] = useState(initialHistory);
  const [error, setError] = useState('');
  const [accessUnavailable, setAccessUnavailable] = useState(false);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const historyRegion = useRef<HTMLElement>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(
    async (mode: 'replace' | 'if-idle' = 'replace') => {
      if (mode === 'if-idle' && historyRequest.current) return;
      historyRequest.current?.abort();
      const controller = new AbortController();
      historyRequest.current = controller;
      let status: number | undefined;
      try {
        const response = await fetch(`/api/submissions/history?cohort=${cohort}&node=${node}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        status = response.status;
        if (!response.ok) throw new Error();
        const data = (await response.json()) as SubmissionSummary[];
        if (!Array.isArray(data)) throw new Error();
        if (!controller.signal.aborted && historyRequest.current === controller) {
          setHistory(data);
          setAccessUnavailable(false);
          setError('');
        }
      } catch {
        if (!controller.signal.aborted && historyRequest.current === controller) {
          if (status === 401 || status === 403) setAccessUnavailable(true);
          setError(historyFailureMessage(status));
        }
      } finally {
        if (historyRequest.current === controller) historyRequest.current = null;
      }
    },
    [cohort, node],
  );
  useEffect(() => {
    const timer =
      submittable && !accessUnavailable
        ? setInterval(() => {
            if (document.visibilityState === 'visible') void refresh('if-idle');
          }, 4000)
        : undefined;
    return () => {
      historyRequest.current?.abort();
      historyRequest.current = null;
      clearInterval(timer);
    };
  }, [refresh, submittable, accessUnavailable]);
  useEffect(() => {
    const sync = () =>
      setTab(
        new URL(window.location.href).searchParams.get('tab')?.toLowerCase() === 'resources'
          ? 'Resources'
          : 'Brief',
      );
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => {
    if (initialTab.toLowerCase() === 'submissions') {
      const history = historyRegion.current;
      history?.focus({ preventScroll: true });
      // A feedback deep link must reveal its destination, including below the brief on mobile.
      history?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [initialTab]);
  function select(next: (typeof tabs)[number]) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next === 'Brief' ? 'overview' : 'resources');
    window.history.replaceState(null, '', url);
  }

  return (
    <div className={s.columns}>
      <section className={s.briefCard} aria-label="Challenge workspace">
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
        <div
          id="challenge-panel-Brief"
          role="tabpanel"
          aria-labelledby="challenge-tab-Brief"
          hidden={tab !== 'Brief'}
          tabIndex={0}
        >
          <div className={s.briefBody}>
            <div className={s.subject}>{subject}</div>
            <section className={s.requirements} aria-labelledby="requirements-heading">
              <h2 id="requirements-heading">Submission requirements</h2>
              <dl>
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
            </section>
            <section className={s.beforeSubmit}>
              <h2>Before you submit</h2>
              <ul>
                <li>Run and test your solution in your own terminal.</li>
                <li>Check your file and output against the published brief.</li>
              </ul>
            </section>
          </div>
          <div className={s.resourceNote}>
            <Icon name="resource" size={25} />
            <div>
              <strong>Resources</strong>
              <p>No separate resources are attached. Start with the brief above.</p>
            </div>
          </div>
        </div>
        <div
          id="challenge-panel-Resources"
          role="tabpanel"
          aria-labelledby="challenge-tab-Resources"
          hidden={tab !== 'Resources'}
          tabIndex={0}
          className={s.resourcesPanel}
        >
          <Icon name="resource" size={28} />
          <h2>Everything starts with the brief.</h2>
          <p>
            No separate resources are attached to this challenge. Read the published instructions
            and test your work locally.
          </p>
          <button
            type="button"
            className={s.textButton}
            onClick={() => {
              select('Brief');
              tabButtons.current[0]?.focus();
            }}
          >
            Back to the brief <Icon name="arrow" size={17} />
          </button>
        </div>
        <details className={s.questContext}>
          <summary>
            In this quest{' '}
            <span>
              {context.length} {context.length === 1 ? 'node' : 'nodes'}
            </span>
          </summary>
          <ul>
            {context.map((n) => (
              <li key={n.key}>
                {n.href ? (
                  <Link href={n.href} aria-current={n.key === node ? 'page' : undefined}>
                    {n.title}
                  </Link>
                ) : (
                  <span>{n.title}</span>
                )}
                <span>{n.label}</span>
              </li>
            ))}
          </ul>
          <Link href={'/app/cohorts/' + cohort}>
            Back to Journey <Icon name="arrow" size={16} />
          </Link>
        </details>
      </section>
      <aside className={s.tools} aria-label="Challenge tools">
        <section className={s.editorCard}>
          <div>
            <h2>Work in your editor</h2>
            <p>Use your own editor and terminal to write and test your solution.</p>
          </div>
          <EditorHairline />
        </section>
        <div className={s.uploadCard}>
          {submittable && !accessUnavailable ? (
            <SubmissionForm
              cohort={cohort}
              node={node}
              filename={rules.required_files[0]!}
              maxSizeKb={rules.max_size_kb}
              onAccepted={() => {
                void refresh();
                historyRegion.current?.focus({ preventScroll: true });
              }}
            />
          ) : (
            <section>
              <p className={s.eyebrow}>Read-only brief</p>
              <h2>Submission unavailable</h2>
              <p className={s.muted}>
                {accessUnavailable
                  ? 'Your session or challenge access has changed. Recheck access below before submitting.'
                  : 'Current access and an approved runnable evaluation are required for intake. You can continue reading this brief.'}
              </p>
            </section>
          )}
        </div>
        <section
          ref={historyRegion}
          className={s.historyCard}
          aria-labelledby="history-heading"
          tabIndex={-1}
        >
          <div className={s.historyHeading}>
            <h2 id="history-heading">Submission history</h2>
            {submittable && (
              <button
                type="button"
                className={s.refreshButton}
                onClick={() => void refresh()}
                aria-label="Refresh history"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M20 7v5h-5M4 17v-5h5" />
                  <path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
                </svg>
              </button>
            )}
          </div>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          {accessUnavailable ? (
            <p className={s.muted}>History is hidden until access can be confirmed.</p>
          ) : (
            <ChallengeHistory items={history} />
          )}
        </section>
      </aside>
    </div>
  );
}

export function ChallengeHistory({ items }: { items: SubmissionSummary[] }) {
  if (!items.length)
    return (
      <div className={s.emptyHistory}>
        <Icon name="clock" size={34} />
        <h3>No submissions yet</h3>
        <p>Evaluation feedback appears here after you submit.</p>
      </div>
    );
  return (
    <ol className={s.history}>
      {items.map((item, i) => (
        <li key={item.id} data-verdict={item.state}>
          <div className={s.recordHeading}>
            <strong>{i === 0 ? 'Latest submission' : 'Submission'}</strong>
            <span className={s.verdict} data-state={item.state}>
              {displayState(item.state)}
            </span>
          </div>
          {item.feedback?.message && <p>{item.feedback.message}</p>}
          {(item.state === 'queued' || item.state === 'running') && (
            <p className={s.muted}>
              Your result is pending. This record will update when evaluation is available.
            </p>
          )}
          {item.state === 'system_error' && (
            <p className={s.systemNotice}>Infrastructure issue. This is not a learner failure.</p>
          )}
          <div className={s.recordMeta}>
            <time dateTime={item.created_at}>{formatMoment(item.created_at)}</time>
            <details>
              <summary>Details</summary>
              <span>Submission ID</span>
              <code>{item.id}</code>
            </details>
          </div>
        </li>
      ))}
    </ol>
  );
}
