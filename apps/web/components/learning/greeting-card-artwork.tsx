'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import s from './greeting-card-artwork.module.css';

/** Decorative, isolated supplied figure. The brief and server controller retain all meaning. */
export function GreetingCardArtwork() {
  const host = useRef<HTMLDivElement>(null);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    let visible = false;
    const refresh = () =>
      setInteractive(
        visible && !reduced.matches && fine.matches && document.visibilityState === 'visible',
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
    fine.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      observer?.disconnect();
      reduced.removeEventListener('change', refresh);
      fine.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return (
    <div ref={host} className={s.figure} data-greeting-card-artwork aria-hidden="true">
      <Image
        src="/piscine/hairline/greeting-card/rest.svg"
        alt=""
        width={400}
        height={320}
        unoptimized
        className={s.rest}
      />
      {interactive && (
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
  );
}
