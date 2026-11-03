import postgres from 'postgres';

const sql = postgres('postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001');

async function main() {
  const [cohort] = await sql`SELECT id, slug, curriculum_version_id FROM app.cohorts WHERE slug = 'week1-trial-cohort-v7'`;
  console.log('Cohort:', cohort);

  const rows = await sql`
    SELECT node_key, title, position, submission_rules, resolved_evaluation_spec->>'test_pack_id' as test_pack_id
    FROM app.curriculum_nodes 
    WHERE curriculum_version_id = ${cohort.curriculum_version_id}
      AND quest_key = 'quest2' 
    ORDER BY position
  `;
  console.table(rows);
  await sql.end();
}

main().catch(console.error);
