import { describe, expect, it } from 'vitest';
import { resultProgression } from '../progression';
import type { ProgressState } from '../states';
const edges = [
  { from: 'hello', to: 'even', rule: 'requires_pass' as const },
  { from: 'other', to: 'both', rule: 'requires_pass' as const },
  { from: 'hello', to: 'both', rule: 'requires_pass' as const },
];
const states = () =>
  new Map<string, ProgressState>([
    ['hello', 'in_progress'],
    ['even', 'locked'],
    ['other', 'available'],
    ['both', 'locked'],
  ]);
describe('authoritative result progression', () => {
  it('masters once and unlocks only complete AND prerequisites', () => {
    expect(resultProgression('hello', 'passed', states(), edges)).toEqual([
      { node: 'hello', previous: 'in_progress', next: 'mastered' },
      { node: 'even', previous: 'locked', next: 'available' },
    ]);
    const mastered = states();
    mastered.set('hello', 'mastered');
    expect(resultProgression('hello', 'passed', mastered, edges)).toEqual([]);
  });
  it.each(['failed', 'compile_error', 'runtime_error', 'timeout', 'system_error'] as const)(
    '%s cannot change mastery or unlocks',
    (verdict) => {
      expect(resultProgression('hello', verdict, states(), edges)).toEqual([]);
    },
  );
  it('rejects missing or locked nodes', () => {
    expect(() => resultProgression('even', 'passed', states(), edges)).toThrow(
      'PROGRESS_IDENTITY_CONFLICT',
    );
    expect(() => resultProgression('absent', 'passed', states(), edges)).toThrow(
      'PROGRESS_IDENTITY_CONFLICT',
    );
  });
});
