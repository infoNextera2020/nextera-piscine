import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import s from './auth-split.module.css';

export function AuthSplitSurface({ children }: { children: ReactNode }) {
  return (
    <main className={s.page}>
      <section className={s.panel}>
        <header className={s.brand}>
          <Link href="/" aria-label="NextEra Piscine home">
            <Image
              src="/piscine/official-coding-logo.svg"
              width={42}
              height={42}
              alt=""
              unoptimized
            />
            <span>
              <strong>NextEra</strong>
              <small>PISCINE</small>
            </span>
          </Link>
        </header>
        <div className={s.content}>{children}</div>
      </section>
      <aside className={s.art} aria-hidden="true">
        <picture>
          <source
            type="image/webp"
            srcSet="/piscine/auth/nextera-auth-sculpture-600.webp 600w, /piscine/auth/nextera-auth-sculpture-900.webp 900w, /piscine/auth/nextera-auth-sculpture-1200.webp 1200w"
            sizes="(max-width: 760px) 100vw, 50vw"
          />
          <Image
            src="/piscine/auth/nextera-auth-sculpture-fallback.png"
            width={1200}
            height={1680}
            alt=""
            decoding="async"
            loading="eager"
            unoptimized
          />
        </picture>
        <span>NEXT ERA. YOUR JOURNEY.</span>
      </aside>
    </main>
  );
}
