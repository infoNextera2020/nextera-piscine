import { describe, expect, it } from 'vitest';
import { HEART_HEIGHT, HEART_ROUTE, HEART_WIDTH } from './heart-map';
import { fitHeartViewport } from './heart-viewport';

describe('Full-heart viewport framing', () => {
  it.each([
    [1144, 792],
    [568, 850],
    [370, 730],
    [300, 650],
    [370, 180],
  ])(
    'keeps every route point inside the available %sx%s without changing the aspect ratio',
    (width, height) => {
      const fit = fitHeartViewport(width!, height!)!;
      expect(fit.frameWidth).toBeLessThanOrEqual(width! + 0.001);
      expect(fit.frameHeight).toBeLessThanOrEqual(height! + 0.001);
      expect(fit.canvasWidth / fit.canvasHeight).toBeCloseTo(HEART_WIDTH / HEART_HEIGHT);
      for (const point of HEART_ROUTE) {
        const x = point.x * fit.scale + fit.left,
          y = point.y * fit.scale + fit.top;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(fit.frameWidth);
        expect(y).toBeLessThanOrEqual(fit.frameHeight);
      }
    },
  );
  it.each([
    [0, 500],
    [500, 0],
    [-1, 500],
    [NaN, 500],
    [500, Infinity],
  ])('does not write invalid geometry for %s by %s', (width, height) =>
    expect(fitHeartViewport(width!, height!)).toBeNull(),
  );
});
