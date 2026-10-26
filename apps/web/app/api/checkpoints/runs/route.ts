import { requireDomainUser } from '../../../../lib/auth/server';
import { createCheckpointRunHandlers } from '../../../../lib/checkpoints/editor-http';
import { checkpointRunBackend } from '../../../../lib/checkpoints/editor-backends';

export const runtime = 'nodejs';
const handlers = createCheckpointRunHandlers({
  authenticate: requireDomainUser,
  backend: checkpointRunBackend,
});
export const GET = handlers.GET;
export const POST = handlers.POST;
