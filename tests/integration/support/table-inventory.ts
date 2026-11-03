// Exact row counts of every base table in a database (plan 09-02, D-19, U-04).
//
// Lists every base table from information_schema.tables outside pg_catalog and
// information_schema (so `public` and, once pg-boss has started, `pgboss`) and returns
// `schema.table -> exact count(*)`, sorted by key. Two inventories compare with toEqual: no
// tolerance, a table that appears or disappears shows as a key difference.
//
// Callers take the baseline AFTER building their fixture, so the TicketState and
// TicketStateConfig rows the organization-insert trigger writes belong to the baseline.
//
// `pg` only; nothing under src/ is imported here.
import pg from "pg";

export type TableInventory = Record<string, number>;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function countAllTables(url: string): Promise<TableInventory> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name
         FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name`,
    );
    const entries: [string, number][] = [];
    for (const row of rows) {
      const result = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${quoteIdent(row.table_schema)}.${quoteIdent(row.table_name)}`,
      );
      entries.push([`${row.table_schema}.${row.table_name}`, Number(result.rows[0].n)]);
    }
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  } finally {
    await client.end();
  }
}
