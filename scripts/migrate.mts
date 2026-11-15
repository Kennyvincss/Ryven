/**
 * Creates/updates the database tables. Prints a clear success or error message.
 *   npm run db:migrate
 */
import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("\n❌ DATABASE_URL is empty. Open the .env file, fill in DATABASE_URL=..., save it (Ctrl+S), and try again.\n");
  process.exit(1);
}
if (url.includes("[YOUR-PASSWORD]") || url.includes("[") || url.includes("]")) {
  console.error("\n❌ DATABASE_URL still contains [YOUR-PASSWORD] or square brackets. Replace it with your real database password (no brackets).\n");
  process.exit(1);
}

let host = "unknown";
try {
  host = new URL(url).host;
} catch {
  console.error("\n❌ DATABASE_URL is not a valid connection string. It should start with postgresql:// or postgres://\n");
  process.exit(1);
}

const needsSsl = /supabase\.co|neon\.tech|sslmode=require/.test(url);
const pool = new pg.Pool({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : undefined, connectionTimeoutMillis: 15000 });

console.log(`Connecting to ${host} ...`);
try {
  await pool.query("select 1");
  console.log("Connected. Applying migrations ...");
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  const { rows } = await pool.query("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
  console.log(`\n✅ Migrations applied successfully. ${rows[0].n} tables in the database.\n`);
} catch (e) {
  const err = e as Error & { code?: string };
  console.error(`\n❌ Migration failed: ${err.message}${err.code ? ` (code ${err.code})` : ""}`);
  if (err.code === "28P01" || /password authentication/i.test(err.message)) console.error("   → Wrong password in DATABASE_URL. Use the database password you set in Supabase.");
  else if (err.code === "ENOTFOUND" || err.code === "ETIMEDOUT" || /timeout/i.test(err.message))
    console.error("   → Can't reach the database host. In Supabase use the Session pooler (or Transaction pooler) connection string.");
  else if (/Tenant or user not found/i.test(err.message)) console.error("   → The username in DATABASE_URL is wrong. Copy the full string again from Supabase.");
  console.error("");
  process.exitCode = 1;
} finally {
  await pool.end();
}
