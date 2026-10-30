import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import s from './auth-split.module.css';
import { AuthViewport } from './auth-viewport';
import { LearningSurface } from './design-exploration';

export function AuthSplitSurface({ children }: { children: ReactNode }) {
  return (
    <LearningSurface page="auth">
      <AuthViewport className={s.page}>
        <section className={s.panel} aria-label="Account access">
          <header className={s.brand}>
            <Link href="/" aria-label="01 coding Piscine home">
              <Image src="/branding/01-coding/mark.svg" width={42} height={42} alt="" unoptimized />
            </Link>
          </header>
          <div className={s.content}>{children}</div>
        </section>
        <aside className={s.art} aria-hidden="true">
          <picture>
            <source
              media="(min-width: 761px) and (min-aspect-ratio: 161/100) and (max-aspect-ratio: 851/320)"
              type="image/webp"
              srcSet="/piscine/auth/nextera-auth-panel-square-600.webp 600w, /piscine/auth/nextera-auth-panel-square-900.webp 900w, /piscine/auth/nextera-auth-panel-square-1280.webp 1280w"
              sizes="50vw"
            />
            <source
              media="(min-width: 761px) and (min-aspect-ratio: 161/100) and (max-aspect-ratio: 851/320)"
              type="image/png"
              srcSet="/piscine/auth/nextera-auth-panel-square-fallback.png"
            />
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
          <span>01 coding. YOUR JOURNEY.</span>
        </aside>
      </AuthViewport>
    </LearningSurface>
  );
}
