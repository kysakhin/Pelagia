import { drizzle } from "drizzle-orm/postgres-js";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.NEON_DATABASE_URL) {
  throw new Error("NEON_DATABASE_URL environment variable is not set");
}

// postgres.js manages its own connection pool. In serverless / edge runtimes
// the pool drains automatically between invocations. In long-lived dev servers
// the pool reuses connections. No manual cleanup needed.
const client = postgres(process.env.NEON_DATABASE_URL);

export const db = drizzle(client, { schema });

// Re-export `sql` (neon HTTP query function) for backward compatibility with
// old pages/components that still use the neon tagged-template pattern.
// These will be migrated to Drizzle queries in Phase 4.
// Once all consumers are migrated, remove this export.
export const sql = neon(process.env.NEON_DATABASE_URL);
