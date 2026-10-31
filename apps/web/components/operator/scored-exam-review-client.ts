import {
  captureDocumentedMentorCommand,
  verifyManualEvidenceReceipt,
} from './scored-exam-manual-contract';
import type {
  ManualEvidenceCommand,
  ManualEvidenceReference,
} from '@nextera/db/scored-exam-manual-evidence';
import {
  MentorReviewAccessError,
  captureMentorJson,
  captureMentorReviewCommand,
  mentorAnswerMatches,
  mentorReviewPayloadDigest,
  parseMentorReviewAnswer,
  parseMentorReviewSnapshot,
  validMentorIdentity,
  type MentorReviewAnswer,
  type MentorReviewCommand,
  type MentorReviewDraft,
  type MentorReviewIdentity,
  type MentorReviewSnapshot,
} from './scored-exam-review-contract';

export type MentorReviewReceipt = Readonly<{
  kind: 'recorded';
  eventId: string;
  operationId: string;
  submissionId: string;
  revision: string;
  payloadDigest: string;
  replayed: boolean;
  evidenceReference?: ManualEvidenceReference;
}>;
export type MentorReviewClientState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'unavailable' | 'removed' | 'disposed';
  fresh: boolean;
  snapshot: MentorReviewSnapshot | null;
  answers: Readonly<Record<string, MentorReviewAnswer>>;
  drafts: Readonly<Record<string, MentorReviewDraft>>;
  answerLoading: string | null;
  write:
    | Readonly<{
        kind: 'idle' | 'sending' | 'uncertain' | 'conflict' | 'rejected';
        submissionId?: string;
      }>
    | Readonly<{ kind: 'recorded'; receipt: MentorReviewReceipt }>;
  message: string;
}>;
const endpoint = '/api/mentor/checkpoints/scoring';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const empty = (): MentorReviewClientState => ({
  phase: 'idle',
  fresh: false,
  snapshot: null,
  answers: {},
  drafts: {},
  answerLoading: null,
  write: { kind: 'idle' },
  message: '',
});
function binding(snapshot: MentorReviewSnapshot) {
  return JSON.stringify([
    snapshot.context.attempt.scope,
    snapshot.context.snapshotDigest,
    snapshot.context.assignment.digest,
  ]);
}
/** Browser transport/state for the exact assigned-attempt detail. It stores no protected data on the device,
 * schedules no review or polling, and never grants assignment or finalizes an outcome. */
export class ScoredExamMentorReviewClient {
  private state: MentorReviewClientState = empty();
  private disposed = false;
  private readEpoch = 0;
  private writeEpoch = 0;
  private readController: AbortController | null = null;
  private answerController: AbortController | null = null;
  private writeController: AbortController | null = null;
  private preparing = false;
  private pending: MentorReviewCommand | ManualEvidenceCommand | null = null;
  private pendingBinding: string | null = null;
  private knownRevisions = new Map<string, string>();
  readonly identity: MentorReviewIdentity;
  constructor(
    identity: MentorReviewIdentity,
    private readonly deps: {
      send: typeof fetch;
      operationId(): string;
      changed(): void;
      accessRemoved(): void;
    },
  ) {
    if (!validMentorIdentity(identity)) throw Error('MENTOR_REVIEW_IDENTITY_INVALID');
    this.identity = Object.freeze({ ...identity });
  }
  getSnapshot = () => this.state;
  getCurrentPersistedOutcome() {
    return this.state.phase === 'ready' && this.state.fresh
      ? (this.state.snapshot?.persistedOutcome ?? null)
      : null;
  }

  getPendingCommand() {
    return this.pending;
  }
  private publish(patch: Partial<MentorReviewClientState>) {
    if (this.disposed) return;
    this.state = Object.freeze({ ...this.state, ...patch });
    this.deps.changed();
  }
  private removed() {
    if (this.disposed) return;
    this.cancel();
    this.pending = null;
    this.pendingBinding = null;
    this.knownRevisions.clear();
    this.publish({
      ...empty(),
      phase: 'removed',
      message: 'Review access could not be confirmed. Protected work is hidden.',
    });
    this.deps.accessRemoved();
  }
  async load() {
    if (this.disposed) return;
    const epoch = ++this.readEpoch;
    this.readController?.abort();
    this.answerController?.abort();
    this.answerController = null;
    const controller = new AbortController();
    this.readController = controller;
    this.publish({
      phase: 'loading',
      fresh: false,
      answerLoading: null,
      message: 'Checking current assigned review…',
    });
    try {
      const response = await this.deps.send(
        endpoint + '?' + new URLSearchParams({ attempt: this.identity.attemptId }),
        {
          credentials: 'same-origin',
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      if (this.disposed || controller.signal.aborted || epoch !== this.readEpoch) return;
      if (response.status === 401 || response.status === 403) {
        this.removed();
        return;
      }
      if (!response.ok) throw Error('UNCONFIRMED_READ');
      const snapshot = await parseMentorReviewSnapshot(await response.json(), this.identity);
      if (this.disposed || controller.signal.aborted || epoch !== this.readEpoch) return;
      for (const [submissionId, revision] of this.knownRevisions) {
        const current = snapshot.histories.find((history) => history.submissionId === submissionId);
        if (!current || BigInt(current.revision) < BigInt(revision))
          throw Error('MENTOR_REVIEW_HISTORY_REGRESSED');
      }
      for (const history of snapshot.histories)
        this.knownRevisions.set(history.submissionId, history.revision);
      const changedBinding =
        this.state.snapshot && binding(this.state.snapshot) !== binding(snapshot);
      const answers = Object.fromEntries(
        Object.entries(this.state.answers).filter(
          ([, answer]) =>
            !changedBinding &&
            snapshot.score.intake.status !== 'open' &&
            mentorAnswerMatches(answer, snapshot) &&
            (answer.kind === 'coding'
              ? snapshot.answerReadAvailable
              : snapshot.structuredAnswerReadAvailable),
        ),
      );
      this.publish({
        phase: 'ready',
        fresh: true,
        snapshot,
        answers,
        ...(changedBinding
          ? {
              drafts: {},
              write: this.pending
                ? { kind: 'conflict', submissionId: this.pending.write.submissionId }
                : { kind: 'idle' },
            }
          : {}),
        message: '',
      });
    } catch (error) {
      if (!this.disposed && !controller.signal.aborted && epoch === this.readEpoch) {
        if (error instanceof MentorReviewAccessError) this.removed();
        else
          this.publish({
            phase: 'unavailable',
            fresh: false,
            message:
              'The assigned review could not be refreshed. Actions are paused until a fresh authorized read succeeds.',
          });
      }
    } finally {
      if (this.readController === controller) this.readController = null;
    }
  }
  async readAnswer(submissionId: string) {
    const snapshot = this.state.snapshot;
    if (
      this.disposed ||
      this.state.phase !== 'ready' ||
      !this.state.fresh ||
      !snapshot ||
      snapshot.score.intake.status === 'open'
    )
      return;
    const accepted = snapshot.context.acceptances.find((a) => a.submissionId === submissionId);
    if (
      !accepted ||
      !(accepted.answerKind === 'coding'
        ? snapshot.answerReadAvailable
        : snapshot.structuredAnswerReadAvailable)
    )
      return;
    this.answerController?.abort();
    const controller = new AbortController(),
      epoch = this.readEpoch;
    this.answerController = controller;
    this.publish({ answerLoading: submissionId, message: '' });
    try {
      const query = new URLSearchParams({
        attempt: this.identity.attemptId,
        submission: submissionId,
      });
      const response = await this.deps.send(endpoint + '?' + query, {
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (this.disposed || controller.signal.aborted || epoch !== this.readEpoch) return;
      if (response.status === 401 || response.status === 403) {
        this.removed();
        return;
      }
      if (!response.ok) throw Error('UNCONFIRMED_ANSWER');
      const answer = await parseMentorReviewAnswer(await response.json(), snapshot, submissionId);
      if (
        this.disposed ||
        controller.signal.aborted ||
        epoch !== this.readEpoch ||
        !this.state.snapshot ||
        !mentorAnswerMatches(answer, this.state.snapshot)
      )
        return;
      this.publish({ answers: { ...this.state.answers, [submissionId]: answer } });
    } catch {
      if (!this.disposed && !controller.signal.aborted && epoch === this.readEpoch)
        this.publish({
          message:
            'This exact accepted answer could not be verified. No review can be recorded for it yet.',
        });
    } finally {
      if (this.answerController === controller) {
        this.answerController = null;
        this.publish({ answerLoading: null });
      }
    }
  }
  editReview(submissionId: string, draft: MentorReviewDraft) {
    if (
      this.disposed ||
      this.state.phase !== 'ready' ||
      (!this.state.fresh && this.state.write.kind !== 'sending') ||
      !this.state.snapshot?.context.acceptances.some((a) => a.submissionId === submissionId)
    )
      return;
    const captured = captureMentorJson(draft) as MentorReviewDraft;
    this.publish({ drafts: { ...this.state.drafts, [submissionId]: captured } });
  }
  /** Explicit caller acknowledgement after reading the fresh conflicting history.
   * Unknown writes cannot be replaced here: they must retry their original command. */
  acknowledgeFreshHistory() {
    if (
      this.disposed ||
      !this.state.fresh ||
      this.state.phase !== 'ready' ||
      !['conflict', 'rejected'].includes(this.state.write.kind)
    )
      return;
    this.pending = null;
    this.pendingBinding = null;
    this.publish({ write: { kind: 'idle' }, message: '' });
  }
  async record(submissionId: string, notes?: string | null) {
    const snapshot = this.state.snapshot;
    if (
      this.disposed ||
      !snapshot ||
      this.state.phase !== 'ready' ||
      !this.state.fresh ||
      !snapshot.reviewWriteAvailable ||
      snapshot.score.intake.status === 'open' ||
      this.preparing ||
      ['sending', 'conflict', 'rejected'].includes(this.state.write.kind)
    )
      return;
    if (
      this.pending &&
      (this.pending.write.submissionId !== submissionId ||
        this.pendingBinding !== binding(snapshot))
    ) {
      this.publish({
        write: { kind: 'conflict', submissionId },
        message:
          'The original pending review belongs to another frozen context. Read the current history before making a new decision.',
      });
      return;
    }
    try {
      if (!this.pending) {
        const answer = this.state.answers[submissionId],
          draft = this.state.drafts[submissionId];
        if (!answer || !draft) throw Error('REVIEW_NOT_READY');
        const epoch = this.readEpoch;
        this.preparing = true;
        let command;
        try {
          command =
            notes === undefined
              ? captureMentorReviewCommand(snapshot, answer, draft, this.deps.operationId())
              : await captureDocumentedMentorCommand(
                  snapshot,
                  answer,
                  draft.marks,
                  notes,
                  this.deps.operationId(),
                );
        } finally {
          this.preparing = false;
        }
        if (
          this.disposed ||
          epoch !== this.readEpoch ||
          snapshot !== this.state.snapshot ||
          !this.state.fresh
        )
          return;
        this.pending = command;
        this.pendingBinding = binding(snapshot);
      }
    } catch {
      this.publish({
        message:
          'Verify the accepted answer, assigned role, published criteria, mark ranges and valid UTF-8 notes before recording.',
      });
      return;
    }
    const packet = this.pending;
    const controller = new AbortController(),
      epoch = ++this.writeEpoch;
    this.writeController = controller;
    this.publish({
      fresh: false,
      write: { kind: 'sending', submissionId },
      message: 'Recording this exact review…',
    });
    let refresh = false;
    try {
      const response = await this.deps.send(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(packet),
      });
      if (this.disposed || controller.signal.aborted || epoch !== this.writeEpoch) return;
      if (response.status === 401 || response.status === 403) {
        this.removed();
        return;
      }
      const body = captureMentorJson(await response.json()) as Record<string, unknown>;
      if (this.disposed || controller.signal.aborted || epoch !== this.writeEpoch) return;
      if (response.status === 202 && body.kind === 'recorded') {
        const expectedKeys = [
          'kind',
          'eventId',
          'operationId',
          'submissionId',
          'revision',
          'payloadDigest',
          'replayed',
          ...(packet.version === 2 ? ['evidenceReference'] : []),
        ];
        if (
          Object.keys(body).length !== expectedKeys.length ||
          !expectedKeys.every((k) => Object.hasOwn(body, k)) ||
          typeof body.eventId !== 'string' ||
          !uuid.test(body.eventId) ||
          body.operationId !== packet.write.operationId ||
          body.submissionId !== packet.write.submissionId ||
          body.revision !== String(BigInt(packet.write.expectedRevision) + 1n) ||
          typeof body.replayed !== 'boolean' ||
          body.payloadDigest !== (await mentorReviewPayloadDigest(packet.payload))
        )
          throw Error('UNCONFIRMED_RECEIPT');
        if (packet.version === 2)
          await verifyManualEvidenceReceipt(body.evidenceReference, packet, snapshot, body.eventId);
        if (this.disposed || controller.signal.aborted || epoch !== this.writeEpoch) return;
        const previouslySeen = this.knownRevisions.get(packet.write.submissionId) ?? '0';
        this.knownRevisions.set(
          packet.write.submissionId,
          BigInt(previouslySeen) > BigInt(String(body.revision))
            ? previouslySeen
            : String(body.revision),
        );
        this.pending = null;
        this.pendingBinding = null;
        this.publish({
          write: { kind: 'recorded', receipt: body as MentorReviewReceipt },
          message: 'Review recorded. Refreshing native history and outcome status…',
        });
      } else if (
        (response.status === 412 && body.kind === 'stale_revision') ||
        (response.status === 409 && ['conflict', 'review_not_open'].includes(String(body.kind)))
      ) {
        this.publish({
          write: { kind: 'conflict', submissionId },
          message:
            'The review history changed. Inspect the refreshed record before choosing a new revision.',
        });
      } else if (response.status === 400) {
        this.publish({
          write: { kind: 'rejected', submissionId },
          message:
            'The server rejected this review command. Refresh and review the evidence before correcting it.',
        });
      } else throw Error('UNCONFIRMED_WRITE');
      refresh = true;
    } catch {
      if (!this.disposed && !controller.signal.aborted && epoch === this.writeEpoch) {
        this.publish({
          write: { kind: 'uncertain', submissionId },
          message:
            'The receipt is unconfirmed. After refreshing history, Retry sends the same original operation and marks.',
        });
        refresh = true;
      }
    } finally {
      if (this.writeController === controller) this.writeController = null;
    }
    if (refresh && !this.disposed) await this.load();
  }
  cancel() {
    if (this.disposed) return;
    this.readEpoch++;
    this.writeEpoch++;
    this.readController?.abort();
    this.answerController?.abort();
    this.writeController?.abort();
    this.readController = null;
    this.answerController = null;
    this.writeController = null;
    this.publish({
      fresh: false,
      answerLoading: null,
      ...(this.pending
        ? { write: { kind: 'uncertain', submissionId: this.pending.write.submissionId } }
        : {}),
      message: this.pending
        ? 'Request stopped. A server write may still have completed; refresh, then retry only the original operation.'
        : 'Read stopped. Refresh before taking an action.',
    });
  }
  hidePrivateContent() {
    if (this.disposed) return;
    this.cancel();
    this.publish({ snapshot: null, answers: {}, drafts: {}, phase: 'idle', fresh: false });
  }
  dispose() {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    this.pending = null;
    this.pendingBinding = null;
    this.knownRevisions.clear();
    this.state = Object.freeze({ ...empty(), phase: 'disposed' });
  }
}

export function createBrowserScoredExamMentorReviewClient(
  identity: MentorReviewIdentity,
  changed: () => void,
  accessRemoved: () => void,
) {
  return new ScoredExamMentorReviewClient(identity, {
    send: (...args) => fetch(...args),
    operationId: () => crypto.randomUUID(),
    changed,
    accessRemoved,
  });
}
