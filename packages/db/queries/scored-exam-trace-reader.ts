import type { Sql } from 'postgres';
import { captureScoredExamTraceReaderResult } from '../operations/scored-exam-trace';

export const SCORED_EXAM_TRACE_READER_BODY_SHA256 =
  '3f2236d9f2c1c10a1904dbe82c16f83bf50a940cf3a618953f02667995e4afe1';
export const SCORED_EXAM_TRACE_BINDING_VALIDATOR_BODY_SHA256 =
  '66bef21e55436ebf378b1e9f95f71451faddde4366720436a1228cb185f6b616';
export class ScoredExamTraceReaderError extends Error {
  constructor() {
    super('SCORED_EXAM_TRACE_READER_UNAVAILABLE');
  }
}
const fail = (): never => {
  throw new ScoredExamTraceReaderError();
};
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const forbidden = [
  'nextera_web',
  'nextera_checkpoint_owner',
  'nextera_result_application',
  'nextera_runner',
  'nextera_judge_owner',
  'nextera_judge_maintenance',
] as const;
const owner = `JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
 AND o.rolname='nextera_checkpoint_owner' AND NOT o.rolcanlogin AND NOT o.rolsuper
 AND NOT o.rolcreatedb AND NOT o.rolcreaterole AND NOT o.rolreplication AND NOT o.rolbypassrls
 AND NOT EXISTS(SELECT FROM pg_catalog.pg_auth_members membership WHERE membership.member=o.oid)`;
const body = (
  name: string,
  args: string,
  result: string,
  sourceHash: string,
  reader: boolean,
) => `EXISTS(
 SELECT FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_catalog.pg_language lang ON lang.oid=p.prolang
 ${owner}
 WHERE n.nspname='app' AND p.proname='${name}'
 AND p.oid='app.${name}(${args
   .split(', ')
   .map((type) => 'pg_catalog.' + type)
   .join(',')})'::pg_catalog.regprocedure
 AND pg_catalog.oidvectortypes(p.proargtypes)='${args}'
 AND p.prorettype='pg_catalog.${result}'::pg_catalog.regtype AND NOT p.proretset
 AND p.prokind='f' AND lang.lanname='plpgsql'
 AND p.prosecdef=${reader} AND p.proisstrict=${!reader} AND p.provolatile='${reader ? 'v' : 'i'}'
 AND p.proconfig=ARRAY['search_path=pg_catalog']::pg_catalog.text[] AND p.pronargdefaults=0
 AND pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8'))=pg_catalog.decode('${sourceHash}','hex')
 AND ${reader ? "pg_catalog.has_function_privilege(session_user,p.oid,'EXECUTE') AND" : ''} NOT EXISTS(
 SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
 LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
 WHERE acl.grantee<>p.proowner AND (${reader ? "grantee.rolname IS DISTINCT FROM 'nextera_exam_evaluator' OR acl.privilege_type<>'EXECUTE' OR acl.is_grantable" : 'true'})))`;

/** One statement: no prior pooled catalog proof or role cache can authorize the RPC.
 * The pinned native RPC independently checks its session principal and frozen receipt. */
export const READ_SCORED_EXAM_TRACE_CONTEXT_SQL = `WITH verified AS MATERIALIZED (
 SELECT pg_catalog.current_setting('role')='none' AND current_user=session_user
 AND EXISTS(SELECT FROM pg_catalog.pg_roles principal WHERE principal.rolname=session_user
 AND principal.rolcanlogin AND NOT principal.rolsuper AND NOT principal.rolcreatedb AND NOT principal.rolcreaterole
 AND NOT principal.rolreplication AND NOT principal.rolbypassrls)
 AND pg_catalog.pg_has_role(session_user,'nextera_exam_evaluator','USAGE')
 AND NOT EXISTS(SELECT FROM (VALUES ${forbidden.map((role) => `('${role}')`).join(',')}) denied(name)
 WHERE pg_catalog.pg_has_role(session_user,denied.name,'USAGE') OR pg_catalog.pg_has_role(session_user,denied.name,'SET'))
 AND ${body('scored_exam_trace_context', 'uuid', 'jsonb', SCORED_EXAM_TRACE_READER_BODY_SHA256, true)}
 AND ${body('exam_scoring_source_binding_valid', 'jsonb, jsonb', 'bool', SCORED_EXAM_TRACE_BINDING_VALIDATOR_BODY_SHA256, false)} AS ready
) SELECT CASE WHEN ready THEN app.scored_exam_trace_context($1::pg_catalog.uuid) ELSE NULL END AS data FROM verified`;

export type ScoredExamTraceReaderSettings = Readonly<{
  client: Pick<Sql, 'unsafe'> | null;
  limits: Readonly<{ queryMs: number; maxContextBytes: number; maxAnswerBytes: number }> | null;
}>;
function data(v: unknown, names: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  const fields = Object.getOwnPropertyDescriptors(v);
  if (
    Reflect.ownKeys(fields).length !== names.length ||
    !names.every((name) => Object.hasOwn(fields, name) && Object.hasOwn(fields[name]!, 'value'))
  )
    return fail();
  return Object.fromEntries(names.map((name) => [name, fields[name]!.value]));
}
function limit(v: unknown, max = 2147483647): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > max) return fail();
  return v;
}
function ownMethod<T extends object, K extends keyof T>(object: T, name: K): T[K] {
  const d = Object.getOwnPropertyDescriptor(object, name);
  if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'function') return fail();
  return d.value.bind(object) as T[K];
}
/** postgres PendingQuery.cancel lives on its prototype. Never invoke a getter,
 * inspect a pool/global cancel method, or cancel anything other than this handle. */
function cancelMethod(query: unknown): (() => unknown) | null {
  if (!query || (typeof query !== 'object' && typeof query !== 'function')) return null;
  let at: object | null = query;
  for (let depth = 0; at && depth < 8; depth++, at = Object.getPrototypeOf(at) as object | null) {
    const d = Object.getOwnPropertyDescriptor(at, 'cancel');
    if (d)
      return Object.hasOwn(d, 'value') && typeof d.value === 'function'
        ? (d.value.bind(query) as () => unknown)
        : null;
  }
  return null;
}
/** Source assembly only; no URL, credentials, default limits or query on construction.
 * Returning a reader means configured, not that native attestation has passed. */
export function createPostgresScoredExamTraceReader(
  settings: ScoredExamTraceReaderSettings | null = null,
) {
  if (!settings?.client || !settings.limits) return null;
  let queryMs: number,
    maxContextBytes: number,
    maxAnswerBytes: number,
    unsafe: Pick<Sql, 'unsafe'>['unsafe'];
  try {
    const l = data(settings.limits, ['queryMs', 'maxContextBytes', 'maxAnswerBytes']);
    queryMs = limit(l.queryMs);
    maxContextBytes = limit(l.maxContextBytes, 1048576);
    maxAnswerBytes = limit(l.maxAnswerBytes, 262144);
    unsafe = ownMethod(settings.client, 'unsafe');
  } catch {
    return null;
  }
  return Object.freeze({
    async read(receiptId: string): Promise<Readonly<Record<string, unknown>>> {
      if (typeof receiptId !== 'string' || !uuid.test(receiptId)) return fail();
      const capturedId = receiptId,
        started = performance.now();
      let settled = false,
        cancelled = false,
        timer: ReturnType<typeof setTimeout> | undefined;
      let cancel: (() => unknown) | null = null;
      const cancelOwned = () => {
        if (settled || cancelled || !cancel) return;
        cancelled = true;
        try {
          void Promise.resolve(cancel()).catch(() => {});
        } catch {
          /* Request only; no native closure claim. */
        }
      };
      try {
        const query = unsafe(READ_SCORED_EXAM_TRACE_CONTEXT_SQL, [capturedId] as never[]);
        const observed = Promise.resolve(query).then(
          (value) => {
            settled = true;
            return value;
          },
          (error) => {
            settled = true;
            throw error;
          },
        );
        try {
          cancel = cancelMethod(query);
        } catch {
          cancel = null;
        }
        const remaining = queryMs - (performance.now() - started);
        if (remaining <= 0) {
          cancelOwned();
          void observed.catch(() => {});
          return fail();
        }
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            cancelOwned();
            reject(new ScoredExamTraceReaderError());
          }, remaining);
        });
        const rows: unknown = await Promise.race([observed, timeout]);
        if (performance.now() - started >= queryMs || !Array.isArray(rows) || rows.length !== 1)
          return fail();
        const row = Object.getOwnPropertyDescriptor(rows, '0');
        if (!row || !Object.hasOwn(row, 'value')) return fail();
        const captured = captureScoredExamTraceReaderResult(
          data(row.value, ['data']).data,
          capturedId,
          { maxContextBytes, maxAnswerBytes },
        );
        if (performance.now() - started >= queryMs) return fail();
        return captured;
      } catch {
        return fail();
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  });
}
