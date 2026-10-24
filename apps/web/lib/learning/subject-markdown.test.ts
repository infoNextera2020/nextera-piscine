import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Subject } from '../../components/learning/workspace-parts';
const render = (source: string) =>
  renderToStaticMarkup(createElement(Subject, { children: source }));
describe('Published brief presentation', () => {
  it('renders the existing Hello Go subject with literal placeholder, signature and separate examples', () => {
    const source = readFileSync('content/piscine-v1/challenges/hello-go/subject.md', 'utf8');
    const html = render(source);
    expect(html).toContain('Hello, &lt;name&gt;!');
    expect(html).toContain('func Hello(name string) string');
    expect(html.match(/<pre\b/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Examples"');
    expect(html).toContain('Hello(&quot;Anas&quot;)');
    expect(html).toContain('// &quot;Hello, Anas!&quot;');
    expect(html).toMatch(/<h3>Rules<\/h3>/);
    expect(html).not.toMatch(/>Input<|>Output</);
    expect(readFileSync('content/piscine-v1/challenges/hello-go/subject.md', 'utf8')).toBe(source);
  });
  it('supports another existing brief and keeps prose after examples out of code blocks', () => {
    const html = render(
      readFileSync('content/piscine-v1/challenges/even-or-odd/subject.md', 'utf8'),
    );
    expect(html).toContain('EvenOrOdd(10)');
    expect(html).toContain('// &quot;even&quot;');
    expect(html).toContain('<p>Negative numbers and zero must also work.</p>');
    expect(html.match(/<pre\b/g)).toHaveLength(3);
  });
  it('preserves explicit input/output labels and language without inventing new ones', () => {
    const html = render(
      '## Examples\n\n### Input\n\n```text\nsource-value\n```\n\n### Output\n\n```text\nexplicit-result\n```',
    );
    expect(html).toContain('<h3>Input</h3>');
    expect(html).toContain('<h3>Output</h3>');
    const examples = html.match(/<section[\s\S]*?<\/section>/)?.[0];
    expect(examples).toContain('<h3>Input</h3>');
    expect(examples).toContain('<h3>Output</h3>');
    expect(html).toContain('source-value');
    expect(html).toContain('explicit-result');
    expect(html).toContain('aria-label="text code block"');
  });
  it('does not promote labels or modify spacing inside fenced code', () => {
    const html = render('```go\nExamples\nRules\n  untouched := 1\n```');
    expect(html).toContain('Examples\nRules\n  untouched := 1');
    expect(html).not.toContain('aria-label="Examples"');
    expect(html).not.toContain('<h3>');
  });
  it('escapes HTML as literal source and never enables scripts, images or dangerous links', () => {
    const html = render(
      'Return <value>.\n\n<script>window.unsafe()</script>\n\n![remote](https://example.test/pixel.png)\n\n[unsafe](javascript:alert(1))',
    );
    expect(html).toContain('&lt;value&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script|<img|href="javascript:/);
  });
  it('does not guess arbitrary example prose as code or inject exercise-specific content', () => {
    const html = render(
      'Examples\n\nUse any valid string. The expected result is defined above.\n\nRules\n\n- Preserve this rule.',
    );
    expect(html).toContain('<p>Use any valid string. The expected result is defined above.</p>');
    expect(html).not.toContain('<pre');
    expect(html).not.toMatch(/Hello|EvenOrOdd/);
    expect(html).toContain('<li>Preserve this rule.</li>');
  });
  it('makes code scroll regions keyboard reachable and preserves long source lines', () => {
    const line = 'a'.repeat(240);
    const html = render('```text\n' + line + '\n```');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="text code block"');
    expect(html).toContain(line);
    expect(html).not.toContain('<textarea');
  });
});
