import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

/** Create only on the server; no credentials are read while importing schema. */
export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required for database access.');
  const client = postgres(connectionString, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
