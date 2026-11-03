$env:NEXTERA_ALLOW_LOCAL_FALLBACK = "1"
$env:DATABASE_URL = "postgresql://nextera_web_local:e395801a0323048d44ad0ac010bae2bddfd805c1ce81da1eed44c99b2316d867@127.0.0.1:54322/foundation_test_slice_001"
$env:SUPABASE_LOCAL_URL = "http://127.0.0.1:54321"
$env:NEXTERA_INVITATION_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
pnpm.cmd --filter @nextera/web start --hostname 127.0.0.1 --port 3100
