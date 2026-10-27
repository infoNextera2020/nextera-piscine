import Image from 'next/image';
import s from './home-rendered-artwork.module.css';

export type HomeRenderAsset = Readonly<{
  fallback: string;
  webpSrcSet: string;
  width: number;
  height: number;
}>;
/** Original Blender renders only. Native picture selection; no WebGL or motion runtime. */
export function HomeRenderedArtwork({ asset }: { asset: HomeRenderAsset }) {
  return (
    <picture className={s.picture} aria-hidden="true" data-rendered-artwork>
      <source
        type="image/webp"
        srcSet={asset.webpSrcSet}
        sizes="(max-width: 767px) calc(100vw - 44px), (max-width: 960px) 420px, (max-width: 1200px) calc((100vw - 336px) / 2.5), (min-width: 1756px) 472px, calc((100vw - 376px) / 2.65)"
      />
      <Image
        unoptimized
        src={asset.fallback}
        alt=""
        width={asset.width}
        height={asset.height}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className={s.image}
      />
    </picture>
  );
}
