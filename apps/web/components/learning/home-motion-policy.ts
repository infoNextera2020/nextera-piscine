export type HomeMotionConditions = Readonly<{
  reducedMotion: boolean;
  saveData: boolean;
  visible: boolean;
  inViewport: boolean;
}>;
/** Automatic looping requires positive visibility and accessibility/data eligibility. */
export function homeMotionEligible(c: HomeMotionConditions) {
  return (
    c.reducedMotion === false && c.saveData === false && c.visible === true && c.inViewport === true
  );
}
