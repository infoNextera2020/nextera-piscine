-- Supabase Storage API owns object bytes. No managed table definitions are altered.
-- Native protocol-test databases have no Storage schema; real Supabase tests verify these policies.
DO $$
BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
 EXECUTE $policy$CREATE POLICY nextera_source_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id='nextera-submissions' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
 AND (SELECT auth.jwt())->>'nextera_artifact_reader' IS DISTINCT FROM 'true'
 AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}$')$policy$;
 EXECUTE $policy$CREATE POLICY nextera_source_read ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='nextera-submissions' AND
   ((storage.foldername(name))[1]=(SELECT auth.uid())::text
    OR (SELECT auth.jwt())->>'nextera_artifact_reader'='true'))$policy$;
 -- Restrictive bucket guards prevent unrelated permissive policies from allowing
 -- overwrite/delete or cross-owner reads in this immutable source bucket.
 EXECUTE $policy$CREATE POLICY nextera_source_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC
 USING (bucket_id<>'nextera-submissions') WITH CHECK (bucket_id<>'nextera-submissions')$policy$;
 EXECUTE $policy$CREATE POLICY nextera_source_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO PUBLIC
 USING (bucket_id<>'nextera-submissions')$policy$;
 EXECUTE $policy$CREATE POLICY nextera_source_insert_scope ON storage.objects AS RESTRICTIVE FOR INSERT TO PUBLIC
 WITH CHECK (bucket_id<>'nextera-submissions' OR (
   (storage.foldername(name))[1]=(SELECT auth.uid())::text
   AND (SELECT auth.jwt())->>'nextera_artifact_reader' IS DISTINCT FROM 'true'
   AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}$'))$policy$;
 EXECUTE $policy$CREATE POLICY nextera_source_read_scope ON storage.objects AS RESTRICTIVE FOR SELECT TO PUBLIC
 USING (bucket_id<>'nextera-submissions' OR
   (storage.foldername(name))[1]=(SELECT auth.uid())::text
   OR (SELECT auth.jwt())->>'nextera_artifact_reader'='true')$policy$;
 END IF;
END $$;
-- No UPDATE/DELETE policy: accepted object keys cannot be overwritten or removed by users/Runner.
