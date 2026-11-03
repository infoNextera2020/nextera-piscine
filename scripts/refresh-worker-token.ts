import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function main() {
  const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const raw = execFileSync(pnpmCmd, ['exec', 'supabase', 'status', '-o', 'json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in status output');
  const status = JSON.parse(jsonMatch[0]) as Record<string, string>;

  const credentialsDir = 'C:\\Users\\NEXTERA\\nextera-credentials-run003';
  const workerJson = JSON.parse(readFileSync(join(credentialsDir, 'worker.json'), 'utf8'));
  const workerId = workerJson.worker_id;

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: workerId,
      role: 'authenticated',
      aud: 'authenticated',
      nextera_artifact_reader: true,
      iat: now,
      exp: now + 86400 * 7, // 7 days
    }),
  ).toString('base64url');

  const signature = createHmac('sha256', status.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  const tokenPath = join(credentialsDir, 'storage-reader.jwt');
  writeFileSync(tokenPath, `${header}.${payload}.${signature}\n`, { mode: 0o600 });
  console.log('Successfully refreshed storage-reader.jwt for worker:', workerId);
}

main();
