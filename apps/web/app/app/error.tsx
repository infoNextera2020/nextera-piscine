'use client';
import s from '../../components/learning/learning.module.css';
export default function LearningError({ reset }: { reset: () => void }) {
  return (
    <main className={s.errorSurface}>
      <section className={s.card + ' ' + s.panel} role="alert">
        <p className={s.eyebrow}>TEMPORARILY UNAVAILABLE</p>
        <h1>Your learning space couldn’t be loaded.</h1>
        <p>Please try again in a moment.</p>
        <button className={s.primaryButton} onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
