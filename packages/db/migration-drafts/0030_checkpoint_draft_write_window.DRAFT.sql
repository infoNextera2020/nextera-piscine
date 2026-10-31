-- REVIEW DRAFT ONLY. Unregistered append-only repair; no automatic activation.
-- PostgreSQL16+. Requires the separately reviewed exact checkpoint-owner migration span.
-- Earlier0011/0021 files, read retention, payload/CAS logic and public ACLs remain unchanged.
-- This adds a fresh write-window check to exact POST receipt replay, after all locks and lookup.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $repair$
DECLARE request record; prior_proc record; updated_proc record; owner_oid oid; web_oid oid;
        new_body text; actual_arguments text; count_repaired integer:=0;
BEGIN
 IF current_user<>'nextera_checkpoint_owner' THEN RAISE EXCEPTION 'Explicit checkpoint-owner migration context required'; END IF;
 SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname='nextera_checkpoint_owner'
 AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication;
 SELECT oid INTO web_oid FROM pg_catalog.pg_roles WHERE rolname='nextera_web';
 IF owner_oid IS NULL OR web_oid IS NULL THEN RAISE EXCEPTION 'Reviewed roles unavailable'; END IF;
 FOR request IN SELECT * FROM (VALUES
  ('save_checkpoint_draft','uuid,uuid,text,text,uuid,bigint,bytea,text','auth_id uuid,attempt uuid,task text,definition text,request uuid,base bigint,source bytea,source_hash text','0e63149615758594bcc972a6e8162ad7390e4a23352c9d09e1aa7eb784aa4955','6d71f2c99726c7ff48fbdcd7a2d2b8152f59ccf248524edb92dde0fc57c033e2',' IF old.expires_at<=clock_timestamp() THEN RAISE EXCEPTION ''Draft expired'' USING ERRCODE=''PD001''; END IF;',' at_time:=clock_timestamp();
 IF a.status<>''active'' OR at_time>=a.deadline_at THEN RAISE EXCEPTION ''Draft intake closed'' USING ERRCODE=''PD001''; END IF;'),
  ('save_checkpoint_answer_draft','uuid,uuid,text,text,text,uuid,bigint,bytea,text','auth_id uuid,attempt uuid,task text,definition text,contract text,request uuid,base bigint,payload bytea,payload_hash text','00308c9a6c769d82852155eedecf44f61fe14fc5dd07310d22206270d5bcfe91','3e365dc7b40317d902e7bd8aca489df93bcd30020ee045a9e4c523efdf7892c6',' IF old.expires_at<=clock_timestamp() THEN RAISE EXCEPTION ''Structured draft expired'' USING ERRCODE=''PA001''; END IF;',' at_time:=clock_timestamp();
 IF a.status<>''active'' OR at_time>=a.deadline_at THEN RAISE EXCEPTION ''Structured draft closed'' USING ERRCODE=''PA001''; END IF;')
 ) AS expected(function_name,signature_types,arguments,before_sha,after_sha,expiry_clause,guard_clause)
 LOOP
  SELECT * INTO prior_proc FROM pg_catalog.pg_proc
  WHERE oid=pg_catalog.to_regprocedure('app.'||request.function_name||'('||request.signature_types||')');
  IF NOT FOUND OR prior_proc.proowner<>owner_oid OR prior_proc.prorettype<>'pg_catalog.jsonb'::regtype
   OR prior_proc.prokind<>'f' OR prior_proc.proretset OR NOT prior_proc.prosecdef
   OR prior_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
   OR prior_proc.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR prior_proc.provolatile<>'v' OR prior_proc.proparallel<>'u' OR prior_proc.proleakproof OR prior_proc.proisstrict
   OR prior_proc.provariadic<>0 OR prior_proc.proargdefaults IS NOT NULL
   OR encode(sha256(convert_to(prior_proc.prosrc,'UTF8')),'hex')<>request.before_sha
   OR NOT pg_catalog.has_function_privilege('nextera_web',prior_proc.oid,'EXECUTE')
   OR EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(prior_proc.proacl,pg_catalog.acldefault('f',prior_proc.proowner))) a
      WHERE a.grantee<>owner_oid AND (a.grantee<>web_oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
  THEN RAISE EXCEPTION 'Unexpected baseline write RPC; no adoption or replay'; END IF;
  actual_arguments:=pg_catalog.pg_get_function_arguments(prior_proc.oid);
  IF regexp_replace(actual_arguments,'[[:space:]]','','g')<>regexp_replace(request.arguments,'[[:space:]]','','g')
   OR length(prior_proc.prosrc)-length(replace(prior_proc.prosrc,request.expiry_clause,''))<>length(request.expiry_clause)
  THEN RAISE EXCEPTION 'Unexpected argument or replay-body identity'; END IF;
  new_body:=replace(prior_proc.prosrc,request.expiry_clause,request.guard_clause||E'\n'||request.expiry_clause);
  IF encode(sha256(convert_to(new_body,'UTF8')),'hex')<>request.after_sha THEN RAISE EXCEPTION 'Repair bytes differ'; END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION app.%I(%s) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',request.function_name,actual_arguments,new_body);
  SELECT * INTO updated_proc FROM pg_catalog.pg_proc WHERE oid=prior_proc.oid;
  IF NOT FOUND OR encode(sha256(convert_to(updated_proc.prosrc,'UTF8')),'hex')<>request.after_sha
   OR ROW(updated_proc.proowner,updated_proc.proacl,updated_proc.proargtypes,updated_proc.proargnames,updated_proc.proargmodes,
          updated_proc.prorettype,updated_proc.proretset,updated_proc.prosecdef,updated_proc.proconfig,updated_proc.prolang,
          updated_proc.provolatile,updated_proc.proparallel,updated_proc.proleakproof,updated_proc.proisstrict,
          updated_proc.provariadic,updated_proc.proargdefaults::text,updated_proc.procost,updated_proc.prorows)
      IS DISTINCT FROM
      ROW(prior_proc.proowner,prior_proc.proacl,prior_proc.proargtypes,prior_proc.proargnames,prior_proc.proargmodes,
          prior_proc.prorettype,prior_proc.proretset,prior_proc.prosecdef,prior_proc.proconfig,prior_proc.prolang,
          prior_proc.provolatile,prior_proc.proparallel,prior_proc.proleakproof,prior_proc.proisstrict,
          prior_proc.provariadic,prior_proc.proargdefaults::text,prior_proc.procost,prior_proc.prorows)
  THEN RAISE EXCEPTION 'Write RPC identity, ACL or attribute readback differs'; END IF;
  count_repaired:=count_repaired+1;
 END LOOP;
 IF count_repaired<>2 THEN RAISE EXCEPTION 'Incomplete write-window repair'; END IF;
END $repair$;
COMMIT;
