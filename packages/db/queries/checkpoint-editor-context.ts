import { sql } from 'drizzle-orm';
import { isRequestId } from '@nextera/domain';
import type { OperationalDatabase } from '../operations/curriculum';

export class CheckpointEditorContextError extends Error {
  constructor(readonly code: 'forbidden' | 'unavailable') {
    super('CHECKPOINT_EDITOR_' + code.toUpperCase());
  }
}
export type ScoredExamContextMarker = Readonly<{
  version: 1;
  form: 'A' | 'B' | 'C' | 'D';
  rubricDigest: string;
}>;
export function parseScoredExamContextMarker(raw: unknown): ScoredExamContextMarker {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== 3 ||
    !['version', 'form', 'rubricDigest'].every(
      (k) => Object.hasOwn(descriptors, k) && Object.hasOwn(descriptors[k]!, 'value'),
    )
  )
    fail();
  const version = descriptors.version!.value;
  const form = descriptors.form!.value;
  const rubricDigest = descriptors.rubricDigest!.value;
  if (
    version !== 1 ||
    !['A', 'B', 'C', 'D'].includes(form) ||
    typeof rubricDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(rubricDigest)
  )
    fail();
  return Object.freeze({ version: 1, form, rubricDigest });
}
export type CheckpointOfficialContext = Readonly<{
  scope: Readonly<{
    learnerId: string;
    cohortId: string;
    attemptId: string;
    taskKey: string;
    definitionDigest: string;
  }>;
  readAllowed: true;
  status: 'active' | 'closed';
  serverNow: string;
  deadline: string;
  sourceBytes: number;
  filename: string;
  submitAllowed: boolean;
  scoredExam?: ScoredExamContextMarker;
}>;

/** Attestation for the exact new read-only function; not proof of a live rehearsal. */
export const CHECKPOINT_EDITOR_CONTEXT_READINESS_SQL = `SELECT
 EXISTS(SELECT FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
 WHERE n.nspname='app' AND p.proname='checkpoint_editor_context'
 AND replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')='uuid,uuid,text'
 AND p.prorettype='pg_catalog.jsonb'::regtype AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']
 AND o.rolname='nextera_checkpoint_owner' AND NOT o.rolcanlogin AND NOT o.rolsuper AND NOT o.rolbypassrls AND NOT o.rolcreatedb AND NOT o.rolcreaterole AND NOT o.rolreplication
 AND pg_catalog.has_function_privilege('nextera_web',p.oid,'EXECUTE')
 AND NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner AND (a.grantee=0 OR a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='nextera_web') OR a.is_grantable))) AS contract,
 EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname=current_user AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication)
 AND pg_catalog.pg_has_role(current_user,'nextera_web','USAGE')
 AND NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','USAGE')
 AND NOT pg_catalog.pg_has_role(current_user,'nextera_checkpoint_owner','SET') AS caller_isolation`;

function fail(code: 'forbidden' | 'unavailable' = 'unavailable'): never {
  throw new CheckpointEditorContextError(code);
}
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail();
  return raw as Record<string, unknown>;
}
export async function checkpointEditorContextReady(db: OperationalDatabase): Promise<boolean> {
  try {
    const [row] = await db.execute(sql.raw(CHECKPOINT_EDITOR_CONTEXT_READINESS_SQL));
    return row?.contract === true && row.caller_isolation === true;
  } catch {
    return false;
  }
}
/** Never falls back to direct table SELECT, another principal, or a client-supplied definition. */
export async function readCheckpointEditorContext(
  db: OperationalDatabase,
  authId: string,
  attemptId: string,
  taskKey: string,
): Promise<CheckpointOfficialContext> {
  if (!isRequestId(authId) || !isRequestId(attemptId) || !/^[a-z0-9-]{1,100}$/.test(taskKey))
    fail('forbidden');
  if (!(await checkpointEditorContextReady(db))) fail();
  let row: Record<string, unknown> | undefined;
  try {
    [row] = await db.execute(
      sql`SELECT app.checkpoint_editor_context(${authId}::uuid,${attemptId}::uuid,${taskKey}) AS data`,
    );
  } catch (error) {
    let next = error;
    for (let i = 0; i < 5 && next && typeof next === 'object'; i++) {
      if ('code' in next && next.code === '42501') fail('forbidden');
      next = 'cause' in next ? next.cause : null;
    }
    fail();
  }
  const value = object(row?.data),
    scope = object(value.scope);
  if (
    typeof scope.learnerId !== 'string' ||
    !isRequestId(scope.learnerId) ||
    typeof scope.cohortId !== 'string' ||
    !isRequestId(scope.cohortId) ||
    scope.attemptId !== attemptId ||
    scope.taskKey !== taskKey ||
    typeof scope.definitionDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(scope.definitionDigest) ||
    value.readAllowed !== true ||
    !['active', 'closed'].includes(String(value.status)) ||
    typeof value.serverNow !== 'string' ||
    !Number.isFinite(Date.parse(value.serverNow)) ||
    typeof value.deadline !== 'string' ||
    !Number.isFinite(Date.parse(value.deadline)) ||
    !Number.isSafeInteger(value.sourceBytes) ||
    Number(value.sourceBytes) < 1 ||
    Number(value.sourceBytes) > 262144 ||
    typeof value.filename !== 'string' ||
    !/^[A-Za-z0-9_]+\.go$/.test(value.filename) ||
    typeof value.submitAllowed !== 'boolean' ||
    (value.submitAllowed &&
      (value.status !== 'active' || Date.parse(value.serverNow) >= Date.parse(value.deadline)))
  )
    fail();
  const scoredExam = Object.hasOwn(value, 'scoredExam')
    ? parseScoredExamContextMarker(value.scoredExam)
    : undefined;
  if (scoredExam && !/^q[1-5]$/.test(taskKey)) fail();
  return Object.freeze({
    ...(scoredExam ? { scoredExam } : {}),
    scope: Object.freeze({
      learnerId: scope.learnerId as string,
      cohortId: scope.cohortId as string,
      attemptId,
      taskKey,
      definitionDigest: scope.definitionDigest,
    }),
    readAllowed: true,
    status: value.status as 'active' | 'closed',
    serverNow: value.serverNow,
    deadline: value.deadline,
    sourceBytes: Number(value.sourceBytes),
    filename: value.filename,
    submitAllowed: value.submitAllowed,
  });
}
