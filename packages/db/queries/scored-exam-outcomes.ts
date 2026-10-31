import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import type {
  ExamAdjudication,
  ExamScope,
  ExamQuestionScore,
  ExamSelectionIdentity,
} from '@nextera/domain';
import type { ScoredExamAcceptance } from './scored-exam-review-context';

export type ScoredExamOutcomeClient = Pick<Sql, 'unsafe'>;
export type ScoredExamOutcomeProjection = Readonly<{
  version: 1;
  scope: ExamScope;
  snapshotDigest: string;
  assignmentDigest: string;
  closure: null | Readonly<{
    reason: 'finished' | 'expired';
    closedAtMicros: string;
    closureOrdinal: string;
  }>;
  acceptances: readonly ScoredExamAcceptance[];
}>;
/** Explicit server-owned decision, never supplied by the learner/browser request. */
export type ScoredExamAdjudicationPolicy = Readonly<{
  version: 1;
  attemptId: string;
  snapshotDigest: string;
  rubricDigest: string;
  assignmentDigest: string;
  projectionDigest: string;
  initialThresholdReview: 'required' | 'not_required' | 'unresolved';
  disputed: boolean;
  affectedSubmissionIds: readonly string[];
  evidenceDigest: string;
}>;
export type ScoredExamAdjudicationBody = Readonly<{
  version: 1;
  projectionDigest: string;
  priorOutcomeId: string | null;
  policy: ScoredExamAdjudicationPolicy;
  decision: ExamAdjudication;
}>;
export type ScoredExamFinalResult = Readonly<{
  version: 1;
  adjudicationId: string;
  projectionDigest: string;
  selection: readonly ExamSelectionIdentity[];
  questions: readonly ExamQuestionScore[];
  totalPoints: number;
  codingPoints: number;
  verdict: 'passed' | 'failed';
  implementationDigest: string;
}>;
export type ScoredExamOutcomeState = Readonly<{
  version: 1;
  projection: ScoredExamOutcomeProjection;
  projectionDigest: string;
  adjudication: null | Readonly<{
    id: string;
    revision: string;
    operationId: string;
    projectionDigest: string;
    expectedPriorOutcomeId: string | null;
    policyDigest: string;
    bodyDigest: string;
    body: ScoredExamAdjudicationBody;
    current: boolean;
  }>;
  currentOutcome: null | Readonly<{
    id: string;
    revision: string;
    verdict: 'passed' | 'failed';
    totalPoints: number;
    codingPoints: number;
    projectionDigest: string;
    adjudicationId: string;
    resultDigest: string;
    implementationDigest: string;
    current: boolean;
  }>;
}>;
export type ScoredExamOutcomeDenial = 'invalid_input' | 'forbidden' | 'unavailable' | 'conflict';
export type ScoredExamAdjudicationReceipt = Readonly<{
  id: string;
  attemptId: string;
  operationId: string;
  revision: string;
  projectionDigest: string;
  policyDigest: string;
  bodyDigest: string;
}>;
export type ScoredExamOutcomeReceipt = Readonly<{
  id: string;
  attemptId: string;
  operationId: string;
  revision: string;
  adjudicationId: string;
  projectionDigest: string;
  resultDigest: string;
  verdict: 'passed' | 'failed';
  totalPoints: number;
  codingPoints: number;
}>;
export class ScoredExamOutcomeError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'forbidden' | 'outcome_unknown') {
    super('SCORED_EXAM_OUTCOME_' + code.toUpperCase());
  }
}
const fail = (code: ScoredExamOutcomeError['code'] = 'invalid_input'): never => {
  throw new ScoredExamOutcomeError(code);
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const d = Object.getOwnPropertyDescriptors(value),
    names = Reflect.ownKeys(d);
  if (
    names.length !== keys.length ||
    !keys.every((k) => Object.hasOwn(d, k) && Object.hasOwn(d[k]!, 'value'))
  )
    return fail();
  return Object.fromEntries(keys.map((k) => [k, d[k]!.value]));
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return fail();
  const d = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(d).length !== value.length + 1 ||
    !Array.from({ length: value.length }, (_, i) => String(i)).every(
      (k) => Object.hasOwn(d, k) && Object.hasOwn(d[k]!, 'value'),
    )
  )
    return fail();
  return Array.from({ length: value.length }, (_, i) => d[String(i)]!.value);
}
function id(v: unknown): string {
  if (typeof v !== 'string' || !uuid.test(v)) return fail();
  return v;
}
function sha(v: unknown): string {
  if (typeof v !== 'string' || !hash.test(v)) return fail();
  return v;
}
function nullableId(v: unknown): string | null {
  return v === null ? null : id(v);
}
function decimal(v: unknown, positive = false): string {
  if (
    typeof v !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(v) ||
    BigInt(v) > 9223372036854775807n ||
    (positive && v === '0')
  )
    return fail();
  return v;
}
function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') return fail();
  return v;
}
function points(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max) return fail();
  return v;
}
function verdict(v: unknown): 'passed' | 'failed' {
  if (v !== 'passed' && v !== 'failed') return fail();
  return v;
}
function scope(v: unknown): ExamScope {
  const x = record(v, [
    'learnerId',
    'cohortId',
    'attemptId',
    'form',
    'definitionDigest',
    'rubricDigest',
  ]);
  if (typeof x.form !== 'string' || !['A', 'B', 'C', 'D'].includes(x.form)) return fail();
  return Object.freeze({
    learnerId: id(x.learnerId),
    cohortId: id(x.cohortId),
    attemptId: id(x.attemptId),
    form: x.form as ExamScope['form'],
    definitionDigest: sha(x.definitionDigest),
    rubricDigest: sha(x.rubricDigest),
  });
}
function canonical(v: unknown): string {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
  if (Array.isArray(v)) return '[' + array(v).map(canonical).join(',') + ']';
  if (
    v &&
    typeof v === 'object' &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
  ) {
    const d = Object.getOwnPropertyDescriptors(v),
      names = Reflect.ownKeys(d);
    if (names.some((k) => typeof k !== 'string' || !Object.hasOwn(d[k]!, 'value'))) return fail();
    return (
      '{' +
      (names as string[])
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(d[k]!.value))
        .join(',') +
      '}'
    );
  }
  return fail();
}
/** All supported projections contain ASCII keys, integer points, UUID/hash/decimal strings. */
export function scoredExamOutcomeDigest(
  value: unknown,
  domain:
    | '01coding-exam-outcome-projection'
    | '01coding-exam-adjudication-policy'
    | '01coding-exam-adjudication'
    | '01coding-exam-final-outcome',
) {
  return createHash('sha256')
    .update(domain + '\0v1\0' + canonical(value), 'utf8')
    .digest('hex');
}
function selection(v: unknown): readonly ExamSelectionIdentity[] {
  const items = array(v);
  if (items.length !== 8) return fail();
  return Object.freeze(
    items.map((item, index) => {
      const x = record(item, ['questionKey', 'submissionId']);
      if (x.questionKey !== 'q' + (index + 1)) return fail();
      return Object.freeze({
        questionKey: x.questionKey as ExamSelectionIdentity['questionKey'],
        submissionId: nullableId(x.submissionId),
      });
    }),
  );
}
function decision(v: unknown): ExamAdjudication {
  const x = record(v, [
    'selection',
    'priorFinalVerdict',
    'proposedVerdict',
    'disputed',
    'initialThresholdReview',
    'affectedSubmissionIds',
  ]);
  if (
    x.initialThresholdReview !== 'required' &&
    x.initialThresholdReview !== 'not_required' &&
    x.initialThresholdReview !== 'unresolved'
  )
    return fail();
  const affected = array(x.affectedSubmissionIds).map(id);
  if (new Set(affected).size !== affected.length) return fail();
  return Object.freeze({
    selection: selection(x.selection),
    priorFinalVerdict: x.priorFinalVerdict === null ? null : verdict(x.priorFinalVerdict),
    proposedVerdict: verdict(x.proposedVerdict),
    disputed: bool(x.disputed),
    initialThresholdReview: x.initialThresholdReview,
    affectedSubmissionIds: Object.freeze(affected),
  });
}
export function parseScoredExamAdjudicationPolicy(v: unknown): ScoredExamAdjudicationPolicy {
  const x = record(v, [
    'version',
    'attemptId',
    'snapshotDigest',
    'rubricDigest',
    'assignmentDigest',
    'projectionDigest',
    'initialThresholdReview',
    'disputed',
    'affectedSubmissionIds',
    'evidenceDigest',
  ]);
  if (
    x.version !== 1 ||
    (x.initialThresholdReview !== 'required' &&
      x.initialThresholdReview !== 'not_required' &&
      x.initialThresholdReview !== 'unresolved')
  )
    return fail();
  const affected = array(x.affectedSubmissionIds).map(id);
  if (new Set(affected).size !== affected.length) return fail();
  return Object.freeze({
    version: 1,
    attemptId: id(x.attemptId),
    snapshotDigest: sha(x.snapshotDigest),
    rubricDigest: sha(x.rubricDigest),
    assignmentDigest: sha(x.assignmentDigest),
    projectionDigest: sha(x.projectionDigest),
    initialThresholdReview: x.initialThresholdReview,
    disputed: bool(x.disputed),
    affectedSubmissionIds: Object.freeze(affected),
    evidenceDigest: sha(x.evidenceDigest),
  });
}
export function captureScoredExamAdjudicationBody(v: unknown): ScoredExamAdjudicationBody {
  const x = record(v, ['version', 'projectionDigest', 'priorOutcomeId', 'policy', 'decision']);
  if (x.version !== 1) return fail();
  const p = parseScoredExamAdjudicationPolicy(x.policy),
    d = decision(x.decision),
    projectionDigest = sha(x.projectionDigest);
  if (
    p.projectionDigest !== projectionDigest ||
    p.disputed !== d.disputed ||
    p.initialThresholdReview !== d.initialThresholdReview ||
    canonical(p.affectedSubmissionIds) !== canonical(d.affectedSubmissionIds)
  )
    return fail();
  return Object.freeze({
    version: 1,
    projectionDigest,
    priorOutcomeId: nullableId(x.priorOutcomeId),
    policy: p,
    decision: d,
  });
}
export function captureScoredExamFinalResult(v: unknown): ScoredExamFinalResult {
  const x = record(v, [
    'version',
    'adjudicationId',
    'projectionDigest',
    'selection',
    'questions',
    'totalPoints',
    'codingPoints',
    'verdict',
    'implementationDigest',
  ]);
  if (x.version !== 1) return fail();
  const chosen = selection(x.selection),
    questions = array(x.questions);
  if (questions.length !== 8) return fail();
  const parsed = questions.map((item, index) => {
    const q = record(item, ['questionKey', 'state', 'submissionId', 'answerSha256', 'points']);
    if (
      q.questionKey !== 'q' + (index + 1) ||
      !['scored', 'unsubmitted'].includes(q.state as string)
    )
      return fail();
    const submissionId = nullableId(q.submissionId),
      answerSha256 = q.answerSha256 === null ? null : sha(q.answerSha256),
      p = q.points === null ? null : points(q.points, index === 5 || index === 6 ? 5 : 15);
    if (
      chosen[index]!.submissionId !== submissionId ||
      (q.state === 'unsubmitted' &&
        (submissionId !== null || answerSha256 !== null || p !== null)) ||
      (q.state === 'scored' && (submissionId === null || answerSha256 === null || p === null))
    )
      return fail();
    return Object.freeze({
      questionKey: q.questionKey as ExamQuestionScore['questionKey'],
      state: q.state as 'scored' | 'unsubmitted',
      submissionId,
      answerSha256,
      points: p,
    });
  });
  const total = points(x.totalPoints, 100),
    coding = points(x.codingPoints, 75),
    result = verdict(x.verdict);
  if (
    parsed.reduce((s, q) => s + (q.points ?? 0), 0) !== total ||
    parsed.slice(0, 5).reduce((s, q) => s + (q.points ?? 0), 0) !== coding ||
    (result === 'passed') !== (total >= 60 && coding >= 45)
  )
    return fail();
  return Object.freeze({
    version: 1,
    adjudicationId: id(x.adjudicationId),
    projectionDigest: sha(x.projectionDigest),
    selection: chosen,
    questions: Object.freeze(parsed),
    totalPoints: total,
    codingPoints: coding,
    verdict: result,
    implementationDigest: sha(x.implementationDigest),
  });
}
function projection(v: unknown): ScoredExamOutcomeProjection {
  const x = record(v, [
    'version',
    'scope',
    'snapshotDigest',
    'assignmentDigest',
    'closure',
    'acceptances',
  ]);
  if (x.version !== 1) return fail();
  const s = scope(x.scope);
  let closure: ScoredExamOutcomeProjection['closure'] = null;
  if (x.closure !== null) {
    const c = record(x.closure, ['reason', 'closedAtMicros', 'closureOrdinal']);
    if (c.reason !== 'finished' && c.reason !== 'expired') return fail();
    closure = Object.freeze({
      reason: c.reason,
      closedAtMicros: decimal(c.closedAtMicros, true),
      closureOrdinal: decimal(c.closureOrdinal, true),
    });
  }
  const seen = new Set<string>();
  let last = 0n;
  const acceptances = array(x.acceptances).map((v): ScoredExamAcceptance => {
    const a = record(v, [
      'submissionId',
      'questionKey',
      'answerKind',
      'answerSha256',
      'acceptedAtMicros',
      'acceptedOrdinal',
      'revision',
    ]);
    const submissionId = id(a.submissionId),
      order = decimal(a.acceptedOrdinal, true);
    if (
      seen.has(submissionId) ||
      BigInt(order) <= last ||
      typeof a.questionKey !== 'string' ||
      !/^q[1-8]$/.test(a.questionKey) ||
      a.answerKind !==
        (a.questionKey === 'q8'
          ? 'debug_with_reason'
          : ['q6', 'q7'].includes(a.questionKey)
            ? 'trace_with_reason'
            : 'coding')
    )
      return fail();
    seen.add(submissionId);
    last = BigInt(order);
    if (closure && BigInt(order) >= BigInt(closure.closureOrdinal)) return fail();
    return Object.freeze({
      submissionId,
      questionKey: a.questionKey as ScoredExamAcceptance['questionKey'],
      answerKind: a.answerKind as ScoredExamAcceptance['answerKind'],
      answerSha256: sha(a.answerSha256),
      acceptedAtMicros: decimal(a.acceptedAtMicros, true),
      acceptedOrdinal: order,
      revision: decimal(a.revision),
    });
  });
  return Object.freeze({
    version: 1,
    scope: s,
    snapshotDigest: sha(x.snapshotDigest),
    assignmentDigest: sha(x.assignmentDigest),
    closure,
    acceptances: Object.freeze(acceptances),
  });
}
export function parseScoredExamOutcomeState(v: unknown, attemptId: string): ScoredExamOutcomeState {
  const x = record(v, [
    'version',
    'projection',
    'projectionDigest',
    'adjudication',
    'currentOutcome',
  ]);
  if (x.version !== 1) return fail();
  const p = projection(x.projection),
    d = sha(x.projectionDigest);
  if (
    p.scope.attemptId !== attemptId ||
    scoredExamOutcomeDigest(p, '01coding-exam-outcome-projection') !== d
  )
    return fail();
  let adjudication: ScoredExamOutcomeState['adjudication'] = null,
    currentOutcome: ScoredExamOutcomeState['currentOutcome'] = null;
  if (x.adjudication !== null) {
    const a = record(x.adjudication, [
        'id',
        'revision',
        'operationId',
        'projectionDigest',
        'expectedPriorOutcomeId',
        'policyDigest',
        'bodyDigest',
        'body',
        'current',
      ]),
      body = captureScoredExamAdjudicationBody(a.body);
    if (
      body.projectionDigest !== a.projectionDigest ||
      body.priorOutcomeId !== a.expectedPriorOutcomeId ||
      scoredExamOutcomeDigest(body, '01coding-exam-adjudication') !== a.bodyDigest ||
      scoredExamOutcomeDigest(body.policy, '01coding-exam-adjudication-policy') !== a.policyDigest
    )
      return fail();
    adjudication = Object.freeze({
      id: id(a.id),
      revision: decimal(a.revision, true),
      operationId: id(a.operationId),
      projectionDigest: sha(a.projectionDigest),
      expectedPriorOutcomeId: nullableId(a.expectedPriorOutcomeId),
      policyDigest: sha(a.policyDigest),
      bodyDigest: sha(a.bodyDigest),
      body,
      current: bool(a.current),
    });
  }
  if (x.currentOutcome !== null) {
    const o = record(x.currentOutcome, [
        'id',
        'revision',
        'verdict',
        'totalPoints',
        'codingPoints',
        'projectionDigest',
        'adjudicationId',
        'resultDigest',
        'implementationDigest',
        'current',
      ]),
      total = points(o.totalPoints, 100),
      coding = points(o.codingPoints, 75),
      result = verdict(o.verdict);
    if ((result === 'passed') !== (total >= 60 && coding >= 45)) return fail();
    currentOutcome = Object.freeze({
      id: id(o.id),
      revision: decimal(o.revision, true),
      verdict: result,
      totalPoints: total,
      codingPoints: coding,
      projectionDigest: sha(o.projectionDigest),
      adjudicationId: id(o.adjudicationId),
      resultDigest: sha(o.resultDigest),
      implementationDigest: sha(o.implementationDigest),
      current: bool(o.current),
    });
  }
  if (adjudication?.current && adjudication.projectionDigest !== d) return fail();
  if (
    currentOutcome?.current &&
    (currentOutcome.projectionDigest !== d || currentOutcome.adjudicationId !== adjudication?.id)
  )
    return fail();
  return Object.freeze({
    version: 1,
    projection: p,
    projectionDigest: d,
    adjudication,
    currentOutcome,
  });
}
const readiness = (applier: boolean) =>
  `SELECT current_setting('role')='none' AND current_user=session_user AND EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) AND NOT pg_has_role(current_user,'nextera_checkpoint_owner','USAGE') AND NOT pg_has_role(current_user,'nextera_checkpoint_owner','SET') AND ${applier ? "pg_has_role(current_user,'nextera_exam_evaluator','USAGE') AND NOT pg_has_role(current_user,'nextera_web','USAGE') AND NOT pg_has_role(current_user,'nextera_web','SET')" : "pg_has_role(current_user,'nextera_web','USAGE') AND NOT pg_has_role(current_user,'nextera_exam_evaluator','USAGE') AND NOT pg_has_role(current_user,'nextera_exam_evaluator','SET')"} AND NOT EXISTS(SELECT FROM (VALUES ${applier ? "('apply_scored_exam_outcome','uuid,uuid,uuid,uuid,text,jsonb,text','nextera_exam_evaluator')" : "('scored_exam_outcome_state','uuid,uuid','nextera_web'),('record_scored_exam_adjudication','uuid,uuid,uuid,uuid,jsonb,text','nextera_web')"}) req(name,args,grantee) WHERE NOT EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles o ON o.oid=p.proowner WHERE n.nspname='app' AND p.proname=req.name AND replace(oidvectortypes(p.proargtypes),' ','')=req.args AND p.prorettype='pg_catalog.jsonb'::regtype AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND o.rolname='nextera_checkpoint_owner' AND NOT o.rolcanlogin AND NOT o.rolsuper AND NOT o.rolcreatedb AND NOT o.rolcreaterole AND NOT o.rolreplication AND NOT o.rolbypassrls AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner AND (a.grantee=0 OR r.rolname IS DISTINCT FROM req.grantee OR a.privilege_type<>'EXECUTE' OR a.is_grantable)))) AND (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles o ON o.oid=c.relowner WHERE n.nspname='app' AND c.relname IN('exam_scoring_adjudications','exam_scoring_adjudication_heads','exam_scoring_final_outcomes','exam_scoring_outcome_heads','exam_scoring_outcome_logins') AND c.relrowsecurity AND o.rolname='nextera_checkpoint_owner' AND NOT pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE'))=5 AND NOT pg_catalog.has_column_privilege(current_user,'app.learner_node_progress','first_passing_scored_exam_outcome_id','UPDATE') AS ready`;
export const SCORED_EXAM_OUTCOME_WEB_READINESS_SQL = readiness(false);
export const SCORED_EXAM_OUTCOME_APPLIER_READINESS_SQL = readiness(true);
export const READ_SCORED_EXAM_OUTCOME_STATE_SQL =
  'SELECT app.scored_exam_outcome_state($1::uuid,$2::uuid) AS data';
export const RECORD_SCORED_EXAM_ADJUDICATION_SQL =
  'SELECT app.record_scored_exam_adjudication($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb,$6) AS data';
export const APPLY_SCORED_EXAM_OUTCOME_SQL =
  'SELECT app.apply_scored_exam_outcome($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::jsonb,$7) AS data';
async function ready(client: ScoredExamOutcomeClient, applier = false) {
  try {
    const rows = await client.unsafe(
      applier ? SCORED_EXAM_OUTCOME_APPLIER_READINESS_SQL : SCORED_EXAM_OUTCOME_WEB_READINESS_SQL,
    );
    return Array.isArray(rows) && rows.length === 1 && record(rows[0], ['ready']).ready === true;
  } catch {
    return false;
  }
}
export async function readScoredExamOutcomeState(
  client: ScoredExamOutcomeClient,
  authUserId: string,
  attemptId: string,
): Promise<ScoredExamOutcomeState> {
  const who = id(authUserId),
    attempt = id(attemptId);
  if (!(await ready(client))) return fail('unavailable');
  try {
    const rows = await client.unsafe(READ_SCORED_EXAM_OUTCOME_STATE_SQL, [who, attempt] as never[]);
    if (!Array.isArray(rows) || rows.length !== 1) return fail('unavailable');
    return parseScoredExamOutcomeState(record(rows[0], ['data']).data, attempt);
  } catch {
    return fail('unavailable');
  }
}
function denial(v: unknown): ScoredExamOutcomeDenial | null {
  if (
    typeof v === 'string' &&
    ['invalid_input', 'forbidden', 'unavailable', 'conflict'].includes(v)
  )
    return v as ScoredExamOutcomeDenial;
  return null;
}
export async function recordScoredExamAdjudication(
  client: ScoredExamOutcomeClient,
  input: Readonly<{
    authUserId: string;
    attemptId: string;
    operationId: string;
    expectedAdjudicationId: string | null;
    body: ScoredExamAdjudicationBody;
  }>,
): Promise<
  | Readonly<{ kind: ScoredExamOutcomeDenial }>
  | Readonly<{ kind: 'accepted'; receipt: ScoredExamAdjudicationReceipt; replayed: boolean }>
> {
  const captured = record(input, [
    'authUserId',
    'attemptId',
    'operationId',
    'expectedAdjudicationId',
    'body',
  ]);
  const who = id(captured.authUserId),
    attempt = id(captured.attemptId),
    operation = id(captured.operationId),
    expected = nullableId(captured.expectedAdjudicationId),
    body = captureScoredExamAdjudicationBody(captured.body),
    bodyDigest = scoredExamOutcomeDigest(body, '01coding-exam-adjudication'),
    policyDigest = scoredExamOutcomeDigest(body.policy, '01coding-exam-adjudication-policy');
  if (body.policy.attemptId !== attempt) return fail();
  if (!(await ready(client))) return { kind: 'unavailable' };
  let rows: unknown;
  try {
    rows = await client.unsafe(RECORD_SCORED_EXAM_ADJUDICATION_SQL, [
      who,
      operation,
      attempt,
      expected,
      JSON.stringify(body),
      bodyDigest,
    ] as never[]);
  } catch {
    return fail('outcome_unknown');
  }
  try {
    if (!Array.isArray(rows) || rows.length !== 1) return fail();
    const raw = record(rows[0], ['data']).data;
    if (!raw || typeof raw !== 'object') return fail();
    const kind = Object.getOwnPropertyDescriptor(raw, 'kind')?.value,
      denied = denial(kind);
    if (denied) {
      record(raw, ['kind']);
      return { kind: denied };
    }
    const accepted = record(raw, ['kind', 'receipt', 'replayed']),
      r = record(accepted.receipt, [
        'id',
        'attemptId',
        'operationId',
        'revision',
        'projectionDigest',
        'policyDigest',
        'bodyDigest',
      ]);
    if (
      kind !== 'accepted' ||
      r.attemptId !== attempt ||
      r.operationId !== operation ||
      r.projectionDigest !== body.projectionDigest ||
      r.policyDigest !== policyDigest ||
      r.bodyDigest !== bodyDigest
    )
      return fail();
    return Object.freeze({
      kind: 'accepted',
      receipt: Object.freeze({
        id: id(r.id),
        attemptId: attempt,
        operationId: operation,
        revision: decimal(r.revision, true),
        projectionDigest: body.projectionDigest,
        policyDigest,
        bodyDigest,
      }),
      replayed: bool(accepted.replayed),
    });
  } catch {
    return fail('outcome_unknown');
  }
}
export async function applyScoredExamOutcome(
  client: ScoredExamOutcomeClient,
  input: Readonly<{
    attemptId: string;
    operationId: string;
    adjudicationId: string;
    expectedOutcomeId: string | null;
    implementationDigest: string;
    result: ScoredExamFinalResult;
  }>,
): Promise<
  | Readonly<{ kind: ScoredExamOutcomeDenial }>
  | Readonly<{ kind: 'accepted'; receipt: ScoredExamOutcomeReceipt; replayed: boolean }>
> {
  const captured = record(input, [
    'attemptId',
    'operationId',
    'adjudicationId',
    'expectedOutcomeId',
    'implementationDigest',
    'result',
  ]);
  const attempt = id(captured.attemptId),
    operation = id(captured.operationId),
    adjudication = id(captured.adjudicationId),
    expected = nullableId(captured.expectedOutcomeId),
    implementation = sha(captured.implementationDigest),
    result = captureScoredExamFinalResult(captured.result),
    resultDigest = scoredExamOutcomeDigest(result, '01coding-exam-final-outcome');
  if (result.adjudicationId !== adjudication || result.implementationDigest !== implementation)
    return fail();
  if (!(await ready(client, true))) return { kind: 'unavailable' };
  let rows: unknown;
  try {
    rows = await client.unsafe(APPLY_SCORED_EXAM_OUTCOME_SQL, [
      operation,
      attempt,
      adjudication,
      expected,
      implementation,
      JSON.stringify(result),
      resultDigest,
    ] as never[]);
  } catch {
    return fail('outcome_unknown');
  }
  try {
    if (!Array.isArray(rows) || rows.length !== 1) return fail();
    const raw = record(rows[0], ['data']).data;
    if (!raw || typeof raw !== 'object') return fail();
    const kind = Object.getOwnPropertyDescriptor(raw, 'kind')?.value,
      denied = denial(kind);
    if (denied) {
      record(raw, ['kind']);
      return { kind: denied };
    }
    const accepted = record(raw, ['kind', 'receipt', 'replayed']),
      r = record(accepted.receipt, [
        'id',
        'attemptId',
        'operationId',
        'revision',
        'adjudicationId',
        'projectionDigest',
        'resultDigest',
        'verdict',
        'totalPoints',
        'codingPoints',
      ]);
    if (
      kind !== 'accepted' ||
      r.attemptId !== attempt ||
      r.operationId !== operation ||
      r.adjudicationId !== adjudication ||
      r.projectionDigest !== result.projectionDigest ||
      r.resultDigest !== resultDigest ||
      r.verdict !== result.verdict ||
      r.totalPoints !== result.totalPoints ||
      r.codingPoints !== result.codingPoints
    )
      return fail();
    return Object.freeze({
      kind: 'accepted',
      receipt: Object.freeze({
        id: id(r.id),
        attemptId: attempt,
        operationId: operation,
        revision: decimal(r.revision, true),
        adjudicationId: adjudication,
        projectionDigest: result.projectionDigest,
        resultDigest,
        verdict: result.verdict,
        totalPoints: result.totalPoints,
        codingPoints: result.codingPoints,
      }),
      replayed: bool(accepted.replayed),
    });
  } catch {
    return fail('outcome_unknown');
  }
}
