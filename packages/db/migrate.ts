import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error('MIGRATION_DATABASE_URL is required for migrations.');
const client = postgres(connectionString, { max: 1, prepare: false });
try {
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)),
  });
  console.info('Database migrations applied.');
} finally {
  await client.end();
}
