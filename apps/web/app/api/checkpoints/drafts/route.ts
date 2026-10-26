import { requireDomainUser } from '../../../../lib/auth/server';
import { createCheckpointDraftHandlers } from '../../../../lib/checkpoints/editor-http';
import { checkpointDraftBackend } from '../../../../lib/checkpoints/editor-backends';

export const runtime = 'nodejs';
const handlers = createCheckpointDraftHandlers({
  authenticate: requireDomainUser,
  backend: checkpointDraftBackend,
});
export const GET = handlers.GET;
export const POST = handlers.POST;
