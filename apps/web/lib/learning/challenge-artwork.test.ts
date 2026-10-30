import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChallengeArtwork, challengeArtworkKey } from '../../components/learning/challenge-artwork';
import { FocusedChallenge } from '../../components/learning/focused-challenge';

const directory = 'apps/web/public/piscine/hairline/sign-label/';
const read = (file: string) => readFileSync(directory + file, 'utf8');
describe('Reusable challenge artwork boundary', () => {
  it('allows only the two exact reviewed node keys', () => {
    expect(challengeArtworkKey('greeting-card')).toBe('greeting-card');
    expect(challengeArtworkKey('sign-label')).toBe('sign-label');
    for (const key of ['SignLabel', 'other', '../sign-label', 'sign-label?token=x'])
      expect(challengeArtworkKey(key)).toBeNull();
  });
  it('preserves SignLabel source/kernel bytes and embeds the single shared hover-only host', () => {
    const provenance = JSON.parse(read('PROVENANCE.json'));
    const host = read('figure.html');
    const scripts = [...host.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
    expect(scripts).toHaveLength(3);
    expect(createHash('sha256').update(scripts[0]!).digest('hex')).toBe(provenance.kernel_sha256);
    expect(scripts[2]).toBe(read('q02-sign-label.js'));
    expect(createHash('sha256').update(scripts[2]!).digest('hex')).toBe(provenance.figure_sha256);
    expect(scripts[1]).toBe(
      readFileSync('apps/web/public/piscine/hairline/challenge-figure-host.js', 'utf8'),
    );
    expect(scripts[1]).not.toContain('HL.tour(');
    expect(scripts[1]).toContain("stage.addEventListener('pointerleave', reset, true)");
    expect(scripts[1]).toContain('svg.cloneNode(true)');
    expect(host).not.toMatch(/id="(hl-bench|intensity|play|name|read|means|rules)"/);
    expect(host).not.toMatch(/fetch\(|XMLHttpRequest|eval\(|localStorage|WebSocket/);
    for (const script of scripts)
      expect(host).toContain(
        "'sha256-" + createHash('sha256').update(script).digest('base64') + "'",
      );
  });
  it('serves original 5:4 black occluding rest geometry with inert SSR and no embedded author controls', () => {
    const html = renderToStaticMarkup(createElement(ChallengeArtwork, { figure: 'sign-label' }));
    expect(html).toContain('data-challenge-artwork="sign-label"');
    expect(html).toContain('/sign-label/rest.svg');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('data-greeting-card-artwork');
    expect(html).toContain('width="400"');
    expect(html).toContain('height="320"');
    const rest = read('rest.svg');
    expect(rest).toContain('viewBox="0 0 400 320"');
    expect(rest).toContain('fill:#000');
    expect(rest).toContain('.nf{fill:none}');
    expect(rest).not.toMatch(/<script|<foreignObject|href=/);
  });
  it('selects SignLabel from the actual node while keeping controller-owned content and no intake', () => {
    const html = renderToStaticMarkup(
      createElement(FocusedChallenge, {
        cohort: { id: 'fixture', name: 'Read-only source', version: 'not-published' },
        current: {
          key: 'sign-label',
          title: 'SignLabel',
          questKey: 'quest-2',
          questTitle: 'Quest 2',
          state: 'available',
        },
        rules: { required_files: ['signlabel.go'], allowed_extensions: ['.go'], max_size_kb: 256 },
        role: 'learner',
        subject: createElement('p', null, 'Exact published brief slot'),
        submission: createElement('p', null, 'Submission unavailable'),
        history: createElement('p', null, 'No records'),
        context: [],
      }),
    );
    expect(html).toContain('data-challenge-artwork="sign-label"');
    expect(html).toContain('data-illustrated="true"');
    expect(html).toContain('Exact published brief slot');
    expect(html).toContain('Submission unavailable');
    expect(html).not.toContain('type="file"');
  });
});
