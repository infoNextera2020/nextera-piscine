import type { DomainUser } from '@nextera/domain';
import {
  createCheckpointAnswerDraftHandlers,
  createCheckpointAnswerSubmissionHandler,
  type AnswerBodyPolicy,
  type OfficialAnswerSubmitPort,
} from './answer-http';
import type { CheckpointAnswerDraftBackend, AnswerServerContext } from './answer-server-contract';
import type { EditorActor, EditorTaskIdentity } from './editor-http';
export function createCheckpointAnswerApi(
  deps: Readonly<{
    authenticate(): Promise<DomainUser>;
    drafts: CheckpointAnswerDraftBackend | null;
    officialSubmission: OfficialAnswerSubmitPort | null;
    bodyPolicy: AnswerBodyPolicy | null;
    authorizeSubmission?(actor: EditorActor, task: EditorTaskIdentity): Promise<void>;
    bootstrap?(
      actor: EditorActor,
      task: EditorTaskIdentity,
    ): Promise<AnswerServerContext & { submitAllowed: boolean }>;
  }>,
) {
  return Object.freeze({
    drafts: createCheckpointAnswerDraftHandlers({
      authenticate: deps.authenticate,
      backend: deps.drafts,
      ...(deps.bootstrap ? { bootstrap: deps.bootstrap } : {}),
      bodyPolicy: deps.bodyPolicy,
    }),
    submit: createCheckpointAnswerSubmissionHandler({
      authenticate: deps.authenticate,
      service: deps.officialSubmission,
      ...(deps.authorizeSubmission ? { authorize: deps.authorizeSubmission } : {}),
      bodyPolicy: deps.bodyPolicy,
    }),
  });
}
