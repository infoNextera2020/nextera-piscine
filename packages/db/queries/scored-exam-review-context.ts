import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Sql } from 'postgres';
import {
  scoreExamAttempt,
  validateExamScoringRubric,
  type ExamAttempt,
  type ExamCompletionReceipt,
  type ExamQuestionKey,
  type ExamAnswerKind,
  type ExamReviewerAssignment,
  type ExamScoringRubric,
  type ExamScope,
} from '@nextera/domain';

export type ScoredExamReviewClient = Pick<Sql, 'unsafe'>;
export type ScoredExamAcceptance = Readonly<{
  submissionId: string;
  questionKey: ExamQuestionKey;
  answerKind: ExamAnswerKind;
  answerSha256: string;
  acceptedAtMicros: string;
  acceptedOrdinal: string;
  revision: string;
}>;
export type ScoredExamReviewContext = Readonly<{
  version: 1;
  authUserId: string;
  actorUserId: string;
  access: 'learner' | 'assigned_mentor';
  attempt: ExamAttempt;
  snapshotDigest: string;
  rubric: ExamScoringRubric;
  assignment: ExamReviewerAssignment;
  completion: ExamCompletionReceipt | null;
  serverNowMicros: string;
  acceptances: readonly ScoredExamAcceptance[];
  /** No persisted adjudication exists yet. Absence never grants finalization. */
  adjudication: null;
}>;
export class ScoredExamReviewContextError extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'forbidden') {
    super('SCORED_EXAM_REVIEW_CONTEXT_' + code.toUpperCase());
  }
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
function fail(code: 'invalid_input' | 'unavailable' | 'forbidden' = 'unavailable'): never {
  throw new ScoredExamReviewContextError(code);
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const d = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(d).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(d, key) && Object.hasOwn(d[key]!, 'value'))
  )
    return fail();
  return Object.fromEntries(keys.map((key) => [key, d[key]!.value]));
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return fail();
  const d = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(d).length !== value.length + 1 ||
    !Array.from({ length: value.length }, (_, i) => String(i)).every(
      (key) => Object.hasOwn(d, key) && Object.hasOwn(d[key]!, 'value'),
    )
  )
    return fail();
  return Array.from({ length: value.length }, (_, i) => d[String(i)]!.value);
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) return fail();
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !sha.test(value)) return fail();
  return value;
}
function decimal(value: unknown, positive = false): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
    BigInt(value) > 9223372036854775807n ||
    (positive && value === '0')
  )
    return fail();
  return value;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 13) return fail();
  return Number(value);
}
function scope(value: unknown): ExamScope {
  const s = record(value, [
    'learnerId',
    'cohortId',
    'attemptId',
    'form',
    'definitionDigest',
    'rubricDigest',
  ]);
  if (typeof s.form !== 'string' || !['A', 'B', 'C', 'D'].includes(s.form)) return fail();
  return Object.freeze({
    learnerId: id(s.learnerId),
    cohortId: id(s.cohortId),
    attemptId: id(s.attemptId),
    form: s.form as ExamScope['form'],
    definitionDigest: digest(s.definitionDigest),
    rubricDigest: digest(s.rubricDigest),
  });
}
function equalScope(a: ExamScope, b: ExamScope) {
  return Object.keys(a).every((key) => a[key as keyof ExamScope] === b[key as keyof ExamScope]);
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(object)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(object[k]))
      .join(',') +
    '}'
  );
}
function framedDigest(value: unknown, domain: string) {
  return createHash('sha256')
    .update(domain + '\0v1\0' + canonical(value), 'utf8')
    .digest('hex');
}
function rubric(value: unknown): ExamScoringRubric {
  const r = record(value, ['version', 'form', 'definitionDigest', 'digest', 'questions']);
  if (r.version !== 1 || typeof r.form !== 'string' || !['A', 'B', 'C', 'D'].includes(r.form))
    return fail();
  const questions = array(r.questions).map((raw) => {
    const q = record(raw, [
      'questionKey',
      'kind',
      'publishedCriteriaDigest',
      'groupBasis',
      'functionalGroups',
    ]);
    if (
      typeof q.questionKey !== 'string' ||
      !/^q[1-8]$/.test(q.questionKey) ||
      typeof q.kind !== 'string' ||
      !['coding', 'trace_with_reason', 'debug_with_reason'].includes(q.kind) ||
      q.groupBasis !== 'fixed_semantic'
    )
      return fail();
    return Object.freeze({
      questionKey: q.questionKey as ExamQuestionKey,
      kind: q.kind as ExamAnswerKind,
      publishedCriteriaDigest: digest(q.publishedCriteriaDigest),
      groupBasis: 'fixed_semantic' as const,
      functionalGroups: Object.freeze(
        array(q.functionalGroups).map((rawGroup) => {
          const g = record(rawGroup, ['key', 'points', 'criteriaDigest']);
          if (typeof g.key !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(g.key)) return fail();
          return Object.freeze({
            key: g.key,
            points: integer(g.points),
            criteriaDigest: digest(g.criteriaDigest),
          });
        }),
      ),
    });
  });
  const result: ExamScoringRubric = Object.freeze({
    version: 1,
    form: r.form as ExamScope['form'],
    definitionDigest: digest(r.definitionDigest),
    digest: digest(r.digest),
    questions: Object.freeze(questions),
  });
  validateExamScoringRubric(result);
  const { digest: expected, ...body } = result;
  if (framedDigest(body, '01coding-exam-scoring-rubric') !== expected) return fail();
  return result;
}
export const READ_SCORED_EXAM_REVIEW_CONTEXT_SQL =
  'SELECT app.scored_exam_review_context($1::uuid,$2::uuid) AS data';

/** Native catalog proof only. This never grants, changes a role or reports a secret. */
export const SCORED_EXAM_REVIEW_WRITE_CAPABILITY_SQL = `SELECT (
 current_user=session_user AND current_setting('role')='none'
 AND EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolcanlogin
 AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 AND pg_has_role(session_user,'nextera_web','USAGE')
 AND NOT pg_has_role(session_user,'nextera_checkpoint_owner','USAGE')
 AND NOT pg_has_role(session_user,'nextera_checkpoint_owner','SET')
 AND NOT pg_has_role(session_user,'nextera_exam_evaluator','USAGE')
 AND NOT pg_has_role(session_user,'nextera_exam_evaluator','SET')
 AND EXISTS(SELECT FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
 WHERE p.oid='app.record_exam_scoring_event(uuid,uuid,uuid,bigint,text,jsonb,text)'::regprocedure
 AND owner.rolname='nextera_checkpoint_owner' AND NOT owner.rolcanlogin AND NOT owner.rolsuper
 AND NOT owner.rolcreatedb AND NOT owner.rolcreaterole AND NOT owner.rolreplication AND NOT owner.rolbypassrls
 AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
 LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
 WHERE acl.grantee<>p.proowner AND (grantee.rolname IS NULL
 OR grantee.rolname NOT IN('nextera_web','nextera_exam_evaluator') OR acl.privilege_type<>'EXECUTE' OR acl.is_grantable))
 AND (SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
 JOIN pg_roles grantee ON grantee.oid=acl.grantee WHERE acl.grantee<>p.proowner
 AND grantee.rolname IN('nextera_web','nextera_exam_evaluator') AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable)=2)
 AND has_function_privilege(session_user,'app.record_exam_scoring_event(uuid,uuid,uuid,bigint,text,jsonb,text)','EXECUTE')
) AS permitted`;
export async function verifyScoredExamReviewWriteCapability(
  client: ScoredExamReviewClient,
): Promise<void> {
  try {
    const rows = await client.unsafe(SCORED_EXAM_REVIEW_WRITE_CAPABILITY_SQL);
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      record(rows[0], ['permitted']).permitted !== true
    )
      return fail();
  } catch {
    return fail();
  }
}

export type ScoredExamReviewAnswer = Readonly<{
  version: 1;
  authUserId: string;
  actorUserId: string;
  ownerAuthUserId: string;
  attemptId: string;
  submissionId: string;
  requestId: string;
  learnerId: string;
  cohortId: string;
  questionKey: ExamQuestionKey;
  answerKind: ExamAnswerKind;
  definitionDigest: string;
  snapshotDigest: string;
  rubricDigest: string;
  answerSha256: string;
  byteLength: number;
  source:
    | Readonly<{
        kind: 'stored_source';
        bucket: 'nextera-submissions';
        objectKey: string;
        filename: string;
      }>
    | Readonly<{
        kind: 'structured_payload';
        payloadBase64: string;
        answerContract: Readonly<{
          version: 1;
          kind: 'trace_with_reason' | 'debug_with_reason';
          maxBytes: number;
          digest: string;
        }>;
      }>;
}>;
export const READ_SCORED_EXAM_REVIEW_ANSWER_SQL =
  'SELECT app.scored_exam_review_answer($1::uuid,$2::uuid,$3::uuid) AS data';
export async function readScoredExamReviewAnswer(
  client: ScoredExamReviewClient,
  authUserId: string,
  attemptId: string,
  submissionId: string,
): Promise<ScoredExamReviewAnswer> {
  if (![authUserId, attemptId, submissionId].every((v) => typeof v === 'string' && uuid.test(v)))
    return fail('invalid_input');
  try {
    const rows = await client.unsafe(READ_SCORED_EXAM_REVIEW_ANSWER_SQL, [
      authUserId,
      attemptId,
      submissionId,
    ] as never[]);
    if (!Array.isArray(rows) || rows.length !== 1) return fail();
    const r = record(record(rows[0], ['data']).data, [
      'version',
      'authUserId',
      'actorUserId',
      'ownerAuthUserId',
      'attemptId',
      'submissionId',
      'requestId',
      'learnerId',
      'cohortId',
      'questionKey',
      'answerKind',
      'definitionDigest',
      'snapshotDigest',
      'rubricDigest',
      'answerSha256',
      'byteLength',
      'source',
    ]);
    if (
      r.version !== 1 ||
      r.authUserId !== authUserId ||
      r.attemptId !== attemptId ||
      r.submissionId !== submissionId ||
      typeof r.questionKey !== 'string' ||
      !/^q[1-8]$/.test(r.questionKey) ||
      r.answerKind !==
        (r.questionKey === 'q8'
          ? 'debug_with_reason'
          : ['q6', 'q7'].includes(r.questionKey)
            ? 'trace_with_reason'
            : 'coding') ||
      typeof r.byteLength !== 'number' ||
      !Number.isSafeInteger(r.byteLength) ||
      r.byteLength < 1 ||
      r.byteLength > 262144
    )
      return fail();
    const owner = id(r.ownerAuthUserId),
      cohort = id(r.cohortId),
      request = id(r.requestId),
      answerSha = digest(r.answerSha256);
    let source: ScoredExamReviewAnswer['source'];
    if (r.answerKind === 'coding') {
      const s = record(r.source, ['kind', 'bucket', 'objectKey', 'filename']);
      if (
        s.kind !== 'stored_source' ||
        s.bucket !== 'nextera-submissions' ||
        (s.objectKey !== `${owner}/${cohort}/${request}/${answerSha}` &&
          s.objectKey !==
            `${owner}/${cohort}/scored-exam-v1/${attemptId}/${r.questionKey}/${request}/${answerSha}`) ||
        typeof s.filename !== 'string' ||
        !/^[A-Za-z0-9_][A-Za-z0-9_]*[.]go$/.test(s.filename) ||
        s.filename.length > 100
      )
        return fail();
      source = Object.freeze({
        kind: 'stored_source',
        bucket: 'nextera-submissions',
        objectKey: s.objectKey as string,
        filename: s.filename,
      });
    } else {
      const s = record(r.source, ['kind', 'payloadBase64', 'answerContract']),
        c = record(s.answerContract, ['version', 'kind', 'maxBytes', 'digest']);
      if (
        s.kind !== 'structured_payload' ||
        typeof s.payloadBase64 !== 'string' ||
        c.version !== 1 ||
        c.kind !== r.answerKind ||
        typeof c.maxBytes !== 'number' ||
        !Number.isSafeInteger(c.maxBytes) ||
        c.maxBytes < r.byteLength ||
        c.maxBytes > 262144 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(s.payloadBase64)
      )
        return fail();
      const bytes = Buffer.from(s.payloadBase64, 'base64');
      const contractDigest = createHash('sha256')
        .update(
          [
            '01coding-checkpoint-answer-contract-v1',
            id(r.learnerId),
            cohort,
            attemptId,
            r.questionKey,
            digest(r.definitionDigest),
            '1',
            c.kind as string,
            String(c.maxBytes),
          ].join('\n'),
          'utf8',
        )
        .digest('hex');
      if (
        bytes.toString('base64') !== s.payloadBase64 ||
        bytes.byteLength !== r.byteLength ||
        createHash('sha256').update(bytes).digest('hex') !== answerSha ||
        c.digest !== contractDigest
      )
        return fail();
      source = Object.freeze({
        kind: 'structured_payload',
        payloadBase64: s.payloadBase64,
        answerContract: Object.freeze({
          version: 1 as const,
          kind: r.answerKind as 'trace_with_reason' | 'debug_with_reason',
          maxBytes: c.maxBytes,
          digest: contractDigest,
        }),
      });
    }
    const actor = id(r.actorUserId),
      learner = id(r.learnerId);
    if (actor === learner) return fail();
    return Object.freeze({
      version: 1,
      authUserId,
      actorUserId: actor,
      ownerAuthUserId: owner,
      attemptId,
      submissionId,
      requestId: request,
      learnerId: learner,
      cohortId: cohort,
      questionKey: r.questionKey as ExamQuestionKey,
      answerKind: r.answerKind as ExamAnswerKind,
      definitionDigest: digest(r.definitionDigest),
      snapshotDigest: digest(r.snapshotDigest),
      rubricDigest: digest(r.rubricDigest),
      answerSha256: answerSha,
      byteLength: r.byteLength,
      source,
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      Object.getOwnPropertyDescriptor(error, 'code')?.value === '42501'
    )
      return fail('forbidden');
    return fail();
  }
}

/** Existing configured web client only. Database authorization precedes any projection. */
export async function readScoredExamReviewContext(
  client: ScoredExamReviewClient,
  authUserId: string,
  attemptId: string,
): Promise<ScoredExamReviewContext> {
  if (
    typeof authUserId !== 'string' ||
    typeof attemptId !== 'string' ||
    !uuid.test(authUserId) ||
    !uuid.test(attemptId)
  )
    return fail('invalid_input');
  try {
    const rows = await client.unsafe(READ_SCORED_EXAM_REVIEW_CONTEXT_SQL, [
      authUserId,
      attemptId,
    ] as never[]);
    if (!Array.isArray(rows) || rows.length !== 1) return fail();
    const r = record(record(rows[0], ['data']).data, [
      'version',
      'authUserId',
      'actorUserId',
      'access',
      'attempt',
      'snapshotDigest',
      'rubric',
      'assignment',
      'completion',
      'serverNowMicros',
      'acceptances',
      'adjudication',
    ]);
    if (
      r.version !== 1 ||
      r.authUserId !== authUserId ||
      r.adjudication !== null ||
      typeof r.access !== 'string' ||
      !['learner', 'assigned_mentor'].includes(r.access)
    )
      return fail();
    const a = record(r.attempt, [
      'scope',
      'assignedAttemptNumber',
      'openedAtMicros',
      'deadlineAtMicros',
    ]);
    const attemptScope = scope(a.scope);
    if (attemptScope.attemptId !== attemptId || a.assignedAttemptNumber !== 1) return fail();
    const attempt: ExamAttempt = Object.freeze({
      scope: attemptScope,
      assignedAttemptNumber: 1,
      openedAtMicros: decimal(a.openedAtMicros, true),
      deadlineAtMicros: decimal(a.deadlineAtMicros, true),
    });
    const frozenRubric = rubric(r.rubric);
    if (
      frozenRubric.form !== attemptScope.form ||
      frozenRubric.definitionDigest !== attemptScope.definitionDigest ||
      frozenRubric.digest !== attemptScope.rubricDigest
    )
      return fail();
    const ar = record(r.assignment, ['scope', 'digest', 'primaryMentorId', 'eligibleMentorIds']);
    const assignmentScope = scope(ar.scope),
      mentors = array(ar.eligibleMentorIds).map(id),
      primary = id(ar.primaryMentorId);
    if (
      !equalScope(assignmentScope, attemptScope) ||
      mentors.length !== 2 ||
      mentors[0] !== primary ||
      mentors[1] === primary
    )
      return fail();
    const assignment: ExamReviewerAssignment = Object.freeze({
      scope: assignmentScope,
      digest: digest(ar.digest),
      primaryMentorId: primary,
      eligibleMentorIds: Object.freeze(mentors),
    });
    if (
      framedDigest(
        {
          version: 1,
          attemptId,
          learnerId: attemptScope.learnerId,
          cohortId: attemptScope.cohortId,
          definitionDigest: attemptScope.definitionDigest,
          rubricDigest: attemptScope.rubricDigest,
          primaryMentorId: primary,
          secondaryMentorId: mentors[1],
        },
        '01coding-exam-scoring-assignment',
      ) !== assignment.digest
    )
      return fail();
    const actor = id(r.actorUserId);
    if (
      (r.access === 'learner' && actor !== attemptScope.learnerId) ||
      (r.access === 'assigned_mentor' &&
        (actor === attemptScope.learnerId || !mentors.includes(actor)))
    )
      return fail();
    let completion: ExamCompletionReceipt | null = null;
    if (r.completion !== null) {
      const c = record(r.completion, ['id', 'scope', 'completedAtMicros', 'closureOrdinal']);
      const completionScope = scope(c.scope);
      if (!equalScope(completionScope, attemptScope)) return fail();
      completion = Object.freeze({
        id: id(c.id),
        scope: completionScope,
        completedAtMicros: decimal(c.completedAtMicros, true),
        closureOrdinal: decimal(c.closureOrdinal, true),
      });
    }
    const now = decimal(r.serverNowMicros, true);
    const ids = new Set<string>(),
      ordinals = new Set<string>();
    const acceptances = array(r.acceptances).map((raw): ScoredExamAcceptance => {
      const x = record(raw, [
        'submissionId',
        'questionKey',
        'answerKind',
        'answerSha256',
        'acceptedAtMicros',
        'acceptedOrdinal',
        'revision',
      ]);
      const submissionId = id(x.submissionId),
        ordinal = decimal(x.acceptedOrdinal, true),
        accepted = decimal(x.acceptedAtMicros, true);
      if (
        typeof x.questionKey !== 'string' ||
        !/^q[1-8]$/.test(x.questionKey) ||
        ids.has(submissionId) ||
        ordinals.has(ordinal) ||
        x.answerKind !==
          (x.questionKey === 'q8'
            ? 'debug_with_reason'
            : ['q6', 'q7'].includes(x.questionKey)
              ? 'trace_with_reason'
              : 'coding') ||
        BigInt(accepted) < BigInt(attempt.openedAtMicros) ||
        BigInt(accepted) >= BigInt(attempt.deadlineAtMicros) ||
        BigInt(accepted) > BigInt(now) ||
        (completion &&
          (BigInt(ordinal) >= BigInt(completion.closureOrdinal) ||
            BigInt(accepted) > BigInt(completion.completedAtMicros)))
      )
        return fail();
      ids.add(submissionId);
      ordinals.add(ordinal);
      return Object.freeze({
        submissionId,
        questionKey: x.questionKey as ExamQuestionKey,
        answerKind: x.answerKind as ExamAnswerKind,
        answerSha256: digest(x.answerSha256),
        acceptedAtMicros: accepted,
        acceptedOrdinal: ordinal,
        revision: decimal(x.revision),
      });
    });
    // Reuse the approved pure policy to validate duration, clock, assignment and closure.
    scoreExamAttempt({
      attempt,
      rubric: frozenRubric,
      assignment,
      submissions: [],
      completion,
      serverNowMicros: now,
      adjudication: null,
    });
    return Object.freeze({
      version: 1,
      authUserId,
      actorUserId: actor,
      access: r.access as ScoredExamReviewContext['access'],
      attempt,
      snapshotDigest: digest(r.snapshotDigest),
      rubric: frozenRubric,
      assignment,
      completion,
      serverNowMicros: now,
      acceptances: Object.freeze(acceptances),
      adjudication: null,
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      Object.getOwnPropertyDescriptor(error, 'code')?.value === '42501'
    )
      return fail('forbidden');
    return fail();
  }
}
