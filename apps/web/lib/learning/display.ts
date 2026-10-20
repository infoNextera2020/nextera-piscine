export const stateText: Record<string, string> = {
  available: 'Available',
  in_progress: 'In progress',
  mastered: 'Mastered',
  locked: 'Locked',
  queued: 'Queued',
  running: 'Running',
  passed: 'Passed',
  failed: 'Not passed',
  compile_error: 'Compile error',
  runtime_error: 'Runtime error',
  timeout: 'Time limit',
  system_error: 'Infrastructure issue',
  infrastructure_blocked: 'Recovery required',
  active: 'Active',
  evaluating: 'Evaluating',
  preview: 'Read-only preview',
};
export function displayState(state: string | null) {
  return stateText[state ?? 'preview'] ?? state ?? 'Preview';
}
export function formatMoment(at: string) {
  return (
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Cairo',
    }).format(new Date(at)) + ' Cairo'
  );
}
