import Link from 'next/link';
import Markdown from 'react-markdown';
import type { ReactNode } from 'react';
import { StatusBadge } from './primitives';
import { formatMoment } from '../../lib/learning/display';
import s from './workspace.module.css';

export function Subject({ children }: { children: string }) {
  return (
    <article className={s.prose}>
      <Markdown
        skipHtml
        components={{ h1: ({ children }) => <h2>{children}</h2>, img: () => null }}
      >
        {children}
      </Markdown>
    </article>
  );
}
export function WorkspaceHero({
  context,
  title,
  state,
  description,
  facts,
}: {
  context: string;
  title: string;
  state: string | null;
  description: string;
  facts: { label: string; value: string }[];
}) {
  return (
    <header className={s.hero}>
      <span className={s.eyebrow}>{context}</span>
      <h1>{title}</h1>
      {state !== null && <StatusBadge state={state} />}
      <p style={{ marginTop: 14 }}>{description}</p>
      <dl className={s.meta}>
        {facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}
export function WorkspaceEmpty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={s.empty}>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function SafeHistory({
  items,
}: {
  items: {
    id: string;
    state: string;
    created_at?: string;
    feedback?: { message?: string } | null;
  }[];
}) {
  if (!items.length)
    return (
      <WorkspaceEmpty title="Your first submission starts the record">
        Submit your local solution to begin. Only safe results appear here.
      </WorkspaceEmpty>
    );
  return (
    <ol className={s.history}>
      {items.map((item) => (
        <li key={item.id} className={s.record} data-verdict={item.state}>
          <div className={s.recordHead}>
            <strong>Submission</strong>
            <StatusBadge state={item.state} />
          </div>
          {item.state === 'system_error' && (
            <p className={s.notice} data-tone="system">
              Infrastructure issue. This is not a learner failure.
            </p>
          )}
          {item.feedback?.message && <p>{item.feedback.message}</p>}
          <code className={s.identity}>{item.id}</code>
          {item.created_at && (
            <time dateTime={item.created_at}>{formatMoment(item.created_at)}</time>
          )}
        </li>
      ))}
    </ol>
  );
}
export function Breadcrumbs({
  cohort,
  title,
}: {
  cohort: { id: string; name: string };
  title: string;
}) {
  return (
    <nav className={s.crumbs} aria-label="Breadcrumb">
      <Link href="/app">Command Center</Link>
      <span aria-hidden="true">/</span>
      <Link href={'/app/cohorts/' + cohort.id}>{cohort.name}</Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{title}</span>
    </nav>
  );
}
