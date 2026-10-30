import type { ReactNode } from 'react';
import s from './design-exploration.module.css';

/** Shared adopted presentation only: data, navigation and artwork state stay with callers. */
export function LearningSurface({
  children,
  page,
}: {
  children: ReactNode;
  page: 'home' | 'journey' | 'challenge' | 'auth' | 'checkpoint' | 'project' | 'staff';
}) {
  return (
    <div
      className={s.surface}
      data-learning-surface="calm"
      data-design-exploration="calm"
      data-page={page}
    >
      {children}
    </div>
  );
}

/** Compatibility export for retained review harnesses. */
export const DesignExploration = LearningSurface;
