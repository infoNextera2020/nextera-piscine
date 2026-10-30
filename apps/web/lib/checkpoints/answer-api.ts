import type { DomainUser } from '@nextera/domain';
import {
  createCheckpointAnswerDraftHandlers,
  createCheckpointAnswerSubmissionHandler,
  type AnswerBodyPolicy,
  type OfficialAnswerSubmitPort,
} from './answer-http';
import type { CheckpointAnswerDraftBackend } from './answer-server-contract';
export function createCheckpointAnswerApi(
  deps: Readonly<{
    authenticate(): Promise<DomainUser>;
    drafts: CheckpointAnswerDraftBackend | null;
    officialSubmission: OfficialAnswerSubmitPort | null;
    bodyPolicy: AnswerBodyPolicy | null;
  }>,
) {
  return Object.freeze({
    drafts: createCheckpointAnswerDraftHandlers({
      authenticate: deps.authenticate,
      backend: deps.drafts,
      bodyPolicy: deps.bodyPolicy,
    }),
    submit: createCheckpointAnswerSubmissionHandler({
      authenticate: deps.authenticate,
      service: deps.officialSubmission,
      bodyPolicy: deps.bodyPolicy,
    }),
  });
}
