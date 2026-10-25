import { sql } from 'drizzle-orm';
import {
  evaluateRaidReadiness,
  raidBindingProblems,
  type RaidReadinessFacts,
  type RaidStorageBinding,
} from './raid-readiness-state';
import type { OperationalDatabase } from '../operations/curriculum';

/** Catalogs only: no Storage object data, privileged connection, DDL or mutation. */
export const RAID_READINESS_SQL = `
SELECT current_database() AS database_name,
 NOT EXISTS (
  SELECT FROM (VALUES
   ('read_raid','uuid,uuid,text,uuid'),('raid_review_queue','uuid'),
   ('accept_raid_submission','uuid,uuid,text,uuid,text,bigint,text'),
   ('assign_raid_team','uuid,uuid,text,uuid,text,uuid,uuid[]'),
   ('review_raid','uuid,uuid,uuid,text,text'),('raid_artifact_context','uuid,uuid'),
   ('apply_raid_automated_result','uuid')
  ) required(name,args)
  WHERE NOT EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='app' AND p.proname=required.name AND replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')=required.args AND p.prosecdef)
 ) AS raid_contract,
 (
  EXISTS(SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='identities' AND c.relkind IN ('r','p'))
  AND EXISTS(SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='auth' AND c.relname='users' AND a.attname='email' AND NOT a.attisdropped)
  AND (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth' AND p.proname IN ('uid','jwt') AND p.pronargs=0)=2
 ) AS managed_auth,
 (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relname IN ('objects','buckets') AND c.relkind IN ('r','p') AND c.relrowsecurity)=2 AS managed_storage,
 EXISTS(SELECT FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace JOIN pg_catalog.pg_roles owner ON owner.oid=f.proowner JOIN pg_catalog.pg_roles browser ON browser.rolname='authenticated'
  WHERE n.nspname='app' AND f.proname='raid_storage_reader' AND replace(pg_catalog.oidvectortypes(f.proargtypes),' ','')='text,text'
  AND f.prosecdef AND f.proconfig @> ARRAY['search_path=pg_catalog'] AND owner.rolname='nextera_raid_owner' AND NOT owner.rolcanlogin AND NOT owner.rolsuper AND NOT owner.rolbypassrls
  AND pg_catalog.has_schema_privilege(browser.oid,n.oid,'USAGE') AND pg_catalog.has_function_privilege(browser.oid,f.oid,'EXECUTE')
  AND NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
 ) AS mentor_reader,
 EXISTS(SELECT FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles browser ON browser.rolname='authenticated'
  WHERE n.nspname='storage' AND c.relname='objects' AND p.polname='nextera_raid_source_read' AND p.polcmd='r' AND p.polpermissive AND browser.oid=ANY(p.polroles)
  AND EXISTS(SELECT FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_proc f ON f.oid=d.refobjid JOIN pg_catalog.pg_namespace fn ON fn.oid=f.pronamespace
   WHERE d.classid='pg_catalog.pg_policy'::regclass AND d.objid=p.oid AND d.refclassid='pg_catalog.pg_proc'::regclass AND fn.nspname='app' AND f.proname='raid_storage_reader')
 ) AS mentor_policy,
 EXISTS(SELECT FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='storage' AND c.relname='objects' AND p.polname='nextera_source_read_scope' AND p.polcmd='r' AND NOT p.polpermissive AND 0=ANY(p.polroles)
  AND EXISTS(SELECT FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_proc f ON f.oid=d.refobjid JOIN pg_catalog.pg_namespace fn ON fn.oid=f.pronamespace
   WHERE d.classid='pg_catalog.pg_policy'::regclass AND d.objid=p.oid AND d.refclassid='pg_catalog.pg_proc'::regclass AND fn.nspname='app' AND f.proname='raid_storage_reader')
 ) AS source_read_guard
`;
export function configuredRaidStorageBinding(): RaidStorageBinding {
  return {
    databaseName: process.env.RAID_STORAGE_DATABASE_NAME,
    storageApiUrl: process.env.RAID_STORAGE_API_URL,
    applicationApiUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
}
export async function readRaidReadiness(
  db: OperationalDatabase,
  binding = configuredRaidStorageBinding(),
) {
  if (raidBindingProblems(binding).length) return evaluateRaidReadiness(null, binding);
  try {
    const [row] = await db.execute(sql.raw(RAID_READINESS_SQL));
    return evaluateRaidReadiness(row ? (row as RaidReadinessFacts) : null, binding);
  } catch {
    // An unreachable catalog or missing privilege cannot authorize a Raid action.
    return { ready: false, reasons: ['catalog_unavailable'], liveStorageVerified: false as const };
  }
}
export class RaidNotReady extends Error {
  constructor() {
    super('RAID_NOT_READY');
  }
}
export async function requireRaidReady(db: OperationalDatabase) {
  if (!(await readRaidReadiness(db)).ready) throw new RaidNotReady();
}
