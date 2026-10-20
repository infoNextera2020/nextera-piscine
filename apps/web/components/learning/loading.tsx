import s from './learning.module.css';
export default function Loading() {
  return (
    <main className={s.loading} aria-busy="true" aria-label="Loading your learning space">
      <div className={s.skeletonHero} />
      <div className={s.skeletonGrid}>
        {[0, 1, 2, 3].map((n) => (
          <div key={n} />
        ))}
      </div>
      <p role="status">Loading your learning space…</p>
    </main>
  );
}
