import { describe, expect, it } from 'vitest';
import { assertLearnerSubmission, isRequestId, validateSubmissionFile } from '../submission.ts';

const rules = { required_files: ['hello.go'], allowed_extensions: ['.go'], max_size_kb: 256 };
describe('submission intake policy', () => {
  it('bounds exact filenames and bytes without interpreting the file as code', () => {
    expect(() => validateSubmissionFile('hello.go', 262144, rules)).not.toThrow();
    for (const [name, size] of [
      ['../hello.go', 10],
      ['hello.go/extra', 10],
      ['HELLO.go', 10],
      ['hello.go.exe', 10],
      ['hello.go', 0],
      ['hello.go', 262145],
      ['hello.go', NaN],
      ['hello.go\0', 10],
    ] as const)
      expect(() => validateSubmissionFile(name, size, rules)).toThrow('INVALID_ARTIFACT');
  });
  it('does not turn preview roles into learner authority', () => {
    for (const role of ['operator', 'admin'] as const)
      expect(() =>
        assertLearnerSubmission({ id: 'u', authUserId: 'a', displayName: 'x', active: true, role }),
      ).toThrow('FORBIDDEN');
  });
  it('uses one opaque request identity across transport retries', () => {
    expect(isRequestId('bbefc2db-b946-4d5e-8af3-79c240ad43e7')).toBe(true);
    expect(isRequestId('../artifact')).toBe(false);
  });
});
