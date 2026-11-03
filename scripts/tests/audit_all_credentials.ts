import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const OLD_EXPOSED_WEB_PASS = 'e395801adba14d3f3f01f8d4847bf3ae055c65fe3684a2ca399e4f55e0544fbb';
const OLD_EXPOSED_WORKER_PASS = '348c42bfe41a346174e84362f0b8089ea15200baffaf05189339d9507b73c5f2';

async function testConn(role: string, pass: string): Promise<{ ok: boolean; msg: string; user?: string }> {
  try {
    const sql = postgres(`postgresql://${role}:${pass}@127.0.0.1:54322/foundation_test_slice_001`, {
      max: 1,
      connect_timeout: 3,
      idle_timeout: 1,
    });
    const [row] = await sql`SELECT session_user`;
    await sql.end({ timeout: 1 });
    return { ok: true, msg: 'Connected successfully', user: row.session_user };
  } catch (err: any) {
    const sanitized = (err.message || String(err)).replace(/:[^:@]+@/, ':***@');
    return { ok: false, msg: sanitized };
  }
}

async function main() {
  const adminSql = postgres('postgresql://supabase_admin:postgres@127.0.0.1:54322/foundation_test_slice_001', {
    max: 1,
    connect_timeout: 5,
  });

  const now = new Date();
  console.log(`=== FULL CREDENTIAL & ROLE AUDIT ===`);
  console.log(`Audit Timestamp (ISO): ${now.toISOString()}`);
  console.log(`Audit Local Time     : ${now.toString()}\n`);

  // 1. Check all nextera roles in Postgres
  console.log('--- 1. All Nextera Database Roles (pg_roles) ---');
  const roles = await adminSql`
    SELECT rolname, rolcanlogin, rolsuper, rolinherit
    FROM pg_roles
    WHERE rolname LIKE 'nextera%'
    ORDER BY rolname;
  `;
  for (const r of roles) {
    console.log(`  Role: ${r.rolname.padEnd(35)} | canlogin: ${String(r.rolcanlogin).padEnd(5)} | superuser: ${r.rolsuper}`);
  }

  // 2. Check role memberships
  console.log('\n--- 2. Role Memberships (pg_auth_members) ---');
  const memberships = await adminSql`
    SELECT r.rolname as role, m.rolname as member_of
    FROM pg_auth_members am
    JOIN pg_roles r ON r.oid = am.member
    JOIN pg_roles m ON m.oid = am.roleid
    WHERE r.rolname LIKE 'nextera%' OR m.rolname LIKE 'nextera%'
    ORDER BY r.rolname, m.rolname;
  `;
  for (const m of memberships) {
    console.log(`  ${m.role.padEnd(35)} -> member of -> ${m.member_of}`);
  }

  // 3. Test Web Local Role
  console.log('\n--- 3. Web Local Role (nextera_web_local) ---');
  const oldWeb = await testConn('nextera_web_local', OLD_EXPOSED_WEB_PASS);
  console.log(`  Old password attempt : ${oldWeb.ok ? 'CRITICAL LEAK (ACCEPTED)' : 'REJECTED (' + oldWeb.msg + ')'}`);
  
  const currentWebUrl = process.env.DATABASE_URL || '';
  const currentWebMatch = currentWebUrl.match(/postgresql:\/\/nextera_web_local:([^@]+)@/);
  const currentWebPass = currentWebMatch ? currentWebMatch[1] : '';
  const newWeb = await testConn('nextera_web_local', currentWebPass);
  console.log(`  New password attempt : ${newWeb.ok ? 'ACTIVE (Connected as ' + newWeb.user + ')' : 'FAILED (' + newWeb.msg + ')'}`);

  // 4. Test Runner Worker Role
  console.log('\n--- 4. Runner Worker Role (nextera_worker_9ef4a0519ca28e2d) ---');
  const oldWorker = await testConn('nextera_worker_9ef4a0519ca28e2d', OLD_EXPOSED_WORKER_PASS);
  console.log(`  Old PS1 password attempt: ${oldWorker.ok ? 'CRITICAL LEAK (ACCEPTED)' : 'REJECTED (' + oldWorker.msg + ')'}`);

  const currentJudgeUrl = process.env.JUDGE_DATABASE_URL || '';
  const currentJudgeMatch = currentJudgeUrl.match(/postgresql:\/\/nextera_worker_9ef4a0519ca28e2d:([^@]+)@/);
  const currentJudgePass = currentJudgeMatch ? currentJudgeMatch[1] : '';
  const newWorker = await testConn('nextera_worker_9ef4a0519ca28e2d', currentJudgePass);
  console.log(`  New password attempt    : ${newWorker.ok ? 'ACTIVE (Connected as ' + newWorker.user + ')' : 'FAILED (' + newWorker.msg + ')'}`);

  // 5. Test Inactive Workers
  console.log('\n--- 5. Legacy / Inactive Workers ---');
  for (const legacyWorker of ['nextera_worker_d5dd61c42c22d399', 'nextera_worker_b21a6865432b0ab4']) {
    const [r] = await adminSql`SELECT rolcanlogin FROM pg_roles WHERE rolname = ${legacyWorker}`;
    console.log(`  ${legacyWorker}: canlogin = ${r?.rolcanlogin} (${r?.rolcanlogin ? 'WARNING: ACTIVE' : 'LOCKED (NOLOGIN)'})`);
  }

  // 6. Test Invitation Roles
  console.log('\n--- 6. Invitation Roles ---');
  const [issuerRole] = await adminSql`SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'nextera_invitation_issuer'`;
  console.log(`  nextera_invitation_issuer       : canlogin = ${issuerRole?.rolcanlogin} (Group role, NOLOGIN)`);

  const [runtimeRole] = await adminSql`SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'nextera_invitation_runtime'`;
  console.log(`  nextera_invitation_runtime      : canlogin = ${runtimeRole?.rolcanlogin} (Group role, NOLOGIN)`);

  const [testIssuerRole] = await adminSql`SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'nextera_invitation_test_issuer'`;
  console.log(`  nextera_invitation_test_issuer  : canlogin = ${testIssuerRole?.rolcanlogin} (Used by test scripts for issuing invitations)`);

  const issuerPrivs = await adminSql`
    SELECT specific_schema, routine_name, privilege_type
    FROM information_schema.routine_privileges
    WHERE grantee IN ('nextera_invitation_issuer', 'nextera_invitation_test_issuer')
    ORDER BY routine_name;
  `;
  console.log(`  Privileges for invitation issuers:`, issuerPrivs.map(p => `${p.specific_schema}.${p.routine_name} [${p.privilege_type}]`));

  // 7. Runner Scopes
  console.log('\n--- 7. Runner Exact Routine Scopes ---');
  const runnerPrivs = await adminSql`
    SELECT specific_schema, routine_name, privilege_type
    FROM information_schema.routine_privileges
    WHERE grantee IN ('nextera_runner', 'nextera_worker_9ef4a0519ca28e2d')
    ORDER BY routine_name;
  `;
  for (const p of runnerPrivs) {
    console.log(`  ${p.specific_schema}.${p.routine_name} [${p.privilege_type}]`);
  }

  const runnerTables = await adminSql`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE grantee IN ('nextera_runner', 'nextera_worker_9ef4a0519ca28e2d');
  `;
  console.log(`  Direct table privileges for runner: ${runnerTables.length}`);

  await adminSql.end({ timeout: 1 });
}

main().catch(console.error);
