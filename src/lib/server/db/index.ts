import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { serverEnv } from "../env";

declare global {
  var __ryvenPool: Pool | undefined;
}

function makePool() {
  const url = serverEnv.databaseUrl;
  return new Pool({
    connectionString: url,
    // Serverless (Vercel): every function instance has its own pool, so keep it small and let
    // idle connections go quickly. Use Supabase's pooler connection string there.
    max: process.env.VERCEL ? 3 : 10,
    idleTimeoutMillis: process.env.VERCEL ? 5_000 : 10_000,
    // Supabase / hosted Postgres require TLS; local Postgres usually does not.
    ssl: /sslmode=require|supabase\.co|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
}

// Reuse the pool across hot reloads in development.
export const pool: Pool = globalThis.__ryvenPool ?? (globalThis.__ryvenPool = makePool());
export const db = drizzle(pool, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
