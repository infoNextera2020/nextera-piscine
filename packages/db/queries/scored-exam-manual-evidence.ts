import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import type { ScoredExamReviewContext } from './scored-exam-review-context';
import {
  examScoringEventDigest,
  type ExamMentorReviewPayload,
  type ExamSecondaryReviewPayload,
  type ExamScoringWrite,
  type ExamScoringWriteResult,
} from './exam-scoring-review';
import {
  assertScoredExamSourceBinding,
  checkpointCanonicalJson,
  scoredExamFramedDigest,
} from '../operations/scored-exam-publication';

export type ManualEvidenceInput = Readonly<{
  version: 1;
  manualCriteriaSha256: string;
  notes: string | null;
}>;
export type ManualEvidenceReference = Readonly<{
  version: 1;
  eventId: string;
  digest: string;
  byteLength: number;
  notesStored: boolean;
}>;
export type ManualEvidenceCommand = Readonly<{
  version: 2;
  review: 'primary' | 'secondary';
  attemptId: string;
  write: ExamScoringWrite;
  payload: ExamMentorReviewPayload | ExamSecondaryReviewPayload;
  evidence: ManualEvidenceInput;
}>;
export type ManualEvidencePolicy = Readonly<{
  version: 1;
  maxEvidenceBytes: number;
  maxCriteriaBytes: number;
}>;
export type ManualEvidenceRecord = Readonly<{
  eventId: string;
  operationId: string;
  submissionId: string;
  revision: string;
  review: 'primary' | 'secondary';
  sourceActorId: string;
  sourceRole: 'operator' | 'admin';
  policyDigest: string;
  document: Record<string, unknown>;
  digest: string;
  byteLength: number;
}>;
export type ManualReviewDisplay = Readonly<{
  version: 1;
  contextDigest: string;
  closed: boolean;
  learner: Readonly<{ displayName: string; studentNumber: null }>;
  policy: ManualEvidencePolicy | null;
  criteria: Readonly<{ sha256: string; text: string; byteLength: number }> | null;
  manualCriteriaSha256: string | null;
  canRecordNew: boolean;
  reason: string;
  records: readonly ManualEvidenceRecord[];
}>;
export class ScoredExamManualEvidenceError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'forbidden' | 'outcome_unknown') {
    super('SCORED_EXAM_MANUAL_EVIDENCE_' + code.toUpperCase());
  }
}
const fail = (code: ScoredExamManualEvidenceError['code'] = 'invalid_input'): never => {
  throw new ScoredExamManualEvidenceError(code);
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
}
function exact(v: unknown, keys: string[]) {
  const o = object(v),
    d = Object.getOwnPropertyDescriptors(o);
  if (
    Reflect.ownKeys(d).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(d, k) || !Object.hasOwn(d[k]!, 'value'))
  )
    return fail();
  return Object.fromEntries(keys.map((k) => [k, d[k]!.value]));
}
function id(v: unknown): string {
  if (typeof v !== 'string' || !uuid.test(v)) return fail();
  return v;
}
function hash(v: unknown): string {
  if (typeof v !== 'string' || !sha.test(v)) return fail();
  return v;
}
function revision(v: unknown): string {
  if (
    typeof v !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(v) ||
    BigInt(v) >= 9223372036854775807n
  )
    return fail();
  return v;
}
export function validManualText(v: unknown): v is string {
  return (
    typeof v === 'string' && !v.includes('\0') && Buffer.from(v, 'utf8').toString('utf8') === v
  );
}
export function captureManualEvidenceCommand(value: unknown): ManualEvidenceCommand {
  const c = exact(value, ['version', 'review', 'attemptId', 'write', 'payload', 'evidence']);
  if (c.version !== 2 || (c.review !== 'primary' && c.review !== 'secondary')) return fail();
  const w = exact(c.write, ['operationId', 'submissionId', 'expectedRevision']);
  const e = exact(c.evidence, ['version', 'manualCriteriaSha256', 'notes']);
  if (e.version !== 1 || (e.notes !== null && !validManualText(e.notes))) return fail();
  const p = exact(c.payload, [
    'answerSha256',
    'rubricDigest',
    'assignmentDigest',
    'evidenceDigest',
    'marks',
    ...(c.review === 'secondary' ? ['primaryEventId'] : []),
  ]);
  const markInput = object(p.marks);
  const m = exact(markInput, Object.keys(markInput));
  const entries = Object.entries(m);
  const maxima: Record<string, number> = {
    contract: 2,
    reason: 2,
    counterexample: 4,
    explanation: 2,
  };
  if (
    !(
      ['contract', 'reason'].some((k) => entries.length === 1 && Object.hasOwn(m, k)) ||
      (entries.length === 2 &&
        Object.hasOwn(m, 'counterexample') &&
        Object.hasOwn(m, 'explanation'))
    ) ||
    entries.some(([k, v]) => !Number.isSafeInteger(v) || Number(v) < 0 || Number(v) > maxima[k]!)
  )
    return fail();
  const payload = {
    answerSha256: hash(p.answerSha256),
    rubricDigest: hash(p.rubricDigest),
    assignmentDigest: hash(p.assignmentDigest),
    evidenceDigest: hash(p.evidenceDigest),
    marks: { ...m },
    ...(c.review === 'secondary' ? { primaryEventId: id(p.primaryEventId) } : {}),
  } as ManualEvidenceCommand['payload'];
  // Canonical copy rejects accessors, non-JSON values and malformed Unicode in the full command.
  return Object.freeze(
    JSON.parse(
      checkpointCanonicalJson({
        version: 2,
        review: c.review,
        attemptId: id(c.attemptId),
        write: {
          operationId: id(w.operationId),
          submissionId: id(w.submissionId),
          expectedRevision: revision(w.expectedRevision),
        },
        payload,
        evidence: {
          version: 1,
          manualCriteriaSha256: hash(e.manualCriteriaSha256),
          notes: e.notes,
        },
      }),
    ),
  ) as ManualEvidenceCommand;
}
export function manualEvidenceDocument(
  context: ScoredExamReviewContext,
  c: ManualEvidenceCommand,
): Record<string, unknown> {
  const a = context.acceptances.find((a) => a.submissionId === c.write.submissionId),
    q = context.rubric.questions.find((q) => q.questionKey === a?.questionKey);
  if (
    !a ||
    !q ||
    c.attemptId !== context.attempt.scope.attemptId ||
    c.payload.answerSha256 !== a.answerSha256 ||
    c.payload.rubricDigest !== context.rubric.digest ||
    c.payload.assignmentDigest !== context.assignment.digest
  )
    return fail();
  return {
    version: 1,
    operationId: c.write.operationId,
    expectedRevision: c.write.expectedRevision,
    review: c.review,
    actorUserId: context.actorUserId,
    scope: context.attempt.scope,
    snapshotDigest: context.snapshotDigest,
    assignmentDigest: context.assignment.digest,
    submissionId: a.submissionId,
    questionKey: a.questionKey,
    answerKind: a.answerKind,
    answerSha256: a.answerSha256,
    manualCriteriaSha256: c.evidence.manualCriteriaSha256,
    publishedCriteriaDigest: q.publishedCriteriaDigest,
    marks: c.payload.marks,
    notes: c.evidence.notes,
    ...(c.review === 'secondary'
      ? { primaryEventId: (c.payload as ExamSecondaryReviewPayload).primaryEventId }
      : {}),
  };
}
export const manualEvidenceDigest = (doc: unknown) =>
  scoredExamFramedDigest(doc, '01coding-exam-manual-evidence');
export const manualReviewContextDigest = (ctx: ScoredExamReviewContext) => {
  const { serverNowMicros, ...rest } = ctx;
  void serverNowMicros;
  return scoredExamFramedDigest(rest, '01coding-exam-review-display-context');
};
export const READ_MANUAL_EVIDENCE_SQL =
  'SELECT app.scored_exam_manual_evidence($1::uuid,$2::uuid) AS data';
export const RECORD_MANUAL_EVIDENCE_SQL =
  'SELECT app.record_scored_exam_manual_evidence($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6,$7::jsonb,$8::jsonb,$9) AS data';
// Replaced from reviewed DRAFT0035 source by install script; both source bodies, exact ACL and owner are required.
export const MANUAL_EVIDENCE_READINESS_SQL = `SELECT current_user=session_user AND current_setting('role')='none'
 AND pg_has_role(session_user,'nextera_web','USAGE')
 AND NOT pg_has_role(session_user,'nextera_checkpoint_owner','USAGE')
 AND NOT pg_has_role(session_user,'nextera_checkpoint_owner','SET')
 AND NOT pg_has_role(session_user,'nextera_exam_evaluator','USAGE')
 AND NOT pg_has_role(session_user,'nextera_exam_evaluator','SET')
 AND EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT rolsuper
 AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 AND EXISTS(SELECT FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
 WHERE p.oid=to_regprocedure('app.scored_exam_manual_evidence(uuid,uuid)') AND o.rolname='nextera_checkpoint_owner'
 AND NOT o.rolcanlogin AND NOT o.rolsuper AND NOT o.rolcreatedb AND NOT o.rolcreaterole AND NOT o.rolreplication AND NOT o.rolbypassrls
 AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
 AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c8ac99443e7e9bbee905cd725dad55c33b0744a9e8cd02a094308111768a799f'
 AND has_function_privilege(session_user,p.oid,'EXECUTE')
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles g ON g.oid=a.grantee
 WHERE a.grantee<>p.proowner AND (g.rolname IS DISTINCT FROM 'nextera_web' OR a.privilege_type<>'EXECUTE' OR a.is_grantable)))
 AND EXISTS(SELECT FROM pg_proc p JOIN pg_roles o ON o.oid=p.proowner
 WHERE p.oid=to_regprocedure('app.record_scored_exam_manual_evidence(uuid,uuid,uuid,uuid,bigint,text,jsonb,jsonb,text)') AND o.rolname='nextera_checkpoint_owner'
 AND NOT o.rolcanlogin AND NOT o.rolsuper AND NOT o.rolcreatedb AND NOT o.rolcreaterole AND NOT o.rolreplication AND NOT o.rolbypassrls
 AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
 AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e6507a1abf7f50ad4aff2c22aaeaf7fd470b2e4c225556f3239d7777041a8aca'
 AND has_function_privilege(session_user,p.oid,'EXECUTE')
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles g ON g.oid=a.grantee
 WHERE a.grantee<>p.proowner AND (g.rolname IS DISTINCT FROM 'nextera_web' OR a.privilege_type<>'EXECUTE' OR a.is_grantable)))

 AND NOT EXISTS(SELECT FROM (VALUES('exam_manual_evidence_policies','immutable_manual_evidence_policy'),
 ('exam_manual_evidence','immutable_manual_evidence')) expected(name,guard)
 WHERE NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles o ON o.oid=c.relowner
 WHERE n.nspname='app' AND c.relname=expected.name AND c.relrowsecurity AND o.rolname='nextera_checkpoint_owner'
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee<>c.relowner)
 AND NOT has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=expected.guard
 AND t.tgfoid='app.guard_exam_scoring_history()'::regprocedure AND t.tgenabled='O' AND NOT t.tgisinternal)))
 AS ready`;
export async function verifyManualEvidenceCapability(client: Pick<Sql, 'unsafe'>) {
  try {
    const rows = await client.unsafe(MANUAL_EVIDENCE_READINESS_SQL);
    if (rows.length !== 1 || rows[0]?.ready !== true) return fail('unavailable');
  } catch {
    return fail('unavailable');
  }
}
export async function readManualReviewDisplay(
  client: Pick<Sql, 'unsafe'>,
  auth: string,
  ctx: ScoredExamReviewContext,
  documents: Readonly<Record<string, string>>,
): Promise<ManualReviewDisplay> {
  id(auth);
  await verifyManualEvidenceCapability(client);
  let rows;
  try {
    rows = await client.unsafe(READ_MANUAL_EVIDENCE_SQL, [auth, ctx.attempt.scope.attemptId]);
  } catch (e) {
    return fail((e as { code?: string }).code === '42501' ? 'forbidden' : 'unavailable');
  }
  try {
    if (rows.length !== 1) return fail();
    const r = exact(rows[0]?.data, [
      'version',
      'authUserId',
      'actorUserId',
      'attemptId',
      'contextDigest',
      'closed',
      'sourceBinding',
      'sourceBindingDigest',
      'policy',
      'policyDigest',
      'learner',
      'records',
    ]);
    if (
      r.version !== 1 ||
      r.authUserId !== auth ||
      r.actorUserId !== ctx.actorUserId ||
      r.attemptId !== ctx.attempt.scope.attemptId ||
      r.contextDigest !== manualReviewContextDigest(ctx) ||
      typeof r.closed !== 'boolean'
    )
      return fail();
    const learner = exact(r.learner, ['displayName', 'studentNumber']);
    if (!validManualText(learner.displayName) || learner.studentNumber !== null) return fail();
    let policy: ManualEvidencePolicy | null = null,
      manualCriteriaSha256: string | null = null,
      criteria: ManualReviewDisplay['criteria'] = null,
      reason = r.closed ? 'native_policy_missing' : 'review_not_open';
    if (r.closed) {
      assertScoredExamSourceBinding(r.sourceBinding, ctx.rubric);
      if (
        r.sourceBindingDigest !==
        scoredExamFramedDigest(r.sourceBinding, 'nextera-exam1-rubric-source-binding')
      )
        return fail();
      manualCriteriaSha256 = hash(object(object(r.sourceBinding).decisions).manualCriteriaSha256);
      if (r.policy !== null) {
        const p = exact(r.policy, ['version', 'maxEvidenceBytes', 'maxCriteriaBytes']);
        if (
          p.version !== 1 ||
          ![p.maxEvidenceBytes, p.maxCriteriaBytes].every(
            (n) => Number.isSafeInteger(n) && Number(n) > 0 && Number(n) <= 2147483647,
          ) ||
          r.policyDigest !== scoredExamFramedDigest(p, '01coding-exam-manual-evidence-policy')
        )
          return fail();
        policy = p as unknown as ManualEvidencePolicy;
        const text = documents[ctx.rubric.digest];
        reason = 'approved_criteria_missing';
        if (text !== undefined) {
          reason = 'approved_criteria_mismatch';
          if (
            validManualText(text) &&
            Buffer.byteLength(text) <= policy.maxCriteriaBytes &&
            createHash('sha256').update(text, 'utf8').digest('hex') === manualCriteriaSha256
          ) {
            criteria = { sha256: manualCriteriaSha256, text, byteLength: Buffer.byteLength(text) };
            reason = 'ready';
          }
        }
      }
    }
    if (!Array.isArray(r.records) || (!r.closed && r.records.length)) return fail();
    const records = r.records.map((raw) => {
      const d = exact(raw, [
        'eventId',
        'operationId',
        'submissionId',
        'revision',
        'review',
        'sourceActorId',
        'sourceRole',
        'policyDigest',
        'document',
        'digest',
        'byteLength',
      ]);
      id(d.eventId);
      id(d.operationId);
      id(d.submissionId);
      id(d.sourceActorId);
      hash(d.policyDigest);
      if (
        !['primary', 'secondary'].includes(String(d.review)) ||
        !['operator', 'admin'].includes(String(d.sourceRole)) ||
        typeof d.revision !== 'string' ||
        !Number.isSafeInteger(d.byteLength) ||
        d.byteLength !== Buffer.byteLength(checkpointCanonicalJson(d.document)) ||
        d.digest !== manualEvidenceDigest(d.document)
      )
        return fail();
      return d as unknown as ManualEvidenceRecord;
    });
    return Object.freeze({
      version: 1,
      contextDigest: r.contextDigest as string,
      closed: r.closed,
      learner: learner as ManualReviewDisplay['learner'],
      policy,
      criteria,
      manualCriteriaSha256,
      canRecordNew: criteria !== null && policy !== null,
      reason,
      records: Object.freeze(records),
    });
  } catch {
    return fail('unavailable');
  }
}
export async function recordManualEvidence(
  client: Pick<Sql, 'unsafe'>,
  auth: string,
  context: ScoredExamReviewContext,
  value: unknown,
  criteriaText: string | null,
): Promise<ExamScoringWriteResult & { evidenceReference?: ManualEvidenceReference }> {
  const c = captureManualEvidenceCommand(value);
  id(auth);
  const doc = manualEvidenceDocument(context, c),
    digest = manualEvidenceDigest(doc),
    byteLength = Buffer.byteLength(checkpointCanonicalJson(doc));
  if (c.payload.evidenceDigest !== digest) return { kind: 'conflict' };
  if (criteriaText !== null && !validManualText(criteriaText)) return fail();
  await verifyManualEvidenceCapability(client);
  let rows;
  try {
    rows = await client.unsafe(RECORD_MANUAL_EVIDENCE_SQL, [
      auth,
      c.attemptId,
      c.write.operationId,
      c.write.submissionId,
      c.write.expectedRevision,
      c.review,
      checkpointCanonicalJson(c.payload),
      checkpointCanonicalJson(c.evidence),
      criteriaText,
    ]);
  } catch (e) {
    if ((e as { code?: string }).code === '42501') return fail('forbidden');
    return fail('outcome_unknown');
  }
  try {
    if (rows.length !== 1) return fail();
    const r = object(rows[0]?.data);
    if (
      [
        'forbidden',
        'invalid_input',
        'unavailable',
        'review_not_open',
        'conflict',
        'stale_revision',
      ].includes(String(r.kind)) &&
      Object.keys(r).length === 1
    )
      return r as ExamScoringWriteResult;
    exact(r, [
      'kind',
      'eventId',
      'operationId',
      'submissionId',
      'revision',
      'payloadDigest',
      'replayed',
      'evidenceReference',
    ]);
    const ref = exact(r.evidenceReference, [
      'version',
      'eventId',
      'digest',
      'byteLength',
      'notesStored',
    ]);
    if (
      r.kind !== 'recorded' ||
      r.operationId !== c.write.operationId ||
      r.submissionId !== c.write.submissionId ||
      r.revision !== String(BigInt(c.write.expectedRevision) + 1n) ||
      r.payloadDigest !== examScoringEventDigest(c.payload) ||
      typeof r.replayed !== 'boolean' ||
      ref.version !== 1 ||
      ref.eventId !== id(r.eventId) ||
      ref.digest !== digest ||
      ref.byteLength !== byteLength ||
      ref.notesStored !== (c.evidence.notes !== null)
    )
      return fail();
    return r as unknown as ExamScoringWriteResult & { evidenceReference: ManualEvidenceReference };
  } catch {
    return fail('outcome_unknown');
  }
}
