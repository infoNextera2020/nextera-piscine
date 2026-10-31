import type {
  ManualEvidenceCommand,
  ManualEvidenceReference,
  ManualReviewDisplay,
} from '@nextera/db/scored-exam-manual-evidence';
import type { ExamManualMarks } from '@nextera/domain';
import {
  captureMentorJson,
  captureMentorReviewCommand,
  mentorBytesDigest,
  mentorCanonical,
  mentorFramedDigest,
  type MentorReviewSnapshot,
  type MentorReviewAnswer,
} from './scored-exam-review-contract';
const fail = (): never => {
  throw Error('MANUAL_REVIEW_UNCONFIRMED');
};
export function manualReviewText(v: unknown): v is string {
  if (typeof v !== 'string' || v.includes('\0')) return false;
  return (
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      new TextEncoder().encode(v),
    ) === v
  );
}
export function browserManualEvidenceDocument(
  snapshot: Pick<MentorReviewSnapshot, 'context'>,
  command: ManualEvidenceCommand,
  actor = snapshot.context.actorUserId,
) {
  const c = snapshot.context,
    a = c.acceptances.find((a) => a.submissionId === command.write.submissionId),
    q = c.rubric.questions.find((q) => q.questionKey === a?.questionKey);
  if (!a || !q) return fail();
  return {
    version: 1,
    operationId: command.write.operationId,
    expectedRevision: command.write.expectedRevision,
    review: command.review,
    actorUserId: actor,
    scope: c.attempt.scope,
    snapshotDigest: c.snapshotDigest,
    assignmentDigest: c.assignment.digest,
    submissionId: a.submissionId,
    questionKey: a.questionKey,
    answerKind: a.answerKind,
    answerSha256: a.answerSha256,
    manualCriteriaSha256: command.evidence.manualCriteriaSha256,
    publishedCriteriaDigest: q.publishedCriteriaDigest,
    marks: command.payload.marks,
    notes: command.evidence.notes,
    ...(command.review === 'secondary'
      ? {
          primaryEventId:
            'primaryEventId' in command.payload ? command.payload.primaryEventId : fail(),
        }
      : {}),
  };
}
export const browserManualEvidenceDigest = (document: unknown) =>
  mentorFramedDigest(document, '01coding-exam-manual-evidence');
export async function captureDocumentedMentorCommand(
  snapshot: MentorReviewSnapshot,
  answer: MentorReviewAnswer,
  marks: ExamManualMarks,
  notes: string | null,
  operationId: string,
): Promise<ManualEvidenceCommand> {
  const m = snapshot.manualReview;
  if (!m?.canRecordNew || !m.criteria || !m.policy || (notes !== null && !manualReviewText(notes)))
    return fail();
  const review =
    snapshot.context.actorUserId === snapshot.context.assignment.primaryMentorId
      ? 'primary'
      : 'secondary';
  const primary = snapshot.histories
    .find((h) => h.submissionId === answer.binding.submissionId)
    ?.events.filter((e) => e.eventKind === 'primary')
    .at(-1);
  const base = captureMentorReviewCommand(
    snapshot,
    answer,
    {
      review,
      evidenceDigest: '0'.repeat(64),
      marks,
      ...(review === 'secondary' ? { primaryEventId: primary?.eventId ?? fail() } : {}),
    },
    operationId,
  );
  const c: ManualEvidenceCommand = {
    ...base,
    version: 2,
    evidence: { version: 1, manualCriteriaSha256: m.criteria.sha256, notes },
  };
  const document = browserManualEvidenceDocument(snapshot, c),
    bytes = new TextEncoder().encode(mentorCanonical(document)).byteLength;
  if (bytes > m.policy.maxEvidenceBytes) return fail();
  return captureMentorJson({
    ...c,
    payload: { ...c.payload, evidenceDigest: await browserManualEvidenceDigest(document) },
  }) as ManualEvidenceCommand;
}
export async function parseManualReviewDisplay(
  raw: unknown,
  snapshot: Pick<MentorReviewSnapshot, 'context' | 'histories' | 'score'>,
): Promise<ManualReviewDisplay | null> {
  if (raw === undefined || raw === null) return null;
  const m = captureMentorJson(raw) as ManualReviewDisplay;
  const { serverNowMicros, ...context } = snapshot.context;
  void serverNowMicros;
  if (
    m.version !== 1 ||
    m.contextDigest !==
      (await mentorFramedDigest(context, '01coding-exam-review-display-context')) ||
    typeof m.closed !== 'boolean' ||
    m.closed !== (snapshot.score.intake.status !== 'open') ||
    typeof m.canRecordNew !== 'boolean' ||
    typeof m.reason !== 'string' ||
    !manualReviewText(m.learner?.displayName) ||
    m.learner.studentNumber !== null ||
    !Array.isArray(m.records)
  )
    return fail();
  if (m.manualCriteriaSha256 !== null && !/^[0-9a-f]{64}$/.test(m.manualCriteriaSha256))
    return fail();
  if (
    m.policy &&
    (m.policy.version !== 1 ||
      ![m.policy.maxEvidenceBytes, m.policy.maxCriteriaBytes].every(
        (n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647,
      ))
  )
    return fail();
  if (m.criteria) {
    const bytes = new TextEncoder().encode(m.criteria.text);
    if (
      !m.closed ||
      !m.policy ||
      !manualReviewText(m.criteria.text) ||
      bytes.byteLength !== m.criteria.byteLength ||
      bytes.byteLength > m.policy.maxCriteriaBytes ||
      m.criteria.sha256 !== m.manualCriteriaSha256 ||
      (await mentorBytesDigest(bytes)) !== m.criteria.sha256
    )
      return fail();
  }
  if (m.canRecordNew !== !!(m.criteria && m.policy && m.closed) || (!m.closed && m.records.length))
    return fail();
  const seen = new Set<string>();
  for (const r of m.records) {
    const h = snapshot.histories.find((h) => h.submissionId === r.submissionId),
      e = h?.events.find((e) => e.eventId === r.eventId);
    if (
      !h ||
      !e ||
      seen.has(r.eventId) ||
      e.eventKind === 'functional' ||
      e.eventKind !== r.review ||
      e.operationId !== r.operationId ||
      e.revision !== r.revision ||
      e.actorUserId !== r.sourceActorId ||
      !['operator', 'admin'].includes(r.sourceRole) ||
      !/^[0-9a-f]{64}$/.test(r.policyDigest)
    )
      return fail();
    seen.add(r.eventId);
    const notes = r.document.notes;
    if (notes !== null && !manualReviewText(notes)) return fail();
    const command = {
      version: 2,
      review: r.review,
      attemptId: snapshot.context.attempt.scope.attemptId,
      write: {
        operationId: r.operationId,
        submissionId: r.submissionId,
        expectedRevision: String(BigInt(r.revision) - 1n),
      },
      payload: e.payload,
      evidence: { version: 1, manualCriteriaSha256: m.manualCriteriaSha256, notes },
    } as ManualEvidenceCommand;
    const expected = browserManualEvidenceDocument(snapshot, command, r.sourceActorId),
      digest = await browserManualEvidenceDigest(expected);
    if (
      mentorCanonical(expected) !== mentorCanonical(r.document) ||
      digest !== r.digest ||
      !('evidenceDigest' in e.payload) ||
      e.payload.evidenceDigest !== digest ||
      new TextEncoder().encode(mentorCanonical(expected)).byteLength !== r.byteLength
    )
      return fail();
  }
  return m;
}
export async function verifyManualEvidenceReceipt(
  value: unknown,
  packet: ManualEvidenceCommand,
  snapshot: MentorReviewSnapshot,
  eventId: unknown,
): Promise<ManualEvidenceReference> {
  const ref = captureMentorJson(value) as ManualEvidenceReference,
    doc = browserManualEvidenceDocument(snapshot, packet);
  if (
    Object.keys(ref).length !== 5 ||
    ref.version !== 1 ||
    ref.eventId !== eventId ||
    ref.digest !== packet.payload.evidenceDigest ||
    ref.digest !== (await browserManualEvidenceDigest(doc)) ||
    ref.byteLength !== new TextEncoder().encode(mentorCanonical(doc)).byteLength ||
    ref.notesStored !== (packet.evidence.notes !== null)
  )
    return fail();
  return ref;
}
