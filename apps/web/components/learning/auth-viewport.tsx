'use client';
import { useEffect, useRef, type ReactNode } from 'react';

/** Keep account controls inside the visible keyboard viewport; CSS remains the no-JS fallback. */
export function AuthViewport({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Pinch zoom keeps its natural panning space; do not shrink the layout a second time.
      const height = Math.min(window.innerHeight, viewport.height * viewport.scale);
      if (Number.isFinite(height) && height > 0)
        root.current?.style.setProperty('--auth-viewport-height', `${height}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      viewport.removeEventListener('resize', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <main ref={root} className={className} data-auth-viewport>
      {children}
    </main>
  );
}
