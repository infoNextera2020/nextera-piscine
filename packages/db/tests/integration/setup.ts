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
  if (!originalDbUrl) {
    throw new Error(
      'Database test isolation requires TEST_DATABASE_URL or MIGRATION_DATABASE_URL to be set.',
    );
  }

  const url = new URL(originalDbUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error(
      `Database test isolation requires a local database connection (got ${url.hostname}).`,
    );
  }

  const rootUrl = new URL(originalDbUrl);
  rootUrl.pathname = '/postgres';

  const uniqueHex = randomUUID().replaceAll('-', '').slice(0, 16);
  isolatedDbName = `foundation_test_${uniqueHex}`;

  let created = false;
  let lastError: unknown;

  try {
    rootClient = postgres(rootUrl.toString(), { max: 1, prepare: false, onnotice: () => {} });
    await rootClient.unsafe(`CREATE DATABASE ${isolatedDbName}`);
    created = true;
  } catch (err) {
    lastError = err;
    try {
      if (rootClient) await rootClient.end();
    } catch {
      // Ignore cleanup error on failed connection
    }
    try {
      rootUrl.pathname = '/template1';
      rootClient = postgres(rootUrl.toString(), { max: 1, prepare: false, onnotice: () => {} });
      await rootClient.unsafe(`CREATE DATABASE ${isolatedDbName}`);
      created = true;
    } catch (err2) {
      lastError = err2;
    }
  }

  if (!created) {
    throw new Error(
      `Database test isolation failed to provision isolated database ${isolatedDbName}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
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
