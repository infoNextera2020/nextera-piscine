import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  readScoredExamCodeReceipt,
  reserveScoredExamCodeUpload,
  acceptScoredExamCodeUpload,
  createScoredExamCodeUploadClient,
  scoredExamCodeObjectKey,
  SCORED_EXAM_CODE_RECEIPT_SQL,
  RESERVE_SCORED_EXAM_CODE_UPLOAD_SQL,
  ACCEPT_SCORED_EXAM_CODE_UPLOAD_SQL,
  type ScoredExamCodeUploadClient,
  type ScoredExamCodeUploadInput,
} from '../queries/scored-exam-code-upload';
import type { OperationalDatabase } from '../operations/curriculum';
const id = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const h = (c: string) => c.repeat(64);
const input: ScoredExamCodeUploadInput = {
  authUserId: id(1),
  learnerId: id(2),
  cohortId: id(3),
  attemptId: id(4),
  taskKey: 'q1',
  requestId: id(5),
  filename: 'answer.go',
  byteLength: 31,
  answerSha256: h('a'),
  definitionDigest: h('b'),
  snapshotDigest: h('c'),
};
const receipt = () => ({
  kind: 'accepted',
  attemptId: input.attemptId,
  taskKey: input.taskKey,
  definitionDigest: input.definitionDigest,
  snapshotDigest: input.snapshotDigest,
  submissionId: id(6),
  jobId: id(7),
  artifactId: id(8),
  requestId: input.requestId,
  answerSha256: input.answerSha256,
  byteLength: input.byteLength,
  filename: input.filename,
  acceptedOrdinal: '9007199254740993',
  replayed: true,
});
const reservation = () => ({
  kind: 'reserved',
  ...input,
  intakePolicyDigest: h('d'),
  uploadPolicyDigest: h('e'),
  bucket: 'nextera-submissions',
  objectKey: scoredExamCodeObjectKey(input),
  reservedAt: '2026-10-31T05:00:00.000001+00:00',
  serverNow: '2026-10-31T05:00:01.000001+00:00',
  deadline: '2026-10-31T08:00:00.000001+00:00',
  resumed: false,
});
function fake(data: unknown) {
  const unsafe = vi.fn(async () => [{ data: structuredClone(data) }]);
  return { unsafe, client: { unsafe } as unknown as ScoredExamCodeUploadClient };
}
describe('scored code upload adapter (fake RPC, no native SQL)', () => {
  it('only queries exact request receipt, preserving wide ordinals and immutable acknowledgement', async () => {
    const f = fake(receipt()),
      r = await readScoredExamCodeReceipt(f.client, input);
    expect(r).toMatchObject({
      kind: 'accepted',
      replayed: true,
      acceptedOrdinal: '9007199254740993',
    });
    expect(Object.isFrozen(r)).toBe(true);
    expect(f.unsafe).toHaveBeenCalledExactlyOnceWith(SCORED_EXAM_CODE_RECEIPT_SQL, [
      input.authUserId,
      input.attemptId,
      input.taskKey,
      input.requestId,
      input.filename,
      input.byteLength,
      input.answerSha256,
    ]);
  });
  it('returns absent without reserving/writing and captures explicit resumed reservation', async () => {
    const f = fake({ kind: 'absent' });
    expect(await readScoredExamCodeReceipt(f.client, input)).toEqual({ kind: 'absent' });
    const g = fake({ ...reservation(), resumed: true });
    expect(await reserveScoredExamCodeUpload(g.client, input)).toMatchObject({
      kind: 'reserved',
      resumed: true,
      objectKey: scoredExamCodeObjectKey(input),
    });
    expect(g.unsafe).toHaveBeenCalledExactlyOnceWith(
      RESERVE_SCORED_EXAM_CODE_UPLOAD_SQL,
      expect.any(Array),
    );
  });
  it('finalizes the exact same identity once, without automatic retry', async () => {
    const f = fake({ ...receipt(), replayed: false });
    expect(await acceptScoredExamCodeUpload(f.client, input)).toMatchObject({
      kind: 'accepted',
      replayed: false,
    });
    expect(f.unsafe).toHaveBeenCalledExactlyOnceWith(
      ACCEPT_SCORED_EXAM_CODE_UPLOAD_SQL,
      expect.any(Array),
    );
  });
  it.each([
    'forbidden',
    'invalid_input',
    'unavailable',
    'closed',
    'conflict',
    'allowance_exhausted',
    'rate_limited',
    'resource_unavailable',
  ])('preserves proved %s denial', async (kind) => {
    expect(await reserveScoredExamCodeUpload(fake({ kind }).client, input)).toEqual({ kind });
  });
  it.each([
    { taskKey: 'q6' },
    { filename: '../answer.go' },
    { byteLength: 0 },
    { byteLength: 1.5 },
    { requestId: 'bad' },
    { cohortId: 'bad' },
    { definitionDigest: h('A') },
    { role: 'admin' },
  ])('rejects invalid scope before IO %j', async (patch) => {
    const f = fake(reservation());
    await expect(
      reserveScoredExamCodeUpload(f.client, { ...input, ...patch } as ScoredExamCodeUploadInput),
    ).rejects.toThrow('INVALID_INPUT');
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('never evaluates getters or permits input mutation to rebind the request', async () => {
    const getter = vi.fn(() => input.answerSha256),
      f = fake(receipt());
    const bad = Object.defineProperty({ ...input }, 'answerSha256', {
      enumerable: true,
      get: getter,
    });
    await expect(readScoredExamCodeReceipt(f.client, bad)).rejects.toThrow('INVALID_INPUT');
    expect(getter).not.toHaveBeenCalled();
    const v = { ...input },
      p = readScoredExamCodeReceipt(f.client, v);
    v.requestId = id(99);
    await p;
    expect(f.unsafe.mock.calls).toHaveLength(1);
  });
  it.each([
    { cohortId: id(99) },
    { learnerId: id(99) },
    { attemptId: id(99) },
    { taskKey: 'q2' },
    { filename: 'other.go' },
    { answerSha256: h('f') },
    { byteLength: 32 },
    { objectKey: 'unscoped' },
    { bucket: 'public' },
    { uploadPolicyDigest: 'bad' },
    { serverNow: '2026-10-31T09:00:00Z' },
    { resumed: undefined },
  ])('keeps malformed/rebound reservation outcome unknown %j', async (patch) => {
    await expect(
      reserveScoredExamCodeUpload(fake({ ...reservation(), ...patch }).client, input),
    ).rejects.toThrow('OUTCOME_UNKNOWN');
  });
  it.each([
    { definitionDigest: h('f') },
    { snapshotDigest: h('f') },
    { requestId: id(99) },
    { replayed: false },
    { acceptedOrdinal: '01' },
    { acceptedOrdinal: '9223372036854775808' },
    { extra: true },
  ])('rejects a rebound or non-replay receipt %j', async (patch) => {
    await expect(
      readScoredExamCodeReceipt(fake({ ...receipt(), ...patch }).client, input),
    ).rejects.toThrow('UNAVAILABLE');
  });
  it('classifies ambiguous writes unknown and read failure unavailable without leaking/retrying', async () => {
    const f = fake({});
    f.unsafe.mockRejectedValue(new Error('private connection text'));
    await expect(readScoredExamCodeReceipt(f.client, input)).rejects.toThrow(
      'SCORED_EXAM_CODE_UPLOAD_UNAVAILABLE',
    );
    await expect(reserveScoredExamCodeUpload(f.client, input)).rejects.toThrow(
      'SCORED_EXAM_CODE_UPLOAD_OUTCOME_UNKNOWN',
    );
    await expect(acceptScoredExamCodeUpload(f.client, input)).rejects.toThrow(
      'SCORED_EXAM_CODE_UPLOAD_OUTCOME_UNKNOWN',
    );
    expect(f.unsafe).toHaveBeenCalledTimes(3);
  });
  it('closed dispatcher refuses caller-selected SQL without touching database', async () => {
    const execute = vi.fn(async () => []);
    const c = createScoredExamCodeUploadClient({ execute } as unknown as OperationalDatabase);
    await expect(c.unsafe('select secret', [])).rejects.toThrow('RPC_UNAVAILABLE');
    expect(execute).not.toHaveBeenCalled();
  });
});
const draft = readFileSync(
  new URL('../migration-drafts/0031_scored_code_upload_admission.DRAFT.sql', import.meta.url),
  'utf8',
);
const original = readFileSync(
  new URL('../migrations/0004_source_storage_policies.sql', import.meta.url),
  'utf8',
);
const fn = (name: string) =>
  draft.slice(
    draft.indexOf('CREATE FUNCTION app.' + name + '('),
    draft.indexOf('END $$;', draft.indexOf('CREATE FUNCTION app.' + name + '(')) + 7,
  );
describe('0031 source proposal invariants (static, not native RLS/concurrency proof)', () => {
  it('does not seed numeric policy, apply roles, change old SQL or auto-release resources', () => {
    expect(draft).not.toMatch(
      /INSERT INTO app\.scored_exam_code_upload_policies|CREATE OR REPLACE|CREATE ROLE|ALTER ROLE|DELETE FROM|UPDATE app\.scored_exam_code_upload_reservations/,
    );
    expect(draft).toContain('no numeric defaults');
    for (const k of [
      'maxReservedObjects',
      'maxReservedBytes',
      'reservationWindowMs',
      'maxReservationsPerWindow',
    ])
      expect(draft).toContain(k);
    expect(draft).toContain('unbounded LEGACY');
    expect(draft).toContain('SQL does NOT independently prove blob presence/hash');
  });
  it('receipt path is read-only, bound to exact source/job/capture/time and closed on expired POST', () => {
    const s = fn('scored_exam_code_receipt');
    expect(s).not.toMatch(/INSERT INTO|UPDATE app\.|DELETE FROM/);
    expect(s.indexOf('moment>=a.deadline_at')).toBeLessThan(s.indexOf('SELECT * INTO i'));
    for (const x of [
      'i.accepted_at>=a.deadline_at',
      'i.snapshot_digest',
      'i.answer_digest',
      'c.accepted_at',
      'j.evaluation_snapshot',
      'j.evaluation_digest',
      'art.storage_key',
      's.active_judge_job_id',
    ])
      expect(s).toContain(x);
  });
  it('serializes before reserving, counts all durable objects/bytes and pending slots fairly', () => {
    expect(draft).toContain('app.scored_exam_intake_context(auth_id,attempt,task)');
    const s = fn('reserve_scored_exam_code_upload');
    expect(s.indexOf('FOR UPDATE')).toBeLessThan(
      s.indexOf('INSERT INTO app.scored_exam_code_upload_reservations'),
    );
    expect(s).toContain('used+pending');
    expect(s).toContain("jsonb_build_object('kind','resource_unavailable')");
    expect(s).toContain('coalesce(sum(byte_length),0)');
    expect(s).toContain('WHERE attempt_id=attempt;');
    expect(s).toContain('resumed:=true');
    expect(s).not.toMatch(/INSERT INTO app\.(?:submissions|exam_scoring_acceptances)|system_error/);
  });
  it('keeps exact old restrictive branch while admitting only classified reserved metadata', () => {
    const branch = original.slice(
      original.indexOf(
        '(storage.foldername(name))[1]=(SELECT auth.uid())::text',
        original.indexOf('CREATE POLICY nextera_source_insert_scope'),
      ),
      original.indexOf(
        "'))$policy$;",
        original.indexOf('CREATE POLICY nextera_source_insert_scope'),
      ),
    );
    // Branch's exact logical terms remain; only its enclosing OR gains the new admission predicate.
    expect(draft).toContain(branch);
    expect(draft).toContain('AS RESTRICTIVE FOR INSERT TO PUBLIC');
    expect(draft).toContain('app.scored_exam_code_upload_allowed(bucket_id,name,metadata)');
    expect(fn('scored_exam_code_upload_allowed')).toContain(
      "(object_metadata->>'size')::numeric<>r.byte_length",
    );
    expect(fn('scored_exam_code_upload_allowed')).toContain('moment<a.deadline_at');
    expect(draft).not.toMatch(/GRANT SELECT.*storage\.objects|INSERT INTO storage\.buckets/i);
  });
  it('makes admission required for new scoring writes and acceptance atomic, not a grade reservation', () => {
    expect(draft).toContain('BEFORE INSERT ON app.submissions');
    expect(draft).toContain('old acceptance cannot bypass admission');
    const s = fn('accept_scored_exam_code_upload');
    for (const x of [
      'INSERT INTO app.submission_artifacts',
      'r.storage_key',
      'INSERT INTO app.scored_exam_acceptance_intents',
      'INSERT INTO app.submissions',
      'INSERT INTO judge.jobs',
      'Atomic scored capture unavailable',
    ])
      expect(s).toContain(x);
    expect(draft).toContain('ENABLE ROW LEVEL SECURITY');
    expect(draft).toContain('private ACL readback failed');
  });
});
