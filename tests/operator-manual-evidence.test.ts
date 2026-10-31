import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffExamReviewSelection } from '../apps/web/components/operator/staff-exam-review-detail';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../apps/web/node_modules/server-only', () => ({}));
import { scoringFixture, id } from './operator-scoring-fixture';
import { ScoredExamMentorReviewClient } from '../apps/web/components/operator/scored-exam-review-client';
import {
  parseMentorReviewSnapshot,
  parseMentorReviewAnswer,
  mentorCanonical,
} from '../apps/web/components/operator/scored-exam-review-contract';
import {
  captureDocumentedMentorCommand,
  browserManualEvidenceDocument,
  browserManualEvidenceDigest,
  parseManualReviewDisplay,
} from '../apps/web/components/operator/scored-exam-manual-contract';
import {
  manualEvidenceDocument,
  manualEvidenceDigest,
  manualReviewContextDigest,
  readManualReviewDisplay,
  recordManualEvidence,
  captureManualEvidenceCommand,
  READ_MANUAL_EVIDENCE_SQL,
  RECORD_MANUAL_EVIDENCE_SQL,
  MANUAL_EVIDENCE_READINESS_SQL,
  ScoredExamManualEvidenceError,
  type ManualReviewDisplay,
} from '../packages/db/queries/scored-exam-manual-evidence';
import {
  checkpointCanonicalJson,
  scoredExamFramedDigest,
} from '../packages/db/operations/scored-exam-publication';
import { examScoringEventDigest } from '../packages/db/queries/exam-scoring-review';
import {
  configuredManualCriteria,
  createScoredExamReviewService,
} from '../apps/web/lib/checkpoints/scored-exam-review-service';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
async function fixture(
  kind: 'coding' | 'trace_with_reason' | 'debug_with_reason' = 'coding',
  secondary = false,
) {
  const f = scoringFixture(kind, { secondary }),
    text = 'Synthetic approved whole criteria.\r\nعربي <img src="https://invalid.example/private">';
  const policy = { version: 1 as const, maxCriteriaBytes: 8192, maxEvidenceBytes: 16384 };
  const { digest, ...rubric } = f.context.rubric;
  void digest;
  const binding = {
    draftSha256: 'd'.repeat(64),
    paperSha256: 'a'.repeat(64),
    decisions: {
      weightsOwnerMessageId: 'Sentinel_' + 'a'.repeat(32),
      approvedDraftSha256: 'd'.repeat(64),
      traceComparatorOwnerMessageId: 'Sentinel_' + 'b'.repeat(32),
      traceComparator: 'exact_utf8',
      manualCriteriaSha256: sha(text),
    },
    rubric,
  };
  const raw = {
    version: 1,
    authUserId: f.identity.authUserId,
    actorUserId: f.identity.actorUserId,
    attemptId: f.identity.attemptId,
    contextDigest: manualReviewContextDigest(f.context),
    closed: true,
    sourceBinding: binding,
    sourceBindingDigest: scoredExamFramedDigest(binding, 'nextera-exam1-rubric-source-binding'),
    policy,
    policyDigest: scoredExamFramedDigest(policy, '01coding-exam-manual-evidence-policy'),
    learner: { displayName: 'Synthetic learner', studentNumber: null },
    records: [],
  };
  const unsafe = vi.fn(async (sql: string) =>
    sql === MANUAL_EVIDENCE_READINESS_SQL
      ? [{ ready: true }]
      : sql === READ_MANUAL_EVIDENCE_SQL
        ? [{ data: raw }]
        : Promise.reject(Error('Unexpected SQL')),
  );
  const client = { unsafe } as never;
  const display = await readManualReviewDisplay(client, f.identity.authUserId, f.context, {
    [f.context.rubric.digest]: text,
  });
  const snapshot = await parseMentorReviewSnapshot(
    { ...(await f.metadata()), manualReview: display },
    f.identity,
  );
  const answer = await parseMentorReviewAnswer(
    await f.service().readAnswer(f.identity.authUserId, f.identity.attemptId, f.submissionId),
    snapshot,
    f.submissionId,
  );
  return { ...f, text, policy, raw, client, unsafe, display, snapshot, answer };
}
const marks = (kind: string) =>
  kind === 'coding'
    ? { contract: 2 }
    : kind === 'trace_with_reason'
      ? { reason: 2 }
      : { counterexample: 4, explanation: 2 };
describe('documented V2 manual review', () => {
  it.each(['coding', 'trace_with_reason', 'debug_with_reason'] as const)(
    'independently derives exact browser/server/native document bindings for %s',
    async (kind) => {
      const f = await fixture(kind),
        command = await captureDocumentedMentorCommand(
          f.snapshot,
          f.answer,
          marks(kind),
          ' exact\r\nعربي ',
          id(760),
        );
      expect(command.version).toBe(2);
      expect(command.evidence.notes).toBe(' exact\r\nعربي ');
      const server = manualEvidenceDocument(f.context, captureManualEvidenceCommand(command)),
        browser = browserManualEvidenceDocument(f.snapshot, command);
      expect(checkpointCanonicalJson(server)).toBe(mentorCanonical(browser));
      expect(manualEvidenceDigest(server)).toBe(await browserManualEvidenceDigest(browser));
      expect(command.payload.evidenceDigest).toBe(manualEvidenceDigest(server));
    },
  );
  it.each(['bad\0note', 'bad\ud800note', 'bad\udfffnote'])(
    'rejects malformed notes before any write: %j',
    async (notes) => {
      const f = await fixture();
      await expect(
        captureDocumentedMentorCommand(f.snapshot, f.answer, { contract: 2 }, notes, id(761)),
      ).rejects.toThrow();
    },
  );
  it('rejects accessor marks without invoking them', async () => {
    const f = await fixture(),
      command = await captureDocumentedMentorCommand(
        f.snapshot,
        f.answer,
        { contract: 2 },
        null,
        id(779),
      );
    let read = false;
    const marks = Object.defineProperty({}, 'contract', {
      enumerable: true,
      get() {
        read = true;
        return 2;
      },
    });
    expect(() =>
      captureManualEvidenceCommand({ ...command, payload: { ...command.payload, marks } }),
    ).toThrow();
    expect(read).toBe(false);
  });
  it('requires whole approved criteria text and native policy, preserving no prose fallback', async () => {
    const f = await fixture();
    expect(configuredManualCriteria(undefined)).toEqual({});
    expect(
      configuredManualCriteria(JSON.stringify({ version: 1, documents: { draft: 'candidate' } })),
    ).toEqual({});
    for (const docs of [{}, { [f.context.rubric.digest]: f.text + ' changed' }]) {
      const display = await readManualReviewDisplay(
        f.client,
        f.identity.authUserId,
        f.context,
        docs,
      );
      expect(display.canRecordNew).toBe(false);
      expect(display.criteria).toBeNull();
      expect(display.reason).toMatch(/criteria/);
    }
    f.raw.policy = null as never;
    f.raw.policyDigest = null as never;
    const display = await readManualReviewDisplay(f.client, f.identity.authUserId, f.context, {
      [f.context.rubric.digest]: f.text,
    });
    expect(display.reason).toBe('native_policy_missing');
    expect(display.canRecordNew).toBe(false);
  });
  it('rejects stale display context and unbound approved source hash', async () => {
    const f = await fixture();
    f.raw.contextDigest = '0'.repeat(64);
    await expect(
      readManualReviewDisplay(f.client, f.identity.authUserId, f.context, {}),
    ).rejects.toMatchObject({ code: 'unavailable' });
    f.raw.contextDigest = manualReviewContextDigest(f.context);
    f.raw.sourceBinding.decisions.manualCriteriaSha256 = 'f'.repeat(64);
    await expect(
      readManualReviewDisplay(f.client, f.identity.authUserId, f.context, {}),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('verifies a real persisted document reference; a digest-only V1 event has no saved note', async () => {
    const f = await fixture(),
      command = await captureDocumentedMentorCommand(
        f.snapshot,
        f.answer,
        { contract: 2 },
        'stored note',
        id(762),
      ),
      document = manualEvidenceDocument(f.context, command);
    const event = {
      eventId: id(981),
      operationId: command.write.operationId,
      revision: '2',
      eventKind: 'primary' as const,
      actorUserId: f.identity.actorUserId,
      payload: command.payload,
      payloadDigest: examScoringEventDigest(command.payload),
    };
    const snapshot = {
      ...f.snapshot,
      histories: [{ ...f.history, revision: '2', events: [...f.history.events, event] }],
    };
    const record = {
      eventId: event.eventId,
      operationId: event.operationId,
      submissionId: f.submissionId,
      revision: '2',
      review: 'primary' as const,
      sourceActorId: f.identity.actorUserId,
      sourceRole: 'operator' as const,
      policyDigest: f.raw.policyDigest,
      document,
      digest: manualEvidenceDigest(document),
      byteLength: Buffer.byteLength(checkpointCanonicalJson(document)),
    };
    const manual: ManualReviewDisplay = { ...f.display, records: [record] };
    expect((await parseManualReviewDisplay(manual, snapshot))?.records[0]?.document.notes).toBe(
      'stored note',
    );
    await expect(
      parseManualReviewDisplay(
        { ...manual, records: [{ ...record, document: { ...document, notes: 'changed' } }] },
        snapshot,
      ),
    ).rejects.toThrow();
    expect((await parseManualReviewDisplay({ ...manual, records: [] }, snapshot))?.records).toEqual(
      [],
    );
  });
  it('keeps exact original operation/revision/document through unknown write, later primary and missing criteria', async () => {
    const f = await fixture('coding', true);
    let first = true;
    const posts: string[] = [];
    const send = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method !== 'POST')
        return Response.json({
          ...(await f.metadata()),
          manualReview: first
            ? f.display
            : {
                ...f.display,
                contextDigest: manualReviewContextDigest(f.context),
                criteria: null,
                canRecordNew: false,
                reason: 'approved_criteria_missing',
              },
        });
      posts.push(String(init.body));
      const command = JSON.parse(String(init.body));
      if (first) {
        first = false;
        const completed = {
          eventId: id(985),
          operationId: command.write.operationId,
          revision: '3',
          eventKind: 'secondary' as const,
          actorUserId: f.identity.actorUserId,
          payload: command.payload,
          payloadDigest: examScoringEventDigest(command.payload),
        };
        const oldPrimary = f.history.events.at(-1)!;
        f.history.events = [
          ...f.history.events,
          completed,
          { ...oldPrimary, eventId: id(987), operationId: id(988), revision: '4' },
        ];
        f.history.revision = '4';
        f.context.acceptances = f.context.acceptances.map((a) => ({ ...a, revision: '4' }));
        throw Error('connection lost after native commit');
      }

      const doc = manualEvidenceDocument(f.context, command);
      return Response.json(
        {
          kind: 'recorded',
          eventId: id(985),
          operationId: command.write.operationId,
          submissionId: command.write.submissionId,
          revision: String(BigInt(command.write.expectedRevision) + 1n),
          payloadDigest: examScoringEventDigest(command.payload),
          replayed: true,
          evidenceReference: {
            version: 1,
            eventId: id(985),
            digest: manualEvidenceDigest(doc),
            byteLength: Buffer.byteLength(checkpointCanonicalJson(doc)),
            notesStored: true,
          },
        },
        { status: 202 },
      );
    });
    const client = new ScoredExamMentorReviewClient(f.identity, {
      send,
      operationId: () => id(765),
      changed: () => {},
      accessRemoved: () => {},
    });
    await client.load();
    // This test double serves the already verified private answer through the normal answer read transport.
    send.mockImplementationOnce(async () =>
      Response.json(
        await f.service().readAnswer(f.identity.authUserId, f.identity.attemptId, f.submissionId),
      ),
    );
    await client.readAnswer(f.submissionId);
    client.editReview(f.submissionId, {
      review: 'secondary',
      evidenceDigest: '0'.repeat(64),
      marks: { contract: 2 },
      primaryEventId: f.history.events.at(-1)!.eventId,
    });
    await client.record(f.submissionId, 'original note');
    expect(client.getSnapshot().write.kind).toBe('uncertain');
    expect(client.getPendingCommand()?.version).toBe(2);
    await client.record(f.submissionId, 'changed note');
    expect(posts).toHaveLength(2);
    expect(posts[0]).toBe(posts[1]);
    expect(client.getSnapshot().snapshot?.histories[0]?.revision).toBe('4');
    expect(client.getSnapshot().write.kind).toBe('recorded');
    expect(
      'receipt' in client.getSnapshot().write
        ? (
            client.getSnapshot().write as {
              receipt: { evidenceReference?: { notesStored: boolean } };
            }
          ).receipt.evidenceReference?.notesStored
        : false,
    ).toBe(true);
  });
  it('does not claim atomic persistence on a missing/malformed evidence reference or transaction error', async () => {
    const f = await fixture(),
      command = await captureDocumentedMentorCommand(
        f.snapshot,
        f.answer,
        { contract: 2 },
        'note',
        id(767),
      );
    for (const result of [
      {
        kind: 'recorded',
        eventId: id(986),
        operationId: command.write.operationId,
        submissionId: command.write.submissionId,
        revision: '2',
        payloadDigest: examScoringEventDigest(command.payload),
        replayed: false,
      },
      Error('evidence INSERT failure causes transaction rollback'),
    ]) {
      const unsafe = vi.fn(async (sql: string) => {
        if (sql === MANUAL_EVIDENCE_READINESS_SQL) return [{ ready: true }];
        if (result instanceof Error) throw result;
        return [{ data: result }];
      });
      await expect(
        recordManualEvidence(
          { unsafe } as never,
          f.identity.authUserId,
          f.context,
          command,
          f.text,
        ),
      ).rejects.toBeInstanceOf(ScoredExamManualEvidenceError);
      await expect(
        recordManualEvidence({ unsafe } as never, f.identity.authUserId, f.context, command, null),
      ).rejects.toMatchObject({ code: 'outcome_unknown' });
      expect(unsafe.mock.calls.filter(([sql]) => sql === RECORD_MANUAL_EVIDENCE_SQL)).toHaveLength(
        2,
      );
    }
  });
  it('keeps V1 service packets compatible and rejects V2 forged evidence before native mutation', async () => {
    const f = await fixture(),
      base = f.service(),
      service = createScoredExamReviewService({
        client: f.client,
        bodyPolicy: base.bodyPolicy,
        manualCriteria: { [f.context.rubric.digest]: f.text },
      });
    expect(typeof service.review).toBe('function');
    const command = await captureDocumentedMentorCommand(
      f.snapshot,
      f.answer,
      { contract: 2 },
      null,
      id(769),
    );
    const result = await recordManualEvidence(
      f.client,
      f.identity.authUserId,
      f.context,
      { ...command, payload: { ...command.payload, evidenceDigest: 'f'.repeat(64) } },
      f.text,
    );
    expect(result).toEqual({ kind: 'conflict' });
    expect(f.unsafe.mock.calls.some(([sql]) => sql === RECORD_MANUAL_EVIDENCE_SQL)).toBe(false);
  });
  it('renders the actual existing-staff detail with escaped criteria, immutable answer and honest V1 notes state', async () => {
    const f = await fixture('coding', true);
    const send = async (url: unknown) =>
      String(url).includes('submission=')
        ? Response.json(
            await f
              .service()
              .readAnswer(f.identity.authUserId, f.identity.attemptId, f.submissionId),
          )
        : Response.json({ ...(await f.metadata()), manualReview: f.display });
    const client = new ScoredExamMentorReviewClient(f.identity, {
      send,
      operationId: () => id(771),
      changed: () => {},
      accessRemoved: () => {},
    });
    await client.load();
    await client.readAnswer(f.submissionId);
    const html = renderToStaticMarkup(
      createElement(StaffExamReviewSelection, {
        client,
        snapshot: client.getSnapshot().snapshot!,
        submissionId: f.submissionId,
      }),
    );
    expect(html).toContain('Immutable accepted answer');
    expect(html).toContain('value=""');
    expect(html).toContain('max="2"');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('digest-only V1 reference');
    expect(html).toContain('Saved notes are not available');
    expect(html).not.toContain('Notes stored.');
  });
  it('purges borrowed private answer/criteria/history on pagehide without replacing uncertain command', async () => {
    const f = await fixture();
    const client = new ScoredExamMentorReviewClient(f.identity, {
      send: async () => Response.json({ ...(await f.metadata()), manualReview: f.display }),
      operationId: () => id(770),
      changed: () => {},
      accessRemoved: () => {},
    });
    await client.load();
    expect(client.getSnapshot().snapshot?.manualReview?.criteria?.text).toBe(f.text);
    client.hidePrivateContent();
    expect(client.getSnapshot().snapshot).toBeNull();
    expect(client.getSnapshot().answers).toEqual({});
    expect(client.getSnapshot().fresh).toBe(false);
  });
});
