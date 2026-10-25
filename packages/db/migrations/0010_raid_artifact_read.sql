-- Exact accepted source read for the assigned mentor, using the mentor's existing Auth session.
-- No token, elevated Storage credential, broad bucket access or executable source rendering.
-- Native protocol-test databases lack Supabase Storage and deliberately skip these policies.
DO $$ DECLARE temporary boolean:=false; BEGIN
 IF to_regclass('storage.objects') IS NOT NULL AND to_regprocedure('auth.uid()') IS NOT NULL THEN
 EXECUTE $fn$CREATE FUNCTION app.raid_storage_reader(bucket text,object_key text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
 DECLARE aid uuid; BEGIN
 IF bucket<>'nextera-submissions' OR auth.uid() IS NULL THEN RETURN false; END IF;
 SELECT a.id INTO aid FROM app.raid_attempts a JOIN app.submissions s ON s.id=a.submission_id JOIN app.submission_artifacts ar ON ar.id=s.artifact_id WHERE ar.storage_bucket=bucket AND ar.storage_key=object_key;
 IF aid IS NULL THEN RETURN false; END IF;
 BEGIN PERFORM app.raid_artifact_context(auth.uid(),aid); RETURN true; EXCEPTION WHEN insufficient_privilege THEN RETURN false; END;
 END $body$ $fn$;
 IF NOT pg_has_role(current_user,'nextera_raid_owner','SET') THEN EXECUTE format('GRANT nextera_raid_owner TO %I',current_user); temporary:=true; END IF;
 GRANT USAGE ON SCHEMA auth TO nextera_raid_owner;
 GRANT EXECUTE ON FUNCTION auth.uid() TO nextera_raid_owner;
 GRANT CREATE ON SCHEMA app TO nextera_raid_owner;
 ALTER FUNCTION app.raid_storage_reader(text,text) OWNER TO nextera_raid_owner;
 REVOKE CREATE ON SCHEMA app FROM nextera_raid_owner;
 REVOKE ALL ON FUNCTION app.raid_storage_reader(text,text) FROM PUBLIC;
 GRANT USAGE ON SCHEMA app TO authenticated;
 GRANT EXECUTE ON FUNCTION app.raid_storage_reader(text,text) TO authenticated;
 EXECUTE $policy$CREATE POLICY nextera_raid_source_read ON storage.objects FOR SELECT TO authenticated
 USING (app.raid_storage_reader(bucket_id,name))$policy$;
 -- Keep the existing owner/worker guard; add only the exact mentor-authorized object.
 EXECUTE 'DROP POLICY nextera_source_read_scope ON storage.objects';
 EXECUTE $policy$CREATE POLICY nextera_source_read_scope ON storage.objects AS RESTRICTIVE FOR SELECT TO PUBLIC
 USING (bucket_id<>'nextera-submissions' OR (storage.foldername(name))[1]=(SELECT auth.uid())::text
 OR (SELECT auth.jwt())->>'nextera_artifact_reader'='true' OR app.raid_storage_reader(bucket_id,name))$policy$;
 IF temporary THEN EXECUTE format('REVOKE nextera_raid_owner FROM %I GRANTED BY %I',current_user,current_user);
 IF pg_has_role(current_user,'nextera_raid_owner','SET') THEN RAISE EXCEPTION 'Owner SET access remains'; END IF; END IF;
 END IF;
END $$;
