import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GreetingCardArtwork } from '../../components/learning/greeting-card-artwork';
import { FocusedChallenge } from '../../components/learning/focused-challenge';
import { Challenge } from '../../components/learning/challenge';

const directory = 'apps/web/public/piscine/hairline/greeting-card/';
const read = (name: string) => readFileSync(directory + name, 'utf8');
const provenance = JSON.parse(read('PROVENANCE.json')) as {
  figure_sha256: string;
  kernel_sha256: string;
};
const current = {
  key: 'greeting-card',
  title: 'GreetingCard',
  questKey: 'quest-2',
  questTitle: 'Quest 2',
  state: 'available' as const,
};
const rules = { required_files: ['main.go'], allowed_extensions: ['.go'], max_size_kb: 256 };
const props = {
  cohort: { id: 'fixture', name: 'Content preview', version: 'not-published' },
  current,
  rules,
  role: 'learner' as const,
  subject: createElement('p', null, 'Approved brief'),
  submission: createElement('p', null, 'Read-only'),
  history: createElement('p', null, 'No submissions'),
  context: [],
};

describe('Supplied GreetingCard figure boundary', () => {
  it('keeps the original figure bytes and the reviewed kernel, excluding bench execution', () => {
    const host = read('figure.html');
    const scripts = [...host.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
    expect(scripts).toHaveLength(3);
    expect(createHash('sha256').update(read('greeting-heart.js')).digest('hex')).toBe(
      provenance.figure_sha256,
    );
    expect(scripts[2]).toBe(read('greeting-heart.js'));
    expect(createHash('sha256').update(scripts[0]!).digest('hex')).toBe(provenance.kernel_sha256);
    expect(host).not.toMatch(/id="(hl-bench|intensity|play|name|read|means|rules)"/);
    expect(host).toContain('HL.tour(stage, definition.tour)');
    expect(host).toContain('#stage>svg{background:var(--hairline-plate,#000)}');
    expect(host).not.toMatch(/fetch\(|XMLHttpRequest|eval\(|localStorage|WebSocket/);
    expect(host).toContain("connect-src 'none'");
    for (const script of scripts)
      expect(host).toContain(
        "'sha256-" + createHash('sha256').update(script).digest('base64') + "'",
      );
  });
  it('provides 5:4 static geometry before client effects and keeps opaque occlusion faces', () => {
    const html = renderToStaticMarkup(createElement(GreetingCardArtwork));
    expect(html).toContain('rest.svg');
    expect(html).toContain('width="400"');
    expect(html).toContain('height="320"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<iframe');
    const rest = read('rest.svg');
    expect(rest).toContain('viewBox="0 0 400 320"');
    expect(rest).toContain('fill:#000');
    expect(rest).toContain('.nf{fill:none}');
    expect(rest).not.toMatch(/<script|<foreignObject|href=/);
  });
  it('adds the figure only to the canonical focused GreetingCard and does not alter task meaning', () => {
    const html = renderToStaticMarkup(createElement(FocusedChallenge, props));
    expect(html).toContain('data-greeting-card-artwork');
    expect(html).toContain('Approved brief');
    expect(html).toContain('Read-only');
    expect(html).not.toContain('type="file"');
    const other = renderToStaticMarkup(
      createElement(FocusedChallenge, {
        ...props,
        current: { ...current, key: 'hello-go', title: 'Hello Go' },
      }),
    );
    expect(other).not.toContain('data-greeting-card-artwork');
  });
  it('preserves the server controller refusal to enable unpublishable intake', () => {
    const html = renderToStaticMarkup(
      createElement(Challenge, {
        cohort: 'fixture',
        node: current.key,
        rules,
        submittable: false,
        initialHistory: [],
        subject: props.subject,
        context: [],
        focused: { cohort: props.cohort, current, role: 'learner' },
      }),
    );
    expect(html).toContain('Submission unavailable');
    expect(html).toContain('data-greeting-card-artwork');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('<textarea');
  });
});
