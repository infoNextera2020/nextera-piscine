import 'server-only';
import { timingSafeEqual, createHash } from 'node:crypto';
import { createDatabase } from '@nextera/db/connection';
import { reconcileCheckpoints } from '@nextera/db/operations/checkpoints';
import { applyResult, reconcileResults } from '@nextera/db/operations/results';

export async function serviceApplication(request: Request, reconcile: boolean) {
  const secret = process.env.RESULT_APPLICATION_SERVICE_TOKEN;
  if (!secret || secret.length < 32) return new Response(null, { status: 503 });
  const supplied = request.headers.get('authorization') ?? '';
  const hash = (v: string) => createHash('sha256').update(v).digest();
  if (!timingSafeEqual(hash(supplied), hash(`Bearer ${secret}`)))
    return new Response(null, { status: 401 });
  const body = await request.text();
  if (body.length > 256) return new Response(null, { status: 400 });
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== 'object' ||
    (reconcile
      ? Object.keys(input).length !== 0
      : Object.keys(input).length !== 1 ||
        typeof input.result_id !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.result_id))
  )
    return new Response(null, { status: 400 });
  if (!process.env.RESULT_APPLICATION_DATABASE_URL) return new Response(null, { status: 503 });
  const connection = createDatabase(process.env.RESULT_APPLICATION_DATABASE_URL);
  try {
    if (reconcile) {
      const outcomes = await reconcileResults(connection.db);
      const checkpoints = await reconcileCheckpoints(connection.db);
      return Response.json(
        { outcomes, checkpoints },
        {
          status: [...outcomes, ...checkpoints].some((o) => o.status === 'attention_required')
            ? 409
            : 200,
        },
      );
    }
    const result = await applyResult(connection.db, String(input.result_id));
    return Response.json({ result_id: result.id, status: result.application_status });
  } catch {
    return new Response(null, { status: 409 });
  } finally {
    await connection.close();
  }
}
