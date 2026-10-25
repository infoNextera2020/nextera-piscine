import { createHash } from 'node:crypto';
import { isRequestId } from '@nextera/domain';
import { raidArtifactContext } from '@nextera/db/raids';
import { getDatabase, requireDomainUser } from '../../../../lib/auth/server';
import { createClient } from '../../../../lib/supabase/server';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const user = await requireDomainUser();
    const attempt = new URL(request.url).searchParams.get('attempt') ?? '';
    if (!isRequestId(attempt))
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers });
    if (!['operator', 'admin'].includes(user.role))
      return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers });
    const ctx = await raidArtifactContext(getDatabase(), user.authUserId, attempt);
    const { data, error } = await (await createClient()).storage.from(ctx.bucket).download(ctx.key);
    if (error || !data || data.size !== ctx.size || data.size > 262144)
      throw new Error('ARTIFACT_UNAVAILABLE');
    const bytes = Buffer.from(await data.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== ctx.digest)
      throw new Error('ARTIFACT_MISMATCH');
    // Download only. Never run or render submitted source as HTML/JS.
    return new Response(bytes, {
      headers: {
        ...headers,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${ctx.filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`,
      },
    });
  } catch {
    return Response.json({ error: 'ARTIFACT_UNAVAILABLE' }, { status: 403, headers });
  }
}
