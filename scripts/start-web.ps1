$env:NEXTERA_ALLOW_LOCAL_FALLBACK = "1"
if (-not $env:DATABASE_URL) {
  Write-Error "DATABASE_URL environment variable is required. Ensure .env.local is configured."
  exit 1
}
$env:SUPABASE_LOCAL_URL = "http://127.0.0.1:54321"
$env:NEXTERA_INVITATION_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
pnpm.cmd --filter @nextera/web start --hostname 127.0.0.1 --port 3100
