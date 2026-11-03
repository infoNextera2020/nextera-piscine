import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const targetDbUrl =
  process.env.TEST_DATABASE_URL ||
  'postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001';

const sql = postgres(targetDbUrl, { max: 1 });

async function main() {
  const content = readFileSync('packages/db/migrations/0011_judge_protocol_patch.sql', 'utf8');
  for (const stmt of content.split('--> statement-breakpoint')) {
    const s = stmt.trim();
    if (s) {
      await sql.unsafe(s);
    }
  }
  console.log('0011 reapplied successfully');
  await sql.end();
}

main().catch(console.error);
