import { isRequestId } from '@nextera/domain';
import {
  readCheckpoint,
  startCheckpoint,
  finishCheckpoint,
  grantCheckpointReplacement,
} from '@nextera/db/checkpoints';
import { requireDomainUser, getDatabase } from '../../../lib/auth/server';
import { sameOrigin } from '../../../lib/submissions/origin';
import { checkpointPresentation } from '../../../lib/learning/checkpoint-presentation';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const user = await requireDomainUser();
    const q = new URL(request.url).searchParams;
    const cohort = q.get('cohort') ?? '';
    const node = q.get('node') ?? '';
    if (!isRequestId(cohort) || !/^[a-z0-9-]{1,100}$/.test(node))
      return new Response(null, { status: 400 });
    return Response.json(
      checkpointPresentation(await readCheckpoint(getDatabase(), user.authUserId, cohort, node)),
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch {
    return new Response(null, { status: 403 });
  }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return new Response(null, { status: 403 });
    // Mutations take allowlisted identity headers and no request body or policy values.
    if (request.body) {
      const reader = request.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.byteLength) {
            await reader.cancel();
            return new Response(null, { status: 400 });
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    const user = await requireDomainUser();
    const action = request.headers.get('x-action');
    const cohort = request.headers.get('x-cohort-id') ?? '';
    const node = request.headers.get('x-node-key') ?? '';
    const attempt = request.headers.get('x-attempt-id') ?? '';
    const requestId = request.headers.get('idempotency-key') ?? '';
    if (
      action === 'start' &&
      isRequestId(cohort) &&
      isRequestId(requestId) &&
      /^[a-z0-9-]{1,100}$/.test(node)
    ) {
      const id = await startCheckpoint(getDatabase(), user.authUserId, cohort, node, requestId);
      return Response.json({ id }, { status: 202 });
    }
    if (action === 'finish' && isRequestId(attempt)) {
      await finishCheckpoint(getDatabase(), user.authUserId, attempt);
      return Response.json({ id: attempt }, { status: 202 });
    }
    if (action === 'replacement' && isRequestId(attempt)) {
      return Response.json(
        { id: await grantCheckpointReplacement(getDatabase(), user.authUserId, attempt) },
        { status: 202 },
      );
    }
    return new Response(null, { status: 400 });
  } catch {
    return Response.json({ error: 'CHECKPOINT_UNAVAILABLE' }, { status: 409 });
  }
}
