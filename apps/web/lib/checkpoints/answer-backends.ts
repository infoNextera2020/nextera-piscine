import 'server-only';
import { requireDomainUser } from '../auth/server';
import { createCheckpointAnswerApi } from './answer-api';
/** Deliberately disabled. Unregistered DRAFT0021 needs native exact-text/parity proof;
 * official typed acceptance additionally needs its own transactional repository/evaluator.
 * No environment variable, UI field or existing source-only opt-in enables this feature.
 */
export const checkpointAnswerApi = createCheckpointAnswerApi({
  authenticate: requireDomainUser,
  drafts: null,
  officialSubmission: null,
  bodyPolicy: null,
});
