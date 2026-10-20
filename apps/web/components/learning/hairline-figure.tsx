'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
/** Decorative only: the authoritative status is always rendered in adjacent DOM. */
export function HairlineFigure({
  kind,
  state,
  prominent = false,
}: {
  kind: 'gate' | 'receipts';
  state: string;
  prominent?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [readyKey, setReadyKey] = useState('');
  const safeState = ['passed', 'active', 'infrastructure_blocked'].includes(state)
    ? state
    : 'locked';
  const identity = kind + ':' + safeState + ':' + prominent;
  const decorate = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc || doc.readyState !== 'complete' || !doc.querySelector('[data-hairline] svg')) return;
    const accent =
      safeState === 'passed'
        ? '#4abc70'
        : safeState === 'infrastructure_blocked'
          ? '#b39aff'
          : safeState === 'active'
            ? '#e6af00'
            : '#8ca3b1';
    if (!doc.getElementById('nextera-hairline-brand')) {
      const style = doc.createElement('style');
      style.id = 'nextera-hairline-brand';
      style.textContent = `:root { --ground:#0c1b25!important; --ink:${accent}!important; --line:#28424e!important; color-scheme:dark!important; } body { min-height:0!important; padding:0!important; display:block!important; background:#0c1b25!important; } main { max-width:340px!important; margin:auto; } .plate { border:0!important; } .controls,#means,#rules,#name,#read { display:none!important; } [data-hairline] svg { width:100%; height:215px; } [data-hairline] svg path { fill:#0c1b25!important; stroke:#6e8795!important; } [data-hairline] svg path.nf { fill:none!important; } [data-hairline] svg path.lo { stroke:#36505f!important; } [data-hairline] svg path.hi { stroke:${accent}!important; }`;
      if (prominent)
        style.textContent +=
          ' main { max-width:520px!important; } [data-hairline] svg { height:300px!important; }';
      doc.head.appendChild(style);
      doc.querySelectorAll('button,input').forEach((el) => el.setAttribute('tabindex', '-1'));
    }
    setReadyKey(identity);
  }, [safeState, identity, prominent]);
  useEffect(() => {
    decorate();
  }, [decorate]);
  return (
    <iframe
      key={identity}
      ref={frame}
      title={kind === 'gate' ? 'Decorative checkpoint gate' : 'Decorative evidence receipt chain'}
      aria-hidden="true"
      tabIndex={-1}
      data-ready={readyKey === identity}
      src={`/piscine/hairline/hairline-${kind}.html?state=${safeState}`}
      style={{
        width: '100%',
        maxWidth: prominent ? 520 : 340,
        height: prominent ? 300 : 215,
        border: 0,
        display: 'block',
        margin: '0 auto',
        opacity: readyKey === identity ? 1 : 0,
      }}
      onLoad={decorate}
    />
  );
}
