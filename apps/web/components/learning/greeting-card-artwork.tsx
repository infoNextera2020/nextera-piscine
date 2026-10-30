'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import s from './greeting-card-artwork.module.css';

/** Decorative, isolated supplied figure. The brief and server controller retain all meaning. */
export function GreetingCardArtwork() {
  const host = useRef<HTMLDivElement>(null);
  const [interactive, setInteractive] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const refresh = () =>
      setInteractive(visible && !reduced.matches && document.visibilityState === 'visible');
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
            refresh();
          })
        : null;
    if (host.current) observer?.observe(host.current);
    reduced.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      observer?.disconnect();
      reduced.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return (
    <div className={s.figure} data-greeting-card-artwork>
      <div ref={host} className={s.canvas} aria-hidden="true">
        <Image
          src="/piscine/hairline/greeting-card/rest.svg"
          alt=""
          width={400}
          height={320}
          unoptimized
          className={s.rest}
        />
        {interactive && !paused && (
          <iframe
            title="Decorative greeting card"
            tabIndex={-1}
            aria-hidden="true"
            sandbox="allow-scripts"
            src="/piscine/hairline/greeting-card/figure.html"
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
        {!interactive ? 'Static artwork' : paused ? 'Play artwork' : 'Pause artwork'}
      </button>
    </div>
  );
}
