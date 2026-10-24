import { AccessDenied, assertLearnerSubmission, isRequestId } from '@nextera/domain';
import { readSubmissions } from '@nextera/db/submissions';
import { getDatabase, requireDomainUser } from '../../../../lib/auth/server';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const user = await requireDomainUser();
    assertLearnerSubmission(user);
    const params = new URL(request.url).searchParams;
    const cohort = params.get('cohort') ?? '';
    const node = params.get('node') ?? '';
    if (!isRequestId(cohort) || !/^[a-z0-9-]{1,100}$/.test(node))
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
    return Response.json(await readSubmissions(getDatabase(), user.authUserId, cohort, node), {
      headers,
    });
  } catch (error) {
    let denied = error instanceof AccessDenied;
    let cause: unknown = error;
    // The database adapter wraps PostgreSQL errors; preserve its permission denial.
    for (let depth = 0; depth < 5 && cause && typeof cause === 'object'; depth++) {
      if ('code' in cause && cause.code === '42501') denied = true;
      cause = 'cause' in cause ? cause.cause : undefined;
    }
    return Response.json(
      { error: denied ? 'ACCESS_DENIED' : 'SUBMISSION_UNAVAILABLE' },
      {
        status:
          error instanceof AccessDenied && error.code === 'UNAUTHENTICATED'
            ? 401
            : denied
              ? 403
              : 503,
        headers,
      },
    );
  }
}
