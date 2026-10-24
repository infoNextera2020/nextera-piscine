export function uploadFailureMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Sign in again before submitting.';
  if (status === 403)
    return 'Submission access is unavailable for this challenge. Check your access before retrying.';
  if (status === 400 || status === 413)
    return 'The upload was rejected. Check the required filename, file size, and published submission rules.';
  if (status === 409)
    return 'This upload conflicts with a previous request. Contact an operator if retrying does not resolve it.';
  if (status === 503)
    return 'Submission intake is temporarily unavailable. Your result has not been confirmed. Retry shortly.';
  return 'Submission could not be confirmed. Keep your source file and retry.';
}

export function historyFailureMessage(status?: number): string {
  const reason =
    status === 401
      ? 'Your session has expired. Sign in again to refresh history.'
      : status === 403
        ? 'History access is unavailable. Check your access before retrying.'
        : status === 400
          ? 'This history request is invalid. Reopen the challenge from Journey.'
          : 'History is temporarily unavailable. Retry shortly.';
  return `${reason} The last confirmed record is shown.`;
}
