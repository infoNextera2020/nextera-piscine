import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CheckpointView } from '@nextera/db/checkpoints';
import { Checkpoint } from '../checkpoints/checkpoint';
import { checkpointPresentation } from './checkpoint-presentation';
import { checkpointResultHref } from './checkpoint-result-link';
describe('checkpoint continuation uses durable server outcomes', () => {
  it.each(['passed', 'failed', 'infrastructure_blocked'])(
    'links a stored %s outcome to its exact historical attempt',
    (status) => {
      expect(
        checkpointResultHref('assigned', 'gate', {
          id: 'older-attempt',
          status,
          outcome_id: 'outcome',
        }),
      ).toBe('/app/cohorts/assigned/checkpoints/gate/result?attempt=older-attempt');
    },
  );
  it('does not create a result from active/evaluating states or a missing outcome identity', () => {
    for (const status of ['active', 'evaluating', 'unknown'])
      expect(
        checkpointResultHref('assigned', 'gate', { id: 'a', status, outcome_id: 'contradictory' }),
      ).toBeNull();
    expect(
      checkpointResultHref('assigned', 'gate', { id: 'a', status: 'passed', outcome_id: null }),
    ).toBeNull();
  });
  it('encodes supplied identities without putting outcome payloads in the URL', () => {
    const href = checkpointResultHref('assigned', 'gate', {
      id: 'attempt/?x=1',
      status: 'failed',
      outcome_id: 'private-record-identity',
    });
    expect(href).toContain('attempt=attempt%2F%3Fx%3D1');
    expect(href).not.toContain('private-record-identity');
  });
  it('renders finalized attempt navigation while keeping unfinished attempts separate', () => {
    const raw: CheckpointView = {
      server_now: '2026-10-25T09:00:00Z',
      eligible: false,
      replacement_available: false,
      attempt: null,
      tasks: [],
      submissions: [],
      history: [
        {
          id: 'older',
          status: 'failed',
          points: 2,
          normal_slot: 1,
          kind: 'normal',
          started_at: '2026-10-24T08:00:00Z',
          deadline_at: '2026-10-24T09:30:00Z',
          completed_at: '2026-10-24T09:31:00Z',
          outcome_id: 'stored-outcome',
        },
        {
          id: 'pending',
          status: 'evaluating',
          points: null,
          normal_slot: 2,
          kind: 'normal',
          started_at: '2026-10-25T08:00:00Z',
          deadline_at: '2026-10-25T09:30:00Z',
          completed_at: null,
          outcome_id: null,
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(Checkpoint, {
        cohort: 'assigned',
        node: 'gate',
        initial: checkpointPresentation(raw),
      }),
    );
    expect(html).toContain('result?attempt=older');
    expect(html).not.toContain('result?attempt=pending');
    expect(html).not.toContain('Start checkpoint');
  });
});
