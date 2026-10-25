import drawings from './hairline-icons.generated.json';
import s from './hairline-icon.module.css';

/** Rest geometry exported from validated original Hairline Create figures; no icon pack. */
export function HairlineIcon({ name, size = 22 }: { name: string; size?: number }) {
  const drawing = drawings[name as keyof typeof drawings] ?? drawings.evidence;
  return (
    <svg
      className={s.drawing}
      width={size}
      height={size}
      viewBox={drawing.viewBox}
      aria-hidden="true"
      focusable="false"
      data-hairline-icon={name}
    >
      {drawing.paths.map((p, i) => (
        <path key={i} d={p.d} data-layer={p.class} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
