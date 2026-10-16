import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export type JsonObject = { [key: string]: unknown };

export const isObject = (column: AnyPgColumn) => sql`jsonb_typeof(${column}) = 'object'`;
export const boundedObject = (column: AnyPgColumn) =>
  sql`${isObject(column)} AND octet_length(${column}::text) <= 65536`;
export const digest = (column: AnyPgColumn) => sql`${column} ~ '^[0-9a-f]{64}$'`;
export const isOneOf = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} IN (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`.inlineParams();

/** Reject missing/non-numeric limits too: CHECK must never pass through SQL NULL. */
export function positiveResourceLimits(column: AnyPgColumn): SQL {
  const predicates = ['compilation', 'execution'].flatMap((phase) =>
    [
      'cpu_limit',
      'memory_bytes',
      'pid_limit',
      'timeout_ms',
      'output_bytes',
      'temporary_filesystem_bytes',
      'temporary_filesystem_inodes',
    ].map(
      (key) => sql`(
      jsonb_typeof(${column}->'resource_limits'->${phase}->${key}) = 'number'
      AND (${column}->'resource_limits'->${phase}->>${key})::numeric > 0
    )`,
    ),
  );
  return sql`coalesce((${isObject(column)} AND ${sql.join(predicates, sql` AND `)}), false)`.inlineParams();
}
