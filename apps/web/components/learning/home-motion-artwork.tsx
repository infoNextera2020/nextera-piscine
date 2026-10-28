'use client';
import Image from 'next/image';
import { useEffect, useId, useRef, useState } from 'react';
import { homeMotionEligible, type HomeMotionConditions } from './home-motion-policy';
import s from './home-motion-artwork.module.css';

const poster = '/piscine/home-animation/nextera_home_v9_final_poster.webp';
type Connection = EventTarget & { saveData?: boolean };
/** Approved dark Blender render, static first. No WebGL, hover transform or eager video source. */
export function HomeMotionArtwork() {
  const frame = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLVideoElement>(null);
  const statusId = useId();
  const [conditions, setConditions] = useState<HomeMotionConditions>({
    wide: false,
    reducedMotion: true,
    saveData: true,
    visible: false,
    inViewport: false,
  });
  const [opted, setOpted] = useState(false);
  const [wantsPlayback, setWantsPlayback] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const eligible = homeMotionEligible(conditions);
  const mountVideo = opted && eligible && !failed;
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const refresh = () =>
      setConditions((old) => ({
        ...old,
        wide: wide.matches,
        reducedMotion: reduced.matches,
        saveData: connection?.saveData === true,
        visible: document.visibilityState === 'visible',
      }));
    refresh();
    wide.addEventListener('change', refresh);
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
                inViewport: !!entry?.isIntersecting && entry.intersectionRatio >= 0.25,
              }));
            },
            { threshold: [0, 0.25, 1] },
          )
        : null;
    if (frame.current) observer?.observe(frame.current);
    return () => {
      observer?.disconnect();
      wide.removeEventListener('change', refresh);
      reduced.removeEventListener('change', refresh);
      connection?.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, []);
  useEffect(() => {
    if (!eligible) {
      setWantsPlayback(false);
      setPlaying(false);
    }
  }, [eligible]);
  useEffect(() => {
    const video = media.current;
    if (!video || !mountVideo) return;
    let disposed = false;
    if (wantsPlayback) {
      void video.play().catch(() => {
        if (!disposed) {
          setFailed(true);
          setWantsPlayback(false);
          setPlaying(false);
        }
      });
    } else video.pause();
    return () => {
      disposed = true;
      video.pause();
    };
  }, [mountVideo, wantsPlayback]);
  function toggle() {
    if (!eligible) return;
    if (wantsPlayback) setWantsPlayback(false);
    else {
      setFailed(false);
      setOpted(true);
      setWantsPlayback(true);
    }
  }
  return (
    <div
      ref={frame}
      className={s.frame}
      data-home-motion
      data-eligible={eligible}
      data-playing={playing}
    >
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
            setWantsPlayback(false);
            setPlaying(false);
          }}
        >
          <source src="/piscine/home-animation/nextera_home_v9_final_5s.webm" type="video/webm" />
          <source src="/piscine/home-animation/nextera_home_v9_final_5s.mp4" type="video/mp4" />
        </video>
      )}
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
          : wantsPlayback
            ? 'Pause artwork'
            : failed
              ? 'Retry artwork'
              : 'Play artwork'}
      </button>
      <p id={statusId} className={s.srOnly} role="status">
        {failed
          ? 'Animation unavailable. Static artwork is shown.'
          : playing
            ? 'Decorative artwork animation is playing.'
            : 'Static artwork. Optional motion is available on larger screens without reduced-motion or data-saving preferences.'}
      </p>
    </div>
  );
}
