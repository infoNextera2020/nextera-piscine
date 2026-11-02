import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

export const root = fileURLToPath(new URL('../', import.meta.url));
config({ path: `${root}.env`, quiet: true });

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function assertLocalUrl(value: string, port: string) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== port) {
    throw new Error(`Local tooling requires a loopback URL on port ${port}.`);
  }
  return url;
}

export function assertPrivateDirectoryPermissions(dir: string, label = 'Private directory') {
  const stat = statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`${label} must be a directory.`);
  }

  if (process.platform === 'win32') {
    try {
      const output = execFileSync('icacls', [dir], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stripped = output.replace(dir, '').trim();
      const lines = stripped
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('Successfully'));
      const currentUser = (process.env.USERNAME || '').toLowerCase();
      const allowed = ['builtin\\administrators', 'nt authority\\system', currentUser];

      for (const line of lines) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const principal = line.slice(0, colon).trim().toLowerCase();
        const shortPrincipal = principal.includes('\\') ? principal.split('\\')[1] : principal;
        const isAllowed = allowed.some((a) => a && (principal.includes(a) || shortPrincipal === a));
        if (!isAllowed) {
          throw new Error(
            `${label} on Windows has unapproved access grants for: ${principal}. Permissions must be restricted to owner only.`,
          );
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('unapproved access grants')) {
        throw err;
      }
      throw new Error(
        `Failed to verify ${label} permissions on Windows: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  } else {
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(`${label} must have 0700 permissions (no group or world access).`);
    }
  }
}
