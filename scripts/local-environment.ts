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
