import { requireDomainUser } from '../../../../lib/auth/server';
import { createCheckpointEditorHandler } from '../../../../lib/checkpoints/editor-http';
import { checkpointDraftBackend } from '../../../../lib/checkpoints/editor-backends';

export const runtime = 'nodejs';
export const GET = createCheckpointEditorHandler({
  authenticate: requireDomainUser,
  backend: checkpointDraftBackend,
});
