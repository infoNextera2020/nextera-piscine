import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Challenge, ChallengeHistory } from '../../components/learning/challenge';
import type { SubmissionSummary } from '@nextera/db/submissions';

const record = (
  state: SubmissionSummary['state'],
  message: string | null = null,
): SubmissionSummary => ({
  id: 'record-one',
  node_key: 'hello-go',
  state,
  created_at: '2026-10-24T10:00:00.000Z',
  feedback: message ? { verdict: state, message } : null,
});
const renderHistory = (items: SubmissionSummary[]) =>
  renderToStaticMarkup(createElement(ChallengeHistory, { items }));

describe('Challenge presentation preserves server evidence', () => {
  it('keeps pending records pending without manufacturing a passing result', () => {
    const html = renderHistory([record('queued')]);
    expect(html).toContain('data-verdict="queued"');
    expect(html).toContain('Your result is pending.');
    expect(html).not.toContain('data-verdict="passed"');
    expect(html).not.toContain('All required checks passed.');
  });
  it('renders only the supplied safe feedback and distinguishes infrastructure failure', () => {
    const html = renderHistory([record('system_error', '<script>server-safe text</script>')]);
    expect(html).toContain('Infrastructure issue. This is not a learner failure.');
    expect(html).toContain('&lt;script&gt;server-safe text&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('record-one');
  });
  it('does not infer first-use or success from a history refresh error elsewhere', () => {
    const html = renderHistory([]);
    expect(html).toContain('No submissions yet');
    expect(html).not.toContain('data-verdict=');
    expect(html).not.toContain('passed');
  });
  it('preserves read-only intake and published file requirements in the new split layout', () => {
    const html = renderToStaticMarkup(
      createElement(Challenge, {
        cohort: 'cohort-one',
        node: 'hello-go',
        rules: { required_files: ['hello.go'], allowed_extensions: ['.go'], max_size_kb: 32 },
        submittable: false,
        initialHistory: [],
        subject: createElement('p', null, 'Real published brief'),
        context: [],
      }),
    );
    expect(html).toContain('Real published brief');
    expect(html).toContain('hello.go');
    expect(html).toContain('32 KiB');
    expect(html).toContain('Submission unavailable');
    expect(html).not.toContain('type="file"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-label="Challenge tools"');
  });
});
