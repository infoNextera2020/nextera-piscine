import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './schema/index.ts',
  out: './migrations',
  schemaFilter: ['app', 'judge'],
  strict: true,
});
