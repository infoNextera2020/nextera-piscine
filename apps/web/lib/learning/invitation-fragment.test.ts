import { describe, expect, it, vi } from 'vitest';
import { consumeInvitationFragment } from './invitation-fragment';

const token = 'a'.repeat(43); // Synthetic bytes, not an issued invitation.
const location = { pathname: '/signup', search: '', hash: '#invitation=' + token };
describe('memory-only invitation fragment handoff', () => {
  it('strips the fragment before releasing exact capability bytes to the caller', () => {
    const events: string[] = [];
    const result = consumeInvitationFragment(location, (safeUrl) => {
      expect(safeUrl).toBe('/signup');
      expect(safeUrl).not.toContain(token);
      events.push('URL removed');
    });
    events.push('caller receives result');
    expect(events).toEqual(['URL removed', 'caller receives result']);
    expect(result).toEqual({ status: 'ready', token });
    expect(location.hash).toBe('#invitation=' + token); // No hidden mutable global state.
  });
  it('never releases capability bytes if history replacement fails', () => {
    const result = consumeInvitationFragment(location, () => {
      throw new Error('private failure');
    });
    expect(result).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it.each([
    '#token=' + token,
    '#invitation=' + token + '&invitation=' + token,
    '#invitation=' + token + '&cohort=other',
    '#%69nvitation=' + token,
    '#invitation=%61' + token.slice(1),
    '#invitation=' + token + 'x',
    '#invitation=' + token.slice(1),
    '#invitation=' + 'é'.repeat(43),
    '#invitation=' + 'x'.repeat(100_000),
  ])('rejects an ambiguous, encoded or oversized fragment', (hash) => {
    const replace = vi.fn();
    expect(consumeInvitationFragment({ ...location, hash }, replace)).toEqual({
      status: 'invalid',
    });
    expect(replace).toHaveBeenCalledExactlyOnceWith('/signup');
  });
  it.each([
    '?invitation=' + token,
    '?token=' + token,
    '?cohort=other',
    '?invitation=' + token + '&invitation=other',
  ])('rejects query-bound authority even with a valid fragment', (search) => {
    const replace = vi.fn();
    expect(consumeInvitationFragment({ ...location, search }, replace)).toEqual({
      status: 'invalid',
    });
    expect(replace).toHaveBeenCalledExactlyOnceWith('/signup');
  });
  it('does not reinterpret other routes as invitation signup', () => {
    const replace = vi.fn();
    expect(consumeInvitationFragment({ ...location, pathname: '/operator' }, replace)).toEqual({
      status: 'invalid',
    });
    expect(replace).not.toHaveBeenCalled();
  });
  it('has no retained capability after a later invocation with the stripped URL', () => {
    expect(consumeInvitationFragment(location, () => {})).toEqual({ status: 'ready', token });
    const replace = vi.fn();
    expect(consumeInvitationFragment({ ...location, hash: '' }, replace)).toEqual({
      status: 'missing',
    });
    expect(replace).not.toHaveBeenCalled();
  });
});
