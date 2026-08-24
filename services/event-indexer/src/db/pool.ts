/**
 * Shared PostgreSQL connection pool.
 *
 * All modules import `pool` from here so there is exactly one pg.Pool
 * instance for the process lifetime.  Connection parameters are read
 * from environment variables at startup.
 */

import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host:             process.env.PGHOST,
  port:             process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : undefined,
  database:         process.env.PGDATABASE,
  user:             process.env.PGUSER,
  password:         process.env.PGPASSWORD,
  max:              parseInt(process.env.PG_POOL_MAX ?? "10", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[pool] Unexpected idle client error:", err.message);
});
