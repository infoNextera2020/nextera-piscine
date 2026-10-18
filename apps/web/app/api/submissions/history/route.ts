import { AccessDenied, assertLearnerSubmission, isRequestId } from '@nextera/domain';
import { readSubmissions } from '@nextera/db/submissions';
import { getDatabase, requireDomainUser } from '../../../../lib/auth/server';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const user = await requireDomainUser();
    assertLearnerSubmission(user);
    const params = new URL(request.url).searchParams;
    const cohort = params.get('cohort') ?? '';
    const node = params.get('node') ?? '';
    if (!isRequestId(cohort) || !/^[a-z0-9-]{1,100}$/.test(node))
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    return Response.json(await readSubmissions(getDatabase(), user.authUserId, cohort, node), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return Response.json(
      { error: 'ACCESS_DENIED' },
      { status: error instanceof AccessDenied && error.code === 'UNAUTHENTICATED' ? 401 : 403 },
    );
  }
}
