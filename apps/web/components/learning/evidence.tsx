'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { EvidenceCategory, EvidenceRecord } from '../../lib/learning/evidence';
import type { LearningNode } from '../../lib/learning/types';
import { StatusBadge } from './primitives';
import { HairlineFigure } from './hairline-figure';
import { RecordDetails, WorkspaceEmpty } from './workspace-parts';
import { formatMoment } from '../../lib/learning/display';
import s from './workspace.module.css';
const categories: { value: EvidenceCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All evidence' },
  { value: 'mastery', label: 'Durable mastery' },
  { value: 'checkpoint', label: 'Checkpoint outcomes' },
  { value: 'learner', label: 'Learner failures' },
  { value: 'unlock', label: 'Unlock records' },
  { value: 'system', label: 'Infrastructure events' },
];
export function Evidence({
  records,
  nodes,
  initialFilter = 'all',
}: {
  records: EvidenceRecord[];
  nodes: LearningNode[];
  initialFilter?: string;
}) {
  const [filter, setFilter] = useState(
    categories.some((c) => c.value === initialFilter) ? initialFilter : 'all',
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    const sync = () => setFilter(new URL(location.href).searchParams.get('filter') ?? 'all');
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  function selectFilter(value: string) {
    setFilter(value);
    const url = new URL(location.href);
    url.searchParams.set('filter', value);
    history.replaceState(null, '', url);
  }
  const shown = filter === 'all' ? records : records.filter((r) => r.category === filter);
  return (
    <div className={s.columns}>
      <section className={s.card} aria-label="Evidence timeline">
        <div className={s.sectionHead}>
          <h2>Evidence timeline</h2>
          <label>
            Show{' '}
            <select
              className={s.filter}
              value={filter}
              disabled={!ready}
              onChange={(event) => {
                selectFilter(event.target.value);
              }}
            >
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className={s.muted}>
          Authorized history and stored progress. Mastery, learner failure, checkpoint outcomes,
          unlocks and infrastructure remain separate.
        </p>
        {shown.length ? (
          <ol className={s.history}>
            {shown.map((r) => (
              <li key={r.id} className={s.record} data-category={r.category}>
                <div className={s.recordHead}>
                  <span className={s.tag}>
                    {categories.find((c) => c.value === r.category)?.label}
                  </span>
                  <StatusBadge state={r.state} />
                </div>
                <Link href={r.href}>
                  <strong>{r.title}</strong>
                </Link>
                {r.at && <time dateTime={r.at}>{formatMoment(r.at)}</time>}
                <RecordDetails>
                  <p className={s.muted}>{r.source}</p>
                  <code className={s.identity}>{r.identity}</code>
                </RecordDetails>
                {r.category === 'system' && (
                  <p className={s.notice} data-tone="system">
                    An infrastructure issue, separate from learner failure. Any replacement requires
                    authorization.
                  </p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <>
            <WorkspaceEmpty
              title={
                filter === 'all'
                  ? 'Your evidence record starts here'
                  : 'No records in this category'
              }
            >
              {filter === 'all'
                ? 'Completed work and stored progression will appear here when authoritative records exist.'
                : 'Choose All evidence to review the rest of your authorized record.'}
            </WorkspaceEmpty>
            {filter !== 'all' && (
              <button className={s.button} onClick={() => selectFilter('all')}>
                Show all evidence
              </button>
            )}
          </>
        )}
      </section>
      <aside className={s.stack}>
        <section className={s.card}>
          <h2>Current mastery</h2>
          {nodes.some((n) => n.state === 'mastered') ? (
            <ul className={s.context}>
              {nodes
                .filter((n) => n.state === 'mastered')
                .map((n) => (
                  <li key={n.key}>
                    <Link href={n.roadmapHref}>{n.title}</Link>
                    <StatusBadge state={n.state} />
                    <span className={s.muted}>{n.questTitle}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <WorkspaceEmpty title="No mastery recorded yet">
              A trusted passing result or checkpoint outcome establishes durable mastery.
            </WorkspaceEmpty>
          )}
        </section>
        <section className={s.card} aria-label="Audit chain">
          <h2>Audit chain</h2>
          <HairlineFigure kind="receipts" state="available" />
          <ol className={s.policy}>
            <li>
              <strong>Submission identity</strong>Safe history identifies accepted work.
            </li>
            <li>
              <strong>Recorded outcome</strong>Checkpoint results retain their outcome records.
            </li>
            <li>
              <strong>Stored progression</strong>Mastery and unlock timestamps reflect durable
              progress.
            </li>
          </ol>
          <RecordDetails title="About this evidence">
            <p className={s.muted}>
              The figure is a visual metaphor. It does not verify links between records. Private
              Judge details and unrestricted receipt/event payloads are not available to this view.
            </p>
          </RecordDetails>
        </section>
      </aside>
    </div>
  );
}
