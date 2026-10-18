/** Next normalizes loopback URLs; Host preserves the origin addressed by the browser. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const caller = new URL(origin);
    return (
      caller.origin === origin &&
      caller.host === request.headers.get('host') &&
      caller.protocol === new URL(request.url).protocol
    );
  } catch {
    return false;
  }
}
