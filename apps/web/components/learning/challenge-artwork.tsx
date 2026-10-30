'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import s from './challenge-artwork.module.css';

const figures = {
  'greeting-card': { title: 'Decorative greeting card', directory: 'greeting-card' },
  'sign-label': { title: 'Decorative sign label', directory: 'sign-label' },
} as const;
export type ChallengeArtworkKey = keyof typeof figures;
export function challengeArtworkKey(nodeKey: string): ChallengeArtworkKey | null {
  return nodeKey === 'greeting-card' || nodeKey === 'sign-label' ? nodeKey : null;
}

/** Decorative supplied geometry only. The brief/controller own all learning meaning. */
export function ChallengeArtwork({ figure }: { figure: ChallengeArtworkKey }) {
  const host = useRef<HTMLDivElement>(null);
  const [interactive, setInteractive] = useState(false);
  const [paused, setPaused] = useState(false);
  const config = figures[figure];
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mouse = window.matchMedia('(any-hover: hover) and (any-pointer: fine)');
    let visible = false;
    const refresh = () =>
      setInteractive(
        visible && !reduced.matches && mouse.matches && document.visibilityState === 'visible',
      );
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
            refresh();
          })
        : null;
    if (host.current) observer?.observe(host.current);
    reduced.addEventListener('change', refresh);
    mouse.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      observer?.disconnect();
      reduced.removeEventListener('change', refresh);
      mouse.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return (
    <div
      className={s.figure}
      data-challenge-artwork={figure}
      data-greeting-card-artwork={figure === 'greeting-card' || undefined}
    >
      <div ref={host} className={s.canvas} aria-hidden="true">
        <Image
          src={'/piscine/hairline/' + config.directory + '/rest.svg'}
          alt=""
          width={400}
          height={320}
          unoptimized
          className={s.rest}
        />
        {interactive && !paused && (
          <iframe
            title={config.title}
            tabIndex={-1}
            aria-hidden="true"
            sandbox="allow-scripts"
            src={'/piscine/hairline/' + config.directory + '/figure.html'}
            className={s.interactive}
          />
        )}
      </div>
      <button
        type="button"
        className={s.control}
        disabled={!interactive}
        aria-pressed={interactive && !paused}
        onClick={() => setPaused((value) => !value)}
      >
        {!interactive
          ? 'Static artwork'
          : paused
            ? 'Enable artwork interaction'
            : 'Disable artwork interaction'}
      </button>
    </div>
  );
}
