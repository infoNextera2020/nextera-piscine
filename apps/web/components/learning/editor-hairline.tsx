'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import s from './editor-hairline.module.css';

/** User-supplied Hairline scene; presentation only, never connected to evaluation. */
export function EditorHairline() {
  const host = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);
  const [motionAllowed, setMotionAllowed] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = window.matchMedia('(min-width: 48rem) and (hover: hover) and (pointer: fine)');
    const update = () => {
      const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
        ?.saveData;
      setMotionAllowed(
        !reduced.matches && desktop.matches && !saveData && document.visibilityState === 'visible',
      );
    };
    update();
    reduced.addEventListener('change', update);
    desktop.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold: 0.01 },
    );
    if (host.current) observer.observe(host.current);
    return () => {
      observer.disconnect();
      reduced.removeEventListener('change', update);
      desktop.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  const animate = inView && motionAllowed;
  return (
    <span
      ref={host}
      className={s.drawing}
      aria-hidden="true"
      data-editor-hairline
      data-motion={animate ? 'active' : 'static'}
    >
      <Image
        className={s.rest}
        src="/piscine/hairline/nextera-terminal-rest.svg"
        alt=""
        width={164}
        height={132}
        unoptimized
      />
      {animate && <AnimatedTerminal />}
    </span>
  );
}

function AnimatedTerminal() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  function decorate() {
    const doc = frame.current?.contentDocument;
    if (
      !doc?.querySelector('[data-hairline] svg') ||
      doc.getElementById('error')?.textContent?.trim()
    )
      return;
    if (!doc.getElementById('nextera-editor-presentation')) {
      const style = doc.createElement('style');
      style.id = 'nextera-editor-presentation';
      // Host styling only. The supplied figure, kernel and bench remain byte-identical.
      style.textContent = `
        :root { --ground:#101211!important; color-scheme:dark; }
        body { display:block; min-height:0; padding:0; overflow:hidden; background:#101211; }
        main { width:100%; max-width:none; }
        .plate { border:0; border-radius:0; }
        .controls,#name,#read,#means,#rules,#error { display:none!important; }
        #stage { --hairline-plate:#101211; --hairline-edge:#a6b8ac; --hairline-mid:#7a8f80; --hairline-lo:#52665a; --hairline-hi:#4bd17b; }
        #stage>svg { display:block; width:100%; height:auto; }
      `;
      doc.head.appendChild(style);
      doc.querySelectorAll<HTMLElement>('button,input,[tabindex]').forEach((el) => {
        el.tabIndex = -1;
      });
      doc.getElementById('stage')?.setAttribute('aria-hidden', 'true');
    }
    setReady(true);
  }
  return (
    <iframe
      ref={frame}
      className={s.frame}
      data-ready={ready}
      src="/piscine/hairline/hairline-nextera-terminal.html?theme=dark&intensity=0.35"
      title="Decorative Hairline terminal workstation"
      aria-hidden="true"
      tabIndex={-1}
      loading="lazy"
      referrerPolicy="no-referrer"
      onLoad={decorate}
    />
  );
}
