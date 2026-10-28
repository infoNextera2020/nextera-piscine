import 'server-only';
import type { DomainUser } from '@nextera/domain';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';
import { configureCheckpointDraftBackend } from './editor-backend-config';
import { createPostgresCheckpointOfficialSubmitAuthority } from './postgres-editor-context';
import { createCheckpointDraftHandlers, createCheckpointEditorHandler } from './editor-http';

/** Source assembly only: constructing the API performs no authentication or database I/O.
 * Opt-in never replaces SQL readiness, frozen context, access, time or policy checks.
 */
export function createCheckpointEditorApi(deps: {
  authenticate(): Promise<DomainUser>;
  database(): OperationalDatabase;
  draftStorage: unknown;
}) {
  const draftBackend = configureCheckpointDraftBackend(deps.draftStorage, deps.database);
  const officialSubmission = createPostgresCheckpointOfficialSubmitAuthority(deps.database);
  return {
    draftBackend,
    officialSubmission,
    bootstrap: createCheckpointEditorHandler({
      authenticate: deps.authenticate,
      backend: draftBackend,
      officialSubmission,
    }),
    drafts: createCheckpointDraftHandlers({
      authenticate: deps.authenticate,
      backend: draftBackend,
    }),
  };
}
