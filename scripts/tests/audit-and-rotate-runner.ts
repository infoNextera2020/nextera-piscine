import postgres from 'postgres';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const OLD_EXPOSED_PS1_PASS = '348c42bfe41a346174e84362f0b8089ea15200baffaf05189339d9507b73c5f2';
const OLD_EXPOSED_WEB_PASS = 'e395801adba14d3f3f01f8d4847bf3ae055c65fe3684a2ca399e4f55e0544fbb';

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

  console.log(`=== RUNNER & WEB ROLE CREDENTIAL AUDIT [${new Date().toISOString()}] ===\n`);

  // 1. Check old web password
  const oldWeb = await testConn('nextera_web_local', OLD_EXPOSED_WEB_PASS);
  console.log('1. nextera_web_local (Exposed Old Password):');
  console.log('   Status:', oldWeb.ok ? 'FAIL (STILL ACCEPTED!)' : `REVOKED / REJECTED (${oldWeb.msg})`);

  // 2. Check old worker password
  const oldWorker = await testConn('nextera_worker_9ef4a0519ca28e2d', OLD_EXPOSED_PS1_PASS);
  console.log('2. nextera_worker_9ef4a0519ca28e2d (Exposed Old PS1 Password):');
  console.log('   Status:', oldWorker.ok ? 'FAIL (STILL ACCEPTED!)' : `REVOKED / REJECTED (${oldWorker.msg})`);

  // 3. Ensure runner has a fresh active rotated password if old was rejected or needs rotation
  const envPath = path.resolve(process.cwd(), '../../.env');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  
  // Check if JUDGE_DATABASE_URL exists in .env
  const judgeMatch = envContent.match(/JUDGE_DATABASE_URL=postgresql:\/\/nextera_worker_9ef4a0519ca28e2d:([^@]+)@/);
  let activeWorkerPass = judgeMatch ? judgeMatch[1] : '';

  if (!activeWorkerPass || oldWorker.ok) {
    // Generate new secure password for runner
    const newPass = randomBytes(32).toString('hex');
    await adminSql.unsafe(`ALTER ROLE nextera_worker_9ef4a0519ca28e2d WITH PASSWORD '${newPass}'`);
    activeWorkerPass = newPass;

    const newJudgeUrl = `postgresql://nextera_worker_9ef4a0519ca28e2d:${newPass}@127.0.0.1:54322/foundation_test_slice_001`;
    if (judgeMatch) {
      envContent = envContent.replace(/JUDGE_DATABASE_URL=.*/, `JUDGE_DATABASE_URL=${newJudgeUrl}`);
    } else {
      envContent += `\nJUDGE_DATABASE_URL=${newJudgeUrl}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log('   Rotated nextera_worker_9ef4a0519ca28e2d password and updated local .env');
  }

  // 4. Test active runner credential
  const activeWorker = await testConn('nextera_worker_9ef4a0519ca28e2d', activeWorkerPass);
  console.log('3. nextera_worker_9ef4a0519ca28e2d (New Rotated Password):');
  console.log('   Status:', activeWorker.ok ? `ACTIVE (Connected as ${activeWorker.user})` : `FAILED (${activeWorker.msg})`);

  // Re-verify old worker is still rejected
  const recheckOldWorker = await testConn('nextera_worker_9ef4a0519ca28e2d', OLD_EXPOSED_PS1_PASS);
  console.log('4. Re-verification of old worker password after rotation:');
  console.log('   Status:', recheckOldWorker.ok ? 'FAIL' : `CONFIRMED REJECTED (${recheckOldWorker.msg})`);

  await adminSql.end({ timeout: 1 });
}

main().catch(console.error);
