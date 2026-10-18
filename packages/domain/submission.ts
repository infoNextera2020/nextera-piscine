import type { SubmissionRules } from './curriculum.ts';
import type { DomainUser } from './access.ts';
import { AccessDenied } from './access.ts';

export function assertLearnerSubmission(user: DomainUser) {
  if (!user.active || user.role !== 'learner') throw new AccessDenied('FORBIDDEN');
}

/** A filename is an allowlisted label, never a path or an executable guarantee. */
export function validateSubmissionFile(name: string, size: number, rules: SubmissionRules) {
  if (
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]*\.go$/.test(name) ||
    rules.required_files.length !== 1 ||
    rules.required_files[0] !== name ||
    !rules.allowed_extensions.includes('.go') ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > Math.min(262144, rules.max_size_kb * 1024)
  )
    throw new Error('INVALID_ARTIFACT');
}

export const isRequestId = (value: string) =>
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
