/* global document, window, matchMedia, HL */
(() => {
  const stage = document.getElementById('stage');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let definition, handle;
  function clear() {
    handle?.destroy();
    handle = null;
    stage.replaceChildren();
  }
  function reset() {
    clear();
    if (!definition || document.visibilityState !== 'visible') return;
    const svg = HL.mk('svg', {viewBox:'0 0 400 320', 'aria-hidden':'true'}, stage);
    handle = definition.mount({stage, svg, read:{textContent:''}}, definition.range[1]);
    if (reduced.matches) {
      // Freeze exact supplied rest geometry, then dispose every engine listener/frame.
      const still = svg.cloneNode(true);
      clear();
      stage.replaceChildren(still);
    }
  }
  function mouseOnly(event) {
    if (reduced.matches || event.pointerType !== 'mouse') event.stopImmediatePropagation();
  }
  // The original figure owns mouse hit testing. No idle tour or delayed resume is started.
  stage.addEventListener('pointermove', mouseOnly, true);
  stage.addEventListener('pointerdown', mouseOnly, true);
  // Reset outside the original scope so leaving stops motion and restores the exact rest pose.
  stage.addEventListener('pointerleave', reset, true);
  window.hairline = (figure) => {
    definition = figure;
    stage.setAttribute('data-hairline', figure.name);
    HL.inject(document);
    reset();
  };
  document.addEventListener('visibilitychange', reset);
  reduced.addEventListener('change', reset);
  window.addEventListener('pagehide', clear);
})();
