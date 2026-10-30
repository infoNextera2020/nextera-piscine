import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { HomeMotionArtwork } from '../../components/learning/home-motion-artwork';
import {
  homeMotionEligible,
  type HomeMotionConditions,
} from '../../components/learning/home-motion-policy';
describe('Approved Home motion automatically loops after eligibility', () => {
  const allowed: HomeMotionConditions = {
    reducedMotion: false,
    saveData: false,
    visible: true,
    inViewport: true,
  };
  it('has no video element or source URL before verified browser eligibility', () => {
    const html = renderToStaticMarkup(createElement(HomeMotionArtwork));
    expect(html).not.toContain('<video');
    expect(html).not.toContain('.webm');
    expect(html).not.toContain('.mp4');
    expect(html).toContain('01-coding-home-v10-poster-black.webp');
    expect(html).toContain('01-coding-home-v10-poster-black.png');
    expect(html).toContain('width="600"');
    expect(html).toContain('height="660"');
    expect(html).toContain('Static artwork');
    expect(html).toContain('disabled=""');
  });
  it('retains exact V10 input bytes and V9 sources with a lossless static fallback', () => {
    const directory = 'apps/web/public/piscine/home-animation/';
    const provenance = JSON.parse(readFileSync(directory + 'V10-PROVENANCE.json', 'utf8')) as {
      trial_theme: string;
      assets: Record<string, { filename: string; sha256: string; bytes: number }>;
      png_fallback: { filename: string; sha256: string; decoded_pixels_identical: boolean };
      preserved_v9_sha256: Record<string, string>;
      selected: { poster: string; fallback: string };
    };
    expect(provenance.trial_theme).toContain('dark-only');
    expect(provenance.selected.poster).toBe('01-coding-home-v10-poster-black.webp');
    expect(provenance.selected.fallback).toBe('01-coding-home-v10-poster-black.png');
    for (const asset of Object.values(provenance.assets)) {
      const bytes = readFileSync(directory + asset.filename);
      expect(bytes.byteLength).toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    }
    const fallback = readFileSync(directory + provenance.png_fallback.filename);
    expect(createHash('sha256').update(fallback).digest('hex')).toBe(
      provenance.png_fallback.sha256,
    );
    expect(provenance.png_fallback.decoded_pixels_identical).toBe(true);
    for (const [filename, digest] of Object.entries(provenance.preserved_v9_sha256))
      expect(
        createHash('sha256')
          .update(readFileSync(directory + filename))
          .digest('hex'),
      ).toBe(digest);
  });
  it('permits motion only when all four conditions allow it', () => {
    expect(homeMotionEligible(allowed)).toBe(true);
    for (const condition of [
      { reducedMotion: true },
      { saveData: true },
      { visible: false },
      { inViewport: false },
    ])
      expect(homeMotionEligible({ ...allowed, ...condition })).toBe(false);
  });
  it('does not treat unknown/coerced browser conditions as permission', () => {
    for (const condition of [
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
