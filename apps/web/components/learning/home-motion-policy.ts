export type HomeMotionConditions = Readonly<{
  wide: boolean;
  reducedMotion: boolean;
  saveData: boolean;
  visible: boolean;
  inViewport: boolean;
}>;
/** Motion is optional; every gate must be positively satisfied before media sources mount. */
export function homeMotionEligible(c: HomeMotionConditions) {
  return (
    c.wide === true &&
    c.reducedMotion === false &&
    c.saveData === false &&
    c.visible === true &&
    c.inViewport === true
  );
}
