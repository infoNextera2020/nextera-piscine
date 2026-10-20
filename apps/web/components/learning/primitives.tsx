import type { CSSProperties, ReactNode } from 'react';
import { displayState } from '../../lib/learning/display';
import s from './learning.module.css';
export function StatusBadge({ state, label }: { state: string | null; label?: string }) {
  return (
    <span className={s.badge} data-state={state ?? 'preview'}>
      {label ?? displayState(state)}
    </span>
  );
}
export function ProgressBar({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  return (
    <span
      className={s.progressBar}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total || 1}
      aria-valuenow={done}
      aria-valuetext={done + ' of ' + total}
    >
      <span style={{ width: (total ? (done / total) * 100 : 0) + '%' }} />
    </span>
  );
}
export function ProgressRing({ done, total }: { done: number; total: number }) {
  return (
    <div
      className={s.progressRing}
      style={{ '--progress': (total ? (done / total) * 100 : 0) + '%' } as CSSProperties}
      aria-label={done + ' of ' + total + ' curriculum nodes mastered'}
    >
      <div>
        <strong>
          {done}
          <span> / {total}</span>
        </strong>
        <small>Nodes mastered</small>
      </div>
    </div>
  );
}
export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={s.card + ' ' + s.panel + ' ' + className}>
      <header className={s.panelHead}>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
