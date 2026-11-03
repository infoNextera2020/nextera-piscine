import postgres from 'postgres';

const sql = postgres('postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001');

async function main() {
  const rows = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'app' AND table_name LIKE 'quest_review%'
  `;
  console.log('Quest review tables:', rows.map(r => r.table_name));

  const funcs = await sql`
    SELECT routine_name 
    FROM information_schema.routines 
    WHERE routine_schema = 'app' AND routine_name LIKE '%quest_review%'
  `;
  console.log('Quest review routines:', funcs.map(r => r.routine_name));

  await sql.end();
}

main().catch(console.error);
