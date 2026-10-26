import { HEART_HEIGHT, HEART_WIDTH } from './heart-map';

/** Fit the approved geometry; mobile crops only the drawing's unused outer margin. */
export function fitHeartViewport(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const bounds =
    width < 640
      ? { x: 280, y: 80, width: 2040, height: 1720 }
      : { x: 0, y: 0, width: HEART_WIDTH, height: HEART_HEIGHT };
  const scale = Math.min(width / bounds.width, height / bounds.height);
  return {
    scale,
    frameWidth: bounds.width * scale,
    frameHeight: bounds.height * scale,
    canvasWidth: HEART_WIDTH * scale,
    canvasHeight: HEART_HEIGHT * scale,
    left: -bounds.x * scale,
    top: -bounds.y * scale,
  };
}
