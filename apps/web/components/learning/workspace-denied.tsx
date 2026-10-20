import Link from 'next/link';
import s from './learning.module.css';
export default function WorkspaceDenied() {
  return (
    <main className={s.errorSurface}>
      <section className={s.card + ' ' + s.panel}>
        <h1>This learning page is unavailable.</h1>
        <p>
          It may not exist, or your current access may not permit this view. Return to your
          authorized learning space.
        </p>
        <Link className={s.primaryButton} href="/app">
          Return to Command Center
        </Link>
      </section>
    </main>
  );
}
