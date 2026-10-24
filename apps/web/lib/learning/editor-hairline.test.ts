import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EditorHairline } from '../../components/learning/editor-hairline';

describe('decorative Hairline integration', () => {
  it('starts with a visible static fallback and no active frame before motion eligibility is known', () => {
    const html = renderToStaticMarkup(createElement(EditorHairline));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-motion="static"');
    expect(html).toContain('nextera-terminal-rest.svg');
    expect(html).toContain('alt=""');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<button');
  });
  it('retains the supplied standalone HTML and matching separate drawing source unchanged', () => {
    const html = readFileSync('apps/web/public/piscine/hairline/hairline-nextera-terminal.html');
    expect(createHash('sha256').update(html).digest('hex')).toBe(
      '42b62bc90b648f1701b6c2440cdabc3b0a06f90e941e0c93b2422693c7b05ae7',
    );
    const embedded = html
      .toString()
      .match(/<script[^>]*id="hl-figure"[^>]*>([\s\S]*?)<\/script>/)?.[1]
      ?.trim();
    expect(embedded).toBe(
      readFileSync('apps/web/public/piscine/hairline/nextera-terminal.js', 'utf8').trim(),
    );
  });
  it('keeps the static fallback passive and free of scripts or external resources', () => {
    const svg = readFileSync('apps/web/public/piscine/hairline/nextera-terminal-rest.svg', 'utf8');
    expect(svg).toContain('viewBox="0 0 400 320"');
    expect(svg).not.toMatch(/<script|foreignObject|(?:href|src)=["']https?:|onload=/i);
  });
});
