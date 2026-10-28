import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { HomeMotionArtwork } from '../../components/learning/home-motion-artwork';
import {
  homeMotionEligible,
  type HomeMotionConditions,
} from '../../components/learning/home-motion-policy';
describe('Approved Home motion is poster-first and optional', () => {
  const allowed: HomeMotionConditions = {
    wide: true,
    reducedMotion: false,
    saveData: false,
    visible: true,
    inViewport: true,
  };
  it('has no video element or source URL before browser eligibility and user intent', () => {
    const html = renderToStaticMarkup(createElement(HomeMotionArtwork));
    expect(html).not.toContain('<video');
    expect(html).not.toContain('.webm');
    expect(html).not.toContain('.mp4');
    expect(html).toContain('final_poster.webp');
    expect(html).toContain('final_poster.png');
    expect(html).toContain('width="600"');
    expect(html).toContain('height="660"');
    expect(html).toContain('Static artwork');
    expect(html).toContain('disabled=""');
  });
  it('permits motion only when all five conditions allow it', () => {
    expect(homeMotionEligible(allowed)).toBe(true);
    for (const condition of [
      { wide: false },
      { reducedMotion: true },
      { saveData: true },
      { visible: false },
      { inViewport: false },
    ])
      expect(homeMotionEligible({ ...allowed, ...condition })).toBe(false);
  });
  it('does not treat unknown/coerced browser conditions as permission', () => {
    for (const condition of [
      { wide: 'true' },
      { reducedMotion: undefined },
      { saveData: undefined },
      { visible: 1 },
      { inViewport: null },
    ])
      expect(
        homeMotionEligible({ ...allowed, ...condition } as unknown as HomeMotionConditions),
      ).toBe(false);
  });
});
