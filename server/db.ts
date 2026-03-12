import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Make sure .env is loaded.");
}

// Using Supabase session pooler (:5432) — session mode keeps the backend connection
// assigned to a client for its full checkout duration, unlike the transaction pooler
// (:6543) which releases the connection after every transaction. Session mode allows
// multiple sequential queries on the same pool.connect() client reliably.

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // necessário para conexão com Supabase
  },
  // Keep pool small to avoid exhausting PgBouncer free-tier limits.
  max: 10,
  // Hold idle connections for up to 4 minutes before releasing them.
  // This is well below Supabase PgBouncer's 5-min server_idle_timeout, so the pool
  // never holds a connection PgBouncer has already dropped. Keeping connections warm
  // avoids paying the 5-10 s SSL-handshake cost on every request after idle periods.
  idleTimeoutMillis: 240000,
  // Give up waiting for a pool slot after 30 s (prevents infinite hangs).
  connectionTimeoutMillis: 30000,
});

// Silently handle pool-level connection errors (e.g. "Connection terminated unexpectedly")
// to prevent unhandled promise rejections from crashing the server.
pool.on("error", (err) => {
  console.error("[DB Pool] Unexpected error on idle client:", err.message);
});

export const db = drizzle(pool, { schema });

/**
 * Warm up the connection pool by running a trivial query.
 * Retries up to `retries` times with `delayMs` between attempts.
 * Never throws — just logs so the server always boots.
 */
export async function warmPool(retries = 6, delayMs = 5000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query("SELECT 1");
      console.log("[DB] Connection pool ready.");
      return;
    } catch (err: any) {
      console.warn(`[DB] Pool warmup attempt ${i + 1}/${retries} failed: ${err?.message ?? err}`);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.error("[DB] Could not warm connection pool after all retries. DB queries may fail.");
}
