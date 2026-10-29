import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

// Reuse one connection pool across hot reloads in development.
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

function connection() {
  if (!globalForDb.sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
    globalForDb.sql = postgres(url, { max: 5, onnotice: () => {} });
  }
  return globalForDb.sql;
}

// Lazily connect so `next build` works without a database.
let instance: ReturnType<typeof drizzle<typeof schema>> | null = null;
export function db() {
  if (!instance) instance = drizzle(connection(), { schema });
  return instance;
}

export { schema };
