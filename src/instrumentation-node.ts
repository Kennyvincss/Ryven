import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const enabled = process.env.AUTO_MIGRATE ? process.env.AUTO_MIGRATE === "true" : process.env.NODE_ENV !== "production";

if (enabled && process.env.DATABASE_URL) {
  const { db } = await import("./lib/server/db");
  try {
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    console.log("✓ Database schema is up to date");
  } catch (e) {
    console.error(`✗ Could not update the database automatically: ${(e as Error).message}\n  Run "npm run db:migrate" to see details.`);
  }
}
