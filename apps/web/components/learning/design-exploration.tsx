import type { ReactNode } from 'react';
import s from './design-exploration.module.css';

/** Opt-in visual comparison only. It does not own data, navigation or artwork state. */
export function DesignExploration({
  children,
  page,
}: {
  children: ReactNode;
  page: 'home' | 'challenge';
}) {
  return (
    <div className={s.surface} data-design-exploration="calm" data-page={page}>
      {children}
    </div>
  );
}
