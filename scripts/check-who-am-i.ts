import postgres from 'postgres';

const sql = postgres('postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001');

async function main() {
  const [node] = await sql`
    SELECT node_key, resolved_evaluation_spec 
    FROM app.curriculum_nodes 
    WHERE node_key = 'who-am-i' AND curriculum_version_id = '8e1995ea-1f13-4bba-adea-37c22413cefe'
  `;
  console.log('who-am-i:', node);
  await sql.end();
}

main().catch(console.error);
