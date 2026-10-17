import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@nextera/db/schema';
import { required } from './local-environment';
import type { OperationalDatabase } from '@nextera/db/operations/curriculum';

export async function withOperations<T>(
  operation: (db: OperationalDatabase) => Promise<T>,
): Promise<T> {
  const connection = required('OPERATIONS_DATABASE_URL');
  if (connection === process.env.DATABASE_URL)
    throw new Error('Operational credentials must be separate from the web runtime.');
  const client = postgres(connection, { max: 1, prepare: false, onnotice: () => {} });
  try {
    return await operation(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}
