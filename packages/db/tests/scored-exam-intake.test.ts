import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  acceptScoredExamSubmission,
  readScoredExamIntakeContext,
  ACCEPT_SCORED_EXAM_SUBMISSION_SQL,
  SCORED_EXAM_INTAKE_CONTEXT_SQL,
  type ScoredExamIntakeClient,
  type ScoredExamSubmissionInput,
} from '../queries/scored-exam-intake';
const id = (n: number) => '00000000-0000-0000-0000-' + n.toString(16).padStart(12, '0');
const h = (n: string) => n.repeat(64);
const input: ScoredExamSubmissionInput = {
  authUserId: id(1),
  attemptId: id(2),
  taskKey: 'q1',
  requestId: id(3),
  filename: 'answer.go',
  byteLength: 75,
  answerSha256: h('a'),
};
// Synthetic explicit values exercise plumbing only, not approved limits/defaults.
const policy = {
  version: 1,
  gradedAcceptanceAllowance: 7,
  rateWindowMs: 23456,
  maxAcceptancesPerWindow: 4,
  maxCodeBytes: 1024,
  resourcePolicyDigest: h('b'),
};
const canonical =
  '{' +
  Object.entries(policy)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v))
    .join(',') +
  '}';
const policyDigest = createHash('sha256')
  .update('01coding-scored-exam-intake\0v1\0' + canonical)
  .digest('hex');
function fake(reply: unknown) {
  const unsafe = vi.fn(async (statement: string, params: unknown[]) => {
    void statement;
    void params;
    return structuredClone(reply);
  });
  return { unsafe, client: { unsafe } as unknown as ScoredExamIntakeClient };
}
function accepted(replayed = false) {
  return [
    {
      data: {
        kind: 'accepted',
        attemptId: input.attemptId,
        taskKey: input.taskKey,
        definitionDigest: h('c'),
        snapshotDigest: h('d'),
        submissionId: id(4),
        jobId: id(5),
        artifactId: id(6),
        requestId: input.requestId,
        answerSha256: input.answerSha256,
        byteLength: input.byteLength,
        filename: input.filename,
        acceptedOrdinal: '9007199254740993',
        replayed,
      },
    },
  ];
}
function context() {
  return [
    {
      data: {
        authUserId: input.authUserId,
        learnerId: id(7),
        cohortId: id(8),
        attemptId: input.attemptId,
        taskKey: input.taskKey,
        definitionDigest: h('c'),
        snapshotDigest: h('d'),
        filename: input.filename,
        maxCodeBytes: policy.maxCodeBytes,
        policy,
        policyDigest,
        serverNow: '2026-10-30T20:00:00.000001+00:00',
        deadline: '2026-10-30T23:00:00.000001+00:00',
        status: 'open',
        canSubmit: true,
      },
    },
  ];
}
describe('scored Exam1 source query adapter', () => {
  it('submits exact identity/source parameters without caller pass-state or quota defaults', async () => {
    const f = fake(accepted());
    const result = await acceptScoredExamSubmission(f.client, input);
    expect(result).toMatchObject({
      kind: 'accepted',
      acceptedOrdinal: '9007199254740993',
      replayed: false,
    });
    expect(f.unsafe).toHaveBeenCalledExactlyOnceWith(ACCEPT_SCORED_EXAM_SUBMISSION_SQL, [
      input.authUserId,
      input.attemptId,
      'q1',
      input.requestId,
      input.filename,
      75,
      input.answerSha256,
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('preserves exact same-request replay instead of charging/running again in the adapter', async () => {
    const f = fake(accepted(true));
    expect(await acceptScoredExamSubmission(f.client, input)).toMatchObject({
      kind: 'accepted',
      replayed: true,
    });
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it.each([
    'forbidden',
    'invalid_input',
    'unavailable',
    'closed',
    'conflict',
    'allowance_exhausted',
    'rate_limited',
  ] as const)('returns proved %s SQL denial without automatic retry', async (kind) => {
    const f = fake([{ data: { kind } }]);
    expect(await acceptScoredExamSubmission(f.client, input)).toEqual({ kind });
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it.each([
    { taskKey: 'q6' },
    { taskKey: 'q8' },
    { filename: '../answer.go' },
    { filename: 'bad.go;DROP TABLE app.users' },
    { byteLength: 0 },
    { byteLength: 1.5 },
    { answerSha256: 'A'.repeat(64) },
    { requestId: 'not-a-uuid' },
  ])('rejects malformed/scoped input before database IO %j', async (patch) => {
    const f = fake(accepted());
    await expect(
      acceptScoredExamSubmission(f.client, { ...input, ...patch } as ScoredExamSubmissionInput),
    ).rejects.toThrow('INVALID_INPUT');
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('rejects client claimed roles and getters without evaluating them', async () => {
    const f = fake(accepted());
    const getter = vi.fn(() => input.answerSha256);
    const v = Object.defineProperty({ ...input }, 'answerSha256', {
      enumerable: true,
      get: getter,
    });
    await expect(acceptScoredExamSubmission(f.client, v)).rejects.toThrow('INVALID_INPUT');
    await expect(
      acceptScoredExamSubmission(f.client, {
        ...input,
        role: 'admin',
      } as ScoredExamSubmissionInput),
    ).rejects.toThrow('INVALID_INPUT');
    expect(getter).not.toHaveBeenCalled();
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it('captures immutable values before native IO', async () => {
    const v = { ...input };
    const f = fake(accepted());
    const p = acceptScoredExamSubmission(f.client, v);
    v.filename = 'changed.go';
    await p;
    expect(f.unsafe.mock.calls[0]![1][4]).toBe('answer.go');
  });
  it('keeps ambiguous native failure unknown without leaked connection text/retry', async () => {
    const f = fake([]);
    f.unsafe.mockRejectedValue(new Error('secret connection details'));
    await expect(acceptScoredExamSubmission(f.client, input)).rejects.toThrow(
      'SCORED_EXAM_INTAKE_OUTCOME_UNKNOWN',
    );
    expect(f.unsafe).toHaveBeenCalledTimes(1);
  });
  it.each([
    { attemptId: id(99) },
    { taskKey: 'q2' },
    { definitionDigest: 'invalid' },
    { requestId: id(99) },
    { answerSha256: h('f') },
    { filename: 'other.go' },
    { byteLength: 100 },
    { acceptedOrdinal: '01' },
    { acceptedOrdinal: '9223372036854775808' },
    { role: 'admin' },
  ])('rejects malformed or rebound acknowledgement %j', async (patch) => {
    const reply = accepted();
    Object.assign(reply[0]!.data, patch);
    await expect(acceptScoredExamSubmission(fake(reply).client, input)).rejects.toThrow(
      'OUTCOME_UNKNOWN',
    );
  });
  it('reads explicit policy and source identity without choosing new allowance values', async () => {
    const f = fake(context());
    const value = await readScoredExamIntakeContext(
      f.client,
      input.authUserId,
      input.attemptId,
      'q1',
    );
    expect(value.policy).toEqual(policy);
    expect(value.canSubmit).toBe(true);
    expect(f.unsafe).toHaveBeenCalledExactlyOnceWith(SCORED_EXAM_INTAKE_CONTEXT_SQL, [
      input.authUserId,
      input.attemptId,
      'q1',
    ]);
    expect(Object.isFrozen(value.policy)).toBe(true);
  });
  it.each([
    { policy: null },
    { policy: {} },
    { policy: { ...policy, gradedAcceptanceAllowance: 0 } },
    { policyDigest: h('f') },
    { attemptId: id(99) },
    { taskKey: 'q2' },
    { maxCodeBytes: 55 },
    { status: 'closed', canSubmit: true },
  ])('fails closed when policy/context unavailable or rebound %j', async (patch) => {
    const reply = context();
    Object.assign(reply[0]!.data, patch);
    await expect(
      readScoredExamIntakeContext(fake(reply).client, input.authUserId, input.attemptId, 'q1'),
    ).rejects.toThrow('UNAVAILABLE');
  });
});

const proposal = readFileSync(
  new URL('../migration-drafts/0026_scored_exam_intake.DRAFT.sql', import.meta.url),
  'utf8',
);
describe('scored-only append-only0026 SQL preparation', () => {
  it('does not replace legacy functions, rewrite history, choose calendar or seed limits', () => {
    expect(proposal).not.toMatch(
      /CREATE OR REPLACE FUNCTION|INSERT INTO app\.scored_exam_intake_policies|ALTER TABLE app\.checkpoint_attempts|CREATE\s+ROLE|ALTER\s+ROLE/,
    );
    expect(proposal).toContain('existing90-minute');
    expect(proposal).toContain('max_acceptances_per_window integer NOT NULL');
    expect(proposal).toContain('graded_acceptance_allowance integer NOT NULL');
    expect(proposal).not.toContain('consumed>=3');
  });
  it('has no pass-result lock, automatic retake or implicit quota refund', () => {
    expect(proposal).not.toMatch(
      /state\s*=\s*'passed'|state\s*<>\s*'system_error'|slot:=2|replacement_grants/,
    );
    expect(proposal).toContain(
      "NEW.normal_slot<>1 OR NEW.kind<>'normal' OR NEW.replacement_for IS NOT NULL",
    );
    expect(proposal).toContain('hashtextextended(NEW.cohort_id::text||NEW.user_id::text,4)');
    expect(proposal).toContain(
      'WHERE cohort_id=NEW.cohort_id AND user_id=NEW.user_id AND node_key=NEW.node_key',
    );
  });
  it('retains immutable policy/resource/source/time/access and private-intent guards', () => {
    expect(proposal).toContain('app.checkpoint_lock_access(auth_id,a.cohort_id)');
    expect(proposal).toContain("interval '180 minutes'");
    expect(proposal).toContain("a.status<>'active' OR at_time>=a.deadline_at");
    expect(proposal).toContain('scoredSubmissionPolicy');
    expect(proposal).toContain("ARRAY['compilation','execution']");
    expect(proposal).toContain("'01coding-exam-resource-limits'");
    expect(proposal).toContain('Scored intake intent required; legacy acceptance cannot bypass it');
    expect(proposal).not.toContain("set_config('nextera.scored");
    expect(proposal).toContain('BEFORE INSERT ON app.submissions');
    expect(proposal).toContain('FOR UPDATE');
  });
  it('keeps private reservation, artifact, queued job and scoring capture atomic', () => {
    expect(proposal).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(proposal).toContain('INSERT INTO app.scored_exam_acceptance_intents');
    expect(proposal).toContain('INSERT INTO judge.jobs');
    expect(proposal).toContain('Atomic scored capture unavailable');
    expect(proposal).toContain('old.snapshot_digest IS DISTINCT FROM a.snapshot_digest');
    expect(proposal).toContain(
      "EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('kind','forbidden');WHEN SQLSTATE 'PS005' THEN RETURN jsonb_build_object('kind','unavailable')",
    );
    expect(proposal).not.toMatch(
      /UPDATE app\.checkpoint_attempts|UPDATE app\.learner_node_progress|INSERT INTO app\.checkpoint_outcomes/,
    );
  });
  it('installs only five external FKs under preheld DBA authority and verifies exact columns/deferral', () => {
    const ownerSpan = proposal.slice(
      proposal.indexOf('SET LOCAL ROLE nextera_checkpoint_owner;'),
      proposal.indexOf('RESET ROLE;'),
    );
    expect(ownerSpan).not.toMatch(
      /REFERENCES (?:app\.(?:checkpoint_definitions|checkpoint_attempts|submissions|submission_artifacts)|judge\.jobs)/,
    );
    const bootstrapSpan = proposal.slice(proposal.indexOf('RESET ROLE;'));
    expect(bootstrapSpan.match(/ADD CONSTRAINT scored_exam_\w+_fk FOREIGN KEY/g)).toHaveLength(5);
    expect(proposal).not.toMatch(/GRANT\s+REFERENCES/i);
    expect(bootstrapSpan).toContain('Exact external scoring FK readback failed');
    expect(bootstrapSpan).toContain('New scoring table owner/RLS/private ACL readback failed');
    expect(bootstrapSpan).toContain(
      'c.condeferrable=required.deferred AND c.condeferred=required.deferred',
    );
    expect(bootstrapSpan).toContain('att.attname::text ORDER BY x.ord');
    expect(proposal.indexOf('END $external_fk_audit$;')).toBeLessThan(
      proposal.lastIndexOf('COMMIT;'),
    );
  });
  it('preserves private ACLs and requires a reviewed existing isolated DBA span', () => {
    expect(proposal).toContain('ENABLE ROW LEVEL SECURITY');
    expect(proposal).toContain('REVOKE ALL ON TABLE');
    expect(proposal).toContain('REVOKE ALL ON FUNCTION');
    expect(proposal).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL|CREATE|USAGE)\b/);
    expect(proposal).toContain('TO nextera_web;');
    expect(proposal.match(/rolname=current_user AND rolcanlogin AND rolsuper/g)).toHaveLength(2);
  });
});
