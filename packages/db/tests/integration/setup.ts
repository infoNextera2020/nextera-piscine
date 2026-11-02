import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll } from 'vitest';

config({ path: '.env', quiet: true });

let rootClient: ReturnType<typeof postgres> | undefined;
let isolatedDbName: string | undefined;
let originalDbUrl: string | undefined;

beforeAll(async () => {
  originalDbUrl = process.env.TEST_DATABASE_URL || process.env.MIGRATION_DATABASE_URL;
  if (!originalDbUrl) return;

  const url = new URL(originalDbUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return;

  const rootUrl = new URL(originalDbUrl);
  rootUrl.pathname = '/postgres';

  try {
    rootClient = postgres(rootUrl.toString(), { max: 1, prepare: false, onnotice: () => {} });
    const uniqueHex = randomUUID().replaceAll('-', '').slice(0, 16);
    isolatedDbName = `foundation_test_${uniqueHex}`;
    await rootClient.unsafe(`CREATE DATABASE ${isolatedDbName}`);
  } catch {
    try {
      if (rootClient) await rootClient.end();
    } catch {
      // Ignore cleanup error on failed connection
    }
    try {
      rootUrl.pathname = '/template1';
      rootClient = postgres(rootUrl.toString(), { max: 1, prepare: false, onnotice: () => {} });
      const uniqueHex = randomUUID().replaceAll('-', '').slice(0, 16);
      isolatedDbName = `foundation_test_${uniqueHex}`;
      await rootClient.unsafe(`CREATE DATABASE ${isolatedDbName}`);
    } catch {
      // If base connection fails, keep originalDbUrl
      return;
    }
  }

  const isolatedUrl = new URL(originalDbUrl);
  isolatedUrl.pathname = `/${isolatedDbName}`;
  process.env.TEST_DATABASE_URL = isolatedUrl.toString();
});

afterAll(async () => {
  if (originalDbUrl) {
    process.env.TEST_DATABASE_URL = originalDbUrl;
  }
  if (rootClient && isolatedDbName) {
    try {
      await rootClient.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${isolatedDbName}' AND pid <> pg_backend_pid()`,
      );
      await rootClient.unsafe(`DROP DATABASE IF EXISTS ${isolatedDbName} WITH (FORCE)`);
    } catch {
      // Best effort cleanup
    } finally {
      await rootClient.end();
    }
  }
});
