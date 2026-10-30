'use client';
import Image from 'next/image';
import { useEffect, useId, useRef, useState } from 'react';
import { homeMotionEligible, type HomeMotionConditions } from './home-motion-policy';
import s from './home-motion-artwork.module.css';

const poster = '/piscine/home-animation/nextera_home_v9_final_poster.webp';
type Connection = EventTarget & { saveData?: boolean };
/** Approved rendered loop, never WebGL. Browser gates keep initial and reduced-motion views static. */
export function HomeMotionArtwork() {
  const frame = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLVideoElement>(null);
  const statusId = useId();
  const [conditions, setConditions] = useState<HomeMotionConditions>({
    reducedMotion: true,
    saveData: true,
    visible: false,
    inViewport: false,
  });
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const staticReason = conditions.reducedMotion
    ? 'reduced-motion'
    : conditions.saveData
      ? 'save-data'
      : !conditions.visible
        ? 'page-hidden'
        : !conditions.inViewport
          ? 'offscreen'
          : undefined;
  const eligible = homeMotionEligible(conditions);
  const mountVideo = eligible && !failed;
  const wantsPlayback = mountVideo && !paused;
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const refresh = () =>
      setConditions((old) => ({
        ...old,
        reducedMotion: reduced.matches,
        saveData: connection?.saveData === true,
        visible: document.visibilityState === 'visible',
      }));
    refresh();
    reduced.addEventListener('change', refresh);
    connection?.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              const entry = entries[0];
              setConditions((old) => ({
                ...old,
                inViewport: !!entry?.isIntersecting,
              }));
            },
            { threshold: 0 },
          )
        : null;
    if (frame.current) observer?.observe(frame.current);
    return () => {
      observer?.disconnect();
      reduced.removeEventListener('change', refresh);
      connection?.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, []);
  useEffect(() => {
    const video = media.current;
    if (!video || !mountVideo) return;
    let disposed = false;
    if (wantsPlayback)
      void video.play().catch(() => {
        if (!disposed) {
          setFailed(true);
          setPlaying(false);
        }
      });
    else video.pause();
    return () => {
      disposed = true;
      video.pause();
    };
  }, [mountVideo, wantsPlayback]);
  function toggle() {
    if (!eligible) return;
    if (failed) {
      setFailed(false);
      setPaused(false);
    } else setPaused((value) => !value);
  }
  return (
    <div
      ref={frame}
      className={s.frame}
      data-home-motion
      data-eligible={eligible}
      data-static-reason={staticReason}
      data-playing={playing && wantsPlayback}
    >
      <div className={s.canvas}>
        <picture aria-hidden="true" className={s.poster}>
          <source type="image/webp" srcSet={poster} />
          <Image
            src="/piscine/home-animation/nextera_home_v9_final_poster.png"
            width={600}
            height={660}
            alt=""
            unoptimized
            loading="eager"
            decoding="async"
            className={s.image}
          />
        </picture>
        {mountVideo && (
          <video
            ref={media}
            className={s.video}
            width={600}
            height={660}
            poster={poster}
            autoPlay={wantsPlayback}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
            tabIndex={-1}
            onPlaying={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => {
              setFailed(true);
              setPlaying(false);
            }}
          >
            <source src="/piscine/home-animation/nextera_home_v9_final_5s.webm" type="video/webm" />
            <source src="/piscine/home-animation/nextera_home_v9_final_5s.mp4" type="video/mp4" />
          </video>
        )}
      </div>
      <button
        type="button"
        className={s.control}
        onClick={toggle}
        disabled={!eligible}
        aria-pressed={wantsPlayback}
        aria-describedby={statusId}
      >
        {!eligible
          ? 'Static artwork'
          : failed
            ? 'Retry artwork'
            : paused
              ? 'Play artwork'
              : 'Pause artwork'}
      </button>
      <p id={statusId} className={s.srOnly} role="status">
        {failed
          ? 'Animation unavailable. Static artwork is shown.'
          : !eligible
            ? staticReason === 'reduced-motion'
              ? 'Static artwork respects your reduced-motion preference.'
              : staticReason === 'save-data'
                ? 'Static artwork respects your data-saving preference.'
                : 'Decorative animation pauses while the artwork or page is out of view.'
            : playing && wantsPlayback
              ? 'Decorative artwork animation is playing.'
              : 'Decorative artwork loops automatically while visible unless paused, reduced-motion or data-saving preferences apply.'}
      </p>
    </div>
  );
}
